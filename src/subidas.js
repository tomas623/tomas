// Archivos que suben los clientes (formulario de datos del registro y poder
// firmado). Se aceptan solo PDF, PNG, JPG y WEBP, y el tipo se decide por los
// primeros bytes del archivo (magic bytes), nunca por el mime que declara el
// navegador o el data URL: un HTML o un SVG renombrado como .png no pasa.
//
// También arma las cabeceras para servir esos archivos desde el panel admin,
// de modo que nada de lo subido se ejecute como página en el dominio.

const fs = require('fs');

// Tipos permitidos, en el orden en que se prueban.
const TIPOS = {
  pdf:  { mime: 'application/pdf', ext: 'pdf' },
  png:  { mime: 'image/png',       ext: 'png' },
  jpg:  { mime: 'image/jpeg',      ext: 'jpg' },
  webp: { mime: 'image/webp',      ext: 'webp' },
};

// Lo que acepta cada campo del formulario.
const PERMITIDOS_DOC = ['pdf', 'png', 'jpg', 'webp'];  // poder firmado, estatuto, acta
const PERMITIDOS_LOGO = ['png', 'jpg', 'webp'];        // logo de la marca

const NOMBRES = { pdf: 'PDF', png: 'PNG', jpg: 'JPG', webp: 'WEBP' };
function describirPermitidos(lista) {
  const n = lista.map(t => NOMBRES[t]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} o ${n[n.length - 1]}` : n[0];
}

// Devuelve la clave del tipo ('pdf' | 'png' | 'jpg' | 'webp') o null.
function detectarTipo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  // La norma de PDF admite bytes antes de la cabecera (algunos escáneres los
  // agregan): se busca %PDF- en los primeros 1024. Igual se sirve siempre como
  // application/pdf con nosniff, así que nunca se interpreta como HTML.
  if (buf.subarray(0, 1024).indexOf('%PDF-', 0, 'latin1') !== -1) return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Decodifica un data URL en base64 y valida el contenido contra `permitidos`.
// Ignora el mime declarado (puede venir vacío o mentir).
// Devuelve { ok: true, buf, tipo, ext, mime } o { ok: false, error }.
function decodificarDataUrl(dataUrl, permitidos) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return { ok: false, error: 'Falta el archivo.' };
  }
  const coma = dataUrl.indexOf(',');
  if (coma < 0 || !/;base64$/i.test(dataUrl.slice(0, coma))) {
    return { ok: false, error: 'Archivo inválido.' };
  }
  const buf = Buffer.from(dataUrl.slice(coma + 1), 'base64');
  if (!buf.length) return { ok: false, error: 'El archivo está vacío.' };
  const tipo = detectarTipo(buf);
  if (!tipo || !permitidos.includes(tipo)) {
    return { ok: false, error: `Formato no aceptado. Subilo en ${describirPermitidos(permitidos)}.` };
  }
  return { ok: true, buf, tipo, ext: TIPOS[tipo].ext, mime: TIPOS[tipo].mime };
}

// Lee los primeros bytes de un archivo en disco y devuelve su tipo o null.
function detectarTipoArchivo(ruta) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    const buf = Buffer.alloc(1024);
    const n = fs.readSync(fd, buf, 0, 1024, 0);
    return detectarTipo(buf.subarray(0, n));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

// Sirve un archivo subido por un cliente desde el panel admin. El Content-Type
// sale del contenido real, no de la extensión. Si no es uno de los tipos
// permitidos (por ejemplo, un SVG o HTML subido antes de este control), se
// manda como descarga binaria: el navegador no lo abre ni lo ejecuta.
function enviarArchivoSubido(res, ruta, nombreBase) {
  // res.sendFile respeta el Content-Type que ya está puesto y mantiene el
  // soporte de rangos (visor de PDF) y el cierre del archivo si se corta.
  const tipo = detectarTipoArchivo(ruta);
  const seguro = String(nombreBase || 'archivo').replace(/[^\w.-]+/g, '_');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  if (tipo) {
    res.setHeader('Content-Type', TIPOS[tipo].mime);
    res.setHeader('Content-Disposition', `inline; filename="${seguro}.${TIPOS[tipo].ext}"`);
    // Las imágenes además van con sandbox (no aplica a PDF: Chrome no abre
    // su visor de PDF dentro de un documento con sandbox).
    if (tipo !== 'pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${seguro}.bin"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
  res.sendFile(ruta, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(err.status || 500).end();
  });
}

module.exports = {
  TIPOS, PERMITIDOS_DOC, PERMITIDOS_LOGO,
  detectarTipo, decodificarDataUrl, detectarTipoArchivo, enviarArchivoSubido, describirPermitidos,
};
