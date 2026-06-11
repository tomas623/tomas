// Etapa 2 del motor de matching — juicio fino con Gemini (BUILD_SPEC_MOTOR.md §3).
// Sólo se llama sobre la lista corta de Etapa 1. Devuelve JSON estructurado.
// MODO STUB cuando no hay GEMINI_API_KEY: devuelve un mock determinístico para testear.
//
// IMPORTANTE: la salida es SEÑAL PARA REVISIÓN HUMANA, nunca decisión.
// El operador/agente firma el dictamen, no el modelo.
//
// El prompt inyecta:
//   1. La doctrina argentina (Ley 22.362 + Art. 6bis CUP + ADPIC) desde doctrina.js.
//   2. Reglas duras de scoring (criterios de "alto" / "medio" / "bajo").
//   3. Lista de marcas notorias para que Gemini aplique la protección reforzada.
//   4. Three-shot: 3 dictámenes de monitoreo de boletines resueltos correctamente,
//      uno por cada nivel de riesgo. Sirven de patrón estilístico.

const db = require('../db');
const { DOCTRINA_INPI } = require('./doctrina');

// Catálogos concretos de palabras restringidas por leyes especiales argentinas.
// El módulo leyes-especiales.js los usa para flags determinísticos; acá los
// inyectamos al prompt para que Gemini detecte estos términos al razonar
// sobre la candidata del boletín, sin depender de que el motor previo
// los haya marcado.
const LEYES_ESPECIALES_CATALOGO = `
LEYES ARGENTINAS QUE RESTRINGEN TÉRMINOS ESPECÍFICOS EN MARCAS:

a) Ley 25.127 (producción ecológica) + práctica INPI/SENASA:
   - Términos restringidos: bio, eco, orgánico, ecológico, biológico.
   - Clases afectadas: 16, 20, 24, 29, 30, 31, 32 (agroalimentarias).
   - Efecto: INPI rechaza estos términos salvo certificación SENASA del producto.

b) Ley 24.664 (Símbolo Olímpico, titularidad COI/COA):
   - Términos protegidos en TODAS las clases: juegos olímpicos, olimpiada(s),
     olímpico/a/os/as, "Citius Altius Fortius", "Más Rápido Más Alto Más Fuerte",
     movimiento olímpico.
   - Efecto: registro improbable sin licencia previa del COI o COA.

c) Ley 26.687 (control de tabaco):
   - Términos prohibidos en clase 34: light, suave, milds, "bajo en nicotina",
     "bajo en alquitrán" y similares que sugieran menor daño.
   - Efecto: bloqueo objetivo en clase 34.

d) Art. 3 inc. d Ley 22.362 (designaciones de actividad):
   - Solas, sin acompañamiento distintivo, NO son registrables: zapatería, taller,
     estudio, consultora, consultoría, panadería, librería, farmacia, kiosco, almacén.
   - Efecto: requiere elemento adicional distintivo para superar el examen INPI.

Si la candidata del boletín contiene alguno de estos términos en las condiciones
descritas, mencionalo en el fundamento y elevá el nivel_riesgo según corresponda.
`;

