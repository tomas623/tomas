// Punta a punta contra server.js con una base temporal:
//   - el simulador de pagos (/pagos/stub) no existe cuando hay MP_ACCESS_TOKEN
//     y sigue andando sin token (desarrollo);
//   - un aviso repetido de Mercado Pago de un pago ya acreditado no cambia el
//     estado 'pagado' ni repite mails ni el informe;
//   - "Confirmar pago" del panel (con sesión de admin) marca pagado y genera el
//     borrador del informe.
// Con token se usa un Mercado Pago falso local (MP_API_URL solo vale con
// NODE_ENV=test, ver src/pagos.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-pagos-'));
const BASE_PORT = 41000 + Math.floor(Math.random() * 1000);
const espera = ms => new Promise(r => setTimeout(r, ms));

// Mercado Pago falso: devuelve los pagos que cargue la prueba.
const pagos = {};
let mp;
const MP_PORT = BASE_PORT + 2000;
function arrancarMp() {
  mp = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const m = /^\/v1\/payments\/(\w+)$/.exec(req.url);
    if (m && pagos[m[1]]) return res.end(JSON.stringify(pagos[m[1]]));
    res.statusCode = 404; res.end('{}');
  });
  return new Promise(r => mp.listen(MP_PORT, '127.0.0.1', r));
}

// Levanta una instancia del servidor con su propia base.
async function arrancar(nombre, port, envExtra) {
  const db = path.join(TMP, `${nombre}.db`);
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SQLITE_PATH: db, CRON_ENABLED: 'false', BASE_URL: base,
      RESEND_API_KEY: '', GEMINI_API_KEY: '', WHATSAPP_NOTIFY: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '',
      ...envExtra },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${base}/api/health`); break; } catch { await espera(100); }
    if (i === 99) throw new Error(`el servidor ${nombre} no arrancó`);
  }
  return { proc, db, base, abrir: () => new Database(db) };
}

let conToken; let sinToken; let cookie = '';

test.before(async () => {
  await arrancarMp();
  conToken = await arrancar('con-token', BASE_PORT, {
    NODE_ENV: 'test', MP_ACCESS_TOKEN: 'TEST-token', MP_API_URL: `http://127.0.0.1:${MP_PORT}`,
  });
  sinToken = await arrancar('sin-token', BASE_PORT + 1, { NODE_ENV: 'development', MP_ACCESS_TOKEN: '' });

  const d = conToken.abrir();
  const ins = d.prepare("INSERT INTO leads (tipo, marca, email, clases, monto, external_reference) VALUES (?, ?, 'a@b.test', '[35]', 1000, ?)");
  ins.run('registro', 'Stub Prod', 'REF-STUB-PROD');
  ins.run('registro', 'Doble Aviso', 'REF-DOBLE-REG');
  ins.run('informe', 'Doble Informe', 'REF-DOBLE-INF');
  ins.run('informe', 'Transferencia', 'REF-TRANSF');
  d.prepare("INSERT INTO usuarios (email, password_hash, rol) VALUES ('admin@test', ?, 'admin')").run(bcrypt.hashSync('clave123', 4));
  d.close();
  const s = sinToken.abrir();
  s.prepare("INSERT INTO leads (tipo, marca, email, external_reference) VALUES ('registro', 'Stub Dev', 'a@b.test', 'REF-STUB-DEV')").run();
  s.close();

  const r = await fetch(`${conToken.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test', password: 'clave123' }),
  });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'login de admin');
});

test.after(() => {
  for (const s of [conToken, sinToken]) if (s) s.proc.kill();
  if (mp) mp.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const leadDe = (srv, ref) => { const d = srv.abrir(); const l = d.prepare('SELECT * FROM leads WHERE external_reference = ?').get(ref); d.close(); return l; };
const contar = (srv, sql, ...args) => { const d = srv.abrir(); const n = d.prepare(sql).get(...args).n; d.close(); return n; };
const confirmarStub = (srv, ref) => fetch(`${srv.base}/pagos/stub/confirmar`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `ref=${encodeURIComponent(ref)}&estado=approved`,
});
const webhook = (srv, id) => fetch(`${srv.base}/api/pagos/webhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'payment', data: { id } }),
});

