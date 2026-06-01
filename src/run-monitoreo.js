#!/usr/bin/env node
// Uso: npm run monitoreo  (corre sobre el último boletín procesado)
//      npm run monitoreo -- --boletin 3
//      npm run monitoreo -- --no-notify
require('dotenv').config();
const { correr } = require('./jobs/monitoreo-semanal');

async function main() {
  const args = process.argv.slice(2);
  let boletinId = null, notificar = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--boletin' || args[i] === '-b') boletinId = parseInt(args[++i], 10);
    if (args[i] === '--no-notify') notificar = false;
  }
  const r = await correr({ boletinId, notificar });
  console.log(`[monitoreo] ${r.alertas} alerta(s) creada(s) · ${r.candidatos || 0} candidato(s) evaluados · boletines: ${(r.boletines || []).map(b => b.id).join(',') || '—'}`);
  if (r.mensaje) console.log(`[monitoreo] ${r.mensaje}`);
}
main().catch(err => { console.error(err); process.exit(1); });
