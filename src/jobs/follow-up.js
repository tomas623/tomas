// Cron de follow-up — corre 1×/día.
// Para leads tipo='free' manda hasta 3 recordatorios escalonados (3, 10 y 21 días)
// si el lead no avanzó. "Avanzó" = el mismo email tiene otro lead con
// tipo='informe' o tipo='registro' creado después del lead free.
// Para leads tipo='informe' con checkout iniciado, manda un único recordatorio
// (la cola de pago no debería tener seguimiento agresivo).
//
// Idempotente: usamos follow_up_count para no duplicar el mismo escalón.

const db = require('../db');
const audit = require('../audit');
const { enviarMailGenerico } = require('../notificaciones');

const STAGES_FREE = [
  { count: 0, horas: 72,  asunto: m => `¿Avanzamos con "${m}"?`,                      copy: copyStage1 },
  { count: 1, horas: 240, asunto: m => `Una nota técnica sobre "${m}"`,                copy: copyStage2 },
  { count: 2, horas: 504, asunto: m => `Última nota — "${m}" y las marcas notorias`,   copy: copyStage3 },
];

const HORAS_CHECKOUT = parseInt(process.env.FOLLOWUP_HORAS_CHECKOUT || '48', 10);
const CALENDLY = 'https://calendar.app.google/rx6vHWyyjFoEr7Vx9';

// ===== Copys =====
// Ninguno menciona "recordatorio". Cada uno aporta valor técnico distinto.

function shell(inner) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      ${inner}
      <p style="margin-top:24px;font-size:13px;color:#64748b">
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

function copyStage1({ marca }) {
  return shell(`
    <h2 style="color:#1B6EF3">¿Avanzamos con "${marca}"?</h2>
    <p>Hace unos días chequeaste la disponibilidad de <strong>${marca}</strong> en
       nuestro pre-check gratuito. Queríamos retomar.</p>
    <p>El pre-check te mostró las <em>coincidencias exactas</em>. En la práctica,
       las marcas se rechazan con más frecuencia por <strong>parecidos fonéticos,
       conceptuales o por marcas notorias</strong> que no aparecen en una búsqueda
       literal.</p>
    <p>Por eso ofrecemos un <strong>informe completo de viabilidad</strong> que
       cruza todo: similitud fonética, ideológica, choque con marcas notorias,
       leyes especiales, disponibilidad de dominios y redes. Lo firma un Agente
       de la Propiedad Industrial matriculado y queda en tu poder en 24 hs hábiles.</p>
    <p style="margin-top:24px">
      <a href="https://marcas.legalpacers.com/#informe"
         style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:600">
        Quiero el informe completo
      </a>
    </p>`);
}

function copyStage2({ marca }) {
  return shell(`
    <h2 style="color:#1B6EF3">Una nota técnica sobre "${marca}"</h2>
    <p>Sabemos que el pre-check te dio una primera lectura. Hay dos cosas que
       conviene tener en cuenta antes de invertir en branding o tasas oficiales:</p>
    <ol>
      <li><strong>El INPI no devuelve las tasas</strong> si rechaza la solicitud.
          Si presentás un nombre y un examinador encuentra un parecido fonético,
          conceptual o un choque con una marca notoria, perdés el dinero
          público que pagaste.</li>
      <li><strong>El rechazo más común no es por nombre idéntico, sino por
          similitud</strong> — y eso no se ve en un pre-check gratuito.</li>
    </ol>
    <p>El informe de viabilidad de $19.900 evalúa todos esos ejes y, si después
       avanzás con el registro, ese importe se descuenta del honorario inicial.</p>
    <p style="margin-top:24px">
      <a href="https://marcas.legalpacers.com/#informe"
         style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:600">
        Pedir el informe ahora
      </a>
    </p>`);
}

