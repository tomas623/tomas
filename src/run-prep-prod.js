#!/usr/bin/env node
// Prepara la DB para producción:
//   1) Chequea que las envs críticas estén seteadas y no sean valores default.
//   2) Borra los datos demo (cliente, marca vigilada, alertas, boletín ficticio).
//   3) Crea/actualiza el admin real con SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD.
//
// Uso (después de tener .env de producción):
//   node src/run-prep-prod.js
//   node src/run-prep-prod.js --force      (sin prompt)

require('dotenv').config();
const readline = require('readline');
const db = require('./db');
const { hashPassword } = require('./auth');
const audit = require('./audit');

const FORCE = process.argv.includes('--force');
const errores = [];
const warnings = [];

function checkEnv(name, opts = {}) {
  const v = (process.env[name] || '').trim();
  if (!v) {
    if (opts.required) errores.push(`Falta ${name}`);
    else warnings.push(`${name} vacío (queda en modo stub)`);
    return null;
  }
  if (opts.minLength && v.length < opts.minLength) {
    errores.push(`${name} es demasiado corto (mínimo ${opts.minLength} caracteres)`);
  }
  if (opts.notDefault && opts.notDefault.includes(v)) {
    errores.push(`${name} tiene valor default inseguro ("${v}")`);
  }
  return v;
}

async function confirmar(pregunta) {
  if (FORCE) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${pregunta} (y/N): `, ans => { rl.close(); r(/^y/i.test(ans)); }));
}

async function main() {
  console.log('=== Preparación para producción ===\n');

  // 1) Validar envs
  checkEnv('SESSION_SECRET', { required: true, minLength: 24, notDefault: ['dev-session-secret-cambiame', 'test'] });
  checkEnv('BASE_URL',       { required: true, notDefault: ['http://localhost:3000'] });
  checkEnv('SEED_ADMIN_EMAIL',    { required: true, notDefault: ['admin@legalpacers.com'] });
  checkEnv('SEED_ADMIN_PASSWORD', { required: true, minLength: 12, notDefault: ['admin12345'] });
  checkEnv('ADMIN_TOKEN', { required: true, minLength: 16 });

  // Opcionales (warning si vacíos):
  checkEnv('MP_ACCESS_TOKEN');
  checkEnv('GEMINI_API_KEY');
  checkEnv('RESEND_API_KEY');
  checkEnv('WA_TOKEN');

  if (errores.length) {
    console.error('✗ Errores que tenés que resolver antes de seguir:');
    for (const e of errores) console.error('  · ' + e);
    process.exit(1);
  }
  if (warnings.length) {
    console.log('⚠ Avisos (no bloquean, dejan piezas en stub):');
    for (const w of warnings) console.log('  · ' + w);
    console.log('');
  }

  // 2) Borrar datos demo
  const demo = db.prepare("SELECT id FROM usuarios WHERE email = 'demo.cliente@legalpacers.com'").get();
  const adminDefault = db.prepare("SELECT id FROM usuarios WHERE email = 'admin@legalpacers.com'").get();
  const fixtureBoletin = db.prepare("SELECT id FROM boletines WHERE archivo IN ('demo-fixture', './data/boletin-fixture.csv')").all();
  const fixtureMarcas = db.prepare("SELECT id FROM marcas_inpi WHERE titular LIKE '%demo%' OR titular IN ('Acme Holdings SA','Acme Foods SRL','Acme Hospitality SA','Focca Tech SAS','Editorial Verbum SRL','Nimbus Cloud SA','Cosmética Luminosa SRL','Brio Indumentaria SRL','Café Terranova SA','Novara Moda SRL','Solara Software SAS','Kairos Educación SRL','Helios Iluminación SA','Zenit Telecom SA','Aurora Cosmética SRL','Atenea Legal SRL','Phoenix Software SA')").all();

  console.log('Voy a borrar:');
  console.log(`  · usuario demo: ${demo ? 'sí' : 'no'}`);
  console.log(`  · admin default (admin@legalpacers.com): ${adminDefault ? 'sí' : 'no, ya no estaba'}`);
  console.log(`  · boletines fixture: ${fixtureBoletin.length}`);
  console.log(`  · marcas INPI ficticias (seed CSV): ${fixtureMarcas.length}`);
  if (!await confirmar('¿Continúo con el borrado?')) {
    console.log('Abortado.'); process.exit(0);
  }

  const tx = db.transaction(() => {
    if (demo) db.prepare('DELETE FROM usuarios WHERE id = ?').run(demo.id);
    if (adminDefault && adminDefault.id !== demo?.id) db.prepare('DELETE FROM usuarios WHERE id = ?').run(adminDefault.id);
    for (const b of fixtureBoletin) db.prepare('DELETE FROM boletines WHERE id = ?').run(b.id);
    for (const m of fixtureMarcas) db.prepare('DELETE FROM marcas_inpi WHERE id = ?').run(m.id);
  });
  tx();

  // 3) Sembrar admin real (idempotente).
  const email = process.env.SEED_ADMIN_EMAIL.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (!existing) {
    const hash = await hashPassword(process.env.SEED_ADMIN_PASSWORD);
    db.prepare(`INSERT INTO usuarios (email, password_hash, rol, nombre) VALUES (?, ?, 'admin', ?)`)
      .run(email, hash, 'Admin');
    console.log(`✓ Admin real creado: ${email}`);
  } else {
    // Actualizar el password (por si el usuario lo cambió en .env)
    const hash = await hashPassword(process.env.SEED_ADMIN_PASSWORD);
    db.prepare('UPDATE usuarios SET password_hash = ?, rol = ?, activo = 1 WHERE id = ?').run(hash, 'admin', existing.id);
    console.log(`✓ Admin real ya existía: ${email} (password actualizado)`);
  }

  audit.log(null, 'sistema.prep-prod', { detalle: { borrados: { demo: !!demo, fixtureBoletin: fixtureBoletin.length, fixtureMarcas: fixtureMarcas.length } } });

  console.log('\n✓ Listo. La DB está limpia para producción.');
  console.log('  Ahora podés correr: npm start');
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
