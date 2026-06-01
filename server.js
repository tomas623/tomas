require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const db = require('./src/db');
const { buscarEnINPI, enmascararActa } = require('./src/inpi');
const { crearPreferencia, obtenerPago } = require('./src/pagos');
const { mountAuthRoutes } = require('./src/auth');
const { mountAdminRoutes } = require('./src/admin');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const PRECIO_INFORME = parseInt(process.env.PRECIO_INFORME || '19900', 10);
const PRECIO_REGISTRO = parseInt(process.env.PRECIO_REGISTRO || '120000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ROOT_DIR = __dirname;

app.use(express.json({ limit: '256kb' }));
mountAuthRoutes(app);
mountAdminRoutes(app);

// Detectar clases Niza por rubro — espejo de la lógica del front (detectarClases).
function detectarClasesPorRubro(rubro) {
  const q = (rubro || '').toLowerCase().trim();
  if (!q) return [];
  if (/(ropa|indumentaria|remera|moda)/.test(q)) return [25, 35];
  if (/(cafe|café|pasteleria|pastelería|comida)/.test(q)) return [30, 43];
  if (/(app|software|tecnologia|tecnología|web)/.test(q)) return [9, 42];
  if (/(cosmetica|cosmética|skincare)/.test(q)) return [3, 44];
  if (/(restaurante|delivery|gastronom)/.test(q)) return [43];
  return [35];
}

const RUBROS_CONOCIDOS_RE = /(ropa|indumentaria|remera|moda|cafe|café|pasteleria|pastelería|comida|app|software|tecnologia|tecnología|web|cosmetica|cosmética|skincare|restaurante|delivery|gastronom)/i;

function ok(data) { return { ok: true, data }; }
function fail(msg, code = 400) { return { ok: false, error: msg, code }; }

// ===== Healthcheck =====
app.get('/api/health', (req, res) => res.json(ok({ status: 'up', ts: Date.now() })));

// ===== 2.1 Precio del informe =====
app.get('/api/marca/precio-informe', (req, res) => {
  res.json(ok({ precio: PRECIO_INFORME, moneda: 'ARS' }));
});

// ===== 2.2 Pre-check gratis =====
app.post('/api/marca/check', (req, res) => {
  const { marca, clases, rubro } = req.body || {};
  if (!marca || !String(marca).trim()) {
    return res.status(400).json(fail('Falta la marca a chequear'));
  }

  const clasesUsuario = Array.isArray(clases) ? clases.filter(Number.isFinite) : [];
  const clasesSugeridas = detectarClasesPorRubro(rubro);

  // Búsqueda en las clases que pidió el frontend (las "sugeridas").
  const hitsClase = buscarEnINPI(marca, clasesUsuario);
  // Búsqueda global (cualquier clase) para detectar coincidencias fuera de las clases buscadas.
  const hitsTodos = buscarEnINPI(marca, null);

  const rubroConocido = !!rubro && RUBROS_CONOCIDOS_RE.test(rubro);
  const rubroIngresado = !!(rubro && String(rubro).trim());
  const clasesNoMatchean = rubroIngresado && !rubroConocido;

  let veredicto, mensaje, muestras = [];

  if (hitsClase.length > 0) {
    veredicto = 'no_disponible';
    const top = hitsClase[0];
    mensaje = `Encontramos <strong>${hitsClase.length} acta${hitsClase.length === 1 ? '' : 's'}</strong> que coincide${hitsClase.length === 1 ? '' : 'n'} de forma exacta en la clase ${top.clase}.`;
    muestras = hitsClase.slice(0, 5);
  } else if (hitsTodos.length > 0) {
    // Hay coincidencias en otras clases. Aviso de "necesita_analisis" para que el cliente
    // entienda que aunque la clase pedida está libre, el nombre existe registrado en otras.
    veredicto = 'necesita_analisis';
    mensaje = `La denominación no choca en la${clasesUsuario.length === 1 ? '' : 's'} clase${clasesUsuario.length === 1 ? '' : 's'} ${clasesUsuario.join(', ') || 'consultada'}, pero <strong>existen ${hitsTodos.length} registro${hitsTodos.length === 1 ? '' : 's'}</strong> con la misma denominación en otras clases. Necesita análisis profesional para confirmar viabilidad.`;
    muestras = hitsTodos.slice(0, 5);
  } else if (clasesNoMatchean) {
    // Regla UX del cliente: si no podemos mapear el rubro a una clase conocida,
    // no podemos dar un "LIBRE" honesto — devolvemos necesita_analisis.
    veredicto = 'necesita_analisis';
    mensaje = `No identificamos automáticamente la clase Niza correcta para "${String(rubro).slice(0, 60)}". Para evitar un falso "LIBRE" en la clase equivocada, te recomendamos auditar la viabilidad con nuestro equipo.`;
  } else {
    veredicto = 'probablemente_disponible';
    mensaje = `No encontramos coincidencias exactas en la${clasesUsuario.length === 1 ? '' : 's'} clase${clasesUsuario.length === 1 ? '' : 's'} ${clasesUsuario.join(', ') || 'consultada'} del INPI. El pre-check no analiza similitud fonética ni conceptual.`;
  }

  const tease = {
    muestras: muestras.map(m => ({
      denominacion: m.denominacion,
      clase: m.clase,
      acta: enmascararActa(m.acta),
      estado: m.estado || 'Concedida',
      titular: m.titular || '—',
    })),
  };

  res.json(ok({
    veredicto,
    mensaje,
    tease,
    meta: {
      clases_buscadas: clasesUsuario,
      clases_sugeridas: clasesSugeridas,
      coincidencias_clase: hitsClase.length,
      coincidencias_otras_clases: Math.max(0, hitsTodos.length - hitsClase.length),
    },
  }));
});

// ===== 2.3 / 2.4 helpers =====
function crearLead({ tipo, marca, email, telefono, clases, rubro, monto }) {
  const externalReference = `${tipo}-${crypto.randomBytes(8).toString('hex')}`;
  const stmt = db.prepare(`
    INSERT INTO leads (tipo, marca, email, telefono, clases, rubro, monto, external_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    tipo, marca, email || null, telefono || null,
    JSON.stringify(clases || []), rubro || null, monto, externalReference,
  );
  return { id: info.lastInsertRowid, externalReference };
}

function actualizarInitPoint(id, initPoint, preferenceId) {
  db.prepare('UPDATE leads SET init_point = ?, payment_ref = COALESCE(payment_ref, ?) WHERE id = ?')
    .run(initPoint, preferenceId || null, id);
}

// ===== 2.3 Checkout informe $19.900 =====
app.post('/api/marca/consulta/iniciar', async (req, res) => {
  const { marca, email, clases, rubro } = req.body || {};
  if (!marca || !String(marca).trim()) return res.status(400).json(fail('Falta la marca'));
  if (!email || !String(email).includes('@')) return res.status(400).json(fail('Email inválido'));

  const lead = crearLead({
    tipo: 'informe', marca: String(marca).trim(), email: String(email).trim(),
    telefono: null, clases: clases || [], rubro: rubro || null, monto: PRECIO_INFORME,
  });

  try {
    const pref = await crearPreferencia({
      titulo: `LegalPacers · Informe de viabilidad de marca "${String(marca).slice(0, 60)}"`,
      precio: PRECIO_INFORME,
      externalReference: lead.externalReference,
      email,
      baseUrl: BASE_URL,
    });
    actualizarInitPoint(lead.id, pref.init_point, pref.preference_id);
    return res.json(ok({ init_point: pref.init_point, lead_id: lead.id, stub: !!pref.stub }));
  } catch (err) {
    console.error('[consulta/iniciar] error MP:', err.message);
    return res.status(502).json(fail('No pudimos crear la preferencia de pago.'));
  }
});

// ===== 2.4 Checkout registro $120.000 =====
app.post('/api/marca/registro/iniciar', async (req, res) => {
  const { marca, email, telefono, clases, rubro } = req.body || {};
  if (!marca || !String(marca).trim()) return res.status(400).json(fail('Falta la marca'));
  if (!email || !String(email).includes('@')) return res.status(400).json(fail('Email inválido'));
  if (!telefono || !String(telefono).trim()) return res.status(400).json(fail('Falta el teléfono'));

  const lead = crearLead({
    tipo: 'registro', marca: String(marca).trim(), email: String(email).trim(),
    telefono: String(telefono).trim(), clases: clases || [], rubro: rubro || null,
    monto: PRECIO_REGISTRO,
  });

  // Notificación interna (WhatsApp / log) para acelerar el flujo humano del cliente.
  if (process.env.WHATSAPP_NOTIFY) {
    console.log(`[lead:registro] Nuevo lead id=${lead.id} marca="${marca}" tel=${telefono} → notificar ${process.env.WHATSAPP_NOTIFY}`);
  }

  try {
    const pref = await crearPreferencia({
      titulo: `LegalPacers · Honorarios registro de marca "${String(marca).slice(0, 60)}"`,
      precio: PRECIO_REGISTRO,
      externalReference: lead.externalReference,
      email,
      baseUrl: BASE_URL,
    });
    actualizarInitPoint(lead.id, pref.init_point, pref.preference_id);
    return res.json(ok({ init_point: pref.init_point, lead_id: lead.id, stub: !!pref.stub }));
  } catch (err) {
    console.error('[registro/iniciar] error MP:', err.message);
    return res.status(502).json(fail('No pudimos crear la preferencia de pago.'));
  }
});

// ===== Webhook de Mercado Pago =====
app.post('/api/pagos/webhook', express.json(), async (req, res) => {
  // MP manda eventos tipo: { type: "payment", data: { id: "..." } } o como query string.
  const type = req.body?.type || req.query?.type;
  const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

  res.status(200).json({ ok: true }); // ACK rápido a MP

  if (type !== 'payment' || !paymentId) return;

  try {
    const pago = await obtenerPago(paymentId);
    if (!pago) return;
    const ref = pago.external_reference;
    const estado = pago.status; // approved | rejected | pending ...
    if (!ref) return;

    const lead = db.prepare('SELECT * FROM leads WHERE external_reference = ?').get(ref);
    if (!lead) return;

    if (estado === 'approved' && lead.estado !== 'pagado') {
      db.prepare(`UPDATE leads SET estado = 'pagado', payment_ref = ?, pagado_at = datetime('now') WHERE id = ?`)
        .run(String(paymentId), lead.id);
      console.log(`[webhook] lead ${lead.id} (${lead.tipo}, ${lead.marca}) marcado pagado.`);
      // TODO: disparar WhatsApp/email al cliente y al equipo legal.
    } else {
      db.prepare(`UPDATE leads SET estado = ?, payment_ref = ? WHERE id = ?`)
        .run(estado || lead.estado, String(paymentId), lead.id);
    }
  } catch (err) {
    console.error('[webhook] error procesando pago:', err.message);
  }
});

// ===== Endpoints stub para Mercado Pago en modo sin credenciales =====
app.get('/pagos/stub', (req, res) => {
  const { ref, monto, titulo } = req.query;
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Stub MP</title>
<style>body{font-family:system-ui;background:#030712;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{background:#0f172a;border:1px solid #334155;border-radius:14px;padding:32px;max-width:480px;text-align:center}
button{background:#1b6ef3;color:#fff;border:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin:4px}
button.bad{background:#334155}</style>
<div class="box">
<h2>Stub Mercado Pago</h2>
<p style="opacity:.75">No hay <code>MP_ACCESS_TOKEN</code> configurado. Esta pantalla simula Checkout Pro.</p>
<p><strong>${(titulo || '').toString().replace(/[<>]/g, '')}</strong></p>
<p style="font-size:28px;font-weight:800">$ ${Number(monto || 0).toLocaleString('es-AR')}</p>
<p style="font-size:12px;opacity:.7">ref: ${(ref || '').toString().replace(/[<>]/g, '')}</p>
<form method="POST" action="/pagos/stub/confirmar" style="display:inline">
  <input type="hidden" name="ref" value="${(ref || '').toString().replace(/"/g, '')}">
  <input type="hidden" name="estado" value="approved">
  <button>Aprobar pago (stub)</button>
</form>
<form method="POST" action="/pagos/stub/confirmar" style="display:inline">
  <input type="hidden" name="ref" value="${(ref || '').toString().replace(/"/g, '')}">
  <input type="hidden" name="estado" value="rejected">
  <button class="bad">Rechazar pago</button>
</form>
</div>`);
});

