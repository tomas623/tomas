// Catch-up del INPI. Sincroniza marcas_inpi con todos los boletines publicados,
// descargando y procesando los que falten desde el último importado hasta el
// último publicado.
//
// Estrategia por serie:
//   1) Detectamos el último número intentado con éxito (estado='ok') en
//      inpi_sync_log; si no hay nada, partimos del número inicial conocido.
//   2) Probamos numero+1, +2, ... Si un boletín ya está logueado como 'ok',
//      lo salteamos sin re-descargar. Si está logueado como 'no_existe' o
//      'error', lo reintentamos.
//   3) Cuando acumulamos N 'no_existe' consecutivos asumimos que llegamos al
//      tope publicado y cortamos (descubrimiento automático del último).
//
// Cada boletín que entra OK pasa por parseBoletinBuffer + importarFilas:
// upsertea marcas_inpi y registra contadores en inpi_sync_log.

const db = require('../db');
const audit = require('../audit');
const { descargar, SERIES } = require('./descargar-boletin-inpi');
const { parseBoletinBuffer } = require('./parse-boletin-inpi');
const { importarFilas } = require('./import-marcas-inpi');

// Puntos de partida iniciales (override con env vars). Son los números más
// bajos desde donde empezamos a buscar si la DB está vacía. Calibrados para
// cubrir el universo útil:
//
//   - registros (52 boletines/año confirmado por bulk_importer.py): 5400
//     cubre ~12 años hacia atrás desde el tope actual (~6042). 12 años abarca
//     prácticamente toda la vigencia de marcas (la renovación es a los 10).
//
//   - nuevas (frecuencia más alta, ~2-3 por semana): 10800 cubre ~15 meses
//     hacia atrás desde el tope actual (~11062), atrapando las solicitudes
//     en trámite que justamente no aparecían en el dump original.
//
// El catch-up no penaliza arrancar bajo: los boletines inexistentes se
// registran como 'no_existe' y siguen. Sobreestimar es seguro.
const INICIOS = {
  registros: parseInt(process.env.INPI_INICIO_REGISTROS || '5400', 10),
  nuevas:    parseInt(process.env.INPI_INICIO_NUEVAS    || '10800', 10),
};

// Cuántos 'no_existe' consecutivos toleramos antes de cortar (descubrir el
// último publicado). Cuanto más alto, más tolerante a huecos en la numeración
// pero más lento.
const MAX_FALLOS_CONSECUTIVOS = parseInt(process.env.INPI_MAX_FALLOS || '8', 10);

function ultimoOk(serie) {
  const r = db.prepare(
    `SELECT MAX(numero) AS n FROM inpi_sync_log WHERE serie = ? AND estado = 'ok'`
  ).get(serie);
  return r && r.n ? r.n : null;
}

function logSync(row) {
  db.prepare(`
    INSERT INTO inpi_sync_log (serie, numero, formato, estado, marcas_nuevas, marcas_actualizadas, error_msg, bytes, duracion_ms)
    VALUES (@serie, @numero, @formato, @estado, @marcas_nuevas, @marcas_actualizadas, @error_msg, @bytes, @duracion_ms)
    ON CONFLICT(serie, numero) DO UPDATE SET
      formato = excluded.formato,
      estado = excluded.estado,
      marcas_nuevas = excluded.marcas_nuevas,
      marcas_actualizadas = excluded.marcas_actualizadas,
      error_msg = excluded.error_msg,
      bytes = excluded.bytes,
      duracion_ms = excluded.duracion_ms,
      created_at = datetime('now')
  `).run({
    formato: null, marcas_nuevas: 0, marcas_actualizadas: 0,
    error_msg: null, bytes: null, duracion_ms: null,
    ...row,
  });
}

async function procesarUno({ serie, numero, actorId }) {
  // Si ya está logueado como 'ok' y tiene marcas importadas, skip silencioso.
  const prev = db.prepare(
    `SELECT estado FROM inpi_sync_log WHERE serie = ? AND numero = ?`
  ).get(serie, numero);
  if (prev && prev.estado === 'ok') {
    return { serie, numero, skipped: true, estado: 'ok' };
  }

  const dl = await descargar({ serie, numero });
  if (!dl.ok) {
    logSync({
      serie, numero,
      formato: dl.formato || null,
      estado: dl.motivo === 'no_existe' ? 'no_existe' : 'error',
      error_msg: dl.motivo + (dl.error ? `: ${dl.error}` : '') + (dl.status ? ` (HTTP ${dl.status})` : ''),
      duracion_ms: dl.duracion_ms,
    });
    return { serie, numero, ok: false, motivo: dl.motivo, status: dl.status };
  }

  let parsed;
  try {
    parsed = await parseBoletinBuffer(dl.buffer, `${numero}_3_.${dl.formato}`);
  } catch (err) {
    logSync({
      serie, numero, formato: dl.formato, estado: 'error',
      error_msg: `parse: ${err.message}`,
      bytes: dl.bytes, duracion_ms: dl.duracion_ms,
    });
    return { serie, numero, ok: false, motivo: 'parse_error', error: err.message };
  }

  const { stats } = importarFilas(parsed.marcas, {
    actorId: actorId || null,
    fuente: `inpi_sync_${serie}_${numero}`,
  });

  logSync({
    serie, numero, formato: dl.formato, estado: 'ok',
    marcas_nuevas: stats.nuevas,
    marcas_actualizadas: stats.actualizadas,
    bytes: dl.bytes, duracion_ms: dl.duracion_ms,
  });

  return { serie, numero, ok: true, formato: dl.formato, stats };
}

