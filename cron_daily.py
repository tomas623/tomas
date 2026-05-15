"""
Daily cron job — chequea expiración de suscripciones y recordatorio del 21/12.

Liviano: no toca INPI. Pensado para correr todos los días a la misma hora.

Railway Cron Service setup:
  Command: python cron_daily.py
  Schedule: 0 9 * * *   (todos los días a las 9 UTC, equiv 6 AM ARG)
"""

import logging
import sys
from database import init_db
from services.vigilancia import (
    run_avisos_vencimiento, run_birthday_greetings, run_subscription_maintenance,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    logger.info("=== Legal Pacers — Daily maintenance ===")
    try:
        init_db()
        run_avisos_vencimiento()
        run_subscription_maintenance()
        run_birthday_greetings()
        logger.info("=== Daily maintenance complete ===")
    except Exception as e:
        logger.error(f"Daily maintenance failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
