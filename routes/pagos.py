"""
Rutas de pagos: webhook MP + simulador de checkout para desarrollo.

El webhook está abierto (sin auth) porque MP no firma sus webhooks. Para
prevenir abuso, validamos consultando el recurso a MP por su ID antes de
modificar nuestra DB. Si la consulta a MP falla, no tocamos nada.
"""

from __future__ import annotations

import logging
from datetime import datetime

from flask import Blueprint, jsonify, redirect, render_template_string, request

from database import Pago, Consulta, SuscripcionVigilancia, get_session
from services.mercadopago import handle_webhook, _is_dev_mode

logger = logging.getLogger(__name__)
bp = Blueprint("pagos", __name__)


@bp.route("/api/pagos/webhook", methods=["POST", "GET"])
def webhook():
    """Webhook IPN/v2 de MercadoPago. Devuelve siempre 200 para que MP no reintente."""
    payload = request.get_json(silent=True) or {}
    query = request.args.to_dict()
    logger.info(f"MP webhook recibido — payload={payload} query={query}")

    try:
        result = handle_webhook(payload, query)
    except Exception as e:
        logger.exception(f"Error procesando webhook MP: {e}")
        result = {"ok": False, "error": str(e)}

    # MP necesita un 200 OK; si devolvemos 4xx/5xx, reintenta hasta horas
    return jsonify(result), 200


@bp.route("/api/pagos/<int:pago_id>/status", methods=["GET"])
def consultar_estado(pago_id: int):
    """Endpoint que el frontend pollea para detectar pago aprobado."""
    with get_session() as s:
        p = s.query(Pago).filter_by(id=pago_id).first()
        if not p:
            return jsonify({"ok": False, "error": "Pago no encontrado"}), 404
        return jsonify({
            "ok": True,
            "data": {
                "pago_id": p.id,
                "status": p.status,
                "tipo": p.tipo,
                "monto": p.monto,
                "paid": p.status == "approved",
                "paid_at": p.paid_at.isoformat() if p.paid_at else None,
                "mp_payment_id": p.mp_payment_id,
            },
        })


# ─────────────────────────────────────────────────────────────────────
# Simulador de checkout para desarrollo (sin credenciales MP)
# ─────────────────────────────────────────────────────────────────────

DEV_CHECKOUT = """<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>[DEV] Checkout simulado</title>
<style>
  body{font-family:system-ui,sans-serif;background:#1a1f2e;color:#e2e8f0;margin:0;
       padding:60px 20px;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;color:#0D1B4B;border-radius:14px;padding:40px;max-width:520px;width:100%}
  .badge{background:#FCD34D;color:#78350F;padding:4px 12px;border-radius:20px;font-size:12px;
         font-weight:700;display:inline-block;margin-bottom:16px}
  h1{margin:0 0 8px;font-size:22px}
  .item{background:#F7F9FC;padding:16px;border-radius:8px;margin:20px 0}
  .total{font-size:24px;font-weight:700;color:#1B6EF3;text-align:right;margin-top:16px}
  button{padding:14px 28px;border:none;border-radius:8px;font-size:15px;font-weight:600;
         cursor:pointer;flex:1}
  .approve{background:#16A34A;color:#fff}
  .reject{background:#DC2626;color:#fff}
  .pending{background:#F59E0B;color:#fff}
  .row{display:flex;gap:12px;margin-top:24px}
  .hint{font-size:13px;color:#64748b;margin-top:24px;padding:12px;background:#FEF9C3;border-radius:8px}
</style></head>
<body>
<div class="card">
  <span class="badge">⚠ MODO DEV — sin pago real</span>
  <h1>Checkout simulado</h1>
  <div class="item">
    <div><strong>{{ tipo }}</strong></div>
    <div style="color:#64748b;font-size:14px;margin-top:4px">{{ descripcion }}</div>
    <div class="total">$ {{ '{:,.0f}'.format(monto) }} ARS</div>
  </div>
  <p>Elegí cómo querés que termine el pago para probar el flujo:</p>
  <div class="row">
    <button class="approve" onclick="resolve('approved')">✓ Aprobar</button>
    <button class="pending" onclick="resolve('pending')">⏳ Pendiente</button>
    <button class="reject" onclick="resolve('rejected')">✗ Rechazar</button>
  </div>
  <div class="hint">
    Este simulador solo aparece cuando <code>MP_ACCESS_TOKEN</code> no está configurada.
    En producción, este endpoint redirige a <code>checkout.mercadopago.com.ar</code>.
  </div>
</div>
<script>
async function resolve(status){
  const r = await fetch('/dev/checkout/resolve', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({pago: {{ pago_id|tojson }}, suscripcion: {{ sus_id|tojson }}, status})
  });
  const d = await r.json();
  if(d.ok && d.redirect) window.location.href = d.redirect;
  else alert('Error: ' + (d.error || 'sin detalles'));
}
</script>
</body></html>"""


