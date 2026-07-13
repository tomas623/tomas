// Generador del PDF del informe pago — versión emprendedor.
// Renderiza el bloque "cliente" del JSON de matching/informe.js (lenguaje llano,
// sin jerga legal) + el contexto digital. La estructura técnica completa
// (los 7 ejes que vio el Agente al revisar) NO va en este PDF.

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const FONT_DIR = path.join(__dirname, '..', '..', 'TIPOGRAFIA');
const LOGO_PATH = path.join(__dirname, '..', '..', 'legalpacers-logos-01.png');
const ISOTIPO_PATH = path.join(__dirname, '..', '..', 'static', 'isotipo.png');

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
  // Alias → archivo de la tipografía Mundial + fuente estándar de PDFKit como
  // fallback. Si algún .otf no está (p.ej. no llegó al build), NO reventamos la
  // generación entera: registramos el alias apuntando a la fuente built-in, así
  // el informe igual sale (con tipografía default) en vez de dejar al cliente
  // colgado. Un informe pago nunca debe fallar por un tema de fuente.
  const mapa = [
    ['cuerpo', 'MundialRegular.otf', 'Helvetica'],
    ['cuerpo-bold', 'MundialBold.otf', 'Helvetica-Bold'],
    ['cuerpo-light', 'MundialLight.otf', 'Helvetica'],
    ['titulo', 'MundialBlack.otf', 'Helvetica-Bold'],
    ['demi', 'MundialDemibold.otf', 'Helvetica-Bold'],
    ['italic', 'MundialItalic.otf', 'Helvetica-Oblique'],
  ];
  let faltaron = 0;
  for (const [alias, archivo, fallback] of mapa) {
    const ruta = path.join(FONT_DIR, archivo);
    try {
      if (fs.existsSync(ruta)) doc.registerFont(alias, ruta);
      else { doc.registerFont(alias, fallback); faltaron++; }
    } catch { doc.registerFont(alias, fallback); faltaron++; }
  }
  if (faltaron) console.error(`[informe-pdf] faltaron ${faltaron} fuente(s) Mundial en ${FONT_DIR} — usando fallback estándar`);
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

