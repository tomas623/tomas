// Generador del PDF del informe de viabilidad de marca.
// Usa PDFKit (programatico, sin Chrome). Output: Buffer base64-able.
//
// Estructura del PDF:
//   1. Header con logo + fecha + datos cliente
//   2. Veredicto principal (nivel_riesgo + viabilidad + resumen)
//   3. Analisis estructurado en 7 ejes (cards)
//   4. Contexto digital (dominios + redes)
//   5. Recomendacion + alternativas
//   6. Pie con marca consultora + disclaimer

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const FONT_DIR = path.join(__dirname, '..', '..', 'TIPOGRAFIA');
const LOGO_PATH = path.join(__dirname, '..', '..', 'legalpacers-logos-01.png');

// Paleta LegalPacers
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
  cardBorde: '#e2e8f0',
  separador: '#cbd5e1',
};

function colorRiesgo(nivel) {
  if (nivel === 'alto') return COLORES.riesgoAlto;
  if (nivel === 'medio') return COLORES.riesgoMedio;
  return COLORES.riesgoBajo;
}

function etiquetaRiesgo(nivel) {
  return nivel === 'alto' ? 'RIESGO ALTO' : nivel === 'medio' ? 'RIESGO MEDIO' : 'RIESGO BAJO';
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

// Mundial OpenType incluye ligaduras "fi/fl" pero el mapeo a Unicode falla en
// PDFKit y termina mostrando "difere" en lugar de "difiere". Forzamos
// "-liga -dlig" en todas las llamadas a text() para que use los glifos sueltos.
// PDFKit acepta firmas: text(s) | text(s, opts) | text(s, x, y) | text(s, x, y, opts).
// Si la última posición no es opts, agregamos uno con features. Cuidamos especialmente
// la firma text(s, x) sin Y — PDFKit la rechaza si insertamos opts al final.
function deshabilitarLigaduras(doc) {
  const origText = doc.text.bind(doc);
  const FEATURES = ['-liga', '-dlig'];
  doc.text = function (...args) {
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      if (!last.features) last.features = FEATURES;
      return origText(...args);
    }
    // Firmas posicionales válidas en PDFKit: (s), (s, x, y).
    // Para (s, x) — sin Y — debemos completar con doc.y antes de agregar opts.
    if (args.length === 2 && typeof args[1] === 'number') {
      args.splice(2, 0, doc.y);
    }
    args.push({ features: FEATURES });
    return origText(...args);
  };
}

function dibujarHeader(doc, { cliente }) {
  const yInicio = doc.y;
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 50, yInicio, { width: 160 });
  } else {
    doc.font('titulo').fontSize(22).fillColor(COLORES.navy).text('LegalPacers', 50, yInicio);
  }
  // Fecha + "Consultora de PI" alineado a la derecha
  doc.font('cuerpo').fontSize(9).fillColor(COLORES.textoSuave)
    .text('CONSULTORA DE PROPIEDAD INDUSTRIAL', 0, yInicio + 6, { align: 'right' });
  doc.font('cuerpo-bold').fontSize(10).fillColor(COLORES.navy)
    .text(fmtFecha(), 0, yInicio + 22, { align: 'right' });

  doc.moveTo(50, yInicio + 60).lineTo(545, yInicio + 60)
    .lineWidth(0.5).strokeColor(COLORES.separador).stroke();
  doc.y = yInicio + 80;

  // Bloque "informe para"
  doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave).text('INFORME PARA', 50, doc.y);
  doc.font('demi').fontSize(12).fillColor(COLORES.navy).text(cliente.email || '—', 50, doc.y + 4);
  doc.moveDown(0.5);

  // Marca consultada + clases
  doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave).text('MARCA CONSULTADA');
  doc.font('titulo').fontSize(24).fillColor(COLORES.navy).text(cliente.marca, { lineGap: 0 });
  if (Array.isArray(cliente.clases) && cliente.clases.length > 0) {
    doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
      .text(`Clase${cliente.clases.length > 1 ? 's' : ''} Niza: ${cliente.clases.join(', ')}` +
        (cliente.rubro ? ` · Rubro declarado: ${cliente.rubro}` : ''));
  }
  doc.moveDown(1.2);
}

