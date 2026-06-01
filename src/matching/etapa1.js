// Etapa 1 del motor de matching — determinística, sin IA, sub-segundo (BUILD_SPEC_MOTOR.md §3).
// Inputs: marca consultada + universo de actas (filas de marcas_inpi o marcas_boletin).
// Output: lista corta con score 0–100 y motivo.

const SUFIJOS_SOCIETARIOS = [
  'sa', 'srl', 'sas', 'sca', 'scs', 'sociedad anonima', 'sociedad anónima',
  'sociedad de responsabilidad limitada', 's a', 's r l', 's a s',
];

function normalizar(texto) {
  if (!texto) return '';
  let t = String(texto).toLowerCase().trim();
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const suf of SUFIJOS_SOCIETARIOS) {
    const re = new RegExp(`(^|\\s)${suf}(\\s|$)`, 'g');
    t = t.replace(re, ' ');
  }
  return t.replace(/\s+/g, '').trim();
}

// ===== Fonético español =====
// Simplificación tipo Doble Metaphone adaptada a ES: colapsa pares que suenan igual
// (ll/y, b/v, c/s/z, g/j, qu/k, h muda). No es exacto pero captura los casos típicos
// de confusión que importan en marcas argentinas.
function codigoFonetico(s) {
  if (!s) return '';
  let t = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-zñ]/g, '');
  // Pre-reglas (orden importa)
  t = t.replace(/h/g, '');                 // h muda
  t = t.replace(/qu([eiéí])/g, 'k$1');
  t = t.replace(/qu/g, 'k');
  t = t.replace(/c([eiéí])/g, 's$1');      // ce/ci suenan a 's'
  t = t.replace(/c/g, 'k');                // resto de c's (focca, casa) → 'k'
  t = t.replace(/g([eiéí])/g, 'j$1');
  t = t.replace(/ch/g, 'X');               // marker temporal
  t = t.replace(/ll/g, 'Y');
  t = t.replace(/ñ/g, 'N');
  // Colapsos
  t = t.replace(/[vb]/g, 'b');
  t = t.replace(/z/g, 's');                // 'z' en ES rioplatense suena 's'
  t = t.replace(/y/g, 'Y');                // marker para colapsar con ll
  t = t.replace(/Y/g, 'y');                // ll y y → 'y' (yeísmo)
  t = t.replace(/x/g, 's');                // x → s en la mayoría de casos ES
  t = t.replace(/X/g, 'ch');               // ch restaurado
  t = t.replace(/[wk]/g, 'k');
  // Reducir vocales (algunas implementaciones las eliminan al medio; mantenemos al inicio).
  if (t.length > 1) t = t[0] + t.slice(1).replace(/[aeiou]/g, '');
  // Eliminar duplicados consecutivos
  t = t.replace(/(.)\1+/g, '$1');
  return t;
}

// ===== Distancia ortográfica =====
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function trigramas(s) {
  if (!s || s.length < 3) return new Set([s]);
  const padded = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function similitudTrigramas(a, b) {
  const ta = trigramas(a), tb = trigramas(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

// ===== Clases relacionadas (Niza) =====
// Pares clásicos donde un titular puede oponerse aunque la clase no coincida exacto.
const RELACIONADAS = {
  9:  [42, 38, 41],
  25: [35, 18, 24],
  29: [30, 31, 43],
  30: [29, 32, 43],
  32: [33, 43],
  33: [32, 43],
  35: [9, 25, 36, 41],
  41: [9, 16, 38, 42],
  42: [9, 38, 41],
  43: [29, 30, 32, 33],
  44: [3, 5, 10],
  3:  [5, 44],
  5:  [3, 44, 10],
};

function relacionEntreClases(claseA, claseB) {
  if (!claseA || !claseB) return 'ninguna';
  if (claseA === claseB) return 'misma';
  const rel = RELACIONADAS[claseA] || [];
  if (rel.includes(claseB)) return 'relacionada';
  return 'ninguna';
}

// ===== Scoring =====
function calcularScore({ normMarca, normCandidata, foneticoMarca, foneticoCandidata, claseMarca, claseCandidata }) {
  let score = 0;
  const motivos = [];

  if (normMarca === normCandidata) {
    score = 100; motivos.push('coincidencia_exacta');
  } else if (foneticoMarca && foneticoMarca === foneticoCandidata) {
    score = 88; motivos.push('coincidencia_fonetica');
  } else {
    const dist = levenshtein(normMarca, normCandidata);
    const maxLen = Math.max(normMarca.length, normCandidata.length);
    const distRel = maxLen ? dist / maxLen : 1;
    const trig = similitudTrigramas(normMarca, normCandidata);

    if (dist <= 1 && maxLen >= 5) { score = Math.max(score, 85); motivos.push('casi_exacta'); }
    else if (distRel <= 0.2 && maxLen >= 5) { score = Math.max(score, 72); motivos.push('ortografica_cercana'); }

    if (trig >= 0.75) { score = Math.max(score, 75); motivos.push('trigramas_altos'); }
    else if (trig >= 0.55) { score = Math.max(score, 58); motivos.push('trigramas_medios'); }
  }

  if (claseMarca && claseCandidata) {
    const rel = relacionEntreClases(claseMarca, claseCandidata);
    if (rel === 'misma') { score += 8; motivos.push('misma_clase'); }
    else if (rel === 'relacionada') { score += 3; motivos.push('clase_relacionada'); }
    else { score -= 12; motivos.push('clase_distinta'); }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, motivos };
}

// ===== API pública =====
// candidatos: array de filas { denominacion, denominacion_norm?, clase, ...resto }
function matching(marca, claseMarca, candidatos, opciones = {}) {
  const minScore = opciones.minScore ?? 50;
  const normMarca = normalizar(marca);
  const foneticoMarca = codigoFonetico(marca);
  if (!normMarca) return [];

  const out = [];
  for (const c of candidatos) {
    const normCand = c.denominacion_norm || normalizar(c.denominacion);
    const fonCand = codigoFonetico(c.denominacion);
    const { score, motivos } = calcularScore({
      normMarca, normCandidata: normCand,
      foneticoMarca, foneticoCandidata: fonCand,
      claseMarca, claseCandidata: c.clase,
    });
    if (score >= minScore) {
      out.push({ ...c, score, motivos });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

module.exports = {
  normalizar, codigoFonetico, levenshtein, similitudTrigramas,
  relacionEntreClases, calcularScore, matching,
};
