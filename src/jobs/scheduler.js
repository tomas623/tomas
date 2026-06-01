// Scheduler de cron — arranca tasks recurrentes al boot del server.
// Hoy: monitoreo semanal (miércoles 9:00 por default, configurable con CRON_MONITOREO).
// Cualquier task se desactiva con CRON_ENABLED=false (útil en dev/CI).

const cron = require('node-cron');
const audit = require('../audit');
const { correr } = require('./monitoreo-semanal');
const puentePython = require('./puente-python');

const state = { tasks: [] };
const TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

function programar(name, expr, fn) {
  if (!cron.validate(expr)) {
    console.error(`[cron] expresión inválida para ${name}: "${expr}" — NO arrancada.`);
    return;
  }
  const task = cron.schedule(expr, fn, { timezone: TZ });
  state.tasks.push({ name, expr, task });
  console.log(`[cron] ${name} programado · "${expr}" (TZ ${TZ})`);
}

function iniciar() {
  if ((process.env.CRON_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[cron] CRON_ENABLED=false → scheduler desactivado.');
    return state;
  }

  // 1) Monitoreo semanal — default miércoles 9:00.
  programar('monitoreo-semanal', (process.env.CRON_MONITOREO || '0 9 * * 3').trim(), async () => {
    const startedAt = new Date();
    try {
      const r = await correr({ actorId: null });
      console.log(`[cron] monitoreo OK · ${r.alertas} alerta(s) · ${r.candidatos || 0} candidatos`);
      audit.log(null, 'cron.monitoreo', { detalle: { started_at: startedAt.toISOString(), alertas: r.alertas, candidatos: r.candidatos } });
    } catch (err) {
      console.error('[cron] monitoreo ERROR:', err.message);
      audit.log(null, 'cron.monitoreo.error', { detalle: { error: err.message } });
    }
  });

  // 2) Puente Python — sólo si PYTHON_DB_PATH está seteado. Default cada hora.
  if ((process.env.PYTHON_DB_PATH || '').trim()) {
    programar('puente-python', (process.env.CRON_PUENTE_PYTHON || '0 * * * *').trim(), async () => {
      try {
        const r = await puentePython.correr({ notificar: true });
        if (r.nuevos > 0) console.log(`[cron] puente-python: ${r.nuevos} boletín(es) nuevo(s), ${r.actas} actas, ${r.alertas} alerta(s)`);
      } catch (err) {
        console.error('[cron] puente-python ERROR:', err.message);
        audit.log(null, 'cron.puente.error', { detalle: { error: err.message } });
      }
    });
  }

  return state;
}

function estado() {
  return {
    enabled: (process.env.CRON_ENABLED || 'true').toLowerCase() !== 'false',
    tasks: state.tasks.map(t => ({ name: t.name, expr: t.expr })),
  };
}

module.exports = { iniciar, estado };
