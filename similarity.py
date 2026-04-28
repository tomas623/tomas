"""
Motor de similitud de marcas para LegalPacers.

Tres dimensiones combinadas:

1. **Ortográfica/visual**  → trigramas (pg_trgm) + Levenshtein normalizado.
   En PostgreSQL usa la función `similarity()` y el operador `%` que hablan con
   el índice GIN. En SQLite cae a difflib.SequenceMatcher.

2. **Fonética (español)**  → adaptación liviana de Double Metaphone. No usamos
   Soundex porque está pensado para inglés y degrada nombres en español
   (ej. "Ñ", "LL", "RR" no existen en Soundex). Reglas:
     - Vocales se descartan salvo la inicial.
     - 'Ñ' → 'N', 'LL' → 'Y', 'V' → 'B', 'Z'/'C(e,i)' → 'S', 'C(a,o,u)' → 'K',
       'QU' → 'K', 'GU(e,i)' → 'G', 'H' inicial muda → '', 'X' → 'KS'.
     - Se eliminan letras dobles tras normalizar.
   Output: clave fonética; comparamos por igualdad y por substring.

3. **Conceptual**  → Claude (Anthropic) recibe el término del cliente y un
   batch de candidatos (los más relevantes ya filtrados por trigramas) y
   devuelve un score 0-100 por cada uno. Solo se invoca para Nivel 2 (paga)
   y solo sobre los top-N por similitud léxica, para evitar pagar tokens
   innecesarios.

Score final = max(ortografica, fonetica, conceptual)
              + bonus 0.10 si comparte clase
              + bonus 0.05 si la marca está vigente
Cap en 1.0; nivel: alto ≥0.75, medio ≥0.50, bajo en otro caso.
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# Umbrales que también consume el frontend para colorear el resultado
NIVEL_ALTO = 0.75
NIVEL_MEDIO = 0.50

# Anthropic se importa de forma diferida para no romper si la key no está seteada
_anthropic_client = None


def _get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic  # type: ignore
        _anthropic_client = Anthropic()
    return _anthropic_client


# ─────────────────────────────────────────────────────────────────────
# Normalización
# ─────────────────────────────────────────────────────────────────────

def normalize(s: str) -> str:
    """Lower, sin acentos, sin signos, espacios colapsados."""
    if not s:
        return ""
    s = s.lower().strip()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-zñ0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ─────────────────────────────────────────────────────────────────────
# Fonética en español (Double Metaphone simplificado)
# ─────────────────────────────────────────────────────────────────────

def phonetic_key_es(s: str) -> str:
    """Genera una clave fonética para un término en español."""
    s = normalize(s).replace(" ", "")
    if not s:
        return ""

    # Reglas en orden — se aplican como replace globales
    rules = [
        ("ñ", "n"),
        ("ll", "y"),
        ("ch", "x"),     # 'ch' suena distinto a c+h, lo separamos como 'x'
        ("qu", "k"),
        ("gue", "ge"), ("gui", "gi"),
        ("ce", "se"), ("ci", "si"),
        ("ca", "ka"), ("co", "ko"), ("cu", "ku"),
        ("z", "s"),
        ("v", "b"),
        ("x", "ks"),
        ("y", "i"),      # 'y' como vocal entre consonantes
        ("w", "b"),
    ]
    for a, b in rules:
        s = s.replace(a, b)

    # 'h' inicial muda
    if s.startswith("h"):
        s = s[1:]
    # 'h' interna: se mantiene en 'sh'/'ch' originales (ya tratados); el resto cae
    s = s.replace("h", "")

    # Conservar la primera vocal, descartar las internas
    out = []
    for i, ch in enumerate(s):
        if ch in "aeiou":
            if i == 0:
                out.append(ch)
            # vocales internas se eliminan
        else:
            out.append(ch)
    s = "".join(out)

    # Colapsar letras dobles
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def phonetic_score(a: str, b: str) -> float:
    """Score 0-1 por coincidencia fonética."""
    ka = phonetic_key_es(a)
    kb = phonetic_key_es(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    if ka in kb or kb in ka:
        return 0.85
    return SequenceMatcher(None, ka, kb).ratio()


# ─────────────────────────────────────────────────────────────────────
# Ortográfica (trigramas + Levenshtein normalizado)
# ─────────────────────────────────────────────────────────────────────

def lexical_score(a: str, b: str) -> float:
    """Score 0-1 por similitud ortográfica (Python-side fallback)."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