// ===== Pautas de análisis fonético en español rioplatense =====
// Reglas que aplicaría un examinador del INPI argentino al cotejo auditivo.
// El motor de Etapa 1 ya las usa internamente (codigoFonetico en etapa1.js);
// acá las explicamos en lenguaje natural para que Gemini pueda razonar sobre
// CADA par concreto en vez de aplicar una intuición fonética genérica.
const PAUTAS_FONETICAS = `
PAUTAS PARA EL ANÁLISIS FONÉTICO en español rioplatense:

1. EQUIVALENCIAS CONSONÁNTICAS (pares que el oído NO distingue acá):
   - B / V → mismo sonido bilabial. "BIVA" y "VIBA" son fonéticamente idénticos.
   - C ante e/i / S / Z → mismo sonido /s/ (seseo). "CIELO", "SIELO" y "ZIELO" suenan igual.
   - C ante a/o/u / K / QU / W → mismo sonido /k/. "CASA", "KASA", "QUASA" son equivalentes.
   - G ante e/i / J → mismo sonido. "GENTE" y "JENTE" suenan igual.
   - LL / Y → yeísmo rioplatense, mismo sonido /ʃ/ o /ʒ/. "POLLO" y "POYO" suenan idéntico.
   - H → muda, no se pronuncia. "HOLA" suena "OLA"; "HUEVO" suena "UEVO".
   - X → en posición intervocálica suena /s/ o /ks/. "EXTRA" ≈ "ESTRA".
   - Letras DOBLES (CC, NN, MM, etc.) se reducen a una sola en habla. "FOCCA" suena "FOKA".

2. ÁMBITO DEL COTEJO:
   - Comparar SONIDO, no escritura. Si dos grafías distintas producen el mismo flujo
     fonético, hay coincidencia fonética total aunque la ortografía difiera.
   - Aplicar el principio del COTEJO SUCESIVO (Doctrina §4): el consumidor no ve las dos
     marcas juntas; las recuerda. La memoria fonética es más imprecisa que la visual.

3. CRITERIOS DE PESO:
   - SÍLABA INICIAL idéntica eleva mucho el riesgo (el oído humano la retiene más).
   - SÍLABA TÓNICA coincidente refuerza la confundibilidad.
   - Cantidad de sílabas: si difiere en 1 sílaba pero las raíces suenan iguales, sigue
     habiendo riesgo (ej: "Acmé" vs "Acmena" en misma clase).
   - Vocales tónicas distintas (a/e/o) atenúan la coincidencia, salvo que las consonantes
     dominen el flujo sonoro.

4. EJEMPLOS APLICADOS:
   - "Focca" vs "Fokka"  → idénticos (CC=K, KK=K, FOKA = FOKA).
   - "Biva" vs "Viva"    → idénticos (B=V).
   - "Yamada" vs "Llamada" → casi idénticos (yeísmo). Solo la sílaba inicial es muda en la 2da.
   - "Sielo" vs "Cielo"  → idénticos (C ante e = S).
   - "Hotel" vs "Otel"   → idénticos (H muda).
   - "Acmena" vs "Acmé"  → coinciden en la raíz "AKM-", sílaba tónica distinta: riesgo medio.
   - "Tango" vs "Mango"  → distintos (consonante inicial T vs M produce flujo distinto).
`;

// ===== Marcas notorias / renombradas en Argentina =====
// Lista no taxativa para el contexto del prompt — Gemini debe reconocerlas
// y aplicar la protección reforzada (quiebre del principio de especialidad).
// La curaduría es conservadora: en duda, NO marcar notoria.
const MARCAS_NOTORIAS = [
  // Globales
  'Coca-Cola', 'Pepsi', 'Nike', 'Adidas', 'Puma', 'Reebok',
  'Apple', 'Google', 'Microsoft', 'Amazon', 'Meta', 'Netflix',
  'Disney', 'Marvel', 'Star Wars', 'Pixar',
  'McDonald\'s', 'Burger King', 'Starbucks', 'KFC',
  'Mercedes-Benz', 'BMW', 'Toyota', 'Ford', 'Ferrari', 'Volkswagen',
  'Rolex', 'Cartier', 'Louis Vuitton', 'Gucci', 'Chanel', 'Hermès',
  'Sony', 'Samsung', 'LG', 'Philips', 'Lego',
  'Visa', 'Mastercard', 'American Express', 'PayPal',
  // Argentinas
  'Quilmes', 'Brahma', 'Stella Artois', 'Andes', 'Schneider',
  'Arcor', 'Bagley', 'Terrabusi', 'Havanna',
  'La Serenísima', 'Sancor', 'Ilolay', 'Las Marías',
  'Mercado Libre', 'Mercado Pago', 'Despegar', 'Globant',
  'YPF', 'Shell Argentina', 'Esso', 'Axion',
  'Aerolíneas Argentinas', 'Quilmes Cerveza',
  'Boca Juniors', 'River Plate', 'San Lorenzo', 'Racing', 'Independiente',
  'Clarín', 'La Nación', 'TyC Sports',
  'Tango', 'Mate', 'Yerba Mate Rosamonte', 'Yerba Playadito', 'Yerba Cruz de Malta',
];

