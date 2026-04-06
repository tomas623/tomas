"""
INPI Argentina Boletín de Marcas PDF parser.

Real bulletin format uses WIPO/INPI field codes:
  (21) Acta X.XXX.XXX - (51) Clase XX
  (40) [D/M/F/T] (54) TRADEMARK NAME
  (22) DD/MM/YYYY HH:MM:SS - (73) OWNER NAME - COUNTRY *
  (57) GOODS/SERVICES DESCRIPTION
  (74) Ag XXXX - (44) DD/MM/YYYY

Field codes:
  (21) = Application number (Acta)
  (22) = Filing date
  (40) = Mark type: D=Denominativa, M=Mixta, F=Figurativa, T=Tridimensional
  (44) = Publication date in bulletin
  (51) = Nice class
  (54) = Trademark denomination
  (57) = Goods/services
  (73) = Owner/titular
  (74) = Agent code
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
    'marcas nuevas':        ('Solicitud publicada', 'tramite'),
    'solicitudes':          ('Solicitud publicada', 'tramite'),
    'marcas registradas':   ('Registrada', 'vigente'),
    'registradas':          ('Registrada', 'vigente'),
    'registro otorgado':    ('Registrada', 'vigente'),
    'se registra':          ('Registrada', 'vigente'),
    'renovaciones':         ('Renovada', 'vigente'),
    'renovacion':           ('Renovada', 'vigente'),
    'oposiciones':          ('Oposición', 'oposicion'),
    'oposicion':            ('Oposición', 'oposicion'),
    'caducidades':          ('Caducada', 'caducada'),
    'caducada':             ('Caducada', 'caducada'),
    'abandono':             ('Abandonada', 'abandonada'),
    'denegatoria':          ('Denegada', 'denegada'),
    'transferencias':       ('Transferida', 'vigente'),
}

# Entry start: "(21) Acta 3.805.206 - (51) Clase 41"
RE_ENTRY = re.compile(
    r'\(21\)\s*Acta\s+([\d.,\s]{5,20}?)\s*-\s*\(51\)\s*Clase\s*(\d{1,2})',
    re.IGNORECASE
)

# Type + denomination: "(40) D (54) GIOIA MUNDI"
RE_TYPE_NAME = re.compile(
    r'\(40\)\s*([A-Z])\s+\(54\)\s*([^\n\(]*)',
    re.IGNORECASE
)

# Filing date: "(22) 10/09/2019 ..."
RE_FILING_DATE = re.compile(r'\(22\)\s*(\d{2}/\d{2}/\d{4})')

# Owner: "(73) OWNER NAME - AR *"
RE_OWNER = re.compile(
    r'\(73\)\s*(.+?)(?:\s+-\s*[A-Z]{2,3}\s*\*|\s*\*)',
    re.MULTILINE
)

# Publication date: "(44) 03/06/2020"
RE_PUB_DATE = re.compile(r'\(44\)\s*(\d{2}/\d{2}/\d{4})')

# Agent: "(74) Ag 2246"
RE_AGENT = re.compile(r'\(74\)\s*Ag\s*(\d+)', re.IGNORECASE)


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


def _parse_date(s: str) -> Optional[date]:
    try:
        return datetime.strptime(s.strip(), '%d/%m/%Y').date()
    except Exception:
        return None


def _detect_section(text: str) -> tuple:
    """Return (estado, estado_code) from the last section header before this point."""
    text_lower = text.lower()
    last_pos = -1
    result = ('Solicitud publicada', 'tramite')
    for keyword, estado_tuple in SECTION_MAP.items():
        pos = text_lower.rfind(keyword)
        if pos > last_pos:
            last_pos = pos
            result = estado_tuple
    return result


def parse_bulletin_bytes(pdf_bytes: bytes, boletin_num: int) -> List[MarcaRecord]:
    """Parse a bulletin PDF (bytes) and return list of MarcaRecord."""
    try:
        import pdfplumber
    except ImportError:
        logger.error("pdfplumber not installed")
        return []

    records: List[MarcaRecord] = []
    current_section = ('Solicitud publicada', 'tramite')
    accumulated_text = ''  # rolling buffer across pages

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total_pages = len(pdf.pages)
            # Skip last 10 pages (administrative: fees, resolutions)
            pages_to_process = min(total_pages, max(1, total_pages - 10))

            for page_num in range(pages_to_process):
                page_text = pdf.pages[page_num].extract_text() or ''
                if not page_text.strip():
                    continue

                # Update current section from this page's headers
                for keyword, estado_tuple in SECTION_MAP.items():
                    if keyword in page_text.lower():
                        current_section = estado_tuple

                # Accumulate small rolling buffer (2 pages worth)
                # so entries spanning page boundaries are captured
                accumulated_text += '\n' + page_text

                # Parse complete entries from accumulated text
                matches = list(RE_ENTRY.finditer(accumulated_text))
                if len(matches) < 2:
                    # Keep accumulating — not enough entries yet
                    continue

                # Process all entries except the last (might be incomplete)
                for i, m in enumerate(matches[:-1]):
                    chunk_end = matches[i + 1].start()
                    chunk = accumulated_text[m.start():chunk_end]
                    rec = _parse_entry(m, chunk, boletin_num, current_section)
                    if rec:
                        records.append(rec)

                # Keep only text from the last incomplete entry onwards
                accumulated_text = accumulated_text[matches[-1].start():]

            # Process any remaining entries in the buffer
            remaining_matches = list(RE_ENTRY.finditer(accumulated_text))
            for i, m in enumerate(remaining_matches):
                chunk_end = remaining_matches[i + 1].start() if i + 1 < len(remaining_matches) else len(accumulated_text)
                chunk = accumulated_text[m.start():chunk_end]
                rec = _parse_entry(m, chunk, boletin_num, current_section)
                if rec:
                    records.append(rec)

    except Exception as e:
        logger.error(f"Bulletin {boletin_num}: PDF read error — {e}")

    logger.info(f"Bulletin {boletin_num}: extracted {len(records)} records")
    return records


def _parse_entry(m, chunk: str, boletin_num: int, section: tuple) -> Optional['MarcaRecord']:
    """Parse a single trademark entry from a text chunk."""
    # Acta
    acta = m.group(1).strip().replace(' ', '').replace(',', '.')

    # Nice class
    try:
        clase = int(m.group(2))
        if not (1 <= clase <= 45):
            return None
    except (ValueError, TypeError):
        return None

    # Type and denomination
    tipo_code = None
    denominacion = ''
    mt = RE_TYPE_NAME.search(chunk)
    if mt:
        tipo_code = mt.group(1).upper()
        denominacion = mt.group(2).strip()

    tipo = TIPO_MAP.get(tipo_code, tipo_code) if tipo_code else None

    if not denominacion:
        if tipo_code == 'F':
            denominacion = f'[Figurativa] {acta}'
        elif tipo_code in ('M', 'T'):
            denominacion = f'[{tipo or tipo_code}] {acta}'
        else:
            denominacion = acta

    # Filing date
    fecha_solicitud = None
    mf = RE_FILING_DATE.search(chunk)
    if mf:
        fecha_solicitud = _parse_date(mf.group(1))

    # Owner
    titular = None
    mo = RE_OWNER.search(chunk)
    if mo:
        titular = mo.group(1).strip()[:300]

    # Publication date
    fecha_boletin = None
    mp = RE_PUB_DATE.search(chunk)
    if mp:
        fecha_boletin = _parse_date(mp.group(1))

    # Agent
    agente = None
    ma = RE_AGENT.search(chunk)
    if ma:
        agente = f'Ag {ma.group(1)}'

    estado, estado_code = section

    return MarcaRecord(
        acta=acta,
        denominacion=denominacion[:300],
        tipo=tipo,
        clase=clase,
        titular=titular,
        agente=agente,
        estado=estado,
        estado_code=estado_code,
        fecha_solicitud=fecha_solicitud,
        fecha_boletin=fecha_boletin,
        boletin_num=boletin_num,
    )


def parse_bulletin_pdf(pdf_path: str, boletin_num: int) -> List[MarcaRecord]:
    """Parse a bulletin PDF from file path."""
    with open(pdf_path, 'rb') as f:
        return parse_bulletin_bytes(f.read(), boletin_num)
