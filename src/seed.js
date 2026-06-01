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

  // Sólo seed inicial de marcas ficticias si la tabla está vacía o muy chica.
  // En producción, con marcas reales ya importadas (npm run import-python),
  // no se borra nada.
  const existentes = db.prepare('SELECT COUNT(*) AS n FROM marcas_inpi').get().n;
  if (existentes > 100) {
    console.log(`[seed] marcas_inpi ya tiene ${existentes.toLocaleString()} filas — salteo carga del CSV fixture.`);
  } else {
    if (existentes > 0) db.exec('DELETE FROM marcas_inpi');
  }
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO marcas_inpi (denominacion, denominacion_norm, clase, acta, titular, estado)
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
  if (existentes <= 100) {
    tx(batch);
    console.log(`[seed] Marcas INPI: ${batch.length} insertadas desde ${path.basename(csvPath)}`);
  }

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

  // ===== 4) Demo: cliente + marca vigilada + alerta para la bandeja =====
  // Idempotente: si ya existe el cliente demo, no duplica nada.
  const demoEmail = 'demo.cliente@legalpacers.com';
  let demo = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(demoEmail);
  if (!demo) {
    const pack10 = db.prepare('SELECT id FROM packs WHERE codigo = ?').get('vigilancia_10');
    const hashDemo = await hashPassword('demo12345');
    const info = db.prepare(`
      INSERT INTO usuarios (email, password_hash, rol, nombre, telefono, pack_id)
      VALUES (?, ?, 'cliente', ?, ?, ?)
    `).run(demoEmail, hashDemo, 'Cliente Demo', '+5491100000000', pack10?.id || null);
    demo = { id: info.lastInsertRowid };

    // Marca vigilada de prueba
    const mv = db.prepare(`
      INSERT INTO marcas_vigiladas (usuario_id, denominacion, denominacion_norm, clases, tipo, estado)
      VALUES (?, 'Focca', 'focca', '[9,42]', 'denominativa', 'activa')
    `).run(demo.id);

    // Boletín ficticio para que las muestras de alerta tengan FK válida
    const boletin = db.prepare(`
      INSERT INTO boletines (numero, fecha_publicacion, archivo, hash, estado, total_actas)
      VALUES ('DEMO-001', date('now'), 'demo-fixture', 'demo-hash-001', 'procesado', 2)
    `).run();

    const mb1 = db.prepare(`
      INSERT INTO marcas_boletin (boletin_id, acta, denominacion, denominacion_norm, clase, titular, tipo, estado, fecha)
      VALUES (?, '4500001', 'FOKKA', 'fokka', 9, 'Otro Titular SRL', 'denominativa', 'Solicitada', date('now'))
    `).run(boletin.lastInsertRowid);
    const mb2 = db.prepare(`
      INSERT INTO marcas_boletin (boletin_id, acta, denominacion, denominacion_norm, clase, titular, tipo, estado, fecha)
      VALUES (?, '4500002', 'FOCA', 'foca', 42, 'Empresa X SA', 'denominativa', 'Solicitada', date('now'))
    `).run(boletin.lastInsertRowid);

    // Alerta + candidatos (con stub de Etapa 2)
    const { analizar } = require('./matching/etapa2');
    const alerta = db.prepare(`
      INSERT INTO alertas (usuario_id, marca_vigilada_id, nivel, notoria, estado, canal, fundamento)
      VALUES (?, ?, 'alto', 0, 'nueva', 'mail+wa', ?)
    `).run(demo.id, mv.lastInsertRowid,
      'Detectamos 2 solicitudes nuevas con alta similitud fonética con "Focca" en clases 9 y 42.');

    const cands = [
      { mb_id: mb1.lastInsertRowid, score: 88, motivo: 'coincidencia_fonetica,misma_clase', denom: 'FOKKA', clase: 9 },
      { mb_id: mb2.lastInsertRowid, score: 72, motivo: 'ortografica_cercana,misma_clase',   denom: 'FOCA',  clase: 42 },
    ];
    for (const c of cands) {
      const ge = await analizar(
        { denominacion: 'Focca', clases: [9, 42] },
        { id: c.mb_id, denominacion: c.denom, clase: c.clase, titular: 'demo', score: c.score, motivos: c.motivo.split(',') },
      );
      db.prepare(`
        INSERT INTO alerta_candidatos (alerta_id, marca_boletin_id, score, motivo, gemini_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(alerta.lastInsertRowid, c.mb_id, c.score, c.motivo, JSON.stringify(ge));
    }
    console.log(`[seed] Demo: cliente ${demoEmail} (pass: demo12345) + 1 marca vigilada + 1 alerta con 2 candidatos.`);
  } else {
    console.log(`[seed] Demo ya existía: ${demoEmail}`);
  }

  console.log('[seed] Listo.');
}

main().catch(err => { console.error('[seed] ERROR:', err); process.exit(1); });
