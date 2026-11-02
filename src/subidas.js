// Archivos que suben los clientes (formulario de datos del registro y poder
// firmado). Llegan como data URL en base64 dentro de un JSON.
//
// Seguridad: el MIME del data URL lo elige el cliente. Si se usara tal cual para
// la extensión, un "data:text/html;base64,..." quedaría guardado como .html y el
// panel admin lo serviría en su mismo origen (XSS guardado contra el admin). Por
// eso solo se aceptan los tipos de abajo, la extensión sale de esta tabla (nunca
// del cliente) y el contenido tiene que empezar como corresponde a ese tipo.
// Además, el admin los descarga como adjunto y con CSP sandbox (enviarAdjunto).

const path = require('path');
const db = require('./db');

// Carpeta donde se guardan los archivos del registro (junto a la base).
const DIR_REGISTROS = path.resolve(path.dirname(db.name || (process.env.SQLITE_PATH || './data/legalpacers.db')), 'registros');

const TIPOS = {
  'application/pdf': { ext: 'pdf', firma: (b) => b.subarray(0, 1024).includes('%PDF-') },
  'image/png': { ext: 'png', firma: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', firma: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', firma: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  // Solo para el logo. Un SVG puede traer scripts: se guarda igual porque el
  // admin nunca lo abre en el navegador sin sandbox (ver enviarAdjunto).
  'image/svg+xml': { ext: 'svg', firma: (b) => /<svg[\s>]/i.test(b.subarray(0, 64 * 1024).toString('utf8')) },
};

const DOCUMENTOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const LOGO = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// Devuelve { ext, buf } si el data URL es de un tipo permitido y su contenido
// coincide con ese tipo, o { error } con un texto para mostrarle al cliente.
function leerDataUrl(dataUrl, permitidos) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return { error: 'Falta el archivo.' };
  const m = dataUrl.match(/^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!m) return { error: 'Archivo inválido.' };
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const tipo = permitidos.includes(mime) ? TIPOS[mime] : null;
  if (!tipo) return { error: `Formato no aceptado. Subilo en ${nombresFormatos(permitidos)}.` };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || !tipo.firma(buf)) return { error: `El archivo no parece un ${tipo.ext.toUpperCase()} válido.` };
  return { ext: tipo.ext, buf };
}

function nombresFormatos(permitidos) {
  const n = permitidos.map(t => TIPOS[t].ext.toUpperCase());
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} o ${n[n.length - 1]}` : n[0];
}

// Sirve un archivo subido por un cliente al panel admin sin que el navegador lo
// interprete en el origen del panel: siempre como descarga, sin sniffing y, si
// igual se abre, en un sandbox sin scripts ni acceso al origen.
function enviarAdjunto(res, ruta, nombre) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
  });
  return res.download(path.resolve(ruta), nombre || path.basename(ruta));
}

module.exports = { leerDataUrl, enviarAdjunto, DOCUMENTOS, LOGO, DIR_REGISTROS };
