#!/usr/bin/env python3
"""
Fix stuck import by marking the problematic bulletin as error and restarting.
"""

import logging
from database import init_db, get_session, set_import_state, BoletinLog

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

init_db()

with get_session() as s:
    # Check if 5497 is already logged
    log = s.query(BoletinLog).filter(BoletinLog.numero == 5497).first()
    if log:
        logger.info(f"Bulletin 5497 status: {log.status} ({log.registros} records)")
        # Mark as skip to avoid retrying
        log.status = "skip"
        s.commit()
        logger.info("Marked bulletin 5497 as 'skip'")
    else:
        logger.info("Bulletin 5497 not yet in log, will be skipped on resume")

    # Reset import state to allow restart
    set_import_state(running=False, current_boletin=0, last_error=None)
    logger.info("Import state reset. Ready to restart.")

logger.info("✓ Ready to restart import. Trigger via /api/admin/trigger-import or redeploy.")
