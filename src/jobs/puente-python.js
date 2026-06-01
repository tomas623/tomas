// Puente con la app Python: detecta boletines nuevos en `marcas.db` que no
// estén importados en el backend Node, importa sus actas, y dispara el
// monitoreo automáticamente para ese boletín.
//
// Se programa desde scheduler.js cuando PYTHON_DB_PATH está seteado.
// Default: cada hora en punto (configurable con CRON_PUENTE_PYTHON).

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');
const { normalizar } = require('../matching/etapa1');
const audit = require('../audit');
const { correr: correrMonitoreo } = require('./monitoreo-semanal');

function ts() { return new Date().toISOString(); }

async function correr({ notificar = true } = {}) {
  const pyPath = process.env.PYTHON_DB_PATH || '';
  if (!pyPath) return { ok: true, skipped: true, mensaje: 'PYTHON_DB_PATH vacío.' };
  if (!fs.existsSync(pyPath)) {
    console.log(`[puente-python] ${pyPath} no existe, skip.`);
    return { ok: true, skipped: true };
  }

  const py = new Database(pyPath, { readonly: true });
  const nuevos = py.prepare(`
    SELECT pl.numero, pl.fecha, pl.registros
    FROM boletin_log pl
    WHERE pl.status = 'ok'
      AND pl.numero NOT IN (SELECT CAST(numero AS INTEGER) FROM (
        SELECT numero FROM (
          SELECT 0 AS numero
        )
      ))
  `);

  // El subquery anterior es placeholder por si SQLite no soporta IN con valores
  // grandes. Hacemos el filtro en JS contra los ya conocidos.
  const yaImportados = new Set(
    db.prepare(`SELECT numero FROM boletines WHERE archivo LIKE 'python-import:%' OR archivo LIKE 'python-puente:%'`)
      .all().map(r => String(r.numero))
  );

  const todos = py.prepare(`SELECT numero, fecha, registros FROM boletin_log WHERE status = 'ok'`).all();
  const pendientes = todos.filter(b => !yaImportados.has(String(b.numero)));

  if (!pendientes.length) {
    py.close();
    return { ok: true, nuevos: 0, alertas: 0 };
  }

  console.log(`[puente-python] ${ts()} — detectados ${pendientes.length} boletín(es) nuevo(s).`);

  const insBol = db.prepare(`
    INSERT INTO boletines (numero, fecha_publicacion, archivo, hash, estado, total_actas)
    VALUES (?, ?, ?, ?, 'procesado', ?)
  `);
  const insMb = db.prepare(`
    INSERT INTO marcas_boletin (boletin_id, acta, denominacion, denominacion_norm,
      clase, titular, tipo, estado, fecha, imagen_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const insInpi = db.prepare(`
    INSERT OR IGNORE INTO marcas_inpi (denominacion, denominacion_norm, clase, acta, titular, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let totalAlertas = 0, totalActas = 0;

  for (const bol of pendientes) {
    const archivo = `python-puente:boletin-${bol.numero}`;
    const hash = `pypuente-${bol.numero}-${Date.now()}`;
    const insB = insBol.run(String(bol.numero), bol.fecha || null, archivo, hash, bol.registros || 0);
    const boletinId = insB.lastInsertRowid;

    const actas = py.prepare(`
      SELECT acta, denominacion, tipo, clase, titular, estado, fecha_solicitud
      FROM marcas WHERE boletin_num = ?
    `).all(bol.numero);

    const tx = db.transaction(() => {
      for (const a of actas) {
        const den = (a.denominacion || '').trim();
        if (!den || !a.clase) continue;
        const norm = normalizar(den);
        insInpi.run(den, norm, a.clase, a.acta || null, a.titular || null, a.estado || null);
        if (a.acta) {
          try { insMb.run(boletinId, a.acta, den, norm, a.clase, a.titular || null, a.tipo || 'denominativa', a.estado || null, a.fecha_solicitud || null); }
          catch (e) { if (!String(e.message).includes('UNIQUE')) throw e; }
        }
      }
    });
    tx();
    totalActas += actas.length;

    // Disparar monitoreo solo sobre este boletín (idempotente vía unique index).
    const r = await correrMonitoreo({ boletinId, notificar });
    totalAlertas += r.alertas;
    console.log(`[puente-python]   · boletín ${bol.numero} → ${actas.length} actas · ${r.alertas} alerta(s)`);
  }

  py.close();
  audit.log(null, 'puente.python.run', {
    detalle: { nuevos: pendientes.length, actas: totalActas, alertas: totalAlertas },
  });
  return { ok: true, nuevos: pendientes.length, actas: totalActas, alertas: totalAlertas };
}

module.exports = { correr };
