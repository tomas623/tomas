// Pruebas en proceso de los pedidos de términos y condiciones / privacidad:
// idempotencia del pago, formulario, archivos, panel y borrado a 90 días.
// Base SQLite temporal (SQLITE_PATH se fija antes de cargar src/db.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-docs-'));
process.env.SQLITE_PATH = path.join(TMP, 'test.db');
process.env.BASE_URL = 'https://ejemplo.test';
process.env.RESEND_API_KEY = '';
process.env.WHATSAPP_NOTIFY = '';

const db = require('../src/db');
const pedidos = require('../src/docs-pedidos');
const formulario = require('../src/docs-formulario');
const mails = require('../src/docs-mails');

const enviados = [];
pedidos.setEnviador(async (m) => { enviados.push(m); return { ok: true, id: `m${enviados.length}` }; });

const PDF = Buffer.from('%PDF-1.4\n%fin\n');
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
let n = 0;
function nuevoLead(tipo = 'tyc', servicio = 'tyc') {
  n++;
  const info = db.prepare("INSERT INTO leads (tipo, marca, email, monto, external_reference) VALUES (?, 'Proyecto', ?, 200000, ?)")
    .run(tipo, `cliente${n}@ejemplo.test`, `${tipo}-${String(n).padStart(16, '0')}`);
  pedidos.crearPedidoPendiente({ leadId: info.lastInsertRowid, servicio, nombre: 'Ana' });
  return info.lastInsertRowid;
}
// El token en claro solo sale en el mail: lo sacamos del link del último.
function tokenDelMail(m) { return /#t=([A-Za-z0-9_-]{43})/.exec(m.html)[1]; }

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('pago: dos avisos al mismo tiempo activan el pedido una sola vez', async () => {
  const leadId = nuevoLead();
  const antes = enviados.length;
  const [a, b] = await Promise.all([pedidos.activarPorPago(leadId), pedidos.activarPorPago(leadId)]);
  assert.equal([a.activado, b.activado].filter(Boolean).length, 1);
  const p = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(leadId);
  assert.equal(p.estado, 'pagado');
  assert.match(p.numero, /^LP-TP-\d{4}-001$/);
  assert.ok(p.token_hash && p.token_hash.length === 64);
  const nuevos = enviados.slice(antes);
  assert.equal(nuevos.filter(m => m.tag === 'docs_confirmacion').length, 1);
  assert.equal(nuevos.filter(m => m.tag === 'docs_pago_admin').length, 1);
  // El mail al cliente lleva el link con el token y el hash coincide.
  const conf = nuevos.find(m => m.tag === 'docs_confirmacion');
  assert.equal(pedidos.sha256(tokenDelMail(conf)), p.token_hash);
  assert.equal(conf.from, 'Legal Pacer <contacto@legalpacer.com>');
  // Un tercer aviso tampoco hace nada.
  assert.equal((await pedidos.activarPorPago(leadId)).activado, false);
});

test('pago: los números de pedido son correlativos', async () => {
  const leadId = nuevoLead('privacidad', 'privacidad');
  await pedidos.activarPorPago(leadId);
  assert.match(db.prepare('SELECT numero FROM pedidos_docs WHERE lead_id = ?').get(leadId).numero, /-002$/);
});

test('pago: un lead que no es de documentos no crea pedido', async () => {
  const info = db.prepare("INSERT INTO leads (tipo, marca, email, external_reference) VALUES ('registro', 'X', 'x@y.z', 'registro-x')").run();
  assert.equal((await pedidos.activarPorPago(info.lastInsertRowid)).activado, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pedidos_docs WHERE lead_id = ?').get(info.lastInsertRowid).n, 0);
});

test('token: formato y valor', () => {
  assert.equal(pedidos.pedidoPorToken(''), null);
  assert.equal(pedidos.pedidoPorToken('a'.repeat(43)), null);
  assert.equal(pedidos.pedidoPorToken("' OR 1=1 --"), null);
  assert.equal(pedidos.pedidoPorToken(null), null);
});

test('formulario: guarda a medias, descarta claves desconocidas y pide C1 a C7 y la casilla para enviar', async () => {
  const leadId = nuevoLead();
  const antes = enviados.length;
  await pedidos.activarPorPago(leadId);
  const token = tokenDelMail(enviados.slice(antes).find(m => m.tag === 'docs_confirmacion'));
  let p = pedidos.pedidoPorToken(token);
  assert.ok(p);
  let r = await pedidos.guardarRespuestas(p, {
    alcance: { C1: { valor: 'si', como: 'Después' }, C2: { valor: 'quizas' }, __proto__: { valor: 'si' } },
    respuestas: { F1: 'Ana SRL, 30-1', F17: 'no debería quedar (solo PP)', F21: 'tampoco sin vender productos', X9: 'basura' },
    redes: 'instagram.com/ana', _ruta: '/etc/passwd',
  });
  assert.equal(r.ok, true);
  p = pedidos.obtener(p.id);
  const d = JSON.parse(p.respuestas);
  assert.equal(d.alcance.C1.valor, 'si');
  assert.equal(d.alcance.C2.valor, '');
  assert.deepEqual(Object.keys(d.respuestas), ['F1']);
  assert.equal(d.redes, 'instagram.com/ana');
  assert.equal(p.estado, 'pagado');

  r = await pedidos.guardarRespuestas(p, { alcance: { C1: { valor: 'no' } }, enviar: true });
  assert.equal(r.ok, false);
  assert.ok(r.faltan.includes('C7') && r.faltan.includes('consentimiento'));

  const todas = Object.fromEntries(formulario.ALCANCE.map(c => [c.id, { valor: 'no' }]));
  r = await pedidos.guardarRespuestas(pedidos.obtener(p.id), { alcance: todas, vende_productos: true, respuestas: { F21: 'Nuevos' }, consentimiento_ia: true, enviar: true });
  assert.equal(r.ok, true);
  assert.equal(r.enviado, true);
  p = pedidos.obtener(p.id);
  assert.equal(p.estado, 'formulario_completo');
  assert.ok(p.consentimiento_ia_at);
  assert.equal(JSON.parse(p.respuestas).respuestas.F21, 'Nuevos');
  assert.ok(enviados.some(m => m.tag === 'docs_formulario_admin'));
  // Ya enviado: no se puede volver a editar ni subir.
  assert.equal((await pedidos.guardarRespuestas(p, { redes: 'x' })).status, 409);
  assert.equal(pedidos.agregarArchivo(p, { nombre: 'a.pdf', archivo: dataUrl('application/pdf', PDF) }).status, 409);
});

test('archivos: casilla antes, tope de 20 MB, y nadie toca los de otro pedido', async () => {
  const idA = nuevoLead(); const idB = nuevoLead();
  await pedidos.activarPorPago(idA); await pedidos.activarPorPago(idB);
  let a = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(idA);
  const b = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(idB);
  assert.equal(pedidos.agregarArchivo(a, { nombre: 'x.pdf', archivo: dataUrl('application/pdf', PDF) }).ok, false);
  await pedidos.guardarRespuestas(a, { consentimiento_ia: true });
  a = pedidos.obtener(a.id);
  const r = pedidos.agregarArchivo(a, { nombre: '../../etc/<b>terminos</b>.pdf', archivo: dataUrl('application/pdf', PDF) });
  assert.equal(r.ok, true);
  assert.equal(r.archivo.nombre.includes('/'), false);
  assert.equal(r.archivo.nombre.includes('<'), false);
  const ruta = db.prepare('SELECT ruta FROM pedidos_docs_archivos WHERE id = ?').get(r.archivo.id).ruta;
  assert.ok(fs.existsSync(ruta));
  assert.ok(ruta.startsWith(path.join(TMP, 'pedidos-docs', String(a.id))));
  // HTML disfrazado de PDF
  assert.equal(pedidos.agregarArchivo(a, { nombre: 'x.pdf', archivo: dataUrl('application/pdf', Buffer.from('<script>alert(1)</script>')) }).ok, false);
  // IDOR: con el pedido B no se borra el archivo de A.
  assert.equal(pedidos.borrarArchivo(b, r.archivo.id).status, 404);
  assert.ok(fs.existsSync(ruta));
  // Tope total de 20 MB.
  const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(pedidos.MAX_BYTES_CLIENTE)]);
  assert.equal(pedidos.agregarArchivo(a, { nombre: 'g.pdf', archivo: dataUrl('application/pdf', grande) }).status, 413);
  assert.equal(pedidos.borrarArchivo(a, r.archivo.id).ok, true);
  assert.equal(fs.existsSync(ruta), false);
});

