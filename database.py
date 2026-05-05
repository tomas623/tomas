"""
Database models and setup for Legal Pacers trademark monitoring.
Uses SQLAlchemy with PostgreSQL (Railway) or SQLite (local dev).
"""

import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Date, DateTime, Float,
    Text, Index, UniqueConstraint, Boolean, ForeignKey, JSON, func, text
)
from sqlalchemy.orm import DeclarativeBase, Session, relationship
from sqlalchemy.pool import NullPool
import logging

logger = logging.getLogger(__name__)


def get_engine():
    """Get database engine from DATABASE_URL env var, fallback to SQLite."""
    db_url = os.getenv("DATABASE_URL", "sqlite:///marcas.db")
    # Railway uses postgres:// but SQLAlchemy needs postgresql://
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    logger.info(f"DB: {db_url.split('@')[-1] if '@' in db_url else db_url}")
    if "postgresql" in db_url:
        return create_engine(db_url, poolclass=NullPool)
    return create_engine(db_url, connect_args={"check_same_thread": False})


engine = get_engine()


class Base(DeclarativeBase):
    pass


class Marca(Base):
    """Trademark record extracted from INPI bulletin."""

    __tablename__ = "marcas"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    acta        = Column(String(20), nullable=False)          # e.g. "3.123.456"
    denominacion = Column(String(300), nullable=False)
    tipo        = Column(String(100))                          # Denominación, Figurativa, Mixta
    clase       = Column(Integer)                              # Nice class 1-45
    titular     = Column(String(300))
    domicilio   = Column(String(400))
    agente      = Column(String(200))
    estado      = Column(String(80))                           # Solicitud, Registrada, etc.
    estado_code = Column(String(20))                           # tramite / vigente / vencida
    fecha_solicitud  = Column(Date)
    fecha_vencimiento = Column(Date)
    boletin_num = Column(Integer)
    fecha_boletin = Column(Date)
    created_at  = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("acta", "clase", name="uq_acta_clase"),
        Index("ix_denominacion", "denominacion"),
        Index("ix_clase", "clase"),
        Index("ix_boletin", "boletin_num"),
        Index("ix_estado_code", "estado_code"),
    )

    def to_dict(self):
        return {
            "acta": self.acta,
            "denominacion": self.denominacion,
            "tipo": self.tipo or "",
            "clase": self.clase,
            "estado": self.estado or "",
            "estado_code": self.estado_code or "tramite",
            "titulares": self.titular or "",
            "fecha_vencimiento": self.fecha_vencimiento.strftime("%d/%m/%Y") if self.fecha_vencimiento else None,
        }


class BoletinLog(Base):
    """Track which bulletins have been imported."""

    __tablename__ = "boletin_log"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    numero      = Column(Integer, unique=True, nullable=False)
    fecha       = Column(Date)
    registros   = Column(Integer, default=0)   # records imported
    status      = Column(String(20), default="ok")  # ok / error / skip
    imported_at = Column(DateTime, default=datetime.utcnow)
    error_msg   = Column(Text)


class ImportState(Base):
    """Persistent import state stored in DB (survives container restarts)."""
    __tablename__ = "import_state"

    id         = Column(Integer, primary_key=True, default=1)
    running    = Column(Boolean, default=False)
    started_at = Column(DateTime)
    updated_at = Column(DateTime)
    current_boletin = Column(Integer, default=0)
    last_error = Column(Text)


# ─────────────────────────────────────────────────────────────────────
# Modelos del portal de marcas (clientes, consultas, pagos, vigilancia)
# ─────────────────────────────────────────────────────────────────────


class User(Base):
    """Cliente registrado del portal."""

    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    email         = Column(String(200), unique=True, nullable=False, index=True)
    password_hash = Column(String(200))                        # bcrypt; null si solo magic-link
    nombre        = Column(String(200))
    telefono      = Column(String(40))
    email_verified = Column(Boolean, default=False)
    is_admin      = Column(Boolean, default=False)
    created_at    = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime)


