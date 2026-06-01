require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { normalizar } = require('./matching/etapa1');
const { hashPassword } = require('./auth');

const csvPath = process.argv[2] || path.join(__dirname, '..', 'data', 'marcas_seed.csv');

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

async function main() {
  // ===== 1) Marcas INPI desde CSV =====
  if (!fs.existsSync(csvPath)) {
    console.error(`[seed] No existe el CSV: ${csvPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(raw).filter(r => r.length > 1);
  const header = rows.shift().map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const iDen = idx('denominacion'), iClase = idx('clase'),
        iActa = idx('acta'), iTit = idx('titular'), iEstado = idx('estado');
  if (iDen < 0 || iClase < 0) {
    console.error('[seed] CSV debe tener columnas: denominacion,clase,acta,titular,estado');
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
      den, normalizar(den), clase,
      iActa >= 0 ? (r[iActa] || '').trim() : null,
      iTit >= 0 ? (r[iTit] || '').trim() : null,
      iEstado >= 0 ? (r[iEstado] || '').trim() : 'Concedida',
    ]);
  }
  tx(batch);
  console.log(`[seed] Marcas INPI: ${batch.length} insertadas desde ${path.basename(csvPath)}`);

  // ===== 2) Packs de vigilancia (BUILD_SPEC_MOTOR §1) =====
  const packs = [
    { codigo: 'vigilancia_3',  nombre: 'Vigilancia 3 marcas',     cupo_marcas: 3,  precio_mensual: 4900 },
    { codigo: 'vigilancia_10', nombre: 'Vigilancia 10 marcas',    cupo_marcas: 10, precio_mensual: 12900 },
    { codigo: 'vigilancia_20', nombre: 'Vigilancia hasta 20',     cupo_marcas: 20, precio_mensual: 19900 },
  ];
  const upsert = db.prepare(`
    INSERT INTO packs (codigo, nombre, cupo_marcas, precio_mensual) VALUES (?, ?, ?, ?)
    ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre, cupo_marcas=excluded.cupo_marcas, precio_mensual=excluded.precio_mensual
  `);
  for (const p of packs) upsert.run(p.codigo, p.nombre, p.cupo_marcas, p.precio_mensual);
  console.log(`[seed] Packs: ${packs.length} (vigilancia_3 / vigilancia_10 / vigilancia_20)`);

  // ===== 3) Usuario admin de prueba (idempotente) =====
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@legalpacers.com').toLowerCase();
  const adminPass  = process.env.SEED_ADMIN_PASSWORD || 'admin12345';
  const exists = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(adminEmail);
  if (!exists) {
    const hash = await hashPassword(adminPass);
    db.prepare(`INSERT INTO usuarios (email, password_hash, rol, nombre) VALUES (?, ?, 'admin', ?)`)
      .run(adminEmail, hash, 'Admin LegalPacers');
    console.log(`[seed] Admin creado: ${adminEmail} / ${adminPass}  (cambialo con SEED_ADMIN_PASSWORD en .env)`);
  } else {
    console.log(`[seed] Admin ya existía: ${adminEmail}`);
  }

  console.log('[seed] Listo.');
}

main().catch(err => { console.error('[seed] ERROR:', err); process.exit(1); });
