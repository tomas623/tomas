// Portal del cliente — endpoints + middleware. Todo el cupo se valida en el server,
// nunca sólo en el front (BUILD_SPEC_MOTOR.md §1).

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { requireAuth } = require('./auth');
const { normalizar } = require('./matching/etapa1');
const audit = require('./audit');
const crypto = require('crypto');
const { linkPackSuscripcion } = require('./pagos');

// Directorio donde guardamos los PDF de títulos, dentro del volumen persistente
// (mismo lugar que la DB). Guardamos el binario en disco y solo la ruta en la
// base, así los backups (VACUUM de la DB) no se inflan.
function dirTitulos() {
  const base = path.dirname(db.name || (process.env.SQLITE_PATH || './data/legalpacers.db'));
  const dir = path.join(base, 'titulos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ok(data) { return { ok: true, data }; }
function fail(msg, code = 400, extra) { return { ok: false, error: msg, code, ...(extra || {}) }; }

// Situaciones válidas de la marca ante el INPI (informativas, distintas del
// estado de vigilancia activa/pausada).
const SITUACIONES = new Set(['registrada', 'en_tramite', 'denegada', 'otro']);

// Devuelve la fecha en formato AAAA-MM-DD si es válida; null si no.
function validarFechaIso(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return str;
}

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
  // Devolvemos también dju_due_at y renovacion_due_at calculados a partir de
  // fecha_concesion para que el front pueda mostrar los próximos hitos legales.
  app.get('/api/cliente/marcas', guard, (req, res) => {
    const rows = db.prepare(`
      SELECT id, denominacion, clases, tipo, logo_path, estado, numero_acta,
             fecha_concesion, titular, situacion_inpi,
             CASE WHEN titulo_pdf_path IS NOT NULL AND titulo_pdf_path != '' THEN 1 ELSE 0 END AS titulo_pdf_path,
             created_at,
             CASE WHEN fecha_concesion IS NOT NULL
                  THEN date(fecha_concesion, '+5 years') END AS dju_due_at,
             CASE WHEN fecha_concesion IS NOT NULL
                  THEN date(fecha_concesion, '+10 years') END AS renovacion_due_at
      FROM marcas_vigiladas WHERE usuario_id = ? ORDER BY id DESC
    `).all(req.user.id);
    res.json(ok({ marcas: rows, pack: packInfo(req.user.id) }));
  });

  // ===== Alta de marca a vigilancia =====
  app.post('/api/cliente/marcas', guard, (req, res) => {
    const {
      denominacion, clases, tipo = 'denominativa', logo_path = null,
      numero_acta = null, fecha_concesion = null, titular = null,
      situacion_inpi = null,
    } = req.body || {};
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
    const den = String(denominacion).trim();
    const numAct = numero_acta ? String(numero_acta).trim().slice(0, 50) : null;
    const titularLimpio = titular ? String(titular).trim().slice(0, 200) : null;
    const situacion = SITUACIONES.has(situacion_inpi) ? situacion_inpi : null;
    const fechaCon = validarFechaIso(fecha_concesion);
    if (fecha_concesion && !fechaCon) {
      return res.status(400).json(fail('Fecha de concesión inválida (formato AAAA-MM-DD)'));
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

    // Evitamos duplicar el MISMO registro. Si viene con acta, el acta es la
    // clave única (cada acta del INPI es una clase con su propio vencimiento,
    // así que la misma denominación en otra clase/acta SÍ se puede cargar).
    // Sin acta, caemos a denominación + clases para no duplicar exactos.
    const denNorm = normalizar(den);
    let dup;
    if (numAct) {
      dup = db.prepare(`
        SELECT id FROM marcas_vigiladas
        WHERE usuario_id = ? AND numero_acta = ? AND estado != 'baja'
      `).get(req.user.id, numAct);
      if (dup) {
        return res.status(409).json(fail(
          `Ya tenés el acta ${numAct} en vigilancia.`,
          409, { duplicada: true, id: dup.id }
        ));
      }
    } else {
      dup = db.prepare(`
        SELECT id FROM marcas_vigiladas
        WHERE usuario_id = ? AND denominacion_norm = ? AND clases = ? AND estado != 'baja'
      `).get(req.user.id, denNorm, JSON.stringify(clasesArr));
      if (dup) {
        return res.status(409).json(fail(
          `Ya tenés a "${den}" en esas clases. Editala en lugar de crearla otra vez.`,
          409, { duplicada: true, id: dup.id }
        ));
      }
    }

    const info2 = db.prepare(`
      INSERT INTO marcas_vigiladas
        (usuario_id, denominacion, denominacion_norm, clases, tipo, logo_path,
         estado, numero_acta, fecha_concesion, titular, situacion_inpi)
      VALUES (?, ?, ?, ?, ?, ?, 'activa', ?, ?, ?, ?)
    `).run(req.user.id, den, denNorm, JSON.stringify(clasesArr), tipo, logo_path,
           numAct, fechaCon, titularLimpio, situacion);

    audit.log(req.user.id, 'vigilancia.alta', {
      entidad: 'marcas_vigiladas', entidad_id: info2.lastInsertRowid,
      detalle: { denominacion: den, clases: clasesArr, tipo, numero_acta: numAct, fecha_concesion: fechaCon, titular: titularLimpio, situacion_inpi: situacion },
    });

    res.json(ok({
      id: info2.lastInsertRowid,
      denominacion: den, clases: clasesArr, tipo, estado: 'activa',
      numero_acta: numAct, fecha_concesion: fechaCon, titular: titularLimpio,
      situacion_inpi: situacion,
      pack: packInfo(req.user.id),
    }));
  });

  // ===== Carga masiva de marcas (Excel/CSV) =====
  // Recibe un array `marcas` con [{ denominacion, clases, tipo?, numero_acta?,
  // fecha_concesion? }]. Valida cada fila individualmente y devuelve resultado
  // por fila (índice, ok|error). No es transacción: cada marca que pasa las
  // validaciones se inserta; las que no, se reportan con error en su fila.
  //
  // Pre-validaciones globales (rechazan TODO el batch sin escribir nada):
  //   - max 100 filas por request (DoS soft-protection).
  //   - pack asignado y con cupo suficiente para TODAS las filas válidas.
  //
  // Si el cupo no alcanza para todas, devolvemos cuáles entrarían y cuáles no
  // sin escribir nada (HTTP 403 + detalle), así el cliente decide.
  // Descarga la plantilla CSV para carga masiva. Tiene BOM UTF-8 al inicio
  // para que Excel abra los acentos y la ñ correctamente. Incluye una fila
  // de ejemplo + una vacía para que el cliente la complete.
  app.get('/api/cliente/marcas/plantilla.csv', guard, (req, res) => {
    const BOM = '﻿';
    const lineas = [
      'Denominación,Clases,Tipo,Número de acta,Fecha de concesión (AAAA-MM-DD),Titular',
      'Focca,"9,42",denominativa,4500123,2023-06-01,',
      'Acme Foods,"29,30",mixta,4500124,2024-02-15,Acme SA',
      '"Marca con, coma",35,denominativa,,,',
      ',,,,,',
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-marcas-vigilancia.csv"');
    res.send(BOM + lineas.join('\n'));
  });

  app.post('/api/cliente/marcas/bulk', guard, (req, res) => {
    const { marcas } = req.body || {};
    if (!Array.isArray(marcas) || !marcas.length) {
      return res.status(400).json(fail('Mandá un array `marcas` con al menos una fila.'));
    }
    if (marcas.length > 100) {
      return res.status(400).json(fail('Máximo 100 marcas por carga. Dividí en lotes.'));
    }
    const info = packInfo(req.user.id);
    if (!info) return res.status(404).json(fail('Usuario no encontrado'));
    if (!info.pack_id) {
      return res.status(403).json(fail('No tenés un pack de vigilancia asignado. Contactá a soporte.', 403, { necesita_pack: true }));
    }

    // Parseo + validación por fila.
    const filas = marcas.map((m, idx) => {
      const errores = [];
      const den = String(m?.denominacion || '').trim();
      if (!den) errores.push('Falta denominación');

      let clasesArr = [];
      const cr = m?.clases;
      if (Array.isArray(cr)) clasesArr = cr.map(Number).filter(Number.isFinite);
      else if (typeof cr === 'string') clasesArr = cr.split(/[,\s]+/).map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
      else if (typeof cr === 'number') clasesArr = [cr];
      if (!clasesArr.length) errores.push('Indicá al menos una clase Niza');
      if (clasesArr.some(c => c < 1 || c > 45)) errores.push('Clases Niza válidas: 1-45');

      const tipo = m?.tipo || 'denominativa';
      if (!['denominativa', 'mixta', 'figurativa'].includes(tipo)) errores.push('Tipo inválido (denominativa/mixta/figurativa)');

      const numAct = m?.numero_acta ? String(m.numero_acta).trim().slice(0, 50) : null;
      const titular = m?.titular ? String(m.titular).trim().slice(0, 200) : null;
      const situacion = SITUACIONES.has(m?.situacion_inpi) ? m.situacion_inpi : null;
      let fechaCon = null;
      if (m?.fecha_concesion) {
        fechaCon = validarFechaIso(m.fecha_concesion);
        if (!fechaCon) errores.push('Fecha de concesión inválida (AAAA-MM-DD)');
      }

      return { idx, denominacion: den, clases: clasesArr, tipo, numero_acta: numAct, fecha_concesion: fechaCon, titular, situacion_inpi: situacion, errores };
    });

    // Deduplicación por ACTA, no por denominación. Cada acta del INPI es un
    // registro único (una clase, un vencimiento propio): una misma marca en
    // varias clases tiene varias actas y se renueva por separado, así que
    // deben entrar como entradas distintas. Solo bloqueamos el acta repetida
    // (misma carga o ya cargada). Para filas SIN acta (alta manual sin número)
    // caemos a denominación + clases para no duplicar exactos.
    const actasExistentes = new Set(
      db.prepare(`SELECT numero_acta FROM marcas_vigiladas WHERE usuario_id = ? AND estado != 'baja' AND numero_acta IS NOT NULL AND numero_acta != ''`)
        .all(req.user.id).map(r => String(r.numero_acta))
    );
    const denomClaseExistentes = new Set(
      db.prepare(`SELECT denominacion_norm, clases FROM marcas_vigiladas WHERE usuario_id = ? AND estado != 'baja' AND (numero_acta IS NULL OR numero_acta = '')`)
        .all(req.user.id).map(r => `${r.denominacion_norm}|${r.clases}`)
    );
    const actasBatch = new Set();
    const denomClaseBatch = new Set();
    for (const f of filas) {
      if (f.errores.length) continue;
      if (f.numero_acta) {
        const acta = String(f.numero_acta);
        if (actasExistentes.has(acta)) f.errores.push(`Ya tenés el acta ${acta} en vigilancia`);
        else if (actasBatch.has(acta)) f.errores.push(`Acta ${acta} repetida en esta carga`);
        else actasBatch.add(acta);
      } else {
        const key = `${normalizar(f.denominacion)}|${JSON.stringify(f.clases)}`;
        if (denomClaseExistentes.has(key)) f.errores.push(`Ya tenés "${f.denominacion}" en esas clases`);
        else if (denomClaseBatch.has(key)) f.errores.push(`Duplicada (misma marca y clase) en esta carga`);
        else denomClaseBatch.add(key);
      }
    }

    const validas = filas.filter(f => !f.errores.length);
    const invalidas = filas.filter(f => f.errores.length);

    // Validación dura: las válidas tienen que entrar en el cupo restante.
    if (validas.length > info.cupo_disponible) {
      return res.status(403).json(fail(
        `Tu pack permite ${info.cupo_marcas} marcas. Tenés ${info.marcas_activas} activas, te quedan ${info.cupo_disponible} libres. La carga incluye ${validas.length} válidas — no entran.`,
        403,
        {
          cupo_excedido: true,
          cupo_actual: info.cupo_marcas,
          marcas_activas: info.marcas_activas,
          cupo_disponible: info.cupo_disponible,
          validas: validas.length,
          invalidas: invalidas.length,
        }
      ));
    }

    // Inserción real de las válidas.
    const insStmt = db.prepare(`
      INSERT INTO marcas_vigiladas
        (usuario_id, denominacion, denominacion_norm, clases, tipo, logo_path,
         estado, numero_acta, fecha_concesion, titular, situacion_inpi)
      VALUES (?, ?, ?, ?, ?, NULL, 'activa', ?, ?, ?, ?)
    `);
    const insertarTodas = db.transaction((rows) => {
      const out = [];
      for (const f of rows) {
        const norm = normalizar(f.denominacion);
        const r = insStmt.run(req.user.id, f.denominacion, norm, JSON.stringify(f.clases),
                              f.tipo, f.numero_acta, f.fecha_concesion, f.titular, f.situacion_inpi);
        out.push({ idx: f.idx, id: r.lastInsertRowid });
      }
      return out;
    });
    const insertadas = insertarTodas(validas);

    audit.log(req.user.id, 'vigilancia.bulk_alta', {
      detalle: { total: filas.length, insertadas: insertadas.length, invalidas: invalidas.length },
    });

    res.json(ok({
      total: filas.length,
      insertadas: insertadas.length,
      invalidas: invalidas.length,
      filas: filas.map(f => ({
        idx: f.idx,
        denominacion: f.denominacion,
        ok: f.errores.length === 0,
        errores: f.errores,
        id: insertadas.find(x => x.idx === f.idx)?.id || null,
      })),
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
    const marca = db.prepare('SELECT id, denominacion, titulo_pdf_path FROM marcas_vigiladas WHERE id = ? AND usuario_id = ?')
      .get(id, req.user.id);
    if (!marca) return res.status(404).json(fail('Marca no encontrada'));
    // Borramos el PDF del título asociado, si lo había.
    if (marca.titulo_pdf_path) {
      try { fs.unlinkSync(path.join(dirTitulos(), path.basename(marca.titulo_pdf_path))); } catch {}
    }
    db.prepare('DELETE FROM marcas_vigiladas WHERE id = ?').run(id);
    audit.log(req.user.id, 'vigilancia.baja',
      { entidad: 'marcas_vigiladas', entidad_id: id, detalle: { denominacion: marca.denominacion } });
    res.json(ok({ id, pack: packInfo(req.user.id) }));
  });

  // ===== Subir el PDF del título de una marca =====
  // Recibe el binario crudo (Content-Type: application/pdf), valida que sea PDF
  // por magic bytes y lo guarda en el volumen. Límite 10 MB.
  app.post('/api/cliente/marcas/:id/titulo', guard,
    express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '10mb' }),
    (req, res) => {
      const id = parseInt(req.params.id, 10);
      const marca = db.prepare('SELECT id FROM marcas_vigiladas WHERE id = ? AND usuario_id = ?')
        .get(id, req.user.id);
      if (!marca) return res.status(404).json(fail('Marca no encontrada'));
      const buf = req.body;
      if (!buf || !buf.length) return res.status(400).json(fail('Adjuntá el PDF del título.'));
      // Magic bytes de un PDF: "%PDF".
      if (buf.slice(0, 4).toString('latin1') !== '%PDF') {
        return res.status(400).json(fail('El archivo no parece un PDF válido.'));
      }
      const nombre = `titulo-${req.user.id}-${id}.pdf`;
      try {
        fs.writeFileSync(path.join(dirTitulos(), nombre), buf);
      } catch (err) {
        return res.status(500).json(fail(`No se pudo guardar: ${err.message}`));
      }
      db.prepare('UPDATE marcas_vigiladas SET titulo_pdf_path = ? WHERE id = ?').run(nombre, id);
      audit.log(req.user.id, 'vigilancia.titulo_subido',
        { entidad: 'marcas_vigiladas', entidad_id: id, detalle: { bytes: buf.length } });
      res.json(ok({ id, bytes: buf.length }));
    });

  // ===== Ver / descargar el PDF del título =====
  app.get('/api/cliente/marcas/:id/titulo', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const marca = db.prepare('SELECT titulo_pdf_path, denominacion FROM marcas_vigiladas WHERE id = ? AND usuario_id = ?')
      .get(id, req.user.id);
    if (!marca || !marca.titulo_pdf_path) return res.status(404).json(fail('No hay título cargado para esta marca.'));
    const full = path.join(dirTitulos(), path.basename(marca.titulo_pdf_path));
    if (!fs.existsSync(full)) return res.status(404).json(fail('El archivo del título no está disponible.'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="titulo-${String(marca.denominacion).replace(/[^\w.-]+/g, '_')}.pdf"`);
    fs.createReadStream(full).pipe(res);
  });

  // ===== Borrar el PDF del título =====
  app.delete('/api/cliente/marcas/:id/titulo', guard, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const marca = db.prepare('SELECT titulo_pdf_path FROM marcas_vigiladas WHERE id = ? AND usuario_id = ?')
      .get(id, req.user.id);
    if (!marca) return res.status(404).json(fail('Marca no encontrada'));
    if (marca.titulo_pdf_path) {
      try { fs.unlinkSync(path.join(dirTitulos(), path.basename(marca.titulo_pdf_path))); } catch {}
      db.prepare('UPDATE marcas_vigiladas SET titulo_pdf_path = NULL WHERE id = ?').run(id);
    }
    res.json(ok({ id }));
  });

  // ===== Mis alertas =====
  app.get('/api/cliente/alertas', guard, (req, res) => {
    const alertas = db.prepare(`
      SELECT a.id, a.nivel, a.notoria, a.estado, a.canal, a.fundamento,
             a.created_at, a.revisada_en,
             mv.denominacion AS marca, mv.clases AS marca_clases
      FROM alertas a JOIN marcas_vigiladas mv ON mv.id = a.marca_vigilada_id
      WHERE a.usuario_id = ?
        AND a.estado != 'pendiente_revision'
        AND a.estado != 'descartada'
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

  // ===== Estado del monitoreo (último escaneo) =====
  // Le da tranquilidad al cliente: aunque no haya alertas, ve que el sistema
  // efectivamente corrió. Contempla tanto el escaneo automático (cron) como
  // las corridas manuales desde el panel admin.
  app.get('/api/cliente/monitoreo/estado', guard, (req, res) => {
    const ultima = db.prepare(`
      SELECT created_at FROM audit_log
      WHERE accion IN ('cron.monitoreo', 'monitoreo.run')
      ORDER BY id DESC LIMIT 1
    `).get();
    res.json(ok({
      ultimo_run: ultima?.created_at || null,
      proxima_descripcion: 'Escaneamos el Boletín del INPI todas las semanas.',
    }));
  });

  // ===== Catálogo de packs (para mostrar upgrade) =====
  app.get('/api/cliente/packs', guard, (req, res) => {
    const rows = db.prepare('SELECT codigo, nombre, cupo_marcas, precio_mensual FROM packs ORDER BY cupo_marcas ASC').all();
    const conLink = rows.map(p => ({
      ...p,
      tiene_link: !!process.env[`MP_PLAN_${p.codigo.toUpperCase().replace('VIGILANCIA_', 'VIG_')}`],
    }));
    res.json(ok({ packs: conLink }));
  });

  // ===== Iniciar suscripción a un pack =====
  // Devuelve la URL del Plan de Suscripción de MP con external_reference para
  // que el webhook correlacione el pago con este cliente.
  app.post('/api/cliente/packs/:codigo/suscribir', guard, (req, res) => {
    const codigo = req.params.codigo;
    const pack = db.prepare('SELECT * FROM packs WHERE codigo = ?').get(codigo);
    if (!pack) return res.status(404).json(fail('Pack no encontrado'));

    const externalReference = `pack-${req.user.id}-${codigo}-${crypto.randomBytes(4).toString('hex')}`;
    // Registramos el intento como un "lead de suscripción" para trazabilidad.
    db.prepare(`
      INSERT INTO leads (tipo, marca, email, telefono, clases, rubro, monto, external_reference)
      VALUES ('suscripcion', ?, ?, NULL, '[]', NULL, ?, ?)
    `).run(codigo, req.user.email, pack.precio_mensual, externalReference);

    const url = linkPackSuscripcion(codigo, externalReference);
    if (!url) {
      return res.status(503).json(fail(
        `El pack "${codigo}" todavía no tiene link de suscripción configurado. Setealo en MP_PLAN_VIG_3 / VIG_10 / VIG_20.`,
        503,
      ));
    }
    audit.log(req.user.id, 'pack.suscripcion.iniciar', { detalle: { codigo, externalReference } });
    res.json(ok({ url, external_reference: externalReference }));
  });
}

module.exports = { mountClienteRoutes, packInfo };
