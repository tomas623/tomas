"""
INPI Argentina Boletín de Marcas PDF parser.

Handles two bulletin formats:

1. WIPO field-code format (older bulletins, pre-5494 approx):
   (21) Acta X.XXX.XXX - (51) Clase XX
   (40) D (54) TRADEMARK NAME
   (22) DD/MM/YYYY - (73) OWNER NAME - COUNTRY *

2. Table format (newer bulletins, 5494+ approx):
   Header: Agente Nº  Acta  Titulares  Denominación  Clase  Fecha  Art. Ley
   Row:    988 2580119 DH COM S.A. POP EN VIVO 38 10/05/2023 3 d
   Row:    Part. 3545310 FORSTER HECTOR FABIAN 30 10/05/2023 3 d

pdfplumber flattens column-aligned PDF text to single-space-separated tokens.
We anchor on acta (6–8 digit number) and the class+date tail.
"""

import re
import io
import logging
from datetime import date, datetime
from typing import Optional, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

TIPO_MAP = {
    'D': 'Denominativa',
    'M': 'Mixta',
    'F': 'Figurativa',
    'T': 'Tridimensional',
    'E': 'Especial',
}

SECTION_MAP = {
    'marcas nuevas':      ('Solicitud publicada', 'tramite'),
    'solicitudes':        ('Solicitud publicada', 'tramite'),
    'marcas registradas': ('Registrada', 'vigente'),
    'registradas':        ('Registrada', 'vigente'),
    'registro otorgado':  ('Registrada', 'vigente'),
    'se registra':        ('Registrada', 'vigente'),
    'renovaciones':       ('Renovada', 'vigente'),
    'renovacion':         ('Renovada', 'vigente'),
    'oposiciones':        ('Oposición', 'oposicion'),
    'oposicion':          ('Oposición', 'oposicion'),
    'caducidades':        ('Caducada', 'caducada'),
    'caducada':           ('Caducada', 'caducada'),
    'abandono':           ('Abandonada', 'abandonada'),
    'denegatoria':        ('Denegada', 'denegada'),
    'transferencias':     ('Transferida', 'vigente'),
}

# ── WIPO field-code format ────────────────────────────────────────────────────
RE_ENTRY = re.compile(
    r'\(21\)\s*Acta\s+([\d.,\s]{5,20}?)\s*-\s*\(51\)\s*Clase\s*(\d{1,2})',
    re.IGNORECASE,
)
RE_TYPE_NAME  = re.compile(r'\(40\)\s*([A-Z])\s+\(54\)\s*([^\n\(]*)', re.IGNORECASE)
RE_FILING_DATE = re.compile(r'\(22\)\s*(\d{2}/\d{2}/\d{4})')
RE_OWNER      = re.compile(r'\(73\)\s*(.+?)(?:\s+-\s*[A-Z]{2,3}\s*\*|\s*\*)', re.MULTILINE)
RE_PUB_DATE   = re.compile(r'\(44\)\s*(\d{2}/\d{2}/\d{4})')
RE_AGENT_WIPO = re.compile(r'\(74\)\s*Ag\s*(\d+)', re.IGNORECASE)

# ── Table format ──────────────────────────────────────────────────────────────
# Detects the table column-header line
RE_TABLE_HEADER = re.compile(
    r'Agente\s+N[°º]?\s+Acta\s+Titular',
    re.IGNORECASE,
)

# Data row: agent (2–5 digits) OR "Part."  +  acta (6–8 digits)  +  free text
#           +  clase (1–2 digits, 1–45)  +  date DD/MM/YYYY
# Non-greedy (.+?) finds the earliest valid clase+date tail, leaving the
# titular+denominacion blob in group 3.
RE_TABLE_ROW = re.compile(
    r'^(?:Part\.|(\d{2,5}))\s+'   # group 1: agent num (None if "Part.")
    r'(\d{6,8})\s+'               # group 2: acta
    r'(.+?)\s+'                   # group 3: middle (titular + denominacion)
    r'(\d{1,2})\s+'               # group 4: clase
    r'(\d{2}/\d{2}/\d{4})',       # group 5: fecha
)

