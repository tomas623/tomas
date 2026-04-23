"""
Database models and setup for Legal Pacers trademark monitoring.
Uses SQLAlchemy with PostgreSQL (Railway) or SQLite (local dev).
"""

import os
import re
import unicodedata
from datetime import datetime, timedelta
from sqlalchemy import (
    create_engine, Column, Integer, String, Date, DateTime, Float,
    Text, Index, UniqueConstraint, Boolean, func, text, or_, and_
)
from sqlalchemy.orm import DeclarativeBase, Session
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


class User(Base):
    """App users captured via the email gate + premium subscription state."""

    __tablename__ = "users"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    email               = Column(String(200), unique=True, nullable=False, index=True)
    created_at          = Column(DateTime, default=datetime.utcnow)
    last_search_at      = Column(DateTime)
    searches            = Column(Integer, default=0)
    mp_preapproval_id   = Column(String(100), index=True)
    subscription_status = Column(String(30))    # pending/authorized/paused/cancelled
    premium_until       = Column(DateTime)
    mp_payer_id         = Column(String(100))


class Payment(Base):
    """Log of Mercado Pago authorized_payment events (subscription charges)."""

    __tablename__ = "payments"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    user_id           = Column(Integer, index=True)
    mp_payment_id     = Column(String(100), unique=True, index=True)
    mp_preapproval_id = Column(String(100), index=True)
    status            = Column(String(30))
    amount            = Column(Float)
    currency          = Column(String(5), default="ARS")
    created_at        = Column(DateTime, default=datetime.utcnow)
    raw               = Column(Text)


class RiskCache(Base):
    """Cache of AI risk + suggested-class analysis keyed by (denom, clase)."""

    __tablename__ = "risk_cache"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    denom_norm       = Column(String(300), nullable=False, index=True)
    clase            = Column(Integer, nullable=False, index=True)
    riesgo           = Column(String(10))
    justificacion    = Column(Text)
    clases_sugeridas = Column(Text)  # JSON
    created_at       = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("denom_norm", "clase", name="uq_risk_denom_clase"),
    )


class ImportState(Base):
    """Persistent import state stored in DB (survives container restarts)."""
    __tablename__ = "import_state"

    id         = Column(Integer, primary_key=True, default=1)
    running    = Column(Boolean, default=False)
    started_at = Column(DateTime)
    updated_at = Column(DateTime)
    current_boletin = Column(Integer, default=0)
    last_error = Column(Text)


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
        ]
        with engine.connect() as conn:
            for sql in migrations:
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception as e:
                    logger.warning(f"Migration skipped: {e}")

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


# ─────────────────────────────────────────────────────────────────────
# Email gate + premium subscription helpers
# ─────────────────────────────────────────────────────────────────────

