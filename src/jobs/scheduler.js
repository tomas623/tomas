// Scheduler de cron — arranca tasks recurrentes al boot del server.
// Ciclo semanal del INPI: catch-up miércoles 12:00 (baja boletines nuevos) →
// monitoreo miércoles 12:30 (cruza marcas y crea alertas pendientes de revisión).
// El equipo revisa/aprueba la tarde del miércoles y el cliente recibe cuando se
// aprueba. Cualquier task se desactiva con CRON_ENABLED=false (útil en dev/CI).

const cron = require('node-cron');
const audit = require('../audit');
const { correr, avisarPendientes } = require('./monitoreo-semanal');
const followUp = require('./follow-up');
const puentePython = require('./puente-python');
const avisoAjuste = require('./aviso-ajuste-trimestral');
const syncInpi = require('./sync-inpi');
const catchUpInpi = require('./catch-up-inpi');
const backupDb = require('./backup-db');
const avisoHitos = require('./aviso-hitos-legales');

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

  // 1) Monitoreo semanal — default miércoles 12:30, DESPUÉS del catch-up del INPI
  // (miércoles 12:00). Primero bajamos los boletines nuevos, después cruzamos las
  // marcas vigiladas contra lo nuevo. Así el equipo tiene toda la tarde del
  // miércoles para revisar las alertas pendientes y aprobar/descartar antes de
  // que le lleguen al cliente.
  programar('monitoreo-semanal', (process.env.CRON_MONITOREO || '30 12 * * 3').trim(), async () => {
    const startedAt = new Date();
    try {
      const r = await correr({ actorId: null });
      console.log(`[cron] monitoreo OK · ${r.alertas} alerta(s) · ${r.candidatos || 0} candidatos`);
      audit.log(null, 'cron.monitoreo', { detalle: { started_at: startedAt.toISOString(), alertas: r.alertas, candidatos: r.candidatos } });
      // Avisamos al equipo por mail si quedaron alertas pendientes de revisión.
      try {
        const aviso = await avisarPendientes();
        if (aviso.enviado) console.log(`[cron] aviso de ${aviso.total} alerta(s) pendiente(s) enviado al equipo`);
      } catch (e) {
        console.error('[cron] aviso pendientes ERROR:', e.message);
      }
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

  // 4a) Catch-up automático del INPI — los miércoles a las 12:00 hora local.
  // Busca boletines nuevos en ambas series desde el último importado y los
  // procesa. Corre justo antes del monitoreo (12:30) para que el equipo tenga
  // la tarde del miércoles para revisar. Se desactiva con CRON_INPI_CATCHUP_ENABLED=false.
  if ((process.env.CRON_INPI_CATCHUP_ENABLED || 'true').toLowerCase() !== 'false') {
    programar('inpi-catch-up', (process.env.CRON_INPI_CATCHUP || '0 12 * * 3').trim(), async () => {
      try {
        const r = await catchUpInpi.correr({});
        const s = r.series.map(x => `${x.serie}:${x.ok}ok/${x.no_existe}no/${x.error}err`).join(' · ');
        console.log(`[cron] inpi-catch-up: nuevas=${r.total_nuevas} actualizadas=${r.total_actualizadas} · ${s}`);
        // Avisa al equipo legal si hubo errores o varias semanas sin novedades.
        const aviso = await catchUpInpi.notificarResultadoCron(r);
        if (aviso.notificado) console.log(`[cron] inpi-catch-up: alerta enviada (${aviso.motivos.join('; ')})`);
      } catch (err) {
        console.error('[cron] inpi-catch-up ERROR:', err.message);
        audit.log(null, 'cron.inpi_catch_up.error', { detalle: { error: err.message } });
        // El crash total del cron también es algo que el equipo debe saber.
        try {
          const { enviarMailGenerico } = require('../notificaciones');
          await enviarMailGenerico({
            to: (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim(),
            subject: '⚠ El cron de sincronización del INPI falló',
            html: `<div style="font-family:system-ui,sans-serif;color:#0f1f3d">
              <h2 style="color:#dc2626">El cron inpi-catch-up falló</h2>
              <p>La actualización automática del jueves se cortó con un error:</p>
              <pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:12px">${String(err.message).slice(0, 500)}</pre>
              <p style="font-size:13px">Revisá los logs de Railway y reintentá desde el panel admin → Boletines.</p>
            </div>`,
            tag: 'sync_inpi_crash',
          });
        } catch {}
      }
    });
  }

  // 4b) Sync INPI legacy (URL externa) — sólo si INPI_DUMP_URL está seteada.
  // Permite usar una fuente alternativa (un proveedor de datos pago, p.ej.)
  // sin pisar el catch-up directo del INPI.
  if ((process.env.INPI_DUMP_URL || '').trim()) {
    programar('sync-inpi', (process.env.CRON_SYNC_INPI || '30 7 * * 4').trim(), async () => {
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

  // 6) Backup diario de la DB — default 3:00 AM hora local.
  // Snapshot consistente + gzip + rotación (BACKUP_RETENCION, default 7).
  if ((process.env.CRON_BACKUP_ENABLED || 'true').toLowerCase() !== 'false') {
    programar('backup-db', (process.env.CRON_BACKUP || '0 3 * * *').trim(), async () => {
      try {
        const r = await backupDb.crear({});
        if (!r.ok) {
          console.error('[cron] backup-db FAIL:', r.error);
          const { enviarMailGenerico } = require('../notificaciones');
          await enviarMailGenerico({
            to: (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim(),
            subject: '⚠ El backup diario de la base falló',
            html: `<div style="font-family:system-ui,sans-serif;color:#0f1f3d">
              <h2 style="color:#dc2626">Backup diario falló</h2>
              <pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:12px">${String(r.error).slice(0, 500)}</pre>
            </div>`,
            tag: 'backup_fallo',
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[cron] backup-db ERROR:', err.message);
        audit.log(null, 'cron.backup.error', { detalle: { error: err.message } });
      }
    });
  }

  // 7) Aviso de hitos legales — default lunes 8:00 hora local.
  // Manda un mail al equipo con las DJU/renovaciones que vencen dentro de la
  // ventana (HITOS_DIAS_AVISO, default 90 días) o ya vencidas. Si no hay nada,
  // no manda nada. Se desactiva con CRON_HITOS_ENABLED=false.
  if ((process.env.CRON_HITOS_ENABLED || 'true').toLowerCase() !== 'false') {
    programar('aviso-hitos', (process.env.CRON_HITOS || '0 8 * * 1').trim(), async () => {
      try {
        const r = await avisoHitos.correr({});
        if (r.enviado) console.log(`[cron] aviso-hitos: ${r.total} hito(s) avisados (${r.vencidos} vencidos)`);
      } catch (err) {
        console.error('[cron] aviso-hitos ERROR:', err.message);
        audit.log(null, 'cron.aviso_hitos.error', { detalle: { error: err.message } });
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
