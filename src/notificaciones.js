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
  // Desactivado por decisión de producto — todas las alertas salen por mail.
  // El botón verde de WhatsApp de la landing y el contacto manual siguen
  // funcionando, pero el sistema NO inicia chats automáticos.
  registrar(alertaId, 'wa', 'desactivado');
  return { ok: true, disabled: true };
}

module.exports = { enviarMail, enviarWhatsApp, enviarMailGenerico };

/**
 * Envío de mail genérico (subject/HTML arbitrario + adjuntos opcionales).
 * Pensado para informes pagos, follow-ups de leads y mails al equipo legal.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to - destinatario(s)
 * @param {string} opts.subject - asunto
 * @param {string} opts.html - cuerpo HTML
 * @param {Array<{filename, content}>=} opts.attachments - PDF u otros (content = Buffer base64)
 * @param {string=} opts.from - override del FROM
 * @param {string=} opts.replyTo - reply-to opcional
 * @param {string=} opts.tag - etiqueta para auditoría (ej. "informe_pagado", "lead_followup")
 */
async function enviarMailGenerico({ to, subject, html, attachments, from, replyTo, tag }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromAddr = (from || process.env.MAIL_FROM || 'contacto@legalpacers.com').trim();
  const tagFinal = tag || 'generico';

  if (!apiKey) {
    console.log(`[mail/STUB · ${tagFinal}] → ${to} · ${subject}`);
    return { ok: true, stub: true };
  }

  try {
    const body = { from: fromAddr, to, subject, html };
    // Reply-to: explícito, o el default configurable. Así cuando un cliente
    // responde el mail, la respuesta cae en una casilla que sí se lee (no en
    // el 'from' de envío, que puede ser no-reply).
    const rt = (replyTo || process.env.MAIL_REPLY_TO || '').trim();
    if (rt) body.reply_to = rt;
    if (Array.isArray(attachments) && attachments.length) {
      body.attachments = attachments.map(a => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
      }));
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[mail/${tagFinal}] error HTTP ${res.status}:`, txt.slice(0, 300));
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (err) {
    console.error(`[mail/${tagFinal}] error red:`, err.message);
    return { ok: false, error: err.message };
  }
}