# ─────────────────────────────────────────────────────────────────────
# Búsqueda contra la DB usando pg_trgm (rápida) o ILIKE (fallback SQLite)
# ─────────────────────────────────────────────────────────────────────

@dataclass
class CandidateRow:
    """Fila cruda traída de la DB para evaluación de similitud."""
    id: int
    acta: str
    denominacion: str
    tipo: Optional[str]
    clase: Optional[int]
    titular: Optional[str]
    estado: Optional[str]
    estado_code: Optional[str]
    fecha_solicitud: Optional[str]
    fecha_vencimiento: Optional[str]
    trigram_score: float = 0.0   # solo poblado en Postgres


def fetch_candidates(
    term: str,
    clases: Optional[list[int]] = None,
    limit: int = 200,
    min_trigram: float = 0.20,
) -> list[CandidateRow]:
    """Trae candidatos de la DB ordenados por similitud léxica server-side.

    En PostgreSQL usa el índice GIN sobre pg_trgm: imbatible para 300k filas.
    En SQLite cae a ILIKE %term% sobre los primeros `limit` matches.
    """
    from sqlalchemy import text as sa_text
    from database import engine, get_session, Marca

    term_norm = normalize(term)
    if not term_norm:
        return []

    with get_session() as s:
        if engine.dialect.name == "postgresql":
            # similarity() aprovecha el índice GIN; '%' aplica el threshold global
            q = sa_text("""
                SELECT id, acta, denominacion, tipo, clase, titular, estado,
                       estado_code,
                       to_char(fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
                       to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
                       similarity(unaccent(lower(denominacion)), unaccent(lower(:term))) AS sim
                FROM marcas
                WHERE unaccent(lower(denominacion)) %% unaccent(lower(:term))
                  AND (:has_clases = false OR clase = ANY(:clases))
                ORDER BY sim DESC
                LIMIT :limit
            """)
            try:
                rows = s.execute(q, {
                    "term": term_norm,
                    "has_clases": bool(clases),
                    "clases": clases or [],
                    "limit": limit,
                }).all()
            except Exception as e:
                # unaccent puede no estar instalado; reintentar sin él
                logger.warning(f"pg_trgm con unaccent falló ({e}), reintentando sin unaccent")
                q2 = sa_text("""
                    SELECT id, acta, denominacion, tipo, clase, titular, estado,
                           estado_code,
                           to_char(fecha_solicitud, 'YYYY-MM-DD') AS fecha_solicitud,
                           to_char(fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
                           similarity(lower(denominacion), lower(:term)) AS sim
                    FROM marcas
                    WHERE lower(denominacion) %% lower(:term)
                      AND (:has_clases = false OR clase = ANY(:clases))
                    ORDER BY sim DESC
                    LIMIT :limit
                """)
                rows = s.execute(q2, {
                    "term": term_norm,
                    "has_clases": bool(clases),
                    "clases": clases or [],
                    "limit": limit,
                }).all()

            out: list[CandidateRow] = []
            for r in rows:
                if r.sim < min_trigram:
                    continue
                out.append(CandidateRow(
                    id=r.id, acta=r.acta, denominacion=r.denominacion,
                    tipo=r.tipo, clase=r.clase, titular=r.titular,
                    estado=r.estado, estado_code=r.estado_code,
                    fecha_solicitud=r.fecha_solicitud,
                    fecha_vencimiento=r.fecha_vencimiento,
                    trigram_score=float(r.sim),
                ))
            return out

        # SQLite: prefilter con LIKE %sub% para limitar a algo razonable
        like = f"%{term_norm}%"
        rows = s.query(Marca).filter(
            Marca.denominacion.ilike(like)
        )
        if clases:
            rows = rows.filter(Marca.clase.in_(clases))
        rows = rows.limit(limit).all()
        return [
            CandidateRow(
                id=r.id, acta=r.acta, denominacion=r.denominacion,
                tipo=r.tipo, clase=r.clase, titular=r.titular,
                estado=r.estado, estado_code=r.estado_code,
                fecha_solicitud=(r.fecha_solicitud.isoformat() if r.fecha_solicitud else None),
                fecha_vencimiento=(r.fecha_vencimiento.isoformat() if r.fecha_vencimiento else None),
                trigram_score=lexical_score(term, r.denominacion),
            )
            for r in rows
        ]