function copyStage3({ marca }) {
  return shell(`
    <h2 style="color:#1B6EF3">"${marca}" y las marcas notorias</h2>
    <p>Antes de cerrar el seguimiento, una última lectura técnica.</p>
    <p>En Argentina, las <strong>marcas notorias</strong> (Coca-Cola, Adidas,
       Disney, etc.) tienen una protección especial: se las puede oponer aunque
       el rubro sea otro. Es uno de los motivos más frecuentes de rechazo en
       trámites que parecían "libres" en un primer chequeo.</p>
    <p>Si querés cerrar este punto antes de avanzar, el informe completo cubre
       específicamente el cruce con marcas notorias y leyes especiales, y queda
       firmado por un Agente de la Propiedad Industrial.</p>
    <p style="margin-top:24px">
      <a href="https://marcas.legalpacers.com/#informe"
         style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:600">
        Pedir el informe
      </a>
    </p>
    <p style="font-size:13px;color:#64748b;margin-top:12px">
      Si en el corto plazo decidiste por otro nombre o vas a frenar, todo bien —
      no vamos a seguir escribiendo. Si querés que volvamos a contactarte más
      adelante, contestá este mail.
    </p>`);
}

function copyCheckoutPendiente({ marca, initPoint }) {
  const linkPago = initPoint || 'https://marcas.legalpacers.com/#informe';
  return shell(`
    <h2 style="color:#1B6EF3">Te quedó pendiente el informe de "${marca}"</h2>
    <p>Iniciaste la solicitud del informe completo de viabilidad para
       <strong>${marca}</strong> pero el pago no se acreditó.</p>
    <p>Tu solicitud sigue activa: en cuanto se acredite el pago, generamos el
       informe y te lo enviamos revisado por un Agente de la Propiedad Industrial
       dentro de 24 hs hábiles.</p>
    <p style="margin-top:24px">
      <a href="${linkPago}"
         style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:600">
        Retomar el pago
      </a>
    </p>`);
}

// ===== Cron =====

async function correr({ dryRun = false } = {}) {
  const stats = { free: 0, checkout_pendiente: 0, errores: 0, total: 0 };

  // 1) Leads free — escalones 3/10/21 días.
  //    Excluimos a quien ya avanzó (mismo email con lead 'informe' o 'registro').
  for (const stage of STAGES_FREE) {
    const candidatos = db.prepare(`
      SELECT l.id, l.marca, l.email
      FROM leads l
      WHERE l.tipo = 'free'
        AND l.email IS NOT NULL
        AND l.follow_up_count = ?
        AND l.created_at <= datetime('now', '-' || ? || ' hours')
        AND NOT EXISTS (
          SELECT 1 FROM leads otro
          WHERE otro.email = l.email
            AND otro.tipo IN ('informe', 'registro')
            AND otro.created_at >= l.created_at
        )
      ORDER BY l.created_at ASC
      LIMIT 200
    `).all(stage.count, stage.horas);

    for (const lead of candidatos) {
      if (dryRun) { stats.free++; continue; }
      const r = await enviarMailGenerico({
        to: lead.email,
        subject: stage.asunto(lead.marca),
        html: stage.copy({ marca: lead.marca }),
        tag: `followup_free_s${stage.count + 1}`,
      });
      if (r.ok) {
        db.prepare(`
          UPDATE leads SET
            follow_up_at = datetime('now'),
            follow_up_count = follow_up_count + 1
          WHERE id = ?
        `).run(lead.id);
        stats.free++;
      } else {
        stats.errores++;
        console.error(`[follow-up] lead ${lead.id} mail falló: ${r.error}`);
      }
    }
  }

  // 2) Leads informe con checkout iniciado pero no pagado — un único recordatorio.
  const pendientes = db.prepare(`
    SELECT id, marca, email, init_point FROM leads
    WHERE tipo = 'informe'
      AND estado = 'pendiente'
      AND email IS NOT NULL
      AND init_point IS NOT NULL
      AND follow_up_count = 0
      AND created_at <= datetime('now', '-' || ? || ' hours')
    ORDER BY created_at ASC
    LIMIT 200
  `).all(HORAS_CHECKOUT);

  for (const lead of pendientes) {
    if (dryRun) { stats.checkout_pendiente++; continue; }
    const r = await enviarMailGenerico({
      to: lead.email,
      subject: `Te quedó pendiente el informe de "${lead.marca}"`,
      html: copyCheckoutPendiente({ marca: lead.marca, initPoint: lead.init_point }),
      tag: 'followup_checkout_pendiente',
    });
    if (r.ok) {
      db.prepare(`
        UPDATE leads SET
          follow_up_at = datetime('now'),
          follow_up_count = follow_up_count + 1
        WHERE id = ?
      `).run(lead.id);
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
