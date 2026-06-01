const db = require('./db');

const SUFIJOS_SOCIETARIOS = [
  'sa', 'srl', 'sas', 'sca', 'scs', 'sociedad anonima', 'sociedad anónima',
  'sociedad de responsabilidad limitada', 's a', 's r l', 's a s',
];

function normalizar(texto) {
  if (!texto) return '';
  let t = String(texto).toLowerCase().trim();
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const suf of SUFIJOS_SOCIETARIOS) {
    const re = new RegExp(`(^|\\s)${suf}(\\s|$)`, 'g');
    t = t.replace(re, ' ');
  }
  t = t.replace(/\s+/g, '').trim();
  return t;
}

function distanciaLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}

function esCasiExacta(normA, normB) {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen < 5) return false;
  const dist = distanciaLevenshtein(normA, normB);
  return dist <= 1;
}

function buscarEnINPI(marca, clases) {
  const norm = normalizar(marca);
  if (!norm) return [];
  const clasesArr = Array.isArray(clases) && clases.length ? clases : null;

  let rows;
  if (clasesArr) {
    const placeholders = clasesArr.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
       FROM marcas_inpi WHERE clase IN (${placeholders})`
    ).all(...clasesArr);
  } else {
    rows = db.prepare(
      `SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
       FROM marcas_inpi`
    ).all();
  }

  const hits = [];
  for (const r of rows) {
    if (esCasiExacta(norm, r.denominacion_norm)) {
      hits.push({
        denominacion: r.denominacion,
        clase: r.clase,
        acta: r.acta,
        titular: r.titular,
        estado: r.estado || 'Concedida',
      });
    }
  }
  return hits;
}

function enmascararActa(acta) {
  if (!acta) return 'REDACTADO';
  const s = String(acta);
  if (s.length <= 3) return 'XXXXXX';
  return `${s.slice(0, 2)}${'X'.repeat(Math.max(4, s.length - 2))}`;
}

module.exports = { buscarEnINPI, normalizar, enmascararActa };
