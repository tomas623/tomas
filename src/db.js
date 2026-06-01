const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'legalpacers.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== Schema =====
// Tablas de la Parte 1 + las 9 tablas del motor de vigilancia (BUILD_SPEC_MOTOR.md §9).
// Todo CREATE TABLE IF NOT EXISTS — idempotente, se puede re-ejecutar sin perder datos.
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

  -- ===== Motor de vigilancia (Parte 2) =====
  CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    cupo_marcas INTEGER NOT NULL,
    precio_mensual INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('admin','operador','cliente')),
    nombre TEXT,
    telefono TEXT,
    pack_id INTEGER REFERENCES packs(id),
    activo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

  CREATE TABLE IF NOT EXISTS boletines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT,
    fecha_publicacion TEXT,
    archivo TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    total_actas INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS marcas_boletin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boletin_id INTEGER REFERENCES boletines(id) ON DELETE CASCADE,
    acta TEXT,
    denominacion TEXT NOT NULL,
    denominacion_norm TEXT NOT NULL,
    clase INTEGER,
    titular TEXT,
    tipo TEXT,
    estado TEXT,
    fecha TEXT,
    imagen_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_marcas_bol_norm ON marcas_boletin(denominacion_norm);
  CREATE INDEX IF NOT EXISTS idx_marcas_bol_clase ON marcas_boletin(clase);

  CREATE TABLE IF NOT EXISTS marcas_vigiladas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    denominacion TEXT NOT NULL,
    denominacion_norm TEXT NOT NULL,
    clases TEXT NOT NULL,
    tipo TEXT,
    logo_path TEXT,
    estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','pausada','en_tramite')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_vig_usuario ON marcas_vigiladas(usuario_id, estado);

  CREATE TABLE IF NOT EXISTS alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    marca_vigilada_id INTEGER NOT NULL REFERENCES marcas_vigiladas(id) ON DELETE CASCADE,
    nivel TEXT NOT NULL CHECK(nivel IN ('alto','medio','bajo')),
    notoria INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'nueva' CHECK(estado IN ('nueva','revisada','accion_tomada','descartada')),
    canal TEXT,
    fundamento TEXT,
    revisada_por INTEGER REFERENCES usuarios(id),
    revisada_en TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alertas_estado ON alertas(usuario_id, estado);

  CREATE TABLE IF NOT EXISTS alerta_candidatos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alerta_id INTEGER NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
    marca_boletin_id INTEGER REFERENCES marcas_boletin(id),
    score INTEGER,
    motivo TEXT,
    gemini_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES usuarios(id),
    accion TEXT NOT NULL,
    entidad TEXT,
    entidad_id INTEGER,
    detalle TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at);

  CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alerta_id INTEGER NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
    canal TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    proveedor_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sesiones_user ON sesiones(usuario_id);
`);

// ===== Migraciones incrementales (post-create) =====
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
if (!columnExists('alertas', 'boletin_id')) {
  db.exec(`ALTER TABLE alertas ADD COLUMN boletin_id INTEGER REFERENCES boletines(id)`);
}
// Idempotencia del scheduler: una alerta por (cliente, marca vigilada, boletín).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_alertas_por_boletin
    ON alertas(usuario_id, marca_vigilada_id, boletin_id)
    WHERE boletin_id IS NOT NULL;
`);

module.exports = db;
