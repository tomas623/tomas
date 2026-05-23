"""
Rutas del flujo de consulta de marcas: Nivel 1 (gratuito) y Nivel 2 (paga).

Nivel 1 — `POST /api/marca/check`
  Captura email, marca y clase, hace una búsqueda liviana (sin IA), guarda un
  Lead y devuelve un veredicto rápido: "disponible" / "necesita análisis"
  con un contador. NO revela las coincidencias para incentivar la compra.

Nivel 2 — `POST /api/marca/consulta/iniciar`
  Crea una Consulta(nivel='completa', paid=False) y un Pago en estado pending,
  devuelve un init_point de MercadoPago para redirigir al checkout. La
  generación del informe completo (con IA) ocurre cuando el webhook de MP
  marca el pago como aprobado, o cuando el cliente vuelve y consulta
  /api/marca/consulta/<id> y el sistema detecta el pago aprobado.

Nivel 2 — `GET /api/marca/consulta/<id>`
  Devuelve el informe completo si está pago. Si no, devuelve un preview
  limitado (top 3 coincidencias sin nombres) para incentivar el pago.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Optional

from flask import Blueprint, jsonify, request, Response
from sqlalchemy import func

from database import Consulta, FreeSearchLog, Lead, Pago, get_session
from services.auth import current_user
from services.domains import check_domains
from services.social import check_handles
from similarity import (
    add_notorious_brand, check_notorious, diagnose, get_notorious_brands,
    get_notorious_with_source, reload_notorious_cache, remove_notorious_brand,
    search_similar, NIVEL_ALTO, NIVEL_MEDIO,
)

logger = logging.getLogger(__name__)
bp = Blueprint("marca", __name__)


PRECIO_NIVEL_2 = float(os.getenv("PRECIO_INFORME_COMPLETO",
                                  os.getenv("PRECIO_CONSULTA_COMPLETA", "9900")))
PRECIO_VIGILANCIA_MARCA = float(os.getenv("PRECIO_VIGILANCIA_INDIVIDUAL",
                                           os.getenv("PRECIO_VIGILANCIA_MARCA", "4900")))

# Rate limit Nivel 1 por IP. Suscriptores premium y usuarios autenticados
# pueden saltearlo (lo manejamos en _check_rate_limit).
FREE_SEARCH_LIMIT = int(os.getenv("FREE_SEARCH_LIMIT", "3"))
FREE_SEARCH_WINDOW_HOURS = int(os.getenv("FREE_SEARCH_WINDOW_HOURS", "168"))


def _mask_denominacion(name: str) -> str:
    """Enmascara una denominación para el teaser free: primera letra de cada
    palabra visible, el resto en puntos. Prueba que la marca existe sin revelarla."""
    name = (name or "").strip()
    if not name:
        return "•••"
    parts = []
    for word in name.split():
        if len(word) <= 1:
            parts.append(word.upper())
        else:
            parts.append(word[0].upper() + "•" * min(len(word) - 1, 6))
    return " ".join(parts)


def _window_label() -> str:
    """Texto humano de la ventana del rate limit (para el mensaje de error)."""
    h = FREE_SEARCH_WINDOW_HOURS
    if h % 168 == 0:
        n = h // 168
        return "semana" if n == 1 else f"{n} semanas"
    if h % 24 == 0:
        n = h // 24
        return "día" if n == 1 else f"{n} días"
    return f"{h} hs"

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _client_ip() -> str:
    """Mejor esfuerzo para obtener la IP del cliente respetando proxies."""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()[:45]
    return (request.remote_addr or "0.0.0.0")[:45]


def _has_unlimited_searches(user) -> bool:
    """Admins y suscriptores premium activos no tienen rate limit."""
    if not user:
        return False
    if getattr(user, "is_admin", False):
        return True
    try:
        from services.auth import has_active_premium
        return has_active_premium(user)
    except Exception:
        return False


def _check_rate_limit(user, ip: str) -> Optional[tuple[int, int]]:
    """Cuenta búsquedas recientes y devuelve (used, limit) si excede, sino None."""
    if _has_unlimited_searches(user):
        return None
    cutoff = datetime.utcnow() - timedelta(hours=FREE_SEARCH_WINDOW_HOURS)
    with get_session() as s:
        used = (s.query(func.count(FreeSearchLog.id))
                .filter(FreeSearchLog.ip == ip,
                        FreeSearchLog.created_at >= cutoff)
                .scalar()) or 0
    if used >= FREE_SEARCH_LIMIT:
        return (used, FREE_SEARCH_LIMIT)
    return None


def _log_free_search(ip: str, fingerprint: Optional[str], marca: str) -> None:
    try:
        with get_session() as s:
            s.add(FreeSearchLog(ip=ip, fingerprint=fingerprint, marca=marca[:300]))
            s.commit()
    except Exception as e:
        logger.warning(f"No se pudo loguear búsqueda libre: {e}")


def _ok(data, status=200):
    return jsonify({"ok": True, "data": data}), status


def _err(msg, status=400):
    return jsonify({"ok": False, "error": msg}), status


def _save_lead(email: str, marca: str, descripcion: str, clases: list[int],
               nombre: Optional[str] = None, telefono: Optional[str] = None,
               fuente: str = "consulta_gratuita") -> int:
    """Persiste un lead. Retorna el id."""
    with get_session() as s:
        lead = Lead(
            email=email, marca=marca, descripcion=descripcion,
            clases=clases or [], fuente=fuente,
            nombre=nombre, telefono=telefono,
        )
        s.add(lead)
        s.commit()
        s.refresh(lead)
        return lead.id


# ─────────────────────────────────────────────────────────────────────
# Nivel 1 — gratuito
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/marca/check", methods=["POST"])
def nivel_1_check():
    """Búsqueda gratuita: devuelve veredicto sin revelar las marcas existentes."""
    data = request.get_json(silent=True) or {}
    marca = (data.get("marca") or "").strip()
    descripcion = (data.get("descripcion") or "").strip()
    email = (data.get("email") or "").strip().lower()
    clases = data.get("clases") or []
    nombre = (data.get("nombre") or "").strip() or None
    telefono = (data.get("telefono") or "").strip() or None
    fingerprint = (data.get("fingerprint") or "").strip()[:120] or None

    if not marca:
        return _err("El nombre de la marca es requerido")
    if email and not EMAIL_RE.match(email):
        return _err("Email inválido")

    # Normalizar clases a int para validar antes del rate limit
    try:
        clases = [int(c) for c in (clases or []) if c]
    except (ValueError, TypeError):
        clases = []
    # La consulta gratuita exige una clase específica. Premium/admin pueden
    # consultar las 45 clases sin elegir una.
    user = current_user()
    is_premium_or_admin = bool(
        user and (user.is_admin or _has_unlimited_searches(user))
    )
    if not clases and not is_premium_or_admin:
        return _err("Elegí al menos una clase Niza para la búsqueda gratuita.")
    if not is_premium_or_admin and len(clases) > 3:
        return _err("La búsqueda gratuita permite hasta 3 clases. Suscribite para buscar en las 45.")

    # Rate limit: Nivel 1 anónimo limitado por IP en una ventana móvil.
    ip = _client_ip()
    over = _check_rate_limit(user, ip)
    if over is not None:
        used, limit = over
        return jsonify({
            "ok": False,
            "error": (f"Llegaste al límite de {limit} búsquedas gratuitas por "
                      f"{_window_label()}. Suscribite al plan mensual "
                      "para tener consultas ilimitadas."),
            "rate_limited": True,
            "used": used,
            "limit": limit,
            "window_hours": FREE_SEARCH_WINDOW_HOURS,
        }), 429

    # Loguear esta búsqueda (alimenta el contador del rate limit)
    _log_free_search(ip, fingerprint, marca)

    # Persistir lead solo si dejó email (Lead.email es NOT NULL)
    lead_id = None
    if email:
        lead_id = _save_lead(email, marca, descripcion, clases,
                             nombre=nombre, telefono=telefono)

    # Premium/admin reciben búsqueda completa (top 50, sin paywall) + IA conceptual
    from services.auth import has_active_premium
    is_full_access = bool(user and (user.is_admin or has_active_premium(user)))
    if is_full_access:
        matches = search_similar(
            marca=marca, descripcion=descripcion,
            clases=clases or None, limit=50, use_ai=True,
            min_score=0.40,
        )
    else:
        # Búsqueda liviana free: sin IA, top 5
        matches = search_similar(
            marca=marca, descripcion=descripcion,
            clases=clases or None, limit=5, use_ai=False,
            min_score=0.45,
        )

    # Cross-class: ¿existe la misma marca registrada en otra clase?
    # Importante para marcas notorias (Coca-Cola, Nike, etc.) cuya
    # protección "rompe" la clase. Solo si el usuario eligió una clase puntual.
    cross_class_matches: list = []
    if clases and len(clases) == 1:
        all_class_matches = search_similar(
            marca=marca, descripcion=descripcion,
            clases=None, limit=10, use_ai=False, min_score=0.70,
        )
        target_clase = clases[0]
        cross_class_matches = [m for m in all_class_matches
                                if m.clase and m.clase != target_clase]

    # Marcas notorias: chequeo independiente contra lista hardcodeada.
    # Sirve cuando el FTS5 no encuentra match (ej. "coco cola" vs "Coca-Cola"
    # con prefijos no matchean) pero la marca es claramente confusable.
    notorious_warnings = check_notorious(marca)

    altos = [m for m in matches if m.nivel == "alto"]
    medios = [m for m in matches if m.nivel == "medio"]
    cross_notorios = [m for m in cross_class_matches if (m.score or 0) >= 0.85]

    # Razones específicas (lista para mostrar como bullets explícitos en UI)
    razones: list[dict] = []
    if altos:
        razones.append({
            "tipo": "similares_clase",
            "ok": False,
            "texto": f"Hay {len(altos)} marca(s) muy similares registradas en las clases que elegiste.",
        })
    elif medios:
        razones.append({
            "tipo": "similares_clase",
            "ok": False,
            "texto": f"Hay {len(medios)} marca(s) con cierta similitud en tus clases.",
        })
    else:
        razones.append({
            "tipo": "similares_clase",
            "ok": True,
            "texto": "No detectamos marcas similares en las clases que elegiste.",
        })
    if cross_class_matches:
        n_other = len(cross_class_matches)
        razones.append({
            "tipo": "cross_class",
            "ok": False,
            "texto": f"Hay {n_other} marca(s) similares registradas en otras clases.",
        })
    else:
        razones.append({
            "tipo": "cross_class",
            "ok": True,
            "texto": "No hay marcas similares en otras clases.",
        })
    if notorious_warnings:
        top = notorious_warnings[0]["denominacion"]
        razones.append({
            "tipo": "notoria",
            "ok": False,
            "texto": f"Tu búsqueda se parece a {top}, una marca notoria — protección extendida a todas las clases.",
        })
    else:
        razones.append({
            "tipo": "notoria",
            "ok": True,
            "texto": "No detectamos similitud con marcas notorias conocidas.",
        })

    # Probabilidad de RECHAZO (más directo): baja / media / alta
    if altos or (notorious_warnings and notorious_warnings[0]["score"] >= 0.80):
        veredicto = "no_disponible"
        probabilidad_rechazo = "alta"
    elif notorious_warnings or cross_notorios or medios or cross_class_matches:
        veredicto = "necesita_analisis"
        probabilidad_rechazo = "media"
    else:
        veredicto = "probablemente_disponible"
        probabilidad_rechazo = "baja"

    # Mensaje principal (compacto) — la explicación detallada va en razones[]
    if probabilidad_rechazo == "alta":
        if altos:
            mensaje = (f"Encontramos {len(altos)} marca(s) muy similares ya registradas. "
                       "El registro tiene riesgo alto de oposición.")
        else:
            top = notorious_warnings[0]["denominacion"]
            mensaje = (f"Tu búsqueda es muy similar a <strong>{top}</strong>, una marca notoria. "
                       "Las marcas notorias tienen protección en todas las clases.")
    elif probabilidad_rechazo == "media":
        mensaje = ("Hay señales que conviene revisar antes de invertir en el registro. "
                   "El informe completo te dice qué marcas dispararon la alerta y por qué.")
    else:
        if is_full_access:
            mensaje = ("Hicimos el análisis completo de confundibilidad y no encontramos "
                       "coincidencias significativas. La marca parece registrable.")
        else:
            mensaje = ("No encontramos coincidencias evidentes. El informe completo confirma "
                       "el análisis con todas las dimensiones (léxico, fonético, conceptual).")

    diag = diagnose(matches)

    # Chequeo de dominio + handles en redes (informativo)
    domains = [d.to_dict() for d in check_domains(marca)]
    handles = [h.to_dict() for h in check_handles(marca)] if is_full_access else []

    # Resumen por dimensión: cuántas marcas con score relevante en cada eje.
    # Usamos 50% como umbral para 'similar' (capturamos zona gris) y 70% para
    # 'muy similar'. 95% es 'idéntica'.
    summary_lex = sum(1 for m in matches if (m.score_lex or 0) >= 0.50)
    summary_fon = sum(1 for m in matches if (m.score_fon or 0) >= 0.50)
    summary_con = sum(1 for m in matches if (m.score_con or 0) >= 0.50)
    summary_lex_alto = sum(1 for m in matches if (m.score_lex or 0) >= 0.70)
    summary_fon_alto = sum(1 for m in matches if (m.score_fon or 0) >= 0.70)
    summary_con_alto = sum(1 for m in matches if (m.score_con or 0) >= 0.70)
    summary_iden = sum(1 for m in matches if (m.score_lex or 0) >= 0.95)

    es_notoria = bool(notorious_warnings and notorious_warnings[0].get("score", 0) >= 0.75)

    # Veredicto siempre. Para free, el stats es agregado (sin matches detallados).
    response = {
        "lead_id": lead_id,
        "marca": marca,
        "clases_consultadas": clases,
        "veredicto": veredicto,
        "probabilidad_rechazo": probabilidad_rechazo,
        "razones": razones,
        "diagnostico": diag,
        "mensaje": mensaje,
        "stats": {
            "matches_total": len(matches),
            "matches_alto": len(altos),
            "matches_medio": len(medios),
            "identicas": summary_iden,
        },
        "dominios": domains,
        "handles": handles,           # solo para premium/admin (paywall)
        "premium": is_full_access,
        "es_notoria": es_notoria,
        # En free mostramos la notoria si dispara (es la prueba del valor),
        # pero solo la denominación (sin scores).
        "notorious_warnings": (
            [{"denominacion": n["denominacion"]} for n in notorious_warnings[:1]]
            if not is_full_access else notorious_warnings
        ),
    }

    if is_full_access:
        # FULL: detalles por dimensión + matches + cross-class + probabilidad por clase
        response["stats"].update({
            "similares_lex": summary_lex,
            "similares_fon": summary_fon,
            "similares_con": summary_con,
            "similares_lex_alto": summary_lex_alto,
            "similares_fon_alto": summary_fon_alto,
            "similares_con_alto": summary_con_alto,
        })
        response["matches"] = [m.to_dict() for m in matches]
        response["cross_class_matches"] = [m.to_dict() for m in cross_class_matches]
        response["por_clase"] = _probabilidad_por_clase(marca, descripcion, clases)

        # Nuevos bloques del informe completo
        from similarity import analyze_marca_strength, detect_mot_vedette
        response["marca_strength"] = analyze_marca_strength(marca)
        response["mot_vedette"] = detect_mot_vedette(marca)
        response["marcas_vencidas"] = _marcas_vencidas_similares(marca, clases)
        response["temporal"] = _analisis_temporal(marca, clases)
        response["clases_sugeridas"] = (_sugerir_clases_adicionales(marca, descripcion, clases)
                                        if descripcion else [])
    else:
        # FREE: tease del informe + paywall claro
        clases_con_match = len({m.clase for m in matches if m.clase})
        # Muestras enmascaradas: prueban que las marcas existen sin revelar el nombre.
        muestras = sorted(matches, key=lambda m: (m.score or 0), reverse=True)[:3]
        response["tease"] = {
            "marcas_similares": len(matches),
            "clases_con_riesgo": clases_con_match,
            "alto_riesgo": len(altos),
            "tiene_notoria": es_notoria,
            "muestras": [
                {
                    "mask": _mask_denominacion(m.denominacion),
                    "nivel": m.nivel,
                    "clase": m.clase,
                    "score": round((m.score or 0) * 100),
                }
                for m in muestras
            ],
        }
        response["siguiente_paso"] = {
            "tipo": "informe_completo",
            "precio": PRECIO_NIVEL_2,
            "moneda": "ARS",
            "titulo": "Desbloqueá el informe completo",
            "incluye": [
                "Lista completa de marcas similares con titular y fecha",
                "Score detallado: léxico + fonético + conceptual con IA",
                "Análisis de marcas notorias con explicación legal",
                "Probabilidad de registro en las 45 clases Niza",
                "Análisis de marca fuerte / débil y elementos predominantes",
                "Detección de marcas vencidas (que volvieron al dominio público)",
                "PDF descargable con sello LegalPacers",
                "Cotización de registro incluida",
            ],
        }

    return _ok(response)


@bp.route("/api/marca/seguimiento", methods=["POST"])
def seguimiento_email():
    """Captura liviana de email tras el resultado: guarda el lead para avisos
    de novedades sobre la marca. No corre búsqueda ni consume rate limit."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    marca = (data.get("marca") or "").strip()
    clases = data.get("clases") or []

    if not email or not EMAIL_RE.match(email):
        return _err("Email inválido")
    if not marca:
        return _err("Falta la marca")
    try:
        clases = [int(c) for c in clases if c]
    except (ValueError, TypeError):
        clases = []

    _save_lead(email, marca, "", clases, fuente="seguimiento_resultado")
    return _ok({"saved": True})