// ===== Reglas duras de scoring =====
const REGLAS_SCORING = `
CRITERIOS OBLIGATORIOS para asignar nivel_riesgo:

ALTO — situación que un examinador del INPI muy probablemente bloquearía:
- Denominaciones idénticas o casi idénticas (1 letra de diferencia en raíz) en MISMA clase.
- Coincidencia fonética total en español rioplatense en misma clase o clase afín.
- Coincidencia con marca notoria/renombrada en CUALQUIER clase (quiebre de especialidad,
  Art. 6bis CUP / Art. 16.3 ADPIC).
- Marca compleja del registro previo donde el elemento DISTINTIVO PREDOMINANTE coincide
  con la denominación del cliente.

MEDIO — duda razonable que requiere análisis del Agente:
- Similitud fonética parcial (raíces compartidas, sufijos distintos) en misma clase o afín.
- Similitud ideológica/conceptual fuerte en clases del mismo nicho comercial.
- Diferencia ortográfica pequeña con misma carga conceptual en clases relacionadas.
- Familia de marcas del titular previo en clases que extienden por afinidad.

BAJO — improbable bloqueo del INPI por este antecedente:
- Coincidencia parcial pero clases notoriamente distintas SIN afinidad ni notoriedad.
- Similitud accidental por raíz griega/latina común usada por múltiples titulares
  (ej: "neo-", "tech-", "med-").
- Marca compleja donde la coincidencia está en elementos accesorios, no en el
  elemento distintivo predominante.

REGLAS DUR AS:
1. NO inventes datos del titular ni actas. Solo razoná sobre las denominaciones y clases dadas.
2. Si la marca del registro previo aparece en la lista de marcas notorias, "notoria": true.
3. El fundamento debe citar explícitamente el ámbito de cotejo (fonético / visual / ideológico)
   y la norma cuando aplique (Art. 3 inc. a o b Ley 22.362, Art. 6bis CUP).
4. La recomendación debe ser una acción CONCRETA para el equipo legal del cliente
   (oposición, dejar pasar, escalación, monitoreo).
`;

// ===== Few-shot: 3 dictámenes modelo de monitoreo =====
// Casos elegidos para cubrir los 3 niveles. Sirven de patrón estilístico
// (formato del fundamento, tono, citas normativas). NO los modifiques sin
// revisar con un Agente de PI.
const FEW_SHOT = [
  {
    marca:     { denominacion: 'Focca', clases: [9, 42] },
    candidata: { denominacion: 'FOKKA', clase: 9, titular: 'Otro Titular SRL' },
    dictamen: {
      nivel_riesgo: 'alto',
      notoria: false,
      fundamento: 'Coincidencia fonética total en español rioplatense ("focca" y "fokka" se pronuncian idéntico) sobre la misma clase 9. El cotejo auditivo predomina y el principio de especialidad confirma el riesgo: ambos signos compiten en el mismo nicho. Aplicable Art. 3 inc. b Ley 22.362 (marcas confundibles fonéticamente en productos idénticos).',
      recomendacion: 'Preparar oposición dentro del plazo legal. El elemento distintivo predominante es la raíz "FOC/FOK" y la coincidencia es estructural.',
    },
  },
  {
    marca:     { denominacion: 'Nimbus', clases: [42] },
    candidata: { denominacion: 'NIMBOES', clase: 25, titular: 'Indumentaria SA' },
    dictamen: {
      nivel_riesgo: 'medio',
      notoria: false,
      fundamento: 'Similitud ortográfica e ideológica moderada (raíz "NIMB-" compartida, ambas evocan nubes/cielo), pero las clases son distintas: clase 42 (software) frente a clase 25 (indumentaria), sin afinidad comercial directa ni canales de comercialización compartidos. El principio de especialidad opera como atenuante.',
      recomendacion: 'Evaluar contexto del titular del registro previo. Si no hay extensión a clase 42 ni intención de hacerlo, riesgo bajo. Mantener monitoreo de movimientos del expediente.',
    },
  },
  {
    marca:     { denominacion: 'Acmé Pasta', clases: [30, 43] },
    candidata: { denominacion: 'Coca-Cola Studio', clase: 41, titular: 'The Coca-Cola Company' },
    dictamen: {
      nivel_riesgo: 'bajo',
      notoria: true,
      fundamento: 'No existe coincidencia denominativa ni ideológica entre "Acmé Pasta" y "Coca-Cola Studio" — son signos completamente distintos. Aunque "Coca-Cola" es marca renombrada (Art. 6bis CUP), su protección reforzada se activa solo frente a signos que la imiten o aprovechen su prestigio, lo que no ocurre acá.',
      recomendacion: 'Falso positivo de la búsqueda fonética. Descartar la alerta. No requiere acción.',
    },
  },
];