// Area util de contenido: hasta yPie=112pt desde abajo. Dejamos 20pt extra de aire.
function asegurarEspacio(doc, alto) {
  if (doc.y + alto > doc.page.height - 130) doc.addPage();
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
  const yMarca = doc.y;
  // Isotipo como sello de marca a la derecha, alineado con la denominación.
  if (fs.existsSync(ISOTIPO_PATH)) {
    doc.image(ISOTIPO_PATH, X_MARGEN + ANCHO_CONTENIDO - 46, yMarca + 2, { width: 46 });
  }
  doc.font('titulo').fontSize(32).fillColor(COLORES.navy)
    .text(cliente.marca, X_MARGEN, yMarca, { lineGap: 0, width: ANCHO_CONTENIDO - 60 });
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

// Barra de viabilidad 0-100 con zonas (rojo/ámbar/verde) y marcador en el valor.
function dibujarGauge(doc, x, y, w, viab, color) {
  const h = 9;
  const zonas = [
    { frac: 0.40, c: COLORES.riesgoAlto },
    { frac: 0.30, c: COLORES.riesgoMedio },
    { frac: 0.30, c: COLORES.riesgoBajo },
  ];
  doc.save();
  doc.roundedRect(x, y, w, h, h / 2).clip();
  let zx = x;
  for (const z of zonas) {
    const zw = w * z.frac;
    doc.rect(zx, y, zw, h).fillColor(z.c).fillOpacity(0.25).fill();
    zx += zw;
  }
  doc.restore();
  doc.fillOpacity(1);

  const mx = x + Math.max(0, Math.min(100, viab)) / 100 * w;
  doc.save();
  doc.circle(mx, y + h / 2, 6.5).fillColor('#ffffff').fill();
  doc.circle(mx, y + h / 2, 6.5).lineWidth(2).strokeColor(color).stroke();
  doc.circle(mx, y + h / 2, 2.6).fillColor(color).fill();
  doc.restore();
}

function dibujarVeredicto(doc, informe) {
  const nivel = informe.nivel_riesgo || 'medio';
  const viab = informe.viabilidad_estimada;
  const color = colorRiesgo(nivel);
  const veredictoBreve = informe.cliente?.veredicto_breve || informe.resumen_ejecutivo || '—';
  const hayGauge = typeof viab === 'number';

  doc.font('cuerpo').fontSize(11);
  const altoTexto = doc.heightOfString(veredictoBreve, { width: ANCHO_CONTENIDO - 48, lineGap: 2.5 });
  const altoCard = altoTexto + (hayGauge ? 100 : 64);

  asegurarEspacio(doc, altoCard + 16);
  const yCard = doc.y;

  doc.save();
  doc.roundedRect(X_MARGEN, yCard, ANCHO_CONTENIDO, altoCard, 10)
    .fillColor(COLORES.cardBg).fill();
  doc.rect(X_MARGEN, yCard, 6, altoCard).fillColor(color).fill();
  doc.restore();

  // Etiqueta de riesgo grande (izquierda)
  doc.font('titulo').fontSize(16).fillColor(color)
    .text(etiquetaRiesgo(nivel), X_MARGEN + 24, yCard + 18, { lineBreak: false, width: 280 });

  let yTexto = yCard + 46;
  if (hayGauge) {
    // Número grande de viabilidad (derecha)
    doc.font('titulo').fontSize(22).fillColor(color)
      .text(`${viab}%`, X_MARGEN + ANCHO_CONTENIDO - 110, yCard + 12, { width: 86, align: 'right', lineBreak: false });
    doc.font('cuerpo-light').fontSize(7).fillColor(COLORES.textoSuave)
      .text('VIABILIDAD ESTIMADA', X_MARGEN + ANCHO_CONTENIDO - 160, yCard + 37, { width: 136, align: 'right', lineBreak: false });
    // Barra
    dibujarGauge(doc, X_MARGEN + 24, yCard + 54, ANCHO_CONTENIDO - 48, viab, color);
    doc.font('cuerpo-light').fontSize(7).fillColor(COLORES.textoSuave)
      .text('Menos viable', X_MARGEN + 24, yCard + 66, { lineBreak: false, width: 120 });
    doc.font('cuerpo-light').fontSize(7).fillColor(COLORES.textoSuave)
      .text('Más viable', X_MARGEN + 24, yCard + 66, { lineBreak: false, width: ANCHO_CONTENIDO - 48, align: 'right' });
    yTexto = yCard + 84;
  }
  doc.font('cuerpo').fontSize(11).fillColor(COLORES.textoCuerpo)
    .text(veredictoBreve, X_MARGEN + 24, yTexto, { width: ANCHO_CONTENIDO - 48, lineGap: 2.5 });

  doc.y = yCard + altoCard + 22;
}

// Medidor de 5 puntos para un eje de similitud (alta/media/baja/nula).
const NIVEL_PUNTOS = { alta: 5, media: 3, baja: 2, nula: 1 };
const NIVEL_TEXTO = { alta: 'IDÉNTICA', media: 'PARECIDA', baja: 'ALGO PARECIDA', nula: 'DISTINTA' };

function dibujarMedidor(doc, label, nivel, color, yBase) {
  const llenos = NIVEL_PUNTOS[nivel] || 1;
  const txt = NIVEL_TEXTO[nivel] || '';
  doc.font('cuerpo').fontSize(9).fillColor(COLORES.textoCuerpo)
    .text(label, X_MARGEN + 18, yBase, { width: 95, lineBreak: false });
  const dx = X_MARGEN + 122, r = 3.2, gap = 11;
  for (let i = 0; i < 5; i++) {
    const cx = dx + i * gap;
    doc.circle(cx, yBase + 5, r);
    if (i < llenos) doc.fillColor(color).fill();
    else doc.lineWidth(0.8).strokeColor(COLORES.separador).stroke();
  }
  doc.font('demi').fontSize(8.5).fillColor(color)
    .text(txt, dx + 5 * gap + 6, yBase, { width: 130, lineBreak: false });
  return yBase + 15;
}

// Título de sección con barra de acento azul a la izquierda.
function dibujarTituloSeccion(doc, texto) {
  const yT = doc.y;
  doc.save();
  doc.roundedRect(X_MARGEN, yT + 2, 4, 17, 2).fillColor(COLORES.azul).fill();
  doc.restore();
  doc.font('titulo').fontSize(15).fillColor(COLORES.navy)
    .text(texto, X_MARGEN + 12, yT, { width: ANCHO_CONTENIDO - 12 });
}

// Ficha técnica del caso — tabla de pares clave/valor con borde formal.
// Va después del header, antes del veredicto. Le da el "qué te estoy entregando"
// que distingue un informe profesional de un mensaje.
function dibujarFichaCaso(doc, cliente) {
  const tipo = cliente.tipo || 'Denominativa';
  const tipoLower = tipo.toLowerCase();
  const objeto = `Análisis de viabilidad de registro ante el Instituto Nacional de la Propiedad Industrial (INPI) de la marca ${tipoLower} "${cliente.marca}".`;

  const filas = [
    ['Solicitante', cliente.solicitante || cliente.email || '—'],
    ['Marca solicitada', cliente.marca],
    ['Tipo de marca', tipo],
    ['Clase(s) Niza', Array.isArray(cliente.clases) && cliente.clases.length ? cliente.clases.join(', ') : '—'],
    ['Productos / servicios', cliente.rubro || '—'],
    ['Objeto del informe', objeto],
  ];

  // Calculamos alto total midiendo cada valor.
  const colLabel = 130;
  const colVal = ANCHO_CONTENIDO - colLabel - 28;
  doc.font('cuerpo').fontSize(9.5);
  let altoFilas = 0;
  const altosFila = filas.map(([, val]) => {
    const h = Math.max(14, doc.heightOfString(val, { width: colVal, lineGap: 2 }) + 6);
    altoFilas += h;
    return h;
  });

  const altoTotal = altoFilas + 36;
  asegurarEspacio(doc, altoTotal + 12);
  const yIni = doc.y;

  dibujarTituloSeccion(doc, 'DATOS DEL CASO');
  const yCard = doc.y + 4;

  doc.save();
  doc.roundedRect(X_MARGEN, yCard, ANCHO_CONTENIDO, altoFilas + 14, 7)
    .lineWidth(0.7).strokeColor(COLORES.separador).stroke();
  doc.restore();

  let y = yCard + 8;
  filas.forEach(([label, val], i) => {
    doc.font('demi').fontSize(8.5).fillColor(COLORES.textoSuave)
      .text(label.toUpperCase(), X_MARGEN + 14, y + 2, { width: colLabel, lineBreak: false });
    doc.font('cuerpo').fontSize(9.5).fillColor(COLORES.textoCuerpo)
      .text(val, X_MARGEN + 14 + colLabel, y, { width: colVal, lineGap: 2 });
    y += altosFila[i];
    if (i < filas.length - 1) {
      doc.moveTo(X_MARGEN + 14, y).lineTo(X_MARGEN + ANCHO_CONTENIDO - 14, y)
        .lineWidth(0.3).strokeColor(COLORES.separador).stroke();
    }
  });

  doc.y = yCard + altoFilas + 14 + 14;
}

// Metodología — los ejes que el motor cruzó. Justifica el trabajo y diferencia
// el informe de una opinión rápida.
function dibujarMetodologia(doc) {
  asegurarEspacio(doc, 180);
  dibujarTituloSeccion(doc, 'METODOLOGÍA APLICADA');
  doc.font('cuerpo-light').fontSize(9.5).fillColor(COLORES.textoSuave)
    .text('Este informe se elaboró cruzando la marca solicitada contra los siguientes ejes de análisis:',
      X_MARGEN + 12, doc.y + 4, { width: ANCHO_CONTENIDO - 12, lineGap: 2 });
  doc.y += 20;

  const ejes = [
    {
      t: 'Búsqueda de marcas idénticas y similares',
      d: 'Cruce contra la base del INPI en las clases solicitadas y en clases conexas con potencial afinidad.',
    },
    {
      t: 'Análisis fonético',
      d: 'Evaluación de la pronunciación en español rioplatense respecto de las marcas preexistentes detectadas.',
    },
    {
      t: 'Análisis visual y ortográfico',
      d: 'Comparación gráfica entre la denominación solicitada y las marcas registradas.',
    },
    {
      t: 'Análisis conceptual',
      d: 'Evaluación del significado y la carga simbólica de la marca y su grado de superposición con otras.',
    },
    {
      t: 'Marcas notorias y renombradas',
      d: 'Verificación de potencial conflicto con marcas que gocen de protección reforzada por su reconocimiento público.',
    },
    {
      t: 'Leyes especiales aplicables',
      d: 'Chequeo de restricciones por Leyes 25.127 (eco/orgánico), 24.664 (símbolos olímpicos), 26.687 (tabaco) y normas sectoriales.',
    },
  ];

  for (const e of ejes) {
    doc.font('cuerpo').fontSize(9.5);
    const altoD = doc.heightOfString(e.d, { width: ANCHO_CONTENIDO - 28, lineGap: 2 });
    asegurarEspacio(doc, altoD + 32);
    const yE = doc.y;
    doc.circle(X_MARGEN + 6, yE + 7, 2.8).fillColor(COLORES.azul).fill();
    doc.font('cuerpo-bold').fontSize(10).fillColor(COLORES.navy)
      .text(e.t, X_MARGEN + 18, yE, { width: ANCHO_CONTENIDO - 18 });
    doc.moveDown(0.2);
    doc.font('cuerpo').fontSize(9.5).fillColor(COLORES.textoCuerpo)
      .text(e.d, X_MARGEN + 18, doc.y, { width: ANCHO_CONTENIDO - 18, lineGap: 2 });
    doc.moveDown(0.7);
  }
  doc.moveDown(0.3);
}

// Mide el alto total que ocupará una card de CTA (sin dibujarla todavía).
function medirCardCTA(doc, { titulo, parrafos }) {
  const padX = 24;
  const wTexto = ANCHO_CONTENIDO - padX - 18;
  let alto = 18;
  doc.font('titulo').fontSize(13);
  alto += doc.heightOfString(titulo, { width: wTexto, lineGap: 2 }) + 10;
  for (const p of parrafos) {
    doc.font(p.bold ? 'demi' : 'cuerpo').fontSize(10);
    alto += doc.heightOfString(p.txt, { width: wTexto, lineGap: 2.5 }) + 8;
  }
  alto += 10 + 22 + 16;
  return alto;
}

// Dibuja una card de CTA con alturas medidas (sin solapamientos).
function dibujarCardCTA(doc, opts) {
  const { titulo, tituloColor, parrafos, etiquetaBoton, botonColor, bg, barra, link } = opts;
  const padX = 24;
  const wTexto = ANCHO_CONTENIDO - padX - 18;
  const alto = medirCardCTA(doc, opts);
  const y = doc.y;

  doc.save();
  if (bg.opacity) {
    doc.roundedRect(X_MARGEN, y, ANCHO_CONTENIDO, alto, 10).fillColor(bg.color).fillOpacity(bg.opacity).fill();
  } else {
    doc.roundedRect(X_MARGEN, y, ANCHO_CONTENIDO, alto, 10).fillColor(bg.color).fill();
  }
  doc.restore();
  doc.fillOpacity(1);
  doc.save();
  doc.rect(X_MARGEN, y, 6, alto).fillColor(barra).fill();
  doc.restore();

  doc.font('titulo').fontSize(13).fillColor(tituloColor)
    .text(titulo, X_MARGEN + padX, y + 18, { width: wTexto, lineGap: 2 });
  doc.moveDown(0.35);
  for (const p of parrafos) {
    doc.font(p.bold ? 'demi' : 'cuerpo').fontSize(10).fillColor(p.bold ? COLORES.navy : COLORES.textoCuerpo)
      .text(p.txt, X_MARGEN + padX, doc.y, { width: wTexto, lineGap: 2.5 });
    doc.moveDown(0.3);
  }

  const wBoton = doc.font('cuerpo-bold').fontSize(9).widthOfString(etiquetaBoton) + 34;
  const yBtn = doc.y + 8;
  doc.save();
  doc.roundedRect(X_MARGEN + padX, yBtn, wBoton, 22, 11).fillColor(botonColor).fill();
  doc.fillColor('#ffffff').font('cuerpo-bold').fontSize(9)
    .text(etiquetaBoton, X_MARGEN + padX, yBtn + 7, { width: wBoton, align: 'center', lineBreak: false });
  doc.restore();
  if (link) {
    doc.link(X_MARGEN + padX, yBtn, wBoton, 22, link);
  }

  doc.y = y + alto + 12;
}

// "Qué implica registrar tu marca" — versión compacta en grilla 2x3.
// Pensada para entrar junto a los CTAs en la misma página, sin sumar una más.
function dibujarQueImplicaRegistro(doc) {
  const items = [
    { t: 'Derecho exclusivo',         d: 'Sos el único que puede usar la marca en las clases registradas.' },
    { t: 'Vigencia 10 años',          d: 'Renovable indefinidamente mientras la marca esté en uso.' },
    { t: 'Defensa frente a terceros', d: 'Oposiciones a marcas posteriores y acciones por infracción.' },
    { t: 'Activo transferible',       d: 'La marca se vende, licencia o aporta como activo intangible.' },
    { t: 'Trámite 12-18 meses',       d: 'Plazo habitual ante INPI si no hay oposiciones de terceros.' },
    { t: 'Cobertura LegalPacers',     d: 'Análisis, presentación, seguimiento y respuesta a oposiciones.' },
  ];

  const colW = (ANCHO_CONTENIDO - 14) / 2;
  const rowH = 48;
  const filas = Math.ceil(items.length / 2);

  asegurarEspacio(doc, filas * rowH + 60);
  dibujarTituloSeccion(doc, 'QUÉ INCLUYE EL REGISTRO');
  doc.font('cuerpo-light').fontSize(9.5).fillColor(COLORES.textoSuave)
    .text('Lo que obtenés cuando avanzás con el registro de marca:',
      X_MARGEN + 12, doc.y + 4, { width: ANCHO_CONTENIDO - 12, lineGap: 2 });
  doc.y += 20;

  const yStart = doc.y;
  items.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = X_MARGEN + col * (colW + 14);
    const y = yStart + row * rowH;

    // Check verde
    doc.save();
    doc.circle(x + 9, y + 9, 8).fillColor(COLORES.ok).fillOpacity(0.15).fill();
    doc.fillOpacity(1).restore();
    doc.font('cuerpo').fontSize(11).fillColor(COLORES.ok)
      .text('✓', x, y + 3, { width: 18, align: 'center', lineBreak: false });
    // Título
    doc.font('cuerpo-bold').fontSize(9.5).fillColor(COLORES.navy)
      .text(item.t, x + 24, y + 2, { width: colW - 26, lineBreak: false });
    // Descripción (puede ocupar 2 líneas)
    doc.font('cuerpo').fontSize(8.5).fillColor(COLORES.textoCuerpo)
      .text(item.d, x + 24, y + 16, { width: colW - 26, lineGap: 1.5 });
  });

  doc.y = yStart + filas * rowH;
}

