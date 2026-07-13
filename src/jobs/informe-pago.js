// Orquestador del informe pago — Sprint 2, paso 5/9.
//
// Disparado desde el webhook MP cuando un lead pasa a 'pagado'.
// Corre en background (sin bloquear el ACK al webhook). Si algo falla,
// el informe queda con estado 'error' y un mensaje, para reintento manual
// desde el panel admin.
//
// Pipeline:
//   1. Lee el lead.
//   2. INSERT informes (estado='generando') — la cola lo ve enseguida.
//   3. Etapa1 matching contra marcas_inpi (principales + otras clases).
//   4. En paralelo: Gemini (informe), dominios, redes.
//   5. Genera el PDF y lo guarda en data/informes/{id}.pdf.
//   6. UPDATE informes a estado='borrador' con todos los datos.
//   7. Envía 2 emails:
//      - cliente: "recibimos tu pago, en 24h te llega el informe revisado".
//      - equipo: "hay un borrador para revisar".

const path = require('path');
const fs = require('fs/promises');
const db = require('../db');
const { matching } = require('../matching/etapa1');
const { generar: generarInforme } = require('../matching/informe');
const { chequear: chequearDominios } = require('../external/dominios');
const { chequear: chequearRedes } = require('../external/redes');
const { generarPDF } = require('../pdf/informe-pdf');
const { enviarMailGenerico } = require('../notificaciones');
const audit = require('../audit');

const DIR_PDFS = path.join(__dirname, '..', '..', 'data', 'informes');
const MAIL_EQUIPO = (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://legalpacers.com').replace(/\/$/, '');

function parsearClases(jsonStr) {
  if (!jsonStr) return [];
  try {
    const v = JSON.parse(jsonStr);
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
    return [];
  } catch {
    // formato legacy: "9,35"
    return String(jsonStr).split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
  }
}

function buscarCandidatas(denom, clases) {
  // Trae todas las marcas en las clases del cliente + clases conexas (las mismas
  // categorías Niza son razonables). Para cross-class informativo, también las
  // mismas denominaciones cercanas en otras clases.
  const clasesArr = clases.length ? clases : [];

  // Principales: misma clase
  const enClasesCliente = clasesArr.length
    ? db.prepare(
      `SELECT id, denominacion, denominacion_norm, clase, titular, estado
         FROM marcas_inpi WHERE clase IN (${clasesArr.map(() => '?').join(',')})`,
    ).all(...clasesArr)
    : [];

  // Otras clases: denominación parecida en cualquier clase NO del cliente
  // Usamos LIKE por trigrama burdo (primeros 3 chars), para no traer todo.
  const seedFonetico = denom.toLowerCase().slice(0, 3);
  const enOtrasClases = clasesArr.length
    ? db.prepare(
      `SELECT id, denominacion, denominacion_norm, clase, titular, estado
         FROM marcas_inpi
        WHERE clase NOT IN (${clasesArr.map(() => '?').join(',')})
          AND denominacion_norm LIKE ?
        LIMIT 200`,
    ).all(...clasesArr, `%${seedFonetico}%`)
    : [];

  const principales = matching(denom, clasesArr[0], enClasesCliente, { minScore: 55 });
  const otras = matching(denom, clasesArr[0], enOtrasClases, { minScore: 70 });
  return { principales, otras };
}

function htmlMailCliente({ marca }) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3">Recibimos tu pago</h2>
      <p>Gracias por confiar en LegalPacers para el análisis de viabilidad de tu marca <strong>${marca}</strong>.</p>
      <p>Tu informe ya está en proceso. Lo elabora un Agente de la Propiedad Industrial matriculado
         y te llega revisado a este mismo mail <strong>dentro de las próximas 24 horas hábiles</strong>.</p>
      <p>Cualquier consulta, podés escribirnos a
         <a href="mailto:contacto@legalpacers.com">contacto@legalpacers.com</a>
         o por WhatsApp al +54 9 11 2877-4200.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">LegalPacers · Consultora de Propiedad Industrial</p>
    </div>`;
}

function htmlMailEquipo({ informeId, marca, nivel, viab, solicitante, email }) {
  const url = `${PUBLIC_URL}/admin/informes/${informeId}`;
  const colorNivel = nivel === 'alto' ? '#dc2626' : nivel === 'medio' ? '#d97706' : '#059669';
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2>Nuevo informe en cola para revisión</h2>
      <p><strong>Marca:</strong> ${marca}</p>
      <p><strong>Solicitante:</strong> ${solicitante || '—'} &lt;${email || '—'}&gt;</p>
      <p><strong>Nivel de riesgo preliminar:</strong>
         <span style="color:${colorNivel};font-weight:600">${(nivel || 'desconocido').toUpperCase()}</span>
         &nbsp;·&nbsp; Viabilidad estimada: ${viab != null ? viab + '%' : 'n/d'}</p>
      <p style="margin-top:18px">
        <a href="${url}"
           style="background:#1B6EF3;color:#fff;padding:10px 18px;border-radius:8px;
                  text-decoration:none;display:inline-block">Revisar borrador #${informeId}</a>
      </p>
      <p style="font-size:12px;color:#64748b;margin-top:24px">
        SLA al cliente: 24 horas hábiles desde el pago.
      </p>
    </div>`;
}

/**
 * Procesa un lead pagado: corre el análisis, genera el PDF y encola para revisión.
 * @param {number} leadId
 * @param {object} [opts]
 * @param {boolean} [opts.notificarCliente=true] - manda el mail de acuse al
 *   cliente. En regeneraciones lo pasamos en false para no re-mandarle
 *   "recibimos tu pago" cada vez.
 * @returns {Promise<{informeId:number, estado:string}|null>}
 */