# ─────────────────────────────────────────────────────────────────────
# Nivel 2 — paga
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/marca/consulta/iniciar", methods=["POST"])
def nivel_2_iniciar():
    """Crea una Consulta y devuelve checkout URL.
    Admin / Premium: auto-aprueba sin cobro y devuelve consulta_id para ver el informe."""
    data = request.get_json(silent=True) or {}
    marca = (data.get("marca") or "").strip()
    descripcion = (data.get("descripcion") or "").strip()
    email = (data.get("email") or "").strip().lower()
    clases = data.get("clases") or []

    if not marca:
        return _err("El nombre de la marca es requerido")

    user = current_user()
    from services.auth import has_active_premium
    is_full_access = bool(user and (user.is_admin or has_active_premium(user)))

    # Para usuarios sin acceso premium, email es obligatorio para pagar/recibir.
    if not is_full_access:
        if not email or not EMAIL_RE.match(email):
            return _err("Email inválido")
    elif user and not email:
        email = user.email

    try:
        clases = [int(c) for c in clases if c]
    except (ValueError, TypeError):
        clases = []

    # Código promo del nurturing (D+15) — 10% off el informe completo
    promo_code = (data.get("promo_code") or "").strip().upper()
    promo_valido = (promo_code == os.getenv("INFORME_PROMO_CODE", "VOLVER10"))
    descuento_pct = int(os.getenv("INFORME_RECORDATORIO_DESCUENTO_PCT", "10")) if promo_valido else 0
    monto_final = round(PRECIO_NIVEL_2 * (1 - descuento_pct / 100.0))

    user_id = user.id if user else None

    # Persistir consulta + pago (pending)
    with get_session() as s:
        consulta = Consulta(
            user_id=user_id, email=email, marca=marca,
            descripcion=descripcion, clases=clases,
            nivel="completa", paid=is_full_access,  # admin/premium ya entran como paid
        )
        s.add(consulta)
        s.flush()  # obtener consulta.id

        if is_full_access:
            # Generamos el informe completo al toque, sin pago
            _generar_informe_completo(consulta)
            s.commit()
            return _ok({
                "consulta_id": consulta.id,
                "monto": 0.0,
                "moneda": "ARS",
                "covered_by_premium": True,
                "init_point": None,
                "ya_logueado": True,
            })

        pago_meta = {"consulta_id": consulta.id, "marca": marca}
        if promo_valido:
            pago_meta["promo_code"] = promo_code
            pago_meta["descuento_pct"] = descuento_pct
        pago = Pago(
            user_id=user_id, email=email,
            tipo="consulta_completa", monto=monto_final,
            moneda="ARS", status="pending",
            metadata_json=pago_meta,
        )
        s.add(pago)
        s.flush()
        consulta.pago_id = pago.id
        s.commit()
        consulta_id = consulta.id
        pago_id = pago.id

    # Generar preferencia de MercadoPago (lazy import)
    try:
        from services.mercadopago import create_consulta_preference
        pref = create_consulta_preference(
            pago_id=pago_id, consulta_id=consulta_id,
            email=email, marca=marca, monto=monto_final,
        )
    except Exception as e:
        logger.exception(f"Error creando preferencia MP: {e}")
        pref = None

    return _ok({
        "consulta_id": consulta_id,
        "pago_id": pago_id,
        "monto": monto_final,
        "monto_original": PRECIO_NIVEL_2,
        "descuento_pct": descuento_pct,
        "moneda": "ARS",
        "init_point": pref.get("init_point") if pref else None,
        "preference_id": pref.get("id") if pref else None,
        "ya_logueado": user is not None,
    })


