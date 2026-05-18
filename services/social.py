"""
Chequeo de disponibilidad de handles en redes sociales — informativo.

Instagram y TikTok no exponen API pública para ver disponibilidad de
usernames, pero responden 200 vs 404 en sus URLs públicas. Hacemos un
HTTP HEAD/GET ligero con timeout corto. Si falla, devolvemos 'desconocido'
y la UI muestra "Verificar manualmente".

Para Facebook se podría hacer lo mismo pero requiere login para varios casos,
así que lo dejamos fuera por ahora.

Es informativo: si una plataforma nos bloquea por rate limit o User-Agent,
no rompe el flujo principal.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class HandleStatus:
    plataforma: str          # 'instagram' | 'tiktok'
    handle: str              # con @
    status: str              # 'disponible' | 'tomado' | 'desconocido'
    url: str
    detail: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "plataforma": self.plataforma,
            "handle": self.handle,
            "status": self.status,
            "url": self.url,
            "detail": self.detail,
        }


_USERNAME_RE = re.compile(r"[^a-z0-9._]+")


def normalize_handle(name: str) -> str:
    """Convierte un nombre de marca en un username plausible (lowercase, sin espacios)."""
    s = name.lower().strip()
    repl = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n"}
    for k, v in repl.items():
        s = s.replace(k, v)
    s = _USERNAME_RE.sub("", s)
    return s[:30]


_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
}


def _check_instagram(handle: str) -> HandleStatus:
    url = f"https://www.instagram.com/{handle}/"
    try:
        # Instagram redirige a /accounts/login/ si el user no existe,
        # devuelve 200 directo si existe (con datos en el HTML).
        r = httpx.get(url, headers=_HEADERS, timeout=5.0,
                      follow_redirects=False)
        if r.status_code == 404:
            return HandleStatus("instagram", "@" + handle, "disponible", url)
        if r.status_code in (301, 302) and "login" in (r.headers.get("location", "")):
            return HandleStatus("instagram", "@" + handle, "desconocido", url,
                                "Redirige a login — verificar manualmente")
        if r.status_code == 200:
            # Si la respuesta contiene 'Página no disponible' es 404 mascarado
            text = r.text[:2000]
            if "Sorry, this page isn't available" in text or "no está disponible" in text:
                return HandleStatus("instagram", "@" + handle, "disponible", url)
            return HandleStatus("instagram", "@" + handle, "tomado", url)
        return HandleStatus("instagram", "@" + handle, "desconocido", url,
                            f"HTTP {r.status_code}")
    except Exception as e:
        logger.debug(f"Instagram check {handle}: {e}")
        return HandleStatus("instagram", "@" + handle, "desconocido", url, str(e)[:120])


def _check_tiktok(handle: str) -> HandleStatus:
    url = f"https://www.tiktok.com/@{handle}"
    try:
        r = httpx.get(url, headers=_HEADERS, timeout=5.0,
                      follow_redirects=False)
        if r.status_code == 404:
            return HandleStatus("tiktok", "@" + handle, "disponible", url)
        if r.status_code == 200:
            text = r.text[:5000]
            # TikTok devuelve 200 con HTML especial si no encontró el user
            if "Couldn't find this account" in text or "no se ha encontrado" in text:
                return HandleStatus("tiktok", "@" + handle, "disponible", url)
            return HandleStatus("tiktok", "@" + handle, "tomado", url)
        return HandleStatus("tiktok", "@" + handle, "desconocido", url,
                            f"HTTP {r.status_code}")
    except Exception as e:
        logger.debug(f"TikTok check {handle}: {e}")
        return HandleStatus("tiktok", "@" + handle, "desconocido", url, str(e)[:120])


def check_handles(marca: str) -> list[HandleStatus]:
    """Chequea Instagram y TikTok. Liviano, errores no rompen."""
    h = normalize_handle(marca)
    if not h:
        return []
    return [_check_instagram(h), _check_tiktok(h)]
