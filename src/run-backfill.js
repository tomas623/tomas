#!/usr/bin/env node
// Backfill: corre el monitoreo retroactivo sobre los últimos N boletines reales,
// SIN notificar (para no spamear con alertas históricas). Útil después de un
// import masivo.
//
// Uso: npm run backfill            (últimos 8 boletines)
//      npm run backfill -- --n 20

require('dotenv').config();
const db = require('./db');
const { correr } = require('./jobs/monitoreo-semanal');

async function main() {
  const args = process.argv.slice(2);
  let n = 8;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--n' || args[i] === '-n') n = parseInt(args[++i], 10);
  }

  const ultimos = db.prepare(`
    SELECT id, numero FROM boletines
    WHERE estado = 'procesado' AND total_actas > 0
    ORDER BY id DESC LIMIT ?
  `).all(n);
  if (!ultimos.length) { console.log('[backfill] No hay boletines con actas.'); return; }

  console.log(`[backfill] Corriendo monitoreo sobre ${ultimos.length} boletín(es), sin notificar…`);
  let totalAlertas = 0, totalCand = 0;
  for (const b of ultimos.reverse()) {
    const r = await correr({ boletinId: b.id, notificar: false });
    console.log(`  · boletín ${b.numero} (id ${b.id}) → ${r.alertas} alerta(s), ${r.candidatos || 0} candidato(s)`);
    totalAlertas += r.alertas;
    totalCand += r.candidatos || 0;
  }
  console.log(`[backfill] Total: ${totalAlertas} alerta(s), ${totalCand} candidato(s) evaluados.`);
}
main().catch(err => { console.error(err); process.exit(1); });
