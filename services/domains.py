"""
Disponibilidad de dominios — informativo, no bloquea el flujo.

Estrategia:
- .com  → RDAP de Verisign (gratis, sin API key, ~150ms).
- .com.ar → consulta DNS A/SOA al dominio + heurística:
            si no hay registros DNS y no hay NS, lo consideramos "probablemente disponible".
            NIC.ar no expone RDAP estable, así que esto es lo más confiable sin
            scrapear la web del NIC.

Si la consulta falla (timeout, DNS error), devolvemos status='desconocido' y
seguimos: el resto del flujo no debe romperse por un check informativo.
"""

from __future__ import annotations

import logging
import re
import socket
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class DomainStatus:
    domain: str
    status: str       # 'disponible' | 'tomado' | 'desconocido'
    detail: Optional[str] = None

    def to_dict(self) -> dict:
        return {"domain": self.domain, "status": self.status, "detail": self.detail}


_NORMALIZE_RE = re.compile(r"[^a-z0-9-]+")


def normalize_label(name: str) -> str:
    """Convierte un nombre de marca en un label DNS válido."""
    s = name.lower().strip()
    # Replace acentos básicos
    repl = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n"}
    for k, v in repl.items():
        s = s.replace(k, v)
    s = _NORMALIZE_RE.sub("-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:63]   # límite RFC 1035


def _check_com_via_rdap(domain: str) -> DomainStatus:
    """RDAP de Verisign para .com — gratis, sin API key."""
    try:
        r = httpx.get(
            f"https://rdap.verisign.com/com/v1/domain/{domain}",
            timeout=5.0,
            follow_redirects=True,
        )
        if r.status_code == 404:
            return DomainStatus(domain=domain, status="disponible")
        if r.status_code == 200:
            return DomainStatus(domain=domain, status="tomado",
                                detail="Registrado")
        return DomainStatus(domain=domain, status="desconocido",
                            detail=f"RDAP HTTP {r.status_code}")
    except Exception as e:
        logger.warning(f"RDAP {domain}: {e}")
        return DomainStatus(domain=domain, status="desconocido", detail=str(e))


def _check_dns(domain: str) -> DomainStatus:
    """Chequeo de existencia de un dominio por resolución DNS.

    Si gethostbyname devuelve algo, está tomado. Si no, podría estar libre o
    estar registrado pero sin DNS configurado — marcamos 'desconocido' y la UI
    muestra "No pudimos verificar — consultá en NIC.ar".
    """
    try:
        socket.setdefaulttimeout(3.0)
        socket.gethostbyname(domain)
        return DomainStatus(domain=domain, status="tomado", detail="Tiene DNS activo")
    except socket.gaierror:
        return DomainStatus(domain=domain, status="desconocido",
                            detail="Sin DNS — verificar en NIC.ar")
    except Exception as e:
        return DomainStatus(domain=domain, status="desconocido", detail=str(e))


def check_domains(marca: str) -> list[DomainStatus]:
    """Chequea .com, .com.ar y .ar para una marca."""
    label = normalize_label(marca)
    if not label:
        return []
    out = []
    out.append(_check_com_via_rdap(f"{label}.com"))
    out.append(_check_dns(f"{label}.com.ar"))
    out.append(_check_dns(f"{label}.ar"))
    return out