@bp.route("/dev/checkout", methods=["GET"])
def dev_checkout():
    """Pantalla de checkout simulada. Solo se monta en modo dev."""
    if not _is_dev_mode():
        return jsonify({"ok": False, "error": "Endpoint deshabilitado en producción"}), 403

    pago_id = request.args.get("pago", type=int)
    sus_id = request.args.get("suscripcion", type=int)

    tipo = "Pago"
    descripcion = ""
    monto = 0.0

    if pago_id:
        with get_session() as s:
            p = s.query(Pago).filter_by(id=pago_id).first()
            if p:
                tipo = {"consulta_completa": "Consulta completa de marca",
                        "registro": "Registro de marca",
                        "vigilancia_marca": "Vigilancia mensual",
                        }.get(p.tipo, p.tipo)
                descripcion = (p.metadata_json or {}).get("marca", "") or p.tipo
                monto = p.monto
    elif sus_id:
        with get_session() as s:
            sub = s.query(SuscripcionVigilancia).filter_by(id=sus_id).first()
            if sub:
                tipo = "Suscripción de vigilancia"
                descripcion = f"Vigilancia mensual de marca (suscripción #{sus_id})"
                monto = sub.monto

    return render_template_string(
        DEV_CHECKOUT,
        tipo=tipo, descripcion=descripcion, monto=monto,
        pago_id=pago_id, sus_id=sus_id,
    )


@bp.route("/dev/checkout/resolve", methods=["POST"])
def dev_checkout_resolve():
    """Resuelve el pago simulado y redirige como lo haría MP."""
    if not _is_dev_mode():
        return jsonify({"ok": False, "error": "Solo disponible en modo dev"}), 403

    data = request.get_json(silent=True) or {}
    status = data.get("status", "approved")
    pago_id = data.get("pago")
    sus_id = data.get("suscripcion")

    if pago_id:
        with get_session() as s:
            p = s.query(Pago).filter_by(id=pago_id).first()
            if not p:
                return jsonify({"ok": False, "error": "Pago no encontrado"}), 404
            p.status = status
            p.mp_payment_id = f"DEV-PAY-{pago_id}"
            if status == "approved":
                p.paid_at = datetime.utcnow()
                if p.tipo == "consulta_completa":
                    consulta = (s.query(Consulta)
                                .filter_by(pago_id=p.id).first())
                    if consulta:
                        consulta.paid = True
                        redirect_url = f"/marca/consulta/{consulta.id}?status=success"
                    else:
                        redirect_url = "/dashboard"
                else:
                    redirect_url = "/dashboard"
            else:
                redirect_url = f"/marca/consulta/?status={status}"
            s.commit()
        return jsonify({"ok": True, "redirect": redirect_url})

    if sus_id:
        with get_session() as s:
            sub = s.query(SuscripcionVigilancia).filter_by(id=sus_id).first()
            if not sub:
                return jsonify({"ok": False, "error": "Suscripción no encontrada"}), 404
            sub.status = "active" if status == "approved" else "cancelled"
            if status == "approved":
                sub.activated_at = datetime.utcnow()
            else:
                sub.cancelled_at = datetime.utcnow()
            s.commit()
        return jsonify({"ok": True, "redirect": "/dashboard?tab=vigilancia"})

    return jsonify({"ok": False, "error": "Sin pago ni suscripción"}), 400
