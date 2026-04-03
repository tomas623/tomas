"""
INPI Argentina Boletín de Marcas PDF parser.

Extracts trademark records from weekly bulletin PDFs.
Bulletins are at: https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_3_.pdf

INPI bulletin structure:
  Each entry typically contains:
    - Acta number (e.g. "3.123.456" or "3123456")
    - Denomination
    - Type (Denominación de Fantasía / Figurativa / Mixta / etc.)
    - Nice class(es)
    - Applicant/titular name
    - Address
    - Agent (optional)
    - Status section heading (solicitudes / registradas / etc.)
"""

import re
import logging
from datetime import date, datetime
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ── Status section keywords → estado_code mapping ──
SECTION_MAP = {
    "solicitudes publicadas": ("Solicitud publicada", "tramite"),
    "solicitud de registro":  ("Solicitud de registro", "tramite"),
    "marcas registradas":     ("Registrada", "vigente"),
    "se registra":            ("Registrada", "vigente"),
    "registro otorgado":      ("Registrada", "vigente"),
    "renovaciones":           ("Renovación", "vigente"),
    "renovacion":             ("Renovación", "vigente"),
    "oposiciones":            ("Oposición", "oposicion"),
    "oposicion":              ("Oposición", "oposicion"),
    "caducidades":            ("Caducada", "caducada"),
    "caducada":               ("Caducada", "caducada"),
    "abandono":               ("Abandonada", "abandonada"),
    "denegatoria":            ("Denegada", "denegada"),
}

# ── Regex patterns ──
RE_ACTA = re.compile(
    r'\b(?:Acta[:\s#Nº°.]*|N[°º]?\s*)\s*(\d[\d.,/\s]{4,12}\d)',
    re.IGNORECASE
)
RE_ACTA_BARE = re.compile(r'(?:^|\n)\s*(\d{1,2}[.,]\d{3}[.,]\d{3})\b')
RE_CLASE = re.compile(r'\bClase[s]?\s*[:\-]?\s*(\d{1,2})\b', re.IGNORECASE)
RE_CLASE_NUM = re.compile(r'\b(?:cl(?:ase)?\.?\s*)?(\d{1,2})\b')
RE_DATE = re.compile(
    r'\b(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{2,4})\b'
)
RE_TIPO = re.compile(
    r'\b(denominaci[oó]n\s+de\s+fantas[ií]a|denominaci[oó]n|figurativa|mixta|tridimensional|sonora)\b',
    re.IGNORECASE
)


@dataclass
class MarcaRecord:
    acta: str = ""
    denominacion: str = ""
    tipo: str = ""
    clase: Optional[int] = None
    titular: str = ""
    domicilio: str = ""
    agente: str = ""
    estado: str = ""
    estado_code: str = "tramite"
    fecha_solicitud: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    boletin_num: int = 0
    fecha_boletin: Optional[date] = None

    def is_valid(self) -> bool:
        return bool(self.acta and self.denominacion and self.clase)


def parse_bulletin_pdf(pdf_path: str, boletin_num: int) -> list[MarcaRecord]:
    """
    Parse an INPI bulletin PDF and return list of trademark records.

    Args:
        pdf_path: Path to the PDF file
        boletin_num: Bulletin number (used to set boletin_num on records)

    Returns:
        List of MarcaRecord instances
    """
    try:
        import pdfplumber
    except ImportError:
        raise ImportError("pdfplumber required: pip install pdfplumber")

    records = []
    boletin_date = None

    try:
        with pdfplumber.open(pdf_path) as pdf:
            logger.info(f"Bulletin {boletin_num}: {len(pdf.pages)} pages")

            # Collect all text
            full_text = ""
            for page in pdf.pages:
                text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
                full_text += text + "\n"

            # Try to extract bulletin date from first page
            first_page_text = pdf.pages[0].extract_text() or ""
            boletin_date = _extract_date(first_page_text)

            # Parse records from full text
            records = _parse_text(full_text, boletin_num, boletin_date)

    except Exception as e:
        logger.error(f"PDF parse error for bulletin {boletin_num}: {e}")

    logger.info(f"Bulletin {boletin_num}: extracted {len(records)} records")
    return records


def parse_bulletin_bytes(pdf_bytes: bytes, boletin_num: int) -> list[MarcaRecord]:
    """Parse bulletin from bytes (no disk write needed)."""
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp_path = f.name
    try:
        return parse_bulletin_pdf(tmp_path, boletin_num)
    finally:
        os.unlink(tmp_path)


def _parse_text(text: str, boletin_num: int, boletin_date: Optional[date]) -> list[MarcaRecord]:
    """Parse trademark records from extracted bulletin text."""

    records = []
    current_estado = "Solicitud publicada"
    current_estado_code = "tramite"

    # Split into blocks by acta number
    # Each trademark entry starts with an acta number
    blocks = _split_into_blocks(text)

    for block in blocks:
        # Check if block is a section header (changes current estado)
        header_estado, header_code = _detect_section(block)
        if header_estado:
            current_estado = header_estado
            current_estado_code = header_code
            continue

        record = _parse_block(block, current_estado, current_estado_code,
                               boletin_num, boletin_date)
        if record and record.is_valid():
            records.append(record)

    # Deduplicate by acta+clase
    seen = set()
    unique = []
    for r in records:
        key = (r.acta, r.clase)
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return unique


