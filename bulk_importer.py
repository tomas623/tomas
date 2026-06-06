"""
INPI Bulk Importer — downloads and imports all bulletins into the database.

Usage:
  # Import last 10 years (run once):
  python bulk_importer.py --years 10

  # Import specific range:
  python bulk_importer.py --from 5489 --to 6009

  # Import only the latest new bulletin (weekly cron):
  python bulk_importer.py --new-only

  # Dry run (no DB writes):
  python bulk_importer.py --years 1 --dry-run
"""

import os
import sys
import gc
import time
import logging
import argparse
from datetime import date, datetime
from typing import Optional

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import insert as sql_insert

from database import (
    init_db, get_session, get_last_imported_boletin,
    get_import_state, set_import_state,
    Marca, BoletinLog, engine
)
from bulletin_parser import parse_bulletin_bytes, MarcaRecord

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# INPI bulletin constants
BULLETIN_BASE_URL = "https://portaltramites.inpi.gob.ar/Uploads/Boletines/{num}_3_.pdf"
LATEST_BULLETIN = 6009       # Update this or auto-detect
BULLETINS_PER_YEAR = 52
HTTP_DELAY = 1.0             # seconds between requests
MAX_RETRIES = 2              # fewer retries to avoid long hangs


def get_headers() -> dict:
    return {
        "User-Agent": "Mozilla/5.0 (compatible; LegalPacers-research/1.0)",
        "Accept": "application/pdf,*/*",
        "Referer": "https://portaltramites.inpi.gob.ar/Boletines?Tipo_Item=3",
    }


def detect_latest_bulletin() -> int:
    """
    Detect the latest available bulletin number by probing INPI.
    Falls back to LATEST_BULLETIN constant if unreachable.
    """
    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            # Binary search — try a high number, then adjust
            for num in range(LATEST_BULLETIN, LATEST_BULLETIN + 20):
                url = BULLETIN_BASE_URL.format(num=num)
                r = client.head(url, headers=get_headers())
                if r.status_code == 404:
                    return num - 1
                if r.status_code == 200:
                    LATEST_BULLETIN_FOUND = num
            return LATEST_BULLETIN
    except Exception as e:
        logger.warning(f"Could not auto-detect latest bulletin: {e}")
        return LATEST_BULLETIN


def download_bulletin(num: int, retries: int = MAX_RETRIES) -> Optional[bytes]:
    """Download bulletin PDF bytes. Returns None on failure."""
    url = BULLETIN_BASE_URL.format(num=num)

    for attempt in range(1, retries + 1):
        try:
            with httpx.Client(timeout=25, follow_redirects=True) as client:
                r = client.get(url, headers=get_headers())

                if r.status_code == 404:
                    logger.debug(f"Bulletin {num}: not found (404)")
                    return None
                if r.status_code == 200:
                    if b'%PDF' in r.content[:10]:
                        return r.content
                    else:
                        logger.warning(f"Bulletin {num}: response not a PDF")
                        return None
                logger.warning(f"Bulletin {num}: HTTP {r.status_code}")

        except httpx.TimeoutException:
            logger.warning(f"Bulletin {num}: timeout (attempt {attempt}/{retries})")
        except Exception as e:
            logger.warning(f"Bulletin {num}: error {e} (attempt {attempt}/{retries})")

        if attempt < retries:
            time.sleep(2 ** attempt)  # exponential backoff

    return None


def import_bulletin(num: int, dry_run: bool = False) -> dict:
    """
    Download, parse and import a single bulletin.

    Returns: {num, status, records_imported, error}
    """
    result = {"num": num, "status": "ok", "records": 0, "error": None}

    # Check if already imported
    with get_session() as s:
        existing = s.query(BoletinLog).filter_by(numero=num, status="ok").first()
        if existing:
            logger.info(f"Bulletin {num}: already imported ({existing.registros} records)")
            result["status"] = "skip"
            result["records"] = existing.registros
            return result

    # Download
    pdf_bytes = download_bulletin(num)
    if pdf_bytes is None:
        result["status"] = "error"
        result["error"] = "Download failed or not found"
        _log_bulletin(num, 0, "error", result["error"])
        return result

    # Parse
    try:
        records = parse_bulletin_bytes(pdf_bytes, num)
    except Exception as e:
        logger.error(f"Bulletin {num}: parse error — {e}")
        result["status"] = "error"
        result["error"] = str(e)
        _log_bulletin(num, 0, "error", str(e))
        return result

    if not records:
        logger.info(f"Bulletin {num}: parsed OK but 0 records extracted")
        _log_bulletin(num, 0, "ok")
        result["records"] = 0
        return result

    # Import into DB
    if not dry_run:
        imported = _upsert_records(records)
        _log_bulletin(num, imported, "ok")
        result["records"] = imported
        logger.info(f"Bulletin {num}: {imported} records imported")
    else:
        result["records"] = len(records)
        logger.info(f"[DRY RUN] Bulletin {num}: would import {len(records)} records")

    return result


