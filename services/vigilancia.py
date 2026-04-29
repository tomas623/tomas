"""
Job de vigilancia (Nivel 4).

Después de cada importación de boletín, este módulo:

1. Identifica los boletines recién agregados (boletin_log con imported_at en
   las últimas 24 hs).
2. Para cada SuscripcionVigilancia activa, busca coincidencias entre las
   marcas nuevas de esos boletines y la(s) marca(s) que el cliente tiene
   bajo vigilancia.
3. Persiste cada match como AlertaVigilancia y dispara un email al cliente.

Idempotencia: antes de crear una alerta, verifica que no exista ya una con
el mismo (suscripcion_id, marca_nueva_id). Si llamamos al job dos veces
sobre el mismo boletín, no se duplican notificaciones.

Para no escalar a 300k similarity-checks por suscripción, usamos pg_trgm
filtrando primero por boletín y clase, luego corremos el scoring en Python.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import text as sql_text

from database import (
    AlertaVigilancia, BoletinLog, Marca, MarcaCliente,
    SuscripcionVigilancia, get_session,
)
from services.email import send_email, template_alerta_vigilancia
from similarity import (
    NIVEL_ALTO, NIVEL_MEDIO, lexical_score, normalize, phonetic_score,
)

logger = logging.getLogger(__name__)

# Score mínimo para considerar que merece una alerta. Es más estricto que el
# umbral de búsqueda (0.40) porque acá dispara emails reales al cliente.
MIN_SCORE_ALERTA = 0.55


@dataclass
class VigilanciaResult:
    suscripciones_revisadas: int = 0
    boletines_revisados: int = 0
    alertas_creadas: int = 0
    emails_enviados: int = 0


def run_vigilancia_post_import(window_hours: int = 24) -> VigilanciaResult:
    """Corre la vigilancia sobre los boletines importados en la última ventana.

    Pensado para llamarse desde scripts/import-boletin.py al final de cada
    importación exitosa.
    """
    result = VigilanciaResult()
    desde = datetime.utcnow() - timedelta(hours=window_hours)

    with get_session() as s:
        boletines = (s.query(BoletinLog)
                     .filter(BoletinLog.imported_at >= desde,
                             BoletinLog.status == "ok")
                     .all())
        result.boletines_revisados = len(boletines)
        boletin_nums = [b.numero for b in boletines]

        if not boletin_nums:
            logger.info("Vigilancia: no hay boletines recientes para revisar")
            return result

        suscripciones = (s.query(SuscripcionVigilancia)
                         .filter_by(status="active").all())
        result.suscripciones_revisadas = len(suscripciones)

        for sub in suscripciones:
            try:
                emitidas = _vigilar_suscripcion(s, sub, boletin_nums)
                result.alertas_creadas += emitidas
                result.emails_enviados += emitidas
            except Exception as e:
                logger.exception(f"Vigilancia sub#{sub.id} falló: {e}")

        # Marcar el last-check
        for sub in suscripciones:
            sub.next_check_at = datetime.utcnow() + timedelta(days=7)
        s.commit()

    logger.info(
        "Vigilancia: %d suscripciones, %d boletines, %d alertas creadas",
        result.suscripciones_revisadas, result.boletines_revisados,
        result.alertas_creadas,
    )
    return result


def _vigilar_suscripcion(s, sub: SuscripcionVigilancia,
                         boletin_nums: list[int]) -> int:
    """Vigila una suscripción contra los boletines indicados.

    Para portfolio (sub.tipo='portfolio'), revisa todas las marcas del usuario.
    Para marca individual, solo la marca asociada.

    Retorna la cantidad de alertas nuevas creadas.
    """
    # Cargar las marcas a vigilar
    if sub.tipo == "portfolio":
        marcas_propias = (s.query(MarcaCliente)
                          .filter_by(user_id=sub.user_id).all())
    else:
        if not sub.marca_cliente_id:
            return 0
        m = s.query(MarcaCliente).filter_by(id=sub.marca_cliente_id).first()
        marcas_propias = [m] if m else []

    if not marcas_propias:
        return 0

    creadas = 0
    for mp in marcas_propias:
        candidatas = _candidatas_en_boletines(s, mp, boletin_nums)
        for cand in candidatas:
            score, nivel = _scorear(mp, cand)
            if score < MIN_SCORE_ALERTA:
                continue

            # Idempotencia: evitar duplicar alertas para la misma combinación
            existing = (s.query(AlertaVigilancia)
                        .filter_by(suscripcion_id=sub.id,
                                   marca_nueva_id=cand.id).first())
            if existing:
                continue

            alerta = AlertaVigilancia(
                user_id=sub.user_id,
                suscripcion_id=sub.id,
                marca_cliente_id=mp.id,
                marca_nueva_id=cand.id,
                marca_nueva_acta=cand.acta,
                marca_nueva_denominacion=cand.denominacion,
                marca_nueva_clase=cand.clase,
                marca_nueva_titular=cand.titular,
                score=score, nivel=nivel,
                boletin_num=cand.boletin_num,
            )
            s.add(alerta)
            s.flush()  # para tener alerta.id si lo necesitamos

            if _enviar_email_alerta(sub, mp, cand, score, nivel):
                alerta.email_sent_at = datetime.utcnow()
            creadas += 1

    s.commit()
    return creadas


def _candidatas_en_boletines(s, mp: MarcaCliente, boletin_nums: list[int]) -> list[Marca]:
    """Trae marcas nuevas que potencialmente colisionan con la marca propia.

    Filtros server-side:
    - solo marcas de los boletines indicados,
    - misma clase (si la marca propia tiene clase definida) o sin filtro de clase,
    - similitud trigrama mínima de 0.30 si Postgres, ILIKE %sub% si SQLite.
    """
    from database import engine

    if engine.dialect.name == "postgresql":
        # Usa el índice GIN para filtrar las 50-200 candidatas relevantes
        q = sql_text("""
            SELECT id, acta, denominacion, tipo, clase, titular, estado,
                   estado_code, fecha_solicitud, fecha_vencimiento, boletin_num
            FROM marcas
            WHERE boletin_num = ANY(:boletines)
              AND (:clase IS NULL OR clase = :clase)
              AND similarity(lower(denominacion), lower(:term)) > 0.30
            ORDER BY similarity(lower(denominacion), lower(:term)) DESC
            LIMIT 50
        """)
        rows = s.execute(q, {
            "boletines": boletin_nums,
            "term": mp.denominacion,
            "clase": mp.clase,
        }).all()
    else:
        # Fallback SQLite
        like = f"%{normalize(mp.denominacion)[:8]}%"
        query = (s.query(Marca)
                 .filter(Marca.boletin_num.in_(boletin_nums))
                 .filter(Marca.denominacion.ilike(like)))
        if mp.clase:
            query = query.filter(Marca.clase == mp.clase)
        rows = query.limit(50).all()

    # Reconstruir como Marca-like; las del query SQL crudo son row-tuples
    out = []
    for r in rows:
        if hasattr(r, "_mapping"):
            d = dict(r._mapping)
            out.append(type("M", (), d))   # objeto liviano con atributos
        else:
            out.append(r)
    return out


def _scorear(mp: MarcaCliente, cand) -> tuple[float, str]:
    """Score combinado entre la marca propia y la candidata."""
    s_lex = lexical_score(mp.denominacion, cand.denominacion)
    s_fon = phonetic_score(mp.denominacion, cand.denominacion)
    base = max(s_lex, s_fon)

    bonus = 0.0
    if mp.clase and getattr(cand, "clase", None) == mp.clase:
        bonus += 0.10
    score = min(1.0, base + bonus)

    if score >= NIVEL_ALTO:
        nivel = "alto"
    elif score >= NIVEL_MEDIO:
        nivel = "medio"
    else:
        nivel = "bajo"
    return score, nivel


def _enviar_email_alerta(sub: SuscripcionVigilancia, mp: MarcaCliente,
                         cand, score: float, nivel: str) -> bool:
    """Envía el email de alerta al usuario. Retorna True si se mandó."""
    from database import User, get_session as _gs

    with _gs() as s:
        user = s.query(User).filter_by(id=sub.user_id).first()
        if not user or not user.email:
            return False

    base = os.getenv("APP_BASE_URL", "")
    dashboard_url = f"{base}/dashboard?tab=alertas"
    subject, html, text = template_alerta_vigilancia(
        marca_propia=mp.denominacion,
        marca_nueva=getattr(cand, "denominacion", ""),
        titular=getattr(cand, "titular", "") or "—",
        clase=getattr(cand, "clase", 0) or 0,
        nivel=nivel,
        dashboard_url=dashboard_url,
    )
    return send_email(user.email, subject, html, text=text)


# ─────────────────────────────────────────────────────────────────────
# Avisos de vencimiento (90 / 30 días)
# ─────────────────────────────────────────────────────────────────────

def run_avisos_vencimiento() -> int:
    """Envía avisos para marcas que vencen en 90 días o 30 días.

    Pensado para correrse diariamente (puede ser desde Task Scheduler aparte
    o desde el mismo job de boletín — es liviano).
    """
    from database import User
    from services.email import template_vencimiento_marca

    enviados = 0
    hoy = datetime.utcnow().date()
    objetivos = {hoy + timedelta(days=90): 90, hoy + timedelta(days=30): 30}

    with get_session() as s:
        for fecha_obj, dias in objetivos.items():
            marcas = (s.query(MarcaCliente)
                      .filter(MarcaCliente.fecha_vencimiento == fecha_obj).all())
            for m in marcas:
                user = s.query(User).filter_by(id=m.user_id).first()
                if not user:
                    continue
                base = os.getenv("APP_BASE_URL", "")
                subject, html, text = template_vencimiento_marca(
                    marca=m.denominacion,
                    fecha_vencimiento=fecha_obj.isoformat(),
                    dias_restantes=dias,
                    dashboard_url=f"{base}/dashboard?tab=marcas",
                )
                if send_email(user.email, subject, html, text=text):
                    enviados += 1
    logger.info(f"Avisos de vencimiento enviados: {enviados}")
    return enviados
