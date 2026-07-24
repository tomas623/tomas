// Endpoints del panel admin — protegidos por requireAuth('admin','operador').
// Todo read-only excepto el cambio de estado de alertas.

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { requireAuth } = require('./auth');
const audit = require('./audit');

function ok(data) { return { ok: true, data }; }
function fail(msg, code = 400) { return { ok: false, error: msg, code }; }

// HTML del mail con el informe listo para el cliente (usado al aprobar y al
// reenviar). row = fila de informes.
function htmlInformeListo(row) {
  const informe = (() => { try { return JSON.parse(row.informe_json || '{}'); } catch { return {}; } })();
  const nivel = informe.nivel_riesgo || row.nivel_riesgo || 'medio';
  const colorNivel = nivel === 'alto' ? '#dc2626' : nivel === 'medio' ? '#d97706' : '#059669';
  return `
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
}

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
      alertas_nuevas:     count(`SELECT COUNT(*) AS n FROM alertas WHERE estado IN ('nueva','pendiente_revision')`),
      alertas_pendientes: count(`SELECT COUNT(*) AS n FROM alertas WHERE estado='pendiente_revision'`),
      alertas_total:      count(`SELECT COUNT(*) AS n FROM alertas`),
      hitos_proximos:     count(`SELECT COUNT(*) AS n FROM marcas_vigiladas WHERE fecha_concesion IS NOT NULL AND (date(fecha_concesion,'+5 years') <= date('now','+180 days') OR date(fecha_concesion,'+10 years') <= date('now','+180 days'))`),
      boletines:          count(`SELECT COUNT(*) AS n FROM boletines`),
      marcas_inpi:        count(`SELECT COUNT(*) AS n FROM marcas_inpi`),
      informes_cola:      count(`SELECT COUNT(*) AS n FROM informes WHERE estado IN ('borrador','generando','error')`),
      informes_enviados:  count(`SELECT COUNT(*) AS n FROM informes WHERE estado='enviado'`),
      chequeos_total:     count(`SELECT COUNT(*) AS n FROM chequeos`),
      chequeos_hoy:       count(`SELECT COUNT(*) AS n FROM chequeos WHERE date(created_at) = date('now')`),
      chequeos_7d:        count(`SELECT COUNT(*) AS n FROM chequeos WHERE created_at >= datetime('now','-7 days')`),
      chequeos_con_email: count(`SELECT COUNT(*) AS n FROM chequeos WHERE con_email = 1`),
    }));
  });

  // ===== Chequeos gratuitos (incluye anónimos) — demanda real =====
  app.get('/api/admin/chequeos', guard, (req, res) => {
    const recientes = db.prepare(`
      SELECT id, marca, clases, rubro, veredicto, riesgo, con_email,
             utm_source, utm_medium, utm_campaign, created_at
      FROM chequeos ORDER BY id DESC LIMIT 200
    `).all();
    const topMarcas = db.prepare(`
      SELECT marca, COUNT(*) AS veces, MAX(created_at) AS ultimo
      FROM chequeos GROUP BY lower(marca) ORDER BY veces DESC, ultimo DESC LIMIT 20
    `).all();
    const porVeredicto = db.prepare(`
      SELECT veredicto, COUNT(*) AS n FROM chequeos GROUP BY veredicto
    `).all();
    const porOrigen = db.prepare(`
      SELECT COALESCE(utm_source, 'directo') AS origen, COUNT(*) AS n
      FROM chequeos GROUP BY COALESCE(utm_source, 'directo') ORDER BY n DESC
    `).all();
    res.json(ok({ recientes, topMarcas, porVeredicto, porOrigen }));
  });

  // ===== Leads + CRM-lite =====
  // Filtros por query: ?tipo=, ?pipeline=, ?accion_pendiente=1
  app.get('/api/admin/leads', guard, (req, res) => {
    const { tipo, pipeline, accion_pendiente } = req.query;
    const where = [];
    const params = [];
    if (tipo) { where.push('l.tipo = ?'); params.push(tipo); }
    if (pipeline) { where.push('l.pipeline_estado = ?'); params.push(pipeline); }
    if (accion_pendiente === '1') {
      where.push(`(l.proximo_contacto_at IS NOT NULL AND l.proximo_contacto_at <= datetime('now'))`);
    }
    const sql = `
      SELECT l.id, l.tipo, l.marca, l.email, l.telefono, l.clases, l.rubro, l.monto, l.estado,
             l.payment_ref, l.external_reference, l.pagado_at, l.created_at,
             l.pipeline_estado, l.notas, l.proximo_contacto_at, l.asignado_a, l.follow_up_at,
             l.veredicto_free, l.riesgo_free,
             l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term,
             u.email AS asignado_email
      FROM leads l
      LEFT JOIN usuarios u ON u.id = l.asignado_a
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY l.id DESC LIMIT 500
    `;
    res.json(ok({ leads: db.prepare(sql).all(...params) }));
  });

  // Detalle de un lead — incluye historial del audit log y eventual informe.
  app.get('/api/admin/leads/:id', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare(`
      SELECT l.*, u.email AS asignado_email
      FROM leads l LEFT JOIN usuarios u ON u.id = l.asignado_a
      WHERE l.id = ?
    `).get(id);
    if (!lead) return res.status(404).json(fail('Lead no encontrado'));
    const informe = db.prepare(`
      SELECT id, estado, nivel_riesgo, viabilidad_estimada, enviado_at, created_at
      FROM informes WHERE lead_id = ? ORDER BY id DESC LIMIT 1
    `).get(id);
    const historial = db.prepare(`
      SELECT id, accion, detalle, created_at FROM audit_log
      WHERE entidad = 'leads' AND entidad_id = ? ORDER BY id DESC LIMIT 50
    `).all(id);
    res.json(ok({ lead, informe, historial }));
  });

  // Confirmación MANUAL de pago — rescate para cuando el webhook de MP no marcó
  // el lead como pagado (links de pago que no devuelven el external_reference).
  // Marca pagado y, si es informe, dispara la generación del borrador.
  app.post('/api/admin/leads/:id/confirmar-pago', guard, express.json(), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!lead) return res.status(404).json(fail('Lead no encontrado'));
    if (lead.estado !== 'pagado') {
      db.prepare("UPDATE leads SET estado = 'pagado', pagado_at = COALESCE(pagado_at, datetime('now')) WHERE id = ?").run(id);
    }
    audit.log(req.user.id, 'lead.pago_confirmado_manual', {
      entidad: 'leads', entidad_id: id, detalle: { marca: lead.marca, tipo: lead.tipo },
    });
    let informe = null;
    if (lead.tipo === 'informe') {
      try {
        const { procesarInformePago } = require('./jobs/informe-pago');
        informe = await procesarInformePago(id, { notificarCliente: true });
      } catch (err) {
        console.error(`[admin] confirmar-pago informe lead ${id}:`, err);
        return res.status(500).json(fail('Se marcó pagado pero falló la generación: ' + err.message));
      }
    } else if (lead.tipo === 'registro' && lead.email) {
      const { enviarConfirmacionRegistro } = require('./notificaciones');
      await enviarConfirmacionRegistro({ email: lead.email, marca: lead.marca, solicitante: lead.solicitante, ref: lead.external_reference })
        .catch(err => console.error(`[admin] acuse registro lead ${id}:`, err.message));
    }
    res.json(ok({ id, tipo: lead.tipo, informe }));
  });

  // Reenviar (o enviar por primera vez) el acuse de pago de un registro. Útil
  // para leads de registro que ya estaban marcados pagados antes de este aviso.
  app.post('/api/admin/leads/:id/acuse-registro', guard, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!lead) return res.status(404).json(fail('Lead no encontrado'));
    if (lead.tipo !== 'registro') return res.status(400).json(fail('El lead no es de tipo registro'));
    if (!lead.email) return res.status(400).json(fail('El lead no tiene email'));
    const { enviarConfirmacionRegistro } = require('./notificaciones');
    const r = await enviarConfirmacionRegistro({ email: lead.email, marca: lead.marca, solicitante: lead.solicitante, ref: lead.external_reference });
    if (!r.ok) return res.status(502).json(fail('No se pudo enviar: ' + r.error));
    audit.log(req.user.id, 'registro.acuse_enviado', { entidad: 'leads', entidad_id: id, detalle: { email: lead.email } });
    res.json(ok({ id, email: lead.email, stub: !!r.stub }));
  });

  // Genera el Poder Especial (PDF) a partir de los datos cargados por el cliente.
  app.get('/api/admin/leads/:id/poder', guard, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare('SELECT marca, registro_datos FROM leads WHERE id = ?').get(id);
    if (!lead) return res.status(404).send('Lead no encontrado');
    if (!lead.registro_datos) return res.status(400).send('El cliente todavía no cargó sus datos.');
    let datos;
    try { datos = JSON.parse(lead.registro_datos); } catch { return res.status(400).send('Datos inválidos'); }
    try {
      const { generarPoder } = require('./pdf/poder-pdf');
      const buf = await generarPoder(datos);
      const nombre = (datos.titulares?.[0]?.nombre || datos.titulares?.[0]?.razon_social || lead.marca || 'poder')
        .replace(/[^a-zA-Z0-9]+/g, '_');
      audit.log(req.user.id, 'registro.poder_generado', { entidad: 'leads', entidad_id: id });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Poder_${nombre}.pdf"`);
      res.send(buf);
    } catch (err) {
      console.error('[admin] generar poder:', err);
      res.status(500).send('No se pudo generar el poder: ' + err.message);
    }
  });

  // Sirve el logo que subió el cliente en el formulario de datos del registro.
  app.get('/api/admin/leads/:id/registro-logo', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare('SELECT registro_logo_path FROM leads WHERE id = ?').get(id);
    if (!lead || !lead.registro_logo_path || !fs.existsSync(lead.registro_logo_path)) {
      return res.status(404).send('Sin logo');
    }
    res.sendFile(path.resolve(lead.registro_logo_path));
  });

  // Sirve el poder firmado que subió el cliente.
  app.get('/api/admin/leads/:id/poder-firmado', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = db.prepare('SELECT registro_poder_path FROM leads WHERE id = ?').get(id);
    if (!lead || !lead.registro_poder_path || !fs.existsSync(lead.registro_poder_path)) {
      return res.status(404).send('Sin poder firmado');
    }
    res.sendFile(path.resolve(lead.registro_poder_path));
  });

  // Sirve la documentación societaria (constitutiva / representación) de un titular.
  app.get('/api/admin/leads/:id/registro-doc', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const tit = parseInt(req.query.tit, 10) || 0;
    const key = req.query.tipo === 'rep' ? '_doc_representacion_path' : '_doc_constitutiva_path';
    const lead = db.prepare('SELECT registro_datos FROM leads WHERE id = ?').get(id);
    if (!lead || !lead.registro_datos) return res.status(404).send('Sin datos');
    let d; try { d = JSON.parse(lead.registro_datos); } catch { return res.status(400).send('Datos inválidos'); }
    const p = d.titulares && d.titulares[tit] && d.titulares[tit][key];
    if (!p || !fs.existsSync(p)) return res.status(404).send('Sin documento');
    res.sendFile(path.resolve(p));
  });

  // CRM: editar campos manuales (pipeline, notas, próximo contacto, asignación).
  app.patch('/api/admin/leads/:id', guard, express.json(), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const exists = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
    if (!exists) return res.status(404).json(fail('Lead no encontrado'));

    const { pipeline_estado, notas, proximo_contacto_at, asignado_a } = req.body || {};
    const validos = ['nuevo', 'contactado', 'calificado', 'propuesta', 'ganado', 'perdido'];
    const sets = [];
    const vals = [];
    if (pipeline_estado !== undefined) {
      if (!validos.includes(pipeline_estado)) return res.status(400).json(fail('pipeline_estado inválido'));
      sets.push('pipeline_estado = ?'); vals.push(pipeline_estado);
    }
    if (notas !== undefined)                { sets.push('notas = ?');               vals.push(notas || null); }
    if (proximo_contacto_at !== undefined)  { sets.push('proximo_contacto_at = ?'); vals.push(proximo_contacto_at || null); }
    if (asignado_a !== undefined)           { sets.push('asignado_a = ?');          vals.push(asignado_a || null); }
    if (!sets.length) return res.status(400).json(fail('Nada que actualizar'));
    vals.push(id);
    db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(req.user.id, 'lead.editado', {
      entidad: 'leads', entidad_id: id,
      detalle: { pipeline_estado, notas: notas ? '[texto]' : undefined, proximo_contacto_at, asignado_a },
    });
    res.json(ok({ id }));
  });

  // Disparar el follow-up a demanda (útil para probar antes del cron diario).
  app.post('/api/admin/follow-up/run', guard, async (req, res) => {
    try {
      const { correr } = require('./jobs/follow-up');
      const s = await correr({ dryRun: !!req.body?.dry_run });
      audit.log(req.user.id, 'follow_up.manual', { detalle: s });
      res.json(ok(s));
    } catch (err) {
      res.status(500).json(fail(err.message));
    }
  });

  // Disparar el aviso interno de ajuste de precios (el cron trimestral) a mano.
  app.post('/api/admin/aviso-ajuste/run', guard, async (req, res) => {
    try {
      const { correr } = require('./jobs/aviso-ajuste-trimestral');
      const s = await correr({ dryRun: !!req.body?.dry_run });
      audit.log(req.user.id, 'aviso_ajuste.manual', { detalle: s });
      res.json(ok(s));
    } catch (err) {
      res.status(500).json(fail(err.message));
    }
  });

  // ===== Comunicado masivo de ajuste de precios al cliente =====
  // Manda mail a todos los suscriptos activos (usuarios con pack_id != null y
  // rol=cliente) avisando el nuevo precio con anticipación. Idempotente: se puede
  // disparar varias veces sin duplicar (cada envío queda registrado en audit).
  //
  // Body: { porcentaje, fecha_vigencia: 'AAAA-MM-DD', mensaje_extra?: string,
  //         dry_run?: true }
  //   - porcentaje: número 1-50 (ej. 12 = subimos 12%)
  //   - fecha_vigencia: cuándo empieza el nuevo precio (debe ser futuro)
  //   - mensaje_extra: opcional, se agrega al final del mail
  //   - dry_run: solo cuenta destinatarios, no envía nada
  app.post('/api/admin/comunicados/ajuste-precios', guard, async (req, res) => {
    const { porcentaje, fecha_vigencia, mensaje_extra, dry_run } = req.body || {};
    const pct = Number(porcentaje);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) {
      return res.status(400).json(fail('porcentaje debe ser un número entre 1 y 50'));
    }
    if (!fecha_vigencia || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_vigencia))) {
      return res.status(400).json(fail('fecha_vigencia debe ser AAAA-MM-DD'));
    }
    const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
    const vig = new Date(fecha_vigencia);
    if (Number.isNaN(vig.getTime()) || vig <= hoy) {
      return res.status(400).json(fail('fecha_vigencia debe ser futura'));
    }
    const diasAnticipacion = Math.round((vig - hoy) / 86400000);

    // Suscriptos activos con pack mensual asignado.
    const suscriptos = db.prepare(`
      SELECT u.id, u.email, u.nombre, p.nombre AS pack_nombre, p.precio_mensual
      FROM usuarios u
      JOIN packs p ON p.id = u.pack_id
      WHERE u.rol = 'cliente' AND u.activo = 1 AND u.pack_id IS NOT NULL
      ORDER BY u.id ASC
    `).all();

    if (dry_run) {
      return res.json(ok({ dry_run: true, destinatarios: suscriptos.length, dias_anticipacion: diasAnticipacion }));
    }

    const { enviarMailGenerico } = require('./notificaciones');
    const baseUrl = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');
    const fechaTxt = vig.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

    const stats = { enviados: 0, errores: 0, total: suscriptos.length };
    for (const s of suscriptos) {
      const precioViejo = s.precio_mensual;
      const precioNuevo = Math.round(precioViejo * (1 + pct / 100));
      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
          <h2 style="color:#1B6EF3;margin-bottom:6px">Ajuste de precios — aviso anticipado</h2>
          <p>Hola${s.nombre ? ' ' + s.nombre : ''},</p>
          <p>Te escribimos con anticipación para avisarte que, a partir del
             <strong>${fechaTxt}</strong>, el precio del plan <strong>${s.pack_nombre}</strong>
             se ajusta un <strong>${pct}%</strong> por la evolución del costo operativo
             (inflación). Lo hacemos cada 3 meses para mantener el servicio estable.</p>

          <div style="background:#f8fafc;border-left:4px solid #1B6EF3;padding:14px 18px;border-radius:8px;margin:18px 0">
            <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Tu plan: ${s.pack_nombre}</div>
            <div style="display:flex;gap:24px;margin-top:8px;align-items:baseline">
              <div>
                <div style="font-size:11.5px;color:#64748b">Precio actual</div>
                <div style="font-size:18px;font-weight:700;color:#64748b;text-decoration:line-through">$${precioViejo.toLocaleString('es-AR')}/mes</div>
              </div>
              <div>
                <div style="font-size:11.5px;color:#1B6EF3">Nuevo (desde ${fechaTxt})</div>
                <div style="font-size:22px;font-weight:800;color:#1B6EF3">$${precioNuevo.toLocaleString('es-AR')}/mes</div>
              </div>
            </div>
          </div>

          <p><strong>¿Querés bloquear el precio actual por 12 meses?</strong>
             Si pasás a plan anual antes del ${fechaTxt}, te respetamos el importe
             vigente <em>y</em> te bonificamos 2 meses (pagás 10, usás 12).
             Respondé este mail y te mandamos el link.</p>

          <p>Si no querés continuar, podés <strong>cancelar la suscripción sin penalidad</strong>
             en cualquier momento antes de la fecha de ajuste. Sin letra chica.</p>

          ${mensaje_extra ? `<p style="background:#fef3c7;border-left:3px solid #d97706;padding:10px 14px;border-radius:6px;font-size:13px">${mensaje_extra.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>` : ''}

          <p style="margin-top:24px">
            <a href="${baseUrl}/cliente/"
               style="background:#1B6EF3;color:#fff;padding:11px 22px;border-radius:8px;
                      text-decoration:none;display:inline-block;font-weight:600">
              Ver mi cuenta
            </a>
          </p>

          <p style="font-size:13px;color:#64748b;margin-top:18px">
            Gracias por confiar en nosotros. Cualquier duda, respondé este mail.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="font-size:12px;color:#64748b">
            LegalPacers · Consultora de Propiedad Industrial<br>
            contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
          </p>
        </div>`;

      try {
        const r = await enviarMailGenerico({
          to: s.email,
          subject: `Aviso de ajuste de precios — ${fechaTxt}`,
          html, tag: 'comunicado_ajuste_precios',
        });
        if (r.ok) stats.enviados++; else { stats.errores++; console.error(`[comunicado] ${s.email}: ${r.error}`); }
      } catch (err) {
        stats.errores++;
        console.error(`[comunicado] ${s.email} excepción: ${err.message}`);
      }
    }

    audit.log(req.user.id, 'comunicado.ajuste_precios', {
      detalle: { porcentaje: pct, fecha_vigencia, dias_anticipacion: diasAnticipacion, ...stats },
    });
    res.json(ok({ ...stats, porcentaje: pct, fecha_vigencia }));
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

  // ===== Crear usuario (cliente / operador / admin) desde el panel admin =====
  // Usa el guard de sesión admin — sin ADMIN_TOKEN.
  app.post('/api/admin/usuarios', guard, express.json(), async (req, res) => {
    const { email, password, nombre, telefono, rol = 'cliente', pack_codigo } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json(fail('Email inválido'));
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json(fail('Password debe tener al menos 8 caracteres'));
    }
    if (!['admin', 'operador', 'cliente'].includes(rol)) {
      return res.status(400).json(fail('Rol inválido (admin/operador/cliente)'));
    }
    const emailLower = String(email).toLowerCase().trim();
    const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailLower);
    if (existing) return res.status(409).json(fail('Email ya registrado'));

    let packId = null;
    if (pack_codigo) {
      const p = db.prepare('SELECT id FROM packs WHERE codigo = ?').get(String(pack_codigo));
      if (!p) return res.status(404).json(fail(`Pack "${pack_codigo}" no existe`));
      packId = p.id;
    }
    const { hashPassword } = require('./auth');
    const hash = await hashPassword(String(password));
    const info = db.prepare(`
      INSERT INTO usuarios (email, password_hash, rol, nombre, telefono, pack_id, activo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(emailLower, hash, rol, nombre || null, telefono || null, packId);

    audit.log(req.user.id, 'usuario.alta_admin', {
      entidad: 'usuarios', entidad_id: info.lastInsertRowid,
      detalle: { email: emailLower, rol, pack_codigo: pack_codigo || null },
    });
    res.json(ok({ id: info.lastInsertRowid, email: emailLower, rol, pack_codigo: pack_codigo || null }));
  });

  // ===== Editar usuario (rol, pack, password, nombre, activo) =====
  app.patch('/api/admin/usuarios/:id', guard, express.json(), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const u = db.prepare('SELECT id, email, rol FROM usuarios WHERE id = ?').get(id);
    if (!u) return res.status(404).json(fail('Usuario no encontrado'));

    const { rol, pack_codigo, new_password, nombre, telefono, activo } = req.body || {};
    const sets = [];
    const vals = [];

    if (rol !== undefined) {
      if (!['admin', 'operador', 'cliente'].includes(rol)) return res.status(400).json(fail('Rol inválido'));
      // Anti foot-shoot: no permitir que un admin se quite a sí mismo el rol admin.
      if (req.user.id === id && rol !== 'admin') {
        return res.status(400).json(fail('No podés cambiarte tu propio rol admin.'));
      }
      sets.push('rol = ?'); vals.push(rol);
    }
    if (pack_codigo !== undefined) {
      if (pack_codigo === null || pack_codigo === '') {
        sets.push('pack_id = NULL');
      } else {
        const p = db.prepare('SELECT id FROM packs WHERE codigo = ?').get(String(pack_codigo));
        if (!p) return res.status(404).json(fail(`Pack "${pack_codigo}" no existe`));
        sets.push('pack_id = ?'); vals.push(p.id);
      }
    }
    if (new_password !== undefined && new_password) {
      if (String(new_password).length < 8) return res.status(400).json(fail('Password muy corto (min 8)'));
      const { hashPassword } = require('./auth');
      sets.push('password_hash = ?'); vals.push(await hashPassword(String(new_password)));
      // Invalidar sesiones activas — el usuario tiene que loguear de nuevo.
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
    }
    if (nombre !== undefined)    { sets.push('nombre = ?');    vals.push(nombre || null); }
    if (telefono !== undefined)  { sets.push('telefono = ?');  vals.push(telefono || null); }
    if (activo !== undefined) {
      if (req.user.id === id && !activo) {
        return res.status(400).json(fail('No podés desactivar tu propia cuenta.'));
      }
      sets.push('activo = ?'); vals.push(activo ? 1 : 0);
      if (!activo) db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id);
    }
    if (!sets.length) return res.status(400).json(fail('Nada que actualizar'));
    vals.push(id);
    db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    audit.log(req.user.id, 'usuario.editado_admin', {
      entidad: 'usuarios', entidad_id: id,
      detalle: { rol, pack_codigo, password_reset: !!new_password, activo },
    });
    res.json(ok({ id }));
  });

  // ===== Crear/upsert pack desde el panel admin =====
  app.post('/api/admin/packs', guard, express.json(), (req, res) => {
    const { codigo, nombre, cupo_marcas, precio_mensual = 0 } = req.body || {};
    if (!codigo || !String(codigo).trim()) return res.status(400).json(fail('codigo obligatorio'));
    if (!nombre || !String(nombre).trim()) return res.status(400).json(fail('nombre obligatorio'));
    const cupo = parseInt(cupo_marcas, 10);
    if (!Number.isInteger(cupo) || cupo < 1 || cupo > 100000) {
      return res.status(400).json(fail('cupo_marcas inválido (1-100000)'));
    }
    const precio = parseInt(precio_mensual, 10);
    if (!Number.isInteger(precio) || precio < 0) {
      return res.status(400).json(fail('precio_mensual inválido'));
    }
    db.prepare(`
      INSERT INTO packs (codigo, nombre, cupo_marcas, precio_mensual) VALUES (?, ?, ?, ?)
      ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre, cupo_marcas = excluded.cupo_marcas, precio_mensual = excluded.precio_mensual
    `).run(String(codigo).trim(), String(nombre).trim(), cupo, precio);
    const pack = db.prepare('SELECT * FROM packs WHERE codigo = ?').get(String(codigo).trim());
    audit.log(req.user.id, 'pack.upsert_admin', { entidad: 'packs', entidad_id: pack.id, detalle: pack });
    res.json(ok({ pack }));
  });

  // ===== Packs =====
  app.get('/api/admin/packs', guard, (req, res) => {
    const rows = db.prepare(`SELECT * FROM packs ORDER BY cupo_marcas ASC`).all();
    res.json(ok({ packs: rows }));
  });

  // Editar precio mensual y/o nombre de un pack. Acepta cupo_marcas también,
  // por si en el futuro se cambia (raro). Para que el cambio se refleje en MP
  // hay que editar el plan ahí también — esta tabla es solo lo que ve la UI.
  app.patch('/api/admin/packs/:codigo', guard, express.json(), (req, res) => {
    const codigo = String(req.params.codigo);
    const pack = db.prepare('SELECT * FROM packs WHERE codigo = ?').get(codigo);
    if (!pack) return res.status(404).json(fail('Pack no encontrado'));

    const { precio_mensual, nombre, cupo_marcas } = req.body || {};
    const sets = [];
    const vals = [];
    if (precio_mensual !== undefined) {
      const n = Number(precio_mensual);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
        return res.status(400).json(fail('precio_mensual inválido'));
      }
      sets.push('precio_mensual = ?'); vals.push(Math.round(n));
    }
    if (nombre !== undefined) {
      const s = String(nombre).trim();
      if (!s) return res.status(400).json(fail('nombre no puede ser vacío'));
      sets.push('nombre = ?'); vals.push(s);
    }
    if (cupo_marcas !== undefined) {
      const n = parseInt(cupo_marcas, 10);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return res.status(400).json(fail('cupo_marcas inválido'));
      }
      sets.push('cupo_marcas = ?'); vals.push(n);
    }
    if (!sets.length) return res.status(400).json(fail('Nada que actualizar'));
    vals.push(codigo);
    db.prepare(`UPDATE packs SET ${sets.join(', ')} WHERE codigo = ?`).run(...vals);
    const after = db.prepare('SELECT * FROM packs WHERE codigo = ?').get(codigo);
    audit.log(req.user.id, 'pack.editado', {
      entidad: 'packs', entidad_id: pack.id,
      detalle: { codigo, antes: { precio_mensual: pack.precio_mensual, nombre: pack.nombre, cupo_marcas: pack.cupo_marcas }, despues: { precio_mensual: after.precio_mensual, nombre: after.nombre, cupo_marcas: after.cupo_marcas } },
    });
    res.json(ok({ pack: after }));
  });

  // ===== Marcas vigiladas (cartera) =====
  app.get('/api/admin/marcas-vigiladas', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT mv.id, mv.denominacion, mv.clases, mv.tipo, mv.estado, mv.created_at,
             mv.numero_acta, mv.fecha_concesion, mv.origen, mv.origen_ref,
             CASE WHEN mv.fecha_concesion IS NOT NULL
                  THEN date(mv.fecha_concesion, '+5 years') END  AS dju_due_at,
             CASE WHEN mv.fecha_concesion IS NOT NULL
                  THEN date(mv.fecha_concesion, '+10 years') END AS renovacion_due_at,
             u.id AS usuario_id, u.email AS usuario_email, u.nombre AS usuario_nombre
      FROM marcas_vigiladas mv JOIN usuarios u ON u.id = mv.usuario_id
      ORDER BY mv.id DESC LIMIT 500
    `).all();
    res.json(ok({ marcas: rows }));
  });

  // ===== Hitos legales: próximas DJU y renovaciones =====
  // Devuelve solo marcas con fecha_concesion cargada, ordenadas por el próximo
  // vencimiento (cualquiera de los dos). Sirve para que el equipo legal arme la
  // agenda de avisos al cliente sin tener que filtrar manualmente la tabla.
  app.get('/api/admin/hitos-legales', guard, (req, res) => {
    const dias = parseInt(req.query.dias_max, 10) || 365;
    const rows = db.prepare(`
      SELECT mv.id, mv.denominacion, mv.clases, mv.numero_acta, mv.fecha_concesion,
             mv.estado,
             date(mv.fecha_concesion, '+5 years')  AS dju_due_at,
             date(mv.fecha_concesion, '+10 years') AS renovacion_due_at,
             u.email AS usuario_email, u.nombre AS usuario_nombre, u.telefono AS usuario_telefono
      FROM marcas_vigiladas mv JOIN usuarios u ON u.id = mv.usuario_id
      WHERE mv.fecha_concesion IS NOT NULL
        AND mv.estado != 'baja'
        AND (
          date(mv.fecha_concesion, '+5 years')  <= date('now', '+' || ? || ' days')
          OR date(mv.fecha_concesion, '+10 years') <= date('now', '+' || ? || ' days')
        )
      ORDER BY MIN(
        date(mv.fecha_concesion, '+5 years'),
        date(mv.fecha_concesion, '+10 years')
      ) ASC
      LIMIT 500
    `).all(dias, dias);
    res.json(ok({ hitos: rows, dias_max: dias }));
  });

  // Dispara el mail de aviso de hitos al equipo a demanda (para probarlo).
  app.post('/api/admin/hitos-legales/avisar', guard, async (req, res) => {
    try {
      const avisoHitos = require('./jobs/aviso-hitos-legales');
      const r = await avisoHitos.correr({});
      audit.log(req.user.id, 'hitos.aviso_manual', { detalle: r });
      res.json(ok(r));
    } catch (err) {
      res.status(500).json(fail(err.message));
    }
  });

  // ===== Alertas — bandeja de revisión =====
  app.get('/api/admin/alertas', guard, (req, res) => {
    const estado = req.query.estado;
    let sql = `
      SELECT a.id, a.nivel, a.notoria, a.estado, a.canal, a.fundamento, a.nota_admin,
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
    const validos = ['pendiente_revision', 'nueva', 'aprobada', 'revisada', 'accion_tomada', 'descartada'];
    if (!validos.includes(estado)) return res.status(400).json(fail('estado inválido'));
    const exists = db.prepare('SELECT id FROM alertas WHERE id = ?').get(id);
    if (!exists) return res.status(404).json(fail('alerta no encontrada'));
    db.prepare(`
      UPDATE alertas SET estado = ?, revisada_por = ?, revisada_en = datetime('now') WHERE id = ?
    `).run(estado, req.user.id, id);
    audit.log(req.user.id, 'alerta.cambio_estado', { entidad: 'alertas', entidad_id: id, detalle: { estado } });
    res.json(ok({ id, estado }));
  });

  // ===== Guardar/editar la nota del admin sobre una alerta (sin aprobar) =====
  app.patch('/api/admin/alertas/:id/nota', guard, express.json(), (req, res) => {
    const id = parseInt(req.params.id, 10);
    const nota = String(req.body?.nota ?? '').trim().slice(0, 1000);
    const exists = db.prepare('SELECT id FROM alertas WHERE id = ?').get(id);
    if (!exists) return res.status(404).json(fail('alerta no encontrada'));
    db.prepare('UPDATE alertas SET nota_admin = ? WHERE id = ?').run(nota || null, id);
    audit.log(req.user.id, 'alerta.nota', { entidad: 'alertas', entidad_id: id, detalle: { len: nota.length } });
    res.json(ok({ id, nota_admin: nota }));
  });

  // ===== Aprobar y enviar alerta al cliente =====
  // Disparado por un humano del equipo legal después de revisar el dictamen de
  // Gemini en /api/admin/alertas. La alerta pasa a estado 'aprobada' y se le
  // manda al cliente un mail con el detalle. Idempotente: si ya está aprobada,
  // se rechaza el reintento para no duplicar el mail.
  app.post('/api/admin/alertas/:id/aprobar', guard, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare(`
      SELECT a.*, mv.denominacion AS marca, mv.clases AS marca_clases,
             u.email AS cliente_email, u.nombre AS cliente_nombre
      FROM alertas a
      JOIN marcas_vigiladas mv ON mv.id = a.marca_vigilada_id
      JOIN usuarios u          ON u.id  = a.usuario_id
      WHERE a.id = ?
    `).get(id);
    if (!row) return res.status(404).json(fail('Alerta no encontrada'));
    if (row.estado === 'aprobada' || row.estado === 'accion_tomada') {
      return res.status(409).json(fail('La alerta ya fue aprobada/enviada antes'));
    }

    const cands = db.prepare(`
      SELECT mb.denominacion, mb.clase, mb.acta
      FROM alerta_candidatos ac
      LEFT JOIN marcas_boletin mb ON mb.id = ac.marca_boletin_id
      WHERE ac.alerta_id = ?
      ORDER BY ac.score DESC LIMIT 5
    `).all(id);

    // Nota opcional del admin (contexto/aclaración) — se guarda y se incluye en
    // el mail y el portal. Si no viene en el body, conservamos la que ya hubiera.
    const notaAdmin = req.body?.nota != null
      ? String(req.body.nota).trim().slice(0, 1000)
      : (row.nota_admin || '');

    const baseUrl = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');
    const colorNivel = row.nivel === 'alto' ? '#dc2626'
                     : row.nivel === 'medio' ? '#d97706' : '#059669';
    const candsHtml = cands.map(c =>
      `<li><strong>${(c.denominacion || '—')}</strong> · clase ${c.clase || '?'}${c.acta ? ' · acta ' + c.acta : ''}</li>`
    ).join('');

    // Link directo a WhatsApp con el caso en contexto, para que el cliente
    // consulte sin tener que entrar al portal.
    const topCand = cands[0];
    const waMsg = `Hola LegalPacers, me llegó una alerta de monitoreo sobre mi marca "${row.marca}". `
      + (topCand ? `Detectaron una solicitud similar: "${topCand.denominacion || '—'}" (clase ${topCand.clase || '?'}). ` : '')
      + `¿Pueden ayudarme a evaluar si conviene oponerme?`;
    const waLink = `https://wa.me/5491128774200?text=${encodeURIComponent(waMsg)}`;

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
        <h2 style="color:${colorNivel}">Detectamos una posible coincidencia con "${row.marca}"</h2>
        <p>Hola${row.cliente_nombre ? ' ' + row.cliente_nombre : ''},</p>
        <p>En el último escaneo del Boletín del INPI encontramos solicitudes que
           podrían estar relacionadas con tu marca <strong>${row.marca}</strong>
           (clases ${row.marca_clases}).</p>
        <p><strong>Nivel de riesgo:</strong>
           <span style="color:${colorNivel};font-weight:600">${(row.nivel || 'medio').toUpperCase()}</span></p>
        ${row.fundamento ? `<div style="background:#f8fafc;border-left:3px solid ${colorNivel};padding:10px 14px;border-radius:6px;font-size:13px;margin:12px 0">${row.fundamento}</div>` : ''}
        ${notaAdmin ? `<div style="background:#eff6ff;border-left:3px solid #1B6EF3;padding:10px 14px;border-radius:6px;font-size:13px;margin:12px 0"><strong>Nota de nuestro equipo:</strong><br>${notaAdmin.replace(/\n/g, '<br>')}</div>` : ''}
        ${candsHtml ? `<p><strong>Marcas detectadas:</strong></p><ul>${candsHtml}</ul>` : ''}
        <p style="margin:24px 0 8px">Consultá directo con un especialista por WhatsApp, o mirá el detalle en tu portal:</p>
        <p style="margin:0">
          <a href="${waLink}"
             style="background:#25D366;color:#fff;padding:12px 22px;border-radius:8px;
                    text-decoration:none;display:inline-block;font-weight:600;margin-right:8px">
            💬 Consultar por WhatsApp
          </a>
          <a href="${baseUrl}/cliente/"
             style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                    text-decoration:none;display:inline-block;font-weight:600">
            Ver en mi portal
          </a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
        <p style="font-size:12px;color:#64748b">
          LegalPacers · Consultora de Propiedad Industrial<br>
          contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
        </p>
      </div>`;

    const { enviarMailGenerico } = require('./notificaciones');
    const r = await enviarMailGenerico({
      to: row.cliente_email,
      subject: `Posible coincidencia con tu marca "${row.marca}" — alerta de monitoreo`,
      html, tag: 'alerta_aprobada',
    });
    if (!r.ok) {
      audit.log(req.user.id, 'alerta.aprobar_fallo', { entidad: 'alertas', entidad_id: id, detalle: r.error });
      return res.status(502).json(fail(`No se pudo enviar el mail: ${r.error}`));
    }

    db.prepare(`
      UPDATE alertas SET estado = 'aprobada', nota_admin = ?, revisada_por = ?, revisada_en = datetime('now') WHERE id = ?
    `).run(notaAdmin || null, req.user.id, id);
    audit.log(req.user.id, 'alerta.aprobada', { entidad: 'alertas', entidad_id: id, detalle: { email: row.cliente_email } });
    res.json(ok({ id, estado: 'aprobada', stub: !!r.stub }));
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

  // Regenera el ANÁLISIS completo (re-llama a Gemini + PDF), no solo el PDF.
  // Corre dentro del proceso de la app (código + env confiables), con los
  // reintentos ante 429. Útil cuando el informe salió en modo stub.
  app.post('/api/admin/informes/:id/regenerar-completo', guard, express.json(), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT lead_id, estado FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));
    if (row.estado === 'enviado') return res.status(409).json(fail('Informe ya enviado, no se regenera'));
    if (!row.lead_id) return res.status(400).json(fail('El informe no tiene lead asociado'));
    try {
      // Corrección de clases: si el Agente mandó clases nuevas, actualizamos el
      // lead ANTES de reprocesar, así el análisis se rehace sobre las clases
      // correctas (el matching y la IA leen lead.clases).
      if (Array.isArray(req.body?.clases)) {
        const clases = req.body.clases
          .map(n => parseInt(n, 10))
          .filter(n => Number.isFinite(n) && n >= 1 && n <= 45);
        if (clases.length) {
          const clasesUnicas = [...new Set(clases)];
          db.prepare('UPDATE leads SET clases = ? WHERE id = ?').run(JSON.stringify(clasesUnicas), row.lead_id);
          audit.log(req.user.id, 'informe.clases_corregidas', { entidad: 'informes', entidad_id: id, detalle: { clases: clasesUnicas } });
        }
      }
      db.prepare('DELETE FROM informes WHERE id = ?').run(id);
      const { procesarInformePago } = require('./jobs/informe-pago');
      // notificarCliente:false → regenerar NO le re-manda "recibimos tu pago".
      // forzar:true → salta el caché (si el intento anterior falló y quedó
      // cacheado, queremos una llamada fresca a Gemini, no el fallo viejo).
      const r = await procesarInformePago(row.lead_id, { notificarCliente: false, forzar: true });
      const nuevo = r?.informeId ? db.prepare('SELECT informe_json FROM informes WHERE id = ?').get(r.informeId) : null;
      let stub = null, motivo = null;
      if (nuevo) {
        try {
          const j = JSON.parse(nuevo.informe_json || '{}');
          stub = j.stub === true;
          motivo = j.gemini_error || (j.parse_error ? 'JSON inválido de la IA' : null) || j.red_error || null;
        } catch {}
      }
      audit.log(req.user.id, 'informe.regenerado_completo', { entidad: 'informes', entidad_id: r?.informeId, detalle: { desde: id, stub, motivo } });
      res.json(ok({ ...r, stub, motivo }));
    } catch (err) {
      console.error('[admin] regenerar-completo:', err);
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
    const html = htmlInformeListo(row);

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

  // Reenvío / corrección de email — funciona AUNQUE ya esté enviado (para cuando
  // salió con el email mal). Corrige el email si viene uno nuevo y reenvía el PDF.
  app.post('/api/admin/informes/:id/reenviar', guard, express.json(), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = db.prepare('SELECT * FROM informes WHERE id = ?').get(id);
    if (!row) return res.status(404).json(fail('Informe no encontrado'));

    const nuevoEmail = (req.body?.email || '').trim();
    if (nuevoEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoEmail)) return res.status(400).json(fail('Email inválido'));
      db.prepare('UPDATE informes SET email = ? WHERE id = ?').run(nuevoEmail, id);
      row.email = nuevoEmail;
    }
    if (!row.email) return res.status(400).json(fail('Falta el email del cliente'));
    if (!row.pdf_path || !fs.existsSync(row.pdf_path)) return res.status(400).json(fail('No hay PDF generado para enviar'));

    const { enviarMailGenerico } = require('./notificaciones');
    const pdfBuf = fs.readFileSync(row.pdf_path);
    const result = await enviarMailGenerico({
      to: row.email,
      subject: `Tu informe de viabilidad — ${row.marca}`,
      html: htmlInformeListo(row),
      attachments: [{
        filename: `informe-${row.marca.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`,
        content: pdfBuf,
      }],
      tag: 'informe_reenvio',
    });
    if (!result.ok) return res.status(502).json(fail(`No se pudo reenviar: ${result.error}`));

    db.prepare("UPDATE informes SET estado = 'enviado', enviado_at = datetime('now') WHERE id = ?").run(id);
    audit.log(req.user.id, 'informe.reenviado', { entidad: 'informes', entidad_id: id, detalle: { email: row.email } });
    res.json(ok({ id, email: row.email, stub: !!result.stub }));
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

  // ===== Importar boletín / dump del INPI a marcas_inpi (Opción 2) =====
  // Acepta CSV (texto), o boletines del INPI en XLS/XLSX (concedidas,
  // limitaciones, oposiciones) y PDF (marcas nuevas en trámite). El server
  // parsea el formato y hace UPSERT por (acta, clase): agrega nuevas y
  // actualiza estados sin borrar el resto. Autenticado con sesión admin.
  //
  // Mandar el archivo como binario crudo en el body con el filename en el
  // header X-Filename (para que el parser sepa el formato).
  app.post('/api/admin/marcas-inpi/import',
    guard,
    express.raw({ type: '*/*', limit: '200mb' }),
    async (req, res) => {
      const buf = req.body;
      if (!buf || !buf.length) {
        return res.status(400).json(fail('Body vacío. Subí un archivo CSV, XLS, XLSX o PDF.'));
      }
      const filename = (req.headers['x-filename'] || '').toString().toLowerCase();
      try {
        const { importarCSVText, importarFilas } = require('./jobs/import-marcas-inpi');
        let resultado;

        const esPDF = filename.endsWith('.pdf') || buf.slice(0, 4).toString() === '%PDF';
        const esXLS = filename.endsWith('.xls') || filename.endsWith('.xlsx')
          || buf.slice(0, 2).toString('hex') === 'd0cf'  // OLE2 (.xls viejo)
          || buf.slice(0, 2).toString() === 'PK';          // ZIP (.xlsx)

        if (esPDF || esXLS) {
          const { parseBoletinBuffer } = require('./jobs/parse-boletin-inpi');
          const { marcas, meta } = await parseBoletinBuffer(buf, filename || (esPDF ? 'x.pdf' : 'x.xls'));
          if (!marcas.length) {
            return res.status(400).json(fail('No se detectaron marcas en el archivo. ¿Es un boletín del INPI con tabla de actas?'));
          }
          const { stats, errores } = importarFilas(marcas, { actorId: req.user.id, fuente: `admin_${meta.formato}` });
          resultado = { stats, errores: errores.slice(0, 20), errores_total: errores.length, meta };
        } else {
          // CSV / texto.
          const { stats, errores } = importarCSVText(buf.toString('utf8'), { actorId: req.user.id, fuente: 'admin_csv' });
          resultado = { stats, errores: errores.slice(0, 20), errores_total: errores.length, meta: { formato: 'csv' } };
        }
        res.json(ok(resultado));
      } catch (err) {
        console.error('[marcas-inpi/import]', err);
        res.status(400).json(fail(err.message));
      }
    });

  // Dispara el cron de sync a demanda (útil para probar la URL configurada).
  app.post('/api/admin/marcas-inpi/sync-now', guard, async (req, res) => {
    try {
      const syncInpi = require('./jobs/sync-inpi');
      const r = await syncInpi.correr();
      audit.log(req.user.id, 'sync_inpi.manual', { detalle: r });
      res.json(ok(r));
    } catch (err) {
      res.status(500).json(fail(err.message));
    }
  });

  // ===== Backups de la base =====
  app.get('/api/admin/backups', guard, (req, res) => {
    const backupDb = require('./jobs/backup-db');
    res.json(ok({ backups: backupDb.listarBackups() }));
  });

  // Crear un backup a demanda.
  app.post('/api/admin/backups/crear', guard, async (req, res) => {
    try {
      const backupDb = require('./jobs/backup-db');
      const r = await backupDb.crear({ actorId: req.user.id });
      if (!r.ok) return res.status(500).json(fail(r.error));
      res.json(ok(r));
    } catch (err) {
      res.status(500).json(fail(err.message));
    }
  });

  // Descargar un backup. El nombre se valida contra path traversal.
  app.get('/api/admin/backups/:archivo', guard, (req, res) => {
    const archivo = String(req.params.archivo);
    // Solo permitimos el patrón exacto de nuestros backups (anti traversal).
    if (!/^legalpacers-[\d-]+\.db\.gz$/.test(archivo)) {
      return res.status(400).json(fail('Nombre de backup inválido'));
    }
    const backupDb = require('./jobs/backup-db');
    const full = path.join(backupDb.dirBackups(), archivo);
    if (!fs.existsSync(full)) return res.status(404).json(fail('Backup no encontrado'));
    audit.log(req.user.id, 'db.backup.descarga', { detalle: { archivo } });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
    fs.createReadStream(full).pipe(res);
  });

  // ===== Catch-up automático con el INPI =====
  // Estado de los jobs en memoria (un único job a la vez para no saturar al
  // INPI). El frontend hace polling cada 2-3 segundos al GET /status.
  const inpiJob = { activo: false, comenzado_at: null, progreso: [], resumen: null, error: null };

  app.get('/api/admin/inpi/status', guard, (req, res) => {
    const catchUp = require('./jobs/catch-up-inpi');
    res.json(ok({
      job: {
        activo: inpiJob.activo,
        comenzado_at: inpiJob.comenzado_at,
        ultimos_progresos: inpiJob.progreso.slice(-10),
        resumen: inpiJob.resumen,
        error: inpiJob.error,
      },
      log: catchUp.estado(),
    }));
  });

  // Dispara el catch-up en background.
  // Body opcional: { series:['registros','nuevas'], desde:{registros:6030}, hasta:{registros:6080}, maxFallos:8 }
  app.post('/api/admin/inpi/catch-up', guard, express.json(), async (req, res) => {
    if (inpiJob.activo) {
      return res.status(409).json(fail('Ya hay un catch-up en curso. Esperá a que termine o revisá el estado.'));
    }
    const opts = req.body || {};
    inpiJob.activo = true;
    inpiJob.comenzado_at = new Date().toISOString();
    inpiJob.progreso = [];
    inpiJob.resumen = null;
    inpiJob.error = null;

    // Respondemos inmediato; el job corre en background.
    res.json(ok({ iniciado: true, comenzado_at: inpiJob.comenzado_at }));

    setImmediate(async () => {
      try {
        const catchUp = require('./jobs/catch-up-inpi');
        const resumen = await catchUp.correr({
          actorId: req.user.id,
          series: opts.series,
          desde: opts.desde,
          hasta: opts.hasta,
          maxFallos: opts.maxFallos,
          onProgreso: (p) => {
            const r = p.resultado || {};
            const boletinTag = r.boletin_local?.boletinId
              ? ` · boletín local #${r.boletin_local.boletinId} (${r.boletin_local.total_actas} actas)`
              : (r.boletin_local?.dedup ? ' · boletín local ya existía' : '');
            const linea = r.ok
              ? `✓ ${p.serie} #${p.numero} (${r.formato}): ${r.stats.nuevas} nuevas, ${r.stats.actualizadas} actualizadas${boletinTag}`
              : r.skipped
                ? `↷ ${p.serie} #${p.numero} ya estaba ok`
                : `✗ ${p.serie} #${p.numero}: ${r.motivo || 'desconocido'}${r.status ? ' (HTTP ' + r.status + ')' : ''}`;
            inpiJob.progreso.push({ ts: new Date().toISOString(), linea });
            if (inpiJob.progreso.length > 500) inpiJob.progreso.shift();
          },
        });
        inpiJob.resumen = resumen;
      } catch (err) {
        console.error('[inpi/catch-up] ERROR:', err);
        inpiJob.error = err.message;
      } finally {
        inpiJob.activo = false;
      }
    });
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

  // Diagnóstico de configuración: confirma que las integraciones críticas
  // (Gemini, Mercado Pago, Resend) estén seteadas. Con ?ping=1 hace una
  // llamada real y liviana a Gemini para verificar que la key funcione —
  // así detectamos temprano un informe que saldría en modo borrador.
  app.get('/api/admin/diagnostico', guard, async (req, res) => {
    const mask = (v) => (v ? `seteada (${v.length} chars, …${v.slice(-4)})` : 'NO seteada');
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    const modeloInforme = (process.env.GEMINI_MODEL_INFORME || 'gemini-2.5-flash').trim();

    const out = {
      gemini: {
        api_key: mask(geminiKey),
        modelo_informe: modeloInforme,
        listo: !!geminiKey,
      },
      mercadopago: {
        access_token: mask((process.env.MP_ACCESS_TOKEN || '').trim()),
        modo: (process.env.MP_ACCESS_TOKEN || '').trim() ? 'real' : 'STUB (pagos simulados)',
      },
      resend: {
        api_key: mask((process.env.RESEND_API_KEY || '').trim()),
      },
      ping_gemini: null,
    };

    if (req.query.ping === '1' && geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modeloInforme)}:generateContent?key=${geminiKey}`;
        const t0 = Date.now();
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Respondé solo con la palabra OK.' }] }] }),
        });
        const ms = Date.now() - t0;
        const txt = await r.text();
        if (r.ok) {
          out.ping_gemini = { ok: true, http: r.status, ms, modelo: modeloInforme };
        } else {
          out.ping_gemini = { ok: false, http: r.status, ms, error: txt.slice(0, 300) };
        }
      } catch (err) {
        out.ping_gemini = { ok: false, error: err.message };
      }
    } else if (req.query.ping === '1') {
      out.ping_gemini = { ok: false, error: 'GEMINI_API_KEY no seteada — no se puede hacer ping.' };
    }

    // ?informe=1 reproduce la llamada REAL del informe (prompt grande) y
    // devuelve el cuerpo crudo del error — para ver la cuota exacta del 429.
    if (req.query.informe === '1') {
      try {
        out.ping_informe = await require('./matching/informe').diagnosticarGemini();
      } catch (err) {
        out.ping_informe = { ok: false, error: err.message };
      }
    }

    res.json(ok(out));
  });

  // Reporte mensual de cartera. Con dry_run:true no manda mails (preview de a
  // quién le tocaría y con qué números); sin él, envía a todos.
  app.post('/api/admin/reporte-mensual/run', guard, express.json(), async (req, res) => {
    try {
      const dryRun = !!(req.body && req.body.dry_run);
      const r = await require('./jobs/reporte-mensual').correr({ dryRun });
      audit.log(req.user.id, 'reporte_mensual.manual', { detalle: { dryRun, enviados: r.enviados, clientes: r.clientes } });
      res.json(ok(r));
    } catch (err) {
      res.status(500).json(fail(err.message, 500));
    }
  });
}

// hoist al require de express para no romper si server.js no lo pasa.
const express = require('express');

module.exports = { mountAdminRoutes };