@bp.route("/api/marca/consulta/<int:consulta_id>", methods=["GET"])
def nivel_2_ver_informe(consulta_id: int):
    """Retorna el informe completo si está pago, o un preview si no."""
    with get_session() as s:
        c = s.query(Consulta).filter_by(id=consulta_id).first()
        if not c:
            return _err("Consulta no encontrada", 404)

        # Permisos: dueño (por email o user) o admin
        user = current_user()
        is_owner = (user and (user.id == c.user_id or user.email == c.email))
        is_admin = bool(user and user.is_admin)
        from services.auth import has_active_premium
        is_premium = bool(user and has_active_premium(user))
        full_access = is_admin or is_premium

        # Si el viewer tiene acceso full y la consulta es propia, asegurar paid=True
        if full_access and is_owner and not c.paid:
            c.paid = True
            if not c.resultados:
                _generar_informe_completo(c)
            s.commit()
            s.refresh(c)

        c_data = {
            "id": c.id, "marca": c.marca, "descripcion": c.descripcion,
            "clases": c.clases or [], "paid": c.paid, "nivel": c.nivel,
            "diagnostico": c.diagnostico, "created_at": c.created_at.isoformat(),
        }

        if not c.paid:
            # Preview: top 3 sin nombres ni titulares
            preview = []
            if c.resultados:
                for r in (c.resultados or [])[:3]:
                    preview.append({
                        "clase": r.get("clase"),
                        "score": r.get("score"),
                        "nivel": r.get("nivel"),
                        "denominacion": "███████████",
                    })
            return _ok({
                **c_data,
                "preview": preview,
                "mensaje": "Aboná la consulta completa para desbloquear el informe.",
                "monto_pendiente": PRECIO_NIVEL_2,
            })

        # Si está pago pero aún no se generó el informe, generarlo ahora
        if c.paid and not c.resultados:
            _generar_informe_completo(c)
            s.commit()
            s.refresh(c)

        return _ok({
            **c_data,
            "resultados": c.resultados or [],
            "pre_analisis_ia": c.pre_analisis_ia,
            "diagnostico": c.diagnostico,
        })