// CTAs al cierre del informe — el plan comercial del estudio.
function dibujarCTAs(doc, cliente) {
  const card1 = {
    titulo: 'Consultá con un abogado de propiedad industrial',
    tituloColor: COLORES.navy,
    parrafos: [
      { txt: 'Si tenés dudas puntuales sobre este informe, alternativas viables, riesgos del negocio o estrategia marcaria a largo plazo, te asistimos en una reunión 1 a 1.' },
    ],
    etiquetaBoton: 'AGENDAR CONSULTA',
    botonColor: COLORES.navy,
    bg: { color: COLORES.cardBg },
    barra: COLORES.azul,
    link: 'https://calendar.app.google/rx6vHWyyjFoEr7Vx9',
  };
  const card2 = {
    titulo: 'Registrá tu marca con LegalPacers',
    tituloColor: COLORES.azul,
    parrafos: [
      { txt: 'Nos encargamos de la presentación, el seguimiento ante el INPI y las eventuales oposiciones.' },
      { txt: 'Descontamos íntegramente el valor de este informe del costo del registro.', bold: true },
    ],
    etiquetaBoton: 'INICIAR EL REGISTRO',
    botonColor: COLORES.azul,
    bg: { color: COLORES.azul, opacity: 0.08 },
    barra: COLORES.azul,
  };

  // Reservar espacio del bloque completo (título + intro + 2 cards + contacto)
  // para evitar que la card 2 se vaya sola a una página nueva.
  const altoBloque = 56 + medirCardCTA(doc, card1) + 12 + medirCardCTA(doc, card2) + 30;
  asegurarEspacio(doc, altoBloque);

  dibujarTituloSeccion(doc, 'PRÓXIMOS PASOS CON LEGALPACERS');
  doc.font('cuerpo-light').fontSize(9.5).fillColor(COLORES.textoSuave)
    .text('Te acompañamos en lo que sigue. Estas son las dos vías habituales a partir de este informe:',
      X_MARGEN + 12, doc.y + 4, { width: ANCHO_CONTENIDO - 12, lineGap: 2 });
  doc.y += 22;

  dibujarCardCTA(doc, card1);
  dibujarCardCTA(doc, card2);

  // Datos de contacto del estudio
  doc.moveDown(0.3);
  doc.font('cuerpo-light').fontSize(8.5).fillColor(COLORES.textoSuave)
    .text('Escribinos a contacto@legalpacers.com  ·  WhatsApp +54 9 11 2877-4200  ·  legalpacers.com',
      X_MARGEN, doc.y, { width: ANCHO_CONTENIDO, align: 'center', lineBreak: false });
}