// Catch-up de una serie. Devuelve resumen con cuántos procesó y por qué cortó.
async function catchUpSerie({ serie, desde, hasta, actorId, maxFallos = MAX_FALLOS_CONSECUTIVOS, onProgreso }) {
  if (!SERIES[serie]) throw new Error(`Serie inválida: ${serie}`);

  // Punto de partida: explícito (desde) > último ok logueado + 1 > inicio histórico.
  let n = desde != null ? desde : (ultimoOk(serie) || INICIOS[serie] - 1) + 1;
  // Si pasaron 'desde' explícito, igual saltamos lo que ya tenemos 'ok'.

  const techo = hasta != null ? hasta : null;
  const stats = {
    serie, desde: n, intentados: 0, ok: 0, no_existe: 0, error: 0,
    nuevas_total: 0, actualizadas_total: 0,
    primer_numero: null, ultimo_numero_ok: null,
  };
  let fallosSeguidos = 0;

  while (true) {
    if (techo != null && n > techo) break;
    if (fallosSeguidos >= maxFallos) {
      stats.cortado_por = `${maxFallos} fallos consecutivos (asumiendo tope publicado)`;
      break;
    }
    const r = await procesarUno({ serie, numero: n, actorId });
    stats.intentados++;
    if (stats.primer_numero == null) stats.primer_numero = n;

    if (r.skipped) {
      // Ya estaba ok — no cuenta como fallo.
      fallosSeguidos = 0;
      stats.ultimo_numero_ok = n;
    } else if (r.ok) {
      stats.ok++;
      stats.nuevas_total += r.stats.nuevas;
      stats.actualizadas_total += r.stats.actualizadas;
      stats.ultimo_numero_ok = n;
      fallosSeguidos = 0;
    } else if (r.motivo === 'no_existe') {
      stats.no_existe++;
      fallosSeguidos++;
    } else {
      stats.error++;
      fallosSeguidos++; // un error también acumula para no quedarnos colgados
    }

    if (typeof onProgreso === 'function') {
      try { onProgreso({ serie, numero: n, resultado: r, stats: { ...stats } }); } catch {}
    }
    n++;
  }
  stats.hasta_intentado = n - 1;
  return stats;
}

// Catch-up de TODAS las series configuradas. Pensado para el cron jueves y
// para el botón "Catch-up automático" del panel.
//
// Las series corren en PARALELO entre sí (typical: 'registros' y 'nuevas'
// usan rangos numéricos distintos del INPI, así que no compiten). Dentro de
// cada serie las descargas siguen secuenciales para no spammear al INPI.
async function correr({ actorId = null, series, desde, hasta, maxFallos, onProgreso } = {}) {
  const lista = (series && series.length) ? series : Object.keys(SERIES);
  const t0 = Date.now();
  const porSerie = await Promise.all(lista.map(serie =>
    catchUpSerie({
      serie,
      desde: desde && desde[serie],
      hasta: hasta && hasta[serie],
      actorId, maxFallos, onProgreso,
    })
  ));
  const resumen = {
    ok: true,
    duracion_ms: Date.now() - t0,
    series: porSerie,
    total_nuevas: porSerie.reduce((s, r) => s + (r.nuevas_total || 0), 0),
    total_actualizadas: porSerie.reduce((s, r) => s + (r.actualizadas_total || 0), 0),
    total_boletines_ok: porSerie.reduce((s, r) => s + (r.ok || 0), 0),
  };
  audit.log(actorId, 'inpi.catch_up', { detalle: resumen });
  return resumen;
}

// Estado para mostrar en el panel.
function estado() {
  const filas = db.prepare(`
    SELECT serie, COUNT(*) AS intentados,
           SUM(estado='ok') AS ok,
           SUM(estado='no_existe') AS no_existe,
           SUM(estado='error') AS errores,
           MAX(CASE WHEN estado='ok' THEN numero END) AS ultimo_ok,
           MAX(numero) AS ultimo_intentado,
           SUM(marcas_nuevas) AS total_nuevas,
           SUM(marcas_actualizadas) AS total_actualizadas
    FROM inpi_sync_log
    GROUP BY serie
  `).all();
  return {
    series_disponibles: Object.fromEntries(
      Object.entries(SERIES).map(([k, v]) => [k, { label: v.label, inicio: INICIOS[k] }])
    ),
    series_log: filas,
  };
}

module.exports = { correr, catchUpSerie, procesarUno, estado, INICIOS, SERIES };
