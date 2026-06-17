// Adaptador a la fuente de datos del INPI. Hoy lee de la tabla local marcas_inpi
// (cargada con `npm run seed`). Para enchufar la fuente real (export oficial, API)
// sólo hay que reemplazar el cuerpo de `cargarUniverso`.

const db = require('./db');
const { matching, normalizar } = require('./matching/etapa1');

// ===== Prefilter SQL =====
// Pre-2026: cargabamos TODAS las marcas a memoria (408K filas) y corríamos el
// matching en JS. La búsqueda global tardaba ~8 segundos.
//
// 2026: filtramos en SQL ANTES de pasar al matching. Estrategia:
//   - Para minScore ≥ 80 (match exacto o Levenshtein ≤ 1): primer carácter
//     idéntico + longitud ±2. Reduce ~408K → ~5K filas típicas.
//   - Para minScore más bajo (vigilancia, listaCorta): solo longitud ±3,
//     no filtramos por primer carácter porque pierde fonéticas (Cielo/Sielo,
//     Yamada/Llamada).
//   - Match EXACTO siempre se incluye con OR aparte (caso fonéticos exactos
//     y futuros que pueda matchear el motor).
//
// Resultado típico: pre-check global pasó de ~8700ms a <100ms.

function cargarUniverso(clases, denomNorm, opts = {}) {
  const conds = [];
  const params = [];

  const clasesArr = Array.isArray(clases) && clases.length ? clases.filter(Number.isFinite) : null;
  if (clasesArr && clasesArr.length) {
    conds.push(`clase IN (${clasesArr.map(() => '?').join(',')})`);
    params.push(...clasesArr);
  }

  if (denomNorm && denomNorm.length >= 2) {
    const primerChar = denomNorm[0];
    const len = denomNorm.length;
    const aggressive = opts.aggressive !== false;
    // Tolerancia de longitud: ±2 para minScore alto, ±4 para fonético amplio.
    const lenDelta = aggressive ? 2 : 4;
    const lenMin = Math.max(2, len - lenDelta);
    const lenMax = len + lenDelta;

    if (aggressive) {
      // Match exacto OR (primer char + longitud ±2)
      conds.push(`(
        denominacion_norm = ?
        OR (
          substr(denominacion_norm, 1, 1) = ?
          AND length(denominacion_norm) BETWEEN ? AND ?
        )
      )`);
      params.push(denomNorm, primerChar, lenMin, lenMax);
    } else {
      // Modo fonético-friendly: solo longitud (no filtramos por primer char
      // porque rompe Cielo/Sielo, Yamada/Llamada).
      conds.push(`(
        denominacion_norm = ?
        OR length(denominacion_norm) BETWEEN ? AND ?
      )`);
      params.push(denomNorm, lenMin, lenMax);
    }
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  return db.prepare(
    `SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
     FROM marcas_inpi ${where}`
  ).all(...params);
}

// Búsqueda usada por el pre-check (Parte 1). Devuelve hits exactos / casi-exactos
// en las clases consultadas. Si no se pasan clases, busca en todo el universo.
function buscarEnINPI(marca, clases) {
  // Normalizamos una vez y pasamos el prefilter a SQL — limita el universo de
  // ~408K a unos miles ANTES de pasar por el matching JS.
  const denomNorm = normalizar(marca);
  const universo = cargarUniverso(clases, denomNorm, { aggressive: true });
  return matching(marca, null, universo, { minScore: 80 })
    .map(r => ({ id: r.id, denominacion: r.denominacion, clase: r.clase, acta: r.acta, titular: r.titular, estado: r.estado, score: r.score, motivos: r.motivos }));
}

// Versión completa (todas las señales, fonéticas + ortográficas + trigramas) —
// la usa el motor de vigilancia interno y el preview del chequeo gratis cuando
// no hay match exacto.
function listaCorta(marca, clases, opciones) {
  const denomNorm = normalizar(marca);
  // Modo no-agresivo: aceptamos primer char distinto (para fonéticos como
  // Cielo/Sielo) pero filtramos por longitud para no traer 400K.
  const universo = cargarUniverso(clases, denomNorm, { aggressive: false });
  return matching(marca, clases?.[0] || null, universo, { minScore: opciones?.minScore ?? 55 });
}

// Busca la marca como PALABRA dentro de denominaciones compuestas. Las
// denominaciones del INPI a veces traen el solicitante embebido
// (ej: "MARTINEZ ELINA MARIA y otros DOLCE COCA") — el matching normal no
// detecta "DOLCE COCA" porque la normalización colapsa todo en un string largo.
// Acá usamos un LIKE sobre denominacion original con boundaries de palabra.
function buscarPalabraEmbebida(marca, clases) {
  const palabra = String(marca || '').trim();
  if (palabra.length < 3) return [];

  // Patrones: la palabra al inicio, al final, en el medio, o sola. Insensitive.
  const upper = palabra.toUpperCase();
  const conds = [];
  const params = [];

  const clasesArr = Array.isArray(clases) && clases.length ? clases.filter(Number.isFinite) : null;
  if (clasesArr && clasesArr.length) {
    conds.push(`clase IN (${clasesArr.map(() => '?').join(',')})`);
    params.push(...clasesArr);
  }

  // El campo denominacion en la DB suele estar en mayúsculas. Para boundaries
  // usamos espacios o caracteres no-alfanuméricos comunes (- / , .).
  conds.push(`(
    denominacion = ?
    OR denominacion LIKE ? OR denominacion LIKE ?
    OR denominacion LIKE ? OR denominacion LIKE ?
    OR denominacion LIKE ? OR denominacion LIKE ?
  )`);
  params.push(
    upper,
    `${upper} %`, `% ${upper}`,
    `% ${upper} %`,
    `${upper}-%`, `%-${upper}`, `%-${upper}-%`,
  );

  const where = 'WHERE ' + conds.join(' AND ');
  const rows = db.prepare(
    `SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
     FROM marcas_inpi ${where} LIMIT 50`
  ).all(...params);

  // Score 70 (medio-alto) para marcar como "necesita análisis", no como
  // bloqueo total. La palabra coincide pero en un contexto compuesto.
  return rows.map(r => ({
    id: r.id, denominacion: r.denominacion, clase: r.clase, acta: r.acta,
    titular: r.titular, estado: r.estado,
    score: r.denominacion === upper ? 95 : 70,
    motivos: r.denominacion === upper ? ['coincidencia_exacta'] : ['palabra_embebida'],
  }));
}

function enmascararActa(acta) {
  if (!acta) return 'REDACTADO';
  const s = String(acta);
  if (s.length <= 3) return 'XXXXXX';
  return `${s.slice(0, 2)}${'X'.repeat(Math.max(4, s.length - 2))}`;
}

// Enmascara la denominación para los teasers del pre-check gratis: deja visible
// la primera y la última letra y reemplaza el medio por • para que el usuario
// vea que hay algo similar pero el detalle quede para el informe pago.
function enmascararDenominacion(denom) {
  if (!denom) return '•••';
  const palabras = String(denom).split(/\s+/).filter(Boolean);
  return palabras.map(p => {
    if (p.length <= 2) return '••';
    if (p.length <= 4) return `${p[0]}${'•'.repeat(p.length - 1)}`;
    return `${p[0]}${'•'.repeat(p.length - 2)}${p[p.length - 1]}`;
  }).join(' ');
}

module.exports = { buscarEnINPI, listaCorta, buscarPalabraEmbebida, normalizar, enmascararActa, enmascararDenominacion };