function dibujarVeredicto(doc, informe) {
  const nivel = informe.nivel_riesgo || 'medio';
  const viab = informe.viabilidad_estimada;
  const color = colorRiesgo(nivel);

  const xCard = 50;
  const yCard = doc.y;
  const wCard = 495;
  const hCard = 92;

  // Card con borde lateral del color del riesgo
  doc.save();
  doc.roundedRect(xCard, yCard, wCard, hCard, 6).fillColor(COLORES.cardBg).fill();
  doc.rect(xCard, yCard, 6, hCard).fillColor(color).fill();
  doc.restore();

  doc.font('cuerpo-bold').fontSize(10).fillColor(color)
    .text(etiquetaRiesgo(nivel), xCard + 24, yCard + 16);
  if (typeof viab === 'number') {
    doc.font('cuerpo-light').fontSize(10).fillColor(COLORES.textoSuave)
      .text(`Viabilidad estimada: ${viab}%`, xCard + 24, yCard + 30);
  }
  doc.font('cuerpo').fontSize(11).fillColor(COLORES.textoCuerpo)
    .text(informe.resumen_ejecutivo || '—', xCard + 24, yCard + 48, {
      width: wCard - 40,
    });

  doc.y = yCard + hCard + 20;
}

function dibujarSeccion(doc, titulo, contenidoFn) {
  if (doc.y > 720) doc.addPage();
  doc.font('titulo').fontSize(11).fillColor(COLORES.azul).text(titulo.toUpperCase(), 50, doc.y);
  doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4)
    .lineWidth(0.5).strokeColor(COLORES.separador).stroke();
  doc.moveDown(0.5);
  contenidoFn();
  doc.moveDown(1);
}

function dibujarKv(doc, key, value, opts = {}) {
  const { multiline = false } = opts;
  const y = doc.y;
  doc.font('cuerpo-bold').fontSize(10).fillColor(COLORES.textoTitulo).text(`${key}: `, 50, y, {
    continued: !multiline,
  });
  doc.font('cuerpo').fillColor(COLORES.textoCuerpo);
  if (multiline) doc.text(value || '—', 50, doc.y, { width: 495 });
  else doc.text(value || '—');
}

function dibujarBadge(doc, texto, color) {
  const padding = 6;
  const ancho = doc.widthOfString(texto) + padding * 2;
  const alto = 16;
  const x = doc.x;
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, ancho, alto, 3).fillColor(color).fillOpacity(0.12).fill();
  doc.fillOpacity(1);
  doc.font('cuerpo-bold').fontSize(8).fillColor(color)
    .text(texto, x + padding, y + 4);
  doc.restore();
  doc.x = x + ancho + 4;
  doc.y = y;
}

function dibujarDistintividad(doc, d) {
  if (!d) return;
  dibujarSeccion(doc, 'Distintividad intrínseca', () => {
    dibujarKv(doc, 'Nivel', (d.nivel || '—').toUpperCase());
    dibujarKv(doc, 'Análisis', d.comentario, { multiline: true });
  });
}

function dibujarProhibiciones(doc, abs, rel, esp) {
  dibujarSeccion(doc, 'Prohibiciones de registro', () => {
    if (abs) {
      doc.font('demi').fontSize(10).fillColor(COLORES.navy).text('Absolutas (Art. 2 Ley 22.362)', 50);
      if (abs.flags?.length) {
        doc.font('cuerpo').fontSize(10).fillColor(COLORES.riesgoAlto)
          .text('· ' + abs.flags.join(' · '));
      }
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(abs.comentario || '—', { width: 495 });
      doc.moveDown(0.5);
    }
    if (rel) {
      doc.font('demi').fontSize(10).fillColor(COLORES.navy).text('Relativas (Art. 3 Ley 22.362)');
      if (rel.flags?.length) {
        doc.font('cuerpo').fontSize(10).fillColor(COLORES.riesgoAlto)
          .text('· ' + rel.flags.join(' · '));
      }
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(rel.comentario || '—', { width: 495 });
      doc.moveDown(0.5);
    }
    if (esp) {
      doc.font('demi').fontSize(10).fillColor(COLORES.navy).text('Leyes especiales');
      if (esp.flags?.length) {
        doc.font('cuerpo').fontSize(10).fillColor(COLORES.riesgoAlto)
          .text('· ' + esp.flags.join(' · '));
      }
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(esp.comentario || '—', { width: 495 });
    }
  });
}

