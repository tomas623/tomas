// Diagnóstico del pipeline de monitoreo. Corrélo en Railway con:
//   node src/diagnostico-monitoreo.js
//
// Recorre cada eslabón (marcas vigiladas → boletines locales → marcas_boletin →
// corridas del monitoreo → alertas) y hace un test de matching EN VIVO sobre los
// datos reales, para pinpointear por qué no hay coincidencias.

const db = require('./db');
const { matching } = require('./matching/etapa1');
const { nivelDesdeScore } = require('./matching/etapa2');

const line = (t = '') => console.log(t);
line('===== DIAGNÓSTICO DEL MONITOREO =====\n');

// 1) Marcas vigiladas
const mvAct = db.prepare("SELECT COUNT(*) n FROM marcas_vigiladas WHERE estado='activa'").get().n;
const mvTot = db.prepare("SELECT COUNT(*) n FROM marcas_vigiladas").get().n;
line(`1) Marcas vigiladas: ${mvTot} total · ${mvAct} activas`);
if (!mvAct) line('   ⚠ No hay marcas activas → el monitoreo no tiene qué vigilar.');

// 2) Boletines LOCALES (la tabla que lee el monitoreo, distinta de marcas_inpi)
const bTot = db.prepare("SELECT COUNT(*) n FROM boletines").get().n;
const bProc = db.prepare("SELECT COUNT(*) n FROM boletines WHERE estado='procesado'").get().n;
const bInpi = db.prepare("SELECT COUNT(*) n FROM boletines WHERE archivo LIKE 'inpi_%'").get().n;
line(`\n2) Boletines locales: ${bTot} total · ${bProc} procesados · ${bInpi} del catch-up INPI`);
const ult = db.prepare("SELECT id,numero,archivo,estado,total_actas,created_at FROM boletines ORDER BY id DESC LIMIT 8").all();
line('   Últimos 8 boletines:');
ult.forEach(b => line(`     #${b.id} num=${b.numero} ${(b.archivo||'').slice(0,32)} estado=${b.estado} actas=${b.total_actas} (${b.created_at})`));
if (!bInpi) line('   ⚠ CERO boletines del catch-up INPI en la tabla local → hay que RE-CORRER el catch-up para backfillear marcas_boletin.');

// 3) marcas_boletin (las actas que se cruzan)
const mbTot = db.prepare("SELECT COUNT(*) n FROM marcas_boletin").get().n;
const mb20 = db.prepare(`
  SELECT COUNT(*) n FROM marcas_boletin
  WHERE boletin_id IN (SELECT id FROM boletines WHERE estado='procesado' ORDER BY id DESC LIMIT 20)
`).get().n;
line(`\n3) Filas marcas_boletin: ${mbTot} total · ${mb20} en los últimos 20 boletines (lo que escanea el monitoreo)`);
if (!mb20) line('   ⚠ No hay actas para cruzar en los boletines recientes → nunca va a haber coincidencias.');

// 4) ¿Corrió el monitoreo?
const runs = db.prepare(`
  SELECT accion, created_at, detalle FROM audit_log
  WHERE accion IN ('cron.monitoreo','monitoreo.run') ORDER BY id DESC LIMIT 5
`).all();
line('\n4) Últimas corridas del monitoreo:');
if (!runs.length) line('   ⚠ NINGUNA — el monitoreo nunca se ejecutó. Corré "Correr monitoreo ahora" en el panel.');
runs.forEach(r => line(`     ${r.accion} · ${r.created_at} → ${r.detalle || ''}`));

// 5) Alertas por estado
const al = db.prepare("SELECT estado, COUNT(*) n FROM alertas GROUP BY estado").all();
line('\n5) Alertas por estado: ' + (al.length ? al.map(a => `${a.estado}:${a.n}`).join(' · ') : 'ninguna'));

// 6) TEST DE MATCHING EN VIVO — 8 marcas vigiladas contra los últimos boletines
const actas = db.prepare(`
  SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado
  FROM marcas_boletin
  WHERE boletin_id IN (SELECT id FROM boletines WHERE estado='procesado' ORDER BY id DESC LIMIT 20)
`).all();
line(`\n6) Test de matching en vivo (contra ${actas.length} actas de los últimos 20 boletines):`);
if (!actas.length) {
  line('   (sin actas para probar — resolvé el paso 2/3 primero)');
} else {
  const muestra = db.prepare("SELECT denominacion, clases FROM marcas_vigiladas WHERE estado='activa' LIMIT 8").all();
  for (const m of muestra) {
    let clases = []; try { clases = JSON.parse(m.clases || '[]'); } catch {}
    // minScore bajo (40) para ver TODO lo que se acerca, aunque el monitoreo real use 55.
    const res = matching(m.denominacion, clases[0] || null, actas, { minScore: 40 });
    const arriba55 = res.filter(c => c.score >= 55).length;
    const generanAlerta = res.filter(c => nivelDesdeScore(c.score) !== 'bajo').length; // score>=60
    line(`   "${m.denominacion}" (cl ${clases.join(',') || '-'}) → ${res.length} ≥40 · ${arriba55} ≥55 · ${generanAlerta} generarían alerta (≥60)`);
    res.slice(0, 3).forEach(c => line(`       ${c.score} [${nivelDesdeScore(c.score)}] ${c.denominacion} (cl ${c.clase}) {${(c.motivos||[]).join(',')}}`));
  }
}

// 7) Config relevante
line('\n7) Config:');
line(`   GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? 'seteada (Gemini decide el nivel)' : 'NO seteada (usa stub por score)'}`);
line(`   MONITOREO_BOLETINES: ${process.env.MONITOREO_BOLETINES || '20 (default)'}`);
line('\n===== FIN =====');