function dibujarComparativas(doc, informe) {
  const comps = informe.cliente?.comparativas || [];
  const resto = informe.cliente?.comparativas_resto || 0;
  if (!comps.length) return;

  asegurarEspacio(doc, 70);
  dibujarTituloSeccion(doc, 'MARCAS QUE ENCONTRAMOS REGISTRADAS');
  doc.font('cuerpo-light').fontSize(9.5).fillColor(COLORES.textoSuave)
    .text(`Cruzamos "${informe._marcaConsultada || 'tu marca'}" contra la base del INPI. Esto es lo que aparece y cuánto se parece a tu marca.`,
      X_MARGEN + 12, doc.y + 4, { width: ANCHO_CONTENIDO - 12, lineGap: 2 });
  doc.y += 16;

  for (const c of comps) {
    const choca = c.choca === true;
    const color = choca ? COLORES.fail : COLORES.textoSuave;
    const bg = choca ? '#fef2f2' : '#f1f5f9';
    const medidores = choca
      ? [
        { label: 'Cómo suena', nivel: c.como_suena },
        { label: 'Cómo se escribe', nivel: c.como_se_escribe },
        { label: 'Qué evoca', nivel: c.que_evoca },
      ].filter(m => m.nivel)
      : [];

    const alto = medidores.length ? (50 + medidores.length * 15) : 42;
    asegurarEspacio(doc, alto + 10);
    const yIni = doc.y;

    doc.save();
    doc.roundedRect(X_MARGEN, yIni, ANCHO_CONTENIDO, alto, 7).fillColor(bg).fill();
    doc.rect(X_MARGEN, yIni, 5, alto).fillColor(color).fill();
    doc.restore();

    doc.font('titulo').fontSize(13).fillColor(COLORES.navy)
      .text(c.marca || '—', X_MARGEN + 18, yIni + 11, { lineBreak: false, width: 300 });

    const badge = choca ? 'CHOCA' : 'OTRO RUBRO';
    const bw = doc.font('demi').fontSize(8.5).widthOfString(badge) + 18;
    doc.save();
    doc.roundedRect(X_MARGEN + ANCHO_CONTENIDO - bw - 14, yIni + 11, bw, 17, 8.5)
      .fillColor(color).fill();
    doc.fillColor('#ffffff').font('demi').fontSize(8.5)
      .text(badge, X_MARGEN + ANCHO_CONTENIDO - bw - 14, yIni + 15, { width: bw, align: 'center', lineBreak: false });
    doc.restore();

    const sub = [
      c.clase != null ? `Clase ${c.clase}` : null,
      c.rubro && c.rubro !== '—' ? c.rubro : null,
      c.titular,
      c.estado,
    ].filter(Boolean).join(' · ');
    doc.font('cuerpo').fontSize(9).fillColor(COLORES.textoSuave)
      .text(sub, X_MARGEN + 18, yIni + 29, { width: ANCHO_CONTENIDO - 36, lineBreak: false });

    if (medidores.length) {
      let y = yIni + 48;
      for (const m of medidores) y = dibujarMedidor(doc, m.label, m.nivel, color, y);
    }
    doc.y = yIni + alto + 8;
  }

  if (resto > 0) {
    doc.font('cuerpo-light').fontSize(9).fillColor(COLORES.textoSuave)
      .text(`Y ${resto} coincidencia${resto > 1 ? 's' : ''} más de menor relevancia que no detallamos acá.`,
        X_MARGEN, doc.y + 2, { width: ANCHO_CONTENIDO });
    doc.y += 6;
  }
  doc.moveDown(0.6);
}

