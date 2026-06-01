#!/usr/bin/env node
// Uso: npm run ingesta -- ./ruta/al/boletin.csv  (o .pdf)
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { ingestar } = require('./ingesta');

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Uso: npm run ingesta -- <archivo.csv|.pdf>');
    console.error('     npm run ingesta -- <carpeta>     (modo batch)');
    process.exit(1);
  }
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) { console.error(`No existe: ${abs}`); process.exit(1); }

  const archivos = fs.statSync(abs).isDirectory()
    ? fs.readdirSync(abs).filter(f => /\.(csv|pdf)$/i.test(f)).map(f => path.join(abs, f))
    : [abs];

  for (const f of archivos) {
    try {
      const r = await ingestar(f);
      if (r.dedup) console.log(`[ingesta] ${path.basename(f)} → ya ingerido (boletin #${r.boletin_id}), saltando.`);
      else console.log(`[ingesta] ${path.basename(f)} → boletin #${r.boletin_id} · ${r.total_actas} actas${r.warning ? '  ⚠ ' + r.warning : ''}`);
    } catch (err) {
      console.error(`[ingesta] ERROR en ${f}:`, err.message);
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
