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
    """Score 0-1 por coincidencia fonética.

    Reglas:
    - Claves idénticas → 1.0
    - Substring match → 0.85 SOLO si la clave más corta es >=3 chars Y representa
      >=60% de la longitud de la más larga. Sin esto, claves cortas como 'nk'
      (Nike) producen falsos positivos contra cualquier marca con 'nk' adentro.
    - Resto → SequenceMatcher
    """
    ka = phonetic_key_es(a)
    kb = phonetic_key_es(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    short, long = (ka, kb) if len(ka) <= len(kb) else (kb, ka)
    if (len(short) >= 3
            and len(short) / max(1, len(long)) >= 0.6
            and short in long):
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
# Marcas notorias — lista hardcodeada, override en notorious_brands.txt
# ─────────────────────────────────────────────────────────────────────

# Las marcas notorias rompen la barrera de clase: aunque no estén en la
# clase pedida, su protección se extiende. Esta lista no es exhaustiva
# (faltan ~miles), pero cubre los casos más obvios. Para extender:
# crear archivo `notorious_brands.txt` con una marca por línea.

DEFAULT_NOTORIOUS = [
    # Refrescos / bebidas
    "Coca-Cola", "Coca Cola", "Pepsi", "Pepsi-Cola", "Sprite", "Fanta",
    "Red Bull", "Gatorade", "Powerade", "7up", "Schweppes",
    # Alimentos / snacks
    "Nestlé", "Nestle", "Bimbo", "Unilever", "Kraft", "Heinz",
    "Mondelez", "Cadbury", "Hershey", "Kellogg", "Oreo",
    # Indumentaria / deporte
    "Nike", "Adidas", "Puma", "Reebok", "Under Armour", "Converse",
    "Levi's", "Levis", "Lacoste", "Gucci", "Louis Vuitton", "Chanel",
    "Hermès", "Prada", "Versace", "Armani", "Calvin Klein", "Tommy Hilfiger",
    # Tech / software
    "Apple", "Google", "Microsoft", "Amazon", "Facebook", "Meta",
    "Instagram", "WhatsApp", "TikTok", "Twitter", "X.com", "LinkedIn",
    "YouTube", "Netflix", "Spotify", "Uber", "Airbnb", "PayPal",
    "MercadoLibre", "Mercado Libre", "MercadoPago", "Mercado Pago",
    "IBM", "Oracle", "Samsung", "Sony", "LG", "Huawei", "Xiaomi",
    # Autos
    "Mercedes-Benz", "Mercedes Benz", "BMW", "Audi", "Ferrari", "Porsche",
    "Toyota", "Honda", "Ford", "Chevrolet", "Volkswagen", "Tesla",
    # Entretenimiento
    "Disney", "Pixar", "Marvel", "Warner", "HBO", "ESPN",
    # Bancos / pagos
    "Visa", "Mastercard", "American Express", "Santander", "BBVA",
    # Comida rápida
    "McDonald's", "McDonalds", "Burger King", "KFC", "Starbucks",
    "Subway", "Pizza Hut", "Domino's", "Dominos",
    # Argentina locales
    "Quilmes", "Patagonia", "Arcor", "La Serenísima", "La Serenisima",
    "Havanna", "Bagley", "Mostaza", "Despegar",
]


def _load_notorious() -> list[str]:
    base = list(DEFAULT_NOTORIOUS)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notorious_brands.txt")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    name = line.strip()
                    if name and not name.startswith("#"):
                        base.append(name)
        except Exception:
            pass
    return base


_NOTORIOUS_CACHE: Optional[list[str]] = None


def get_notorious_brands() -> list[str]:
    global _NOTORIOUS_CACHE
    if _NOTORIOUS_CACHE is None:
        _NOTORIOUS_CACHE = _load_notorious()
    return _NOTORIOUS_CACHE


def check_notorious(term: str, threshold: float = 0.70) -> list[dict]:
    """Compara el término contra la lista de marcas notorias.

    Devuelve los matches por encima del umbral. Score combinado = promedio
    ponderado (lex 0.6, fon 0.4). Esto evita falsos positivos cuando solo
    una dimensión dispara (ej. fon=0.85 por substring corto pero lex=0.20).
    Pensado para detectar 'coco cola' vs 'Coca-Cola' aunque FTS5 falle.
    """
    if not term or not term.strip():
        return []
    out: list[dict] = []
    seen_normalized: set = set()
    for brand in get_notorious_brands():
        nb = normalize(brand)
        if nb in seen_normalized:
            continue
        seen_normalized.add(nb)
        lex = lexical_score(term, brand)
        fon = phonetic_score(term, brand)
        # Score combinado ponderado: lex pesa más para evitar matches por
        # accidente fonético. Si alguna dimensión es muy alta (>=0.90), la usamos
        # como score directo (caso "Nikee" = "Nike" exacto fonéticamente).
        if max(lex, fon) >= 0.90:
            score = max(lex, fon)
        else:
            score = lex * 0.6 + fon * 0.4
        if score >= threshold:
            out.append({
                "denominacion": brand,
                "score": round(score, 3),
                "scores": {
                    "lexical": round(lex, 3),
                    "fonetica": round(fon, 3),
                },
                "razon": "Marca notoria — protección amplia, rompe la barrera de la clase",
            })
    out.sort(key=lambda x: x["score"], reverse=True)
    return out[:5]


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

        # SQLite: usar FTS5 si está disponible (búsqueda en milisegundos sobre 300k+),
        # con fallback a ILIKE %term% si la tabla FTS no existe.
        rows = _fetch_sqlite_fts(s, term_norm, clases, limit)
        if rows is None:
            like = f"%{term_norm}%"
            q = s.query(Marca).filter(Marca.denominacion.ilike(like))
            if clases:
                q = q.filter(Marca.clase.in_(clases))
            rows = q.limit(limit).all()
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


def _fetch_sqlite_fts(session, term_norm: str, clases, limit: int):
    """SQLite FTS5 query. Returns Marca rows or None if FTS is unavailable."""
    from sqlalchemy import text as sa_text
    from database import Marca

    # FTS5 query syntax: prefix-match each token (e.g. 'nike' → 'nike*')
    tokens = [t for t in term_norm.split() if t]
    if not tokens:
        return None
    fts_query = " ".join(f'"{t}"*' for t in tokens)

    sql = """
        SELECT m.id FROM marcas_fts f
        JOIN marcas m ON m.id = f.rowid
        WHERE marcas_fts MATCH :q
    """
    params = {"q": fts_query, "limit": limit}
    if clases:
        placeholders = ",".join(f":c{i}" for i in range(len(clases)))
        sql += f" AND m.clase IN ({placeholders})"
        for i, c in enumerate(clases):
            params[f"c{i}"] = c
    sql += " ORDER BY rank LIMIT :limit"

    try:
        ids = [r[0] for r in session.execute(sa_text(sql), params).all()]
    except Exception as e:
        logger.warning(f"SQLite FTS query failed, falling back to ILIKE: {e}")
        return None
    if not ids:
        return []
    return session.query(Marca).filter(Marca.id.in_(ids)).all()


# ─────────────────────────────────────────────────────────────────────
# Similitud conceptual con Claude (solo Nivel 2 paga)
# ─────────────────────────────────────────────────────────────────────

CONCEPTUAL_PROMPT = """Aplicá el marco de confundibilidad del INPI a este caso.

Marca consultada: "{marca}"
Descripción del producto/servicio: "{descripcion}"

Marcas a comparar (índice → denominación, clase Niza):
{lista}

Devolvé el JSON array según las instrucciones del system. Incluí TODAS las marcas
de la lista (aunque tengan score bajo). La razón debe ser concreta y nombrar el
criterio aplicado (Mot Vedette, raíz común, marca notoria, traducción, etc.)."""


def _load_confundibilidad_cases() -> str:
    """Carga casos curados desde data/confundibilidad_cases.json y los formatea
    como ejemplos few-shot para el system prompt.

    El archivo es editable por el usuario: cada vez que agregue un caso, el
    sistema aprende sin necesidad de fine-tuning."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "data", "confundibilidad_cases.json")
    if not os.path.exists(path):
        return ""
    try:
        with open(path, encoding="utf-8") as fh:
            cases = json.load(fh)
    except Exception as e:
        logger.warning(f"No pude cargar confundibilidad_cases.json: {e}")
        return ""

    confundibles = [c for c in cases if c.get("tipo") == "confundibles"]
    coexistibles = [c for c in cases if c.get("tipo") == "coexistibles"]

    lines = []
    if confundibles:
        lines.append("\nCASOS CONFUNDIBLES (referencia):")
        for c in confundibles[:30]:
            lines.append(f"- \"{c.get('marca_a')}\" ≈ \"{c.get('marca_b')}\"  "
                         f"— {c.get('razon', '')}")
    if coexistibles:
        lines.append("\nCASOS COEXISTIBLES (referencia):")
        for c in coexistibles[:20]:
            lines.append(f"- \"{c.get('marca_a')}\" ✕ \"{c.get('marca_b')}\"  "
                         f"— {c.get('razon', '')}")
    return "\n".join(lines)


CONFUNDIBILIDAD_SYSTEM = """Sos un experto en derecho marcario argentino (INPI). Tu tarea es
evaluar la similitud entre una marca consultada y marcas existentes según el marco legal
de CONFUNDIBILIDAD que aplica el INPI. Devolvés JSON, sin texto extra.

== MARCO DE CONFUNDIBILIDAD ==

TIPOS DE CONFUSIÓN que tenés que considerar:
- DIRECTA: el consumidor cree que son la misma marca.
- INDIRECTA: cree que vienen de la misma empresa o línea de productos (raíz común,
  estilo particular).
- AMPLIA: cree que existen vínculos económicos / comerciales / jurídicos (franquicia,
  licencia, etc.).

DIMENSIONES DEL COTEJO (cualquiera basta para impedir un registro):
1. GRÁFICA — diseño, colores, tipografía, isologo. Nadie monopoliza figuras genéricas,
   solo la representación particular y estilizada.
2. FONÉTICA — cómo suenan. Importante porque las marcas se piden de viva voz. Considerar
   aliteración, ubicación de las vocales (que son el soporte del sonido), secuencias de
   consonantes. Palabras que se escriben distinto pero suenan igual (ej. "Hasúcar" y
   "Azúcar") son fuertemente confundibles.
3. IDEOLÓGICA / CONCEPTUAL — significado. Detectar:
   - Sinónimos ("Los Criadores" ≈ "Los Ganaderos")
   - Asociación de ideas ("Tigre" ≈ "Pantera")
   - Traducciones siempre que el consumidor medio pueda entenderlas
     ("Norte" ≈ "Notte", "L'Etoile" ≈ "Stella")
   - Antónimos ("Fiel" ≈ "Infiel" — la antonimia crea asociación de ideas)

REGLAS DE APRECIACIÓN:
- COTEJO DE CONJUNTO (no fragmentar): comparar por impresión global, no en pedazos.
  EXCEPCIÓN "Mot Vedette": si hay un elemento dominante que capta toda la atención
  (palabra protagonista o figura central), comparar centrándose en ese elemento.
- APRECIACIÓN SUCESIVA Y PRERREFLEXIVA: NO es un "juego de diferencias" lado a lado.
  Simulá el recuerdo: ver una marca, luego la otra, ¿la segunda evoca espontáneamente
  el recuerdo de la primera?
- MAYOR PESO A LAS SEMEJANZAS QUE A LAS DIFERENCIAS: si la similitud general es alta,
  cambiar una letra rara vez es suficiente para evitar la confusión.
- SÍLABAS — RAÍZ vs DESINENCIA: las primeras sílabas (raíz) tienen mayor impacto en la
  memoria auditiva. Si comparten raíz → riesgo altísimo.
  EXCEPCIÓN marcas débiles: si la raíz es de uso común, genérica o descriptiva
  ("Rapi-" para velocidad, "-farma" para farmacias, "Eco-" para ecológico, "Bio-" para
  biológico, "Tele-"), no se puede monopolizar. En esos casos pesar la desinencia.
- ESPECIALIDAD Y PÚBLICO RELEVANTE: las marcas chocan si se aplican a productos
  iguales / similares / al mismo público. Consumo masivo o bajo precio = compra
  desatenta = más riesgo. Medicamentos / alto valor / B2B profesional = atención
  alta = menos riesgo.
- MARCAS NOTORIAS: si una marca es notoria (muy famosa) — ejemplos paradigmáticos:
  Coca-Cola, Pepsi, Nike, Adidas, Apple, Google, Microsoft, Mercedes-Benz, BMW, Disney,
  McDonald's, Nestlé, Bimbo, Unilever, Procter, IBM, Visa, Amazon — su protección
  ROMPE la barrera de las clases y se extiende a rubros distintos, para evitar el
  aprovechamiento parasitario del prestigio.

== TU ENTREGABLE ==
Devolvés ÚNICAMENTE un JSON array (sin markdown, sin texto extra). Cada elemento:
{"i": <índice numérico>, "score": <0-100>, "razon": "<una línea, max 200 chars>"}

ESCALA DE SCORE:
- 95-100: misma marca / traducción literal / fonéticamente indistinguibles.
- 80-94:  ideológicamente equivalentes o riesgo de confusión claro.
- 60-79:  similitud relevante (algún criterio dispara), análisis fino necesario.
- 30-59:  similitud baja, probablemente coexistible.
- 0-29:   sin similitud significativa.

IMPORTANTE — NO TE DEJES LLEVAR POR LA COINCIDENCIA SUPERFICIAL:
- Si la marca consultada y la candidata comparten el núcleo de denominación
  (ej. "Coca Cola" vs "THE COCA-COLA COMPANY" o "Apple" vs "Apple Inc."),
  el score debe ser MUY ALTO (≥90). Son la misma marca aunque la candidata
  tenga "S.A.", "Company", "Ltd", etc. agregado.
- Si la candidata contiene la marca consultada como núcleo (ej. consultás
  "Verbum" y aparece "Verbum Software"), score alto (75-90).

Tu razón debe nombrar qué criterio se aplicó (ej: "Misma raíz fonética", "Traducción
italiana", "Marca notoria — protección amplia", "Núcleo de denominación coincide").
""" + _load_confundibilidad_cases()


def _call_gemini(prompt: str) -> Optional[str]:
    """Llama a Gemini vía REST. Retorna el texto raw o None si falla.

    Usa la API de Google AI Studio (Generative Language API). Carga el marco
    de confundibilidad como systemInstruction (contexto fijo, no se cuenta
    en cada llamada para tokens del usuario).

    Modelo configurable via GEMINI_MODEL en .env. Default 'gemini-2.5-flash'.
    Si tenés cuenta paga conviene 'gemini-2.5-pro' para análisis más rico.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={api_key}")
    try:
        import httpx
        payload = {
            "systemInstruction": {
                "parts": [{"text": CONFUNDIBILIDAD_SYSTEM}],
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 2000,
                "responseMimeType": "application/json",
            },
        }
        r = httpx.post(url, json=payload, timeout=30.0)
        if r.status_code >= 400:
            logger.warning(f"Gemini HTTP {r.status_code}: {r.text[:300]}")
            return None
        data = r.json()
        candidates = data.get("candidates") or []
        if not candidates:
            logger.warning(f"Gemini sin candidates: {str(data)[:300]}")
            return None
        parts = candidates[0].get("content", {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except Exception as e:
        logger.warning(f"Gemini call falló: {e}")
        return None


def _call_claude(prompt: str) -> Optional[str]:
    """Llama a Claude (Anthropic) con cadena de fallback de modelos."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    preferred = os.getenv("CONCEPTUAL_MODEL", "claude-sonnet-4-6")
    fallbacks = ["claude-sonnet-4-5-20250929", "claude-3-5-sonnet-latest"]
    for model_name in [preferred] + fallbacks:
        try:
            client = _get_anthropic()
            msg = client.messages.create(
                model=model_name, max_tokens=2000,
                system=CONFUNDIBILIDAD_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text.strip()
        except Exception as e:
            err = str(e)
            if "model" in err.lower() and ("not_found" in err.lower() or "invalid" in err.lower()):
                logger.warning(f"Claude {model_name} no disponible, probando fallback")
                continue
            logger.warning(f"Claude {model_name} falló: {err[:300]}")
            return None
    return None


def _parse_conceptual_response(raw_text: str, sample: list) -> dict[int, tuple[float, str]]:
    """Extrae el JSON array de la respuesta y mapea a {row_id: (score, razón)}."""
    cleaned = raw_text
    if cleaned.startswith("```"):
        m_fence = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.DOTALL)
        if m_fence:
            cleaned = m_fence.group(1).strip()
    m = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if not m:
        logger.warning(f"Scoring conceptual: no encontré JSON array. Raw: {raw_text[:300]!r}")
        return {}
    try:
        items = json.loads(m.group(0))
    except Exception as e:
        logger.warning(f"Scoring conceptual: JSON inválido ({e}). Raw: {m.group(0)[:300]!r}")
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


def conceptual_scores(
    marca: str,
    descripcion: str,
    candidates: list[CandidateRow],
    max_candidates: int = 30,
) -> dict[int, tuple[float, str]]:
    """Pide score conceptual 0-1 por candidato vía Gemini → Claude → nada.

    Orden de providers (configurable por CONCEPTUAL_PROVIDER en .env):
      'gemini' (default) → Gemini primero, Claude si falla
      'claude'           → Claude primero, Gemini si falla
      'gemini-only'      → solo Gemini
      'claude-only'      → solo Claude
    """
    if not candidates:
        return {}

    has_gemini = bool(os.getenv("GEMINI_API_KEY"))
    has_claude = bool(os.getenv("ANTHROPIC_API_KEY"))
    if not has_gemini and not has_claude:
        logger.info("Ni GEMINI_API_KEY ni ANTHROPIC_API_KEY seteadas — saltando conceptual")
        return {}

    sample = candidates[:max_candidates]
    lista = "\n".join(
        f"{i}. {c.denominacion}  (clase {c.clase or '?'})"
        for i, c in enumerate(sample)
    )
    prompt = CONCEPTUAL_PROMPT.format(
        marca=marca,
        descripcion=descripcion or "(sin descripción)",
        lista=lista,
    )

    provider = os.getenv("CONCEPTUAL_PROVIDER", "gemini").lower()
    if provider == "claude-only":
        order = ["claude"]
    elif provider == "gemini-only":
        order = ["gemini"]
    elif provider == "claude":
        order = ["claude", "gemini"]
    else:
        order = ["gemini", "claude"]

    for prov in order:
        raw = None
        if prov == "gemini" and has_gemini:
            raw = _call_gemini(prompt)
        elif prov == "claude" and has_claude:
            raw = _call_claude(prompt)
        if not raw:
            continue
        out = _parse_conceptual_response(raw, sample)
        if out:
            logger.info(f"Scoring conceptual OK con {prov}: {len(out)}/{len(sample)} candidatos")
            return out

    logger.warning("Scoring conceptual: ningún provider devolvió resultados")
    return {}


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

        # Si la marca ortográficamente es similar/idéntica, la dimensión
        # conceptual también se considera alta: literalmente son la misma marca.
        # El modelo a veces puntúa 0 pensando "ya está cubierto por léxico" —
        # pero el usuario espera ver alto. Bumpamos según el grado de coincidencia.
        if s_lex >= 0.55 and s_con < s_lex:
            s_con = max(s_con, s_lex * 0.95)
            if not razon:
                razon = ("Marca idéntica" if s_lex >= 0.85
                         else "Núcleo de denominación coincide")

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
