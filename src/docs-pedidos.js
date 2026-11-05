// Pedidos de términos y condiciones / política de privacidad: estados, link
// único al formulario, respuestas, archivos y mails. El recorrido es el de
// HQ, marcas/legal-pacer/servicio-tyc-pp/procedimiento.md (paso 1):
//
//   pendiente_pago → pagado → formulario_completo → borrador_revision
//   → borrador_enviado → ajuste_en_curso → version_final_enviada → cerrado
//
// La reunión de diagnóstico va en una columna aparte (link_enviado, agendada,
// hecha) porque no frena ni cierra el pedido.
//
// Seguridad del link único: el token tiene 256 bits al azar, viaja solo en el
// mail al cliente y en la base se guarda su sha256. El formulario lo manda en
// la cabecera X-Pedido-Token (el link lo lleva en el fragmento #t=..., que el
// navegador no le manda al servidor ni pone en el Referer).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const audit = require('./audit');
const { CATALOGO, servicioPorTipo } = require('./servicios-docs');
const formulario = require('./docs-formulario');
const mails = require('./docs-mails');
const { decodificarDataUrl, PERMITIDOS_DOCS_SERVICIO, PERMITIDOS_ENTREGA } = require('./subidas');

const ESTADOS = Object.freeze({
  pendiente_pago: 'Pago pendiente',
  pagado: 'Pagado',
  formulario_completo: 'Formulario completo',
  borrador_revision: 'Borrador en revisión de Tomás',
  borrador_enviado: 'Borrador enviado',
  ajuste_en_curso: 'Ajuste en curso',
  version_final_enviada: 'Versión final enviada',
  cerrado: 'Cerrado',
});
const REUNION = Object.freeze({ link_enviado: 'Link enviado', agendada: 'Agendada', hecha: 'Hecha' });

// Cambios de estado que se hacen a mano desde el panel (sin mail). Los que
// mandan mail (borrador enviado, versión final enviada) tienen su función.
const TRANSICIONES_MANUALES = Object.freeze({
  formulario_completo: ['borrador_revision'],
  borrador_enviado: ['ajuste_en_curso'],
  version_final_enviada: ['cerrado'],
});
const PUEDE_ENVIAR_BORRADOR = ['formulario_completo', 'borrador_revision'];
const PUEDE_ENVIAR_FINAL = ['borrador_enviado', 'ajuste_en_curso'];

const MAX_ARCHIVOS = 20;
const MAX_BYTES_CLIENTE = 20 * 1024 * 1024;   // 20 MB en total (formulario.md)
const MAX_BYTES_ENTREGA = 28 * 1024 * 1024;   // Resend acepta 40 MB por mail ya en base64
const MAX_ADJUNTOS_ENTREGA = 10;
const DIAS_RONDA = 10;
const HOSTS_DRIVE = new Set(['docs.google.com', 'drive.google.com']);
const TZ = 'America/Argentina/Buenos_Aires';

let enviador = null; // inyectable en tests
function enviarMail(opts) {
  const fn = enviador || require('./notificaciones').enviarMailGenerico;
  return fn(opts);
}
function setEnviador(fn) { enviador = fn; }

