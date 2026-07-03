// Job de monitoreo semanal: para cada marca vigilada activa, corre Etapa 1 contra
// las actas del/los boletín(es) procesado(s) y, sobre la lista corta, Etapa 2
// (Gemini stub). Genera alertas idempotentes (única por usuario+marca+boletin).
//
// IDEMPOTENCIA: el unique index uniq_alertas_por_boletin garantiza que correr
// el job dos veces sobre el mismo boletín NO duplica alertas.

const db = require('../db');
const audit = require('../audit');
const { matching } = require('../matching/etapa1');
const { analizar, nivelDesdeScore } = require('../matching/etapa2');

const MIN_SCORE_LISTA_CORTA = 55;       // Etapa 1: cualquier candidato ≥ 55 va a Etapa 2.
// Umbral de nivel para crear la alerta. Default 'bajo' = mostramos TODA
// coincidencia real (que ya pasó los filtros de ruido: figurativas + mismo
// titular), con el nivel de Gemini (alto/medio/bajo) como ETIQUETA para que el
// equipo ordene y filtre a mano. Subilo a 'medio' con MONITOREO_MIN_NIVEL si
// preferís que Gemini pre-filtre y no te muestre los de riesgo bajo.
const MIN_NIVEL_PARA_ALERTAR = (process.env.MONITOREO_MIN_NIVEL || 'bajo').trim();

// Denominaciones "placeholder" que el parser genera para marcas figurativas o
// sin elemento denominativo: "[Figurativa]", "[Figurativa s/d]", "[Acta 123]".
// No tienen palabra para cotejar; matchearlas entre sí es puro ruido (todas
// comparten la raíz "figurativa"). Se saltean del monitoreo por denominación.
function esPlaceholder(denom) {
  const s = String(denom || '').trim();
  return !s || s.startsWith('[');
}

// Normaliza un titular para comparar identidad de dueño: minúsculas, sin
// acentos ni puntuación, sin sufijos societarios, y con los tokens ordenados
// alfabéticamente (así "RODRIGUEZ TOMAS GUIDO" == "TOMAS GUIDO RODRIGUEZ").
const SUF_SOC = new Set(['sa', 'srl', 'sas', 'sca', 'scs', 'sociedad', 'anonima', 'responsabilidad', 'limitada', 's', 'a', 'r', 'l', 'y', 'cia', 'e', 'hijos']);
function normTitular(t) {
  if (!t) return '';
  const limpio = String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ');
  const tokens = limpio.split(/\s+/).filter(w => w && !SUF_SOC.has(w));
  return tokens.sort().join(' ');
}

function nivelGte(a, b) {
  const orden = { bajo: 0, medio: 1, alto: 2 };
  return orden[a] >= orden[b];
}

// Cuántos boletines recientes barre el monitoreo cuando no se pasa uno
// explícito. La idempotencia (UNIQUE en usuario+marca+boletin) evita
// que se generen alertas duplicadas si un boletín ya fue procesado.
const BOLETINES_RECIENTES = parseInt(process.env.MONITOREO_BOLETINES || '20', 10);

