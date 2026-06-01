// Scheduler de cron — arranca tasks recurrentes al boot del server.
// Hoy: monitoreo semanal (miércoles 9:00 por default, configurable con CRON_MONITOREO).
// Cualquier task se desactiva con CRON_ENABLED=false (útil en dev/CI).

const cron = require('node-cron');
const audit = require('../audit');
const { correr } = require('./monitoreo-semanal');

const state = { tasks: [] };

function iniciar() {
  if ((process.env.CRON_ENABLED || 'true').toLowerCase() === 'false') {
    console.log('[cron] CRON_ENABLED=false → scheduler desactivado.');
    return state;
  }

  const expr = (process.env.CRON_MONITOREO || '0 9 * * 3').trim(); // miércoles 9:00
  if (!cron.validate(expr)) {
    console.error(`[cron] expresión inválida en CRON_MONITOREO: "${expr}" — scheduler NO arrancado.`);
    return state;
  }

  const task = cron.schedule(expr, async () => {
    const startedAt = new Date();
    try {
      const r = await correr({ actorId: null });
      console.log(`[cron] monitoreo OK · ${r.alertas} alerta(s) · ${r.candidatos || 0} candidatos`);
      audit.log(null, 'cron.monitoreo', {
        detalle: { cron: expr, started_at: startedAt.toISOString(), alertas: r.alertas, candidatos: r.candidatos },
      });
    } catch (err) {
      console.error('[cron] monitoreo ERROR:', err.message);
      audit.log(null, 'cron.monitoreo.error', { detalle: { error: err.message } });
    }
  }, { timezone: process.env.TZ || 'America/Argentina/Buenos_Aires' });

  state.tasks.push({ name: 'monitoreo-semanal', expr, task });
  console.log(`[cron] monitoreo-semanal programado · "${expr}" (TZ ${process.env.TZ || 'America/Argentina/Buenos_Aires'})`);
  return state;
}

function estado() {
  return {
    enabled: (process.env.CRON_ENABLED || 'true').toLowerCase() !== 'false',
    tasks: state.tasks.map(t => ({ name: t.name, expr: t.expr })),
  };
}

module.exports = { iniciar, estado };
