// Generador del PDF del informe pago — versión emprendedor.
// Renderiza el bloque "cliente" del JSON de matching/informe.js (lenguaje llano,
// sin jerga legal) + el contexto digital. La estructura técnica completa
// (los 7 ejes que vio el Agente al revisar) NO va en este PDF.

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const FONT_DIR = path.join(__dirname, '..', '..', 'TIPOGRAFIA');
const LOGO_PATH = path.join(__dirname, '..', '..', 'legalpacers-logos-01.png');

const COLORES = {
  azul: '#1B6EF3',
  navy: '#0F1F3D',
  riesgoAlto: '#dc2626',
  riesgoMedio: '#d97706',
  riesgoBajo: '#059669',
  textoTitulo: '#0F1F3D',
  textoCuerpo: '#1f2937',
  textoSuave: '#64748b',
  cardBg: '#f8fafc',
  separador: '#cbd5e1',
  ok: '#059669',
  warning: '#d97706',
  fail: '#dc2626',
  info: '#64748b',
};

const ANCHO_CONTENIDO = 495;
const X_MARGEN = 50;

function colorRiesgo(nivel) {
  if (nivel === 'alto') return COLORES.riesgoAlto;
  if (nivel === 'medio') return COLORES.riesgoMedio;
  return COLORES.riesgoBajo;
}

function etiquetaRiesgo(nivel) {
  if (nivel === 'alto') return 'RIESGO ALTO';
  if (nivel === 'medio') return 'RIESGO MEDIO';
  return 'RIESGO BAJO';
}

function colorIcono(tipo) {
  return COLORES[tipo] || COLORES.info;
}

function simboloIcono(tipo) {
  // Símbolos Unicode soportados por Mundial Regular.
  if (tipo === 'ok') return '✓';
  if (tipo === 'warning') return '!';
  if (tipo === 'fail') return '✗';
  return '·';
}

function fmtFecha(d = new Date()) {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function registrarFuentes(doc) {
  doc.registerFont('cuerpo', path.join(FONT_DIR, 'MundialRegular.otf'));
  doc.registerFont('cuerpo-bold', path.join(FONT_DIR, 'MundialBold.otf'));
  doc.registerFont('cuerpo-light', path.join(FONT_DIR, 'MundialLight.otf'));
  doc.registerFont('titulo', path.join(FONT_DIR, 'MundialBlack.otf'));
  doc.registerFont('demi', path.join(FONT_DIR, 'MundialDemibold.otf'));
  doc.registerFont('italic', path.join(FONT_DIR, 'MundialItalic.otf'));
}

// Workaround para ligaduras OTF "fi/fl" que PDFKit mapea mal.
// Forzamos "-liga -dlig" en todas las llamadas a text() preservando la firma posicional.
function deshabilitarLigaduras(doc) {
  const origText = doc.text.bind(doc);
  const FEATURES = ['-liga', '-dlig'];
  doc.text = function (...args) {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      if (!last.features) last.features = FEATURES;
      return origText(...args);
    }
    if (args.length === 2 && typeof args[1] === 'number') {
      args.splice(2, 0, doc.y);
    }
    args.push({ features: FEATURES });
    return origText(...args);
  };
}

function asegurarEspacio(doc, alto) {
  // Forzamos salto de página si no entra el bloque entero (deja margen para pie).
  if (doc.y + alto > doc.page.height - 90) doc.addPage();
}

