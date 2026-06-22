// Backup automático de la base SQLite.
//
// Usa "VACUUM INTO" — la forma correcta de snapshot consistente en SQLite:
// copia toda la DB a un archivo nuevo de forma atómica (sin lockear escrituras
// ni corromper si hay transacciones en curso), y de paso la desfragmenta.
// Después comprime con gzip (SQLite comprime ~5-10x) y rota los viejos.
//
// Corre por cron (default 3 AM) y se puede disparar a demanda desde el panel.
// Los backups quedan en data/backups/ dentro del volumen persistente de Railway.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db');
const audit = require('../audit');

const RETENCION = parseInt(process.env.BACKUP_RETENCION || '7', 10); // cuántos conservar

function dirBackups() {
  // db.name es el path del archivo de la DB abierta (better-sqlite3).
  const base = path.dirname(db.name || (process.env.SQLITE_PATH || './data/legalpacers.db'));
  const dir = path.join(base, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listarBackups() {
  const dir = dirBackups();
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('legalpacers-') && f.endsWith('.db.gz'))
    .map(f => {
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      return { archivo: f, path: full, bytes: st.size, fecha: st.mtime.toISOString() };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

async function crear({ actorId = null } = {}) {
  const dir = dirBackups();
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const tmpDb = path.join(dir, `_tmp-${ts}.db`);
  const finalGz = path.join(dir, `legalpacers-${ts}.db.gz`);
  const inicio = Date.now();

  try {
    // 1) Snapshot consistente. Comillas simples escapadas para el path.
    db.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);

    // 2) Comprimir gzip (streaming para no cargar todo en memoria).
    await new Promise((resolve, reject) => {
      const inp = fs.createReadStream(tmpDb);
      const out = fs.createWriteStream(finalGz);
      const gz = zlib.createGzip({ level: 6 });
      inp.on('error', reject); out.on('error', reject); gz.on('error', reject);
      out.on('finish', resolve);
      inp.pipe(gz).pipe(out);
    });

    // 3) Borrar el temp sin comprimir.
    fs.unlinkSync(tmpDb);

    // 4) Rotar: conservar los RETENCION más nuevos, borrar el resto.
    const todos = listarBackups();
    const aBorrar = todos.slice(RETENCION);
    for (const b of aBorrar) {
      try { fs.unlinkSync(b.path); } catch {}
    }

    const bytes = fs.statSync(finalGz).size;
    const stats = {
      archivo: path.basename(finalGz),
      bytes,
      mb: +(bytes / 1024 / 1024).toFixed(2),
      conservados: Math.min(todos.length, RETENCION),
      borrados: aBorrar.length,
      duracion_ms: Date.now() - inicio,
    };
    audit.log(actorId, 'db.backup', { detalle: stats });
    console.log(`[backup-db] OK · ${stats.archivo} (${stats.mb} MB) · ${stats.borrados} viejos borrados`);
    return { ok: true, ...stats };
  } catch (err) {
    try { if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb); } catch {}
    audit.log(actorId, 'db.backup.error', { detalle: { error: err.message } });
    console.error('[backup-db] ERROR:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { crear, listarBackups, dirBackups };
