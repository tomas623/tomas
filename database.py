"""
Database models and setup for Legal Pacers trademark monitoring.
Uses SQLAlchemy with PostgreSQL (Railway) or SQLite (local dev).
"""

import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Date, DateTime,
    Text, Index, UniqueConstraint, func
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


def init_db():
    """Create all tables if they don't exist."""
    Base.metadata.create_all(engine)
    logger.info("Database tables ready")


def get_session() -> Session:
    """Return a new database session."""
    return Session(engine)


def get_last_imported_boletin() -> int:
    """Return the number of the last successfully imported bulletin."""
    with get_session() as s:
        row = s.query(func.max(BoletinLog.numero)).filter(
            BoletinLog.status == "ok"
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