# ─────────────────────────────────────────────────────────────────────
# Similitud conceptual con Claude (solo Nivel 2 paga)
# ─────────────────────────────────────────────────────────────────────

CONCEPTUAL_PROMPT = """Sos un experto en marcas de Argentina (INPI). Comparás un término candidato \
con una lista de marcas existentes y devolvés cuán similar es CONCEPTUALMENTE (mismo significado, \
traducción, sinónimo, idea protegida) — NO ortográfica ni fonéticamente.

Devolvé ÚNICAMENTE un JSON array, sin texto extra. Cada elemento debe tener:
  {{"i": <índice numérico>, "score": <0-100>, "razon": "<una línea>"}}

Marca consultada: "{marca}"
Descripción: "{descripcion}"

Marcas a comparar (índice → denominación, clase):
{lista}

Score 90-100 = misma idea / traducción directa.
Score 60-89  = idea cercana o sector idéntico.
Score 30-59  = relación tangencial.
Score 0-29   = sin relación conceptual."""


def conceptual_scores(
    marca: str,
    descripcion: str,
    candidates: list[CandidateRow],
    max_candidates: int = 30,
) -> dict[int, tuple[float, str]]:
    """Pide a Claude un score conceptual 0-1 por cada candidato.

    Solo se invoca con los top-N candidatos para acotar costo. Devuelve
    {row_id: (score_0_1, razon)}. Si la API falla, retorna {} y el caller
    cae al score lexical/fonético.
    """
    if not candidates:
        return {}
    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.info("ANTHROPIC_API_KEY no seteada — saltando scoring conceptual")
        return {}

    sample = candidates[:max_candidates]
    lista = "\n".join(
        f"{i}. {c.denominacion}  (clase {c.clase or '?'})"
        for i, c in enumerate(sample)
    )

    try:
        client = _get_anthropic()
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            messages=[{
                "role": "user",
                "content": CONCEPTUAL_PROMPT.format(
                    marca=marca,
                    descripcion=descripcion or "(sin descripción)",
                    lista=lista,
                ),
            }],
        )
        text = msg.content[0].text.strip()
        # Extraer JSON entre [ ]
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            return {}
        items = json.loads(m.group(0))
    except Exception as e:
        logger.warning(f"Scoring conceptual falló: {e}")
        return {}

    out: dict[int, tuple[float, str]] = {}
    for it in items:
        try:
            i = int(it["i"])
            score = max(0.0, min(1.0, float(it.get("score", 0)) / 100.0))
            razon = (it.get("razon") or "").strip()[:200]
            if 0 <= i < len(sample):
                out[sample[i].id] = (score, razon)
        except Exception:
            continue
    return out


# ─────────────────────────────────────────────────────────────────────
# Orquestador: combina las tres dimensiones
# ─────────────────────────────────────────────────────────────────────

