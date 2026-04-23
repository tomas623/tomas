"""
Weekly cron job — imports new INPI bulletins.

Railway Cron Service setup:
  Command: python cron_weekly.py
  Schedule: 0 8 * * 1   (every Monday at 8am UTC)
"""

import logging
import sys
from database import init_db
from bulk_importer import import_new_only

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    logger.info("=== Legal Pacers — Weekly INPI Bulletin Import ===")
    try:
        init_db()
        import_new_only()
        logger.info("=== Weekly import complete ===")
    except Exception as e:
        logger.error(f"Weekly import failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