def _normalize(s: str) -> str:
    """Lowercase + strip accents + collapse whitespace. Used for fuzzy/exact match."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s


def upsert_user(email: str) -> "User":
    """Get or create a user row by email."""
    email = (email or "").strip().lower()
    with get_session() as s:
        u = s.query(User).filter(User.email == email).first()
        if not u:
            u = User(email=email)
            s.add(u)
            s.commit()
            s.refresh(u)
        # detach so callers can read attrs after session closes
        s.expunge(u)
        return u


def is_user_premium(email: str) -> bool:
    """True if the user has an active premium window (premium_until in the future)."""
    email = (email or "").strip().lower()
    if not email:
        return False
    with get_session() as s:
        u = s.query(User).filter(User.email == email).first()
        if not u or not u.premium_until:
            return False
        return u.premium_until > datetime.utcnow()


def set_subscription(user_id: int, preapproval_id: str, status: str = "pending"):
    """Record initial preapproval id + status when user clicks 'Suscribirme'."""
    with get_session() as s:
        u = s.get(User, user_id)
        if not u:
            return
        u.mp_preapproval_id = preapproval_id
        u.subscription_status = status
        s.commit()


def update_subscription_status(preapproval_id: str, status: str):
    """Update subscription_status from a preapproval webhook (authorized/paused/cancelled)."""
    with get_session() as s:
        u = s.query(User).filter(User.mp_preapproval_id == preapproval_id).first()
        if not u:
            return
        u.subscription_status = status
        s.commit()


def apply_payment(user_id: int, mp_payment_id: str, mp_preapproval_id: str,
                  status: str, amount: float, raw: str,
                  extend_days: int = 30) -> bool:
    """
    Record an authorized_payment webhook. If approved, extend premium_until +extend_days
    from the later of (now, current premium_until). Idempotent on mp_payment_id.

    Returns True if a new premium extension was applied.
    """
    with get_session() as s:
        existing = s.query(Payment).filter(Payment.mp_payment_id == mp_payment_id).first()
        if existing:
            return False

        p = Payment(
            user_id=user_id,
            mp_payment_id=mp_payment_id,
            mp_preapproval_id=mp_preapproval_id,
            status=status,
            amount=amount,
            raw=raw,
        )
        s.add(p)

        extended = False
        if status == "approved":
            u = s.get(User, user_id)
            if u:
                base = max(u.premium_until or datetime.utcnow(), datetime.utcnow())
                u.premium_until = base + timedelta(days=extend_days)
                if u.subscription_status != "cancelled":
                    u.subscription_status = "authorized"
                extended = True
        s.commit()
        return extended


def grant_premium(user_id: int, days: int = 30):
    """Admin fallback: extend premium_until by N days."""
    with get_session() as s:
        u = s.get(User, user_id)
        if not u:
            return False
        base = max(u.premium_until or datetime.utcnow(), datetime.utcnow())
        u.premium_until = base + timedelta(days=days)
        s.commit()
        return True


def bump_user_search(email: str):
    """Increment searches counter + last_search_at for rate-limit accounting."""
    email = (email or "").strip().lower()
    with get_session() as s:
        u = s.query(User).filter(User.email == email).first()
        if not u:
            return
        u.searches = (u.searches or 0) + 1
        u.last_search_at = datetime.utcnow()
        s.commit()


# ─────────────────────────────────────────────────────────────────────
# Fuzzy + exact trademark availability check
# ─────────────────────────────────────────────────────────────────────

def verificar_denominacion(term: str, clase: int, fuzzy_threshold: int = 80,
                           limit_similares: int = 100) -> dict:
    """
    Check availability of a trademark denomination in a given Nice class.

    Returns:
      {
        "term": str,
        "term_norm": str,
        "clase": int,
        "exactas": [dict, ...],
        "similares": [dict, ...],        # not exact, ordered by ratio desc
        "similares_count": int,
        "disponible": bool,
      }
    """
    try:
        from rapidfuzz import fuzz
    except ImportError:  # soft fallback if rapidfuzz isn't installed yet
        fuzz = None

    term_norm = _normalize(term)
    clase = int(clase)

    exactas: list[dict] = []
    similares: list[dict] = []

    if not term_norm:
        return {
            "term": term, "term_norm": term_norm, "clase": clase,
            "exactas": [], "similares": [], "similares_count": 0,
            "disponible": False,
        }

    first_char = term_norm[0]
    min_len = max(1, len(term_norm) - 3)
    max_len = len(term_norm) + 3

    with get_session() as s:
        # Candidate set: same class, similar length. We filter first-letter in Python
        # because first-char-of-normalized differs from first-char-of-raw (accents).
        candidates = s.query(Marca).filter(
            Marca.clase == clase,
            func.length(Marca.denominacion) >= min_len,
            func.length(Marca.denominacion) <= max_len,
        ).limit(20000).all()

        for m in candidates:
            denom_norm = _normalize(m.denominacion or "")
            if not denom_norm:
                continue

            if denom_norm == term_norm:
                exactas.append(m.to_dict())
                continue

            if denom_norm[0] != first_char:
                continue

            if fuzz is None:
                continue

            ratio = fuzz.ratio(term_norm, denom_norm)
            if ratio >= fuzzy_threshold:
                d = m.to_dict()
                d["_ratio"] = int(ratio)
                similares.append(d)

    similares.sort(key=lambda d: d.get("_ratio", 0), reverse=True)
    similares = similares[:limit_similares]

    return {
        "term": term,
        "term_norm": term_norm,
        "clase": clase,
        "exactas": exactas,
        "similares": similares,
        "similares_count": len(similares),
        "disponible": len(exactas) == 0,
    }


def get_or_set_risk_cache(denom_norm: str, clase: int, compute_fn) -> dict:
    """
    Fetch cached AI risk analysis or compute it via `compute_fn() -> dict`.

    `compute_fn` must return: {"riesgo": "bajo|medio|alto", "justificacion": str,
    "clases_sugeridas": [{"clase": int, "motivo": str}, ...]}
    """
    import json as _json
    with get_session() as s:
        row = s.query(RiskCache).filter(
            RiskCache.denom_norm == denom_norm,
            RiskCache.clase == clase,
        ).first()
        if row:
            try:
                clases = _json.loads(row.clases_sugeridas or "[]")
            except Exception:
                clases = []
            return {
                "riesgo": row.riesgo,
                "justificacion": row.justificacion,
                "clases_sugeridas": clases,
            }

    result = compute_fn() or {}
    riesgo = (result.get("riesgo") or "").lower()
    if riesgo not in ("bajo", "medio", "alto"):
        riesgo = "medio"
    justificacion = result.get("justificacion") or ""
    clases_sug = result.get("clases_sugeridas") or []

    try:
        with get_session() as s:
            s.add(RiskCache(
                denom_norm=denom_norm,
                clase=clase,
                riesgo=riesgo,
                justificacion=justificacion,
                clases_sugeridas=_json.dumps(clases_sug, ensure_ascii=False),
            ))
            s.commit()
    except Exception as e:
        logger.warning(f"RiskCache write skipped: {e}")

    return {"riesgo": riesgo, "justificacion": justificacion, "clases_sugeridas": clases_sug}