function renderFewShot(items) {
  return items.map((it, i) => `
EJEMPLO ${i + 1}
INPUT:
  MARCA PROTEGIDA: ${it.marca.denominacion} · clases ${it.marca.clases.join(', ')}
  CANDIDATA: ${it.candidata.denominacion} · clase ${it.candidata.clase} · titular ${it.candidata.titular}
OUTPUT:
${JSON.stringify(it.dictamen, null, 2)}
`).join('\n');
}

// ===== Prompt principal =====
function buildPrompt(marca, candidata) {
  return `Sos un Agente de la Propiedad Industrial matriculado en Argentina. Asistís
al equipo legal de LegalPacers analizando alertas de monitoreo del Boletín del INPI.

Cada vez que el motor de matching detecta una posible coincidencia entre una marca
ya registrada por nuestro cliente y una solicitud nueva publicada en el boletín,
tu tarea es emitir un dictamen técnico estructurado.

Tu salida es SEÑAL para revisión humana, no decisión final. Un Agente revisa y firma.

# MARCO NORMATIVO
${DOCTRINA_INPI}

# LEYES ESPECIALES — CATÁLOGO CONCRETO DE TÉRMINOS
${LEYES_ESPECIALES_CATALOGO}

# COTEJO FONÉTICO
${PAUTAS_FONETICAS}

# REGLAS DE SCORING
${REGLAS_SCORING}

# MARCAS NOTORIAS / RENOMBRADAS reconocidas en Argentina
Lista no taxativa para tu referencia (en duda: notoria=false):
${MARCAS_NOTORIAS.join(', ')}.

# EJEMPLOS DE DICTÁMENES BIEN HECHOS
${renderFewShot(FEW_SHOT)}

# FORMATO DE SALIDA OBLIGATORIO
Devolvé UN ÚNICO objeto JSON sin texto extra, sin markdown, con esta estructura exacta:
{
  "nivel_riesgo": "alto" | "medio" | "bajo",
  "notoria": true | false,
  "fundamento": "<3-4 frases. Debe mencionar (a) ámbito de cotejo aplicable (fonético/visual/ideológico), (b) si rige el principio de especialidad o se quiebra por notoriedad, (c) norma cuando aplique (Art. 3 Ley 22.362, Art. 6bis CUP, etc.).>",
  "recomendacion": "<una frase con la acción CONCRETA sugerida: 'Preparar oposición', 'Descartar', 'Escalar a Agente', 'Continuar monitoreo', etc.>"
}

# CASO A EVALUAR

MARCA PROTEGIDA DEL CLIENTE:
  denominación: ${marca.denominacion}
  clases: ${(marca.clases || []).join(', ') || 'sin especificar'}

MARCA CANDIDATA DEL BOLETÍN:
  denominación: ${candidata.denominacion}
  clase: ${candidata.clase || 'sin especificar'}
  titular: ${candidata.titular || 'desconocido'}

Emití el dictamen ahora.`;
}

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
    contents: [{ role: 'user', parts: [{ text: buildPrompt(marca, candidata) }] }],
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

module.exports = { analizar, nivelDesdeScore, buildPrompt, MARCAS_NOTORIAS };
