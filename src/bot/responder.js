// Motor del bot de WhatsApp: toma la conversación y devuelve la respuesta usando
// el manual (src/bot/whatsapp-manual.md) como prompt del sistema + Gemini.
// Se usa tanto en el simulador del panel como (a futuro) en el webhook de WhatsApp.

const fs = require('fs');
const path = require('path');

function cargarManual() {
  try { return fs.readFileSync(path.join(__dirname, 'whatsapp-manual.md'), 'utf8'); }
  catch { return ''; }
}

const INSTRUCCIONES = `
---
INSTRUCCIONES DE EJECUCIÓN (no las menciones al cliente):
- Respondé como el asistente de WhatsApp descrito arriba, respetando el tono (informal rioplatense, minúscula, mensajes cortos).
- Si querés mandar varios mensajes cortos seguidos (como en un chat real), separalos con una línea en blanco.
- Nunca inventes precios, plazos ni datos que no estén en el manual. Si no lo sabés, decí que lo confirmás con el equipo.
- Cuando corresponda derivar a una persona (según el manual), decilo con naturalidad ("te paso con alguien del equipo que te sigue por acá").
- No des asesoramiento legal ni garantices resultados.
- Sé breve. En WhatsApp nadie lee párrafos largos.`;

/**
 * @param {Array<{rol:'cliente'|'bot', texto:string}>} mensajes
 * @returns {Promise<{ok:boolean, texto?:string, error?:string}>}
 */
async function responder(mensajes) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY no seteada en el servidor.' };
  const model = (process.env.GEMINI_MODEL_BOT || 'gemini-2.5-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const sys = cargarManual() + INSTRUCCIONES;
  const contents = (mensajes || [])
    .filter(m => m && m.texto && String(m.texto).trim())
    .map(m => ({ role: m.rol === 'bot' ? 'model' : 'user', parts: [{ text: String(m.texto) }] }));
  if (!contents.length) return { ok: false, error: 'No hay mensaje del cliente.' };

  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };

  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `Gemini HTTP ${res.status} ${t.slice(0, 150)}` };
    }
    const j = await res.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!txt) return { ok: false, error: 'Gemini devolvió una respuesta vacía.' };
    return { ok: true, texto: txt.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { responder };