const sha256 = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function baseUrl() {
  return (process.env.DOCS_BASE_URL || process.env.PUBLIC_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
function linkFormulario(token) { return `${baseUrl()}/tyc-startups/formulario#t=${token}`; }
function remitente() { return (process.env.MAIL_FROM_DOCS || 'Legal Pacer <contacto@legalpacer.com>').trim(); }
function responderA() { return (process.env.MAIL_REPLY_TO_DOCS || 'contacto@legalpacer.com').trim(); }
function mailAdmin() { return (process.env.MAIL_ADMIN || 'tomas@legalpacers.com').trim(); }

function anioAR(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(d);
}
function fechaISOAR(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); } // AAAA-MM-DD
function fechaLegible(iso) {
  const [a, m, d] = String(iso || '').split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

function dirArchivos(pedidoId) {
  const base = path.dirname(db.name || process.env.SQLITE_PATH || './data/legalpacers.db');
  return path.join(base, 'pedidos-docs', String(Number(pedidoId)));
}

function servicioDe(pedido) { return CATALOGO[pedido.servicio] || CATALOGO.combo; }
function datosDe(pedido) {
  try { return JSON.parse(pedido.respuestas || 'null') || null; } catch { return null; }
}

// ===== Alta y pago =====

// Se llama al iniciar el pago, con las casillas ya validadas.
function crearPedidoPendiente({ leadId, servicio, nombre }) {
  db.prepare(`INSERT INTO pedidos_docs (lead_id, servicio, nombre, ley_argentina_at, updated_at)
              VALUES (?, ?, ?, datetime('now'), datetime('now'))`).run(leadId, servicio, nombre || null);
}

function registrarMail(pedidoId, tipo, to, subject, r) {
  db.prepare('INSERT INTO pedidos_docs_mails (pedido_id, tipo, destinatario, asunto, ok, detalle) VALUES (?, ?, ?, ?, ?, ?)')
    .run(pedidoId, tipo, Array.isArray(to) ? to.join(', ') : to, subject, r && r.ok ? 1 : 0,
      r ? (r.stub ? 'stub' : r.id || r.error || null) : null);
}

async function avisarInterno(pedido, lead, evento) {
  const s = servicioDe(pedido);
  const a = mails.avisoInterno({ evento, numero: pedido.numero, servicio: s.nombre, proyecto: lead && lead.marca,
    panelUrl: `${(process.env.PUBLIC_URL || process.env.BASE_URL || baseUrl()).replace(/\/+$/, '')}/admin/` });
  const r = await enviarMail({ to: mailAdmin(), subject: a.subject, html: a.html, replyTo: lead && lead.email, tag: `docs_${evento}_admin` })
    .catch(err => ({ ok: false, error: err.message }));
  registrarMail(pedido.id, `aviso_${evento}`, mailAdmin(), a.subject, r);
  // WhatsApp a Tomás: solo si WHATSAPP_NOTIFY tiene un número y la Cloud API
  // está configurada. Meta solo acepta texto libre dentro de las 24 horas del
  // último mensaje de ese número: fuera de esa ventana falla y queda el mail.
  const numero = String(process.env.WHATSAPP_NOTIFY || '').replace(/\D/g, '');
  if (numero) {
    try {
      const wa = require('./bot/whatsapp');
      if (wa.configurado()) {
        const w = await wa.enviarWA(numero, a.whatsapp);
        if (!w.ok) console.error(`[docs] aviso WhatsApp ${pedido.numero}: ${w.error}`);
      } else {
        console.log(`[docs] ${a.whatsapp} → WHATSAPP_NOTIFY (WhatsApp no configurado, solo mail)`);
      }
    } catch (err) { console.error('[docs] aviso WhatsApp:', err.message); }
  }
}

async function mandarConfirmacion(pedido, lead, token) {
  const m = mails.mailConfirmacionPago({ codigo: pedido.servicio, nombre: pedido.nombre, numero: pedido.numero, linkFormulario: linkFormulario(token) });
  const r = await enviarMail({ to: lead.email, subject: m.subject, html: m.html, from: remitente(), replyTo: responderA(), tag: 'docs_confirmacion' })
    .catch(err => ({ ok: false, error: err.message }));
  registrarMail(pedido.id, 'confirmacion', lead.email, m.subject, r);
  return r;
}

// Pasa el pedido a "pagado", le asigna número y link, y manda el mail al
// cliente y el aviso a Tomás. Idempotente: si el pedido ya estaba pagado (MP
// manda el mismo aviso varias veces, a veces al mismo tiempo) no hace nada.
// Devuelve { activado, pedido }.
async function activarPorPago(leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  const servicio = lead && servicioPorTipo(lead.tipo);
  if (!servicio) return { activado: false };
  const token = nuevoToken();
  const activar = db.transaction(() => {
    // Pedido creado antes de esta versión (o sin fila): se crea al vuelo.
    db.prepare(`INSERT OR IGNORE INTO pedidos_docs (lead_id, servicio, updated_at) VALUES (?, ?, datetime('now'))`)
      .run(lead.id, servicio.codigo);
    const anio = anioAR();
    const prefijo = `LP-TP-${anio}-`;
    const max = db.prepare(`SELECT MAX(CAST(substr(numero, ?) AS INTEGER)) AS n FROM pedidos_docs WHERE numero LIKE ?`)
      .get(prefijo.length + 1, `${prefijo}%`).n || 0;
    const numero = `${prefijo}${String(max + 1).padStart(3, '0')}`;
    const r = db.prepare(`UPDATE pedidos_docs SET estado = 'pagado', numero = ?, token_hash = ?, pagado_at = datetime('now'),
                            updated_at = datetime('now')
                          WHERE lead_id = ? AND estado = 'pendiente_pago'`).run(numero, sha256(token), lead.id);
    return r.changes === 1;
  });
  const activado = activar();
  const pedido = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(lead.id);
  if (!activado) return { activado: false, pedido };
  audit.log(null, 'docs.pagado', { entidad: 'pedidos_docs', entidad_id: pedido.id, detalle: { numero: pedido.numero, servicio: pedido.servicio } });
  if (lead.email) await mandarConfirmacion(pedido, lead, token);
  await avisarInterno(pedido, lead, 'pago');
  return { activado: true, pedido };
}

// ===== Formulario (cliente, con el token) =====

function pedidoPorToken(token) {
  if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) return null;
  return db.prepare('SELECT * FROM pedidos_docs WHERE token_hash = ?').get(sha256(token)) || null;
}

function archivosDe(pedidoId) {
  return db.prepare('SELECT id, nombre, tipo, bytes, created_at FROM pedidos_docs_archivos WHERE pedido_id = ? ORDER BY id').all(pedidoId);
}

// Lo que ve el cliente en su formulario.
function vistaCliente(pedido) {
  const s = servicioDe(pedido);
  const editable = pedido.estado === 'pagado';
  return {
    numero: pedido.numero,
    servicio: s.codigo,
    servicio_nombre: s.nombre,
    nombre: pedido.nombre || '',
    estado: editable ? 'abierto' : 'enviado',
    intro: formulario.introFormulario(s.codigo),
    cierre: formulario.CIERRE,
    alcance: formulario.ALCANCE,
    secciones: formulario.preguntasPara([...s.documentos]),
    archivos_info: formulario.ARCHIVOS,
    redes_info: formulario.REDES,
    texto_vende_productos: formulario.TEXTO_VENDE_PRODUCTOS,
    datos: datosDe(pedido),
    consentimiento_ia: !!pedido.consentimiento_ia_at,
    texto_consentimiento: formulario.textoConsentimiento(),
    archivos: archivosDe(pedido.id),
    max_bytes: MAX_BYTES_CLIENTE,
  };
}

// Guarda lo que hay (se puede dejar a medias). Con enviar=true, cierra el
// formulario si están C1 a C7 y la casilla de consentimiento.
// Devuelve { ok, error?, faltan?, enviado? }.
async function guardarRespuestas(pedido, body) {
  if (pedido.estado !== 'pagado') return { ok: false, status: 409, error: 'El formulario ya fue enviado.' };
  const s = servicioDe(pedido);
  const datos = formulario.normalizarRespuestas(body, [...s.documentos]);
  const consentimiento = body && body.consentimiento_ia === true;
  db.prepare(`UPDATE pedidos_docs SET respuestas = ?, respuestas_at = datetime('now'),
                consentimiento_ia_at = CASE WHEN ? THEN COALESCE(consentimiento_ia_at, datetime('now')) ELSE NULL END,
                updated_at = datetime('now')
              WHERE id = ? AND estado = 'pagado'`).run(JSON.stringify(datos), consentimiento ? 1 : 0, pedido.id);
  if (!(body && body.enviar === true)) return { ok: true, enviado: false };
  const faltan = formulario.faltantesParaEnviar(datos, consentimiento);
  if (faltan.length) return { ok: false, status: 400, error: 'Faltan respuestas para enviar el formulario.', faltan };
  const r = db.prepare(`UPDATE pedidos_docs SET estado = 'formulario_completo', formulario_completo_at = datetime('now'),
                          updated_at = datetime('now') WHERE id = ? AND estado = 'pagado'`).run(pedido.id);
  if (r.changes !== 1) return { ok: false, status: 409, error: 'El formulario ya fue enviado.' };
  audit.log(null, 'docs.formulario_completo', { entidad: 'pedidos_docs', entidad_id: pedido.id, detalle: { numero: pedido.numero } });
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(pedido.lead_id);
  await avisarInterno(pedido, lead, 'formulario');
  return { ok: true, enviado: true };
}

// Nombre para mostrar: sin rutas ni caracteres de control, con tope de largo.
function nombreSeguro(nombre, ext) {
  let base = path.basename(String(nombre || 'archivo')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').trim();
  base = base.replace(/\.[^.]*$/, '').slice(0, 100) || 'archivo';
  return `${base}.${ext}`;
}

// Valida y guarda un archivo del cliente. El tipo sale del contenido.
function agregarArchivo(pedido, body) {
  if (pedido.estado !== 'pagado') return { ok: false, status: 409, error: 'El formulario ya fue enviado.' };
  if (!pedido.consentimiento_ia_at) return { ok: false, status: 400, error: 'Antes de subir archivos marcá la casilla de consentimiento.' };
  const actuales = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM pedidos_docs_archivos WHERE pedido_id = ?').get(pedido.id);
  if (actuales.n >= MAX_ARCHIVOS) return { ok: false, status: 400, error: `Podés subir hasta ${MAX_ARCHIVOS} archivos.` };
  const a = decodificarDataUrl(body && body.archivo, PERMITIDOS_DOCS_SERVICIO);
  if (!a.ok) return { ok: false, status: 400, error: a.error };
  if (actuales.b + a.buf.length > MAX_BYTES_CLIENTE) {
    return { ok: false, status: 413, error: 'Entre todos los archivos pasás los 20 MB. Probá con versiones más livianas.' };
  }
  const dir = dirArchivos(pedido.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ruta = path.join(dir, `${crypto.randomBytes(12).toString('hex')}.${a.ext}`);
  fs.writeFileSync(ruta, a.buf, { mode: 0o600 });
  const info = db.prepare('INSERT INTO pedidos_docs_archivos (pedido_id, nombre, tipo, bytes, ruta) VALUES (?, ?, ?, ?, ?)')
    .run(pedido.id, nombreSeguro(body.nombre, a.ext), a.tipo, a.buf.length, ruta);
  return { ok: true, archivo: db.prepare('SELECT id, nombre, tipo, bytes, created_at FROM pedidos_docs_archivos WHERE id = ?').get(info.lastInsertRowid) };
}

// Borra un archivo del pedido. Siempre filtra por pedido_id: con el token de
// un pedido no se puede tocar el archivo de otro.
function borrarArchivo(pedido, archivoId) {
  if (pedido.estado !== 'pagado') return { ok: false, status: 409, error: 'El formulario ya fue enviado.' };
  const a = db.prepare('SELECT * FROM pedidos_docs_archivos WHERE id = ? AND pedido_id = ?').get(Number(archivoId), pedido.id);
  if (!a) return { ok: false, status: 404, error: 'No encontramos ese archivo.' };
  try { fs.unlinkSync(a.ruta); } catch {}
  db.prepare('DELETE FROM pedidos_docs_archivos WHERE id = ?').run(a.id);
  return { ok: true };
}

// ===== Panel =====

function listar() {
  return db.prepare(`
    SELECT p.id, p.numero, p.servicio, p.nombre, p.estado, p.reunion_estado, p.pagado_at, p.formulario_completo_at,
           p.borrador_enviado_at, p.ronda_vence, p.version_final_at, p.cerrado_at, p.created_at,
           l.email, l.marca AS proyecto, l.monto,
           (SELECT COUNT(*) FROM pedidos_docs_archivos a WHERE a.pedido_id = p.id) AS archivos
    FROM pedidos_docs p JOIN leads l ON l.id = p.lead_id
    WHERE p.estado <> 'pendiente_pago'
    ORDER BY p.id DESC LIMIT 500
  `).all().map(p => ({ ...p, servicio_nombre: (CATALOGO[p.servicio] || {}).nombre || p.servicio,
    estado_txt: ESTADOS[p.estado] || p.estado, reunion_txt: REUNION[p.reunion_estado] || '' }));
}

function obtener(id) {
  return db.prepare('SELECT * FROM pedidos_docs WHERE id = ?').get(Number(id)) || null;
}

function detalle(id) {
  const p = obtener(id);
  if (!p) return null;
  const lead = db.prepare('SELECT id, email, telefono, marca, monto, payment_ref, consentimiento_at, notas FROM leads WHERE id = ?').get(p.lead_id);
  const s = servicioDe(p);
  return {
    id: p.id, numero: p.numero, servicio: s.codigo, servicio_nombre: s.nombre, documentos: [...s.documentos],
    nombre: p.nombre, email: lead && lead.email, proyecto: lead && lead.marca, monto: lead && lead.monto,
    payment_ref: lead && lead.payment_ref,
    estado: p.estado, estado_txt: ESTADOS[p.estado] || p.estado,
    reunion_estado: p.reunion_estado, reunion_txt: REUNION[p.reunion_estado] || '',
    transiciones: (TRANSICIONES_MANUALES[p.estado] || []).map(e => ({ estado: e, txt: ESTADOS[e] })),
    puede_enviar_borrador: PUEDE_ENVIAR_BORRADOR.includes(p.estado),
    puede_enviar_final: PUEDE_ENVIAR_FINAL.includes(p.estado),
    fechas: {
      creado: p.created_at, pagado: p.pagado_at, formulario_completo: p.formulario_completo_at,
      borrador_enviado: p.borrador_enviado_at, ronda_vence: p.ronda_vence, version_final: p.version_final_at,
      cerrado: p.cerrado_at, respuestas: p.respuestas_at, archivos_borrados: p.archivos_borrados_at,
      ley_argentina: p.ley_argentina_at, consentimiento_pago: lead && lead.consentimiento_at, consentimiento_ia: p.consentimiento_ia_at,
    },
    respuestas: formulario.respuestasLegibles(datosDe(p), [...s.documentos]),
    archivos: archivosDe(p.id),
    mails: db.prepare('SELECT tipo, destinatario, asunto, ok, detalle, created_at FROM pedidos_docs_mails WHERE pedido_id = ? ORDER BY id').all(p.id),
  };
}

function archivoDePedido(pedidoId, archivoId) {
  return db.prepare('SELECT * FROM pedidos_docs_archivos WHERE id = ? AND pedido_id = ?').get(Number(archivoId), Number(pedidoId)) || null;
}

function cambiarEstado(id, nuevo, actorId) {
  const p = obtener(id);
  if (!p) return { ok: false, status: 404, error: 'Pedido no encontrado' };
  if (!(TRANSICIONES_MANUALES[p.estado] || []).includes(nuevo)) {
    return { ok: false, status: 409, error: `No se puede pasar de "${ESTADOS[p.estado] || p.estado}" a "${ESTADOS[nuevo] || nuevo}".` };
  }
  const extra = nuevo === 'cerrado' ? ", cerrado_at = datetime('now')" : '';
  db.prepare(`UPDATE pedidos_docs SET estado = ?, updated_at = datetime('now')${extra} WHERE id = ? AND estado = ?`).run(nuevo, p.id, p.estado);
  audit.log(actorId, 'docs.estado', { entidad: 'pedidos_docs', entidad_id: p.id, detalle: { de: p.estado, a: nuevo } });
  return { ok: true };
}

function cambiarReunion(id, estado, actorId) {
  const p = obtener(id);
  if (!p) return { ok: false, status: 404, error: 'Pedido no encontrado' };
  if (estado !== null && !Object.prototype.hasOwnProperty.call(REUNION, estado)) return { ok: false, status: 400, error: 'Estado de reunión inválido' };
  db.prepare("UPDATE pedidos_docs SET reunion_estado = ?, updated_at = datetime('now') WHERE id = ?").run(estado, p.id);
  audit.log(actorId, 'docs.reunion', { entidad: 'pedidos_docs', entidad_id: p.id, detalle: { reunion: estado } });
  return { ok: true };
}

// Evita que un doble clic mande dos veces el mismo mail.
const enCurso = new Set();
async function conCandado(id, fn) {
  if (enCurso.has(id)) return { ok: false, status: 409, error: 'Ya se está enviando un mail de este pedido.' };
  enCurso.add(id);
  try { return await fn(); } finally { enCurso.delete(id); }
}

function linkDriveValido(url) {
  try {
    const u = new URL(String(url || '').trim());
    return u.protocol === 'https:' && HOSTS_DRIVE.has(u.hostname) && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

// Borrador enviado: links = { terminos?: url, privacidad?: url } (uno por
// documento del pedido). Con previsualizar=true devuelve el mail sin mandarlo.
async function enviarBorrador(id, { links, previsualizar }, actorId) {
  const p = obtener(id);
  if (!p) return { ok: false, status: 404, error: 'Pedido no encontrado' };
  if (!PUEDE_ENVIAR_BORRADOR.includes(p.estado)) return { ok: false, status: 409, error: `El pedido está en "${ESTADOS[p.estado]}".` };
  const s = servicioDe(p);
  const lista = [];
  for (const doc of s.documentos) {
    const url = linkDriveValido(links && links[doc]);
    if (!url) return { ok: false, status: 400, error: `Falta el link de Google Drive del borrador (${doc === 'terminos' ? 'términos y condiciones' : 'política de privacidad'}). Tiene que empezar con https://docs.google.com o https://drive.google.com.` };
    lista.push({ documento: doc, url });
  }
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(p.lead_id);
  const vence = fechaISOAR(new Date(Date.now() + DIAS_RONDA * 86400000));
  const m = mails.mailBorrador({ codigo: s.codigo, nombre: p.nombre, links: lista, fechaLimite: fechaLegible(vence) });
  if (previsualizar) return { ok: true, preview: { to: lead.email, from: remitente(), subject: m.subject, html: require('./notificaciones').aplicarMarca(m.html) } };
  return conCandado(p.id, async () => {
    const r = await enviarMail({ to: lead.email, subject: m.subject, html: m.html, from: remitente(), replyTo: responderA(), tag: 'docs_borrador' })
      .catch(err => ({ ok: false, error: err.message }));
    registrarMail(p.id, 'borrador', lead.email, m.subject, r);
    if (!r.ok) return { ok: false, status: 502, error: `No se pudo mandar el mail: ${r.error || 'error'}` };
    db.prepare(`UPDATE pedidos_docs SET estado = 'borrador_enviado', borrador_enviado_at = datetime('now'), ronda_vence = ?,
                  updated_at = datetime('now') WHERE id = ?`).run(vence, p.id);
    audit.log(actorId, 'docs.borrador_enviado', { entidad: 'pedidos_docs', entidad_id: p.id, detalle: { numero: p.numero, ronda_vence: vence } });
    return { ok: true, ronda_vence: vence };
  });
}

// Versión final enviada: adjuntos = [{ nombre, archivo: dataUrl }] (Word y
// PDF, más las guías). Los adjuntos no se guardan en el sistema: la copia
// queda en la carpeta del caso en Drive (procedimiento.md, paso 2).
async function enviarVersionFinal(id, { adjuntos, previsualizar }, actorId) {
  const p = obtener(id);
  if (!p) return { ok: false, status: 404, error: 'Pedido no encontrado' };
  if (!PUEDE_ENVIAR_FINAL.includes(p.estado)) return { ok: false, status: 409, error: `El pedido está en "${ESTADOS[p.estado]}".` };
  const s = servicioDe(p);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(p.lead_id);
  const m = mails.mailVersionFinal({ codigo: s.codigo, nombre: p.nombre });
  const lista = Array.isArray(adjuntos) ? adjuntos : [];
  if (!previsualizar) {
    if (!lista.length) return { ok: false, status: 400, error: 'Adjuntá la versión final en Word y PDF y las guías.' };
    if (lista.length > MAX_ADJUNTOS_ENTREGA) return { ok: false, status: 400, error: `Hasta ${MAX_ADJUNTOS_ENTREGA} adjuntos.` };
  }
  const archivos = [];
  let total = 0;
  for (const adj of lista) {
    const a = decodificarDataUrl(adj && adj.archivo, PERMITIDOS_ENTREGA);
    if (!a.ok) return { ok: false, status: 400, error: `${nombreSeguro(adj && adj.nombre, 'x').slice(0, -2)}: ${a.error}` };
    total += a.buf.length;
    if (total > MAX_BYTES_ENTREGA) return { ok: false, status: 413, error: 'Los adjuntos pasan los 28 MB: el mail no saldría.' };
    archivos.push({ filename: nombreSeguro(adj.nombre, a.ext), content: a.buf });
  }
  if (previsualizar) {
    return { ok: true, preview: { to: lead.email, from: remitente(), subject: m.subject, html: require('./notificaciones').aplicarMarca(m.html),
      adjuntos: archivos.map(a => ({ nombre: a.filename, bytes: a.content.length })) } };
  }
  return conCandado(p.id, async () => {
    const r = await enviarMail({ to: lead.email, subject: m.subject, html: m.html, attachments: archivos, from: remitente(), replyTo: responderA(), tag: 'docs_version_final' })
      .catch(err => ({ ok: false, error: err.message }));
    registrarMail(p.id, 'version_final', lead.email, m.subject, r);
    if (!r.ok) return { ok: false, status: 502, error: `No se pudo mandar el mail: ${r.error || 'error'}` };
    // El link al formulario deja de servir: ya no hay nada que completar.
    db.prepare(`UPDATE pedidos_docs SET estado = 'version_final_enviada', version_final_at = datetime('now'),
                  reunion_estado = COALESCE(reunion_estado, 'link_enviado'), token_hash = NULL, updated_at = datetime('now')
                WHERE id = ?`).run(p.id);
    audit.log(actorId, 'docs.version_final_enviada', { entidad: 'pedidos_docs', entidad_id: p.id, detalle: {
      numero: p.numero, adjuntos: archivos.map(a => ({ nombre: a.filename, bytes: a.content.length, sha256: sha256(a.content) })) } });
    return { ok: true };
  });
}

// Link nuevo al formulario (si el mail no llegó). El anterior deja de servir.
async function reenviarLink(id, actorId) {
  const p = obtener(id);
  if (!p) return { ok: false, status: 404, error: 'Pedido no encontrado' };
  if (p.estado !== 'pagado') return { ok: false, status: 409, error: 'El formulario ya fue enviado.' };
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(p.lead_id);
  return conCandado(p.id, async () => {
    const token = nuevoToken();
    db.prepare("UPDATE pedidos_docs SET token_hash = ?, updated_at = datetime('now') WHERE id = ?").run(sha256(token), p.id);
    const r = await mandarConfirmacion(p, lead, token);
    audit.log(actorId, 'docs.link_reenviado', { entidad: 'pedidos_docs', entidad_id: p.id, detalle: { ok: !!r.ok } });
    return r.ok ? { ok: true } : { ok: false, status: 502, error: `No se pudo mandar el mail: ${r.error || 'error'}` };
  });
}

// Borra los archivos subidos por el cliente a los N días de la versión final
// (90 por defecto, DOCS_ARCHIVOS_DIAS). Ver docs/datos-personales-tyc-pp.md.
function limpiarArchivosVencidos({ dias } = {}) {
  const n = Number.isInteger(dias) && dias > 0 ? dias : (parseInt(process.env.DOCS_ARCHIVOS_DIAS || '90', 10) || 90);
  const vencidos = db.prepare(`SELECT id FROM pedidos_docs WHERE version_final_at IS NOT NULL AND archivos_borrados_at IS NULL
                                 AND version_final_at <= datetime('now', ?)`).all(`-${n} days`);
  let archivos = 0;
  for (const { id } of vencidos) {
    for (const a of db.prepare('SELECT * FROM pedidos_docs_archivos WHERE pedido_id = ?').all(id)) {
      try { fs.unlinkSync(a.ruta); } catch {}
      archivos++;
    }
    db.prepare('DELETE FROM pedidos_docs_archivos WHERE pedido_id = ?').run(id);
    try { fs.rmSync(dirArchivos(id), { recursive: true, force: true }); } catch {}
    db.prepare("UPDATE pedidos_docs SET archivos_borrados_at = datetime('now') WHERE id = ?").run(id);
    audit.log(null, 'docs.archivos_borrados', { entidad: 'pedidos_docs', entidad_id: id, detalle: { dias: n } });
  }
  return { pedidos: vencidos.length, archivos };
}

module.exports = {
  ESTADOS, REUNION, MAX_BYTES_CLIENTE, MAX_ARCHIVOS,
  sha256, setEnviador, linkFormulario,
  crearPedidoPendiente, activarPorPago,
  pedidoPorToken, vistaCliente, guardarRespuestas, agregarArchivo, borrarArchivo,
  listar, detalle, obtener, archivoDePedido, cambiarEstado, cambiarReunion,
  enviarBorrador, enviarVersionFinal, reenviarLink, limpiarArchivosVencidos, linkDriveValido,
};