function dibujarBloque(doc, bloque) {
  if (!bloque) return;
  const titulo = bloque.titulo || '';
  const mensaje = bloque.mensaje || '';
  const icono = bloque.icono || 'info';
  const color = colorIcono(icono);

  // Calculamos alto aproximado para ver si entra en la página actual.
  doc.font('cuerpo').fontSize(10);
  const altoMsg = doc.heightOfString(mensaje, { width: ANCHO_CONTENIDO - 30, lineGap: 2.5 });
  let altoEstimado = 24 + altoMsg + 12;
  if (Array.isArray(bloque.subbloques)) {
    for (const sb of bloque.subbloques) {
      doc.font('cuerpo').fontSize(9);
      altoEstimado += 14 + doc.heightOfString(sb.mensaje || '', { width: ANCHO_CONTENIDO - 45, lineGap: 2 });
    }
  }
  asegurarEspacio(doc, altoEstimado);

  const yInicio = doc.y;

  // Icono + título en la misma línea — lineBreak:false para evitar wrap
  const iconoSimbolo = simboloIcono(icono);
  const iconoSize = 18;
  doc.save();
  doc.roundedRect(X_MARGEN, yInicio, iconoSize, iconoSize, 3)
    .fillColor(color).fillOpacity(0.15).fill();
  doc.fillOpacity(1).restore();
  doc.font('cuerpo-bold').fontSize(11).fillColor(color)
    .text(iconoSimbolo, X_MARGEN, yInicio + 3, { width: iconoSize, align: 'center', lineBreak: false });

  doc.font('titulo').fontSize(10).fillColor(COLORES.navy)
    .text(titulo, X_MARGEN + iconoSize + 8, yInicio + 5,
      { width: ANCHO_CONTENIDO - iconoSize - 8, lineBreak: false });

  doc.y = yInicio + 26;
  doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
    .text(mensaje, X_MARGEN, doc.y, { width: ANCHO_CONTENIDO, lineGap: 2.5 });

  if (Array.isArray(bloque.subbloques) && bloque.subbloques.length) {
    doc.moveDown(0.5);
    for (const sb of bloque.subbloques) {
      doc.font('demi').fontSize(9).fillColor(COLORES.navy)
        .text(sb.titulo || '', X_MARGEN + 12, doc.y, { width: ANCHO_CONTENIDO - 12 });
      doc.moveDown(0.15);
      doc.font('cuerpo').fontSize(9).fillColor(COLORES.textoCuerpo)
        .text(sb.mensaje || '', X_MARGEN + 12, doc.y, { width: ANCHO_CONTENIDO - 12, lineGap: 2 });
      doc.moveDown(0.35);
    }
  }

  doc.moveDown(0.7);
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
    .text('@', X_MARGEN, yInicio + 3, { width: 18, align: 'center', lineBreak: false });
  doc.font('titulo').fontSize(10).fillColor(COLORES.navy)
    .text('TU MARCA EN INTERNET', X_MARGEN + 26, yInicio + 4, { lineBreak: false, width: ANCHO_CONTENIDO - 26 });

  doc.y = yInicio + 26;

  const dibujarFilaRecurso = (icono, color, etiquetaPrincipal, estado) => {
    const yRow = doc.y;
    doc.font('cuerpo-bold').fontSize(10).fillColor(color)
      .text(icono, X_MARGEN + 12, yRow, { width: 12, align: 'left', lineBreak: false });
    doc.font('cuerpo').fontSize(10).fillColor(COLORES.textoCuerpo)
      .text(etiquetaPrincipal, X_MARGEN + 30, yRow, { lineBreak: false, width: 200 });
    doc.font('cuerpo-light').fontSize(10).fillColor(COLORES.textoSuave)
      .text(`— ${estado}`, X_MARGEN + 230, yRow, { lineBreak: false, width: ANCHO_CONTENIDO - 230 });
    doc.y = yRow + 14;
  };

  const interpretarDisponibilidad = (info) => {
    if (info.disponible === true) return { estado: 'libre — podés registrarlo', color: COLORES.ok, icono: '✓' };
    if (info.disponible === false) return { estado: 'tomado', color: COLORES.fail, icono: '✗' };
    return { estado: 'no pudimos verificar (la plataforma bloquea)', color: COLORES.textoSuave, icono: '?' };
  };

  if (tieneDominios) {
    doc.font('demi').fontSize(9).fillColor(COLORES.textoSuave)
      .text('Dominios web', X_MARGEN, doc.y, { lineBreak: false, width: ANCHO_CONTENIDO });
    doc.y += 12;
    for (const [tld, info] of Object.entries(contexto.dominios.resultados)) {
      const { estado, color, icono } = interpretarDisponibilidad(info);
      dibujarFilaRecurso(icono, color, `${contexto.dominios.slug}.${tld}`, estado);
    }
    doc.y += 6;
  }

  if (tieneRedes) {
    doc.font('demi').fontSize(9).fillColor(COLORES.textoSuave)
      .text('Redes sociales', X_MARGEN, doc.y, { lineBreak: false, width: ANCHO_CONTENIDO });
    doc.y += 12;
    for (const [red, info] of Object.entries(contexto.redes.resultados)) {
      const { estado, color, icono } = interpretarDisponibilidad(info);
      const nombreRed = red.charAt(0).toUpperCase() + red.slice(1);
      dibujarFilaRecurso(icono, color, `${nombreRed} @${contexto.redes.handle}`, estado);
    }
  }
  doc.moveDown(0.8);
}

