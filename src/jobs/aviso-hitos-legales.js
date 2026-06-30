// Aviso semanal de hitos legales — DJU (año 5) y renovación (año 10).
//
// Mira las marcas vigiladas con fecha de concesión cargada cuyo próximo hito
// cae dentro de la ventana de aviso (default 90 días) o ya venció, y le manda
// un único mail al equipo legal con la agenda. NO le escribe al cliente: el
// equipo decide a quién y cómo avisar desde el panel. Si no hay nada en la
// ventana, no manda mail (no spamear).

const db = require('../db');
const audit = require('../audit');
const { enviarMailGenerico } = require('../notificaciones');

const DIAS_AVISO = parseInt(process.env.HITOS_DIAS_AVISO || '90', 10);

function diasHasta(fechaIso, hoy) {
  return Math.round((new Date(fechaIso) - new Date(hoy)) / 86400000);
}

// Devuelve la lista de hitos individuales (una fila por DJU/renovación que
// entra en la ventana), ordenados por urgencia.
function hitosEnVentana(diasAviso = DIAS_AVISO) {
  const rows = db.prepare(`
    SELECT mv.id, mv.denominacion, mv.clases, mv.numero_acta, mv.fecha_concesion,
           date(mv.fecha_concesion, '+5 years')  AS dju_due_at,
           date(mv.fecha_concesion, '+10 years') AS renovacion_due_at,
           u.email AS usuario_email, u.nombre AS usuario_nombre, u.telefono AS usuario_telefono
    FROM marcas_vigiladas mv JOIN usuarios u ON u.id = mv.usuario_id
    WHERE mv.fecha_concesion IS NOT NULL
      AND mv.estado != 'baja'
      AND (
        date(mv.fecha_concesion, '+5 years')  <= date('now', '+' || ? || ' days')
        OR date(mv.fecha_concesion, '+10 years') <= date('now', '+' || ? || ' days')
      )
    LIMIT 500
  `).all(diasAviso, diasAviso);

  const hoy = new Date().toISOString().slice(0, 10);
  const hitos = [];
  for (const m of rows) {
    for (const [tipo, fecha] of [['DJU (año 5)', m.dju_due_at], ['Renovación (año 10)', m.renovacion_due_at]]) {
      if (!fecha) continue;
      const dias = diasHasta(fecha, hoy);
      // Solo entran los que están dentro de la ventana o ya vencidos.
      if (dias > diasAviso) continue;
      hitos.push({ ...m, tipo, fecha, dias });
    }
  }
  hitos.sort((a, b) => a.dias - b.dias);
  return hitos;
}

async function correr({ dryRun = false, diasAviso = DIAS_AVISO } = {}) {
  const mailEquipo = (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim();
  const hitos = hitosEnVentana(diasAviso);

  if (!hitos.length) {
    return { ok: true, total: 0, enviado: false, motivo: 'sin hitos en la ventana' };
  }

  const vencidos = hitos.filter(h => h.dias < 0).length;

  const semaforo = (dias) => {
    if (dias < 0) return `<span style="color:#dc2626;font-weight:700">vencido hace ${-dias}d</span>`;
    if (dias <= 30) return `<span style="color:#dc2626;font-weight:700">en ${dias}d</span>`;
    if (dias <= 60) return `<span style="color:#d97706;font-weight:700">en ${dias}d</span>`;
    return `<span style="color:#2563eb">en ${dias}d</span>`;
  };
  const fmt = f => {
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
  };

  const filas = hitos.map(h => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
        <strong>${h.usuario_nombre || h.usuario_email}</strong><br>
        <span style="font-size:11.5px;color:#64748b">${h.usuario_email}${h.usuario_telefono ? ' · ' + h.usuario_telefono : ''}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
        <strong>${h.denominacion}</strong><br>
        <span style="font-size:11.5px;color:#64748b">Clase ${h.clases}${h.numero_acta ? ' · Acta ' + h.numero_acta : ''}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${h.tipo}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${fmt(h.fecha)} · ${semaforo(h.dias)}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:${vencidos ? '#dc2626' : '#d97706'};margin-bottom:6px">
        ${vencidos ? '🚨' : '⏰'} Hitos legales por vencer — DJU / renovación
      </h2>
      <p style="color:#64748b;margin-top:0">
        ${hitos.length} hito(s) dentro de los próximos ${diasAviso} días${vencidos ? ` · <strong style="color:#dc2626">${vencidos} ya vencido(s)</strong>` : ''}.
      </p>

      <p>Estas marcas de clientes tienen una <strong>DJU (declaración jurada de uso, año 5)</strong>
         o una <strong>renovación (año 10)</strong> cerca. Conviene avisarles con tiempo —
         la omisión de la DJU implica la caducidad de la marca por ley.</p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#f8fafc;border-radius:8px;overflow:hidden;margin-top:14px">
        <thead>
          <tr style="background:#0f1f3d;color:#fff;text-align:left">
            <th style="padding:9px 12px;font-size:11.5px">Cliente</th>
            <th style="padding:9px 12px;font-size:11.5px">Marca</th>
            <th style="padding:9px 12px;font-size:11.5px">Hito</th>
            <th style="padding:9px 12px;font-size:11.5px">Vence</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>

      <p style="margin-top:18px;font-size:13px;color:#64748b">
        Entrá al <strong>panel admin → Hitos legales</strong> para ver el detalle completo y
        coordinar los avisos. Este mail no le llega al cliente.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
      <p style="font-size:12px;color:#64748b">
        Aviso automático del cron <code>aviso-hitos-legales</code> · ventana ${diasAviso} días
        (configurable con <code>HITOS_DIAS_AVISO</code>).
      </p>
    </div>`;

  if (dryRun) {
    return { ok: true, dryRun: true, total: hitos.length, vencidos, to: mailEquipo };
  }

  const r = await enviarMailGenerico({
    to: mailEquipo,
    subject: `${vencidos ? '🚨' : '⏰'} ${hitos.length} hito(s) legal(es) por vencer — DJU / renovación`,
    html,
    tag: 'aviso_hitos_legales',
  });

  if (r.ok) {
    audit.log(null, 'cron.aviso_hitos', { detalle: { total: hitos.length, vencidos, dias_aviso: diasAviso, stub: !!r.stub } });
  }
  return { ok: r.ok, total: hitos.length, vencidos, enviado: r.ok, stub: !!r.stub };
}

module.exports = { correr, hitosEnVentana };
