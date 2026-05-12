"""
Integración con MercadoPago — Checkout Pro y Subscriptions (preapproval).

Un solo entrypoint por flujo:
- create_consulta_preference()      → Checkout Pro pago único (Nivel 2 / registro)
- create_vigilancia_subscription()  → Suscripción mensual recurrente (Nivel 4)
- handle_webhook()                  → Procesa la notificación de MP

Toggles:
  MP_ACCESS_TOKEN                  ← TEST-... o APP_USR-... según el ambiente
  MP_SANDBOX="true"|"false"        ← solo cosmético; el token define el ambiente real
  APP_BASE_URL="https://..."        ← base para back_urls / notification_url

Si MP_ACCESS_TOKEN no está seteada, las funciones devuelven un init_point falso
(/checkout/dev/<id>) que el frontend puede usar para simular el flujo en desarrollo
sin generar costos. Esto permite probar todo el flow extremo-a-extremo sin
credenciales reales.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy import del SDK
_sdk = None


def _get_sdk():
    """Devuelve un cliente mercadopago.SDK o None si no hay token."""
    global _sdk
    token = os.getenv("MP_ACCESS_TOKEN")
    if not token:
        return None
    if _sdk is not None:
        return _sdk
    try:
        import mercadopago  # type: ignore
        _sdk = mercadopago.SDK(token)
        return _sdk
    except ImportError:
        logger.error("Paquete `mercadopago` no instalado. Instalá con `pip install mercadopago`.")
        return None
    except Exception as e:
        logger.error(f"No se pudo inicializar MP SDK: {e}")
        return None


def _base_url(req_host: Optional[str] = None) -> str:
    return (os.getenv("APP_BASE_URL") or req_host or "http://localhost:5000").rstrip("/")


def _is_dev_mode() -> bool:
    """True cuando no hay credenciales o se forzó el modo dev."""
    return not os.getenv("MP_ACCESS_TOKEN") or os.getenv("MP_DEV_MODE", "").lower() == "true"


# ─────────────────────────────────────────────────────────────────────
# Checkout Pro — pagos únicos (Nivel 2 paga)
# ─────────────────────────────────────────────────────────────────────

def create_consulta_preference(
    pago_id: int, consulta_id: int, email: str, marca: str, monto: float,
    request_host: Optional[str] = None,
) -> dict:
    """Crea una preferencia para Checkout Pro y retorna {id, init_point}."""
    base = _base_url(request_host)
    success_url = f"{base}/marca/consulta/{consulta_id}?status=success"
    failure_url = f"{base}/marca/consulta/{consulta_id}?status=failure"
    pending_url = f"{base}/marca/consulta/{consulta_id}?status=pending"
    webhook_url = f"{base}/api/pagos/webhook"

    if _is_dev_mode():
        logger.info(f"[MP DEV] Preferencia simulada para pago {pago_id} ({marca})")
        return {
            "id": f"DEV-{pago_id}",
            "init_point": f"{base}/dev/checkout?pago={pago_id}",
            "sandbox_init_point": f"{base}/dev/checkout?pago={pago_id}",
            "dev": True,
        }

    sdk = _get_sdk()
    if not sdk:
        return {"id": None, "init_point": None, "error": "MP no configurado"}

    payload = {
        "items": [{
            "id": f"consulta-{consulta_id}",
            "title": f"Análisis completo de marca: {marca}",
            "description": "Informe LegalPacers con coincidencias INPI + pre-análisis legal",
            "category_id": "services",
            "quantity": 1,
            "currency_id": "ARS",
            "unit_price": float(monto),
        }],
        "payer": {"email": email},
        "external_reference": f"pago:{pago_id}",
        "notification_url": webhook_url,
        "back_urls": {
            "success": success_url,
            "failure": failure_url,
            "pending": pending_url,
        },
        "auto_return": "approved",
        "metadata": {"pago_id": pago_id, "consulta_id": consulta_id, "marca": marca},
        "statement_descriptor": "LEGALPACERS",
    }

    try:
        result = sdk.preference().create(payload)
        if result.get("status") not in (200, 201):
            logger.error(f"MP preference create no-OK: {result}")
            return {"id": None, "init_point": None, "error": "MP error"}
        resp = result["response"]

        # Persistir el preference_id en el Pago
        from database import Pago, get_session
        with get_session() as s:
            p = s.query(Pago).filter_by(id=pago_id).first()
            if p:
                p.mp_preference_id = resp["id"]
                s.commit()

        return {
            "id": resp["id"],
            "init_point": resp.get("init_point"),
            "sandbox_init_point": resp.get("sandbox_init_point"),
        }
    except Exception as e:
        logger.exception(f"Error creando preferencia MP: {e}")
        return {"id": None, "init_point": None, "error": str(e)}


# ─────────────────────────────────────────────────────────────────────
# Subscriptions (preapproval) — Nivel 4 vigilancia mensual
# ─────────────────────────────────────────────────────────────────────

def create_vigilancia_subscription(
    suscripcion_id: int, email: str, monto: float,
    descripcion: str, request_host: Optional[str] = None,
) -> dict:
    """Crea una preapproval mensual y retorna {id, init_point}.

    En Argentina MP llama a esto "Suscripción sin plan asociado". El cliente la
    autoriza una vez en Checkout y MP cobra automáticamente cada mes hasta que
    el cliente o nosotros la cancelemos.
    """
    base = _base_url(request_host)

    if _is_dev_mode():
        logger.info(f"[MP DEV] Suscripción simulada {suscripcion_id} (${monto}/mes)")
        return {
            "id": f"DEV-SUB-{suscripcion_id}",
            "init_point": f"{base}/dev/checkout?suscripcion={suscripcion_id}",
            "dev": True,
        }

    sdk = _get_sdk()
    if not sdk:
        return {"id": None, "init_point": None, "error": "MP no configurado"}

    payload = {
        "reason": descripcion[:200],
        "external_reference": f"suscripcion:{suscripcion_id}",
        "payer_email": email,
        "back_url": f"{base}/dashboard?tab=vigilancia",
        "auto_recurring": {
            "frequency": 1,
            "frequency_type": "months",
            "transaction_amount": float(monto),
            "currency_id": "ARS",
        },
        "status": "pending",
    }

    try:
        result = sdk.preapproval().create(payload)
        if result.get("status") not in (200, 201):
            logger.error(f"MP preapproval create no-OK: {result}")
            return {"id": None, "init_point": None, "error": "MP error"}
        resp = result["response"]

        from database import SuscripcionVigilancia, get_session
        with get_session() as s:
            sub = s.query(SuscripcionVigilancia).filter_by(id=suscripcion_id).first()
            if sub:
                sub.mp_subscription_id = resp["id"]
                s.commit()

        return {
            "id": resp["id"],
            "init_point": resp.get("init_point"),
        }
    except Exception as e:
        logger.exception(f"Error creando suscripción MP: {e}")
        return {"id": None, "init_point": None, "error": str(e)}


def cancel_subscription(mp_subscription_id: str) -> bool:
    """Cancela una suscripción activa. Retorna True si MP confirmó la baja."""
    if _is_dev_mode() or mp_subscription_id.startswith("DEV-"):
        return True
    sdk = _get_sdk()
    if not sdk:
        return False
    try:
        result = sdk.preapproval().update(mp_subscription_id, {"status": "cancelled"})
        return result.get("status") in (200, 201)
    except Exception as e:
        logger.error(f"Error cancelando suscripción: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────
# Webhook handler
# ─────────────────────────────────────────────────────────────────────

def handle_webhook(payload: dict, query: dict) -> dict:
    """Procesa una notificación IPN/webhook de MP.

    MP envía dos formatos:
      1. ?topic=payment&id=12345                       (IPN clásico)
      2. {"action": "payment.updated", "data": {"id": ...}}    (webhook v2)

    Para cada notificación, consultamos el recurso completo y actualizamos el Pago.
    """
    sdk = _get_sdk()
    notif_type = (
        payload.get("type") or query.get("type")
        or query.get("topic") or payload.get("topic")
    )
    resource_id = (
        (payload.get("data") or {}).get("id")
        or query.get("id") or payload.get("id")
    )

    if not resource_id:
        return {"ok": False, "error": "missing_resource_id"}

    if notif_type in ("payment", "payment.updated", "payment.created"):
        return _process_payment_update(sdk, str(resource_id))
    if notif_type in ("preapproval", "preapproval.updated", "subscription_preapproval"):
        return _process_preapproval_update(sdk, str(resource_id))
    if notif_type in ("authorized_payment", "subscription_authorized_payment"):
        return _process_recurring_payment(sdk, str(resource_id))

    logger.info(f"Webhook MP ignorado: type={notif_type} id={resource_id}")
    return {"ok": True, "ignored": True}


def _process_payment_update(sdk, payment_id: str) -> dict:
    """Actualiza el Pago correspondiente con el estado real consultado a MP."""
    from database import Pago, Consulta, get_session
    from services.email import send_email, template_pago_confirmado

    if not sdk:
        return {"ok": False, "error": "no_sdk"}

    try:
        result = sdk.payment().get(payment_id)
    except Exception as e:
        logger.error(f"Error consultando payment {payment_id}: {e}")
        return {"ok": False, "error": "mp_lookup_failed"}

    if result.get("status") not in (200, 201):
        return {"ok": False, "error": f"mp_status_{result.get('status')}"}

    p = result["response"]
    status = p.get("status")              # approved / pending / rejected
    ext_ref = p.get("external_reference") or ""

    pago_id = None
    if ext_ref.startswith("pago:"):
        try:
            pago_id = int(ext_ref.split(":", 1)[1])
        except ValueError:
            pago_id = None

    with get_session() as s:
        pago = None
        if pago_id:
            pago = s.query(Pago).filter_by(id=pago_id).first()
        if not pago:
            pago = s.query(Pago).filter_by(mp_payment_id=str(payment_id)).first()
        if not pago:
            logger.warning(f"Webhook MP: pago no encontrado (id={payment_id}, ext={ext_ref})")
            return {"ok": True, "no_match": True}

        pago.mp_payment_id = str(payment_id)
        pago.status = status or pago.status
        if status == "approved" and not pago.paid_at:
            pago.paid_at = datetime.utcnow()

            # Marcar Consulta como pagada y disparar generación
            if pago.tipo == "consulta_completa":
                consulta = (s.query(Consulta)
                            .filter_by(pago_id=pago.id).first())
                if consulta and not consulta.paid:
                    consulta.paid = True

                    # Email de confirmación con link al informe
                    try:
                        base = os.getenv("APP_BASE_URL", "")
                        url = f"{base}/marca/consulta/{consulta.id}"
                        subject, html, text = template_pago_confirmado(
                            consulta.marca, pago.monto, url,
                        )
                        send_email(pago.email, subject, html, text=text)
                    except Exception as e:
                        logger.warning(f"No se pudo notificar pago confirmado: {e}")

        s.commit()

    return {"ok": True, "status": status, "pago_id": pago.id if pago else None}


def _process_preapproval_update(sdk, preapproval_id: str) -> dict:
    """Actualiza una SuscripcionVigilancia con el estado real."""
    from database import SuscripcionVigilancia, get_session

    if not sdk:
        return {"ok": False, "error": "no_sdk"}

    try:
        result = sdk.preapproval().get(preapproval_id)
    except Exception as e:
        logger.error(f"Error consultando preapproval {preapproval_id}: {e}")
        return {"ok": False, "error": "mp_lookup_failed"}

    if result.get("status") not in (200, 201):
        return {"ok": False, "error": f"mp_status_{result.get('status')}"}

    p = result["response"]
    mp_status = p.get("status")    # authorized / paused / cancelled / pending
    map_status = {
        "authorized": "active", "paused": "paused", "cancelled": "cancelled",
        "pending": "active", "expired": "cancelled",
    }
    nuevo_status = map_status.get(mp_status, mp_status)

    sent_credentials = False
    paused_covered = 0
    with get_session() as s:
        sub = (s.query(SuscripcionVigilancia)
               .filter_by(mp_subscription_id=str(preapproval_id)).first())
        if not sub:
            return {"ok": True, "no_match": True}
        previous_status = sub.status
        sub.status = nuevo_status
        if nuevo_status == "paused":
            sub.paused_at = datetime.utcnow()
        if nuevo_status == "cancelled":
            sub.cancelled_at = datetime.utcnow()
        # Si recién se activa una premium con credenciales pendientes, mandamos email
        if (nuevo_status == "active" and sub.tipo == "premium"
                and previous_status != "active"
                and (sub.metadata_json or {}).get("pending_password")):
            try:
                from database import User
                user = s.query(User).filter_by(id=sub.user_id).first()
                if user:
                    _send_premium_welcome(user, sub.metadata_json["pending_password"])
                    sent_credentials = True
                    md = dict(sub.metadata_json or {})
                    md.pop("pending_password", None)
                    md["credentials_sent_at"] = datetime.utcnow().isoformat()
                    sub.metadata_json = md
            except Exception as e:
                logger.exception(f"No se pudo mandar credenciales premium {sub.id}: {e}")
        # Si cancelan/pausan la Premium, pausamos también todas las vigilancias
        # que estaban cubiertas por ese plan (monto=0, covered_by=premium).
        if (sub.tipo == "premium" and nuevo_status in ("cancelled", "paused")
                and previous_status == "active"):
            covered = (s.query(SuscripcionVigilancia)
                       .filter_by(user_id=sub.user_id, status="active")
                       .filter(SuscripcionVigilancia.id != sub.id).all())
            for v in covered:
                md = v.metadata_json or {}
                if md.get("covered_by") == "premium":
                    v.status = "paused"
                    v.paused_at = datetime.utcnow()
                    paused_covered += 1
        s.commit()

    return {"ok": True, "status": nuevo_status,
            "credentials_sent": sent_credentials,
            "paused_covered": paused_covered}


def _send_premium_welcome(user, password: str) -> None:
    """Manda el email de bienvenida Premium con credenciales temporales."""
    from services.email import send_email, _wrap
    base = os.getenv("PUBLIC_BASE_URL", "").rstrip("/") or ""
    login_url = f"{base}/login" if base else "/login"

    html = _wrap(f"""
        <h2 style="color:#1B6EF3;margin:0 0 16px">¡Bienvenido a LegalPacers Premium!</h2>
        <p>Tu suscripción está activa. Estos son tus datos para entrar al panel:</p>
        <div style="background:#F4F5F9;border-radius:10px;padding:18px;margin:18px 0;
                    font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px">
          <strong>Usuario:</strong> {user.email}<br>
          <strong>Contraseña:</strong> {password}
        </div>
        <p>
          <a href="{login_url}" style="background:#1B6EF3;color:#fff;text-decoration:none;
             padding:14px 28px;border-radius:10px;font-weight:600;display:inline-block">
            Acceder al panel
          </a>
        </p>
        <p style="color:#64748b;font-size:14px;margin-top:24px">
          Te recomendamos cambiar la contraseña apenas entres, desde tu panel.
          Si necesitás ayuda, escribinos por WhatsApp.
        </p>
    """, "Tu cuenta Premium ya está activa")

    text = (f"Bienvenido a LegalPacers Premium.\n\n"
            f"Usuario: {user.email}\nContraseña: {password}\n\n"
            f"Accedé al panel: {login_url}")

    send_email(user.email, "Tu cuenta Premium en LegalPacers ya está activa",
               html, text=text)


def _process_recurring_payment(sdk, authorized_payment_id: str) -> dict:
    """Registra un pago recurrente cobrado por una suscripción."""
    from database import Pago, SuscripcionVigilancia, get_session

    if not sdk:
        return {"ok": False, "error": "no_sdk"}

    try:
        result = sdk.authorized_payment().get(authorized_payment_id)
    except Exception as e:
        logger.error(f"Error consultando authorized_payment: {e}")
        return {"ok": False, "error": "mp_lookup_failed"}

    if result.get("status") not in (200, 201):
        return {"ok": False, "error": f"mp_status_{result.get('status')}"}

    ap = result["response"]
    mp_sub_id = ap.get("preapproval_id")
    monto = float(ap.get("transaction_amount") or 0)
    status = ap.get("status")

    with get_session() as s:
        sub = (s.query(SuscripcionVigilancia)
               .filter_by(mp_subscription_id=str(mp_sub_id)).first())
        if not sub:
            return {"ok": True, "no_match": True}

        pago = Pago(
            user_id=sub.user_id, email=None,
            tipo=("vigilancia_marca" if sub.tipo == "marca" else "vigilancia_portfolio"),
            monto=monto, moneda="ARS",
            mp_payment_id=str(ap.get("id")),
            mp_subscription_id=str(mp_sub_id),
            status=status,
            paid_at=datetime.utcnow() if status == "approved" else None,
            metadata_json={"suscripcion_id": sub.id, "authorized_payment": True},
        )
        s.add(pago)
        s.commit()

    return {"ok": True, "status": status}
