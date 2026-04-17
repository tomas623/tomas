#!/usr/bin/env python3
"""Reset problematic bulletins 5497-5500 and restart from 5501."""

from database import init_db, get_session, set_import_state, BoletinLog, Marca
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

init_db()

with get_session() as s:
    # Remove any partial records from problem bulletins
    for num in [5497, 5498, 5499, 5500]:
        # Delete records from this bulletin
        s.query(Marca).filter(Marca.boletin_num == num).delete()
        # Delete log entry
        s.query(BoletinLog).filter(BoletinLog.numero == num).delete()
        logger.info(f"Cleaned up bulletin {num}")
    s.commit()

set_import_state(running=False, current_boletin=5501, last_error=None)
logger.info("✓ Reset complete. Ready to start from 5501+")