async function procesarInformePago(leadId, { notificarCliente = true } = {}) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) {
    console.error(`[informe-pago] lead ${leadId} no encontrado`);
    return null;
  }
  if (lead.tipo !== 'informe') {
    console.log(`[informe-pago] lead ${leadId} tipo=${lead.tipo}, no aplica`);
    return null;
  }

  // ¿Ya existe un informe para este lead? Si sí, no duplicamos.
  const existente = db.prepare('SELECT id, estado FROM informes WHERE lead_id = ?').get(leadId);
  if (existente) {
    console.log(`[informe-pago] lead ${leadId} ya tiene informe #${existente.id} (${existente.estado})`);
    return { informeId: existente.id, estado: existente.estado };
  }

  const clases = parsearClases(lead.clases);

  // 1. Reserva la fila para que aparezca en la cola enseguida.
  const ins = db.prepare(`
    INSERT INTO informes (lead_id, marca, tipo, clases, rubro, solicitante, email, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'generando')
  `).run(
    leadId, lead.marca, 'denominativa', JSON.stringify(clases),
    lead.rubro || null, null, lead.email || null,
  );
  const informeId = ins.lastInsertRowid;
  audit.log(null, 'informe_pago.start', { entidad: 'informes', entidad_id: informeId, detalle: lead.marca });

  try {
    // 2. Matching contra base INPI.
    const { principales, otras } = buscarCandidatas(lead.marca, clases);

    // 3. Gemini + dominios + redes en paralelo.
    const marca = { denominacion: lead.marca, clases, rubro: lead.rubro, tipo: 'denominativa' };
    const [informe, dominios, redes] = await Promise.all([
      generarInforme(marca, { principales, otras_clases: otras }),
      chequearDominios(lead.marca).catch(err => ({ error: err.message })),
      chequearRedes(lead.marca).catch(err => ({ error: err.message })),
    ]);

    // 4. PDF.
    await fs.mkdir(DIR_PDFS, { recursive: true });
    const pdfPath = path.join(DIR_PDFS, `informe-${informeId}.pdf`);
    const pdfBuf = await generarPDF(
      informe,
      {
        email: lead.email,
        solicitante: lead.email,  // sin nombre todavía; lo edita el agente en el panel
        marca: lead.marca,
        tipo: 'Denominativa',
        clases,
        rubro: lead.rubro || '',
      },
      { dominios, redes },
    );
    await fs.writeFile(pdfPath, pdfBuf);

    // 5. UPDATE informe con todos los datos + estado 'borrador'.
    db.prepare(`
      UPDATE informes SET
        informe_json = ?, dominios_json = ?, redes_json = ?,
        flags_leyes = ?,
        nivel_riesgo = ?, viabilidad_estimada = ?,
        pdf_path = ?, pdf_bytes = ?,
        estado = 'borrador', generado_at = datetime('now')
      WHERE id = ?
    `).run(
      JSON.stringify(informe),
      JSON.stringify(dominios),
      JSON.stringify(redes),
      JSON.stringify(informe._pre_checks || []),
      informe.nivel_riesgo || null,
      typeof informe.viabilidad_estimada === 'number' ? informe.viabilidad_estimada : null,
      pdfPath, pdfBuf.length,
      informeId,
    );
    audit.log(null, 'informe_pago.borrador', { entidad: 'informes', entidad_id: informeId });

    // 6. Notificaciones (no bloquean — los errores se loguean).
    // El acuse al cliente ("recibimos tu pago") se manda SOLO en la generación
    // original, no en regeneraciones — para no spamearlo con confirmaciones.
    if (lead.email && notificarCliente) {
      enviarMailGenerico({
        to: lead.email,
        subject: `Recibimos tu pago — informe de "${lead.marca}" en proceso`,
        html: htmlMailCliente({ marca: lead.marca }),
        tag: 'informe_acuse',
      }).catch(err => console.error('[informe-pago] mail cliente:', err.message));
    }
    enviarMailGenerico({
      to: MAIL_EQUIPO,
      subject: `[Cola revisión] ${lead.marca} · riesgo ${informe.nivel_riesgo || 'n/d'}`,
      html: htmlMailEquipo({
        informeId,
        marca: lead.marca,
        nivel: informe.nivel_riesgo,
        viab: informe.viabilidad_estimada,
        solicitante: null,
        email: lead.email,
      }),
      tag: 'informe_cola_revision',
    }).catch(err => console.error('[informe-pago] mail equipo:', err.message));

    console.log(`[informe-pago] informe #${informeId} (${lead.marca}) → borrador listo para revisión`);
    return { informeId, estado: 'borrador' };

  } catch (err) {
    console.error(`[informe-pago] ERROR en informe #${informeId}:`, err);
    db.prepare(`UPDATE informes SET estado = 'error', error_msg = ? WHERE id = ?`)
      .run(err.message.slice(0, 500), informeId);
    audit.log(null, 'informe_pago.error', { entidad: 'informes', entidad_id: informeId, detalle: err.message });

    // Avisar al equipo que falló — no se le notifica al cliente automáticamente
    // porque el agente puede querer rehacer y enviar igual.
    enviarMailGenerico({
      to: MAIL_EQUIPO,
      subject: `[ERROR] Falló generación de informe #${informeId} — ${lead.marca}`,
      html: `<p>Falló la generación del informe pago del lead ${leadId} (${lead.marca}).</p>
             <p><strong>Error:</strong> ${err.message}</p>
             <p>Revisar logs y reintentar manualmente desde el panel.</p>`,
      tag: 'informe_error',
    }).catch(() => {});

    return { informeId, estado: 'error' };
  }
}

module.exports = { procesarInformePago };
