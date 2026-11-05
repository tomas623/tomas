// Punta a punta contra server.js (servicio de términos y condiciones /
// privacidad activado) con una base temporal y un Mercado Pago falso local:
// pago, webhook idempotente, link único, subidas, IDOR y panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fixtures = require('./helpers/zip');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-docs-srv-'));
const DB = path.join(TMP, 'test.db');
const PORT = 40000 + Math.floor(Math.random() * 1000);
const MP_PORT = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
let srv; let mp; let cookie = '';

// Mercado Pago falso: crea preferencias y devuelve los pagos que cargue la prueba.
const pagos = {};
const pedidosMp = [];
function arrancarMp() {
  mp = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/checkout/preferences') {
        const b = JSON.parse(body); pedidosMp.push(b);
        return res.end(JSON.stringify({ id: `PREF-${pedidosMp.length}`, init_point: `https://mp.test/checkout/${pedidosMp.length}` }));
      }
      const m = /^\/v1\/payments\/(\w+)$/.exec(req.url);
      if (m && pagos[m[1]]) return res.end(JSON.stringify(pagos[m[1]]));
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise(r => mp.listen(MP_PORT, '127.0.0.1', r));
}

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const PDF = Buffer.from('%PDF-1.4\n%fin\n');
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const json = (metodo, url, body, headers = {}) => fetch(BASE + url, {
  method: metodo, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
const conToken = (t) => ({ 'X-Pedido-Token': t });
const espera = ms => new Promise(r => setTimeout(r, ms));
const abrirDb = () => new Database(DB);

async function esperarServidor() {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/health`); return; } catch { await espera(100); }
  }
  throw new Error('el servidor no arrancó');
}

const INICIO = { servicio: 'tyc', nombre: 'Ana', email: 'ana@ejemplo.test', proyecto: 'Ana App', ley_argentina: true, consentimiento: true };

test.before(async () => {
  await arrancarMp();
  srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), SQLITE_PATH: DB, CRON_ENABLED: 'false', BASE_URL: BASE,
      RESEND_API_KEY: '', MP_ACCESS_TOKEN: 'TEST-token', MP_API_URL: `http://127.0.0.1:${MP_PORT}`, PUBLIC_URL: 'https://publico.test',
      SERVICIOS_DOCS_ACTIVOS: '1', PRECIO_TYC: '200000', PRECIO_PRIVACIDAD: '200000', PRECIO_TYC_PRIVACIDAD: '275000',
      WHATSAPP_NOTIFY: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await esperarServidor();
  const db = abrirDb();
  db.prepare("INSERT INTO usuarios (email, password_hash, rol) VALUES ('admin@test', ?, 'admin')").run(bcrypt.hashSync('clave123', 4));
  db.close();
  const r = await json('POST', '/api/auth/login', { email: 'admin@test', password: 'clave123' });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
});

test.after(() => { if (srv) srv.kill(); if (mp) mp.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

// Inicia un pago, lo aprueba en el MP falso y manda el webhook. Devuelve el pedido.
let nPago = 0;
async function comprar(extra = {}, monto) {
  const r = await json('POST', '/api/lp/docs/iniciar', { ...INICIO, ...extra });
  assert.equal(r.status, 200);
  const pref = pedidosMp[pedidosMp.length - 1];
  const id = String(9000 + (++nPago));
  pagos[id] = { id, status: 'approved', external_reference: pref.external_reference, transaction_amount: monto ?? pref.items[0].unit_price, currency_id: 'ARS' };
  return { id, ref: pref.external_reference };
}
// El token en claro solo sale por mail: la prueba le pone uno conocido.
function ponerToken(ref) {
  const token = crypto.randomBytes(32).toString('base64url');
  const db = abrirDb();
  db.prepare('UPDATE pedidos_docs SET token_hash = ? WHERE lead_id = (SELECT id FROM leads WHERE external_reference = ?)').run(sha(token), ref);
  const p = db.prepare('SELECT p.* FROM pedidos_docs p JOIN leads l ON l.id = p.lead_id WHERE l.external_reference = ?').get(ref);
  db.close();
  return { token, pedido: p };
}
const pedidoDe = (ref) => { const db = abrirDb(); const p = db.prepare('SELECT p.*, l.estado AS lead_estado FROM pedidos_docs p JOIN leads l ON l.id = p.lead_id WHERE l.external_reference = ?').get(ref); db.close(); return p; };
const mailsDe = (pid) => { const db = abrirDb(); const m = db.prepare('SELECT * FROM pedidos_docs_mails WHERE pedido_id = ?').all(pid); db.close(); return m; };

test('página y catálogo: precios de las variables de entorno', async () => {
  const p = await fetch(`${BASE}/tyc-startups`);
  assert.equal(p.status, 200);
  const html = await p.text();
  assert.match(html, /Mi negocio opera en Argentina y uso ley argentina/);
  assert.match(html, /calendly\.com\/tomas-wtrabogados\/30min/);
  assert.doesNotMatch(html, /200\.000|275\.000/); // los precios no están escritos en la página
  const c = await (await fetch(`${BASE}/api/lp/docs/catalogo`)).json();
  assert.deepEqual(c.data.servicios.map(s => [s.codigo, s.precio]), [['tyc', 200000], ['privacidad', 200000], ['combo', 275000]]);
});

test('pago: sin la casilla de ley argentina o la de consentimiento no se cobra', async () => {
  for (const extra of [{ ley_argentina: false }, { ley_argentina: 'true' }, { consentimiento: false }, { nombre: '' }, { servicio: 'otro' }]) {
    const r = await json('POST', '/api/lp/docs/iniciar', { ...INICIO, ...extra });
    assert.ok(r.status >= 400, JSON.stringify(extra));
  }
  const antes = pedidosMp.length;
  const r = await json('POST', '/api/lp/docs/iniciar', { ...INICIO, servicio: 'combo' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.init_point, `https://mp.test/checkout/${antes + 1}`);
  const pref = pedidosMp[antes];
  assert.equal(pref.items[0].unit_price, 275000);
  assert.equal(pref.notification_url, 'https://publico.test/api/pagos/webhook');
  assert.equal(pedidoDe(pref.external_reference).estado, 'pendiente_pago');
});

test('webhook: avisos repetidos y simultáneos activan el pedido y mandan un solo mail', async () => {
  const { id, ref } = await comprar();
  await Promise.all([
    json('POST', '/api/pagos/webhook', { type: 'payment', data: { id } }),
    fetch(`${BASE}/api/pagos/webhook?topic=payment&id=${id}`),
    json('POST', '/api/pagos/webhook', { type: 'payment', data: { id } }),
  ]);
  await espera(400);
  await json('POST', '/api/pagos/webhook', { type: 'payment', data: { id } });
  await espera(300);
  const p = pedidoDe(ref);
  assert.equal(p.estado, 'pagado');
  assert.equal(p.lead_estado, 'pagado');
  assert.match(p.numero, /^LP-TP-\d{4}-\d{3}$/);
  const m = mailsDe(p.id);
  assert.equal(m.filter(x => x.tipo === 'confirmacion').length, 1);
  assert.equal(m.filter(x => x.tipo === 'aviso_pago').length, 1);
});

test('webhook: si el monto no coincide no se habilita el formulario', async () => {
  const { id, ref } = await comprar({}, 100);
  await json('POST', '/api/pagos/webhook', { type: 'payment', data: { id } });
  await espera(300);
  const p = pedidoDe(ref);
  assert.equal(p.estado, 'pendiente_pago');
  assert.equal(p.token_hash, null);
});

test('simulador de pagos: no existe con credenciales reales de MP', async () => {
  const r = await fetch(`${BASE}/pagos/stub/confirmar`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'ref=x&estado=approved' });
  assert.equal(r.status, 404);
  assert.equal((await fetch(`${BASE}/pagos/stub?ref=x`)).status, 404);
});

test('formulario: el link único es la única llave', async () => {
  const { id, ref } = await comprar();
  await json('POST', '/api/pagos/webhook', { type: 'payment', data: { id } });
  await espera(300);
  const { token } = ponerToken(ref);
  for (const t of [undefined, '', 'x'.repeat(43), token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')]) {
    const r = await fetch(`${BASE}/api/lp/docs/formulario`, { headers: t === undefined ? {} : conToken(t) });
    assert.equal(r.status, 404);
  }
  // El token en la URL no sirve (va en la cabecera).
  assert.equal((await fetch(`${BASE}/api/lp/docs/formulario?t=${token}`)).status, 404);
  const r = await fetch(`${BASE}/api/lp/docs/formulario`, { headers: conToken(token) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const v = (await r.json()).data;
  assert.equal(v.estado, 'abierto');
  assert.equal(v.alcance.length, 7);
  assert.ok(!v.secciones.flatMap(s => s.preguntas).some(p => p.id === 'F17'));
  // La página del formulario no deja Referer.
  const pg = await fetch(`${BASE}/tyc-startups/formulario`);
  assert.equal(pg.headers.get('referrer-policy'), 'no-referrer');
});

test('formulario: guarda, sube archivos y se envía; con el token de otro pedido no se toca nada', async () => {
  const a = await comprar(); const b = await comprar({ email: 'otro@ejemplo.test' });
  for (const x of [a, b]) await json('POST', '/api/pagos/webhook', { type: 'payment', data: { id: x.id } });
  await espera(400);
  const ta = ponerToken(a.ref); const tb = ponerToken(b.ref);
  const subir = (t, nombre, mime, buf) => json('POST', '/api/lp/docs/formulario/archivos', { nombre, archivo: dataUrl(mime, buf) }, conToken(t));

  // Sin la casilla no se sube.
  assert.equal((await subir(ta.token, 'a.pdf', 'application/pdf', PDF)).status, 400);
  assert.equal((await json('PUT', '/api/lp/docs/formulario', { consentimiento_ia: true, respuestas: { F1: 'Ana SRL' } }, conToken(ta.token))).status, 200);
  const r1 = await subir(ta.token, 'terminos.pdf', 'application/pdf', PDF);
  assert.equal(r1.status, 200);
  const arch = (await r1.json()).data.archivo;
  assert.equal((await subir(ta.token, 'dossier.docx', 'application/octet-stream', fixtures.docx())).status, 200);
  assert.equal((await subir(ta.token, 'x.pdf', 'application/pdf', Buffer.from('<html><script>1</script>'))).status, 400);
  assert.equal((await subir(ta.token, 'x.docx', 'application/octet-stream', fixtures.docm())).status, 400);
  // Un archivo de más de 20 MB corta antes (413), sin colgar el servidor.
  const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(21 * 1024 * 1024)]);
  assert.equal((await subir(ta.token, 'g.pdf', 'application/pdf', grande)).status, 413);
  // Sin token válido no se lee el cuerpo.
  assert.equal((await subir('y'.repeat(43), 'a.pdf', 'application/pdf', PDF)).status, 404);

  // IDOR: con el token de B no se borra el archivo de A.
  const del = await fetch(`${BASE}/api/lp/docs/formulario/archivos/${arch.id}`, { method: 'DELETE', headers: conToken(tb.token) });
  assert.equal(del.status, 404);
  const va = (await (await fetch(`${BASE}/api/lp/docs/formulario`, { headers: conToken(ta.token) })).json()).data;
  assert.equal(va.archivos.length, 2);
  assert.equal(va.datos.respuestas.F1, 'Ana SRL');
  const vb = (await (await fetch(`${BASE}/api/lp/docs/formulario`, { headers: conToken(tb.token) })).json()).data;
  assert.equal(vb.archivos.length, 0);
  assert.equal(vb.datos, null);

  // Enviar: faltan C1 a C7.
  let r = await json('PUT', '/api/lp/docs/formulario', { consentimiento_ia: true, enviar: true }, conToken(ta.token));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).faltan.length, 7);
  const alcance = Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(c => [c, { valor: c === 'C5' ? 'si' : 'no', como: 'Desde 16' }]));
  r = await json('PUT', '/api/lp/docs/formulario', { alcance, respuestas: { F1: 'Ana SRL' }, consentimiento_ia: true, enviar: true }, conToken(ta.token));
  assert.equal(r.status, 200);
  assert.equal(pedidoDe(a.ref).estado, 'formulario_completo');
  assert.ok(mailsDe(ta.pedido.id).some(m => m.tipo === 'aviso_formulario'));
  // Ya enviado: no se edita ni se sube.
  assert.equal((await json('PUT', '/api/lp/docs/formulario', { redes: 'x' }, conToken(ta.token))).status, 409);
  assert.equal((await subir(ta.token, 'b.pdf', 'application/pdf', PDF)).status, 409);
  const cerrado = (await (await fetch(`${BASE}/api/lp/docs/formulario`, { headers: conToken(ta.token) })).json()).data;
  assert.equal(cerrado.estado, 'enviado');
});

test('panel: solo con sesión de admin; archivos servidos con su tipo real y del pedido correcto', async () => {
  assert.equal((await fetch(`${BASE}/api/admin/pedidos-docs`)).status, 401);
  assert.equal((await json('POST', '/api/admin/pedidos-docs/1/borrador', { links: {} })).status, 401);
  // Sin sesión, el envío de la versión final no lee el cuerpo grande.
  assert.equal((await json('POST', '/api/admin/pedidos-docs/1/version-final', { adjuntos: [] })).status, 401);
  const h = { cookie };
  const lista = (await (await fetch(`${BASE}/api/admin/pedidos-docs`, { headers: h })).json()).data.pedidos;
  const completo = lista.find(p => p.estado === 'formulario_completo');
  assert.ok(completo);
  assert.ok(!lista.some(p => p.estado === 'pendiente_pago'));
  const d = (await (await fetch(`${BASE}/api/admin/pedidos-docs/${completo.id}`, { headers: h })).json()).data;
  assert.equal(d.respuestas.find(q => q.id === 'C5').como, 'Desde 16');
  const pdf = d.archivos.find(x => x.tipo === 'pdf'); const word = d.archivos.find(x => x.tipo === 'docx');
  const g = await fetch(`${BASE}/api/admin/pedidos-docs/${completo.id}/archivos/${pdf.id}`, { headers: h });
  assert.equal(g.headers.get('content-type'), 'application/pdf');
  assert.equal(g.headers.get('x-content-type-options'), 'nosniff');
  const w = await fetch(`${BASE}/api/admin/pedidos-docs/${completo.id}/archivos/${word.id}`, { headers: h });
  assert.match(w.headers.get('content-disposition'), /^attachment/);
  // El archivo de un pedido no se baja por la ruta de otro.
  const otro = lista.find(p => p.id !== completo.id);
  assert.equal((await fetch(`${BASE}/api/admin/pedidos-docs/${otro.id}/archivos/${pdf.id}`, { headers: h })).status, 404);

  // Borrador: link inválido no; válido sí, con vista previa antes.
  const url = `/api/admin/pedidos-docs/${completo.id}/borrador`;
  assert.equal((await json('POST', url, { links: { terminos: 'javascript:alert(1)' } }, h)).status, 400);
  const prev = await (await json('POST', url, { links: { terminos: 'https://docs.google.com/document/d/abc/edit' }, previsualizar: true }, h)).json();
  assert.match(prev.data.preview.html, /Ver el borrador/);
  assert.equal((await json('POST', url, { links: { terminos: 'https://docs.google.com/document/d/abc/edit' } }, h)).status, 200);

  // Versión final: con un PDF; después el link del cliente deja de servir.
  const fin = `/api/admin/pedidos-docs/${completo.id}/version-final`;
  assert.equal((await json('POST', fin, { adjuntos: [{ nombre: 'x.pdf', archivo: dataUrl('application/pdf', Buffer.from('<html>')) }] }, h)).status, 400);
  assert.equal((await json('POST', fin, { adjuntos: [{ nombre: 'TyC.pdf', archivo: dataUrl('application/pdf', PDF) }, { nombre: 'TyC.docx', archivo: dataUrl('application/octet-stream', fixtures.docx()) }] }, h)).status, 200);
  const db = abrirDb();
  const p = db.prepare('SELECT * FROM pedidos_docs WHERE id = ?').get(completo.id);
  db.close();
  assert.equal(p.estado, 'version_final_enviada');
  assert.equal(p.token_hash, null);
});

test('resultado del pago: página de Legal Pacer para estos pedidos, sin el link al formulario', async () => {
  const ref = pedidosMp[pedidosMp.length - 1].external_reference;
  const r = await fetch(`${BASE}/pagos/exito?ref=${ref}`);
  const html = await r.text();
  assert.match(html, /Recibimos tu pago/);
  assert.doesNotMatch(html, /#t=|formulario#/);
});