function dibujarConfundibilidad(doc, c) {
  if (!c) return;
  dibujarSeccion(doc, 'Análisis de confundibilidad', () => {
    const ejes = [
      ['Fonético', c.fonetica],
      ['Visual', c.visual],
      ['Ideológico', c.ideologica],
    ];
    for (const [nombre, eje] of ejes) {
      if (!eje) continue;
      doc.font('demi').fontSize(10).fillColor(COLORES.navy).text(`${nombre} — similitud ${eje.similitud}`);
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(eje.explicacion || '—', { width: 495 });
      doc.moveDown(0.3);
    }
    if (c.regla_predominante) {
      doc.font('italic').fontSize(9).fillColor(COLORES.textoSuave)
        .text(`Regla predominante: ${c.regla_predominante}`, { width: 495 });
    }
  });
}

function dibujarEspecialidad(doc, esp) {
  if (!esp) return;
  dibujarSeccion(doc, 'Principio de especialidad', () => {
    dibujarKv(doc, 'Afinidad', (esp.afinidad || '—').toUpperCase());
    dibujarKv(doc, 'Análisis', esp.comentario, { multiline: true });
  });
}

function dibujarNotoriedad(doc, n) {
  if (!n) return;
  dibujarSeccion(doc, 'Notoriedad de la marca anterior', () => {
    const nivel = n.nivel || 'no';
    const etiqueta = nivel === 'renombrada' ? 'MARCA RENOMBRADA' : nivel === 'notoria' ? 'MARCA NOTORIA' : 'Sin notoriedad detectada';
    const color = nivel === 'no' ? COLORES.textoSuave : COLORES.riesgoAlto;
    doc.font('cuerpo-bold').fontSize(10).fillColor(color).text(etiqueta);
    if (n.publico_relevante) {
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo).text(`Público relevante: ${n.publico_relevante}`);
    }
    if (n.rompe_especialidad) {
      doc.font('demi').fontSize(10).fillColor(COLORES.riesgoAlto).text('· Quiebra el principio de especialidad');
    }
    if (n.riesgos_especificos?.length) {
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(`Riesgos específicos: ${n.riesgos_especificos.join(', ')}`);
    }
    doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
      .text(n.comentario || '—', { width: 495 });
  });
}

function dibujarContextoDigital(doc, contexto) {
  if (!contexto) return;
  dibujarSeccion(doc, 'Contexto digital de la marca', () => {
    // Dominios
    if (contexto.dominios?.resultados) {
      doc.font('demi').fontSize(10).fillColor(COLORES.navy).text('Dominios web');
      for (const [tld, info] of Object.entries(contexto.dominios.resultados)) {
        const estado = info.disponible === true ? 'LIBRE' : info.disponible === false ? 'TOMADO' : 'NO VERIFICABLE';
        const color = info.disponible === true ? COLORES.riesgoBajo : info.disponible === false ? COLORES.riesgoAlto : COLORES.textoSuave;
        doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
          .text(`· ${contexto.dominios.slug}.${tld} → `, { continued: true });
        doc.font('cuerpo-bold').fillColor(color).text(estado);
      }
      doc.moveDown(0.5);
    }
    // Redes
    if (contexto.redes?.resultados) {
      doc.font('demi').fontSize(10).fillColor(COLORES.navy).text('Handles en redes sociales');
      for (const [red, info] of Object.entries(contexto.redes.resultados)) {
        const estado = info.disponible === true ? 'LIBRE' : info.disponible === false ? 'TOMADO' : 'NO VERIFICABLE';
        const color = info.disponible === true ? COLORES.riesgoBajo : info.disponible === false ? COLORES.riesgoAlto : COLORES.textoSuave;
        const nombreRed = red.charAt(0).toUpperCase() + red.slice(1);
        doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
          .text(`· ${nombreRed} @${contexto.redes.handle} → `, { continued: true });
        doc.font('cuerpo-bold').fillColor(color).text(estado);
      }
      doc.font('italic').fontSize(8).fillColor(COLORES.textoSuave)
        .text('Las plataformas sociales pueden bloquear verificaciones automáticas; "no verificable" no implica que el handle esté libre.', { width: 495 });
    }
  });
}

