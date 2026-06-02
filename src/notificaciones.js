// Envío de alertas por mail (Resend) y WhatsApp (Cloud API). Modo STUB cuando
// faltan credenciales: loguea y deja registro en `notificaciones` con estado
// 'enviada_stub' (BUILD_SPEC_MOTOR.md §5).

const db = require('./db');
const audit = require('./audit');

function registrar(alertaId, canal, estado, { proveedor_id, error } = {}) {
  db.prepare(`
    INSERT INTO notificaciones (alerta_id, canal, estado, proveedor_id, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(alertaId, canal, estado, proveedor_id || null, error || null);
}

async function enviarMail({ alertaId, to, marca, nivel, fundamento, panel_url }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.MAIL_FROM || 'alertas@legalpacers.com').trim();

  const subject = `🚨 Posible coincidencia con tu marca "${marca}" (riesgo ${nivel})`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="color:#1b6ef3">LegalPacers · Alerta de marca</h2>
      <p>Detectamos una posible coincidencia con tu marca <strong>${marca}</strong>.</p>
      <p><strong>Nivel de riesgo:</strong> ${nivel}</p>
      <p>${fundamento}</p>
      <p><a href="${panel_url}" style="background:#1b6ef3;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Ver en mi portal</a></p>
      <hr><p style="font-size:12px;color:#64748b">Si no querés recibir más mails, respondé este mensaje.</p>
    </div>`;

  if (!apiKey) {
    console.log(`[mail/STUB] → ${to} · ${subject}`);
    registrar(alertaId, 'mail', 'enviada_stub');
    return { ok: true, stub: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      registrar(alertaId, 'mail', 'error', { error: `HTTP ${res.status}: ${txt.slice(0, 200)}` });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    registrar(alertaId, 'mail', 'enviada', { proveedor_id: data.id });
    return { ok: true, id: data.id };
  } catch (err) {
    registrar(alertaId, 'mail', 'error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

async function enviarWhatsApp({ alertaId, to, marca, nivel, panel_url }) {
  const token = (process.env.WA_TOKEN || '').trim();
  const phoneId = (process.env.WA_PHONE_NUMBER_ID || '').trim();
  const template = (process.env.WA_TEMPLATE_ALERTA || 'alerta_marca').trim();

  if (!to) { registrar(alertaId, 'wa', 'sin_telefono'); return { ok: false, error: 'sin telefono' }; }

  if (!token || !phoneId) {
    console.log(`[wa/STUB] → ${to} · alerta de "${marca}" nivel ${nivel}`);
    registrar(alertaId, 'wa', 'enviada_stub');
    return { ok: true, stub: true };
  }
  try {
    const body = {
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: 'es_AR' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: marca },
            { type: 'text', text: nivel },
            { type: 'text', text: panel_url },
          ],
        }],
      },
    };
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      registrar(alertaId, 'wa', 'error', { error: `HTTP ${res.status}: ${txt.slice(0, 200)}` });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const pid = data?.messages?.[0]?.id;
    registrar(alertaId, 'wa', 'enviada', { proveedor_id: pid });
    return { ok: true, id: pid };
  } catch (err) {
    registrar(alertaId, 'wa', 'error', { error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = { enviarMail, enviarWhatsApp };
