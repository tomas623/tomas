// Reporte mensual de cartera — mail a cada cliente con vigilancia activa, el
// día 1 de cada mes, resumiendo: marcas vigiladas, alertas del mes, próximos
// hitos legales (DJU/renovación) y confirmación de que la vigilancia corre.
// Aunque no haya alertas, refuerza que el servicio está trabajando (retención).
// NO incluye alertas pendientes de revisión — el cliente sólo ve lo aprobado.

const db = require('../db');
const audit = require('../audit');
const { enviarMailGenerico } = require('../notificaciones');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtFecha(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

function nivelColor(n) {
  return n === 'alto' ? '#dc2626' : n === 'medio' ? '#d97706' : '#059669';
}

function construirHtml({ cliente, mesNombre, marcas, alertas, hitos, marcasEscaneadas, baseUrl }) {
  const nombre = (cliente.nombre || '').trim().split(/\s+/)[0];
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';

  const alertasHtml = alertas.length
    ? `<h3 style="font-size:15px;margin:22px 0 8px">🔔 Alertas de este mes (${alertas.length})</h3>
       <ul style="font-size:13.5px;line-height:1.7;padding-left:18px;margin:0">
         ${alertas.map(a => `<li>Posible coincidencia con <strong>${a.marca}</strong> · <span style="color:${nivelColor(a.nivel)};font-weight:700">riesgo ${a.nivel}</span> · ${fmtFecha(a.created_at)}</li>`).join('')}
       </ul>
       <p style="font-size:12.5px;color:#64748b;margin-top:8px">Podés ver el detalle y consultar por una oposición desde tu portal.</p>`
    : `<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:12px 14px;border-radius:6px;margin:22px 0;font-size:13.5px">
         <strong>Mes tranquilo.</strong> No detectamos ninguna solicitud nueva que se parezca a tus marcas. Seguimos escaneando cada semana.
       </div>`;

  const hitosHtml = hitos.length
    ? `<h3 style="font-size:15px;margin:22px 0 8px">📅 Próximos hitos legales</h3>
       <ul style="font-size:13.5px;line-height:1.7;padding-left:18px;margin:0">
         ${hitos.map(h => `<li><strong>${h.denominacion}</strong>: ${h.tipo} el <strong>${fmtFecha(h.fecha)}</strong></li>`).join('')}
       </ul>
       <p style="font-size:12.5px;color:#64748b;margin-top:8px">Te vamos a contactar con tiempo para gestionarlos. La DJU (año 5) es obligatoria por ley.</p>`
    : '';

  return `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3;margin-bottom:2px">Tu reporte de ${mesNombre}</h2>
      <p style="color:#64748b;margin-top:0;font-size:13px">Monitoreo de marcas · LegalPacers</p>

      <p style="margin-top:16px">${saludo} este es el resumen mensual del monitoreo de tu cartera.</p>

      <div style="display:flex;gap:12px;margin:18px 0">
        <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:#0f1f3d">${marcas.length}</div>
          <div style="font-size:12px;color:#64748b">marcas en vigilancia</div>
        </div>
        <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:800;color:${alertas.length ? '#d97706' : '#059669'}">${alertas.length}</div>
          <div style="font-size:12px;color:#64748b">alerta(s) este mes</div>
        </div>
      </div>

      ${alertasHtml}
      ${hitosHtml}

      <div style="border-top:1px solid #e5e7eb;margin-top:22px;padding-top:14px;font-size:12.5px;color:#64748b">
        ${marcasEscaneadas > 0
          ? `✓ Este mes cruzamos tu cartera contra <strong>${marcasEscaneadas.toLocaleString('es-AR')}</strong> marcas nuevas publicadas en el Boletín del INPI. Este es tu resumen del mes; vas a seguir recibiendo nuestras alertas todas las semanas.`
          : `✓ Escaneamos el Boletín del INPI todas las semanas cruzándolo con tu cartera. Vas a seguir recibiendo nuestras alertas.`}
      </div>

      <div style="background:#eff6ff;border-left:3px solid #1B6EF3;padding:12px 16px;border-radius:6px;margin-top:16px;font-size:12.5px;line-height:1.65;color:#0f1f3d">
        <strong>Cómo se defiende una marca.</strong> El derecho marcario argentino se rige por la prioridad:
        <em>quien presenta primero, tiene preferencia</em>. Tener tu marca registrada o en trámite te habilita a
        <strong>oponerte</strong> a solicitudes posteriores que puedan confundirse con la tuya. Nuestro monitoreo
        existe para que no se te pase ninguna: te avisamos apenas aparece, para que ejerzas ese derecho dentro del
        plazo legal. Detectar es el primer paso; oponerte, cuando corresponde, es lo que realmente defiende tu marca.
      </div>

      <p style="margin-top:22px">
        <a href="${baseUrl}/cliente/"
           style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Ver mi cartera en el portal
        </a>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        LegalPacers · Consultora de Propiedad Industrial<br>
        contacto@legalpacers.com · WhatsApp +54 9 11 2877-4200
      </p>
    </div>`;
}

// Envía el reporte a todos los clientes con vigilancia activa. Con dryRun no
// manda mails: solo devuelve a quiénes les tocaría y con qué números.
async function correr({ dryRun = false, ahora } = {}) {
  const fecha = ahora instanceof Date ? ahora : new Date();
  const mesNombre = `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`;
  const baseUrl = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');

  // Clientes activos con pack de vigilancia y al menos una marca en vigilancia.
  const clientes = db.prepare(`
    SELECT u.id, u.email, u.nombre
    FROM usuarios u
    WHERE u.rol = 'cliente' AND u.activo = 1 AND u.pack_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM marcas_vigiladas mv WHERE mv.usuario_id = u.id AND mv.estado = 'activa')
  `).all();

  // Marcas nuevas publicadas en el boletín y cruzadas contra las carteras este
  // mes — el número "grande" que muestra el trabajo hecho (igual para todos).
  const marcasEscaneadas = db.prepare(`
    SELECT COUNT(*) AS n FROM marcas_boletin
    WHERE boletin_id IN (SELECT id FROM boletines WHERE created_at >= date('now','-1 month'))
  `).get().n;

  const stmtMarcas = db.prepare(`
    SELECT denominacion, clases, situacion_inpi FROM marcas_vigiladas
    WHERE usuario_id = ? AND estado = 'activa' ORDER BY denominacion
  `);
  const stmtAlertas = db.prepare(`
    SELECT a.nivel, a.created_at, mv.denominacion AS marca
    FROM alertas a JOIN marcas_vigiladas mv ON mv.id = a.marca_vigilada_id
    WHERE a.usuario_id = ? AND a.estado IN ('aprobada','accion_tomada','revisada')
      AND a.created_at >= date('now','-1 month')
    ORDER BY a.created_at DESC
  `);
  const stmtHitos = db.prepare(`
    SELECT denominacion,
           date(fecha_concesion,'+5 years')  AS dju_due_at,
           date(fecha_concesion,'+10 years') AS renov_due_at
    FROM marcas_vigiladas
    WHERE usuario_id = ? AND estado='activa' AND fecha_concesion IS NOT NULL
      AND (date(fecha_concesion,'+5 years')  <= date('now','+120 days')
        OR date(fecha_concesion,'+10 years') <= date('now','+120 days'))
  `);

  let enviados = 0, errores = 0;
  const detalle = [];

  for (const c of clientes) {
    if (!c.email) continue;
    const marcas = stmtMarcas.all(c.id);
    const alertas = stmtAlertas.all(c.id);
    // Aplanamos los hitos (una fila por DJU y por renovación que entre en ventana).
    const hoy = new Date().toISOString().slice(0, 10);
    const hitos = [];
    for (const h of stmtHitos.all(c.id)) {
      if (h.dju_due_at && h.dju_due_at <= addDias(hoy, 120)) hitos.push({ denominacion: h.denominacion, tipo: 'DJU (año 5)', fecha: h.dju_due_at });
      if (h.renov_due_at && h.renov_due_at <= addDias(hoy, 120)) hitos.push({ denominacion: h.denominacion, tipo: 'Renovación (año 10)', fecha: h.renov_due_at });
    }
    hitos.sort((a, b) => a.fecha.localeCompare(b.fecha));

    detalle.push({ email: c.email, marcas: marcas.length, alertas: alertas.length, hitos: hitos.length });
    if (dryRun) continue;

    const html = construirHtml({ cliente: c, mesNombre, marcas, alertas, hitos, marcasEscaneadas, baseUrl });
    const r = await enviarMailGenerico({
      to: c.email,
      subject: `Tu reporte de marcas de ${mesNombre} — LegalPacers`,
      html, tag: 'reporte_mensual',
    });
    if (r.ok) enviados++; else errores++;
  }

  const resumen = { ok: true, clientes: clientes.length, enviados, errores, mes: mesNombre, dryRun, detalle };
  if (!dryRun) audit.log(null, 'reporte_mensual', { detalle: { clientes: clientes.length, enviados, errores, mes: mesNombre } });
  return resumen;
}

// Suma N días a una fecha AAAA-MM-DD (sin depender de Date, para consistencia
// con las comparaciones lexicográficas de arriba usamos SQLite en el WHERE;
// acá alcanza con una comparación simple ya filtrada por el query).
function addDias(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { correr };
