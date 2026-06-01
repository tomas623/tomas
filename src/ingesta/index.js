// Pipeline de ingesta: parser → marcas_boletin + boletines.
// Idempotente por hash del archivo: si ya se ingirió el mismo PDF/CSV, no duplica.

const db = require('../db');
const { normalizar } = require('../matching/etapa1');
const audit = require('../audit');
const { parseBoletinFromFile } = require('./parser');

async function ingestar(filepath, { actorId } = {}) {
  const parsed = await parseBoletinFromFile(filepath);

  const ya = db.prepare('SELECT id FROM boletines WHERE hash = ?').get(parsed.hash);
  if (ya) {
    return { ok: true, boletin_id: ya.id, dedup: true, total_actas: 0, parsed };
  }

  const insBol = db.prepare(`
    INSERT INTO boletines (numero, fecha_publicacion, archivo, hash, estado, total_actas)
    VALUES (?, ?, ?, ?, 'procesando', 0)
  `).run(parsed.numero, parsed.fecha_publicacion, parsed.archivo, parsed.hash);
  const boletinId = insBol.lastInsertRowid;

  const insActa = db.prepare(`
    INSERT INTO marcas_boletin (boletin_id, acta, denominacion, denominacion_norm,
      clase, titular, tipo, estado, fecha, imagen_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      insActa.run(
        boletinId, r.acta, r.denominacion, normalizar(r.denominacion),
        r.clase, r.titular, r.tipo, r.estado, r.fecha,
      );
    }
  });
  tx(parsed.actas);

  db.prepare(`UPDATE boletines SET estado = 'procesado', total_actas = ? WHERE id = ?`)
    .run(parsed.actas.length, boletinId);

  audit.log(actorId || null, 'boletin.ingesta', {
    entidad: 'boletines', entidad_id: boletinId,
    detalle: { archivo: parsed.archivo, total_actas: parsed.actas.length, formato: parsed.formato },
  });

  return {
    ok: true, boletin_id: boletinId, dedup: false,
    total_actas: parsed.actas.length, warning: parsed.warning || null,
  };
}

module.exports = { ingestar };