async function correr({ boletinId, actorId, desdeBoletinId } = {}) {
  // Targets:
  //   - boletinId explícito → ese único boletín.
  //   - desdeBoletinId → todos los boletines con id > desdeBoletinId.
  //   - default → los últimos N procesados (cubre el caso de que el catch-up
  //     traiga varios boletines de golpe y el monitoreo no se quede pegado
  //     en el más reciente; lo viejo se descarta por idempotencia).
  let boletines;
  if (boletinId) {
    boletines = db.prepare(`SELECT * FROM boletines WHERE id = ? AND estado = 'procesado'`).all(boletinId);
  } else if (desdeBoletinId) {
    boletines = db.prepare(`
      SELECT * FROM boletines WHERE estado = 'procesado' AND id > ? ORDER BY id ASC
    `).all(desdeBoletinId);
  } else {
    boletines = db.prepare(`
      SELECT * FROM boletines WHERE estado = 'procesado' ORDER BY id DESC LIMIT ?
    `).all(BOLETINES_RECIENTES);
  }
  if (!boletines.length) return { ok: true, alertas: 0, mensaje: 'No hay boletines procesados.' };

  const vigiladas = db.prepare(`
    SELECT mv.*, u.email AS u_email, u.telefono AS u_telefono, u.nombre AS u_nombre
    FROM marcas_vigiladas mv JOIN usuarios u ON u.id = mv.usuario_id
    WHERE mv.estado = 'activa'
  `).all();

  let totalAlertas = 0, candidatosTotal = 0;

  for (const bol of boletines) {
    // Filtramos las actas placeholder (figurativas sin denominación) del universo
    // a cotejar: no aportan nada al matching por nombre y sólo generan ruido.
    const actas = db.prepare(`
      SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado, tipo
      FROM marcas_boletin WHERE boletin_id = ?
    `).all(bol.id).filter(a => !esPlaceholder(a.denominacion));
    if (!actas.length) continue;

    for (const mv of vigiladas) {
      // Las marcas figurativas del cliente (sin palabra) no se vigilan por
      // denominación — se saltean. Su protección es sobre la imagen, no el nombre.
      if (esPlaceholder(mv.denominacion)) continue;
      const clases = (() => { try { return JSON.parse(mv.clases || '[]'); } catch { return []; } })();
      const titularVig = normTitular(mv.titular);

      // Etapa 1. Descartamos candidatos del MISMO titular que la marca vigilada:
      // nadie se opone a su propia marca, así que un match con el mismo dueño
      // (aunque sea otra acta/clase) no es una amenaza, es ruido. Sólo aplica
      // cuando conocemos el titular de la marca vigilada (si es null, no podemos
      // comparar y dejamos pasar todo).
      let cortos = matching(mv.denominacion, clases[0] || null, actas, { minScore: MIN_SCORE_LISTA_CORTA });
      if (titularVig) {
        cortos = cortos.filter(c => {
          const tc = normTitular(c.titular);
          return !tc || tc !== titularVig;
        });
      }
      if (!cortos.length) continue;

      // Etapa 2 sobre la lista corta
      const evaluados = [];
      for (const c of cortos) {
        const ge = await analizar({ denominacion: mv.denominacion, clases }, c);
        evaluados.push({ ...c, gemini: ge });
      }
      candidatosTotal += evaluados.length;

      const peor = evaluados.reduce((acc, c) => {
        const n = c.gemini?.nivel_riesgo || nivelDesdeScore(c.score);
        return nivelGte(n, acc.nivel) ? { nivel: n, c } : acc;
      }, { nivel: 'bajo', c: null });

      if (!nivelGte(peor.nivel, MIN_NIVEL_PARA_ALERTAR)) continue;

      // Insert idempotente (UNIQUE en usuario+marca+boletin).
      // IMPORTANTE: las alertas se crean en estado 'pendiente_revision'. El
      // dictamen de Gemini es bueno como primer filtro pero a veces dispara
      // falsos positivos; por eso un humano del equipo legal las revisa antes
      // de notificar al cliente desde el panel admin (botón "Aprobar y enviar").
      let alertaId;
      try {
        const fund = peor.c?.gemini?.fundamento
          || `Detectamos ${evaluados.length} candidato(s) con similitud relevante a "${mv.denominacion}" en el boletín ${bol.numero || bol.id}.`;
        const ins = db.prepare(`
          INSERT INTO alertas (usuario_id, marca_vigilada_id, boletin_id, nivel, notoria, estado, canal, fundamento)
          VALUES (?, ?, ?, ?, ?, 'pendiente_revision', 'mail', ?)
        `).run(mv.usuario_id, mv.id, bol.id, peor.nivel, peor.c?.gemini?.notoria ? 1 : 0, fund);
        alertaId = ins.lastInsertRowid;
        totalAlertas++;
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) continue;  // Ya existía → idempotente.
        throw err;
      }

      // Candidatos asociados
      const insC = db.prepare(`
        INSERT INTO alerta_candidatos (alerta_id, marca_boletin_id, score, motivo, gemini_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const c of evaluados) {
        insC.run(alertaId, c.id, c.score, (c.motivos || []).join(','), JSON.stringify(c.gemini));
      }
      // Las notificaciones al cliente se disparan desde /api/admin/alertas/:id/aprobar
      // cuando un humano revisa y aprueba la alerta. El cron no le manda mail al
      // cliente directamente.
    }
  }

  audit.log(actorId || null, 'monitoreo.run', {
    detalle: { boletines: boletines.map(b => b.id), alertas_creadas: totalAlertas, candidatos: candidatosTotal },
  });

  const lista = boletines.map(b => ({ id: b.id, numero: b.numero }));
  const mensaje = boletines.length === 1
    ? `Boletín #${boletines[0].numero || boletines[0].id} barrido.`
    : `${boletines.length} boletines barridos (del #${boletines[0].numero || boletines[0].id} al #${boletines[boletines.length-1].numero || boletines[boletines.length-1].id}).`;
  return { ok: true, alertas: totalAlertas, candidatos: candidatosTotal,
           boletines: lista, boletines_total: boletines.length, mensaje };
}

// Avisa al equipo por mail que hay alertas pendientes de revisión. Pensado para
// llamarse después de la corrida semanal del cron. Si no hay pendientes, no
// manda nada (no spamear). Cuenta TODAS las pendientes, no solo las de esta
// corrida, para que un pendiente viejo no quede olvidado.
async function avisarPendientes() {
  const { enviarMailGenerico } = require('../notificaciones');
  const mailEquipo = (process.env.MAIL_EQUIPO_LEGAL || 'contacto@legalpacers.com').trim();
  const filas = db.prepare(`
    SELECT nivel, COUNT(*) AS n FROM alertas WHERE estado = 'pendiente_revision' GROUP BY nivel
  `).all();
  const total = filas.reduce((s, f) => s + f.n, 0);
  if (!total) return { enviado: false, total: 0 };

  const porNivel = { alto: 0, medio: 0, bajo: 0 };
  for (const f of filas) if (f.nivel in porNivel) porNivel[f.nivel] = f.n;
  const baseUrl = (process.env.BASE_URL || 'https://marcas.legalpacers.com').replace(/\/+$/, '');

  const chip = (label, n, color) => n > 0
    ? `<span style="display:inline-block;background:${color};color:#fff;border-radius:6px;padding:3px 10px;font-size:13px;font-weight:700;margin-right:6px">${n} ${label}</span>`
    : '';
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f1f3d">
      <h2 style="color:#1B6EF3;margin-bottom:6px">🔔 ${total} alerta(s) para revisar</h2>
      <p style="color:#64748b;margin-top:0">El monitoreo semanal del INPI encontró coincidencias con marcas de tus clientes.</p>
      <p style="margin:16px 0">
        ${chip('alto', porNivel.alto, '#dc2626')}
        ${chip('medio', porNivel.medio, '#d97706')}
        ${chip('bajo', porNivel.bajo, '#059669')}
      </p>
      <p>Entrá al panel a revisarlas: aprobá las que valen (se le manda el mail al
         cliente) y descartá las que sean ruido.</p>
      <p style="margin-top:24px">
        <a href="${baseUrl}/admin/"
           style="background:#1B6EF3;color:#fff;padding:12px 22px;border-radius:8px;
                  text-decoration:none;display:inline-block;font-weight:600">
          Revisar alertas
        </a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#64748b">
        Aviso automático del monitoreo semanal · LegalPacers
      </p>
    </div>`;

  const r = await enviarMailGenerico({
    to: mailEquipo,
    subject: `🔔 ${total} alerta(s) del INPI para revisar — LegalPacers`,
    html, tag: 'alertas_pendientes_aviso',
  });
  if (r.ok) audit.log(null, 'monitoreo.aviso_pendientes', { detalle: { total, porNivel, stub: !!r.stub } });
  return { enviado: r.ok, total, porNivel, stub: !!r.stub };
}

module.exports = { correr, avisarPendientes };
