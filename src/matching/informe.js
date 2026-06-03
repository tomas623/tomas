// Orquestador del INFORME PAGO de viabilidad de marca.
// Combina:
//   - Pre-checks deterministas (leyes-especiales.js)
//   - Match con base INPI (etapa1.js)
//   - Análisis multifactorial con Gemini enriquecido por la doctrina INPI
//
// Salida: JSON estructurado con 7 ejes que reflejan el método de evaluación INPI.
// La firma humana (Agente de la Propiedad Industrial matriculado) sigue siendo obligatoria.

const db = require('../db');
const { chequear: chequearLeyes } = require('./leyes-especiales');
const { DOCTRINA_INPI } = require('./doctrina');

// ──────────────────────────────────────────────────────────────────────────────
// FEW-SHOT EXAMPLES — calibran a Gemini con casos arquetípicos.
// El acta real que pase el cliente reemplazará / complementará estos en Sprint 1.5.
// ──────────────────────────────────────────────────────────────────────────────
const FEW_SHOT_EXAMPLES = [
  {
    input: `Cliente: "Acmé", clase 35 (publicidad y gestión), denominativa.
Candidata INPI: "Acme", clase 35, titular Acme Holdings SA, estado Concedida. Score Etapa 1: 100.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'alto',
      viabilidad_estimada: 5,
      resumen_ejecutivo: 'Conflicto frontal con marca idéntica registrada en la misma clase 35. La práctica del INPI rechaza de oficio marcas con esta coincidencia. Es necesario modificar la denominación antes de presentar.',
      distintividad_intrinseca: {
        nivel: 'alta',
        comentario: 'La denominación es un nombre de fantasía suficientemente arbitrario, sin valor descriptivo.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No cae en designación genérica, descriptiva ni de uso común.' },
      prohibiciones_relativas: {
        flags: ['conflicto_marca_preexistente'],
        comentario: 'Conflicto directo con "Acme" registrada en misma clase y por titular activo.',
      },
      leyes_especiales: { flags: [], comentario: 'No aplican restricciones de Ley 25.127, 24.664 ni 26.687.' },
      confundibilidad: {
        fonetica: { similitud: 'alta', explicacion: 'La tilde no genera diferencia fonética en español rioplatense.' },
        visual: { similitud: 'alta', explicacion: 'Solo difieren por una tilde — visualmente confundibles.' },
        ideologica: { similitud: 'alta', explicacion: 'Misma denominación, sin distinción semántica.' },
        regla_predominante: 'Predominio de semejanzas sobre diferencias + identidad de elemento distintivo.',
      },
      especialidad: {
        afinidad: 'identidad',
        comentario: 'Misma clase 35, mismo género comercial. Sin escape por especialidad.',
      },
      marca_notoria: { es_notoria: false, comentario: 'Sin evidencia de notoriedad del titular registrado.' },
      ley_aplicable: 'Art. 3 inc. a y b Ley 22.362 (marcas idénticas o casi idénticas en la misma clase).',
      recomendacion_principal: 'No presentar como está; cambiar la denominación.',
      alternativas_sugeridas: ['Acmétik', 'Acmélab', 'NeoAcme', 'Acmegest'],
    },
  },
  {
    input: `Cliente: "Focca", clase 9 (electrónica), denominativa.
Candidata INPI: "FOKKA", clase 9, titular Otro Titular SRL, estado Concedida. Score Etapa 1: 96. Motivos: coincidencia_fonetica, misma_clase.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'alto',
      viabilidad_estimada: 20,
      resumen_ejecutivo: 'Coincidencia fonética alta en la misma clase 9. Aunque la grafía difiere, el INPI suele rechazar marcas que se pronuncian idénticas por riesgo de confusión auditiva.',
      distintividad_intrinseca: {
        nivel: 'alta',
        comentario: 'Ambas son denominaciones de fantasía sin carga descriptiva.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No aplica falta de distintividad intrínseca.' },
      prohibiciones_relativas: {
        flags: ['conflicto_marca_preexistente'],
        comentario: 'FOKKA registrada con identidad fonética en la misma clase.',
      },
      leyes_especiales: { flags: [], comentario: 'No aplican.' },
      confundibilidad: {
        fonetica: { similitud: 'alta', explicacion: 'En español rioplatense "cc" y "kk" se pronuncian igual /k/. Suenan idénticas.' },
        visual: { similitud: 'media', explicacion: 'Diferentes consonantes pero patrón ortográfico similar.' },
        ideologica: { similitud: 'media', explicacion: 'Ambas son nombres de fantasía sin significado evidente; carga conceptual comparable.' },
        regla_predominante: 'Cotejo sucesivo — el consumidor expuesto a Focca recordaría FOKKA.',
      },
      especialidad: {
        afinidad: 'identidad',
        comentario: 'Misma clase 9, mismo género comercial.',
      },
      marca_notoria: { es_notoria: false, comentario: 'Ninguna de las partes es notoria.' },
      ley_aplicable: 'Art. 3 inc. b Ley 22.362 (marcas confundibles fonéticamente).',
      recomendacion_principal: 'Auditar variante con cambio fonético, o pedir consentimiento al titular de FOKKA.',
      alternativas_sugeridas: ['Foccaly', 'Foxxa', 'Fokima', 'Foccatech'],
    },
  },
  {
    input: `Cliente: "Nimbus", clase 42 (software / SaaS), denominativa.
Candidata INPI: "Nimboes", clase 25 (indumentaria), titular Indumentaria Casual SRL. Score Etapa 1: 65. Motivos: trigramas_medios, clase_distinta.
Pre-checks especiales: ninguno.`,
    output: {
      nivel_riesgo: 'bajo',
      viabilidad_estimada: 85,
      resumen_ejecutivo: 'Riesgo bajo: las clases pertenecen a géneros distintos (software vs indumentaria) y la similitud ortográfica es moderada. Por principio de especialidad, no hay conflicto sustancial.',
      distintividad_intrinseca: {
        nivel: 'alta',
        comentario: 'Nimbus evoca "nube" — distintiva en su sector tecnológico.',
      },
      prohibiciones_absolutas: { flags: [], comentario: 'No aplica.' },
      prohibiciones_relativas: { flags: [], comentario: 'Sin conflicto relevante por afinidad comercial.' },
      leyes_especiales: { flags: [], comentario: 'No aplican.' },
      confundibilidad: {
        fonetica: { similitud: 'baja', explicacion: 'Comparten raíz "Nimb" pero terminaciones distintas evitan confusión auditiva.' },
        visual: { similitud: 'media', explicacion: 'Ortográficamente cercanas pero distinguibles.' },
        ideologica: { similitud: 'baja', explicacion: 'Nimbus evoca nube/cloud; Nimboes es flexión aplicada a ropa. Universos semánticos distintos.' },
        regla_predominante: 'Principio de especialidad — clases distantes desactivan el riesgo de confusión.',
      },
      especialidad: {
        afinidad: 'nula',
        comentario: 'Clase 42 (software) y clase 25 (indumentaria): géneros comerciales sin canales ni público compartido.',
      },
      marca_notoria: { es_notoria: false, comentario: 'Ninguna es notoria.' },
      ley_aplicable: null,
      recomendacion_principal: 'Presentar tal como está. Riesgo bajo.',
      alternativas_sugeridas: [],
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// PROMPT SYSTEM — incluye doctrina embebida.
// ──────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Sos un asistente experto en propiedad industrial argentina, especializado en evaluar la registrabilidad de marcas ante el INPI.

Tu rol: generar un análisis técnico que un Agente de la Propiedad Industrial matriculado va a revisar y firmar antes de enviárselo al cliente. NO firmás vos, sos señal para revisión humana.

Tono: profesional pero accesible para no abogados. Cuerpo del análisis en lenguaje claro. Citá artículos de la Ley 22.362 cuando corresponda. No uses jerga innecesaria.

REGLAS DURAS:
- NO inventes actas, titulares, jurisprudencia ni fechas.
- Si los datos son insuficientes, decilo explícitamente.
- El análisis fonético es para español rioplatense (no inglés).
- "Marca notoria" se evalúa con cautela: solo si la denominación es claramente reconocible
  globalmente o en Argentina. En la duda, marca_notoria.es_notoria = false.
- Usá el marco doctrinario que sigue como referencia obligatoria al razonar.

${DOCTRINA_INPI}

---

# FORMATO DE SALIDA

Devolvé UN ÚNICO JSON con esta estructura exacta. Sin texto extra, sin markdown wrapper:

{
  "nivel_riesgo": "alto" | "medio" | "bajo",
  "viabilidad_estimada": number (0-100),
  "resumen_ejecutivo": "2-3 frases con el veredicto en lenguaje claro y accesible.",
  "distintividad_intrinseca": {
    "nivel": "alta" | "media" | "baja",
    "comentario": "¿Es genérica/descriptiva/de fantasía? Aplicabilidad de secondary meaning."
  },
  "prohibiciones_absolutas": {
    "flags": ["genericidad" | "descriptiva" | "uso_general" | "forma_necesaria" | "color_natural" | ...],
    "comentario": "Si hay flags, explicar. Si no, decir 'No aplica'."
  },
  "prohibiciones_relativas": {
    "flags": ["conflicto_marca_preexistente" | "enganosa" | "signo_oficial" | "nombre_persona" | "denominacion_origen" | "designacion_actividad" | "frase_publicitaria" | ...],
    "comentario": "Detalle del / los conflictos detectados."
  },
  "leyes_especiales": {
    "flags": ["eco_clase_agroalimentaria" | "simbolo_olimpico" | "tabaco_enganoso" | ...],
    "comentario": "Bloqueos por leyes especiales (25.127, 24.664, 26.687)."
  },
  "confundibilidad": {
    "fonetica":   { "similitud": "alta" | "media" | "baja" | "nula", "explicacion": "..." },
    "visual":     { "similitud": "alta" | "media" | "baja" | "nula", "explicacion": "..." },
    "ideologica": { "similitud": "alta" | "media" | "baja" | "nula", "explicacion": "..." },
    "regla_predominante": "Cuál regla de cotejo (predominio de semejanzas, elemento distintivo, etc.) pesa más en este caso."
  },
  "especialidad": {
    "afinidad": "identidad" | "alta" | "media" | "baja" | "nula",
    "comentario": "Análisis de afinidad de clases / canales / público."
  },
  "marca_notoria": {
    "es_notoria": true | false,
    "comentario": "Si es notoria, explicar protección cross-clase. Si no, indicar criterio aplicado."
  },
  "ley_aplicable": "Artículo específico de Ley 22.362 u otra, o null si no aplica.",
  "recomendacion_principal": "Una frase. 'Presentar como está' | 'Modificar antes de presentar' | 'Auditar variante' | 'No presentar, alto riesgo'.",
  "alternativas_sugeridas": ["Lista de 2-4 variantes del nombre que podrían sortear el conflicto. [] si no aplica."]
}

---

# EJEMPLOS DE REFERENCIA

A continuación, ejemplos de análisis bien calibrados. Estudiá el razonamiento y replicalo:

${FEW_SHOT_EXAMPLES.map((ex, i) => `## Ejemplo ${i + 1}

Entrada:
${ex.input}

Salida esperada:
${JSON.stringify(ex.output, null, 2)}`).join('\n\n')}
`;

// ──────────────────────────────────────────────────────────────────────────────
// PROMPT POR CASO — el "user message" con los datos concretos del cliente.
// ──────────────────────────────────────────────────────────────────────────────
function construirUserPrompt({ marca, candidatas, flagsLeyesEspeciales }) {
  const candidatasFormateadas = candidatas.length === 0
    ? 'Ninguna coincidencia significativa detectada en la base INPI.'
    : candidatas.slice(0, 5).map((c, i) => `
  Candidata ${i + 1}:
    Denominación: "${c.denominacion}"
    Clase Niza: ${c.clase}
    Titular: ${c.titular || 'desconocido'}
    Estado: ${c.estado || 'desconocido'}
    Score Etapa 1: ${c.score || 'n/a'}
    Motivos del match: ${(c.motivos || []).join(', ') || 'n/a'}
`).join('');

  const flagsTexto = flagsLeyesEspeciales.length === 0
    ? 'Ninguno. No se detectaron bloqueos por leyes especiales.'
    : flagsLeyesEspeciales.map(f =>
      `- [${f.severidad}] ${f.regla}: ${f.detalle} (${f.ley})`,
    ).join('\n');

  return `# CASO A ANALIZAR

## Marca del cliente
- Denominación: "${marca.denominacion}"
- Clases Niza solicitadas: ${(marca.clases || []).join(', ') || 'sin especificar'}
- Tipo: ${marca.tipo || 'denominativa'}
- Rubro declarado: ${marca.rubro || 'sin especificar'}

## Candidatas en conflicto detectadas en INPI
${candidatasFormateadas}

## Pre-checks de leyes especiales (deterministas)
${flagsTexto}

## Instrucción
Aplicá el marco doctrinario y devolvé el JSON estructurado. Recordá: los pre-checks
detectados arriba ya son objetivos — incorporalos sin reanalizarlos, en el campo
"leyes_especiales.flags" y reflejalos en el "nivel_riesgo" y "viabilidad_estimada".`;
}

// ──────────────────────────────────────────────────────────────────────────────
// STUB para correr sin GEMINI_API_KEY (dev/testing).
// ──────────────────────────────────────────────────────────────────────────────
function stubInforme(marca, candidatas, flags) {
  const hayConflicto = candidatas.length > 0 && (candidatas[0].score || 0) >= 80;
  const hayFlagAlto = flags.some(f => f.severidad === 'alta');
  const nivel = hayFlagAlto || hayConflicto ? 'alto' : candidatas.length > 0 ? 'medio' : 'bajo';
  const viab = nivel === 'alto' ? 15 : nivel === 'medio' ? 55 : 85;

  return {
    nivel_riesgo: nivel,
    viabilidad_estimada: viab,
    resumen_ejecutivo: `STUB (sin GEMINI_API_KEY). ${candidatas.length} candidata(s) detectada(s), ${flags.length} flag(s) de leyes especiales.`,
    distintividad_intrinseca: { nivel: 'media', comentario: 'STUB' },
    prohibiciones_absolutas: { flags: [], comentario: 'STUB' },
    prohibiciones_relativas: {
      flags: candidatas.length > 0 ? ['conflicto_marca_preexistente'] : [],
      comentario: 'STUB',
    },
    leyes_especiales: {
      flags: flags.map(f => f.regla),
      comentario: flags.map(f => f.detalle).join(' | ') || 'No aplican.',
    },
    confundibilidad: {
      fonetica: { similitud: 'media', explicacion: 'STUB' },
      visual: { similitud: 'media', explicacion: 'STUB' },
      ideologica: { similitud: 'media', explicacion: 'STUB' },
      regla_predominante: 'STUB',
    },
    especialidad: { afinidad: 'media', comentario: 'STUB' },
    marca_notoria: { es_notoria: false, comentario: 'STUB' },
    ley_aplicable: hayConflicto ? 'Art. 3 inc. b Ley 22.362' : null,
    recomendacion_principal: nivel === 'alto'
      ? 'Modificar antes de presentar'
      : nivel === 'medio' ? 'Auditar variante' : 'Presentar como está',
    alternativas_sugeridas: [],
    stub: true,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Llamada a Gemini.
// ──────────────────────────────────────────────────────────────────────────────
async function callGemini(marca, candidatas, flagsLeyesEspeciales) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return stubInforme(marca, candidatas, flagsLeyesEspeciales);

  const model = (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-pro').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [{ text: construirUserPrompt({ marca, candidatas, flagsLeyesEspeciales }) }],
    }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[informe] Gemini HTTP', res.status, txt.slice(0, 300));
      return { ...stubInforme(marca, candidatas, flagsLeyesEspeciales), gemini_error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    try {
      const parsed = JSON.parse(txt);
      return { ...parsed, stub: false };
    } catch (err) {
      console.error('[informe] parse error:', err.message, 'raw:', txt.slice(0, 300));
      return { ...stubInforme(marca, candidatas, flagsLeyesEspeciales), parse_error: true };
    }
  } catch (err) {
    console.error('[informe] error red:', err.message);
    return { ...stubInforme(marca, candidatas, flagsLeyesEspeciales), red_error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API pública: genera el informe completo del lead pagado.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Genera el informe estructurado de viabilidad.
 * @param {object} marca - { denominacion, clases, rubro, tipo }
 * @param {Array} candidatas - hits de Etapa 1 (top N de la lista corta)
 * @returns {Promise<object>} informe JSON estructurado
 */
async function generar(marca, candidatas = []) {
  const flagsLeyesEspeciales = chequearLeyes(marca.denominacion, marca.clases);

  // Cache por hash del input — evita re-tirar a Gemini si el caso se repite.
  const cacheKey = `informe:${marca.denominacion}:${(marca.clases || []).join(',')}:${candidatas.map(c => c.id || c.denominacion).join('|')}`;
  const row = db.prepare('SELECT detalle FROM audit_log WHERE accion = ? AND entidad = ? LIMIT 1')
    .get('informe_cache', cacheKey);
  if (row && row.detalle) {
    try { return { ...JSON.parse(row.detalle), cached: true }; } catch {}
  }

  const informe = await callGemini(marca, candidatas, flagsLeyesEspeciales);

  // Persistimos el pre-check para trazabilidad (lo usa el PDF en Sprint 2).
  informe._pre_checks = flagsLeyesEspeciales;
  informe._meta = {
    generado_at: new Date().toISOString(),
    model: (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-pro'),
    candidatas_analizadas: candidatas.length,
  };

  db.prepare(`INSERT INTO audit_log (accion, entidad, entidad_id, detalle) VALUES (?,?,?,?)`)
    .run('informe_cache', cacheKey, null, JSON.stringify(informe));

  return informe;
}

module.exports = {
  generar,
  // Exporto internals para testing.
  _internals: { SYSTEM_PROMPT, construirUserPrompt, stubInforme, FEW_SHOT_EXAMPLES },
};
