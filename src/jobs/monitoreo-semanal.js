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
const MIN_NIVEL_PARA_ALERTAR = 'medio'; // Generamos alerta si Etapa 2 dice medio o alto.

function nivelGte(a, b) {
  const orden = { bajo: 0, medio: 1, alto: 2 };
  return orden[a] >= orden[b];
}

async function correr({ boletinId, actorId } = {}) {
  // Targets: si no se pasa boletín, tomamos el último procesado.
  let boletines;
  if (boletinId) {
    boletines = db.prepare(`SELECT * FROM boletines WHERE id = ? AND estado = 'procesado'`).all(boletinId);
  } else {
    boletines = db.prepare(`SELECT * FROM boletines WHERE estado = 'procesado' ORDER BY id DESC LIMIT 1`).all();
  }
  if (!boletines.length) return { ok: true, alertas: 0, mensaje: 'No hay boletines procesados.' };

  const vigiladas = db.prepare(`
    SELECT mv.*, u.email AS u_email, u.telefono AS u_telefono, u.nombre AS u_nombre
    FROM marcas_vigiladas mv JOIN usuarios u ON u.id = mv.usuario_id
    WHERE mv.estado = 'activa'
  `).all();

  let totalAlertas = 0, candidatosTotal = 0;

  for (const bol of boletines) {
    const actas = db.prepare(`
      SELECT id, denominacion, denominacion_norm, clase, acta, titular, estado, tipo
      FROM marcas_boletin WHERE boletin_id = ?
    `).all(bol.id);
    if (!actas.length) continue;

    for (const mv of vigiladas) {
      const clases = (() => { try { return JSON.parse(mv.clases || '[]'); } catch { return []; } })();

      // Etapa 1
      const cortos = matching(mv.denominacion, clases[0] || null, actas, { minScore: MIN_SCORE_LISTA_CORTA });
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

  return { ok: true, alertas: totalAlertas, candidatos: candidatosTotal,
           boletines: boletines.map(b => ({ id: b.id, numero: b.numero })) };
}

module.exports = { correr };
