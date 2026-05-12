"""
Envío de alertas por WhatsApp vía Twilio.

Setup (en .env o variables de Railway):
  TWILIO_ACCOUNT_SID=ACxxxxxxxx
  TWILIO_AUTH_TOKEN=xxxx
  TWILIO_WHATSAPP_FROM=whatsapp:+14155238886    # tu número de Twilio (o el sandbox)

Si las variables no están configuradas, send_whatsapp() retorna False sin romper.
Esto permite tener el código en producción listo y activar WhatsApp cuando
quieras pagando el plan de Twilio.

Costos aproximados (al 2026):
  - Sandbox de Twilio: gratis, pero el usuario tiene que mandar un mensaje
    inicial al número del sandbox para autorizar la conversación.
  - Producción: ~USD $0.005 por mensaje WhatsApp, requiere aprobación del
    template por parte de Meta para enviar mensajes no-iniciados-por-el-usuario.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _normalize_phone(phone: Optional[str]) -> Optional[str]:
    """Normaliza un teléfono a E.164 (con + y código de país)."""
    if not phone:
        return None
    digits = re.sub(r"[^\d+]", "", phone.strip())
    if not digits:
        return None
    if digits.startswith("+"):
        return digits
    # Asumimos Argentina si no tiene país (heurística simple)
    if digits.startswith("549"):
        return "+" + digits
    if digits.startswith("54"):
        return "+" + digits
    if digits.startswith("9") and len(digits) >= 11:
        return "+54" + digits
    if len(digits) == 10:  # 11 + 8 dígitos sin el 9 de móvil
        return "+549" + digits
    return "+" + digits


def is_configured() -> bool:
    return bool(os.getenv("TWILIO_ACCOUNT_SID")
                and os.getenv("TWILIO_AUTH_TOKEN")
                and os.getenv("TWILIO_WHATSAPP_FROM"))


def send_whatsapp(to_phone: str, body: str) -> bool:
    """Manda un mensaje WhatsApp. Retorna True si se envió.

    No tira excepciones — solo loguea si falla. La idea es que un problema
    de WhatsApp nunca rompa el envío del email (más confiable).
    """
    if not is_configured():
        logger.debug("Twilio no configurado, skipping WhatsApp.")
        return False

    to = _normalize_phone(to_phone)
    if not to:
        logger.warning(f"No pude normalizar teléfono: {to_phone!r}")
        return False

    sid = os.getenv("TWILIO_ACCOUNT_SID")
    token = os.getenv("TWILIO_AUTH_TOKEN")
    from_ = os.getenv("TWILIO_WHATSAPP_FROM")
    if not from_.startswith("whatsapp:"):
        from_ = "whatsapp:" + from_

    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    try:
        r = httpx.post(
            url,
            auth=(sid, token),
            data={"From": from_, "To": f"whatsapp:{to}", "Body": body[:1500]},
            timeout=10.0,
        )
        if r.status_code >= 400:
            logger.warning(f"Twilio WhatsApp HTTP {r.status_code}: {r.text[:300]}")
            return False
        return True
    except Exception as e:
        logger.warning(f"Twilio WhatsApp error: {e}")
        return False


def notify_alerta(
    *, telefono: str, marca_propia: str, marca_nueva: str, titular: str,
    clase: int, nivel: str, dashboard_url: str,
) -> bool:
    """Construye y manda la alerta de coincidencia detectada en boletín."""
    body = (
        f"⚠️ LegalPacers — alerta de marca similar\n\n"
        f"Marca tuya: *{marca_propia}*\n"
        f"Nueva marca detectada: *{marca_nueva}* (titular {titular}, clase {clase})\n"
        f"Nivel: {nivel.upper()}\n\n"
        f"Tenés 30 días para presentar oposición si corresponde.\n"
        f"Ver detalle: {dashboard_url}"
    )
    return send_whatsapp(telefono, body)


def notify_vencimiento(
    *, telefono: str, marca: str, dias: int, fecha: str, dashboard_url: str,
) -> bool:
    """Aviso de vencimiento de marca (90 / 30 días)."""
    body = (
        f"⏰ LegalPacers — recordatorio\n\n"
        f"Tu marca *{marca}* vence en {dias} días ({fecha}).\n"
        f"Renovala para mantener la protección.\n\n"
        f"Detalle: {dashboard_url}"
    )
    return send_whatsapp(telefono, body)


def notify_dju(
    *, telefono: str, marca: str, dias: int, fecha: str, dashboard_url: str,
) -> bool:
    """Aviso de declaración jurada de uso (5 años)."""
    body = (
        f"📋 LegalPacers — declaración jurada de uso\n\n"
        f"Tu marca *{marca}* requiere DJU en {dias} días ({fecha}).\n"
        f"Sin la DJU podés perder la marca.\n\n"
        f"Detalle: {dashboard_url}"
    )
    return send_whatsapp(telefono, body)