app.post('/pagos/stub/confirmar', express.urlencoded({ extended: false }), (req, res) => {
  const { ref, estado } = req.body || {};
  if (!ref) return res.status(400).send('ref requerido');
  const lead = db.prepare('SELECT * FROM leads WHERE external_reference = ?').get(ref);
  if (!lead) return res.status(404).send('lead no encontrado');
  if (estado === 'approved') {
    db.prepare(`UPDATE leads SET estado = 'pagado', payment_ref = ?, pagado_at = datetime('now') WHERE id = ?`)
      .run(`STUB-PAY-${Date.now()}`, lead.id);
    console.log(`[stub-pago] lead ${lead.id} (${lead.tipo}, ${lead.marca}) marcado pagado vía stub.`);
    return res.redirect(`/pagos/exito?ref=${encodeURIComponent(ref)}`);
  }
  db.prepare(`UPDATE leads SET estado = 'rechazado' WHERE id = ?`).run(lead.id);
  return res.redirect(`/pagos/error?ref=${encodeURIComponent(ref)}`);
});

function paginaResultado(titulo, mensaje, color) {
  return `<!doctype html><meta charset="utf-8"><title>${titulo}</title>
<style>body{font-family:system-ui;background:#030712;color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{background:#0f172a;border:1px solid ${color};border-radius:14px;padding:32px;max-width:480px;text-align:center}
a{color:#60a5fa}</style>
<div class="box"><h2>${titulo}</h2><p>${mensaje}</p><p><a href="/">Volver al inicio</a></p></div>`;
}