@dataclass
class ScoredMatch:
    """Match con score combinado, listo para serializar al cliente."""
    id: int
    acta: str
    denominacion: str
    tipo: str
    clase: Optional[int]
    titular: str
    estado: str
    estado_code: str
    fecha_solicitud: Optional[str]
    fecha_vencimiento: Optional[str]
    score: float
    nivel: str            # 'alto' | 'medio' | 'bajo'
    score_lex: float
    score_fon: float
    score_con: float
    razon_conceptual: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "acta": self.acta,
            "denominacion": self.denominacion,
            "tipo": self.tipo,
            "clase": self.clase,
            "titular": self.titular,
            "estado": self.estado,
            "estado_code": self.estado_code,
            "fecha_solicitud": self.fecha_solicitud,
            "fecha_vencimiento": self.fecha_vencimiento,
            "score": round(self.score, 3),
            "nivel": self.nivel,
            "scores": {
                "lexical":   round(self.score_lex, 3),
                "fonetica":  round(self.score_fon, 3),
                "conceptual": round(self.score_con, 3),
            },
            "razon_conceptual": self.razon_conceptual,
        }


def _nivel(score: float) -> str:
    if score >= NIVEL_ALTO:
        return "alto"
    if score >= NIVEL_MEDIO:
        return "medio"
    return "bajo"


def search_similar(
    marca: str,
    descripcion: str = "",
    clases: Optional[list[int]] = None,
    limit: int = 50,
    use_ai: bool = False,
    min_score: float = 0.40,
) -> list[ScoredMatch]:
    """Búsqueda completa con análisis de similitud.

    Args:
        marca: nombre de marca a evaluar.
        descripcion: opcional, ayuda al scoring conceptual.
        clases: si se pasa, filtra por estas clases Nice (None = todas).
        limit: máximo de resultados a devolver.
        use_ai: si True, llama a Claude para scoring conceptual (solo paga).
        min_score: descarta resultados por debajo de este score combinado.
    """
    candidates = fetch_candidates(marca, clases=clases, limit=300)
    if not candidates:
        return []

    # Scoring conceptual solo para Nivel 2: top 30 por similitud léxica
    conceptual: dict[int, tuple[float, str]] = {}
    if use_ai:
        ranked = sorted(candidates, key=lambda c: c.trigram_score, reverse=True)
        conceptual = conceptual_scores(marca, descripcion, ranked, max_candidates=30)

    out: list[ScoredMatch] = []
    for c in candidates:
        s_lex = c.trigram_score or lexical_score(marca, c.denominacion)
        s_fon = phonetic_score(marca, c.denominacion)
        s_con, razon = conceptual.get(c.id, (0.0, ""))

        base = max(s_lex, s_fon, s_con)
        bonus = 0.0
        if clases and c.clase in clases:
            bonus += 0.10
        if (c.estado_code or "").lower() == "vigente":
            bonus += 0.05
        score = min(1.0, base + bonus)

        if score < min_score:
            continue

        out.append(ScoredMatch(
            id=c.id, acta=c.acta, denominacion=c.denominacion,
            tipo=c.tipo or "", clase=c.clase,
            titular=c.titular or "", estado=c.estado or "",
            estado_code=c.estado_code or "tramite",
            fecha_solicitud=c.fecha_solicitud,
            fecha_vencimiento=c.fecha_vencimiento,
            score=score, nivel=_nivel(score),
            score_lex=s_lex, score_fon=s_fon, score_con=s_con,
            razon_conceptual=razon,
        ))

    out.sort(key=lambda m: m.score, reverse=True)
    return out[:limit]


def diagnose(matches: Iterable[ScoredMatch]) -> str:
    """Diagnóstico general a partir de los matches.

    'viable'              → ningún match alto y a lo sumo 1 medio.
    'viable_con_ajustes'  → 1+ medio o 1 alto puntual.
    'riesgo_alto'         → 2+ matches altos o coincidencias en clases pedidas.
    """
    altos = sum(1 for m in matches if m.nivel == "alto")
    medios = sum(1 for m in matches if m.nivel == "medio")

    if altos >= 2:
        return "riesgo_alto"
    if altos == 1:
        return "viable_con_ajustes"
    if medios >= 2:
        return "viable_con_ajustes"
    return "viable"
