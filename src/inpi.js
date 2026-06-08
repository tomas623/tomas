// Adaptador a la fuente de datos del INPI. Hoy lee de la tabla local marcas_inpi
// (cargada con `npm run seed`). Para enchufar la fuente real (export oficial, API)
// sólo hay que reemplazar el cuerpo de `cargarUniverso`.

const db = require('./db');
const { matching, normalizar } = require('./matching/etapa1');

function cargarUniverso(clases) {
  const clasesArr = Array.isArray(clases) && clases.length ? clases.filter(Number.isFinite) : null;
  if (clasesArr && clasesArr.length) {
    const placeholders = clasesArr.map(() => '?').join(',');
    return db.prepare(
      `SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
       FROM marcas_inpi WHERE clase IN (${placeholders})`
    ).all(...clasesArr);
  }
  return db.prepare(
    `SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
     FROM marcas_inpi`
  ).all();
}

// Búsqueda usada por el pre-check (Parte 1). Devuelve hits exactos / casi-exactos
// en las clases consultadas. Si no se pasan clases, busca en todo el universo.
function buscarEnINPI(marca, clases) {
  const universo = cargarUniverso(clases);
  // Usamos minScore alto para mantener el espíritu "sólo coincidencias exactas o casi"
  // del pre-check gratis (la fonética profunda es valor del informe pago).
  return matching(marca, null, universo, { minScore: 80 })
    .map(r => ({ id: r.id, denominacion: r.denominacion, clase: r.clase, acta: r.acta, titular: r.titular, estado: r.estado, score: r.score, motivos: r.motivos }));
}

// Versión completa (todas las señales, fonéticas + ortográficas + trigramas) —
// la usa el motor de vigilancia interno, no el pre-check público.
function listaCorta(marca, clases, opciones) {
  const universo = cargarUniverso(clases);
  return matching(marca, clases?.[0] || null, universo, { minScore: opciones?.minScore ?? 55 });
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

module.exports = { buscarEnINPI, listaCorta, normalizar, enmascararActa, enmascararDenominacion };
