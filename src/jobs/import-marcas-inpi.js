// Importador de dumps frescos del INPI a la tabla marcas_inpi (la que usa el
// chequeo público). Hace UPSERT por (acta, clase): agrega marcas nuevas y
// actualiza las existentes (cambios de estado, p.ej. de "Solicitud publicada"
// a "Registrada") SIN borrar el resto del universo.
//
// Lo usan:
//   - El endpoint admin POST /api/admin/marcas-inpi/import (subida manual).
//   - El cron sync-inpi (descarga automática desde INPI_DUMP_URL).
//
// Formato esperado del CSV (header en la primera fila, insensible a may/min):
//   denominacion, clase, acta, titular, estado
//   - denominacion y clase: obligatorias.
//   - acta: recomendada (es la clave del UPSERT). Sin acta, se inserta siempre.
//   - titular, estado: opcionales.

const db = require('../db');
const { normalizar } = require('../matching/etapa1');
const audit = require('../audit');

// Parser CSV con soporte de comillas dobles (RFC 4180).
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  // Saca BOM UTF-8.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); }
      field = ''; row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Toma el texto del CSV y devuelve { stats, errores }.
// stats: { total, nuevas, actualizadas, ignoradas }
function importarCSVText(text, { actorId = null, fuente = 'manual' } = {}) {
  const rows = parseCSV(text).filter(r => r.some(c => c.trim() !== ''));
  if (!rows.length) throw new Error('CSV vacío');

  const header = rows.shift().map(h => h.trim().toLowerCase());
  const idx = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDen = idx('denominacion', 'denominación', 'marca');
  const iClase = idx('clase', 'clases');
  const iActa = idx('acta', 'numero_acta', 'nro acta', 'número de acta');
  const iTit = idx('titular', 'solicitante');
  const iEst = idx('estado');
  if (iDen < 0 || iClase < 0) {
    throw new Error('Faltan columnas obligatorias. El CSV necesita al menos "denominacion" y "clase".');
  }

  // ¿Existe el índice único? Si sí, usamos UPSERT; si no (caso degradado),
  // insert-or-ignore para no romper.
  const tieneUnique = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='index' AND name='uniq_marcas_inpi_acta_clase'`
  ).get();

  const upsert = db.prepare(`
    INSERT INTO marcas_inpi (denominacion, denominacion_norm, clase, acta, titular, estado)
    VALUES (@denominacion, @denominacion_norm, @clase, @acta, @titular, @estado)
    ON CONFLICT(acta, clase)
    DO UPDATE SET
      denominacion = excluded.denominacion,
      denominacion_norm = excluded.denominacion_norm,
      titular = excluded.titular,
      estado = excluded.estado
  `);
  const insertPlano = db.prepare(`
    INSERT INTO marcas_inpi (denominacion, denominacion_norm, clase, acta, titular, estado)
    VALUES (@denominacion, @denominacion_norm, @clase, @acta, @titular, @estado)
  `);

  const stats = { total: 0, nuevas: 0, actualizadas: 0, ignoradas: 0 };
  const errores = [];

  // Para distinguir nuevas vs actualizadas contamos changes/lastInsertRowid.
  // SQLite no devuelve "fue insert o update" directamente; comparamos el
  // total de filas antes/después por acta.
  const existeStmt = db.prepare('SELECT 1 FROM marcas_inpi WHERE acta = ? AND clase = ?');

  const tx = db.transaction((filas) => {
    for (const r of filas) {
      const den = (r[iDen] || '').trim();
      const claseRaw = (r[iClase] || '').trim();
      const clase = parseInt(claseRaw, 10);
      if (!den || !Number.isInteger(clase) || clase < 1 || clase > 45) {
        stats.ignoradas++;
        if (errores.length < 50) errores.push({ denominacion: den || '(vacío)', motivo: 'denominación o clase inválida' });
        continue;
      }
      const acta = iActa >= 0 ? (r[iActa] || '').trim() || null : null;
      const titular = iTit >= 0 ? (r[iTit] || '').trim() || null : null;
      const estado = iEst >= 0 ? (r[iEst] || '').trim() || null : 'Solicitada';
      const payload = {
        denominacion: den,
        denominacion_norm: normalizar(den),
        clase,
        acta,
        titular,
        estado,
      };
      stats.total++;
      try {
        if (acta && tieneUnique) {
          const yaExiste = existeStmt.get(acta, clase);
          upsert.run(payload);
          if (yaExiste) stats.actualizadas++; else stats.nuevas++;
        } else {
          insertPlano.run(payload);
          stats.nuevas++;
        }
      } catch (e) {
        stats.ignoradas++;
        if (errores.length < 50) errores.push({ denominacion: den, motivo: e.message });
      }
    }
  });
  tx(rows);

  audit.log(actorId, 'marcas_inpi.import', {
    detalle: { fuente, ...stats, errores: errores.length },
  });

  return { stats, errores };
}

module.exports = { importarCSVText, parseCSV };
