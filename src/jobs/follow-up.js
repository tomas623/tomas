// Cron de follow-up — paso 9/9.
// Corre 1×/día. Recorre dos colas:
//   a) Leads 'free' con > 48h sin follow_up y sin pago → recordatorio con incentivo.
//   b) Leads 'informe' que iniciaron checkout pero no pagaron (> 48h) → recordatorio.
// Marca lead.follow_up_at para no enviar dos veces el mismo mail.

const db = require('../db');
const audit = require('../audit');
const { enviarMailGenerico } = require('../notificaciones');

const HORAS_MIN = parseInt(process.env.FOLLOWUP_HORAS_MIN || '48', 10);
const CALENDLY = 'https://calendar.app.google/rx6vHWyyjFoEr7Vx9';

function htmlRecordatorioFree({ marca }) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3">¿Avanzamos con tu marca "${marca}"?</h2>
      <p>Hace unos días chequeaste la disponibilidad de <strong>${marca}</strong> en nuestro
         pre-check gratuito. Queríamos retomar.</p>
      <p>El pre-check te mostró las coincidencias exactas, pero las marcas se rechazan
         con más frecuencia por <strong>parecidos fonéticos, conceptuales o por
         marcas notorias</strong> que no aparecen en una búsqueda literal.</p>
      <p>Por eso ofrecemos un <strong>informe completo de viabilidad</strong> que cruza
         todo: similitud fonética, ideológica, choque con marcas notorias, leyes
         especiales, disponibilidad de dominios y redes. Lo firma un Agente de la
         Propiedad Industrial matriculado y queda en tu poder en 24h hábiles.</p>
      <p style="margin-top:24px">
        <a href="https://legalpacers.com#informe"
           style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Quiero el informe completo
        </a>
      </p>
      <p style="font-size:13px;color:#64748b;margin-top:16px">
        Si preferís hablar antes, <a href="${CALENDLY}">agendá una llamada</a>
        o respondé este mail.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        LegalPacers · Consultora de Propiedad Industrial<br>
        WhatsApp +54 9 11 2877-4200
      </p>
    </div>`;
}

function htmlRecordatorioCheckoutPendiente({ marca, initPoint }) {
  const linkPago = initPoint || 'https://legalpacers.com#informe';
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3">Te quedó pendiente el informe de "${marca}"</h2>
      <p>Iniciaste la solicitud del informe completo de viabilidad para
         <strong>${marca}</strong> pero el pago no se acreditó.</p>
      <p>Tu solicitud sigue activa: en cuanto se acredite el pago, generamos el
         informe y te lo enviamos revisado por un Agente de la Propiedad Industrial
         dentro de 24h hábiles.</p>
      <p style="margin-top:24px">
        <a href="${linkPago}"
           style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Retomar el pago
        </a>
      </p>
      <p style="font-size:13px;color:#64748b;margin-top:16px">
        Si tuviste algún problema o querés contarnos tu caso primero,
        <a href="${CALENDLY}">agendá una llamada</a> o respondé este mail.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        LegalPacers · Consultora de Propiedad Industrial<br>
        WhatsApp +54 9 11 2877-4200
      </p>
    </div>`;
}

/**
 * Corre el follow-up. Devuelve estadísticas de envío.
 */
async function correr({ dryRun = false } = {}) {
  const stats = { free: 0, checkout_pendiente: 0, errores: 0, total: 0 };

  // a) Leads free con > N horas sin follow-up.
  const freeLeads = db.prepare(`
    SELECT id, marca, email FROM leads
    WHERE tipo = 'free'
      AND email IS NOT NULL
      AND follow_up_at IS NULL
      AND created_at <= datetime('now', '-' || ? || ' hours')
    ORDER BY created_at ASC
    LIMIT 200
  `).all(HORAS_MIN);

  for (const lead of freeLeads) {
    if (dryRun) { stats.free++; continue; }
    const r = await enviarMailGenerico({
      to: lead.email,
      subject: `Avanzamos con "${lead.marca}"? — LegalPacers`,
      html: htmlRecordatorioFree({ marca: lead.marca }),
      tag: 'followup_free',
    });
    if (r.ok) {
      db.prepare(`UPDATE leads SET follow_up_at = datetime('now') WHERE id = ?`).run(lead.id);
      stats.free++;
    } else {
      stats.errores++;
      console.error(`[follow-up] lead ${lead.id} mail falló: ${r.error}`);
    }
  }

  // b) Leads informe con checkout iniciado pero no pagado.
  const pendientes = db.prepare(`
    SELECT id, marca, email, init_point FROM leads
    WHERE tipo = 'informe'
      AND estado = 'pendiente'
      AND email IS NOT NULL
      AND init_point IS NOT NULL
      AND follow_up_at IS NULL
      AND created_at <= datetime('now', '-' || ? || ' hours')
    ORDER BY created_at ASC
    LIMIT 200
  `).all(HORAS_MIN);

  for (const lead of pendientes) {
    if (dryRun) { stats.checkout_pendiente++; continue; }
    const r = await enviarMailGenerico({
      to: lead.email,
      subject: `Te quedó pendiente el informe de "${lead.marca}"`,
      html: htmlRecordatorioCheckoutPendiente({ marca: lead.marca, initPoint: lead.init_point }),
      tag: 'followup_checkout_pendiente',
    });
    if (r.ok) {
      db.prepare(`UPDATE leads SET follow_up_at = datetime('now') WHERE id = ?`).run(lead.id);
      stats.checkout_pendiente++;
    } else {
      stats.errores++;
      console.error(`[follow-up] lead ${lead.id} mail falló: ${r.error}`);
    }
  }

  stats.total = stats.free + stats.checkout_pendiente;
  if (!dryRun) {
    audit.log(null, 'cron.follow_up', { detalle: stats });
  }
  console.log(`[follow-up] enviados: ${stats.total} (free=${stats.free}, pend=${stats.checkout_pendiente}, errores=${stats.errores})`);
  return stats;
}

module.exports = { correr };
