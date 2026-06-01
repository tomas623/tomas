// Portal del cliente — endpoints + middleware. Todo el cupo se valida en el server,
// nunca sólo en el front (BUILD_SPEC_MOTOR.md §1).

const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { normalizar } = require('./matching/etapa1');
const audit = require('./audit');

function ok(data) { return { ok: true, data }; }
function fail(msg, code = 400, extra) { return { ok: false, error: msg, code, ...(extra || {}) }; }

function packInfo(usuarioId) {
  const u = db.prepare(`
    SELECT u.id, u.email, u.nombre, u.rol, p.id AS pack_id, p.codigo AS pack_codigo,
           p.nombre AS pack_nombre, p.cupo_marcas
    FROM usuarios u LEFT JOIN packs p ON p.id = u.pack_id
    WHERE u.id = ?
  `).get(usuarioId);
  if (!u) return null;
  const cupo = u.cupo_marcas || 0;
  const activas = db.prepare(`
    SELECT COUNT(*) AS n FROM marcas_vigiladas WHERE usuario_id = ? AND estado = 'activa'
  `).get(usuarioId).n;
  return { ...u, marcas_activas: activas, cupo_disponible: Math.max(0, cupo - activas) };
}

function mountClienteRoutes(app) {
  const guard = requireAuth('cliente');

  // ===== Mi info + estado del pack =====
  app.get('/api/cliente/me', guard, (req, res) => {
    const info = packInfo(req.user.id);
    if (!info) return res.status(404).json(fail('Usuario no encontrado'));
    res.json(ok(info));
  });

  // ===== Mis marcas vigiladas =====
  app.get('/api/cliente/marcas', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT id, denominacion, clases, tipo, logo_path, estado, created_at
      FROM marcas_vigiladas WHERE usuario_id = ? ORDER BY id DESC
    `).all(req.user.id);
    res.json(ok({ marcas: rows, pack: packInfo(req.user.id) }));
  });

  // ===== Alta de marca a vigilancia =====
  app.post('/api/cliente/marcas', guard, (req, res) => {
    const { denominacion, clases, tipo = 'denominativa', logo_path = null } = req.body || {};
    if (!denominacion || !String(denominacion).trim()) {
      return res.status(400).json(fail('Falta la denominación'));
    }
    let clasesArr;
    if (Array.isArray(clases)) clasesArr = clases.map(Number).filter(Number.isFinite);
    else if (typeof clases === 'string') clasesArr = clases.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
    else clasesArr = [];
    if (!clasesArr.length) return res.status(400).json(fail('Indicá al menos una clase Niza'));
    if (!['denominativa', 'mixta', 'figurativa'].includes(tipo)) {
      return res.status(400).json(fail('Tipo inválido'));
    }

    const info = packInfo(req.user.id);
    if (!info) return res.status(404).json(fail('Usuario no encontrado'));
    if (!info.pack_id) {
      return res.status(403).json(fail('No tenés un pack de vigilancia asignado. Contactá a soporte.', 403, { necesita_pack: true }));
    }
    if (info.cupo_disponible <= 0) {
      return res.status(403).json(fail(
        `Llegaste al tope de tu pack (${info.cupo_marcas} marcas). Hacé upgrade para cargar más.`,
        403,
        { cupo_excedido: true, cupo_actual: info.cupo_marcas, marcas_activas: info.marcas_activas }
      ));
    }

    const den = String(denominacion).trim();
    const info2 = db.prepare(`
      INSERT INTO marcas_vigiladas (usuario_id, denominacion, denominacion_norm, clases, tipo, logo_path, estado)
      VALUES (?, ?, ?, ?, ?, ?, 'activa')
    `).run(req.user.id, den, normalizar(den), JSON.stringify(clasesArr), tipo, logo_path);

    audit.log(req.user.id, 'vigilancia.alta', {
      entidad: 'marcas_vigiladas', entidad_id: info2.lastInsertRowid,
      detalle: { denominacion: den, clases: clasesArr, tipo },
    });

    res.json(ok({
      id: info2.lastInsertRowid,
      denominacion: den, clases: clasesArr, tipo, estado: 'activa',
      pack: packInfo(req.user.id),
    }));
  });

  // ===== Pausar / reactivar marca =====
  app.patch('/api/cliente/marcas/:id', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { estado } = req.body || {};
    if (!['activa', 'pausada'].includes(estado)) {
      return res.status(400).json(fail('estado debe ser activa o pausada'));
    }
    const marca = db.prepare('SELECT * FROM marcas_vigiladas WHERE id = ? AND usuario_id = ?')
      .get(id, req.user.id);
    if (!marca) return res.status(404).json(fail('Marca no encontrada'));

    // Si se reactiva, validar cupo otra vez.
    if (estado === 'activa' && marca.estado !== 'activa') {
      const info = packInfo(req.user.id);
      if (info.cupo_disponible <= 0) {
        return res.status(403).json(fail(
          `No podés reactivar: tu pack permite hasta ${info.cupo_marcas} marcas activas.`,
          403, { cupo_excedido: true }
        ));
      }
    }

    db.prepare('UPDATE marcas_vigiladas SET estado = ? WHERE id = ?').run(estado, id);
    audit.log(req.user.id, 'vigilancia.cambio_estado',
      { entidad: 'marcas_vigiladas', entidad_id: id, detalle: { estado } });
    res.json(ok({ id, estado, pack: packInfo(req.user.id) }));
  });

  // ===== Baja de marca =====
  app.delete('/api/cliente/marcas/:id', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const marca = db.prepare('SELECT id, denominacion FROM marcas_vigiladas WHERE id = ? AND usuario_id = ?')
      .get(id, req.user.id);
    if (!marca) return res.status(404).json(fail('Marca no encontrada'));
    db.prepare('DELETE FROM marcas_vigiladas WHERE id = ?').run(id);
    audit.log(req.user.id, 'vigilancia.baja',
      { entidad: 'marcas_vigiladas', entidad_id: id, detalle: { denominacion: marca.denominacion } });
    res.json(ok({ id, pack: packInfo(req.user.id) }));
  });

  // ===== Mis alertas =====
  app.get('/api/cliente/alertas', guard, (req, res) => {
    const alertas = db.prepare(`
      SELECT a.id, a.nivel, a.notoria, a.estado, a.canal, a.fundamento,
             a.created_at, a.revisada_en,
             mv.denominacion AS marca, mv.clases AS marca_clases
      FROM alertas a JOIN marcas_vigiladas mv ON mv.id = a.marca_vigilada_id
      WHERE a.usuario_id = ?
      ORDER BY a.created_at DESC LIMIT 200
    `).all(req.user.id);

    // Para el cliente NO exponemos el JSON crudo de Gemini ni los motivos técnicos —
    // sólo nombre, clase y estado del candidato. El detalle queda en el panel admin.
    const candStmt = db.prepare(`
      SELECT mb.denominacion, mb.clase, mb.estado
      FROM alerta_candidatos ac
      LEFT JOIN marcas_boletin mb ON mb.id = ac.marca_boletin_id
      WHERE ac.alerta_id = ?
      ORDER BY ac.score DESC LIMIT 5
    `);
    for (const a of alertas) a.candidatos = candStmt.all(a.id);
    res.json(ok({ alertas }));
  });

  // ===== Catálogo de packs (para mostrar upgrade) =====
  app.get('/api/cliente/packs', guard, (req, res) => {
    const rows = db.prepare('SELECT codigo, nombre, cupo_marcas, precio_mensual FROM packs ORDER BY cupo_marcas ASC').all();
    res.json(ok({ packs: rows }));
  });
}

module.exports = { mountClienteRoutes, packInfo };