# ── Notification-of-Disposition format (bulletins ~5500+) ─────────────────────
# Header (spans several lines, we match the most stable tokens):
#   Tipo de   Número de   Resolu-
#   Agente Nº Acta Clase Titular Denominación Fecha Disposición Nº
#   Trámite   Registro    ción
#
# Data row (columns concentrated on a single line by pdfplumber):
#   Part. 4042690  7 PONCE MARIELA SOLANGE  RALLY GLOBAL  M 3393616 C 12/05/2023
#   1664  4043701  4 WU, MICHELLE FANNY     ZARCO         M 3393113 C 12/05/2023
RE_NOTIF_HEADER = re.compile(
    r'Agente\s+N[°º]?\s+Acta\s+Clase\s+Titular',
    re.IGNORECASE,
)

RE_NOTIF_ROW = re.compile(
    r'^(?:Part\.|(\d{1,5}))\s+'     # group 1: agent num (None if "Part.")
    r'(\d{6,8})\s+'                 # group 2: acta
    r'(\d{1,2})\s+'                 # group 3: clase
    r'(.+?)\s+'                     # group 4: middle (titular + denominacion)
    r'([MDFTE])\s+'                 # group 5: tipo letter
    r'(\d{6,8})\s+'                 # group 6: registro num
    r'[A-Z]\s+'                     # estado/tramite letter (e.g., C)
    r'(\d{2}/\d{2}/\d{4})\b',       # group 7: fecha
)

# Company-suffix patterns used to split "TITULAR DENOMINACION" blob
TITULAR_SUFFIX_RE = re.compile(
    r'\b(?:'
    r'S\.A\.I\.C\.(?:F\.A\.)?'
    r'|S\.C\.A\.'
    r'|S\.R\.L\.'
    r'|LTDA?\.'
    r'|CO\.,?\s+INC\.'
    r'|CO\.,?\s+LTD\.'
    r'|INC\.'
    r'|CORP\.'
    r'|LLC\.'
    r'|S\.A\.'
    r'|AG\.'
    r'|GMBH'
    r'|B\.V\.'
    r')',
    re.IGNORECASE,
)


@dataclass
class MarcaRecord:
    acta: str
    denominacion: str
    tipo: Optional[str] = None
    clase: Optional[int] = None
    titular: Optional[str] = None
    domicilio: Optional[str] = None
    agente: Optional[str] = None
    estado: Optional[str] = None
    estado_code: Optional[str] = None
    fecha_solicitud: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    boletin_num: Optional[int] = None
    fecha_boletin: Optional[date] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_date(s: str) -> Optional[date]:
    try:
        return datetime.strptime(s.strip(), '%d/%m/%Y').date()
    except Exception:
        return None


def _split_titular_denominacion(middle: str):
    """
    Split 'TITULAR DENOMINACION' blob using company-suffix heuristics.
    Returns (titular, denominacion).  titular may be None.
    """
    best_end = -1
    for m in TITULAR_SUFFIX_RE.finditer(middle):
        best_end = m.end()

    if best_end > 0:
        titular = middle[:best_end].strip()
        denominacion = middle[best_end:].strip()
        if denominacion:
            return titular, denominacion

    # No usable split — return whole middle as denominacion
    return None, middle


# ── Public API ────────────────────────────────────────────────────────────────

def parse_bulletin_bytes(pdf_bytes: bytes, boletin_num: int) -> List[MarcaRecord]:
    """Parse a bulletin PDF (bytes) and return a list of MarcaRecord."""
    try:
        import pdfplumber
    except ImportError:
        logger.error("pdfplumber not installed")
        return []

    records: List[MarcaRecord] = []

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total_pages = len(pdf.pages)
            # Skip last 10 pages (admin: fee schedules, resolutions)
            pages_to_process = max(1, total_pages - 10)

            fmt = _detect_format(pdf, pages_to_process)
            logger.info(f"Bulletin {boletin_num}: format={fmt}, pages={pages_to_process}/{total_pages}")

            if fmt == 'wipo':
                records = _parse_wipo(pdf, boletin_num, pages_to_process)
            elif fmt == 'notif':
                records = _parse_notification(pdf, boletin_num, pages_to_process)
            else:
                records = _parse_table(pdf, boletin_num, pages_to_process)

    except Exception as e:
        logger.error(f"Bulletin {boletin_num}: PDF read error — {e}")

    logger.info(f"Bulletin {boletin_num}: extracted {len(records)} records")
    return records