class MagicLinkToken(Base):
    """Token de login sin contraseña (magic link enviado por email)."""

    __tablename__ = "magic_link_tokens"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    email      = Column(String(200), nullable=False, index=True)
    token      = Column(String(80), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used_at    = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)


class FreeSearchLog(Base):
    """Una búsqueda gratuita anónima — alimenta el rate-limit por IP."""

    __tablename__ = "free_search_log"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    ip          = Column(String(45), index=True)   # IPv6 max 45 chars
    fingerprint = Column(String(120), index=True)  # opcional, para detectar refresh
    marca       = Column(String(300))
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)


class Lead(Base):
    """Lead capturado en consulta gratuita o formulario de contacto."""

    __tablename__ = "leads"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    email       = Column(String(200), nullable=False, index=True)
    nombre      = Column(String(200))
    telefono    = Column(String(40))
    marca       = Column(String(300))
    descripcion = Column(Text)
    clases      = Column(JSON)             # lista de clases consultadas
    fuente      = Column(String(40))       # 'consulta_gratuita', 'cotizar_registro', 'contacto'
    search_id   = Column(String(80))       # vincula al cache de búsqueda en memoria
    nurtured_step = Column(Integer, default=0)   # último email de nurturing enviado (0/1/2/3)
    nurtured_at = Column(DateTime)
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)


class Consulta(Base):
    """Búsqueda realizada (gratuita o paga)."""

    __tablename__ = "consultas"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    email           = Column(String(200), index=True)
    marca           = Column(String(300), nullable=False)
    descripcion     = Column(Text)
    clases          = Column(JSON)               # [35, 42]
    nivel           = Column(String(20), default="gratuita")   # 'gratuita' | 'completa'
    diagnostico     = Column(String(40))         # 'viable' | 'viable_con_ajustes' | 'riesgo_alto'
    pre_analisis_ia = Column(Text)               # texto generado por Claude
    resultados      = Column(JSON)               # lista completa de coincidencias con score
    pago_id         = Column(Integer, ForeignKey("pagos.id"), nullable=True)
    paid            = Column(Boolean, default=False)
    created_at      = Column(DateTime, default=datetime.utcnow, index=True)
    viewed_at       = Column(DateTime)


class Pago(Base):
    """Registro de pago vía MercadoPago (único o suscripción)."""

    __tablename__ = "pagos"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    email           = Column(String(200), index=True)
    tipo            = Column(String(40), nullable=False)
    # 'consulta_completa' | 'registro' | 'vigilancia_marca' | 'vigilancia_portfolio'
    monto           = Column(Float, nullable=False)
    moneda          = Column(String(10), default="ARS")
    mp_preference_id   = Column(String(80))
    mp_payment_id      = Column(String(80), index=True)
    mp_subscription_id = Column(String(80), index=True)
    status          = Column(String(20), default="pending")
    # 'pending' | 'approved' | 'rejected' | 'cancelled' | 'refunded'
    metadata_json   = Column(JSON)
    created_at      = Column(DateTime, default=datetime.utcnow, index=True)
    paid_at         = Column(DateTime)


class MarcaCliente(Base):
    """Marca propia del cliente (registrada por LegalPacers o ya existente)."""

    __tablename__ = "marcas_cliente"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    denominacion    = Column(String(300), nullable=False)
    clase           = Column(Integer)
    acta            = Column(String(20))
    titular         = Column(String(300))
    estado          = Column(String(80))
    fecha_solicitud   = Column(Date)
    fecha_concesion   = Column(Date)
    fecha_vencimiento = Column(Date)
    notas           = Column(Text)
    created_at      = Column(DateTime, default=datetime.utcnow)


class SuscripcionVigilancia(Base):
    """Suscripción mensual de vigilancia sobre una marca o portfolio."""

    __tablename__ = "suscripciones_vigilancia"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    marca_cliente_id = Column(Integer, ForeignKey("marcas_cliente.id"), nullable=True)
    tipo            = Column(String(20), default="marca")    # 'marca' | 'portfolio'
    status          = Column(String(20), default="active")   # 'active' | 'paused' | 'cancelled'
    monto           = Column(Float, nullable=False)
    mp_subscription_id = Column(String(80), index=True)
    activated_at    = Column(DateTime, default=datetime.utcnow)
    paused_at       = Column(DateTime)
    cancelled_at    = Column(DateTime)
    next_check_at   = Column(DateTime)