def _split_into_blocks(text: str) -> list[str]:
    """
    Split bulletin text into per-trademark blocks.
    Blocks are separated by acta numbers appearing at start of line.
    """
    lines = text.split('\n')
    blocks = []
    current_block = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Check if line starts a new record (acta number pattern)
        if _is_acta_line(stripped) and current_block:
            blocks.append('\n'.join(current_block))
            current_block = [line]
        else:
            current_block.append(line)

    if current_block:
        blocks.append('\n'.join(current_block))

    return [b for b in blocks if b.strip()]


def _is_acta_line(line: str) -> bool:
    """Check if a line appears to start a new acta record."""
    # Pattern: starts with number like "3.123.456" or "Acta: 3123456"
    if RE_ACTA_BARE.match(line):
        return True
    if RE_ACTA.match(line):
        return True
    return False


def _detect_section(block: str) -> tuple[Optional[str], Optional[str]]:
    """Detect if block is a section header and return (estado, estado_code)."""
    text_lower = block.lower().strip()
    for keyword, (estado, code) in SECTION_MAP.items():
        if keyword in text_lower and len(block) < 120:
            return estado, code
    return None, None


def _parse_block(block: str, estado: str, estado_code: str,
                  boletin_num: int, boletin_date: Optional[date]) -> Optional[MarcaRecord]:
    """Parse a single trademark block into a MarcaRecord."""

    lines = [l.strip() for l in block.split('\n') if l.strip()]
    if not lines:
        return None

    record = MarcaRecord(
        estado=estado,
        estado_code=estado_code,
        boletin_num=boletin_num,
        fecha_boletin=boletin_date,
    )

    full_text = ' '.join(lines)

    # Extract acta number
    acta_match = RE_ACTA.search(full_text) or RE_ACTA_BARE.search(full_text)
    if acta_match:
        record.acta = _normalize_acta(acta_match.group(1))

    # Extract clase
    clase_match = RE_CLASE.search(full_text)
    if clase_match:
        try:
            record.clase = int(clase_match.group(1))
            if not 1 <= record.clase <= 45:
                record.clase = None
        except ValueError:
            pass

    # Extract tipo
    tipo_match = RE_TIPO.search(full_text)
    if tipo_match:
        record.tipo = tipo_match.group(1).title()

    # Extract denomination — usually the prominent text after acta
    record.denominacion = _extract_denomination(lines, record.acta)

    # Extract titular — usually after "Titular:" or "Solicitante:"
    record.titular = _extract_field(full_text, r'(?:Titular|Solicitante|Titulares?)[:\s]+([^\n]+)')

    # Extract domicilio
    record.domicilio = _extract_field(full_text, r'Domicilio[:\s]+([^\n]+)')

    # Extract agente
    record.agente = _extract_field(full_text, r'Agente[:\s]+([^\n]+)')

    # Extract dates
    dates = RE_DATE.findall(full_text)
    if dates:
        record.fecha_solicitud = _parse_date_tuple(dates[0])
    if len(dates) > 1:
        record.fecha_vencimiento = _parse_date_tuple(dates[-1])

    return record


def _normalize_acta(raw: str) -> str:
    """Normalize acta number to consistent format."""
    digits = re.sub(r'[^\d]', '', raw)
    if len(digits) >= 7:
        # Format as X.XXX.XXX
        return f"{digits[-7]}.{digits[-6:-3]}.{digits[-3:]}"
    return digits


def _extract_denomination(lines: list[str], acta: str) -> str:
    """
    Extract trademark denomination from lines.
    Usually the most prominent/longest uppercase word after the acta line.
    """
    candidates = []
    acta_digits = re.sub(r'[^\d]', '', acta)

    for line in lines:
        clean = line.strip()
        # Skip lines that look like acta, class, address, etc.
        if not clean or len(clean) < 2:
            continue
        if acta_digits and acta_digits[-7:] in re.sub(r'[^\d]', '', clean):
            continue
        if re.match(r'^(clase|acta|titular|solicitante|domicilio|agente|tipo)', clean, re.IGNORECASE):
            continue
        if RE_DATE.search(clean):
            continue
        # Prefer uppercase/mixed case words that look like brand names
        if re.search(r'[A-ZÁÉÍÓÚÑ]{2,}', clean):
            candidates.append(clean)

    if not candidates:
        return ""

    # Return shortest candidate that looks like a brand name
    candidates.sort(key=lambda x: len(x))
    return candidates[0][:200] if candidates else ""


def _extract_field(text: str, pattern: str) -> str:
    """Extract a field using regex pattern."""
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        return m.group(1).strip()[:300]
    return ""


def _extract_date(text: str) -> Optional[date]:
    """Extract the first recognizable date from text."""
    m = RE_DATE.search(text)
    if m:
        return _parse_date_tuple(m.groups())
    return None


def _parse_date_tuple(t: tuple) -> Optional[date]:
    """Parse (day, month, year) tuple into date."""
    try:
        d, m, y = int(t[0]), int(t[1]), int(t[2])
        if y < 100:
            y += 2000 if y < 50 else 1900
        if 1 <= m <= 12 and 1 <= d <= 31 and 1990 <= y <= 2035:
            return date(y, m, d)
    except Exception:
        pass
    return None
