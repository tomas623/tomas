// Scheduler de cron — arranca tasks recurrentes al boot del server.
// Hoy: monitoreo semanal (miércoles 9:00 por default, configurable con CRON_MONITOREO).
// Cualquier task se desactiva con CRON_ENABLED=false (útil en dev/CI).

const cron = require('node-cron');
const audit = require('../audit');
const { correr } = require('./monitoreo-semanal');
const followUp = require('./follow-up');
const puentePython = require('./puente-python');
const avisoAjuste = require('./aviso-ajuste-trimestral');
const syncInpi = require('./sync-inpi');

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

  // 2) Follow-up diario — recordatorios a leads tibios sin pagar/contactar.
  // Default 10:00 hora local; se desactiva con CRON_FOLLOWUP_ENABLED=false.
  if ((process.env.CRON_FOLLOWUP_ENABLED || 'true').toLowerCase() !== 'false') {
    programar('follow-up', (process.env.CRON_FOLLOWUP || '0 10 * * *').trim(), async () => {
      try {
        const s = await followUp.correr({});
        if (s.total > 0) console.log(`[cron] follow-up: ${s.total} mail(s) enviados`);
      } catch (err) {
        console.error('[cron] follow-up ERROR:', err.message);
        audit.log(null, 'cron.follow_up.error', { detalle: { error: err.message } });
      }
    });
  }

  // 3) Aviso de ajuste de precios — trimestral.
  // Default: 9:00 del día 1 de febrero, mayo, agosto y noviembre.
  // Manda mail al equipo legal con el detalle de planes mensuales y suscriptos
  // afectados. NO sube precios automáticamente: el equipo edita en MP y dispara
  // el comunicado masivo desde el panel admin cuando esté listo.
  if ((process.env.CRON_AVISO_AJUSTE_ENABLED || 'true').toLowerCase() !== 'false') {
    programar('aviso-ajuste-trimestral', (process.env.CRON_AVISO_AJUSTE || '0 9 1 2,5,8,11 *').trim(), async () => {
      try {
        const s = await avisoAjuste.correr({});
        console.log(`[cron] aviso-ajuste: ${s.ok ? 'OK' : 'FAIL'} · ${s.suscriptos} suscriptos`);
      } catch (err) {
        console.error('[cron] aviso-ajuste ERROR:', err.message);
        audit.log(null, 'cron.aviso_ajuste.error', { detalle: { error: err.message } });
      }
    });
  }

  // 4) Sync INPI — sólo si INPI_DUMP_URL está seteada. Default jueves 7:00.
  // Descarga el dump fresco del INPI y lo mergea en marcas_inpi (UPSERT).
  if ((process.env.INPI_DUMP_URL || '').trim()) {
    programar('sync-inpi', (process.env.CRON_SYNC_INPI || '0 7 * * 4').trim(), async () => {
      try {
        const r = await syncInpi.correr();
        if (r.ok) console.log(`[cron] sync-inpi: nuevas=${r.stats.nuevas} actualizadas=${r.stats.actualizadas}`);
        else console.error('[cron] sync-inpi FAIL:', r.error || r.motivo);
      } catch (err) {
        console.error('[cron] sync-inpi ERROR:', err.message);
        audit.log(null, 'cron.sync_inpi.error', { detalle: { error: err.message } });
      }
    });
  }

  // 5) Puente Python — sólo si PYTHON_DB_PATH está seteado. Default cada hora.
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