function dibujarHeader(doc, { cliente }) {
  const yInicio = 50;
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, X_MARGEN, yInicio, { width: 150 });
  } else {
    doc.font('titulo').fontSize(22).fillColor(COLORES.navy).text('LegalPacers', X_MARGEN, yInicio);
  }
  doc.font('cuerpo').fontSize(9).fillColor(COLORES.textoSuave)
    .text('CONSULTORA DE PROPIEDAD INDUSTRIAL', X_MARGEN, yInicio + 4, {
      lineBreak: false, width: ANCHO_CONTENIDO, align: 'right',
    });
  doc.font('cuerpo-bold').fontSize(10).fillColor(COLORES.navy)
    .text(fmtFecha(), X_MARGEN, yInicio + 20, {
      lineBreak: false, width: ANCHO_CONTENIDO, align: 'right',
    });

  doc.moveTo(X_MARGEN, yInicio + 60).lineTo(X_MARGEN + ANCHO_CONTENIDO, yInicio + 60)
    .lineWidth(0.5).strokeColor(COLORES.separador).stroke();

  // Bloque para / marca consultada
  doc.y = yInicio + 80;
  doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave)
    .text('INFORME PARA', X_MARGEN, doc.y);
  doc.font('demi').fontSize(11).fillColor(COLORES.navy)
    .text(cliente.email || '—', X_MARGEN, doc.y + 2);
  doc.moveDown(0.4);

  doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave)
    .text('MARCA CONSULTADA', X_MARGEN, doc.y);
  doc.font('titulo').fontSize(28).fillColor(COLORES.navy)
    .text(cliente.marca, X_MARGEN, doc.y, { lineGap: 0 });
  if (Array.isArray(cliente.clases) && cliente.clases.length > 0) {
    doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
      .text(
        `Clase${cliente.clases.length > 1 ? 's' : ''} ${cliente.clases.join(', ')}` +
        (cliente.rubro ? ` · ${cliente.rubro}` : ''),
        X_MARGEN, doc.y,
      );
  }
  doc.moveDown(1.2);
}

function dibujarVeredicto(doc, informe) {
  const nivel = informe.nivel_riesgo || 'medio';
  const viab = informe.viabilidad_estimada;
  const color = colorRiesgo(nivel);
  const veredictoBreve = informe.cliente?.veredicto_breve || informe.resumen_ejecutivo || '—';

  doc.font('cuerpo').fontSize(11);
  const altoTexto = doc.heightOfString(veredictoBreve, { width: ANCHO_CONTENIDO - 40 });
  const altoCard = altoTexto + 70;

  asegurarEspacio(doc, altoCard + 16);
  const yCard = doc.y;

  // Banner superior con el riesgo
  doc.save();
  doc.roundedRect(X_MARGEN, yCard, ANCHO_CONTENIDO, altoCard, 8)
    .fillColor(COLORES.cardBg).fill();
  doc.rect(X_MARGEN, yCard, 6, altoCard).fillColor(color).fill();
  doc.restore();

  doc.font('titulo').fontSize(14).fillColor(color)
    .text(etiquetaRiesgo(nivel), X_MARGEN + 24, yCard + 16);
  if (typeof viab === 'number') {
    doc.font('cuerpo-light').fontSize(10).fillColor(COLORES.textoSuave)
      .text(`Viabilidad estimada: ${viab}%`, X_MARGEN + 24, yCard + 36);
  }
  doc.font('cuerpo').fontSize(11).fillColor(COLORES.textoCuerpo)
    .text(veredictoBreve, X_MARGEN + 24, yCard + 54, { width: ANCHO_CONTENIDO - 40 });

  doc.y = yCard + altoCard + 22;
}

function dibujarBloque(doc, bloque) {
  if (!bloque) return;
  const titulo = bloque.titulo || '';
  const mensaje = bloque.mensaje || '';
  const icono = bloque.icono || 'info';
  const color = colorIcono(icono);

  // Calculamos alto aproximado para ver si entra en la página actual.
  doc.font('cuerpo').fontSize(10);
  const altoMsg = doc.heightOfString(mensaje, { width: ANCHO_CONTENIDO - 30 });
  let altoEstimado = 24 + altoMsg + 10;
  if (Array.isArray(bloque.subbloques)) {
    for (const sb of bloque.subbloques) {
      doc.font('cuerpo').fontSize(9);
      altoEstimado += 12 + doc.heightOfString(sb.mensaje || '', { width: ANCHO_CONTENIDO - 45 });
    }
  }
  asegurarEspacio(doc, altoEstimado);

  const yInicio = doc.y;

  // Icono + título en la misma línea
  const iconoSimbolo = simboloIcono(icono);
  const iconoBoxX = X_MARGEN;
  const iconoBoxY = yInicio;
  const iconoSize = 18;
  doc.save();
  doc.roundedRect(iconoBoxX, iconoBoxY, iconoSize, iconoSize, 3)
    .fillColor(color).fillOpacity(0.15).fill();
  doc.fillOpacity(1).restore();
  doc.font('cuerpo-bold').fontSize(11).fillColor(color)
    .text(iconoSimbolo, iconoBoxX, iconoBoxY + 3, { width: iconoSize, align: 'center' });

  doc.font('titulo').fontSize(10).fillColor(COLORES.navy)
    .text(titulo, X_MARGEN + iconoSize + 8, yInicio + 4, { width: ANCHO_CONTENIDO - iconoSize - 8 });

  doc.y = yInicio + 26;
  doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
    .text(mensaje, X_MARGEN, doc.y, { width: ANCHO_CONTENIDO });

  // Subbloques (preguntas/respuestas tipo FAQ)
  if (Array.isArray(bloque.subbloques) && bloque.subbloques.length) {
    doc.moveDown(0.4);
    for (const sb of bloque.subbloques) {
      doc.font('demi').fontSize(9).fillColor(COLORES.navy)
        .text(sb.titulo || '', X_MARGEN + 12, doc.y);
      doc.font('cuerpo').fontSize(9).fillColor(COLORES.textoCuerpo)
        .text(sb.mensaje || '', X_MARGEN + 12, doc.y, { width: ANCHO_CONTENIDO - 12 });
      doc.moveDown(0.25);
    }
  }

  doc.moveDown(0.8);
}

