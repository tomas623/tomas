// Archivos que suben los clientes (formulario de datos del registro, poder
// firmado y formulario de términos y condiciones / política de privacidad).
// Se aceptan solo PDF, PNG, JPG, WEBP y Word (.docx), y el tipo se decide por los
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
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
};

// Lo que acepta cada campo del formulario.
const PERMITIDOS_DOC = ['pdf', 'png', 'jpg', 'webp'];  // poder firmado, estatuto, acta
const PERMITIDOS_LOGO = ['png', 'jpg', 'webp'];        // logo de la marca
// Formulario de términos y condiciones / política de privacidad: PDF, Word e
// imágenes. Solo .docx: el .doc viejo (OLE) no se distingue de un Excel o un
// instalador por los primeros bytes y puede traer macros.
const PERMITIDOS_DOCS_SERVICIO = ['pdf', 'docx', 'png', 'jpg', 'webp'];
// Entrega de la versión final desde el panel: Word y PDF.
const PERMITIDOS_ENTREGA = ['pdf', 'docx'];

const NOMBRES = { pdf: 'PDF', png: 'PNG', jpg: 'JPG', webp: 'WEBP', docx: 'Word (.docx)' };
function describirPermitidos(lista) {
  const n = lista.map(t => NOMBRES[t]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} o ${n[n.length - 1]}` : n[0];
}

// Un .docx es un ZIP con [Content_Types].xml y word/document.xml. Los nombres
// de las entradas van sin comprimir en el directorio central (al final del
// archivo) y en cada cabecera local, así que alcanza con buscarlos. Si trae
// macros (word/vbaProject.bin, es decir, un .docm renombrado) no pasa.
function esDocx(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  return buf.indexOf('word/document.xml', 0, 'latin1') !== -1
    && buf.indexOf('[Content_Types].xml', 0, 'latin1') !== -1
    && buf.indexOf('vbaProject.bin', 0, 'latin1') === -1;
}

// Devuelve la clave del tipo ('pdf' | 'png' | 'jpg' | 'webp' | 'docx') o null.
// `completo` = el buffer es el archivo entero (hace falta para reconocer un
// .docx, cuyo contenido se ve en todo el ZIP y no en los primeros bytes).
function detectarTipo(buf, completo = true) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  // La norma de PDF admite bytes antes de la cabecera (algunos escáneres los
  // agregan): se busca %PDF- en los primeros 1024. Igual se sirve siempre como
  // application/pdf con nosniff, así que nunca se interpreta como HTML.
  if (buf.subarray(0, 1024).indexOf('%PDF-', 0, 'latin1') !== -1) return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (completo && esDocx(buf)) return 'docx';
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
    const cabecera = buf.subarray(0, n);
    // Un ZIP solo se reconoce como .docx leyéndolo entero (hasta 30 MB).
    if (n >= 4 && cabecera.readUInt32LE(0) === 0x04034b50) {
      const st = fs.fstatSync(fd);
      if (st.size > 30 * 1024 * 1024) return null;
      return detectarTipo(fs.readFileSync(ruta), true);
    }
    return detectarTipo(cabecera, false);
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
    // Word nunca se abre en el navegador: se descarga.
    const disp = tipo === 'docx' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disp}; filename="${seguro}.${TIPOS[tipo].ext}"`);
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
  TIPOS, PERMITIDOS_DOC, PERMITIDOS_LOGO, PERMITIDOS_DOCS_SERVICIO, PERMITIDOS_ENTREGA,
  detectarTipo, decodificarDataUrl, detectarTipoArchivo, enviarArchivoSubido, describirPermitidos,
};
