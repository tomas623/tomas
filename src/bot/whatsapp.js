// Cliente de la WhatsApp Business Cloud API (Meta). Solo ENVÍO de mensajes de
// texto. La recepción entra por el webhook (server.js) y se procesa en
// whatsapp-handler.js. Todo queda inerte si no están las variables de entorno.

const crypto = require('crypto');

const WA_API = 'https://graph.facebook.com/v21.0';

function config() {
  return {
    token: (process.env.WHATSAPP_TOKEN || '').trim(),
    phoneId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    verifyToken: (process.env.WHATSAPP_VERIFY_TOKEN || '').trim(),
    appSecret: (process.env.WHATSAPP_APP_SECRET || '').trim(),
  };
}

function configurado() {
  const c = config();
  return !!(c.token && c.phoneId);
}

// Verifica la firma X-Hub-Signature-256 del webhook (si hay app secret).
function firmaValida(rawBody, firmaHeader) {
  const c = config();
  if (!c.appSecret) return true; // sin secret configurado, no validamos
  if (!firmaHeader || !rawBody) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(firmaHeader), Buffer.from(esperado));
  } catch { return false; }
}

async function enviarWA(to, texto) {
  const c = config();
  if (!c.token || !c.phoneId) return { ok: false, error: 'WhatsApp no configurado' };
  try {
    const res = await fetch(`${WA_API}/${c.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { config, configurado, firmaValida, enviarWA };
