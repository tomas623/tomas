"""
Weekly cron job — imports new INPI bulletins, runs vigilancia, manages subs.

Railway Cron Service setup:
  Command: python cron_weekly.py
  Schedule: 0 8 * * 1   (every Monday at 8am UTC)

Para el recordatorio anual del 21/12 corremos también el daily job. Si querés
máxima precisión podés agendar también cron_daily.py:
  Command: python cron_daily.py
  Schedule: 0 9 * * *   (todos los días a las 9 UTC)
"""

import logging
import sys
from database import init_db
from bulk_importer import import_new_only
from services.vigilancia import (
    run_avisos_vencimiento, run_birthday_greetings,
    run_subscription_maintenance, run_vigilancia,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    logger.info("=== Legal Pacers — Weekly job ===")
    try:
        init_db()
        import_new_only()
        run_vigilancia()
        run_avisos_vencimiento()
        run_subscription_maintenance()
        run_birthday_greetings()
        logger.info("=== Weekly job complete ===")
    except Exception as e:
        logger.error(f"Weekly job failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