function dibujarContextoDigital(doc, contexto) {
  if (!contexto) return;
  const tieneDominios = contexto.dominios?.resultados;
  const tieneRedes = contexto.redes?.resultados;
  if (!tieneDominios && !tieneRedes) return;

  asegurarEspacio(doc, 120);
  const yInicio = doc.y;

  // Icono globo + título
  doc.save();
  doc.roundedRect(X_MARGEN, yInicio, 18, 18, 3)
    .fillColor(COLORES.azul).fillOpacity(0.15).fill();
  doc.fillOpacity(1).restore();
  doc.font('cuerpo-bold').fontSize(11).fillColor(COLORES.azul)
    .text('@', X_MARGEN, yInicio + 3, { width: 18, align: 'center' });
  doc.font('titulo').fontSize(10).fillColor(COLORES.navy)
    .text('TU MARCA EN INTERNET', X_MARGEN + 26, yInicio + 4);

  doc.y = yInicio + 26;

  if (tieneDominios) {
    doc.font('demi').fontSize(9).fillColor(COLORES.textoSuave).text('Dominios web', X_MARGEN, doc.y);
    doc.moveDown(0.2);
    for (const [tld, info] of Object.entries(contexto.dominios.resultados)) {
      const estado = info.disponible === true ? 'libre — podés registrarlo'
        : info.disponible === false ? 'tomado'
          : 'no pudimos verificar';
      const color = info.disponible === true ? COLORES.ok
        : info.disponible === false ? COLORES.fail
          : COLORES.textoSuave;
      const icono = info.disponible === true ? '✓' : info.disponible === false ? '✗' : '?';
      doc.font('cuerpo-bold').fontSize(10).fillColor(color)
        .text(icono, X_MARGEN + 12, doc.y, { width: 14, continued: true, lineBreak: false });
      doc.font('cuerpo').fillColor(COLORES.textoCuerpo)
        .text(`  ${contexto.dominios.slug}.${tld}`, { continued: true });
      doc.font('cuerpo-light').fillColor(COLORES.textoSuave).text(`  —  ${estado}`);
    }
    doc.moveDown(0.5);
  }

  if (tieneRedes) {
    doc.font('demi').fontSize(9).fillColor(COLORES.textoSuave).text('Redes sociales', X_MARGEN, doc.y);
    doc.moveDown(0.2);
    for (const [red, info] of Object.entries(contexto.redes.resultados)) {
      const estado = info.disponible === true ? 'libre — podés registrarlo'
        : info.disponible === false ? 'tomado'
          : 'no pudimos verificar (la plataforma bloquea)';
      const color = info.disponible === true ? COLORES.ok
        : info.disponible === false ? COLORES.fail
          : COLORES.textoSuave;
      const icono = info.disponible === true ? '✓' : info.disponible === false ? '✗' : '?';
      const nombreRed = red.charAt(0).toUpperCase() + red.slice(1);
      doc.font('cuerpo-bold').fontSize(10).fillColor(color)
        .text(icono, X_MARGEN + 12, doc.y, { width: 14, continued: true, lineBreak: false });
      doc.font('cuerpo').fillColor(COLORES.textoCuerpo)
        .text(`  ${nombreRed} @${contexto.redes.handle}`, { continued: true });
      doc.font('cuerpo-light').fillColor(COLORES.textoSuave).text(`  —  ${estado}`);
    }
  }
  doc.moveDown(1);
}