function dibujarProximosPasos(doc, informe) {
  const pasos = informe.cliente?.proximos_pasos || [];
  if (!pasos.length) return;

  doc.font('cuerpo').fontSize(10);
  const altoEstimado = 44 + pasos.reduce(
    (acc, p) => acc + doc.heightOfString(p, { width: ANCHO_CONTENIDO - 50, lineGap: 2.5 }) + 10,
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
      .text(paso, X_MARGEN + 36, yPaso, { width: ANCHO_CONTENIDO - 50, lineGap: 2.5 });
    doc.moveDown(0.45);
  });
  doc.y = yInicio + altoEstimado + 12;
}

// Encuadre normativo fijo: aparece en todos los informes, antes del artículo
// puntual que el motor cita para cada caso.
const MARCO_LEGAL = 'El presente informe se elaboró sobre la base de la Ley de Marcas y '
  + 'Designaciones, las leyes especiales aplicables, las resoluciones del INPI '
  + 'y la doctrina vigente en materia marcaria.';

function dibujarApendiceLegal(doc, informe) {
  const apendice = informe.cliente?.apendice_legal_corto;
  asegurarEspacio(doc, 80);
  doc.moveDown(0.6);
  doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
    .text('BASE LEGAL', X_MARGEN, doc.y);
  doc.moveDown(0.15);
  doc.font('italic').fontSize(8).fillColor(COLORES.textoSuave)
    .text(MARCO_LEGAL, X_MARGEN, doc.y, { width: ANCHO_CONTENIDO, lineGap: 2 });
  if (apendice) {
    doc.moveDown(0.35);
    doc.font('italic').fontSize(8).fillColor(COLORES.textoSuave)
      .text(apendice, X_MARGEN, doc.y, { width: ANCHO_CONTENIDO, lineGap: 2 });
  }
}