def parse_bulletin_pdf(pdf_path: str, boletin_num: int) -> List[MarcaRecord]:
    """Parse a bulletin PDF from a file path."""
    with open(pdf_path, 'rb') as f:
        return parse_bulletin_bytes(f.read(), boletin_num)


# ── Format detection ──────────────────────────────────────────────────────────

def _detect_format(pdf, pages_to_check: int) -> str:
    """Return 'wipo', 'table', or 'notif' by scanning pages."""
    # Scan up to 60 pages — the bulletin preamble can be ~30 pages long
    for i in range(min(pages_to_check, 60)):
        try:
            text = pdf.pages[i].extract_text() or ''
        except Exception:
            continue
        if RE_ENTRY.search(text):
            return 'wipo'
        if RE_NOTIF_HEADER.search(text):
            return 'notif'
        if RE_TABLE_HEADER.search(text):
            return 'table'
    return 'notif'   # newer bulletins (5500+) default


# ── WIPO parser ───────────────────────────────────────────────────────────────

def _parse_wipo(pdf, boletin_num: int, pages_to_process: int) -> List[MarcaRecord]:
    """Parse WIPO field-code format bulletin."""
    records = []
    current_section = ('Solicitud publicada', 'tramite')
    accumulated_text = ''

    for page_num in range(pages_to_process):
        try:
            page_text = pdf.pages[page_num].extract_text() or ''
        except Exception:
            continue
        if not page_text.strip():
            continue

        for keyword, estado_tuple in SECTION_MAP.items():
            if keyword in page_text.lower():
                current_section = estado_tuple

        accumulated_text += '\n' + page_text
        matches = list(RE_ENTRY.finditer(accumulated_text))
        if len(matches) < 2:
            continue

        for i, m in enumerate(matches[:-1]):
            chunk = accumulated_text[m.start():matches[i + 1].start()]
            rec = _parse_wipo_entry(m, chunk, boletin_num, current_section)
            if rec:
                records.append(rec)

        accumulated_text = accumulated_text[matches[-1].start():]

    # Flush remaining buffer
    remaining = list(RE_ENTRY.finditer(accumulated_text))
    for i, m in enumerate(remaining):
        end = remaining[i + 1].start() if i + 1 < len(remaining) else len(accumulated_text)
        rec = _parse_wipo_entry(m, accumulated_text[m.start():end], boletin_num, current_section)
        if rec:
            records.append(rec)

    return records


def _parse_wipo_entry(m, chunk: str, boletin_num: int, section: tuple) -> Optional[MarcaRecord]:
    acta = m.group(1).strip().replace(' ', '').replace(',', '.')
    try:
        clase = int(m.group(2))
        if not (1 <= clase <= 45):
            return None
    except (ValueError, TypeError):
        return None

    tipo_code = None
    denominacion = ''
    mt = RE_TYPE_NAME.search(chunk)
    if mt:
        tipo_code = mt.group(1).upper()
        denominacion = mt.group(2).strip()

    tipo = TIPO_MAP.get(tipo_code, tipo_code) if tipo_code else None
    if not denominacion:
        denominacion = (
            f'[Figurativa] {acta}' if tipo_code == 'F' else
            f'[{tipo or tipo_code}] {acta}' if tipo_code in ('M', 'T') else
            acta
        )

    fecha_solicitud = None
    mf = RE_FILING_DATE.search(chunk)
    if mf:
        fecha_solicitud = _parse_date(mf.group(1))

    titular = None
    mo = RE_OWNER.search(chunk)
    if mo:
        titular = mo.group(1).strip()[:300]

    fecha_boletin = None
    mp = RE_PUB_DATE.search(chunk)
    if mp:
        fecha_boletin = _parse_date(mp.group(1))

    agente = None
    ma = RE_AGENT_WIPO.search(chunk)
    if ma:
        agente = f'Ag {ma.group(1)}'

    estado, estado_code = section
    return MarcaRecord(
        acta=acta, denominacion=denominacion[:300], tipo=tipo, clase=clase,
        titular=titular, agente=agente, estado=estado, estado_code=estado_code,
        fecha_solicitud=fecha_solicitud, fecha_boletin=fecha_boletin,
        boletin_num=boletin_num,
    )