class AlertaVigilancia(Base):
    """Alerta de coincidencia detectada en boletín nuevo."""

    __tablename__ = "alertas_vigilancia"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    suscripcion_id  = Column(Integer, ForeignKey("suscripciones_vigilancia.id"))
    marca_cliente_id = Column(Integer, ForeignKey("marcas_cliente.id"))
    marca_nueva_id  = Column(Integer, ForeignKey("marcas.id"))
    marca_nueva_acta         = Column(String(20))
    marca_nueva_denominacion = Column(String(300))
    marca_nueva_clase        = Column(Integer)
    marca_nueva_titular      = Column(String(300))
    score           = Column(Float)
    nivel           = Column(String(20))            # 'alto' | 'medio' | 'bajo'
    boletin_num     = Column(Integer)
    email_sent_at   = Column(DateTime)
    created_at      = Column(DateTime, default=datetime.utcnow, index=True)


def get_import_state() -> dict:
    try:
        with get_session() as s:
            row = s.get(ImportState, 1)
            if not row:
                return {"running": False, "current_boletin": 0, "last_error": None}
            return {
                "running": row.running,
                "current_boletin": row.current_boletin or 0,
                "last_error": row.last_error,
                "started_at": row.started_at.isoformat() if row.started_at else None,
            }
    except Exception:
        return {"running": False, "current_boletin": 0, "last_error": None}


def set_import_state(running: bool, current_boletin: int = None, last_error: str = None):
    try:
        with get_session() as s:
            row = s.get(ImportState, 1)
            if not row:
                row = ImportState(id=1)
                s.add(row)
            row.running = running
            if current_boletin is not None:
                row.current_boletin = current_boletin
            row.last_error = last_error
            row.updated_at = datetime.utcnow()
            if running:
                row.started_at = datetime.utcnow()
            s.commit()
    except Exception as e:
        logger.warning(f"Could not update import state: {e}")


