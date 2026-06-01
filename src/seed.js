require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { normalizar } = require('./inpi');

const csvPath = process.argv[2] || path.join(__dirname, '..', 'data', 'marcas_seed.csv');

if (!fs.existsSync(csvPath)) {
  console.error(`[seed] No existe el CSV: ${csvPath}`);
  process.exit(1);
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

const raw = fs.readFileSync(csvPath, 'utf8');
const rows = parseCSV(raw).filter(r => r.length > 1);
if (!rows.length) { console.error('[seed] CSV vacío'); process.exit(1); }

const header = rows.shift().map(h => h.trim().toLowerCase());
const idx = name => header.indexOf(name);
const iDen = idx('denominacion'), iClase = idx('clase'),
      iActa = idx('acta'), iTit = idx('titular'), iEstado = idx('estado');

if (iDen < 0 || iClase < 0) {
  console.error('[seed] El CSV debe tener columnas: denominacion,clase,acta,titular,estado');
  process.exit(1);
}

db.exec('DELETE FROM marcas_inpi');
const stmt = db.prepare(`
  INSERT INTO marcas_inpi (denominacion, denominacion_norm, clase, acta, titular, estado)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const tx = db.transaction((batch) => { for (const r of batch) stmt.run(...r); });

const batch = [];
for (const r of rows) {
  const den = (r[iDen] || '').trim();
  const clase = parseInt(r[iClase], 10);
  if (!den || !Number.isFinite(clase)) continue;
  batch.push([
    den,
    normalizar(den),
    clase,
    iActa >= 0 ? (r[iActa] || '').trim() : null,
    iTit >= 0 ? (r[iTit] || '').trim() : null,
    iEstado >= 0 ? (r[iEstado] || '').trim() : 'Concedida',
  ]);
}
tx(batch);
console.log(`[seed] Insertadas ${batch.length} marcas desde ${csvPath}`);
