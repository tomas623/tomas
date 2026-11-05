// Pruebas unitarias del control de tipos de archivo (src/subidas.js).
const test = require('node:test');
const assert = require('node:assert');
const { detectarTipo, decodificarDataUrl, PERMITIDOS_DOC, PERMITIDOS_LOGO } = require('../src/subidas');

const PDF = Buffer.from('%PDF-1.4\n%fin\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

test('detecta los tipos permitidos por magic bytes', () => {
  assert.strictEqual(detectarTipo(PDF), 'pdf');
  assert.strictEqual(detectarTipo(PNG), 'png');
  assert.strictEqual(detectarTipo(JPG), 'jpg');
  assert.strictEqual(detectarTipo(WEBP), 'webp');
  assert.strictEqual(detectarTipo(HTML), null);
  assert.strictEqual(detectarTipo(SVG), null);
  assert.strictEqual(detectarTipo(Buffer.alloc(0)), null);
});

test('acepta PDF e imágenes para documentos, sin importar el mime declarado', () => {
  for (const [buf, ext] of [[PDF, 'pdf'], [PNG, 'png'], [JPG, 'jpg'], [WEBP, 'webp']]) {
    const r = decodificarDataUrl(dataUrl('application/octet-stream', buf), PERMITIDOS_DOC);
    assert.ok(r.ok, ext);
    assert.strictEqual(r.ext, ext);
  }
  // mime vacío (algunos navegadores lo mandan así)
  assert.ok(decodificarDataUrl(`data:;base64,${PDF.toString('base64')}`, PERMITIDOS_DOC).ok);
});

test('rechaza HTML y SVG aunque declaren un mime de imagen o PDF', () => {
  for (const mime of ['image/png', 'application/pdf', 'image/svg+xml', 'text/html']) {
    assert.strictEqual(decodificarDataUrl(dataUrl(mime, HTML), PERMITIDOS_DOC).ok, false, mime);
    assert.strictEqual(decodificarDataUrl(dataUrl(mime, SVG), PERMITIDOS_LOGO).ok, false, mime);
  }
});

test('el logo no acepta PDF', () => {
  const r = decodificarDataUrl(dataUrl('image/png', PDF), PERMITIDOS_LOGO);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /PNG, JPG o WEBP/);
});

test('acepta un PDF con bytes antes de la cabecera (algunos escáneres)', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0x0a]), PDF]);
  assert.strictEqual(detectarTipo(buf), 'pdf');
});

test('rechaza data URL mal formado', () => {
  assert.strictEqual(decodificarDataUrl('data:image/png,abc', PERMITIDOS_DOC).ok, false);
  assert.strictEqual(decodificarDataUrl('hola', PERMITIDOS_DOC).ok, false);
  assert.strictEqual(decodificarDataUrl(undefined, PERMITIDOS_DOC).ok, false);
});

// ===== Word (.docx), para el formulario de términos y condiciones / privacidad =====
const { PERMITIDOS_DOCS_SERVICIO, PERMITIDOS_ENTREGA, detectarTipoArchivo } = require('../src/subidas');
const fixtures = require('./helpers/zip');

test('docx: acepta un Word real y rechaza un .docm con macros, un Excel y un ZIP cualquiera', () => {
  assert.strictEqual(detectarTipo(fixtures.docx()), 'docx');
  assert.strictEqual(detectarTipo(fixtures.docm()), null);
  assert.strictEqual(detectarTipo(fixtures.xlsx()), null);
  assert.strictEqual(detectarTipo(fixtures.zip({ 'a.txt': 'hola' })), null);
  const r = decodificarDataUrl(dataUrl('application/msword', fixtures.docx()), PERMITIDOS_DOCS_SERVICIO);
  assert.ok(r.ok);
  assert.strictEqual(r.ext, 'docx');
  assert.strictEqual(decodificarDataUrl(dataUrl('application/zip', fixtures.docm()), PERMITIDOS_DOCS_SERVICIO).ok, false);
});

test('docx: no se acepta donde no corresponde (registro de marca) y la entrega solo lleva Word y PDF', () => {
  assert.strictEqual(decodificarDataUrl(dataUrl('application/pdf', fixtures.docx()), PERMITIDOS_DOC).ok, false);
  assert.strictEqual(decodificarDataUrl(dataUrl('image/png', PNG), PERMITIDOS_ENTREGA).ok, false);
  assert.ok(decodificarDataUrl(dataUrl('application/pdf', PDF), PERMITIDOS_ENTREGA).ok);
});

test('docx: el tipo de un archivo en disco se lee entero si es ZIP', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-zip-'));
  const p1 = path.join(dir, 'a.bin'); fs.writeFileSync(p1, fixtures.docx());
  const p2 = path.join(dir, 'b.bin'); fs.writeFileSync(p2, fixtures.docm());
  assert.strictEqual(detectarTipoArchivo(p1), 'docx');
  assert.strictEqual(detectarTipoArchivo(p2), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
