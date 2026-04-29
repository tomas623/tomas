"""
Helpers de autenticación.

- Hashing de contraseñas con bcrypt.
- Magic links de un solo uso (válidos 15 minutos).
- Decorador `login_required` que redirige al login si no hay sesión.
- Helper `current_user()` accesible desde rutas y plantillas.

Sesión: usamos `flask.session` (cookies firmadas con SECRET_KEY). Para revocar
una sesión específica basta con limpiar la cookie del cliente o cambiar la
SECRET_KEY (esto último invalida todas las sesiones).
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta
from functools import wraps
from typing import Callable, Optional

import bcrypt
from flask import g, redirect, request, session, url_for

from database import User, MagicLinkToken, get_session

logger = logging.getLogger(__name__)

MAGIC_LINK_TTL_MIN = 15
MAGIC_LINK_TOKEN_LENGTH = 32   # bytes — 64 chars en hex


# ─────────────────────────────────────────────────────────────────────
# Passwords
# ─────────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Hashea una contraseña con bcrypt (12 rondas por default)."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Compara contraseña en texto plano contra hash bcrypt."""
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────
# Magic links
# ─────────────────────────────────────────────────────────────────────

def create_magic_token(email: str) -> str:
    """Crea un magic-link token y lo persiste. Devuelve el token plano."""
    token = secrets.token_urlsafe(MAGIC_LINK_TOKEN_LENGTH)
    with get_session() as s:
        s.add(MagicLinkToken(
            email=email.lower().strip(),
            token=token,
            expires_at=datetime.utcnow() + timedelta(minutes=MAGIC_LINK_TTL_MIN),
        ))
        s.commit()
    return token


def consume_magic_token(token: str) -> Optional[User]:
    """Valida y consume un magic token. Crea el User si no existe.

    Retorna el User autenticado o None si el token es inválido/expirado/usado.
    """
    with get_session() as s:
        mlt = s.query(MagicLinkToken).filter_by(token=token).first()
        if not mlt:
            return None
        if mlt.used_at is not None:
            return None
        if mlt.expires_at < datetime.utcnow():
            return None

        # Buscar o crear el user
        user = s.query(User).filter_by(email=mlt.email).first()
        if user is None:
            user = User(email=mlt.email, email_verified=True)
            s.add(user)
        else:
            user.email_verified = True
        user.last_login_at = datetime.utcnow()

        mlt.used_at = datetime.utcnow()
        s.commit()
        s.refresh(user)
        # detach para usar fuera de la sesión
        s.expunge(user)
        return user


# ─────────────────────────────────────────────────────────────────────
# Sesiones Flask
# ─────────────────────────────────────────────────────────────────────

def login_user(user: User) -> None:
    session.permanent = True
    session["user_id"] = user.id
    session["user_email"] = user.email
    g.current_user = user


def logout_user() -> None:
    session.pop("user_id", None)
    session.pop("user_email", None)
    g.pop("current_user", None)


def current_user() -> Optional[User]:
    """Retorna el User logueado o None. Cachea en flask.g por request."""
    if "current_user" in g:
        return g.current_user
    uid = session.get("user_id")
    if not uid:
        g.current_user = None
        return None
    with get_session() as s:
        u = s.query(User).filter_by(id=uid).first()
        if u:
            s.expunge(u)
        g.current_user = u
        return u


def login_required(view: Callable) -> Callable:
    """Decorador que protege rutas: redirige al login si no hay sesión."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            if request.is_json or request.path.startswith("/api/"):
                return {"ok": False, "error": "auth_required"}, 401
            return redirect(url_for("auth.login_page", next=request.path))
        return view(*args, **kwargs)

    return wrapper


# ─────────────────────────────────────────────────────────────────────
# Linkeo de leads anteriores cuando un user se loguea
# ─────────────────────────────────────────────────────────────────────

def link_pending_records(user: User) -> None:
    """Asocia leads/consultas/pagos previos al user que recién se loguea.

    Cuando alguien hizo una consulta gratis o pagó algo siendo solo email,
    al loguearse queremos que vea esos registros en su dashboard.
    """
    from database import Consulta, Pago

    with get_session() as s:
        s.query(Consulta).filter(
            Consulta.email == user.email,
            Consulta.user_id.is_(None),
        ).update({"user_id": user.id}, synchronize_session=False)

        s.query(Pago).filter(
            Pago.email == user.email,
            Pago.user_id.is_(None),
        ).update({"user_id": user.id}, synchronize_session=False)
        s.commit()
