#!/usr/bin/env node
// Importa boletines + actas desde la DB SQLite de la app Python (`marcas.db`)
// a las tablas del backend Node (`marcas_inpi`, `boletines`, `marcas_boletin`).
//
// Uso:
//   PYTHON_DB_PATH=./marcas.db npm run import-python
//   PYTHON_DB_PATH=./marcas.db npm run import-python -- --limit 5000   (smoke test)
//   PYTHON_DB_PATH=./marcas.db npm run import-python -- --no-boletin   (solo marcas_inpi)
//
// Idempotente: si ya importó algo, dedup por (boletin.numero) y (acta, clase).

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const db = require('./db');
const { normalizar } = require('./matching/etapa1');
const audit = require('./audit');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(`[${ts()}] [import]`, ...a); }

async function main() {
  const args = process.argv.slice(2);
  let limit = null, importBoletin = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') limit = parseInt(args[++i], 10);
    if (args[i] === '--no-boletin') importBoletin = false;
  }

  const pyPath = process.env.PYTHON_DB_PATH || path.resolve('marcas.db');
  if (!fs.existsSync(pyPath)) {
    console.error(`[import] No existe ${pyPath}. Setealo con PYTHON_DB_PATH en .env.`);
    process.exit(1);
  }
  log(`Leyendo desde ${pyPath}`);
  const py = new Database(pyPath, { readonly: true });

  // ============== 1) BOLETINES ==============
  let boletinByNumero = new Map();
  if (importBoletin) {
    const bolPy = py.prepare(`
      SELECT numero, fecha, registros, status FROM boletin_log
      WHERE status = 'ok' ORDER BY numero ASC
    `).all();
    log(`Boletines en Python: ${bolPy.length}`);

    const existing = db.prepare('SELECT id, numero FROM boletines').all();
    for (const b of existing) if (b.numero != null) boletinByNumero.set(String(b.numero), b.id);

    const ins = db.prepare(`
      INSERT INTO boletines (numero, fecha_publicacion, archivo, hash, estado, total_actas)
      VALUES (?, ?, ?, ?, 'procesado', ?)
    `);
    const tx = db.transaction(() => {
      let n = 0;
      for (const b of bolPy) {
        if (boletinByNumero.has(String(b.numero))) continue;
        const archivo = `python-import:boletin-${b.numero}`;
        const hash = `pyimp-${b.numero}`;
        const r = ins.run(String(b.numero), b.fecha || null, archivo, hash, b.registros || 0);
        boletinByNumero.set(String(b.numero), r.lastInsertRowid);
        n++;
      }
      return n;
    });
    const insertados = tx();
    log(`Boletines insertados: ${insertados} (ya existían: ${bolPy.length - insertados})`);
  }

  // ============== 2) MARCAS → marcas_inpi + marcas_boletin ==============
  const totalRow = py.prepare('SELECT COUNT(*) AS n FROM marcas').get();
  const total = limit ? Math.min(limit, totalRow.n) : totalRow.n;
  log(`Marcas a procesar: ${total.toLocaleString()}`);

  const insInpi = db.prepare(`
    INSERT OR IGNORE INTO marcas_inpi (denominacion, denominacion_norm, clase, acta, titular, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insBol = db.prepare(`
    INSERT INTO marcas_boletin (boletin_id, acta, denominacion, denominacion_norm,
      clase, titular, tipo, estado, fecha, imagen_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  // Dedup de marcas_inpi: una marca puede aparecer N veces en distintos boletines.
  // Para el pre-check sólo importa el par (acta, clase) único. Usamos un índice
  // único parcial; si ya existe el índice no rompemos, si no lo creamos.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_marcas_inpi_acta_clase
             ON marcas_inpi(acta, clase) WHERE acta IS NOT NULL`);
  } catch (e) { log('Aviso al crear índice único:', e.message); }

  // marcas_boletin: dedup por (boletin_id, acta).
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_marcas_boletin
             ON marcas_boletin(boletin_id, acta) WHERE acta IS NOT NULL`);
  } catch (e) { log('Aviso al crear índice único:', e.message); }

  const stmt = py.prepare(`
    SELECT acta, denominacion, tipo, clase, titular, estado, boletin_num
    FROM marcas ${limit ? `LIMIT ${limit}` : ''}
  `);

  const BATCH = 5000;
  let buf = [];
  let procesadas = 0, insertadasInpi = 0, insertadasBol = 0, omitidas = 0;
  const t0 = Date.now();

  const procesarBatch = db.transaction((rows) => {
    for (const r of rows) {
      const denom = (r.denominacion || '').trim();
      if (!denom || !r.clase) { omitidas++; continue; }
      const norm = normalizar(denom);

      const a = insInpi.run(denom, norm, r.clase, r.acta || null, r.titular || null, r.estado || null);
      if (a.changes > 0) insertadasInpi++;

      if (importBoletin && r.boletin_num != null) {
        const boletinId = boletinByNumero.get(String(r.boletin_num));
        if (boletinId && r.acta) {
          try {
            insBol.run(boletinId, r.acta, denom, norm, r.clase,
              r.titular || null, r.tipo || 'denominativa', r.estado || null, null);
            insertadasBol++;
          } catch (e) {
            if (!String(e.message).includes('UNIQUE')) throw e;
          }
        }
      }
    }
  });

  for (const row of stmt.iterate()) {
    buf.push(row);
    if (buf.length >= BATCH) {
      procesarBatch(buf);
      procesadas += buf.length;
      buf = [];
      if (procesadas % 50000 === 0 || procesadas === total) {
        const pct = ((procesadas / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        log(`  ${procesadas.toLocaleString()} / ${total.toLocaleString()} (${pct}%) · inpi=${insertadasInpi.toLocaleString()} · bol=${insertadasBol.toLocaleString()} · ${elapsed}s`);
      }
    }
  }
  if (buf.length) {
    procesarBatch(buf);
    procesadas += buf.length;
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  log(`✓ Procesadas ${procesadas.toLocaleString()} en ${dur}s`);
  log(`  · marcas_inpi insertadas:    ${insertadasInpi.toLocaleString()} (resto ya existía)`);
  log(`  · marcas_boletin insertadas: ${insertadasBol.toLocaleString()}`);
  log(`  · omitidas (sin denom/clase): ${omitidas.toLocaleString()}`);

  audit.log(null, 'import.python', {
    detalle: {
      source: pyPath, procesadas, insertadasInpi, insertadasBol, omitidas,
      duracion_s: parseFloat(dur),
    },
  });

  py.close();
  log('Listo.');
}

main().catch(err => { console.error('[import] ERROR:', err); process.exit(1); });
