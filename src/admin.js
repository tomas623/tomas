// Endpoints del panel admin — protegidos por requireAuth('admin','operador').
// Todo read-only excepto el cambio de estado de alertas.

const fs = require('fs');
const path = require('path');
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
      informes_cola:      count(`SELECT COUNT(*) AS n FROM informes WHERE estado IN ('borrador','generando','error')`),
      informes_enviados:  count(`SELECT COUNT(*) AS n FROM informes WHERE estado='enviado'`),
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

  // ===== Informes pagos — cola de revisión =====
  app.get('/api/admin/informes', guard, (req, res) => {
    const estado = req.query.estado;
    let sql = `
      SELECT i.id, i.lead_id, i.marca, i.tipo, i.clases, i.rubro,
             i.solicitante, i.email,
             i.nivel_riesgo, i.viabilidad_estimada,
             i.estado, i.pdf_bytes, i.error_msg,
             i.generado_at, i.revisado_at, i.enviado_at, i.created_at,
             i.revisor_email
      FROM informes i
    `;
    const params = [];
    if (estado) { sql += ' WHERE i.estado = ?'; params.push(estado); }
    sql += ` ORDER BY
      CASE i.estado
        WHEN 'generando' THEN 1
        WHEN 'borrador'  THEN 2
        WHEN 'error'     THEN 3
        WHEN 'revisado'  THEN 4
        WHEN 'enviado'   THEN 5
        ELSE 9
      END, i.created_at DESC LIMIT 200`;
    res.json(ok({ informes: db.prepare(sql).all(...params) }));
  });

  app.get('/api/admin/informes/:id', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));
    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    res.json(ok({
      informe: {
        ...row,
        informe_json: parse(row.informe_json),
        dominios_json: parse(row.dominios_json),
        redes_json: parse(row.redes_json),
        flags_leyes: parse(row.flags_leyes),
      },
    }));
  });

  // Descarga del PDF generado.
  app.get('/api/admin/informes/:id/pdf', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT marca, pdf_path FROM informes WHERE id = ?').get(id);
    if (!row || !row.pdf_path) return res.status(404).json(fail('PDF no disponible'));
    if (!fs.existsSync(row.pdf_path)) return res.status(404).json(fail('PDF no existe en disco'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="informe-${row.marca}-${id}.pdf"`);
    fs.createReadStream(row.pdf_path).pipe(res);
  });

  // Editar campos del informe antes de enviarlo (solicitante, email, JSON, notas).
  app.patch('/api/admin/informes/:id', guard, express.json({ limit: '2mb' }), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT estado FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));
    if (row.estado === 'enviado') return res.status(409).json(fail('No se puede editar un informe ya enviado'));

    const { solicitante, email, rubro, notas_revision, informe_json } = req.body || {};
    const sets = [];
    const vals = [];
    if (solicitante !== undefined)    { sets.push('solicitante = ?');    vals.push(solicitante || null); }
    if (email !== undefined)          { sets.push('email = ?');          vals.push(email || null); }
    if (rubro !== undefined)          { sets.push('rubro = ?');          vals.push(rubro || null); }
    if (notas_revision !== undefined) { sets.push('notas_revision = ?'); vals.push(notas_revision || null); }
    if (informe_json !== undefined) {
      // Validamos que sea JSON válido y actualizamos los campos denormalizados.
      let parsed;
      try { parsed = typeof informe_json === 'string' ? JSON.parse(informe_json) : informe_json; }
      catch (e) { return res.status(400).json(fail('informe_json no es JSON válido')); }
      sets.push('informe_json = ?');         vals.push(JSON.stringify(parsed));
      sets.push('nivel_riesgo = ?');         vals.push(parsed.nivel_riesgo || null);
      sets.push('viabilidad_estimada = ?');  vals.push(
        typeof parsed.viabilidad_estimada === 'number' ? parsed.viabilidad_estimada : null,
      );
    }
    if (!sets.length) return res.status(400).json(fail('Nada que actualizar'));
    vals.push(id);
    db.prepare(`UPDATE informes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(req.user.id, 'informe.editado', { entidad: 'informes', entidad_id: id });
    res.json(ok({ id }));
  });

  // Regenera el PDF con los datos actuales del informe (útil después de un PATCH).
  app.post('/api/admin/informes/:id/regenerar-pdf', guard, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));
    if (row.estado === 'enviado') return res.status(409).json(fail('Informe ya enviado'));
    try {
      const informe = JSON.parse(row.informe_json || '{}');
      const dominios = row.dominios_json ? JSON.parse(row.dominios_json) : null;
      const redes = row.redes_json ? JSON.parse(row.redes_json) : null;
      const clases = (() => { try { return JSON.parse(row.clases || '[]'); } catch { return []; } })();

      const { generarPDF } = require('./pdf/informe-pdf');
      const buf = await generarPDF(
        informe,
        {
          email: row.email,
          solicitante: row.solicitante || row.email,
          marca: row.marca,
          tipo: row.tipo || 'Denominativa',
          clases,
          rubro: row.rubro || '',
        },
        { dominios, redes },
      );
      const pdfPath = row.pdf_path || path.join(
        __dirname, '..', 'data', 'informes', `informe-${id}.pdf`,
      );
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      fs.writeFileSync(pdfPath, buf);
      db.prepare('UPDATE informes SET pdf_path = ?, pdf_bytes = ? WHERE id = ?')
        .run(pdfPath, buf.length, id);
      audit.log(req.user.id, 'informe.pdf_regenerado', { entidad: 'informes', entidad_id: id });
      res.json(ok({ id, pdf_bytes: buf.length }));
    } catch (err) {
      console.error('[admin] regenerar-pdf:', err);
      res.status(500).json(fail(err.message));
    }
  });

  // Aprueba el informe y se lo manda al cliente como adjunto.
  app.post('/api/admin/informes/:id/aprobar-y-enviar', guard, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));
    if (row.estado === 'enviado') return res.status(409).json(fail('Ya enviado'));
    if (!row.email) return res.status(400).json(fail('Falta el email del cliente'));
    if (!row.pdf_path || !fs.existsSync(row.pdf_path)) {
      return res.status(400).json(fail('No hay PDF generado para enviar'));
    }

    const { enviarMailGenerico } = require('./notificaciones');
    const informe = (() => { try { return JSON.parse(row.informe_json || '{}'); } catch { return {}; } })();
    const nivel = informe.nivel_riesgo || row.nivel_riesgo || 'medio';
    const colorNivel = nivel === 'alto' ? '#dc2626' : nivel === 'medio' ? '#d97706' : '#059669';

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
        <h2 style="color:#1B6EF3">Tu informe de viabilidad está listo</h2>
        <p>Hola${row.solicitante ? ' ' + row.solicitante : ''},</p>
        <p>Adjuntamos el informe de viabilidad de registro de tu marca
           <strong>${row.marca}</strong>.</p>
        <p><strong>Nivel de riesgo:</strong>
          <span style="color:${colorNivel};font-weight:600">${nivel.toUpperCase()}</span>
          ${row.viabilidad_estimada != null ? ` · Viabilidad estimada: ${row.viabilidad_estimada}%` : ''}
        </p>
        <p>Cualquier consulta, podés respondernos directamente a este mail o agendarte
           una reunión con un abogado en
           <a href="https://calendar.app.google/rx6vHWyyjFoEr7Vx9">este link</a>.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="font-size:12px;color:#64748b">
          LegalPacers · Consultora de Propiedad Industrial<br>
          contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
        </p>
      </div>`;

    const pdfBuf = fs.readFileSync(row.pdf_path);
    const result = await enviarMailGenerico({
      to: row.email,
      subject: `Tu informe de viabilidad — ${row.marca}`,
      html,
      attachments: [{
        filename: `informe-${row.marca.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`,
        content: pdfBuf,
      }],
      tag: 'informe_pagado',
    });

    if (!result.ok) {
      audit.log(req.user.id, 'informe.envio_fallo', { entidad: 'informes', entidad_id: id, detalle: result.error });
      return res.status(502).json(fail(`No se pudo enviar: ${result.error}`));
    }

    db.prepare(`
      UPDATE informes SET
        estado = 'enviado',
        revisor_email = ?,
        revisado_at = COALESCE(revisado_at, datetime('now')),
        enviado_at = datetime('now')
      WHERE id = ?
    `).run(req.user.email, id);
    audit.log(req.user.id, 'informe.enviado', { entidad: 'informes', entidad_id: id, detalle: row.email });
    res.json(ok({ id, estado: 'enviado', stub: !!result.stub }));
  });

  // Reintenta la generación si quedó en 'error'.
  app.post('/api/admin/informes/:id/reintentar', guard, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT lead_id, estado FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));
    if (row.estado !== 'error') return res.status(409).json(fail(`Estado actual: ${row.estado}`));
    if (!row.lead_id) return res.status(400).json(fail('Informe sin lead asociado'));
    // Borrar el informe en error y reprocesar.
    db.prepare('DELETE FROM informes WHERE id = ?').run(id);
    const { procesarInformePago } = require('./jobs/informe-pago');
    setImmediate(() => procesarInformePago(row.lead_id).catch(err =>
      console.error(`[admin] reintento informe lead ${row.lead_id}:`, err),
    ));
    audit.log(req.user.id, 'informe.reintentado', { entidad: 'informes', entidad_id: id });
    res.json(ok({ reprocessing: true, lead_id: row.lead_id }));
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

  // ===== Boletines =====
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