test('panel: transiciones, borrador con link de Drive y versión final', async () => {
  const leadId = nuevoLead('tyc_privacidad', 'combo');
  await pedidos.activarPorPago(leadId);
  let p = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(leadId);
  const todas = Object.fromEntries(formulario.ALCANCE.map(c => [c.id, { valor: 'no' }]));
  await pedidos.guardarRespuestas(p, { alcance: todas, consentimiento_ia: true, enviar: true });
  assert.equal(pedidos.cambiarEstado(p.id, 'cerrado').status, 409);
  assert.equal(pedidos.cambiarEstado(p.id, 'borrador_revision').ok, true);

  for (const malo of ['javascript:alert(1)', 'http://docs.google.com/x', 'https://docs.google.com.evil.test/x', 'https://evil.test/?docs.google.com', 'https://user:pw@docs.google.com/x']) {
    const r = await pedidos.enviarBorrador(p.id, { links: { terminos: malo, privacidad: malo } });
    assert.equal(r.status, 400, malo);
  }
  // Combo: hacen falta los dos links.
  assert.equal((await pedidos.enviarBorrador(p.id, { links: { terminos: 'https://docs.google.com/document/d/1' } })).status, 400);
  const links = { terminos: 'https://docs.google.com/document/d/1/edit', privacidad: 'https://docs.google.com/document/d/2/edit' };
  const prev = await pedidos.enviarBorrador(p.id, { links, previsualizar: true });
  assert.equal(prev.ok, true);
  assert.match(prev.preview.html, /Ver el borrador de los términos y condiciones/);
  assert.match(prev.preview.subject, /términos y condiciones y política de privacidad/);
  assert.equal(pedidos.obtener(p.id).estado, 'borrador_revision');
  const antes = enviados.length;
  assert.equal((await pedidos.enviarBorrador(p.id, { links })).ok, true);
  p = pedidos.obtener(p.id);
  assert.equal(p.estado, 'borrador_enviado');
  assert.match(p.ronda_vence, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(enviados.length, antes + 1);
  assert.equal(enviados[antes].replyTo, 'contacto@legalpacer.com');

  // Versión final: solo Word y PDF.
  const html = { nombre: 'x.pdf', archivo: dataUrl('application/pdf', Buffer.from('<html>')) };
  assert.equal((await pedidos.enviarVersionFinal(p.id, { adjuntos: [html] })).status, 400);
  assert.equal((await pedidos.enviarVersionFinal(p.id, { adjuntos: [] })).status, 400);
  const r = await pedidos.enviarVersionFinal(p.id, { adjuntos: [{ nombre: 'TyC final.pdf', archivo: dataUrl('application/pdf', PDF) }] });
  assert.equal(r.ok, true);
  const ultimo = enviados[enviados.length - 1];
  assert.equal(ultimo.attachments.length, 1);
  assert.equal(ultimo.attachments[0].filename, 'TyC final.pdf');
  assert.match(ultimo.html, /calendly\.com\/tomas-wtrabogados\/30min/);
  p = pedidos.obtener(p.id);
  assert.equal(p.estado, 'version_final_enviada');
  assert.equal(p.reunion_estado, 'link_enviado');
  assert.equal(p.token_hash, null);
  assert.equal(pedidos.cambiarReunion(p.id, 'agendada').ok, true);
  assert.equal(pedidos.cambiarReunion(p.id, 'cualquiera').status, 400);
  assert.equal(pedidos.cambiarEstado(p.id, 'cerrado').ok, true);
});

test('borrado a 90 días: solo los archivos de pedidos con versión final vencida', async () => {
  const idViejo = nuevoLead(); const idNuevo = nuevoLead();
  for (const id of [idViejo, idNuevo]) {
    await pedidos.activarPorPago(id);
    const p = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(id);
    await pedidos.guardarRespuestas(p, { consentimiento_ia: true });
    pedidos.agregarArchivo(pedidos.obtener(p.id), { nombre: 'a.pdf', archivo: dataUrl('application/pdf', PDF) });
  }
  const viejo = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(idViejo);
  const nuevo = db.prepare('SELECT * FROM pedidos_docs WHERE lead_id = ?').get(idNuevo);
  db.prepare("UPDATE pedidos_docs SET version_final_at = datetime('now', '-91 days') WHERE id = ?").run(viejo.id);
  db.prepare("UPDATE pedidos_docs SET version_final_at = datetime('now', '-10 days') WHERE id = ?").run(nuevo.id);
  const rutaVieja = db.prepare('SELECT ruta FROM pedidos_docs_archivos WHERE pedido_id = ?').get(viejo.id).ruta;
  const r = pedidos.limpiarArchivosVencidos();
  assert.equal(r.pedidos, 1);
  assert.equal(fs.existsSync(rutaVieja), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pedidos_docs_archivos WHERE pedido_id = ?').get(nuevo.id).n, 1);
  assert.ok(pedidos.obtener(viejo.id).archivos_borrados_at);
  assert.equal(pedidos.limpiarArchivosVencidos().pedidos, 0);
});

test('formulario: preguntas según el servicio', () => {
  const ids = (docs) => formulario.preguntasPara(docs).flatMap(s => s.preguntas.map(p => p.id));
  const tyc = ids(['terminos']); const pp = ids(['privacidad']); const combo = ids(['terminos', 'privacidad']);
  assert.ok(tyc.includes('F19') && tyc.includes('F21') && !tyc.includes('F17'));
  assert.ok(pp.includes('F17') && !pp.includes('F7') && !pp.includes('F19') && !pp.includes('F21'));
  assert.equal(combo.length, 21);
  const f18tyc = formulario.preguntasPara(['terminos']).flatMap(s => s.preguntas).find(p => p.id === 'F18');
  assert.equal(f18tyc.texto, '¿Ya tenés política de privacidad? Pasanos el enlace.');
  const f20pp = formulario.preguntasPara(['privacidad']).flatMap(s => s.preguntas).find(p => p.id === 'F20');
  assert.match(f20pp.texto, /^¿Tenés inversores/);
});

test('mails: textos aprobados, firma, WhatsApp como link y datos escapados', () => {
  const c = mails.mailConfirmacionPago({ codigo: 'privacidad', nombre: '<b>Ana</b>', numero: 'LP-TP-2026-001', linkFormulario: 'https://x.test/f#t=abc' });
  assert.equal(c.subject, 'Recibimos tu pago. Completá el formulario');
  assert.match(c.html, /Recibimos el pago de tu política de privacidad\. Tu número de pedido es LP-TP-2026-001\./);
  assert.match(c.html, /&lt;b&gt;Ana&lt;\/b&gt;/);
  assert.match(c.html, /<a href="https:\/\/wa\.me\/5491128774200"[^>]*>WhatsApp<\/a>/);
  assert.match(c.html, /Legal Pacer, un producto de WTR \| abogados/);
  assert.doesNotMatch(c.html, /calendly/);
  const b = mails.mailBorrador({ codigo: 'tyc', nombre: 'Ana', links: [{ documento: 'terminos', url: 'https://docs.google.com/d/1' }], fechaLimite: '15/11/2026' });
  assert.match(b.html, /hasta el 15\/11\/2026/);
  assert.match(b.html, /con la guía de buenas prácticas, y con eso cerramos/);
  assert.doesNotMatch(b.html, /calendly/);
  const f = mails.mailVersionFinal({ codigo: 'combo', nombre: 'Ana' });
  assert.match(f.html, /con las tres guías/);
  assert.match(f.html, /Lo que sigue es publicarlos en tu web o app\. Las guías de buenas prácticas te dicen dónde va cada uno y qué casillas activar\./);
  assert.equal((f.html.match(/<a href=/g) || []).length, 2); // WhatsApp (texto) y el único botón
});