function dibujarProximosPasos(doc, informe) {
  const pasos = informe.cliente?.proximos_pasos || [];
  if (!pasos.length) return;

  doc.font('cuerpo').fontSize(10);
  const altoEstimado = 40 + pasos.reduce(
    (acc, p) => acc + doc.heightOfString(p, { width: ANCHO_CONTENIDO - 30 }) + 6,
    0,
  );
  asegurarEspacio(doc, altoEstimado);

  const yInicio = doc.y;
  doc.save();
  doc.roundedRect(X_MARGEN, yInicio, ANCHO_CONTENIDO, altoEstimado, 8)
    .fillColor(COLORES.azul).fillOpacity(0.06).fill();
  doc.fillOpacity(1).restore();

  doc.font('titulo').fontSize(11).fillColor(COLORES.azul)
    .text('QUÉ TE RECOMENDAMOS HACER', X_MARGEN + 18, yInicio + 14);
  doc.y = yInicio + 36;

  pasos.forEach((paso, i) => {
    const yPaso = doc.y;
    doc.font('cuerpo-bold').fontSize(10).fillColor(COLORES.azul)
      .text(`${i + 1}.`, X_MARGEN + 18, yPaso, { width: 16, lineBreak: false });
    doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
      .text(paso, X_MARGEN + 36, yPaso, { width: ANCHO_CONTENIDO - 50 });
    doc.moveDown(0.3);
  });
  doc.y = yInicio + altoEstimado + 12;
}

function dibujarApendiceLegal(doc, informe) {
  const apendice = informe.cliente?.apendice_legal_corto;
  if (!apendice) return;
  asegurarEspacio(doc, 50);
  doc.moveDown(0.5);
  doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
    .text('BASE LEGAL · para los curiosos', X_MARGEN, doc.y);
  doc.font('italic').fontSize(8).fillColor(COLORES.textoSuave)
    .text(apendice, X_MARGEN, doc.y, { width: ANCHO_CONTENIDO });
}

function dibujarPie(doc) {
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(range.start + i);
    const yPie = doc.page.height - 60;
    doc.moveTo(X_MARGEN, yPie).lineTo(X_MARGEN + ANCHO_CONTENIDO, yPie)
      .lineWidth(0.5).strokeColor(COLORES.separador).stroke();
    doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
      .text('Legal Pacers · Consultora de PI · legalpacers.com',
        X_MARGEN, yPie + 8, { lineBreak: false, width: ANCHO_CONTENIDO, align: 'left' });
    doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
      .text(`Página ${i + 1} de ${pageCount}`,
        X_MARGEN, yPie + 8, { lineBreak: false, width: ANCHO_CONTENIDO, align: 'right' });
    doc.font('italic').fontSize(7).fillColor(COLORES.textoSuave)
      .text('Análisis técnico orientativo. El INPI resuelve sobre el expediente de fondo.',
        X_MARGEN, yPie + 22, { lineBreak: false, width: ANCHO_CONTENIDO, align: 'left' });
  }
}

/**
 * Genera el PDF del informe. Devuelve un Promise<Buffer>.
 */
function generarPDF(informe, cliente, contexto = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: `Informe de viabilidad de marca - ${cliente.marca}`,
          Author: 'Legal Pacers · Consultora de PI',
          Subject: 'Análisis de registrabilidad ante INPI Argentina',
        },
      });

      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      registrarFuentes(doc);
      deshabilitarLigaduras(doc);
      doc.font('cuerpo');

      dibujarHeader(doc, { cliente });
      dibujarVeredicto(doc, informe);

      const bloques = informe.cliente?.bloques || [];
      for (const b of bloques) dibujarBloque(doc, b);

      dibujarContextoDigital(doc, contexto);
      dibujarProximosPasos(doc, informe);
      dibujarApendiceLegal(doc, informe);
      dibujarPie(doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPDF, COLORES };
