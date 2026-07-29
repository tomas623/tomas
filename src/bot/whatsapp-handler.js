// Procesa los mensajes entrantes del webhook de WhatsApp: guarda el historial,
// llama al bot (responder.js) y contesta por la Cloud API. Maneja el "handoff":
// si el bot decide derivar, pausa al contacto y te avisa por mail.

const db = require('../db');
const audit = require('../audit');
const { responder } = require('./responder');
const { enviarWA } = require('./whatsapp');
const { enviarMailGenerico } = require('../notificaciones');

function tocarContacto(telefono, nombre) {
  db.prepare(`
    INSERT INTO wa_contactos (telefono, nombre, ultimo_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(telefono) DO UPDATE SET
      nombre = COALESCE(excluded.nombre, wa_contactos.nombre),
      ultimo_at = datetime('now')
  `).run(telefono, nombre || null);
}

function estaPausado(telefono) {
  const c = db.prepare('SELECT pausado FROM wa_contactos WHERE telefono = ?').get(telefono);
  return !!(c && c.pausado);
}

function pausar(telefono) {
  db.prepare("UPDATE wa_contactos SET pausado = 1, pausado_at = datetime('now') WHERE telefono = ?").run(telefono);
}

function guardarMensaje(telefono, rol, texto, waMsgId) {
  try {
    db.prepare('INSERT INTO wa_mensajes (telefono, rol, texto, wa_msg_id) VALUES (?, ?, ?, ?)')
      .run(telefono, rol, texto, waMsgId || null);
    return true;
  } catch (err) {
    // Choca con el índice único de wa_msg_id → mensaje duplicado (Meta reintenta).
    if (/UNIQUE/i.test(err.message)) return false;
    throw err;
  }
}

function historial(telefono, limite = 20) {
  const filas = db.prepare(
    'SELECT rol, texto FROM wa_mensajes WHERE telefono = ? ORDER BY id DESC LIMIT ?'
  ).all(telefono, limite).reverse();
  // El humano y el bot cuentan como 'bot' (lado del negocio) para el modelo.
  return filas.map(f => ({ rol: f.rol === 'cliente' ? 'cliente' : 'bot', texto: f.texto }));
}

function avisarHandoff(telefono, nombre) {
  try {
    const MAIL_ADMIN = (process.env.MAIL_ADMIN || 'tomas@legalpacers.com').trim();
    const ultimos = db.prepare('SELECT rol, texto FROM wa_mensajes WHERE telefono = ? ORDER BY id DESC LIMIT 8')
      .all(telefono).reverse();
    const hilo = ultimos.map(m => `<b>${m.rol === 'cliente' ? (nombre || 'cliente') : 'bot'}:</b> ${(m.texto || '').replace(/</g, '&lt;')}`).join('<br>');
    const wa = `https://wa.me/${String(telefono).replace(/\D/g, '')}`;
    enviarMailGenerico({
      to: MAIL_ADMIN,
      subject: `🙋 WhatsApp: te pasan una consulta — ${nombre || telefono}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f1f3d">
        <h2 style="color:#1B6EF3">El bot te derivó una conversación</h2>
        <p><strong>Contacto:</strong> ${nombre || '—'} · ${telefono}</p>
        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:13px;line-height:1.6">${hilo}</div>
        <p style="margin-top:16px"><a href="${wa}" style="background:#25D366;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">💬 Responder por WhatsApp</a></p>
        <p style="font-size:12px;color:#64748b">El bot quedó en silencio con este contacto hasta que lo reactives desde el panel.</p>
      </div>`,
      tag: 'wa_handoff',
    }).catch(() => {});
  } catch (err) { console.error('[wa] aviso handoff:', err.message); }
}

// Procesa el cuerpo completo del webhook (puede traer varios mensajes).
async function manejarEntrada(body) {
  const entradas = (body && body.entry) || [];
  for (const entry of entradas) {
    for (const change of (entry.changes || [])) {
      const value = change.value || {};
      const nombrePerfil = value.contacts && value.contacts[0] && value.contacts[0].profile && value.contacts[0].profile.name;
      for (const msg of (value.messages || [])) {
        if (msg.type !== 'text') {
          // Por ahora solo texto; otros tipos los derivamos.
          if (msg.from) { tocarContacto(msg.from, nombrePerfil); }
          continue;
        }
        await manejarMensaje({ from: msg.from, text: msg.text && msg.text.body, waId: msg.id, name: nombrePerfil });
      }
    }
  }
}

async function manejarMensaje({ from, text, waId, name }) {
  if (!from || !text) return;
  tocarContacto(from, name);
  const esNuevo = guardarMensaje(from, 'cliente', text, waId);
  if (!esNuevo) return; // duplicado (Meta reintentó) → ya lo procesamos

  if (estaPausado(from)) return; // lo maneja un humano

  let r;
  try { r = await responder(historial(from)); }
  catch (err) { console.error('[wa] responder throw:', err.message); return; }
  if (!r.ok) { console.error('[wa] responder:', r.error); return; }

  let texto = r.texto || '';
  const derivar = /\[DERIVAR\]/i.test(texto);
  texto = texto.replace(/\[DERIVAR\]/ig, '').trim();

  const partes = texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  for (const p of partes) {
    const env = await enviarWA(from, p);
    if (env.ok) guardarMensaje(from, 'bot', p, null);
    else console.error('[wa] enviar:', env.error);
  }

  if (derivar) {
    pausar(from);
    audit.log(null, 'wa.handoff', { detalle: { telefono: from } });
    avisarHandoff(from, name);
  }
}

module.exports = { manejarEntrada, pausar, estaPausado };
