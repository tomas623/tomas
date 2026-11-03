// Pruebas de punta a punta contra el servidor real (server.js) con una base
// SQLite temporal: subidas del registro, archivos servidos en el admin, IP del
// cliente para el rate limiting y firma del webhook de WhatsApp.
// SERVER_DIR permite correr las mismas pruebas contra otra copia del repo
// (por ejemplo, main antes del arreglo) para ver el problema reproducido.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER_DIR = process.env.SERVER_DIR || path.join(__dirname, '..');
const Database = require(path.join(SERVER_DIR, 'node_modules', 'better-sqlite3'));
const bcrypt = require(path.join(SERVER_DIR, 'node_modules', 'bcryptjs'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-'));
const DB = path.join(TMP, 'test.db');
const PORT = 39000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_SECRET = 'secreto-de-prueba';
let srv;
let cookie = '';

const PDF = Buffer.from('%PDF-1.4\n%fin\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

async function esperarServidor() {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/registro/datos/nada`); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('el servidor no arrancó');
}

const post = (url, body, headers = {}) => fetch(BASE + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test.before(async () => {
  srv = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), SQLITE_PATH: DB, CRON_ENABLED: 'false',
      RESEND_API_KEY: '', MP_ACCESS_TOKEN: '', WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', BASE_URL: BASE },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await esperarServidor();
  const db = new Database(DB);
  db.prepare("INSERT INTO leads (tipo, marca, email, external_reference) VALUES ('registro', 'Prueba', 'a@b.c', 'REF1')").run();
  db.prepare("INSERT INTO usuarios (email, password_hash, rol) VALUES ('admin@test', ?, 'admin')").run(bcrypt.hashSync('clave123', 4));
  db.close();
  const r = await post('/api/auth/login', { email: 'admin@test', password: 'clave123' });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
});

test.after(() => { if (srv) srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

test('poder firmado: rechaza HTML disfrazado de PDF y SVG', async () => {
  for (const [mime, buf] of [['application/pdf', HTML], ['text/html', HTML], ['image/svg+xml', SVG]]) {
    const r = await post('/api/registro/poder-firmado/REF1', { archivo: dataUrl(mime, buf) });
    assert.strictEqual(r.status, 400, `${mime} debería rechazarse`);
  }
});

test('poder firmado: acepta un PDF real y el admin lo sirve como PDF', async () => {
  const r = await post('/api/registro/poder-firmado/REF1', { archivo: dataUrl('application/pdf', PDF) });
  assert.strictEqual(r.status, 200);
  const g = await fetch(`${BASE}/api/admin/leads/1/poder-firmado`, { headers: { cookie } });
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.headers.get('content-type'), 'application/pdf');
  assert.strictEqual(g.headers.get('x-content-type-options'), 'nosniff');
});

test('datos del registro: rechaza un logo SVG con un error claro', async () => {
  const r = await post('/api/registro/datos/REF1', {
    titulares: [{ tipo: 'fisica', nombre: 'X' }], logo: dataUrl('image/svg+xml', SVG),
  });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /Logo/);
});

test('datos del registro: rechaza un estatuto en HTML', async () => {
  const r = await post('/api/registro/datos/REF1', {
    titulares: [{ tipo: 'juridica', razon: 'X SA', doc_constitutiva: dataUrl('application/pdf', HTML) }],
  });
  assert.strictEqual(r.status, 400);
});

test('datos del registro: acepta PNG y PDF y el admin sirve el logo como imagen', async () => {
  const r = await post('/api/registro/datos/REF1', {
    titulares: [{ tipo: 'juridica', razon: 'X SA', doc_constitutiva: dataUrl('application/pdf', PDF) }],
    logo: dataUrl('image/png', PNG),
  });
  assert.strictEqual(r.status, 200);
  const g = await fetch(`${BASE}/api/admin/leads/1/registro-logo`, { headers: { cookie } });
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.headers.get('content-type'), 'image/png');
  const d = await fetch(`${BASE}/api/admin/leads/1/registro-doc?tit=0&tipo=const`, { headers: { cookie } });
  assert.strictEqual(d.headers.get('content-type'), 'application/pdf');
});

test('admin: un archivo viejo que no es de un tipo permitido se descarga, no se abre', async () => {
  const db = new Database(DB);
  const p = path.join(TMP, 'logo-viejo.svg');
  fs.writeFileSync(p, SVG);
  db.prepare('UPDATE leads SET registro_logo_path = ? WHERE id = 1').run(p);
  db.close();
  const g = await fetch(`${BASE}/api/admin/leads/1/registro-logo`, { headers: { cookie } });
  assert.strictEqual(g.status, 200);
  assert.notStrictEqual(g.headers.get('content-type'), 'image/svg+xml');
  assert.match(g.headers.get('content-disposition') || '', /^attachment/);
});

test('datos del registro: el cliente no puede apuntar el admin a un archivo del servidor', async () => {
  const r = await post('/api/registro/datos/REF1', {
    titulares: [{ tipo: 'fisica', nombre: 'X', _doc_constitutiva_path: path.join(SERVER_DIR, 'package.json'),
      doc_constitutiva: dataUrl('text/html', HTML) }],
  });
  assert.strictEqual(r.status, 200);
  const db = new Database(DB);
  const guardado = db.prepare('SELECT registro_datos FROM leads WHERE id = 1').get().registro_datos;
  db.close();
  assert.ok(!guardado.includes('_doc_constitutiva_path'), 'no se guarda la ruta enviada por el cliente');
  assert.ok(!guardado.includes('base64'), 'no se guarda el documento sin validar');
  const d = await fetch(`${BASE}/api/admin/leads/1/registro-doc?tit=0&tipo=const`, { headers: { cookie } });
  assert.strictEqual(d.status, 404);
});

test('admin: una ruta vieja fuera de la carpeta de subidas no se sirve', async () => {
  const db = new Database(DB);
  db.prepare('UPDATE leads SET registro_datos = ? WHERE id = 1')
    .run(JSON.stringify({ titulares: [{ tipo: 'fisica', _doc_constitutiva_path: path.join(SERVER_DIR, 'package.json') }] }));
  db.close();
  const d = await fetch(`${BASE}/api/admin/leads/1/registro-doc?tit=0&tipo=const`, { headers: { cookie } });
  assert.strictEqual(d.status, 404);
});

// Simula lo que pasa en Railway: el cliente manda un X-Forwarded-For inventado
// y el edge agrega a la derecha la IP real que se le conectó (198.51.100.7).
// En la prueba, el test se conecta directo, así que hace de edge (salto 1).
test('rate limit: inventar X-Forwarded-For no da intentos nuevos de login', async () => {
  let ultimo;
  for (let i = 0; i < 10; i++) {
    ultimo = await post('/api/auth/login', { email: 'no@existe', password: 'x' },
      { 'X-Forwarded-For': `203.0.113.${i + 1}, 198.51.100.7` });
  }
  assert.strictEqual(ultimo.status, 429, 'el límite de 8 intentos tiene que aplicar igual');
});

test('rate limit: con un salto interno de Railway (IP privada) sigue tomando la IP real', async () => {
  let ultimo;
  for (let i = 0; i < 10; i++) {
    ultimo = await post('/api/auth/forgot-password', { email: 'no@existe' },
      { 'X-Forwarded-For': `203.0.113.${i + 1}, 198.51.100.8, 10.1.2.3` });
  }
  assert.strictEqual(ultimo.status, 429, 'el límite de 6 por hora tiene que aplicar igual');
  // Otro cliente real (otra IP agregada por el edge) no queda bloqueado.
  const otro = await post('/api/auth/forgot-password', { email: 'no@existe' },
    { 'X-Forwarded-For': '198.51.100.9, 10.1.2.3' });
  assert.notStrictEqual(otro.status, 429);
});

test('webhook de WhatsApp: una firma correcta se acepta y una incorrecta no', async () => {
  const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const firma = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(cuerpo).digest('hex');
  const bien = await post('/api/whatsapp/webhook', cuerpo, { 'X-Hub-Signature-256': firma });
  assert.strictEqual(bien.status, 200, 'firma válida rechazada (rawBody perdido)');
  const mal = await post('/api/whatsapp/webhook', cuerpo, { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) });
  assert.strictEqual(mal.status, 403);
});

test('PATCH de informe admin: acepta un cuerpo de más de 256 KB (límite propio de 2 MB)', async () => {
  const r = await fetch(`${BASE}/api/admin/informes/999`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ notas_revision: 'x'.repeat(400 * 1024) }),
  });
  assert.strictEqual(r.status, 404, `esperaba 404 (informe inexistente), no ${r.status}`);
});
