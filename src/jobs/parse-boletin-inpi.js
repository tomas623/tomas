// Parser de boletines del INPI en Node. Soporta los dos formatos reales:
//
//   1) XLS tabular (.xls / .xlsx) — boletines de CONCEDIDAS, LIMITACIONES,
//      RENUNCIAS, OPOSICIONES. Header en fila 6 (índice 5):
//        Agente | Nº Acta | Clase | Titular | Denominación | Tipo de Trámite | ...
//      Para oposiciones el header es: Oposición | Oponente | Acta | Clase
//      (sin denominación).
//
//   2) PDF con códigos INID — boletín de MARCAS NUEVAS (en trámite). Cada
//      entrada empieza con "(21) Acta XXXX - (51) Clase NN" seguido de
//      "(40) D (54) DENOMINACIÓN", "(73) TITULAR", etc.
//
// Devuelve siempre: { marcas: [{ denominacion, clase, acta, titular, estado, tipo }], meta }
// listo para el importador (import-marcas-inpi.importarFilas).

const XLSX = require('xlsx');

const TIPO_MAP = { D: 'Denominativa', M: 'Mixta', F: 'Figurativa', T: 'Tridimensional', E: 'Especial' };

// Mapea el "Tipo de Trámite" / "Resolución" del XLS y el nombre de hoja a estado.
function estadoDesdeHoja(nombreHoja) {
  const h = (nombreHoja || '').toLowerCase();
  if (h.includes('concedid')) return 'Registrada';
  if (h.includes('renov')) return 'Renovada';
  if (h.includes('limitacion')) return 'Registrada'; // limitación es sobre una concedida
  if (h.includes('renuncia')) return 'Renunciada';
  if (h.includes('opos')) return 'Oposición';
  if (h.includes('deneg')) return 'Denegada';
  if (h.includes('caduc')) return 'Caducada';
  if (h.includes('abandon')) return 'Abandonada';
  return 'Registrada';
}

// ===== Parser XLS tabular =====
function parseXLS(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const marcas = [];
  let hojasProcesadas = [];

  for (const nombreHoja of wb.SheetNames) {
    const sh = wb.Sheets[nombreHoja];
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '' });
    if (!rows.length) continue;

    // Buscar la fila de header (la que tiene "Acta" y "Clase" o "Denominación").
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const fila = rows[i].map(c => String(c).trim().toLowerCase());
      const tieneActa = fila.some(c => c.includes('acta'));
      const tieneClase = fila.some(c => c === 'clase');
      if (tieneActa && tieneClase) { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;

    const header = rows[headerIdx].map(c => String(c).trim().toLowerCase());
    const col = (...names) => {
      for (const n of names) {
        const i = header.findIndex(h => h === n || h.includes(n));
        if (i >= 0) return i;
      }
      return -1;
    };
    const iActa = col('nº acta', 'n° de acta', 'acta');
    const iClase = col('clase');
    const iTit = col('titular', 'oponente');
    const iDen = col('denominación', 'denominacion');
    const estadoHoja = estadoDesdeHoja(nombreHoja);
    const esOposicion = nombreHoja.toLowerCase().includes('opos');

    // Si la hoja NO tiene columna de denominación y NO es de oposiciones, la
    // salteamos. Esto evita que hojas como LIMITACIONES / RENUNCIAS (que solo
    // listan acta + producto, sin denominación) pisen con placeholders las
    // denominaciones reales que ya tienen esas actas en CONCEDIDAS.
    if (iDen < 0 && !esOposicion) continue;

    let cuenta = 0;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const fila = rows[r];
      const actaRaw = iActa >= 0 ? String(fila[iActa] || '').trim() : '';
      const claseRaw = iClase >= 0 ? String(fila[iClase] || '').trim() : '';
      const acta = actaRaw.replace(/\.0$/, '').replace(/[^\d]/g, '') || null;
      const clase = parseInt(claseRaw.replace(/\.0$/, ''), 10);
      if (!acta || !Number.isInteger(clase) || clase < 1 || clase > 45) continue;

      const den = iDen >= 0 ? String(fila[iDen] || '').trim() : '';
      // La hoja de oposiciones no tiene denominación; usamos placeholder con acta.
      const denominacion = den || `[Acta ${acta}]`;
      const titular = iTit >= 0 ? String(fila[iTit] || '').trim() || null : null;

      marcas.push({ denominacion, clase, acta, titular, estado: estadoHoja, tipo: null });
      cuenta++;
    }
    if (cuenta > 0) hojasProcesadas.push(`${nombreHoja} (${cuenta})`);
  }

  return { marcas, meta: { formato: 'xls', hojas: hojasProcesadas } };
}

// ===== Parser PDF INID (marcas nuevas / en trámite) =====
// Cada entrada: "(21) Acta 4664620 - (51) Clase 8" ... "(40) D (54) BERTONCINI" ...
// "(73) HIGINIO BERTONCINI Y CÍA. S.A. - AR *"
const RE_ENTRY = /\(21\)\s*Acta\s+([\d.,\s]{5,20}?)\s*-\s*\(51\)\s*Clase\s*(\d{1,2})/gi;
const RE_TYPE_NAME = /\(40\)\s*([A-Z])\s+\(54\)\s*([^\n(]*)/i;
const RE_OWNER = /\(73\)\s*(.+?)(?:\s+-\s*[A-Z]{2,3}\s*\*|\s*\*)/;

async function parsePDF(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const data = await parser.getText();
  const text = data.text || '';

  // Detectar si la sección dominante es "marcas nuevas" → en trámite.
  const lower = text.toLowerCase();
  let estado = 'Solicitud publicada';
  if (lower.includes('marcas registradas') || lower.includes('registro otorgado')) estado = 'Registrada';
  if (lower.includes('renovacion')) estado = 'Renovada';

  const marcas = [];
  const matches = [...text.matchAll(RE_ENTRY)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const chunkEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const chunk = text.slice(m.index, chunkEnd);

    const acta = m[1].trim().replace(/[\s,]/g, '').replace(/\.0$/, '').replace(/[^\d]/g, '');
    const clase = parseInt(m[2], 10);
    if (!acta || !Number.isInteger(clase) || clase < 1 || clase > 45) continue;

    let denominacion = '';
    let tipoCode = null;
    const mt = RE_TYPE_NAME.exec(chunk);
    if (mt) { tipoCode = mt[1].toUpperCase(); denominacion = (mt[2] || '').trim(); }
    if (!denominacion) {
      denominacion = tipoCode === 'F' ? `[Figurativa] ${acta}` : `[Acta ${acta}]`;
    }
    let titular = null;
    const mo = RE_OWNER.exec(chunk);
    if (mo) titular = mo[1].trim().slice(0, 300);

    marcas.push({
      denominacion: denominacion.slice(0, 300),
      clase, acta, titular, estado,
      tipo: tipoCode ? (TIPO_MAP[tipoCode] || null) : null,
    });
  }

  return { marcas, meta: { formato: 'pdf', paginas: data.total } };
}

// ===== Dispatcher por tipo de archivo =====
async function parseBoletinBuffer(buffer, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (ext === 'xls' || ext === 'xlsx') return parseXLS(buffer);
  if (ext === 'pdf') return parsePDF(buffer);
  // Heurística por magic bytes si no hay extensión confiable.
  if (buffer.slice(0, 4).toString() === '%PDF') return parsePDF(buffer);
  return parseXLS(buffer); // SheetJS también lee xls/xlsx/csv.
}

module.exports = { parseBoletinBuffer, parseXLS, parsePDF };