test('simulador de pagos: con MP_ACCESS_TOKEN responde 404 y no marca nada', async () => {
  const r = await confirmarStub(conToken, 'REF-STUB-PROD');
  assert.equal(r.status, 404);
  assert.equal((await fetch(`${conToken.base}/pagos/stub?ref=REF-STUB-PROD`)).status, 404);
  const lead = leadDe(conToken, 'REF-STUB-PROD');
  assert.equal(lead.estado, 'pendiente');
  assert.equal(lead.payment_ref, null);
});

test('simulador de pagos: sin token (desarrollo) sigue andando', async () => {
  assert.equal((await fetch(`${sinToken.base}/pagos/stub?ref=REF-STUB-DEV&monto=10`)).status, 200);
  const r = await confirmarStub(sinToken, 'REF-STUB-DEV');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/pagos\/exito\?ref=REF-STUB-DEV$/);
  const lead = leadDe(sinToken, 'REF-STUB-DEV');
  assert.equal(lead.estado, 'pagado');
  assert.match(lead.payment_ref, /^STUB-PAY-\d+$/);
});

test('webhook: avisos repetidos de un pago acreditado no cambian "pagado" ni repiten los efectos', async () => {
  pagos['7001'] = { id: '7001', status: 'approved', external_reference: 'REF-DOBLE-REG', transaction_amount: 1000, currency_id: 'ARS' };
  // Webhook e IPN casi a la vez, y después reintentos sueltos.
  await Promise.all([webhook(conToken, '7001'), fetch(`${conToken.base}/api/pagos/webhook?topic=payment&id=7001`)]);
  for (let i = 0; i < 3; i++) { await espera(150); await webhook(conToken, '7001'); }
  await espera(300);
  const lead = leadDe(conToken, 'REF-DOBLE-REG');
  assert.equal(lead.estado, 'pagado');
  assert.equal(lead.payment_ref, '7001');
  // Cada vez que se disparan los mails (admin y acuse de registro) queda un
  // 'webhook.pago_aprobado' en el historial: tiene que haber uno solo.
  assert.equal(contar(conToken, "SELECT COUNT(*) AS n FROM audit_log WHERE accion = 'webhook.pago_aprobado' AND entidad_id = ?", lead.id), 1);
});

test('webhook: un informe pagado con avisos repetidos genera un solo borrador', async () => {
  pagos['7002'] = { id: '7002', status: 'approved', external_reference: 'REF-DOBLE-INF', transaction_amount: 1000, currency_id: 'ARS' };
  for (let i = 0; i < 3; i++) { await webhook(conToken, '7002'); await espera(200); }
  await espera(500);
  const lead = leadDe(conToken, 'REF-DOBLE-INF');
  assert.equal(lead.estado, 'pagado');
  assert.equal(contar(conToken, "SELECT COUNT(*) AS n FROM audit_log WHERE accion = 'webhook.pago_aprobado' AND entidad_id = ?", lead.id), 1);
  assert.equal(contar(conToken, 'SELECT COUNT(*) AS n FROM informes WHERE lead_id = ?', lead.id), 1);
});

test('panel: "Confirmar pago" a mano marca pagado y genera el borrador del informe', async () => {
  const lead = leadDe(conToken, 'REF-TRANSF');
  const sinSesion = await fetch(`${conToken.base}/api/admin/leads/${lead.id}/confirmar-pago`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.ok([401, 403].includes(sinSesion.status), `sin sesión: ${sinSesion.status}`);
  assert.equal(leadDe(conToken, 'REF-TRANSF').estado, 'pendiente');

  const r = await fetch(`${conToken.base}/api/admin/leads/${lead.id}/confirmar-pago`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}',
  });
  assert.equal(r.status, 200);
  const despues = leadDe(conToken, 'REF-TRANSF');
  assert.equal(despues.estado, 'pagado');
  assert.ok(despues.pagado_at);
  assert.equal(contar(conToken, 'SELECT COUNT(*) AS n FROM informes WHERE lead_id = ?', lead.id), 1);
  assert.equal(contar(conToken, "SELECT COUNT(*) AS n FROM audit_log WHERE accion = 'lead.pago_confirmado_manual' AND entidad_id = ?", lead.id), 1);

  // Confirmar dos veces no duplica el borrador.
  const otra = await fetch(`${conToken.base}/api/admin/leads/${lead.id}/confirmar-pago`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}',
  });
  assert.equal(otra.status, 200);
  assert.equal(contar(conToken, 'SELECT COUNT(*) AS n FROM informes WHERE lead_id = ?', lead.id), 1);
});