# ── Table-format parser ───────────────────────────────────────────────────────

def _parse_table(pdf, boletin_num: int, pages_to_process: int) -> List[MarcaRecord]:
    """
    Parse table-format bulletin (5494+).

    Processes each page line by line:
    - Tracks section headers (Marcas Nuevas / Registradas / etc.)
    - Detects table column-header line to enter 'in_table' mode
    - Applies RE_TABLE_ROW to each line in table mode
    """
    records = []
    current_section = ('Solicitud publicada', 'tramite')
    in_table = False

    for page_num in range(pages_to_process):
        try:
            text = pdf.pages[page_num].extract_text() or ''
        except Exception:
            continue
        if not text.strip():
            continue

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            line_lower = line.lower()

            # ── Section header detection ──────────────────────────────────
            matched_section = False
            for keyword, estado in SECTION_MAP.items():
                if keyword in line_lower:
                    current_section = estado
                    in_table = False   # Expect a new table header before rows
                    matched_section = True

            # ── Table header detection ────────────────────────────────────
            if RE_TABLE_HEADER.search(line):
                in_table = True
                continue

            if not in_table:
                continue

            # ── Data row parsing ──────────────────────────────────────────
            m = RE_TABLE_ROW.match(line)
            if not m:
                # Continuation line (wrapped denomination) or noise — skip
                continue

            agent_str = m.group(1)   # None when "Part."
            acta_str  = m.group(2)
            middle    = m.group(3).strip()
            clase_str = m.group(4)
            fecha_str = m.group(5)

            try:
                clase = int(clase_str)
                if not (1 <= clase <= 45):
                    continue
            except (ValueError, TypeError):
                continue

            titular, denominacion = _split_titular_denominacion(middle)
            if not denominacion:
                denominacion = middle

            estado, estado_code = current_section
            agente = f'Ag {agent_str}' if agent_str else 'Part.'

            records.append(MarcaRecord(
                acta=acta_str,
                denominacion=denominacion[:300],
                tipo=None,
                clase=clase,
                titular=titular[:300] if titular else None,
                agente=agente,
                estado=estado,
                estado_code=estado_code,
                fecha_solicitud=_parse_date(fecha_str),
                fecha_boletin=None,
                boletin_num=boletin_num,
            ))

    return records


# ── Notification-of-Disposition parser ────────────────────────────────────────

def _parse_notification(pdf, boletin_num: int, pages_to_process: int) -> List[MarcaRecord]:
    """
    Parse "Notificación de Disposición" format (bulletins ~5500+).

    Columns: Agente Nº | Acta | Clase | Titular | Denominación | Tipo | Registro | Estado | Fecha
    """
    records = []
    # "Notificación de Disposición" rows are registered trademarks
    default_section = ('Registrada', 'vigente')

    for page_num in range(pages_to_process):
        try:
            text = pdf.pages[page_num].extract_text() or ''
        except Exception:
            continue
        if not text.strip():
            continue

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            m = RE_NOTIF_ROW.match(line)
            if not m:
                continue

            agent_str = m.group(1)           # None when "Part."
            acta_str  = m.group(2)
            clase_str = m.group(3)
            middle    = m.group(4).strip()
            tipo_code = m.group(5).upper()
            fecha_str = m.group(7)

            try:
                clase = int(clase_str)
                if not (1 <= clase <= 45):
                    continue
            except (ValueError, TypeError):
                continue

            titular, denominacion = _split_titular_denominacion(middle)
            if not denominacion:
                denominacion = middle
            # Figurative marks: pdfplumber surfaces "************" as placeholder
            if denominacion.strip('*').strip() == '':
                denominacion = f'[Figurativa] {acta_str}'

            estado, estado_code = default_section
            agente = f'Ag {agent_str}' if agent_str else 'Part.'

            records.append(MarcaRecord(
                acta=acta_str,
                denominacion=denominacion[:300],
                tipo=TIPO_MAP.get(tipo_code, tipo_code),
                clase=clase,
                titular=titular[:300] if titular else None,
                agente=agente,
                estado=estado,
                estado_code=estado_code,
                fecha_solicitud=_parse_date(fecha_str),
                fecha_boletin=None,
                boletin_num=boletin_num,
            ))

    return records