def _upsert_records(records: list[MarcaRecord]) -> int:
    """Upsert trademark records into DB. Returns count inserted/updated."""
    if not records:
        return 0

    rows = [
        {
            "acta": r.acta,
            "denominacion": r.denominacion[:300],
            "tipo": (r.tipo or "")[:100],
            "clase": r.clase,
            "titular": (r.titular or "")[:300],
            "domicilio": (r.domicilio or "")[:400],
            "agente": (r.agente or "")[:200],
            "estado": (r.estado or "")[:80],
            "estado_code": (r.estado_code or "tramite")[:20],
            "fecha_solicitud": r.fecha_solicitud,
            "fecha_vencimiento": r.fecha_vencimiento,
            "boletin_num": r.boletin_num,
            "fecha_boletin": r.fecha_boletin,
            "created_at": datetime.utcnow(),
        }
        for r in records
        if r.acta and r.denominacion and r.clase
    ]

    if not rows:
        return 0

    try:
        with engine.begin() as conn:
            # Use upsert to avoid duplicates
            dialect = engine.dialect.name
            if dialect == "postgresql":
                stmt = pg_insert(Marca).values(rows)
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_acta_clase",
                    set_={
                        "estado": stmt.excluded.estado,
                        "estado_code": stmt.excluded.estado_code,
                        "titular": stmt.excluded.titular,
                        "fecha_vencimiento": stmt.excluded.fecha_vencimiento,
                    }
                )
                conn.execute(stmt)
            else:
                # SQLite — insert or ignore, then update
                for row in rows:
                    try:
                        conn.execute(sql_insert(Marca).values(row))
                    except Exception:
                        pass  # skip duplicates
        return len(rows)
    except Exception as e:
        logger.error(f"DB upsert error: {e}")
        return 0


def _log_bulletin(num: int, records: int, status: str, error: str = None):
    """Log bulletin import result."""
    try:
        with get_session() as s:
            existing = s.query(BoletinLog).filter_by(numero=num).first()
            if existing:
                existing.registros = records
                existing.status = status
                existing.error_msg = error
                existing.imported_at = datetime.utcnow()
            else:
                s.add(BoletinLog(
                    numero=num, registros=records,
                    status=status, error_msg=error
                ))
            s.commit()
    except Exception as e:
        logger.error(f"Could not log bulletin {num}: {e}")


def bulk_import(from_num: int, to_num: int, dry_run: bool = False):
    """Import a range of bulletins."""
    total = to_num - from_num + 1
    logger.info(f"Starting bulk import: bulletins {from_num}–{to_num} ({total} bulletins)")
    set_import_state(running=True, current_boletin=from_num)

    imported = errors = skipped = 0

    try:
        for num in range(from_num, to_num + 1):
            result = import_bulletin(num, dry_run=dry_run)

            if result["status"] == "ok":
                imported += result["records"]
            elif result["status"] == "skip":
                skipped += 1
            elif result["status"] == "error":
                errors += 1

            # Update DB state every 5 bulletins
            if num % 5 == 0:
                set_import_state(running=True, current_boletin=num)

            # Progress log
            done = num - from_num + 1
            pct = done / total * 100
            if done % 10 == 0 or done == total:
                logger.info(f"Progress: {done}/{total} ({pct:.0f}%) — "
                            f"records: {imported}, skipped: {skipped}, errors: {errors}")

            # Free memory after each bulletin
            gc.collect()

            # Rate limiting
            time.sleep(HTTP_DELAY)

    except Exception as e:
        logger.error(f"Bulk import interrupted at bulletin {num}: {e}")
        set_import_state(running=False, current_boletin=num, last_error=str(e))
        return {"imported": imported, "errors": errors, "skipped": skipped}

    set_import_state(running=False, current_boletin=to_num)
    logger.info(f"Bulk import complete: {imported} records, {errors} errors, {skipped} skipped")
    return {"imported": imported, "errors": errors, "skipped": skipped}


def import_new_only():
    """Import only bulletins newer than last imported. Used by weekly cron."""
    last = get_last_imported_boletin()
    latest = detect_latest_bulletin()

    if last >= latest:
        logger.info(f"No new bulletins (last: {last}, latest: {latest})")
        return

    logger.info(f"New bulletins: {last + 1} → {latest}")
    bulk_import(last + 1, latest)


def main():
    parser = argparse.ArgumentParser(description="INPI Bulletin Importer")
    parser.add_argument("--years", type=int, help="Import last N years of bulletins")
    parser.add_argument("--from", dest="from_num", type=int, help="Start bulletin number")
    parser.add_argument("--to", dest="to_num", type=int, help="End bulletin number")
    parser.add_argument("--new-only", action="store_true", help="Only import new bulletins (cron mode)")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't write to DB")
    args = parser.parse_args()

    # Init DB
    init_db()

    if args.new_only:
        import_new_only()
    elif args.years:
        to_num = detect_latest_bulletin()
        from_num = max(1, to_num - (args.years * BULLETINS_PER_YEAR))
        bulk_import(from_num, to_num, dry_run=args.dry_run)
    elif args.from_num and args.to_num:
        bulk_import(args.from_num, args.to_num, dry_run=args.dry_run)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
