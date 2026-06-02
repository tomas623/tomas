// Parser de boletines del INPI. Dos formatos:
//   - CSV (recomendado para fixture y para boletines ya pre-parseados a tabla).
//   - PDF (con `pdf-parse`, opcional): extrae texto crudo y aplica un parser
//     heurístico. Los PDFs reales del INPI son tabulares y frágiles —
//     la idea es iterar el regex cuando tengamos un boletín de muestra.
//
// API: parseBoletinFromFile(filepath) → {
//   numero, fecha_publicacion, formato, actas: [{ acta, denominacion, clase, titular, tipo, estado, fecha }]
// }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashFile(filepath) {
  const data = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      field = ''; row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCSVFile(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const rows = parseCSV(raw).filter(r => r.length > 1);
  if (!rows.length) throw new Error('CSV vacío');
  const header = rows.shift().map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const need = ['denominacion', 'clase'];
  for (const n of need) if (idx(n) < 0) throw new Error(`Falta columna requerida: ${n}`);

  // Metadatos opcionales por convención del fixture (líneas tipo "#numero=X").
  let numero = path.basename(filepath, path.extname(filepath));
  let fecha = new Date().toISOString().slice(0, 10);

  const actas = [];
  for (const r of rows) {
    const den = (r[idx('denominacion')] || '').trim();
    if (!den) continue;
    actas.push({
      acta: (r[idx('acta')] || '').trim() || null,
      denominacion: den,
      clase: parseInt(r[idx('clase')], 10) || null,
      titular: (r[idx('titular')] || '').trim() || null,
      tipo: (r[idx('tipo')] || '').trim() || 'denominativa',
      estado: (r[idx('estado')] || '').trim() || 'Solicitada',
      fecha: (r[idx('fecha')] || '').trim() || fecha,
    });
  }
  return { numero, fecha_publicacion: fecha, formato: 'csv', actas };
}

async function parsePDFFile(filepath) {
  // pdf-parse es opcional; si no está instalado avisamos sin romper.
  let pdf;
  try { pdf = require('pdf-parse'); }
  catch { throw new Error('Para ingestar PDFs instalá `pdf-parse`: npm install pdf-parse'); }

  const buf = fs.readFileSync(filepath);
  const data = await pdf(buf);
  const text = data.text || '';

  // Parser heurístico mínimo. Los boletines reales del INPI tienen layout tabular
  // por sección (denominativas / mixtas / figurativas). Sin un PDF real para
  // calibrar, este regex captura el caso más simple: "Acta 1234567 ... Clase 35 ..."
  const actas = [];
  const lineRe = /Acta\s*[N°]?\s*(\d{6,9})\s+([A-ZÁÉÍÓÚÑ0-9 .\-&'/]{2,80}?)\s+Clase\s*(\d{1,2})/gi;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    actas.push({
      acta: m[1].trim(),
      denominacion: m[2].trim(),
      clase: parseInt(m[3], 10),
      titular: null, tipo: 'denominativa', estado: 'Solicitada',
      fecha: new Date().toISOString().slice(0, 10),
    });
  }

  return {
    numero: path.basename(filepath, path.extname(filepath)),
    fecha_publicacion: new Date().toISOString().slice(0, 10),
    formato: 'pdf',
    actas,
    warning: actas.length === 0
      ? 'El parser PDF no extrajo actas. El layout cambió o necesita ajuste. Use CSV o ajuste el regex en src/ingesta/parser.js.'
      : null,
  };
}

async function parseBoletinFromFile(filepath) {
  if (!fs.existsSync(filepath)) throw new Error(`Archivo no existe: ${filepath}`);
  const ext = path.extname(filepath).toLowerCase();
  let parsed;
  if (ext === '.csv') parsed = parseCSVFile(filepath);
  else if (ext === '.pdf') parsed = await parsePDFFile(filepath);
  else throw new Error(`Formato no soportado: ${ext}. Use .csv o .pdf`);
  parsed.archivo = filepath;
  parsed.hash = hashFile(filepath);
  return parsed;
}

module.exports = { parseBoletinFromFile, hashFile };
