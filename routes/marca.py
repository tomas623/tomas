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
from datetime import datetime
from typing import Optional

from flask import Blueprint, jsonify, request

from database import Consulta, Lead, Pago, get_session
from services.auth import current_user
from services.domains import check_domains
from similarity import diagnose, search_similar, NIVEL_ALTO, NIVEL_MEDIO

logger = logging.getLogger(__name__)
bp = Blueprint("marca", __name__)


PRECIO_NIVEL_2 = float(os.getenv("PRECIO_CONSULTA_COMPLETA", "25000"))
PRECIO_VIGILANCIA_MARCA = float(os.getenv("PRECIO_VIGILANCIA_MARCA", "20000"))

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


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

    if not marca:
        return _err("El nombre de la marca es requerido")
    if not email or not EMAIL_RE.match(email):
        return _err("Email inválido")

    # Normalizar clases a int
    try:
        clases = [int(c) for c in clases if c]
    except (ValueError, TypeError):
        clases = []

    # Persistir lead siempre
    lead_id = _save_lead(email, marca, descripcion, clases,
                         nombre=nombre, telefono=telefono)

    # Búsqueda liviana: sin IA, top 5
    matches = search_similar(
        marca=marca, descripcion=descripcion,
        clases=clases or None, limit=5, use_ai=False,
        min_score=0.45,
    )

    altos = [m for m in matches if m.nivel == "alto"]
    medios = [m for m in matches if m.nivel == "medio"]

    if altos:
        veredicto = "no_disponible"
        mensaje = (f"Encontramos {len(altos)} marca(s) muy similares ya registradas. "
                   "El registro tiene riesgo alto de oposición.")
    elif medios:
        veredicto = "necesita_analisis"
        mensaje = (f"Hay {len(medios)} marca(s) con cierta similitud. "
                   "Recomendamos un análisis completo antes de avanzar.")
    else:
        veredicto = "probablemente_disponible"
        mensaje = ("No encontramos coincidencias evidentes. Aún recomendamos "
                   "un análisis fonético y conceptual completo antes del registro.")

    diag = diagnose(matches)

    # Chequeo de dominio rápido (informativo)
    domains = [d.to_dict() for d in check_domains(marca)]

    return _ok({
        "lead_id": lead_id,
        "marca": marca,
        "veredicto": veredicto,
        "diagnostico": diag,
        "mensaje": mensaje,
        "stats": {
            "matches_total": len(matches),
            "matches_alto": len(altos),
            "matches_medio": len(medios),
        },
        "dominios": domains,
        "siguiente_paso": {
            "tipo": "consulta_completa",
            "precio": PRECIO_NIVEL_2,
            "moneda": "ARS",
            "descripcion": "Informe completo con análisis fonético, conceptual y "
                           "pre-análisis legal de viabilidad firmado por nuestro equipo.",
        },
    })


# ─────────────────────────────────────────────────────────────────────
# Nivel 2 — paga
# ─────────────────────────────────────────────────────────────────────

@bp.route("/api/marca/consulta/iniciar", methods=["POST"])
def nivel_2_iniciar():
    """Crea una Consulta paga y un Pago en estado pending. Devuelve checkout URL."""
    data = request.get_json(silent=True) or {}
    marca = (data.get("marca") or "").strip()
    descripcion = (data.get("descripcion") or "").strip()
    email = (data.get("email") or "").strip().lower()
    clases = data.get("clases") or []

    if not marca:
        return _err("El nombre de la marca es requerido")
    if not email or not EMAIL_RE.match(email):
        return _err("Email inválido")

    try:
        clases = [int(c) for c in clases if c]
    except (ValueError, TypeError):
        clases = []

    user = current_user()
    user_id = user.id if user else None

    # Persistir consulta + pago (pending)
    with get_session() as s:
        consulta = Consulta(
            user_id=user_id, email=email, marca=marca,
            descripcion=descripcion, clases=clases,
            nivel="completa", paid=False,
        )
        s.add(consulta)
        s.flush()  # obtener consulta.id

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
        is_admin = (user and user.is_admin)
        if not is_owner and not is_admin:
            # Permitir ver preview limitado por consulta_id (público con ID conocido).
            # Ese ID viaja en la URL solo a quien inició la consulta.
            pass

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


def _analisis_legal(consulta: Consulta, matches: list) -> str:
    """Genera el pre-análisis legal con Claude (texto formateado en markdown)."""
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

    prompt = f"""Sos abogado especialista en marcas en Argentina (INPI).

Marca consultada: "{consulta.marca}"
Descripción del producto/servicio: {consulta.descripcion or '(sin descripción)'}
Clases solicitadas: {consulta.clases or 'no especificadas'}

Coincidencias relevantes detectadas:
{chr(10).join(contexto) if contexto else '(ninguna coincidencia significativa)'}

Escribí un pre-análisis legal de viabilidad de registro, en español neutro,
estructurado en estas secciones (usá Markdown con headers):

## Resumen ejecutivo
(2-3 oraciones con la recomendación general)

## Análisis de coincidencias
(comentá las más relevantes y por qué importan)

## Riesgos identificados
(clase, similitud fonética/conceptual, oposiciones probables)

## Recomendación
(viable / viable con ajustes / riesgo alto — y qué ajustes sugerirías)

## Próximos pasos
(qué hacer con LegalPacers — registrar, modificar, vigilar)

Sé concreto, profesional y conciso. No más de 400 palabras."""

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
