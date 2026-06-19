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
  -- Índice por (primer carácter, longitud) para que el prefilter del chequeo
  -- gratis sea O(log N) en vez de full scan. Acelera buscarEnINPI ~100×.
  CREATE INDEX IF NOT EXISTS idx_marcas_prefilter
    ON marcas_inpi(substr(denominacion_norm, 1, 1), length(denominacion_norm));
  CREATE INDEX IF NOT EXISTS idx_marcas_len
    ON marcas_inpi(length(denominacion_norm));

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

  -- ===== Informes pagos (Sprint 2) =====
  -- Snapshot completo del análisis pago, en cola para revisión humana
  -- antes del envío al cliente (SLA 24hs).
  CREATE TABLE IF NOT EXISTS informes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,

    -- snapshot del solicitante al momento de generar
    marca TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'denominativa',
    clases TEXT,
    rubro TEXT,
    solicitante TEXT,
    email TEXT,

    -- resultados del análisis (JSON serializado)
    informe_json TEXT,
    dominios_json TEXT,
    redes_json TEXT,
    flags_leyes TEXT,

    -- campos denormalizados para listar la cola rápido
    nivel_riesgo TEXT,
    viabilidad_estimada INTEGER,

    -- PDF generado
    pdf_path TEXT,
    pdf_bytes INTEGER,

    -- workflow
    estado TEXT NOT NULL DEFAULT 'pendiente'
      CHECK(estado IN ('pendiente','generando','borrador','revisado','enviado','error')),
    notas_revision TEXT,
    error_msg TEXT,
    revisor_email TEXT,

    -- timestamps
    generado_at TEXT,
    revisado_at TEXT,
    enviado_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_informes_lead ON informes(lead_id);
  CREATE INDEX IF NOT EXISTS idx_informes_estado ON informes(estado, created_at);
`);

// ===== Migraciones incrementales (post-create) =====
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

// Índice único (acta, clase) sobre marcas_inpi para habilitar UPSERT en la
// importación de dumps frescos. Se crea con guard: si por algún motivo hubiera
// duplicados en producción, no rompe el boot — solo loguea y sigue (el import
// caería al modo insert-or-ignore en ese caso).
// Índice único completo (no parcial) para que sirva como target de ON CONFLICT.
// En SQLite los NULL no colisionan entre sí en índices únicos, así que las
// (pocas/nulas) filas sin acta no rompen — solo se deduplican las que tienen
// acta real. Confirmado: 0 actas null/vacías en el dump actual.
//
// Una versión anterior creó este índice como PARCIAL (con WHERE). Un índice
// parcial NO sirve como target de ON CONFLICT, así que si detectamos esa
// versión vieja, la dropeamos y recreamos completa (una sola vez).
try {
  const idxSql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='index' AND name='uniq_marcas_inpi_acta_clase'`
  ).get();
  if (idxSql && /\bWHERE\b/i.test(idxSql.sql || '')) {
    db.exec('DROP INDEX uniq_marcas_inpi_acta_clase');
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_marcas_inpi_acta_clase
           ON marcas_inpi(acta, clase)`);
} catch (e) {
  console.error('[db] No se pudo crear índice único marcas_inpi(acta,clase):', e.message);
}

// Log de sincronización con el INPI. Una fila por (serie, número) intentado:
// nos dice si ya lo procesamos, qué encontramos y qué resultado dio. Habilita
// catch-up histórico sin duplicar trabajo y descubrir el último boletín
// publicado probando números crecientes hasta tener N fallos seguidos.
db.exec(`
  CREATE TABLE IF NOT EXISTS inpi_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serie TEXT NOT NULL,
    numero INTEGER NOT NULL,
    formato TEXT,
    estado TEXT NOT NULL CHECK(estado IN ('ok','no_existe','error')),
    marcas_nuevas INTEGER DEFAULT 0,
    marcas_actualizadas INTEGER DEFAULT 0,
    error_msg TEXT,
    bytes INTEGER,
    duracion_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_inpi_sync_serie_numero
    ON inpi_sync_log(serie, numero);
  CREATE INDEX IF NOT EXISTS idx_inpi_sync_estado
    ON inpi_sync_log(serie, estado, numero);
`);
if (!columnExists('alertas', 'boletin_id')) {
  db.exec(`ALTER TABLE alertas ADD COLUMN boletin_id INTEGER REFERENCES boletines(id)`);
}

// Tabla para tokens de "olvidé mi contraseña". Idempotente.
db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(usuario_id, used_at);
`);

// Idempotencia del scheduler: una alerta por (cliente, marca vigilada, boletín).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_alertas_por_boletin
    ON alertas(usuario_id, marca_vigilada_id, boletin_id)
    WHERE boletin_id IS NOT NULL;
`);

// Marca vigilada: nro de acta/registro y fecha de concesión para calcular
// hitos de DJU (año 5) y renovación (año 10). Idempotentes.
for (const [col, ddl] of [
  ['numero_acta',     `ALTER TABLE marcas_vigiladas ADD COLUMN numero_acta TEXT`],
  ['fecha_concesion', `ALTER TABLE marcas_vigiladas ADD COLUMN fecha_concesion TEXT`],
  // titular = persona/empresa titular de la marca registrada. Si null, se
  // entiende que es el propio cliente. Si tiene valor, es un tercero al que
  // el cliente le presta el servicio (apoderado/abogado representando).
  ['titular',         `ALTER TABLE marcas_vigiladas ADD COLUMN titular TEXT`],
]) {
  if (!columnExists('marcas_vigiladas', col)) db.exec(ddl);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_marcas_fecha_concesion
         ON marcas_vigiladas(fecha_concesion) WHERE fecha_concesion IS NOT NULL`);

// CRM-lite + follow-up: campos de gestión manual sobre la tabla leads.
for (const [col, ddl] of [
  ['pipeline_estado',     `ALTER TABLE leads ADD COLUMN pipeline_estado TEXT NOT NULL DEFAULT 'nuevo'`],
  ['notas',               `ALTER TABLE leads ADD COLUMN notas TEXT`],
  ['proximo_contacto_at', `ALTER TABLE leads ADD COLUMN proximo_contacto_at TEXT`],
  ['asignado_a',          `ALTER TABLE leads ADD COLUMN asignado_a INTEGER REFERENCES usuarios(id)`],
  ['follow_up_at',        `ALTER TABLE leads ADD COLUMN follow_up_at TEXT`],
  ['follow_up_count',     `ALTER TABLE leads ADD COLUMN follow_up_count INTEGER NOT NULL DEFAULT 0`],
  // UTM tracking — el front captura los UTMs de la URL al cargar (y los
  // persiste en sessionStorage), después los manda con cada POST de creación
  // de lead para atribución a campaña.
  ['utm_source',          `ALTER TABLE leads ADD COLUMN utm_source TEXT`],
  ['utm_medium',          `ALTER TABLE leads ADD COLUMN utm_medium TEXT`],
  ['utm_campaign',        `ALTER TABLE leads ADD COLUMN utm_campaign TEXT`],
  ['utm_content',         `ALTER TABLE leads ADD COLUMN utm_content TEXT`],
  ['utm_term',            `ALTER TABLE leads ADD COLUMN utm_term TEXT`],
]) {
  if (!columnExists('leads', col)) db.exec(ddl);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_estado, created_at)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_leads_proximo ON leads(proximo_contacto_at) WHERE proximo_contacto_at IS NOT NULL`);

module.exports = db;
