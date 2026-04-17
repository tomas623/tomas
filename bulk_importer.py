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
import socket
import subprocess
import tempfile
import urllib.request
import urllib.error
from datetime import date, datetime
from typing import Optional
import signal

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import insert as sql_insert

from database import (
    init_db, get_session, get_last_imported_boletin,
    get_import_state, set_import_state,
    Marca, BoletinLog, engine
)
from bulletin_parser import parse_bulletin_bytes, MarcaRecord

# Optional Selenium support for avoiding anti-bot detection
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False

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
MAX_RETRIES = 3              # retries with aggressive timeout handling
BULLETIN_TIMEOUT = 90        # absolute timeout per bulletin (download + parse + import)


def get_headers() -> dict:
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
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


CURL_TIMEOUT = 20        # seconds: curl's absolute --max-time wall-clock limit (more aggressive)
CURL_CONNECT_TIMEOUT = 10  # seconds: timeout for establishing connection
_curl_ok: Optional[bool] = None  # cached availability check
_selenium_driver: Optional[object] = None  # cached driver instance


def _curl_available() -> bool:
    global _curl_ok
    if _curl_ok is None:
        try:
            subprocess.run(["curl", "--version"], capture_output=True, timeout=5, check=True)
            _curl_ok = True
        except Exception:
            _curl_ok = False
    return _curl_ok


def _download_selenium(num: int, retries: int) -> Optional[bytes]:
    """Download using Selenium (real browser) to avoid anti-bot detection."""
    if not SELENIUM_AVAILABLE:
        return None

    global _selenium_driver
    url = BULLETIN_BASE_URL.format(num=num)

    for attempt in range(1, retries + 1):
        try:
            # Initialize driver if needed
            if _selenium_driver is None:
                opts = ChromeOptions()
                opts.add_argument('--headless')
                opts.add_argument('--no-sandbox')
                opts.add_argument('--disable-dev-shm-usage')
                opts.add_argument('--disable-blink-features=AutomationControlled')
                opts.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                try:
                    _selenium_driver = webdriver.Chrome(options=opts)
                except Exception as e:
                    logger.warning(f"Could not init Selenium: {e}")
                    return None

            # Download with timeout
            _selenium_driver.set_page_load_timeout(CURL_TIMEOUT)
            _selenium_driver.get(url)

            # Check if we got redirected to error page
            if '403' in _selenium_driver.page_source or 'not found' in _selenium_driver.page_source.lower():
                logger.debug(f"Bulletin {num}: 404 or 403 via Selenium")
                return None

            # Get PDF via JavaScript execution
            script = f"""
            const url = '{url}';
            const response = await fetch(url);
            const blob = await response.arrayBuffer();
            return new Uint8Array(blob);
            """

            content = _selenium_driver.execute_script(f"""
            return fetch('{url}').then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b)));
            """)

            if content and len(content) > 100:
                pdf_bytes = bytes(content)
                if b'%PDF' in pdf_bytes[:10]:
                    logger.debug(f"Bulletin {num}: downloaded via Selenium ({len(pdf_bytes)} bytes)")
                    return pdf_bytes

        except Exception as e:
            logger.warning(f"Bulletin {num}: Selenium failed - {e} (attempt {attempt}/{retries})")
            if attempt < retries:
                time.sleep(1)

    return None


def download_bulletin(num: int, retries: int = MAX_RETRIES) -> Optional[bytes]:
    """Download bulletin PDF.

    Priority:
    1. Selenium (real browser - avoids anti-bot detection)
    2. curl subprocess (curl's --max-time is absolute wall-clock limit)
    3. urllib (fallback)
    """
    if SELENIUM_AVAILABLE:
        result = _download_selenium(num, retries)
        if result:
            return result
    if _curl_available():
        return _download_curl(num, retries)
    return _download_urllib(num, retries)


def _download_curl(num: int, retries: int) -> Optional[bytes]:
    url = BULLETIN_BASE_URL.format(num=num)
    for attempt in range(1, retries + 1):
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp_path = tmp.name

            # Use connect-timeout + max-time for redundant protection
            result = subprocess.run(
                [
                    "curl", "-sL",
                    "--connect-timeout", str(CURL_CONNECT_TIMEOUT),
                    "--max-time", str(CURL_TIMEOUT),
                    "--retry", "0",
                    "-H", "User-Agent: Mozilla/5.0 (compatible; LegalPacers-research/1.0)",
                    "-H", "Accept: application/pdf,*/*",
                    "-H", "Referer: https://portaltramites.inpi.gob.ar/Boletines?Tipo_Item=3",
                    "-o", tmp_path,
                    "-w", "%{http_code}",
                    url,
                ],
                capture_output=True,
                timeout=CURL_TIMEOUT + 15,  # subprocess timeout > curl timeout
            )

            http_code = result.stdout.decode("ascii", errors="ignore").strip()

            if result.returncode == 28:  # CURLE_OPERATION_TIMEDOUT
                logger.warning(f"Bulletin {num}: curl timeout {CURL_TIMEOUT}s (attempt {attempt}/{retries})")
                if attempt < retries:
                    time.sleep(1)
                continue

            if result.returncode == 7:  # CURLE_COULDNT_CONNECT
                logger.warning(f"Bulletin {num}: connection failed (attempt {attempt}/{retries})")
                if attempt < retries:
                    time.sleep(1)
                continue

            if http_code == "404":
                logger.debug(f"Bulletin {num}: 404")
                return None

            if http_code != "200":
                logger.warning(f"Bulletin {num}: HTTP {http_code} (attempt {attempt}/{retries})")
                if attempt < retries:
                    time.sleep(1)
                continue

            with open(tmp_path, "rb") as f:
                content = f.read()

            if not content or b'%PDF' not in content[:10]:
                logger.warning(f"Bulletin {num}: not a valid PDF (size={len(content) if content else 0})")
                if attempt < retries:
                    time.sleep(1)
                continue

            return content

        except subprocess.TimeoutExpired:
            logger.warning(f"Bulletin {num}: subprocess timeout exceeded (attempt {attempt}/{retries})")
        except Exception as e:
            logger.warning(f"Bulletin {num}: {e} (attempt {attempt}/{retries})")
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        if attempt < retries:
            time.sleep(1)

    return None


def _download_urllib(num: int, retries: int) -> Optional[bytes]:
    """urllib fallback when curl is unavailable."""
    url = BULLETIN_BASE_URL.format(num=num)
    headers = get_headers()
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status == 404:
                    return None
                if resp.status != 200:
                    break
                content = resp.read()
            if b'%PDF' not in content[:10]:
                return None
            return content
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            logger.warning(f"Bulletin {num}: HTTP {e.code} (attempt {attempt}/{retries})")
        except Exception as e:
            logger.warning(f"Bulletin {num}: {e} (attempt {attempt}/{retries})")
        if attempt < retries:
            time.sleep(2)
    return None


def import_bulletin(num: int, dry_run: bool = False, timeout: int = 90) -> dict:
    """
    Download, parse and import a single bulletin with absolute timeout.

    Returns: {num, status, records_imported, error}
    """
    result = {"num": num, "status": "ok", "records": 0, "error": None}

    # Check if already imported with actual records
    # (skip only if registros > 0 — bulletins with registros=0 may have had a failed upsert)
    with get_session() as s:
        existing = s.query(BoletinLog).filter(
            BoletinLog.numero == num,
            BoletinLog.status == "ok",
            BoletinLog.registros > 0,
        ).first()
        if existing:
            logger.debug(f"Bulletin {num}: already imported ({existing.registros} records), skipping")
            result["status"] = "skip"
            result["records"] = existing.registros
            return result

    start_time = time.time()
    def timeout_handler(signum, frame):
        elapsed = time.time() - start_time
        raise TimeoutError(f"Bulletin {num} processing exceeded {timeout}s (elapsed: {elapsed:.1f}s)")

    # Set absolute timeout
    old_handler = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(timeout)

    try:
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

    except TimeoutError as e:
        logger.error(f"Bulletin {num}: {e}")
        result["status"] = "error"
        result["error"] = str(e)
        _log_bulletin(num, 0, "error", str(e))
        return result
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)


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

    dialect = engine.dialect.name
    if dialect == "postgresql":
        try:
            with engine.begin() as conn:
                stmt = pg_insert(Marca).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["acta", "clase"],
                    set_={
                        "estado": stmt.excluded.estado,
                        "estado_code": stmt.excluded.estado_code,
                        "titular": stmt.excluded.titular,
                        "fecha_vencimiento": stmt.excluded.fecha_vencimiento,
                    }
                )
                conn.execute(stmt)
            return len(rows)
        except Exception as ue:
            # PostgreSQL aborts the entire transaction on error — the original conn is dead.
            # Use a fresh engine.begin() per row so one failure doesn't block the rest.
            logger.warning(f"Batch upsert failed ({ue}), falling back to row-by-row insert")
            count = 0
            for row in rows:
                try:
                    with engine.begin() as c:
                        c.execute(sql_insert(Marca).values(row))
                    count += 1
                except Exception:
                    pass
            return count
    else:
        # SQLite
        count = 0
        for row in rows:
            try:
                with engine.begin() as c:
                    c.execute(sql_insert(Marca).values(row))
                count += 1
            except Exception:
                pass
        return count


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
            # Update before processing so the admin panel shows the current bulletin
            # even while a slow download is in progress
            set_import_state(running=True, current_boletin=num)

            result = import_bulletin(num, dry_run=dry_run)

            if result["status"] == "ok":
                imported += result["records"]
            elif result["status"] == "skip":
                skipped += 1
            elif result["status"] == "error":
                errors += 1

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
