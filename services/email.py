"""
Servicio de email — Resend (preferido) con fallback a SMTP.

Si RESEND_API_KEY está seteada, usa Resend. Si no, cae al SMTP existente
para no romper en entornos donde Resend aún no está configurado.

Las plantillas son HTML inline simples: nada de frameworks, solo strings.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"


def _from_email() -> str:
    return os.getenv("FROM_EMAIL", "noreply@legalpacers.com")


def _from_name() -> str:
    return os.getenv("FROM_NAME", "LegalPacers")


def _send_via_resend(
    to: str, subject: str, html: str, text: Optional[str] = None,
    attachment_bytes: Optional[bytes] = None, filename: Optional[str] = None,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        return False
    payload = {
        "from": f"{_from_name()} <{_from_email()}>",
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    if attachment_bytes and filename:
        import base64
        payload["attachments"] = [{
            "filename": filename,
            "content": base64.b64encode(attachment_bytes).decode("ascii"),
        }]
    try:
        r = httpx.post(
            RESEND_API,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
            timeout=20.0,
        )
        r.raise_for_status()
        logger.info(f"Resend → {to}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Resend error: {e}")
        return False


def _send_via_smtp(
    to: str, subject: str, html: str, text: Optional[str] = None,
    attachment_bytes: Optional[bytes] = None, filename: Optional[str] = None,
) -> bool:
    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        return False
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    from_email = _from_email()

    msg = MIMEMultipart("alternative")
    msg["From"] = f"{_from_name()} <{from_email}>"
    msg["To"] = to
    msg["Subject"] = subject
    if text:
        msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    if attachment_bytes and filename:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(attachment_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={filename}")
        msg.attach(part)

    try:
        if smtp_port == 465:
            with smtplib.SMTP_SSL(smtp_host, smtp_port) as s:
                s.login(smtp_user, smtp_pass)
                s.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port) as s:
                s.starttls()
                s.login(smtp_user, smtp_pass)
                s.send_message(msg)
        logger.info(f"SMTP → {to}: {subject}")
        return True
    except Exception as e:
        logger.error(f"SMTP error: {e}")
        return False


def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    attachment_bytes: Optional[bytes] = None,
    filename: Optional[str] = None,
) -> bool:
    """Envía un email; intenta Resend primero, SMTP como fallback."""
    if _send_via_resend(to, subject, html, text, attachment_bytes, filename):
        return True
    return _send_via_smtp(to, subject, html, text, attachment_bytes, filename)


# ─────────────────────────────────────────────────────────────────────
# Plantillas
# ─────────────────────────────────────────────────────────────────────

BRAND_COLOR = "#0D1B4B"
ACCENT_COLOR = "#1B6EF3"


def _wrap(content_html: str, preheader: str = "") -> str:
    """Layout HTML mínimo con header y footer de LegalPacers."""
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LegalPacers</title></head>
<body style="margin:0;padding:0;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0">{preheader}</span>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f9;padding:32px 12px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <tr><td style="background:{BRAND_COLOR};padding:24px 32px;color:#fff">
        <div style="font-size:18px;font-weight:700;letter-spacing:.5px">LEGAL<span style="color:{ACCENT_COLOR}">PACERS</span></div>
        <div style="font-size:13px;opacity:.85;margin-top:4px">Portal de Marcas — Argentina</div>
      </td></tr>
      <tr><td style="padding:32px">{content_html}</td></tr>
      <tr><td style="background:#f8fafc;padding:20px 32px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">
        <p style="margin:0 0 6px">LegalPacers — Propiedad intelectual y registro de marcas en Argentina.</p>
        <p style="margin:0">¿Dudas? Escribinos a <a href="mailto:contacto@legalpacers.com" style="color:{ACCENT_COLOR}">contacto@legalpacers.com</a> o por <a href="https://wa.me/5491128774200" style="color:{ACCENT_COLOR}">WhatsApp</a>.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def template_magic_link(magic_url: str, expires_min: int = 15) -> tuple[str, str, str]:
    """Email de magic link. Devuelve (subject, html, text)."""
    subject = "Tu enlace para entrar al portal"
    html = _wrap(f"""
        <h2 style="color:{BRAND_COLOR};margin:0 0 16px">Ingresá a tu cuenta</h2>
        <p>Hacé click en el botón de abajo para ingresar al portal sin contraseña.
           Este enlace es de un solo uso y expira en {expires_min} minutos.</p>
        <p style="margin:32px 0">
          <a href="{magic_url}" style="background:{ACCENT_COLOR};color:#fff;text-decoration:none;
             padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Ingresar al portal</a>
        </p>
        <p style="font-size:13px;color:#64748b">O pegá este enlace en tu navegador:<br>
           <span style="word-break:break-all">{magic_url}</span></p>
        <p style="font-size:13px;color:#64748b;margin-top:24px">
          Si no pediste este acceso, podés ignorar este mensaje.</p>
    """, "Tu enlace de acceso a LegalPacers")
    text = f"Ingresá a LegalPacers con este enlace (válido {expires_min} minutos):\n{magic_url}"
    return subject, html, text


def template_pago_confirmado(marca: str, monto: float, informe_url: str) -> tuple[str, str, str]:
    subject = f"Pago confirmado — Informe de \"{marca}\" listo"
    html = _wrap(f"""
        <h2 style="color:{BRAND_COLOR};margin:0 0 16px">¡Recibimos tu pago!</h2>
        <p>Tu informe completo de viabilidad para la marca
           <strong>"{marca}"</strong> ya está disponible.</p>
        <p>Monto: <strong>${monto:,.0f} ARS</strong></p>
        <p style="margin:28px 0">
          <a href="{informe_url}" style="background:{ACCENT_COLOR};color:#fff;text-decoration:none;
             padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Ver informe</a>
        </p>
        <p>El informe incluye coincidencias en toda la base del INPI con análisis ortográfico,
           fonético y conceptual, además del pre-análisis de viabilidad escrito por nuestro equipo.</p>
    """, f"Tu informe de \"{marca}\" está listo")
    text = f"Pago confirmado. Ver informe: {informe_url}"
    return subject, html, text


def template_alerta_vigilancia(
    marca_propia: str, marca_nueva: str, titular: str, clase: int,
    nivel: str, dashboard_url: str,
) -> tuple[str, str, str]:
    color = "#DC2626" if nivel == "alto" else "#D97706" if nivel == "medio" else "#0EA5E9"
    subject = f"Alerta de vigilancia — Nueva marca similar a \"{marca_propia}\""
    html = _wrap(f"""
        <h2 style="color:{BRAND_COLOR};margin:0 0 8px">Detectamos una marca similar</h2>
        <p style="color:#64748b;margin:0 0 24px">Sobre tu marca registrada <strong>"{marca_propia}"</strong></p>
        <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b">Marca nueva</td>
              <td style="padding:8px 0;text-align:right;font-weight:600">{marca_nueva}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b">Titular</td>
              <td style="padding:8px 0;text-align:right">{titular or '—'}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b">Clase INPI</td>
              <td style="padding:8px 0;text-align:right">{clase}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b">Nivel de similitud</td>
              <td style="padding:8px 0;text-align:right;color:{color};font-weight:700;text-transform:uppercase">{nivel}</td></tr>
        </table>
        <p style="margin:0 0 24px">Tenés 30 días desde la publicación para presentar oposición ante el INPI.
           Coordiná con un abogado para evaluar el caso.</p>
        <p style="margin:0 0 12px">
          <a href="{dashboard_url}" style="background:{ACCENT_COLOR};color:#fff;text-decoration:none;
             padding:14px 24px;border-radius:8px;font-weight:600;display:inline-block;margin-right:8px">Ver detalle</a>
          <a href="https://wa.me/5491128774200?text=Hola%20LegalPacers%2C%20quiero%20consultar%20por%20una%20alerta%20de%20vigilancia%20sobre%20mi%20marca%20%22{marca_propia}%22" style="background:#25D366;color:#fff;text-decoration:none;
             padding:14px 24px;border-radius:8px;font-weight:600;display:inline-block">Hablar con un abogado</a>
        </p>
    """, f"Marca similar detectada: {marca_nueva}")
    text = (f"Detectamos una marca similar a tu marca registrada {marca_propia}.\n"
            f"Marca nueva: {marca_nueva} (titular: {titular}, clase {clase}). Nivel: {nivel}.\n"
            f"Ver detalle: {dashboard_url}")
    return subject, html, text


def template_vencimiento_marca(
    marca: str, fecha_vencimiento: str, dias_restantes: int, dashboard_url: str,
) -> tuple[str, str, str]:
    urgencia = "URGENTE" if dias_restantes <= 30 else "Importante"
    subject = f"{urgencia} — Tu marca \"{marca}\" vence en {dias_restantes} días"
    html = _wrap(f"""
        <h2 style="color:{BRAND_COLOR};margin:0 0 16px">Tu marca está por vencer</h2>
        <p>La marca <strong>"{marca}"</strong> vence el <strong>{fecha_vencimiento}</strong>
           ({dias_restantes} días).</p>
        <p>En Argentina las marcas se renuevan por períodos de 10 años. Iniciá la renovación
           con anticipación para evitar pérdida de derechos.</p>
        <p style="margin:28px 0">
          <a href="{dashboard_url}" style="background:{ACCENT_COLOR};color:#fff;text-decoration:none;
             padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Coordinar renovación</a>
        </p>
    """, f"Renová \"{marca}\" antes de {fecha_vencimiento}")
    text = f"Tu marca \"{marca}\" vence el {fecha_vencimiento} ({dias_restantes} días). {dashboard_url}"
    return subject, html, text


def template_lead_nurturing(step: int, marca: str, search_url: str) -> tuple[str, str, str]:
    """Secuencia de 3 emails post consulta gratuita."""
    if step == 1:
        # Día 1 — refuerzo del valor de registrar
        subject = f"3 razones para registrar \"{marca}\" en el INPI"
        body = f"""
            <h2 style="color:{BRAND_COLOR};margin:0 0 16px">¿Por qué registrar tu marca?</h2>
            <p>Hace poco hiciste una consulta sobre <strong>"{marca}"</strong>. Estos son los 3 motivos
               principales por los que la mayoría de nuestros clientes terminan registrándola:</p>
            <ol>
              <li style="margin-bottom:8px"><strong>Exclusividad legal:</strong> impedís que otros usen tu marca en tu rubro.</li>
              <li style="margin-bottom:8px"><strong>Valor patrimonial:</strong> una marca registrada se vende, se licencia, se hereda.</li>
              <li style="margin-bottom:8px"><strong>Defensa real:</strong> sin registro, demostrar uso anterior es caro y lento.</li>
            </ol>
            <p style="margin:28px 0">
              <a href="{search_url}" style="background:{ACCENT_COLOR};color:#fff;text-decoration:none;
                 padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Hacer un análisis completo</a>
            </p>
        """
    elif step == 2:
        # Día 4 — testimonios / prueba social y FAQ corto
        subject = f"¿Cuánto tarda registrar \"{marca}\"?"
        body = f"""
            <h2 style="color:{BRAND_COLOR};margin:0 0 16px">Plazos y costos reales en Argentina</h2>
            <p>Te dejamos la información concreta sobre el registro de marcas en INPI:</p>
            <ul>
              <li><strong>Plazo:</strong> 18-24 meses si no hay oposiciones (las hay rara vez).</li>
              <li><strong>Vigencia:</strong> 10 años, renovables indefinidamente.</li>
              <li><strong>Costos del INPI:</strong> los abona el cliente directamente (no van a través de nosotros).</li>
              <li><strong>Honorarios profesionales:</strong> los cotizamos según el caso.</li>
            </ul>
            <p>Si querés avanzar, solicitá una cotización para "{marca}":</p>
            <p style="margin:28px 0">
              <a href="{search_url}" style="background:{ACCENT_COLOR};color:#fff;text-decoration:none;
                 padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Solicitar cotización</a>
            </p>
        """
    else:
        # Día 10 — última nudge con beneficio + WhatsApp
        subject = f"Tu marca \"{marca}\" puede estar en riesgo"
        body = f"""
            <h2 style="color:{BRAND_COLOR};margin:0 0 16px">Cada semana se publican marcas nuevas</h2>
            <p>El INPI publica un boletín nuevo cada miércoles. Si alguien registra
               <strong>"{marca}"</strong> antes que vos, tu derecho posterior se debilita.</p>
            <p>Charlar con un abogado de LegalPacers no tiene costo:</p>
            <p style="margin:28px 0">
              <a href="https://wa.me/5491128774200?text=Hola%2C%20quiero%20avanzar%20con%20el%20registro%20de%20%22{marca}%22" style="background:#25D366;color:#fff;text-decoration:none;
                 padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Hablar por WhatsApp</a>
            </p>
        """
    html = _wrap(body, subject)
    text = f"{subject}\n\n{search_url}"
    return subject, html, text
