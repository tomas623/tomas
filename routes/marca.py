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

from flask import Blueprint, jsonify, request
from sqlalchemy import func

from database import Consulta, FreeSearchLog, Lead, Pago, get_session
from services.auth import current_user
from services.domains import check_domains
from services.social import check_handles
from similarity import (
    check_notorious, diagnose, search_similar, NIVEL_ALTO, NIVEL_MEDIO,
)

logger = logging.getLogger(__name__)
bp = Blueprint("marca", __name__)


PRECIO_NIVEL_2 = float(os.getenv("PRECIO_CONSULTA_COMPLETA", "15000"))
PRECIO_VIGILANCIA_MARCA = float(os.getenv("PRECIO_VIGILANCIA_MARCA", "1500"))

# Rate limit Nivel 1 por IP. Suscriptores premium y usuarios autenticados
# pueden saltearlo (lo manejamos en _check_rate_limit).
FREE_SEARCH_LIMIT = int(os.getenv("FREE_SEARCH_LIMIT", "3"))
FREE_SEARCH_WINDOW_HOURS = int(os.getenv("FREE_SEARCH_WINDOW_HOURS", "168"))


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
        return _err("Elegí una clase Niza para la búsqueda gratuita.")

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

    if altos:
        veredicto = "no_disponible"
        mensaje = (f"Encontramos {len(altos)} marca(s) muy similares ya registradas. "
                   "El registro tiene riesgo alto de oposición.")
    elif notorious_warnings and notorious_warnings[0]["score"] >= 0.80:
        veredicto = "no_disponible"
        top = notorious_warnings[0]["denominacion"]
        mensaje = (f"Tu búsqueda es muy similar a <strong>{top}</strong>, una marca notoria. "
                   "Las marcas notorias tienen protección extendida a todas las clases. "
                   "El registro tiene riesgo muy alto de oposición.")
    elif notorious_warnings:
        veredicto = "necesita_analisis"
        top = notorious_warnings[0]["denominacion"]
        mensaje = (f"Tu búsqueda se parece a <strong>{top}</strong>, una marca notoria. "
                   "Conviene revisar bien antes de avanzar — las marcas notorias se protegen "
                   "más allá de su clase original.")
    elif cross_notorios:
        veredicto = "necesita_analisis"
        nombres = ", ".join(sorted({m.denominacion for m in cross_notorios[:3]}))
        mensaje = (f"Encontramos marcas casi idénticas ({nombres}) registradas en otras "
                   f"clases. Si son <strong>marcas notorias</strong>, su protección puede "
                   "extenderse a la clase que querés. Conviene un análisis legal antes.")
    elif medios:
        veredicto = "necesita_analisis"
        mensaje = (f"Hay {len(medios)} marca(s) con cierta similitud. "
                   "Recomendamos un análisis completo antes de avanzar.")
    elif cross_class_matches:
        veredicto = "necesita_analisis"
        mensaje = ("No hay coincidencias en tu clase, pero detectamos marcas similares "
                   "en otras clases. Si alguna es notoria, podría limitar tu registro.")
    else:
        veredicto = "probablemente_disponible"
        if is_full_access:
            mensaje = ("Hicimos el análisis completo de confundibilidad (léxico, fonético, "
                       "conceptual) y no encontramos coincidencias significativas. La marca "
                       "parece registrable en esta clase.")
        else:
            mensaje = ("No encontramos coincidencias evidentes. Aún recomendamos "
                       "un análisis fonético y conceptual completo antes del registro.")

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

    response = {
        "lead_id": lead_id,
        "marca": marca,
        "clases_consultadas": clases,
        "veredicto": veredicto,
        "diagnostico": diag,
        "mensaje": mensaje,
        "stats": {
            "matches_total": len(matches),
            "matches_alto": len(altos),
            "matches_medio": len(medios),
            "identicas": summary_iden,
            "similares_lex": summary_lex,
            "similares_fon": summary_fon,
            "similares_con": summary_con,
            "similares_lex_alto": summary_lex_alto,
            "similares_fon_alto": summary_fon_alto,
            "similares_con_alto": summary_con_alto,
        },
        "dominios": domains,
        "handles": handles,
        "premium": is_full_access,
        "es_notoria": es_notoria,
        "notorious_warnings": notorious_warnings,
    }

    if is_full_access:
        response["matches"] = [m.to_dict() for m in matches]
        response["cross_class_matches"] = [m.to_dict() for m in cross_class_matches]
        # Probabilidad de registro por clase (premium): hacemos una pasada
        # adicional sin filtro de clase para contar matches en cada clase 1..45
        response["por_clase"] = _probabilidad_por_clase(marca, descripcion, clases)
    else:
        response["siguiente_paso"] = {
            "tipo": "consulta_completa",
            "precio": PRECIO_NIVEL_2,
            "moneda": "ARS",
            "descripcion": "Informe completo con análisis fonético, conceptual y "
                           "pre-análisis automático de viabilidad de registro.",
        }

    return _ok(response)


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

        pago = Pago(
            user_id=user_id, email=email,
            tipo="consulta_completa", monto=PRECIO_NIVEL_2,
            moneda="ARS", status="pending",
            metadata_json={"consulta_id": consulta.id, "marca": marca},
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
            email=email, marca=marca, monto=PRECIO_NIVEL_2,
        )
    except Exception as e:
        logger.exception(f"Error creando preferencia MP: {e}")
        pref = None

    return _ok({
        "consulta_id": consulta_id,
        "pago_id": pago_id,
        "monto": PRECIO_NIVEL_2,
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

    prompt = f"""Sos un asistente experto en el sistema de marcas del INPI Argentina.
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
nuestros especialistas para el trámite ante el INPI)

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