def init_db():
    """Create tables and apply safe additive migrations."""
    Base.metadata.create_all(engine)

    # Safe column migrations — only adds missing columns, never drops anything
    if engine.dialect.name == "postgresql":
        migrations = [
            # extensión trigramas para búsqueda rápida en 300k filas
            "CREATE EXTENSION IF NOT EXISTS pg_trgm",
            "ALTER TABLE boletin_log ADD COLUMN IF NOT EXISTS error_msg TEXT",
            "ALTER TABLE marcas ADD COLUMN IF NOT EXISTS estado_code VARCHAR(20) DEFAULT 'tramite'",
            "ALTER TABLE marcas ADD COLUMN IF NOT EXISTS agente VARCHAR(200)",
            "ALTER TABLE marcas ADD COLUMN IF NOT EXISTS domicilio VARCHAR(400)",
            "ALTER TABLE marcas ADD COLUMN IF NOT EXISTS boletin_num INTEGER",
            "ALTER TABLE marcas ADD COLUMN IF NOT EXISTS fecha_boletin DATE",
            """DO $$ BEGIN
              -- Remove duplicate (acta, clase) pairs keeping the highest id
              DELETE FROM marcas a
              USING marcas b
              WHERE a.id < b.id AND a.acta = b.acta AND a.clase = b.clase;
              -- Now add the unique constraint if missing
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_acta_clase'
              ) THEN
                ALTER TABLE marcas ADD CONSTRAINT uq_acta_clase UNIQUE (acta, clase);
              END IF;
            END $$""",
            # índices de performance para 300k registros + similitud
            "CREATE INDEX IF NOT EXISTS ix_marcas_denominacion_trgm "
            "ON marcas USING GIN (denominacion gin_trgm_ops)",
            "CREATE INDEX IF NOT EXISTS ix_marcas_clase ON marcas (clase)",
            "CREATE INDEX IF NOT EXISTS ix_marcas_estado_code ON marcas (estado_code)",
        ]
        with engine.connect() as conn:
            for sql in migrations:
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception as e:
                    logger.warning(f"Migration skipped: {e}")

    elif engine.dialect.name == "sqlite":
        # FTS5 virtual table for fast text search on 300k+ marcas
        # Without this, ILIKE %term% does a full scan (~20s on 300k rows)
        with engine.connect() as conn:
            try:
                conn.execute(text("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS marcas_fts USING fts5(
                        denominacion,
                        content='marcas',
                        content_rowid='id',
                        tokenize='unicode61 remove_diacritics 2'
                    )
                """))
                conn.execute(text("""
                    CREATE TRIGGER IF NOT EXISTS marcas_ai AFTER INSERT ON marcas BEGIN
                        INSERT INTO marcas_fts(rowid, denominacion) VALUES (new.id, new.denominacion);
                    END
                """))
                conn.execute(text("""
                    CREATE TRIGGER IF NOT EXISTS marcas_ad AFTER DELETE ON marcas BEGIN
                        INSERT INTO marcas_fts(marcas_fts, rowid, denominacion) VALUES('delete', old.id, old.denominacion);
                    END
                """))
                conn.execute(text("""
                    CREATE TRIGGER IF NOT EXISTS marcas_au AFTER UPDATE ON marcas BEGIN
                        INSERT INTO marcas_fts(marcas_fts, rowid, denominacion) VALUES('delete', old.id, old.denominacion);
                        INSERT INTO marcas_fts(rowid, denominacion) VALUES (new.id, new.denominacion);
                    END
                """))
                conn.commit()
                # Backfill if FTS is empty but marcas has rows (one-time, on existing DBs)
                fts_count = conn.execute(text("SELECT COUNT(*) FROM marcas_fts")).scalar()
                marcas_count = conn.execute(text("SELECT COUNT(*) FROM marcas")).scalar()
                if marcas_count and fts_count < marcas_count:
                    logger.info(f"Backfilling FTS index ({marcas_count} rows)…")
                    conn.execute(text(
                        "INSERT INTO marcas_fts(rowid, denominacion) "
                        "SELECT id, denominacion FROM marcas "
                        "WHERE id NOT IN (SELECT rowid FROM marcas_fts)"
                    ))
                    conn.commit()
                    logger.info("FTS backfill complete")
            except Exception as e:
                logger.warning(f"SQLite FTS5 setup skipped: {e}")

    logger.info("Database tables ready")


def get_session() -> Session:
    """Return a new database session."""
    return Session(engine)


def get_last_imported_boletin() -> int:
    """Return the number of the last bulletin that actually imported records (valid INPI range only)."""
    with get_session() as s:
        row = s.query(func.max(BoletinLog.numero)).filter(
            BoletinLog.status == "ok",
            BoletinLog.registros > 0,     # Only advance past bulletins with real records
            BoletinLog.numero <= 10000,   # Ignore invalid numbers from bad runs
        ).scalar()
        return row or 0


def get_last_attempted_boletin() -> int:
    """Return the highest bulletin number that was attempted (any status, including errors).

    Used by resume logic to skip past permanently-failing bulletins rather than
    retrying them on every restart.
    """
    with get_session() as s:
        row = s.query(func.max(BoletinLog.numero)).filter(
            BoletinLog.numero <= 10000,
        ).scalar()
        return row or 0


def search_marcas(term: str, clases: list[int], limit: int = 100) -> list[dict]:
    """
    Search trademarks in local database.

    Args:
        term: Trademark name to search (partial match)
        clases: List of Nice class numbers to filter
        limit: Max results

    Returns:
        List of trademark dicts
    """
    with get_session() as s:
        q = s.query(Marca).filter(
            Marca.denominacion.ilike(f"%{term}%")
        )
        if clases:
            q = q.filter(Marca.clase.in_(clases))
        rows = q.order_by(Marca.denominacion).limit(limit).all()
        return [r.to_dict() for r in rows]


def count_marcas() -> int:
    """Return total number of trademark records in DB."""
    with get_session() as s:
        return s.query(func.count(Marca.id)).scalar() or 0
