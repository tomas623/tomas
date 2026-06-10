// Aviso trimestral de ajuste de precios — corre cada 3 meses por default
// (1° de febrero, mayo, agosto, noviembre a las 9:00 hora local).
//
// No sube precios automáticamente: solo manda un mail al equipo legal con
// el recordatorio operativo, el detalle de planes mensuales activos en la
// DB, la cantidad de suscriptos afectados y los pasos a seguir en MP.
//
// El ajuste real se hace en dos partes:
//   1) Equipo edita el importe en cada plan de MP (a mano).
//   2) Equipo dispara el comunicado masivo desde el admin (botón "Anunciar
//      ajuste de precios" → POST /api/admin/comunicados/ajuste-precios).

const db = require('../db');
const audit = require('../audit');
const { enviarMailGenerico } = require('../notificaciones');

async function correr({ dryRun = false } = {}) {
  const mailEquipo = (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim();

  // Planes mensuales en la DB. Son los únicos que ajustamos cada 3 meses;
  // los anuales se ajustan solo al renovar (no aplicamos política trimestral).
  const packs = db.prepare(`
    SELECT codigo, nombre, cupo_marcas, precio_mensual,
           (SELECT COUNT(*) FROM usuarios WHERE pack_id = packs.id AND activo = 1) AS suscriptos
    FROM packs
    ORDER BY cupo_marcas ASC
  `).all();

  const totalSusc = packs.reduce((s, p) => s + p.suscriptos, 0);

  const filas = packs.map(p => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
        <strong>${p.nombre}</strong><br>
        <span style="font-size:11.5px;color:#64748b">${p.codigo}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:ui-monospace,monospace">
        $${p.precio_mensual.toLocaleString('es-AR')}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">
        ${p.suscriptos}
      </td>
    </tr>`).join('');

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3;margin-bottom:8px">🔔 Recordatorio: revisar precios de planes mensuales</h2>
      <p style="color:#64748b;margin-top:0">Política trimestral por inflación · ${new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

      <p>Pasaron 3 meses desde el último ajuste programado. Es momento de revisar
         los precios de los planes <strong>mensuales</strong> y decidir si los actualizás.
         Los planes anuales no se tocan ahora — se ajustan al cumplir el aniversario.</p>

      <h3 style="margin-top:24px;font-size:15px">Planes hoy en la DB</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;background:#f8fafc;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#1B6EF3;color:#fff;text-align:left">
            <th style="padding:10px 12px;font-size:11.5px">Plan</th>
            <th style="padding:10px 12px;text-align:right;font-size:11.5px">Precio actual</th>
            <th style="padding:10px 12px;text-align:center;font-size:11.5px">Suscriptos</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>

      <p style="margin-top:18px;color:#64748b;font-size:13px">
         <strong>${totalSusc}</strong> suscripto(s) activo(s) en planes mensuales.
      </p>

      <h3 style="margin-top:24px;font-size:15px">Pasos a seguir</h3>
      <ol style="line-height:1.7;color:#0f1f3d;font-size:14px">
        <li><strong>Decidí el %.</strong> Mirá inflación INDEC desde el último ajuste y definí un porcentaje razonable (típico: 8-15% trimestral).</li>
        <li><strong>Editá los planes en Mercado Pago.</strong> Entrá a cada plan (3 mensuales: 3 / 10 / 20 marcas) y actualizá el importe.</li>
        <li><strong>Actualizá la DB local.</strong> En el panel admin → Packs (ajustá los nuevos precios para que la landing los muestre).</li>
        <li><strong>Dispará el comunicado.</strong> Panel admin → Packs → botón "Anunciar ajuste de precios". Define la fecha de vigencia (30 días desde hoy) y el porcentaje. El sistema le manda mail a todos los suscriptos.</li>
      </ol>

      <p style="margin-top:24px;padding:12px 16px;background:#fef3c7;border-left:3px solid #d97706;border-radius:6px;font-size:13px;color:#0f1f3d">
        💡 <strong>Consejo:</strong> avisá con 30 días de antelación. Es lo que prometemos en los TyC y lo que MP recomienda para no requerir re-autorización del cliente.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        Este mail lo genera el cron <code>aviso-ajuste-trimestral</code>.
        Frecuencia: cada 3 meses (configurable con <code>CRON_AVISO_AJUSTE</code>).
      </p>
    </div>`;

  if (dryRun) {
    return { ok: true, dryRun: true, packs: packs.length, suscriptos: totalSusc, to: mailEquipo };
  }

  const r = await enviarMailGenerico({
    to: mailEquipo,
    subject: '🔔 Es momento de revisar los precios mensuales — LegalPacers',
    html,
    tag: 'aviso_ajuste_trimestral',
  });

  if (r.ok) {
    audit.log(null, 'cron.aviso_ajuste', { detalle: { packs: packs.length, suscriptos: totalSusc, stub: !!r.stub } });
  }
  return { ok: r.ok, packs: packs.length, suscriptos: totalSusc, stub: !!r.stub };
}

module.exports = { correr };
