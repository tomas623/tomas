// Sincronización automática del universo de marcas del INPI.
//
// Descarga un CSV desde INPI_DUMP_URL y lo importa a marcas_inpi con UPSERT
// (ver import-marcas-inpi.js). Pensado para correr cada jueves después de la
// publicación del boletín del INPI.
//
// IMPORTANTE: el INPI no expone un CSV abierto y estándar. INPI_DUMP_URL debe
// apuntar a una fuente que vos controles:
//   - Un export del INPI que subas a un storage (S3, Drive público, etc.).
//   - El output de un scraper propio.
//   - Un proveedor de datos de PI.
// Si INPI_DUMP_URL no está seteada, el cron no se programa (igual que
// puente-python) y la actualización se hace manual desde el panel admin.

const { importarCSVText } = require('./import-marcas-inpi');
const audit = require('../audit');

async function correr() {
  const url = (process.env.INPI_DUMP_URL || '').trim();
  if (!url) {
    return { ok: false, skipped: true, motivo: 'INPI_DUMP_URL no configurada' };
  }

  const headers = {};
  // Token opcional por si la fuente requiere autenticación.
  const token = (process.env.INPI_DUMP_TOKEN || '').trim();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let texto;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    texto = await res.text();
  } catch (err) {
    audit.log(null, 'sync_inpi.error', { detalle: { error: err.message } });
    return { ok: false, error: `No se pudo descargar el dump: ${err.message}` };
  }

  try {
    const { stats, errores } = importarCSVText(texto, { actorId: null, fuente: 'cron_sync_inpi' });
    console.log(`[sync-inpi] OK · total=${stats.total} nuevas=${stats.nuevas} actualizadas=${stats.actualizadas} ignoradas=${stats.ignoradas}`);
    return { ok: true, stats, errores: errores.length };
  } catch (err) {
    audit.log(null, 'sync_inpi.error', { detalle: { error: err.message } });
    return { ok: false, error: `Error al importar: ${err.message}` };
  }
}

module.exports = { correr };
