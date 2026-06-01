// Etapa 2 del motor de matching — juicio fino con Gemini (BUILD_SPEC_MOTOR.md §3).
// Sólo se llama sobre la lista corta de Etapa 1. Devuelve JSON estructurado.
// MODO STUB cuando no hay GEMINI_API_KEY: devuelve un mock determinístico para testear.
//
// IMPORTANTE: la salida es SEÑAL PARA REVISIÓN HUMANA, nunca decisión.
// El operador/agente firma el dictamen, no el modelo.

const db = require('../db');

const PROMPT_TEMPLATE = (marca, candidata) => `Sos un asistente legal especializado en propiedad industrial argentina (INPI).
Comparás dos marcas y devolvés UN ÚNICO JSON sin texto extra:
{
  "nivel_riesgo": "alto" | "medio" | "bajo",
  "notoria": true | false,
  "fundamento": "<2-3 frases. Mencioná similitud ideológica/conceptual, fonética y posible confusión.>",
  "recomendacion": "<una frase con la acción sugerida.>"
}
NO inventes actas ni titulares. Tu salida es señal para revisión humana, no dictamen.

MARCA PROTEGIDA:
  denominación: ${marca.denominacion}
  clases: ${(marca.clases || []).join(', ')}

MARCA CANDIDATA (de la base):
  denominación: ${candidata.denominacion}
  clase: ${candidata.clase}
  titular: ${candidata.titular || 'desconocido'}
`;

function nivelDesdeScore(score) {
  if (score >= 80) return 'alto';
  if (score >= 60) return 'medio';
  return 'bajo';
}

function stubAnalisis(marca, candidata) {
  const nivel = nivelDesdeScore(candidata.score || 0);
  return {
    nivel_riesgo: nivel,
    notoria: false,
    fundamento: `STUB (sin GEMINI_API_KEY): la candidata "${candidata.denominacion}" presenta señales de Etapa 1 (motivos: ${(candidata.motivos || []).join(', ') || 'n/a'}). Nivel estimado por score=${candidata.score}.`,
    recomendacion: nivel === 'alto'
      ? 'Escalar a Agente de la Propiedad Industrial para análisis profundo y eventual oposición.'
      : nivel === 'medio'
        ? 'Revisar manualmente. Posible variante viable con ajuste de denominación o estrategia de clase.'
        : 'Riesgo bajo. Documentar y continuar monitoreo.',
    stub: true,
  };
}

async function callGemini(marca, candidata) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return stubAnalisis(marca, candidata);

  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-pro').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: PROMPT_TEMPLATE(marca, candidata) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[etapa2] Gemini', res.status, await res.text().catch(() => ''));
      return { ...stubAnalisis(marca, candidata), gemini_error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    try {
      const parsed = JSON.parse(txt);
      return { ...parsed, stub: false };
    } catch {
      return { ...stubAnalisis(marca, candidata), parse_error: true, raw: txt };
    }
  } catch (err) {
    console.error('[etapa2] error red:', err.message);
    return { ...stubAnalisis(marca, candidata), red_error: err.message };
  }
}

// Cachea por par (marca normalizada + candidata.id) para no recotizar a Gemini.
async function analizar(marca, candidata) {
  const cacheKey = `gemini:${marca.denominacion}:${candidata.id || candidata.denominacion}`;
  const row = db.prepare('SELECT detalle FROM audit_log WHERE accion = ? AND entidad = ? LIMIT 1')
    .get('gemini_cache', cacheKey);
  if (row && row.detalle) {
    try { return { ...JSON.parse(row.detalle), cached: true }; } catch {}
  }
  const result = await callGemini(marca, candidata);
  db.prepare(`INSERT INTO audit_log (accion, entidad, entidad_id, detalle) VALUES (?,?,?,?)`)
    .run('gemini_cache', cacheKey, candidata.id || null, JSON.stringify(result));
  return result;
}

module.exports = { analizar, nivelDesdeScore };
