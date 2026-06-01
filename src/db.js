const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'legalpacers.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS marcas_inpi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    denominacion TEXT NOT NULL,
    denominacion_norm TEXT NOT NULL,
    clase INTEGER NOT NULL,
    acta TEXT,
    titular TEXT,
    estado TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_marcas_norm_clase ON marcas_inpi(denominacion_norm, clase);
  CREATE INDEX IF NOT EXISTS idx_marcas_clase ON marcas_inpi(clase);

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    marca TEXT NOT NULL,
    email TEXT,
    telefono TEXT,
    clases TEXT,
    rubro TEXT,
    monto INTEGER,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    payment_ref TEXT,
    external_reference TEXT UNIQUE,
    init_point TEXT,
    pagado_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_leads_external_ref ON leads(external_reference);
  CREATE INDEX IF NOT EXISTS idx_leads_payment_ref ON leads(payment_ref);
`);

module.exports = db;
