const db = require('./db');

function log(actorId, accion, { entidad, entidad_id, detalle } = {}) {
  db.prepare(`
    INSERT INTO audit_log (actor_id, accion, entidad, entidad_id, detalle)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    actorId || null,
    accion,
    entidad || null,
    entidad_id || null,
    detalle ? (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)) : null,
  );
}

module.exports = { log };