@bp.route("/api/marca/consulta/<int:consulta_id>/pdf", methods=["GET"])
def nivel_2_descargar_pdf(consulta_id: int):
    """Devuelve el informe completo en PDF. Solo si la consulta está paga."""
    with get_session() as s:
        c = s.query(Consulta).filter_by(id=consulta_id).first()
        if not c:
            return _err("Consulta no encontrada", 404)

        user = current_user()
        from services.auth import has_active_premium
        full_access = bool(user and (user.is_admin or has_active_premium(user)))
        is_owner = bool(user and (user.id == c.user_id or user.email == c.email))

        if not (c.paid or (full_access and is_owner)):
            return _err("El informe todavía no está disponible (pago pendiente).", 402)

        # Generar el informe si todavía no existe
        if not c.resultados:
            _generar_informe_completo(c)
            c.paid = True
            s.commit()
            s.refresh(c)

        marca = c.marca
        descripcion = c.descripcion
        clases = c.clases or []
        diagnostico = c.diagnostico
        pre_analisis = c.pre_analisis_ia
        resultados = c.resultados or []
        created_at = c.created_at

    try:
        from pdf_generator import LegalPacersPDF
        buf = LegalPacersPDF().generate_consulta(
            marca=marca, descripcion=descripcion, clases=clases,
            diagnostico=diagnostico, pre_analisis_ia=pre_analisis,
            resultados=resultados, fecha=created_at,
        )
    except Exception as e:
        logger.exception(f"Error generando PDF de consulta {consulta_id}: {e}")
        return _err("No pudimos generar el PDF. Probá de nuevo o escribinos.", 500)

    safe_marca = re.sub(r"[^A-Za-z0-9_-]+", "_", (marca or "marca")).strip("_") or "marca"
    filename = f"Informe_{safe_marca}_LegalPacers.pdf"
    return Response(
        buf.getvalue(),
        mimetype="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _generar_informe_completo(consulta: Consulta) -> None:
    """Corre similitud completa con IA + pre-análisis legal y persiste."""
    matches = search_similar(
        marca=consulta.marca, descripcion=consulta.descripcion or "",
        clases=consulta.clases or None, limit=50, use_ai=True,
        min_score=0.40,
    )
    consulta.resultados = [m.to_dict() for m in matches]
    consulta.diagnostico = diagnose(matches)

    # Pre-análisis legal con Claude
    try:
        consulta.pre_analisis_ia = _analisis_legal(consulta, matches)
    except Exception as e:
        logger.warning(f"Pre-análisis IA falló: {e}")
        consulta.pre_analisis_ia = None

    if consulta.viewed_at is None:
        consulta.viewed_at = datetime.utcnow()


def _probabilidad_por_clase(marca: str, descripcion: str,
                              clases_pedidas: list) -> dict:
    """Calcula probabilidad de registro para CADA clase Niza 1-45.

    Hace una pasada sin filtro de clase + buckets por clase. Cada clase recibe
    una puntuación 0-100 según cuántos matches altos/medios encontró.

    Returns:
        {
          "clases_pedidas": [11, ...],
          "scores": [
            {"clase": 1, "titulo": "...", "matches": 0, "probabilidad": 95, "label": "alta"},
            ...
          ],
          "mejores": [{clase, probabilidad, titulo}],   # top 5 más viables
          "peores": [{clase, probabilidad, titulo}],    # top 5 menos viables
        }
    """
    NIZA_TITULOS = {
        1:"Productos químicos",2:"Pinturas y barnices",3:"Cosméticos y limpieza",
        4:"Aceites y combustibles",5:"Farmacéuticos",6:"Metales comunes",
        7:"Máquinas y motores",8:"Herramientas de mano",9:"Electrónica y software",
        10:"Aparatos médicos",11:"Alumbrado y calefacción",12:"Vehículos",
        13:"Armas de fuego",14:"Joyería y relojes",15:"Instrumentos musicales",
        16:"Papel e imprenta",17:"Caucho y plásticos",18:"Cuero y bolsos",
        19:"Materiales de construcción",20:"Muebles",21:"Utensilios domésticos",
        22:"Cuerdas y fibras",23:"Hilos textiles",24:"Telas y textiles",
        25:"Ropa y calzado",26:"Encajes y bordados",27:"Alfombras",
        28:"Juegos y juguetes",29:"Carne y alimentos",30:"Café, té y panadería",
        31:"Agrícola y animales vivos",32:"Cervezas y bebidas",33:"Bebidas alcohólicas",
        34:"Tabaco",35:"Publicidad y gestión",36:"Seguros y finanzas",
        37:"Construcción y reparación",38:"Telecomunicaciones",39:"Transporte",
        40:"Tratamiento de materiales",41:"Educación y entretenimiento",
        42:"Servicios tecnológicos",43:"Restauración y alojamiento",
        44:"Servicios médicos y veterinarios",45:"Servicios jurídicos y seguridad",
    }
    try:
        all_matches = search_similar(
            marca=marca, descripcion=descripcion,
            clases=None, limit=200, use_ai=False, min_score=0.50,
        )
    except Exception as e:
        logger.warning(f"Probabilidad por clase: search falló: {e}")
        all_matches = []

    # Bucket por clase
    by_class = {n: {"alto": 0, "medio": 0, "bajo": 0} for n in range(1, 46)}
    for m in all_matches:
        c = m.clase
        if not c or c not in by_class:
            continue
        if m.nivel == "alto":
            by_class[c]["alto"] += 1
        elif m.nivel == "medio":
            by_class[c]["medio"] += 1
        else:
            by_class[c]["bajo"] += 1

    # Score por clase: 100 - 25*alto - 10*medio - 3*bajo (clamped 0-100)
    scores = []
    for c in range(1, 46):
        b = by_class[c]
        prob = max(0, min(100, 100 - 25 * b["alto"] - 10 * b["medio"] - 3 * b["bajo"]))
        if prob >= 80:
            label = "alta"
        elif prob >= 50:
            label = "media"
        else:
            label = "baja"
        scores.append({
            "clase": c, "titulo": NIZA_TITULOS.get(c, ""),
            "matches": b["alto"] + b["medio"] + b["bajo"],
            "matches_alto": b["alto"], "matches_medio": b["medio"],
            "probabilidad": prob, "label": label,
            "es_pedida": c in (clases_pedidas or []),
        })

    mejores = sorted(scores, key=lambda x: (-x["probabilidad"], x["clase"]))[:5]
    peores = sorted(scores, key=lambda x: (x["probabilidad"], x["clase"]))[:5]
    return {
        "clases_pedidas": clases_pedidas or [],
        "scores": scores,
        "mejores": [{"clase": s["clase"], "titulo": s["titulo"], "probabilidad": s["probabilidad"]} for s in mejores],
        "peores": [{"clase": s["clase"], "titulo": s["titulo"], "probabilidad": s["probabilidad"]} for s in peores],
    }


def _marcas_vencidas_similares(marca: str, clases: list, limit: int = 10) -> list[dict]:
    """Encuentra marcas similares cuyo estado NO sea vigente o cuya fecha de
    vencimiento ya pasó. Estas marcas volvieron al dominio público y podrían
    reusarse — info valiosa para el cliente.
    """
    from datetime import date
    from database import Marca, get_session

    matches = search_similar(
        marca=marca, descripcion="",
        clases=clases or None, limit=80, use_ai=False, min_score=0.50,
    )
    if not matches:
        return []

    hoy = date.today()
    ids = [m.id for m in matches[:80]]
    out: list[dict] = []
    with get_session() as s:
        rows = s.query(Marca).filter(Marca.id.in_(ids)).all()
        by_id = {r.id: r for r in rows}
        for m in matches:
            r = by_id.get(m.id)
            if not r:
                continue
            estado = (r.estado_code or "").lower()
            venc = r.fecha_vencimiento
            es_vencida = (estado not in ("vigente", "registrada")) or (venc and venc < hoy)
            if not es_vencida:
                continue
            out.append({
                "denominacion": r.denominacion,
                "clase": r.clase,
                "titular": r.titular,
                "estado": r.estado or r.estado_code,
                "fecha_vencimiento": venc.isoformat() if venc else None,
                "score": round(m.score, 3),
            })
            if len(out) >= limit:
                break
    return out


def _analisis_temporal(marca: str, clases: list) -> dict:
    """Cuenta marcas registradas por año en la clase del usuario, último 5 años.

    Insight: '¿tu rubro está saturado de marcas nuevas o no?'
    """
    from datetime import date
    from sqlalchemy import func as _func, extract
    from database import Marca, get_session

    if not clases:
        return {"clases": [], "por_anio": []}
    hoy = date.today()
    anio_min = hoy.year - 4

    with get_session() as s:
        rows = (s.query(extract("year", Marca.fecha_solicitud).label("anio"),
                        _func.count(Marca.id).label("n"))
                 .filter(Marca.clase.in_(clases),
                         Marca.fecha_solicitud.is_not(None),
                         extract("year", Marca.fecha_solicitud) >= anio_min)
                 .group_by("anio").order_by("anio").all())

    por_anio = [{"anio": int(r.anio), "registros": int(r.n)} for r in rows]
    total = sum(r["registros"] for r in por_anio)
    promedio = (total / len(por_anio)) if por_anio else 0
    return {
        "clases": clases,
        "por_anio": por_anio,
        "total_5_anios": total,
        "promedio_anual": round(promedio, 1),
    }


def _sugerir_clases_adicionales(marca: str, descripcion: str,
                                 clases_actuales: list) -> list[dict]:
    """Usa IA para sugerir clases Niza adicionales según la descripción del
    producto/servicio. Output: lista de clases con razón.
    """
    if not descripcion or not descripcion.strip():
        return []
    from similarity import _call_gemini, _call_claude
    actuales = ", ".join(str(c) for c in (clases_actuales or [])) or "ninguna"
    prompt = f"""Sos asistente experto en clasificación Niza (1-45) de marcas en Argentina.
Dado un producto/servicio descrito por el usuario, sugerí hasta 5 clases Niza ADICIONALES
que NO estén en la lista actual y que serían razonables registrar también.

Marca: "{marca}"
Descripción del producto/servicio: "{descripcion}"
Clases ya seleccionadas: {actuales}

Devolvés ÚNICAMENTE un JSON array, sin texto extra. Máximo 5 elementos:
[{{"clase": <int 1-45>, "razon": "<una línea>"}}]

Ejemplo: si vende ropa (clase 25), sugerí clase 35 (publicidad/retail) y 18 (cuero).
Si no podés sugerir nada útil, devolvé [].
"""
    raw = _call_gemini(prompt) or _call_claude(prompt)
    if not raw:
        return []
    import re as _re
    m = _re.search(r"\[.*\]", raw, _re.DOTALL)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except Exception:
        return []
    out: list[dict] = []
    seen: set = set()
    for it in items:
        try:
            c = int(it["clase"])
            if c < 1 or c > 45 or c in (clases_actuales or []) or c in seen:
                continue
            seen.add(c)
            out.append({"clase": c, "razon": (it.get("razon") or "").strip()[:200]})
        except Exception:
            continue
    return out[:5]


def _analisis_legal(consulta: Consulta, matches: list) -> str:
    """Genera un pre-análisis automatizado de viabilidad con IA (markdown)."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        return ""
    from anthropic import Anthropic

    altos = [m for m in matches if m.nivel == "alto"][:5]
    medios = [m for m in matches if m.nivel == "medio"][:5]

    contexto = []
    for m in altos + medios:
        contexto.append(
            f"- {m.denominacion} (clase {m.clase or '?'}, "
            f"estado: {m.estado_code or '?'}, titular: {m.titular or '?'}, "
            f"score: {m.score:.2f})"
        )

    prompt = f"""Sos un asistente experto en el sistema de marcas de Argentina.
No menciones al "INPI" por su nombre; referite a "el registro de marcas" o "el organismo".
Tu tarea es generar un pre-análisis automatizado de viabilidad de registro a
partir de las coincidencias detectadas. NO sos abogado y el análisis NO es
asesoramiento legal: es una orientación previa para que el usuario decida si
contratar un especialista para el trámite.

Marca consultada: "{consulta.marca}"
Descripción del producto/servicio: {consulta.descripcion or '(sin descripción)'}
Clases solicitadas: {consulta.clases or 'no especificadas'}

Coincidencias relevantes detectadas:
{chr(10).join(contexto) if contexto else '(ninguna coincidencia significativa)'}

== MARCO DE CONFUNDIBILIDAD (aplicalo en cada match relevante) ==

Tipos de confusión que tenés que clasificar:
- DIRECTA (inmediata): el consumidor cree que es la misma marca.
- INDIRECTA (mediata): cree que vienen de la misma empresa o línea de productos.
- AMPLIA: cree que hay un vínculo comercial/jurídico (licencia, franquicia).

Dimensiones a evaluar (cualquiera basta para denegar el registro):
1. GRÁFICA: similitud visual (no aplica si no hay logo, indicalo).
2. FONÉTICA: cómo suenan. Considerá aliteración, ubicación de vocales,
   secuencia de consonantes. "Hasúcar" vs "Azúcar" suenan igual aunque se
   escriban distinto.
3. IDEOLÓGICA: significado. Detectá sinónimos ("Los Criadores"/"Los Ganaderos"),
   traducciones ("Norte"/"Notte", "L'Etoile"/"Stella"), antónimos
   ("Fiel"/"Infiel") y asociación de ideas.

Reglas de apreciación que tenés que aplicar:
- COTEJO DE CONJUNTO: comparar por impresión global, no fragmentando.
  Excepción "Mot Vedette": si hay un elemento predominante, centrate en él.
- APRECIACIÓN SUCESIVA: no comparar lado a lado; simular el recuerdo —
  evocar la primera marca y ver si la segunda la trae a la mente.
- PESO MAYOR A LAS SEMEJANZAS que a las diferencias: cambiar una letra rara
  vez es suficiente para diferenciar.
- SÍLABAS: las primeras (raíz) pesan más en la memoria auditiva. Excepción
  "marcas débiles": si la raíz es genérica/descriptiva (ej. "Rapi-", "-farma")
  el peso va a las desinencias.
- ESPECIALIDAD Y PÚBLICO RELEVANTE: la confusión cuenta sobre todo si las
  marcas se aplican a productos similares y el público es susceptible de
  error. Consumo masivo / bajo precio → más riesgo. Medicamentos / alto
  valor → menos riesgo (compra atenta).
- MARCAS NOTORIAS: si una marca es muy famosa, su protección rompe la
  barrera de las clases — se extiende a otros rubros para evitar
  aprovechamiento parasitario.

Escribí el pre-análisis en español neutro, estructurado en estas secciones
(usá Markdown con headers):

## Resumen ejecutivo
(2-3 oraciones con la orientación general: viable / viable con ajustes / riesgo alto)

## Análisis de confundibilidad
Para las coincidencias relevantes, comentá:
- Tipo de confusión probable (directa/indirecta/amplia)
- Dimensión predominante (gráfica/fonética/ideológica)
- Si hay "Mot Vedette" o si la raíz es débil
- Si la marca de referencia parece notoria

## Riesgos identificados
(clase, similitud por dimensión, probabilidad de oposición, público relevante)

## Orientación
(viable / viable con ajustes / riesgo alto — y qué ajustes concretos sugerirías:
cambiar desinencia, agregar elemento distintivo, otra clase, etc.)

## Próximos pasos
(qué hacer — registrar, modificar, vigilar; sugerí coordinar con uno de
nuestros especialistas para el trámite de registro)

Sé concreto y conciso, máximo 500 palabras. Evitá afirmaciones tajantes;
usá fórmulas como "podría", "sugiere", "se recomienda evaluar". Nunca
afirmes que la marca "puede registrarse sin problemas" — siempre dejá que
el especialista lo valide."""

    client = Anthropic()
    resp = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


# ─────────────────────────────────────────────────────────────────────
# Notorias — admin: agregar marca a la lista
# ─────────────────────────────────────────────────────────────────────

def _require_admin():
    """Helper: devuelve (None, None) si admin, ('error_response', 403) si no."""
    user = current_user()
    if not user or not user.is_admin:
        return _err("Solo admin", 403)
    return None


@bp.route("/api/marca/notorias", methods=["GET"])
def marca_notorias_list():
    """Solo admin: lista todas las marcas notorias con su origen."""
    err = _require_admin()
    if err is not None:
        return err
    items = get_notorious_with_source()
    return _ok({
        "total": len(items),
        "items": items,
    })


@bp.route("/api/marca/notorias/agregar", methods=["POST"])
def marca_notoria_agregar():
    """Solo admin: agrega una marca a notorious_brands.txt."""
    err = _require_admin()
    if err is not None:
        return err
    data = request.get_json(silent=True) or {}
    brand = (data.get("denominacion") or "").strip()
    if not brand:
        return _err("Falta denominación")
    ok = add_notorious_brand(brand)
    return _ok({"added": ok, "denominacion": brand,
                "total": len(get_notorious_brands())})


@bp.route("/api/marca/notorias/eliminar", methods=["POST"])
def marca_notoria_eliminar():
    """Solo admin: quita una marca de la lista de notorias."""
    err = _require_admin()
    if err is not None:
        return err
    data = request.get_json(silent=True) or {}
    brand = (data.get("denominacion") or "").strip()
    if not brand:
        return _err("Falta denominación")
    ok = remove_notorious_brand(brand)
    return _ok({"removed": ok, "denominacion": brand,
                "total": len(get_notorious_brands())})


@bp.route("/api/marca/notorias/recargar", methods=["POST"])
def marca_notoria_recargar():
    """Solo admin: limpia cache y recarga notorious_brands.txt."""
    err = _require_admin()
    if err is not None:
        return err
    reload_notorious_cache()
    return _ok({"total": len(get_notorious_brands())})


# ─────────────────────────────────────────────────────────────────────
# Tarifas INPI + calculador
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/tarifas", methods=["GET"])
def tarifas_get():
    """Retorna las tarifas vigentes (público)."""
    from services.tarifas import load_tarifas
    return _ok(load_tarifas())


@bp.route("/api/tarifas/calcular", methods=["GET", "POST"])
def tarifas_calcular():
    """Calculador de costos de registro. Acepta ?clases=N o {clases:N}."""
    from services.tarifas import calcular_registro
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        num_clases = int(data.get("clases") or 1)
        incluye_honorarios = bool(data.get("incluye_honorarios", True))
    else:
        num_clases = int(request.args.get("clases") or 1)
        incluye_honorarios = request.args.get("incluye_honorarios", "true").lower() != "false"
    if num_clases < 1 or num_clases > 45:
        return _err("Cantidad de clases debe estar entre 1 y 45")
    return _ok(calcular_registro(num_clases, incluye_honorarios))


@bp.route("/api/marca/precio-informe", methods=["GET"])
def precio_informe():
    """Devuelve el precio del informe completo + descuento si aplica el promo_code.

    Permite que la landing muestre el 'antes/después' sin tener que crear
    la consulta. Acepta ?promo=CODE.
    """
    promo = (request.args.get("promo") or "").strip().upper()
    valid_code = os.getenv("INFORME_PROMO_CODE", "VOLVER10")
    promo_valido = bool(promo) and promo == valid_code
    pct = int(os.getenv("INFORME_RECORDATORIO_DESCUENTO_PCT", "10")) if promo_valido else 0
    precio_final = round(PRECIO_NIVEL_2 * (1 - pct / 100.0))
    return _ok({
        "precio": precio_final,
        "precio_original": PRECIO_NIVEL_2,
        "descuento_pct": pct,
        "promo_valido": promo_valido,
        "promo_code": promo if promo_valido else None,
        "moneda": "ARS",
    })


@bp.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    """Solo admin: dashboard de estadísticas del negocio."""
    err = _require_admin()
    if err is not None:
        return err
    from datetime import datetime, timedelta
    from sqlalchemy import func as _func
    from database import (
        AlertaVigilancia, Consulta, FreeSearchLog, Lead,
        MarcaCliente, Pago, SuscripcionVigilancia, User,
    )

    hoy = datetime.utcnow()
    hace_30 = hoy - timedelta(days=30)
    hace_7 = hoy - timedelta(days=7)

    with get_session() as s:
        # Usuarios
        total_users = s.query(_func.count(User.id)).scalar() or 0
        users_30 = s.query(_func.count(User.id)).filter(User.created_at >= hace_30).scalar() or 0
        users_admin = s.query(_func.count(User.id)).filter(User.is_admin.is_(True)).scalar() or 0

        # Suscripciones activas
        subs_activas = (s.query(_func.count(SuscripcionVigilancia.id))
                        .filter(SuscripcionVigilancia.status == "active")
                        .filter(SuscripcionVigilancia.tipo.in_(
                            ["vigilancia_individual", "vigilancia_multi",
                             "vigilancia_portfolio", "premium"]))
                        .scalar() or 0)
        # MRR estimado
        mrr = (s.query(_func.coalesce(_func.sum(SuscripcionVigilancia.monto), 0))
               .filter(SuscripcionVigilancia.status == "active",
                       SuscripcionVigilancia.plan_freq == "mensual")
               .scalar() or 0)
        arr_anual = (s.query(_func.coalesce(_func.sum(SuscripcionVigilancia.monto), 0))
                     .filter(SuscripcionVigilancia.status == "active",
                             SuscripcionVigilancia.plan_freq == "anual")
                     .scalar() or 0)
        mrr_total = float(mrr) + float(arr_anual) / 12.0

        # Suscripciones por tier
        subs_por_tier_rows = (s.query(SuscripcionVigilancia.tipo,
                                       _func.count(SuscripcionVigilancia.id))
                               .filter(SuscripcionVigilancia.status == "active")
                               .group_by(SuscripcionVigilancia.tipo).all())
        subs_por_tier = {t: c for t, c in subs_por_tier_rows}

        # Búsquedas free
        free_searches_30 = (s.query(_func.count(FreeSearchLog.id))
                            .filter(FreeSearchLog.created_at >= hace_30).scalar() or 0)
        free_searches_7 = (s.query(_func.count(FreeSearchLog.id))
                           .filter(FreeSearchLog.created_at >= hace_7).scalar() or 0)

        # Consultas (Nivel 2) - pagos / no pagos
        consultas_total = s.query(_func.count(Consulta.id)).scalar() or 0
        consultas_pagas = (s.query(_func.count(Consulta.id))
                           .filter(Consulta.paid.is_(True)).scalar() or 0)
        consultas_30 = (s.query(_func.count(Consulta.id))
                        .filter(Consulta.created_at >= hace_30).scalar() or 0)
        consultas_pagas_30 = (s.query(_func.count(Consulta.id))
                              .filter(Consulta.paid.is_(True),
                                      Consulta.created_at >= hace_30).scalar() or 0)

        # Pagos / revenue
        revenue_30 = (s.query(_func.coalesce(_func.sum(Pago.monto), 0))
                      .filter(Pago.status == "approved",
                              Pago.paid_at >= hace_30).scalar() or 0)
        revenue_total = (s.query(_func.coalesce(_func.sum(Pago.monto), 0))
                         .filter(Pago.status == "approved").scalar() or 0)
        pagos_aprobados_30 = (s.query(_func.count(Pago.id))
                              .filter(Pago.status == "approved",
                                      Pago.paid_at >= hace_30).scalar() or 0)

        # Leads
        total_leads = s.query(_func.count(Lead.id)).scalar() or 0
        leads_30 = s.query(_func.count(Lead.id)).filter(Lead.created_at >= hace_30).scalar() or 0
        leads_por_fuente_rows = (s.query(Lead.fuente, _func.count(Lead.id))
                                  .group_by(Lead.fuente).all())
        leads_por_fuente = {f or "(sin)": c for f, c in leads_por_fuente_rows}

        # Marcas tracked + alertas
        marcas_tracked = s.query(_func.count(MarcaCliente.id)).scalar() or 0
        alertas_30 = (s.query(_func.count(AlertaVigilancia.id))
                      .filter(AlertaVigilancia.created_at >= hace_30).scalar() or 0)
        alertas_pendientes = (s.query(_func.count(AlertaVigilancia.id))
                              .filter(AlertaVigilancia.review_status == "pending_review")
                              .scalar() or 0)

        # Top marcas buscadas (free) último mes
        top_marcas_rows = (s.query(FreeSearchLog.marca, _func.count(FreeSearchLog.id).label("n"))
                           .filter(FreeSearchLog.created_at >= hace_30,
                                   FreeSearchLog.marca.is_not(None))
                           .group_by(FreeSearchLog.marca)
                           .order_by(_func.count(FreeSearchLog.id).desc())
                           .limit(15).all())
        top_marcas = [{"marca": m, "veces": int(n)} for m, n in top_marcas_rows]

        # Búsquedas por día últimos 30
        from sqlalchemy import cast, Date
        try:
            por_dia_rows = (s.query(cast(FreeSearchLog.created_at, Date).label("d"),
                                     _func.count(FreeSearchLog.id))
                            .filter(FreeSearchLog.created_at >= hace_30)
                            .group_by("d").order_by("d").all())
            por_dia = [{"fecha": str(d), "n": int(n)} for d, n in por_dia_rows]
        except Exception:
            por_dia = []

        # Últimos leads (lista accionable)
        leads_recientes_rows = (s.query(Lead)
                                 .order_by(Lead.created_at.desc())
                                 .limit(20).all())
        leads_recientes = [{
            "id": l.id, "email": l.email, "marca": l.marca, "fuente": l.fuente,
            "nombre": l.nombre, "telefono": l.telefono,
            "nurtured_step": l.nurtured_step,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        } for l in leads_recientes_rows]

    return _ok({
        "fecha": hoy.isoformat(),
        "usuarios": {
            "total": total_users,
            "ultimos_30_dias": users_30,
            "admins": users_admin,
        },
        "suscripciones": {
            "activas": int(subs_activas),
            "mrr_estimado": round(mrr_total, 2),
            "arr_anual": float(arr_anual),
            "por_tier": subs_por_tier,
        },
        "busquedas_free": {
            "ultimos_7": int(free_searches_7),
            "ultimos_30": int(free_searches_30),
            "por_dia": por_dia,
            "top_marcas": top_marcas,
        },
        "consultas": {
            "total": int(consultas_total),
            "pagas": int(consultas_pagas),
            "conversion_pct": round(100 * consultas_pagas / consultas_total, 1) if consultas_total else 0,
            "ultimos_30_dias": int(consultas_30),
            "pagas_ultimos_30": int(consultas_pagas_30),
        },
        "revenue": {
            "ultimos_30_dias": float(revenue_30),
            "historico_total": float(revenue_total),
            "transacciones_ult_30": int(pagos_aprobados_30),
        },
        "leads": {
            "total": int(total_leads),
            "ultimos_30_dias": int(leads_30),
            "por_fuente": leads_por_fuente,
            "recientes": leads_recientes,
        },
        "marcas": {
            "tracked_por_usuarios": int(marcas_tracked),
            "alertas_ultimos_30": int(alertas_30),
            "alertas_pendientes_review": int(alertas_pendientes),
        },
    })


@bp.route("/api/admin/alertas/pendientes", methods=["GET"])
def admin_alertas_pendientes():
    """Solo admin: lista alertas pendientes de revisión."""
    err = _require_admin()
    if err is not None:
        return err
    from database import AlertaVigilancia, MarcaCliente, User
    out = []
    with get_session() as s:
        rows = (s.query(AlertaVigilancia)
                .filter_by(review_status="pending_review")
                .order_by(AlertaVigilancia.created_at.desc())
                .limit(200).all())
        for a in rows:
            mc = (s.query(MarcaCliente).filter_by(id=a.marca_cliente_id).first()
                  if a.marca_cliente_id else None)
            u = s.query(User).filter_by(id=a.user_id).first()
            out.append({
                "id": a.id,
                "marca_propia": mc.denominacion if mc else None,
                "marca_nueva": a.marca_nueva_denominacion,
                "clase": a.marca_nueva_clase,
                "titular": a.marca_nueva_titular,
                "acta": a.marca_nueva_acta,
                "boletin_num": a.boletin_num,
                "score": round(a.score or 0, 3),
                "nivel": a.nivel,
                "user_email": u.email if u else None,
                "created_at": a.created_at.isoformat(),
            })
    return _ok({"total": len(out), "items": out})


@bp.route("/api/admin/alertas/<int:alerta_id>/aprobar", methods=["POST"])
def admin_alertas_aprobar(alerta_id: int):
    """Solo admin: aprueba una alerta y la envía al cliente."""
    err = _require_admin()
    if err is not None:
        return err
    from database import AlertaVigilancia, MarcaCliente, SuscripcionVigilancia
    user_admin = current_user()
    with get_session() as s:
        a = s.query(AlertaVigilancia).filter_by(id=alerta_id).first()
        if not a:
            return _err("Alerta no encontrada", 404)
        sub = s.query(SuscripcionVigilancia).filter_by(id=a.suscripcion_id).first()
        mp = (s.query(MarcaCliente).filter_by(id=a.marca_cliente_id).first()
              if a.marca_cliente_id else None)

        # Reproducir envío
        sent = False
        try:
            class _Cand:  # objeto mínimo para _enviar_email_alerta
                denominacion = a.marca_nueva_denominacion
                titular = a.marca_nueva_titular
                clase = a.marca_nueva_clase
            from services.vigilancia import _enviar_email_alerta
            if sub and mp:
                sent = _enviar_email_alerta(sub, mp, _Cand(), a.score or 0, a.nivel or "medio")
        except Exception as e:
            logger.warning(f"Error reenviando alerta {alerta_id}: {e}")

        a.review_status = "approved"
        a.reviewed_by = user_admin.id
        a.reviewed_at = datetime.utcnow()
        if sent:
            a.email_sent_at = datetime.utcnow()
        s.commit()
    return _ok({"approved": True, "sent": sent})


@bp.route("/api/admin/alertas/<int:alerta_id>/descartar", methods=["POST"])
def admin_alertas_descartar(alerta_id: int):
    """Solo admin: descarta una alerta sin enviarla al cliente."""
    err = _require_admin()
    if err is not None:
        return err
    from database import AlertaVigilancia
    user_admin = current_user()
    data = request.get_json(silent=True) or {}
    note = (data.get("note") or "").strip() or None
    with get_session() as s:
        a = s.query(AlertaVigilancia).filter_by(id=alerta_id).first()
        if not a:
            return _err("Alerta no encontrada", 404)
        a.review_status = "discarded"
        a.reviewed_by = user_admin.id
        a.reviewed_at = datetime.utcnow()
        a.review_note = note
        s.commit()
    return _ok({"discarded": True})


@bp.route("/api/tarifas", methods=["POST"])
def tarifas_save():
    """Solo admin: actualiza el JSON de tarifas."""
    err = _require_admin()
    if err is not None:
        return err
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _err("Payload inválido")
    from services.tarifas import save_tarifas
    ok = save_tarifas(data)
    if not ok:
        return _err("No pudimos guardar las tarifas", 500)
    return _ok({"saved": True})


# ─────────────────────────────────────────────────────────────────────
# Cotización registro (Nivel 3 — formulario sin pago automático)
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/marca/cotizar-registro", methods=["POST"])
def cotizar_registro():
    """Formulario para solicitar cotización de registro de marca.

    No genera pago automático. Crea un Lead con fuente='cotizar_registro' y
    notifica al equipo legal por email.
    """
    data = request.get_json(silent=True) or {}
    marca = (data.get("marca") or "").strip()
    descripcion = (data.get("descripcion") or "").strip()
    email = (data.get("email") or "").strip().lower()
    nombre = (data.get("nombre") or "").strip()
    telefono = (data.get("telefono") or "").strip()
    clases = data.get("clases") or []

    if not marca or not email or not EMAIL_RE.match(email):
        return _err("Marca y email son requeridos")
    if not nombre or not telefono:
        return _err("Nombre y teléfono son requeridos para coordinar la cotización")

    try:
        clases = [int(c) for c in clases if c]
    except (ValueError, TypeError):
        clases = []

    lead_id = _save_lead(email, marca, descripcion, clases,
                         nombre=nombre, telefono=telefono,
                         fuente="cotizar_registro")

    # Notificar al equipo legal
    try:
        from services.email import send_email, _wrap
        equipo = os.getenv("EQUIPO_LEGAL_EMAIL", "contacto@legalpacers.com")
        body = _wrap(f"""
            <h2>Nueva solicitud de cotización</h2>
            <p><strong>Marca:</strong> {marca}</p>
            <p><strong>Descripción:</strong> {descripcion or '(sin descripción)'}</p>
            <p><strong>Clases:</strong> {clases or '(no especificadas)'}</p>
            <p><strong>Cliente:</strong> {nombre} &lt;{email}&gt;</p>
            <p><strong>Teléfono:</strong> {telefono}</p>
            <p>Lead ID: {lead_id}</p>
        """)
        send_email(equipo, f"[Cotización] {marca} — {nombre}", body)
    except Exception as e:
        logger.warning(f"No se pudo notificar al equipo: {e}")

    return _ok({
        "lead_id": lead_id,
        "mensaje": ("Recibimos tu solicitud. Un abogado te va a contactar en las "
                    "próximas 24 hs hábiles con la cotización personalizada."),
    })
