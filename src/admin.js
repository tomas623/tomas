// Endpoints del panel admin — protegidos por requireAuth('admin','operador').
// Todo read-only excepto el cambio de estado de alertas.

const db = require('./db');
const { requireAuth } = require('./auth');
const audit = require('./audit');

function ok(data) { return { ok: true, data }; }
function fail(msg, code = 400) { return { ok: false, error: msg, code }; }

function mountAdminRoutes(app) {
  const guard = requireAuth('admin', 'operador');

  // ===== Resumen del dashboard =====
  app.get('/api/admin/resumen', guard, (req, res) => {
    const count = (sql) => db.prepare(sql).get()?.n || 0;
    res.json(ok({
      leads_total:        count(`SELECT COUNT(*) AS n FROM leads`),
      leads_pagados:      count(`SELECT COUNT(*) AS n FROM leads WHERE estado='pagado'`),
      leads_pendientes:   count(`SELECT COUNT(*) AS n FROM leads WHERE estado='pendiente'`),
      usuarios_total:     count(`SELECT COUNT(*) AS n FROM usuarios`),
      clientes:           count(`SELECT COUNT(*) AS n FROM usuarios WHERE rol='cliente'`),
      marcas_vigiladas:   count(`SELECT COUNT(*) AS n FROM marcas_vigiladas WHERE estado='activa'`),
      alertas_nuevas:     count(`SELECT COUNT(*) AS n FROM alertas WHERE estado='nueva'`),
      alertas_total:      count(`SELECT COUNT(*) AS n FROM alertas`),
      boletines:          count(`SELECT COUNT(*) AS n FROM boletines`),
      marcas_inpi:        count(`SELECT COUNT(*) AS n FROM marcas_inpi`),
    }));
  });

  // ===== Leads (de la Parte 1) =====
  app.get('/api/admin/leads', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT id, tipo, marca, email, telefono, clases, rubro, monto, estado,
             payment_ref, external_reference, pagado_at, created_at
      FROM leads ORDER BY id DESC LIMIT 500
    `).all();
    res.json(ok({ leads: rows }));
  });

  // ===== Usuarios =====
  app.get('/api/admin/usuarios', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT u.id, u.email, u.rol, u.nombre, u.telefono, u.activo, u.created_at,
             p.codigo AS pack_codigo, p.nombre AS pack_nombre, p.cupo_marcas
      FROM usuarios u LEFT JOIN packs p ON p.id = u.pack_id
      ORDER BY u.id DESC LIMIT 500
    `).all();
    res.json(ok({ usuarios: rows }));
  });

  // ===== Packs =====
  app.get('/api/admin/packs', guard, (req, res) => {
    const rows = db.prepare(`SELECT * FROM packs ORDER BY cupo_marcas ASC`).all();
    res.json(ok({ packs: rows }));
  });

  // ===== Marcas vigiladas (cartera) =====
  app.get('/api/admin/marcas-vigiladas', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT mv.id, mv.denominacion, mv.clases, mv.tipo, mv.estado, mv.created_at,
             u.id AS usuario_id, u.email AS usuario_email, u.nombre AS usuario_nombre
      FROM marcas_vigiladas mv JOIN usuarios u ON u.id = mv.usuario_id
      ORDER BY mv.id DESC LIMIT 500
    `).all();
    res.json(ok({ marcas: rows }));
  });

  // ===== Alertas — bandeja de revisión =====
  app.get('/api/admin/alertas', guard, (req, res) => {
    const estado = req.query.estado;
    let sql = `
      SELECT a.id, a.nivel, a.notoria, a.estado, a.canal, a.fundamento,
             a.created_at, a.revisada_en,
             mv.denominacion AS marca, mv.clases AS marca_clases,
             u.email AS usuario_email, u.nombre AS usuario_nombre,
             rev.email AS revisada_por_email
      FROM alertas a
      JOIN marcas_vigiladas mv ON mv.id = a.marca_vigilada_id
      JOIN usuarios u ON u.id = a.usuario_id
      LEFT JOIN usuarios rev ON rev.id = a.revisada_por
    `;
    const params = [];
    if (estado) { sql += ' WHERE a.estado = ?'; params.push(estado); }
    sql += " ORDER BY (a.estado = 'nueva') DESC, a.created_at DESC LIMIT 200";
    const alertas = db.prepare(sql).all(...params);

    const candStmt = db.prepare(`
      SELECT ac.id, ac.score, ac.motivo, ac.gemini_json,
             mb.denominacion, mb.clase, mb.acta, mb.titular, mb.estado
      FROM alerta_candidatos ac
      LEFT JOIN marcas_boletin mb ON mb.id = ac.marca_boletin_id
      WHERE ac.alerta_id = ?
      ORDER BY ac.score DESC
    `);
    for (const a of alertas) {
      a.candidatos = candStmt.all(a.id).map(c => {
        let gemini = null;
        if (c.gemini_json) { try { gemini = JSON.parse(c.gemini_json); } catch {} }
        return { ...c, gemini_json: undefined, gemini };
      });
    }
    res.json(ok({ alertas }));
  });

  // ===== Cambiar estado de una alerta =====
  app.patch('/api/admin/alertas/:id', guard, express.json(), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { estado } = req.body || {};
    const validos = ['nueva', 'revisada', 'accion_tomada', 'descartada'];
    if (!validos.includes(estado)) return res.status(400).json(fail('estado inválido'));
    const exists = db.prepare('SELECT id FROM alertas WHERE id = ?').get(id);
    if (!exists) return res.status(404).json(fail('alerta no encontrada'));
    db.prepare(`
      UPDATE alertas SET estado = ?, revisada_por = ?, revisada_en = datetime('now') WHERE id = ?
    `).run(estado, req.user.id, id);
    audit.log(req.user.id, 'alerta.cambio_estado', { entidad: 'alertas', entidad_id: id, detalle: { estado } });
    res.json(ok({ id, estado }));
  });

  // ===== Audit log =====
  app.get('/api/admin/audit', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT a.id, a.accion, a.entidad, a.entidad_id, a.detalle, a.created_at,
             u.email AS actor_email, u.rol AS actor_rol
      FROM audit_log a LEFT JOIN usuarios u ON u.id = a.actor_id
      WHERE a.accion != 'gemini_cache'
      ORDER BY a.id DESC LIMIT 200
    `).all();
    res.json(ok({ audit: rows }));
  });

  // ===== Upload one-shot de marcas.db (DB de la app Python heredada) =====
  // Protegido con ADMIN_TOKEN para que nadie pise el archivo. Recibe el .db
  // crudo en el body, lo guarda en /app/data/marcas.db y dispara import-python
  // en background. Pensado para uso UNA vez por instalación; conviene
  // remover el endpoint después de usar.
  app.post('/api/admin/upload-db', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    const adminToken = (process.env.ADMIN_TOKEN || '').trim();
    if (!adminToken) return res.status(503).json(fail('ADMIN_TOKEN no configurado en el server'));
    const provided = req.headers['x-admin-token'] || req.query.token;
    if (provided !== adminToken) return res.status(401).json(fail('admin token inválido'));

    if (!req.body || !req.body.length) return res.status(400).json(fail('body vacío'));

    const fs = require('fs');
    const path = require('path');
    const target = process.env.PYTHON_DB_PATH || '/app/data/marcas.db';
    const dir = path.dirname(target);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    try {
      fs.writeFileSync(target, req.body);
    } catch (err) {
      return res.status(500).json(fail(`No pude escribir en ${target}: ${err.message}`));
    }
    const sizeMB = (req.body.length / (1024 * 1024)).toFixed(1);
    console.log(`[upload-db] recibido ${sizeMB} MB en ${target}`);

    audit.log(null, 'upload-db', { detalle: { target, size_bytes: req.body.length } });

    // Disparar el import en background, no bloqueamos la respuesta HTTP.
    res.json(ok({
      saved: target,
      size_mb: parseFloat(sizeMB),
      import_started: true,
      nota: 'El import corre en background (~30s). Mirá los Deploy Logs para ver el progreso.',
    }));

    setImmediate(() => {
      const { spawn } = require('child_process');
      const env = { ...process.env, PYTHON_DB_PATH: target };
      const child = spawn('node', [path.join(__dirname, 'import-python-db.js')], { env, stdio: 'inherit' });
      child.on('exit', (code) => console.log(`[upload-db] import-python terminó con código ${code}`));
    });
  });
  app.get('/api/admin/boletines', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT id, numero, fecha_publicacion, archivo, estado, total_actas, created_at
      FROM boletines ORDER BY id DESC LIMIT 100
    `).all();
    res.json(ok({ boletines: rows }));
  });

  // Ingestar un boletín por path (CSV o PDF presente en el filesystem del server).
  app.post('/api/admin/boletines/ingestar', guard, async (req, res) => {
    const { archivo } = req.body || {};
    if (!archivo) return res.status(400).json(fail('Falta "archivo" (path del CSV/PDF)'));
    try {
      const { ingestar } = require('./ingesta');
      const r = await ingestar(archivo, { actorId: req.user.id });
      res.json(ok(r));
    } catch (err) {
      res.status(500).json(fail(err.message, 500));
    }
  });

  // Estado del scheduler.
  app.get('/api/admin/scheduler', guard, (req, res) => {
    const { estado } = require('./jobs/scheduler');
    res.json(ok(estado()));
  });

  // Correr el monitoreo semanal a demanda.
  app.post('/api/admin/monitoreo/run', guard, async (req, res) => {
    try {
      const { correr } = require('./jobs/monitoreo-semanal');
      const r = await correr({ boletinId: req.body?.boletin_id || null, actorId: req.user.id });
      res.json(ok(r));
    } catch (err) {
      res.status(500).json(fail(err.message, 500));
    }
  });
}

// hoist al require de express para no romper si server.js no lo pasa.
const express = require('express');

module.exports = { mountAdminRoutes };