function dibujarRecomendacion(doc, informe) {
  dibujarSeccion(doc, 'Recomendación', () => {
    const color = colorRiesgo(informe.nivel_riesgo);
    const texto = informe.recomendacion_principal || '—';

    // Calculo alto dinámico de la card según el largo del texto.
    doc.font('cuerpo-bold').fontSize(12);
    const altoTexto = doc.heightOfString(texto, { width: 475 });
    const padding = 16;
    const altoCard = altoTexto + padding * 2;
    const yCard = doc.y;

    doc.save();
    doc.roundedRect(50, yCard, 495, altoCard, 6)
      .fillColor(color).fillOpacity(0.08).fill();
    doc.fillOpacity(1).restore();

    doc.font('cuerpo-bold').fontSize(12).fillColor(color)
      .text(texto, 60, yCard + padding, { width: 475 });

    doc.y = yCard + altoCard + 12;

    if (informe.ley_aplicable) {
      doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave)
        .text('Fundamento legal', 50, doc.y);
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(informe.ley_aplicable, 50, doc.y, { width: 495 });
      doc.moveDown(0.5);
    }

    if (Array.isArray(informe.alternativas_sugeridas) && informe.alternativas_sugeridas.length) {
      doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave)
        .text('Alternativas sugeridas', 50, doc.y);
      doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
        .text(informe.alternativas_sugeridas.join(' · '), 50, doc.y);
    }
  });
}

function dibujarPie(doc) {
  // Pie de página: dibujar con coords absolutas y `lineBreak:false` para que
  // PDFKit no cree páginas extra cuando el texto del cuerpo terminó cerca del pie.
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(range.start + i);
    const yPie = doc.page.height - 60;
    const ancho = doc.page.width - 100;
    doc.moveTo(50, yPie).lineTo(50 + ancho, yPie)
      .lineWidth(0.5).strokeColor(COLORES.separador).stroke();
    doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
      .text('Legal Pacers · Consultora de Propiedad Industrial · legalpacers.com',
        50, yPie + 8, { lineBreak: false, width: ancho, align: 'left' });
    doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
      .text(`Página ${i + 1} de ${pageCount}`,
        50, yPie + 8, { lineBreak: false, width: ancho, align: 'right' });
    doc.font('italic').fontSize(7).fillColor(COLORES.textoSuave)
      .text('Este informe es un análisis técnico orientativo. La decisión final del INPI se ajusta al expediente de fondo.',
        50, yPie + 22, { lineBreak: false, width: ancho, align: 'left' });
  }
}

/**
 * Genera el PDF del informe. Devuelve un Promise<Buffer>.
 *
 * @param {object} informe - JSON estructurado de matching/informe.js
 * @param {object} cliente - { email, marca, clases, rubro }
 * @param {object} contexto - { dominios, redes }
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
      dibujarDistintividad(doc, informe.distintividad_intrinseca);
      dibujarProhibiciones(doc, informe.prohibiciones_absolutas, informe.prohibiciones_relativas, informe.leyes_especiales);
      dibujarConfundibilidad(doc, informe.confundibilidad);
      dibujarEspecialidad(doc, informe.especialidad);
      dibujarNotoriedad(doc, informe.notoriedad);
      dibujarContextoDigital(doc, contexto);
      dibujarRecomendacion(doc, informe);
      dibujarPie(doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPDF, COLORES };
