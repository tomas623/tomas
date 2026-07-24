// Genera el Poder Especial para el registro de marca ante el INPI, a partir de
// los datos que carga el cliente en el formulario de onboarding. El texto es el
// modelo del estudio (apoderado fijo: Tomás Guido Rodriguez, Mat. 3457); solo
// varían los datos del/los otorgante(s), la fecha y el lugar.

const PDFDocument = require('pdfkit');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function domicilioTxt(dom) {
  if (!dom) return '—';
  const partes = [
    dom.calle,
    dom.ciudad,
    dom.provincia ? `Provincia de ${dom.provincia}` : null,
    dom.cp ? `CP ${dom.cp}` : null,
  ].filter(Boolean);
  return partes.join(', ');
}

// Frase de presentación de cada otorgante en el encabezado del poder.
function frasePresentacion(t) {
  if (t.tipo === 'juridica') {
    const dni = t.representante_dni ? `, DNI ${t.representante_dni}` : '';
    return `${(t.razon_social || '').toUpperCase()}, CUIT ${t.cuit || '—'}, con domicilio en `
      + `${domicilioTxt(t.domicilio)}, representada en este acto por ${t.representante || '—'}${dni} `
      + `en su carácter de ${t.cargo || 'representante legal'}`;
  }
  return `${(t.nombre || '').toUpperCase()}, argentino/a, DNI ${t.dni || '—'}, con domicilio en `
    + `${domicilioTxt(t.domicilio)}`;
}

/**
 * @param {object} datos - registro_datos del lead (titulares, marca, etc.)
 * @param {object} [opts] - { fecha: Date, lugar: string }
 * @returns {Promise<Buffer>}
 */
function generarPoder(datos, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const tits = (datos && datos.titulares) || [];
      const fecha = opts.fecha || new Date();
      // Lugar de otorgamiento: por convención del estudio es su sede (San Isidro),
      // no el domicilio del cliente. Configurable con PODER_LUGAR.
      const lugar = opts.lugar || process.env.PODER_LUGAR || 'San Isidro, Provincia de Buenos Aires';

      const varios = tits.length > 1;
      const dice = varios ? 'dicen' : 'dice';
      const confiere = varios ? 'damos y conferimos' : 'doy y confiero';
      const enNombre = varios ? 'nuestro nombre y representación' : 'su nombre y representación';
      const faculta = varios ? 'facultamos' : 'faculto';
      const otorgantes = tits.map(frasePresentacion).join('; y por la otra ');

      const doc = new PDFDocument({ size: 'A4', margins: { top: 85, bottom: 85, left: 78, right: 78 } });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.font('Times-Bold').fontSize(15).text('PODER ESPECIAL', { align: 'center', characterSpacing: 1 });
      doc.moveDown(2.2);

      doc.font('Times-Roman').fontSize(12);
      const P = { align: 'justify', lineGap: 4.5 };
      doc.text(`En ${lugar}, a los ${fecha.getDate()} días del mes de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}, ${otorgantes}, ${dice}:`, P);
      doc.moveDown(1);
      doc.text(`Que ${confiere} poder especial en favor del Sr. TOMÁS GUIDO RODRIGUEZ, abogado, DNI 35.605.840, Agente de la Propiedad Industrial Matrícula N° 3457, para que en ${enNombre}, ya sea conjunta, separada o alternativamente realice las diligencias necesarias ante el INPI (Instituto Nacional de Propiedad Intelectual) a fin de lograr el registro de la/s marca/s solicitada/s.-`, P);
      doc.moveDown(1);
      doc.text(`Al efecto, ${faculta} al Sr. Tomás Guido Rodriguez para que se presente ante las autoridades correspondientes, con los medios y acciones que considere pertinentes, como así también constituir domicilio electrónico y recibir las notificaciones que allí se deriven.-`, P);

      doc.moveDown(5);
      // Espacios de firma, uno por otorgante.
      tits.forEach((t) => {
        doc.font('Times-Roman').fontSize(12).text('___________________________________', { align: 'left' });
        const linea = t.tipo === 'juridica'
          ? `${t.representante || ''}${t.razon_social ? ' — ' + t.razon_social : ''}`
          : (t.nombre || '');
        const doc2 = t.tipo === 'juridica' ? `CUIT ${t.cuit || ''}` : `DNI ${t.dni || ''}`;
        doc.text(linea);
        doc.text(doc2);
        doc.moveDown(2.5);
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPoder };
