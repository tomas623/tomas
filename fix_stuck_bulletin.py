#!/usr/bin/env python3
"""
Utility script to fix stuck bulletin imports.

Usage:
  # Reset import state completely
  python fix_stuck_bulletin.py --reset

  # Skip problematic bulletin and resume from next
  python fix_stuck_bulletin.py --skip 5498

  # Start fresh import from specific number
  python fix_stuck_bulletin.py --fresh --from 5498

  # Mark range as error and resume from after
  python fix_stuck_bulletin.py --skip-range 5498 5510
"""

import sys
import argparse
import logging
from datetime import datetime

from database import (
    init_db, get_session, BoletinLog, ImportState,
    get_last_imported_boletin, set_import_state
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def reset_import_state():
    """Completely reset import state to allow fresh start."""
    logger.info("Resetting import state...")
    set_import_state(running=False, current_boletin=0, last_error=None)
    logger.info("✓ Import state reset. You can now start a new import.")


def skip_bulletin(num: int):
    """Mark a bulletin as skipped so import continues past it."""
    logger.info(f"Marking bulletin {num} as skipped...")
    with get_session() as s:
        existing = s.query(BoletinLog).filter_by(numero=num).first()
        if existing:
            existing.status = "skip"
            existing.error_msg = "Skipped due to persistent timeout"
            existing.imported_at = datetime.utcnow()
            logger.info(f"  Updated existing entry: {existing.status}")
        else:
            s.add(BoletinLog(
                numero=num,
                status="skip",
                registros=0,
                error_msg="Skipped due to persistent timeout",
                imported_at=datetime.utcnow()
            ))
            logger.info(f"  Created new skip entry")
        s.commit()
    logger.info(f"✓ Bulletin {num} marked as skipped")


def skip_range(from_num: int, to_num: int):
    """Mark a range of bulletins as skipped."""
    logger.info(f"Marking bulletins {from_num}–{to_num} as skipped...")
    with get_session() as s:
        for num in range(from_num, to_num + 1):
            existing = s.query(BoletinLog).filter_by(numero=num).first()
            if existing:
                if existing.status == "ok" and existing.registros > 0:
                    logger.debug(f"  Skipping {num}: already has {existing.registros} records")
                    continue
                existing.status = "skip"
                existing.error_msg = "Bulk skipped due to range error"
                existing.imported_at = datetime.utcnow()
            else:
                s.add(BoletinLog(
                    numero=num,
                    status="skip",
                    registros=0,
                    error_msg="Bulk skipped due to range error",
                    imported_at=datetime.utcnow()
                ))
        s.commit()
    logger.info(f"✓ Bulletins {from_num}–{to_num} marked as skipped")


def show_status():
    """Show current import state."""
    try:
        from database import get_import_state
        state = get_import_state()
        total = len([1 for _ in get_session().query(BoletinLog).all()])
        last = get_last_imported_boletin()

        logger.info("=" * 60)
        logger.info("Import Status:")
        logger.info(f"  Running: {state.get('running', False)}")
        logger.info(f"  Current bulletin: {state.get('current_boletin', 0)}")
        logger.info(f"  Last imported: {last}")
        logger.info(f"  Total log entries: {total}")
        if state.get('last_error'):
            logger.info(f"  Last error: {state.get('last_error')}")
        logger.info("=" * 60)
    except Exception as e:
        logger.error(f"Could not read status: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Fix stuck bulletin imports",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--reset", action="store_true", help="Reset import state")
    parser.add_argument("--skip", type=int, help="Skip a specific bulletin")
    parser.add_argument("--skip-range", nargs=2, type=int, metavar=("FROM", "TO"),
                       help="Skip a range of bulletins")
    parser.add_argument("--fresh", action="store_true", help="Mark all as needing fresh import")
    parser.add_argument("--from", dest="from_num", type=int, help="Starting bulletin for fresh import")
    parser.add_argument("--status", action="store_true", help="Show current status")

    args = parser.parse_args()

    # Init DB
    init_db()

    # Show status by default or if requested
    show_status()

    # Execute action
    if args.reset:
        reset_import_state()
    elif args.skip:
        skip_bulletin(args.skip)
    elif args.skip_range:
        skip_range(args.skip_range[0], args.skip_range[1])
    elif args.fresh:
        if args.from_num:
            logger.info(f"Marking all bulletins from {args.from_num} onwards as incomplete...")
            with get_session() as s:
                s.query(BoletinLog).filter(BoletinLog.numero >= args.from_num).delete()
                s.commit()
            logger.info("✓ Cleared import log from that point")
        reset_import_state()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