app.get('/pagos/exito', (req, res) =>
  res.type('html').send(paginaResultado('Pago aprobado', 'En breve nos contactamos por WhatsApp / email.', '#10b981')));
app.get('/pagos/error', (req, res) =>
  res.type('html').send(paginaResultado('Pago rechazado', 'No se pudo procesar el pago.', '#ef4444')));
app.get('/pagos/pendiente', (req, res) =>
  res.type('html').send(paginaResultado('Pago pendiente', 'Te avisamos cuando se acredite.', '#f59e0b')));

// ===== Landing estática =====
app.get('/', (req, res) => res.sendFile(path.join(ROOT_DIR, 'landing-legalpacers.html')));
app.use('/static', express.static(path.join(ROOT_DIR, 'static')));

// Panel admin (HTML estático). Las rutas /api/admin/* viven en src/admin.js.
app.use('/admin', express.static(path.join(ROOT_DIR, 'public', 'admin')));

app.use((req, res) => res.status(404).json(fail('Not found', 404)));

app.listen(PORT, () => {
  const mpMode = (process.env.MP_ACCESS_TOKEN || '').trim() ? 'real' : 'STUB';
  console.log(`[legalpacers] escuchando en ${BASE_URL} (PORT=${PORT}, MP=${mpMode})`);
});