function dibujarPie(doc) {
  // El pie tiene que entrar entero arriba de maxY = page.height - margin.bottom = 792 (A4).
  // Si las coords del texto + lineHeight pasan 792, PDFKit hace addPage automatico.
  // Por eso ubicamos el bloque del pie a y=730 (margen efectivo de 112pt desde abajo).
  const range = doc.bufferedPageRange();
  const pageCount = range.count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(range.start + i);
    const yPie = doc.page.height - 112;
    doc.moveTo(X_MARGEN, yPie).lineTo(X_MARGEN + ANCHO_CONTENIDO, yPie)
      .lineWidth(0.5).strokeColor(COLORES.separador).stroke();
    doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
      .text('Legal Pacers · Consultora de PI · legalpacers.com',
        X_MARGEN, yPie + 8, { lineBreak: false, width: ANCHO_CONTENIDO - 80, align: 'left' });
    doc.font('cuerpo-light').fontSize(8).fillColor(COLORES.textoSuave)
      .text(`Página ${i + 1} de ${pageCount}`,
        X_MARGEN, yPie + 8, { lineBreak: false, width: ANCHO_CONTENIDO, align: 'right' });
    doc.font('italic').fontSize(7).fillColor(COLORES.textoSuave)
      .text('Informe técnico de registrabilidad, de carácter orientativo. La resolución definitiva sobre la marca compete exclusivamente al INPI.',
        X_MARGEN, yPie + 24, { lineBreak: false, width: ANCHO_CONTENIDO, align: 'left' });
    // Reseteamos el cursor en cada pagina para que ningun text posterior
    // herede doc.y cerca del borde y dispare un addPage espurio.
    doc.x = X_MARGEN;
    doc.y = doc.page.margins.top;
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

      informe._marcaConsultada = cliente.marca;

      dibujarHeader(doc, { cliente });
      dibujarFichaCaso(doc, cliente);
      dibujarMetodologia(doc);
      dibujarVeredicto(doc, informe);
      dibujarComparativas(doc, informe);

      const bloques = informe.cliente?.bloques || [];
      for (const b of bloques) dibujarBloque(doc, b);

      dibujarContextoDigital(doc, contexto);
      dibujarProximosPasos(doc, informe);
      dibujarApendiceLegal(doc, informe);
      dibujarCTAs(doc, cliente);
      dibujarQueImplicaRegistro(doc);
      dibujarPie(doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPDF, COLORES };
