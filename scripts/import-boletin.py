"""
Importador semanal del Boletín INPI Argentina.

Este script descarga los nuevos boletines (publicados cada miércoles), los
parsea y hace UPSERT contra la tabla `marcas` apuntada por DATABASE_URL.
Es 100% idempotente: si un acta+clase ya existe, actualiza los campos
mutables (estado, titular, vencimiento); si no existe, la inserta; si ya
fue importada en una corrida previa, el boletín completo se saltea.

Uso (PowerShell o cualquier shell):
  python scripts\\import-boletin.py                # importa solo lo nuevo (modo cron)
  python scripts\\import-boletin.py --force-from N # forzar desde un boletín específico
  python scripts\\import-boletin.py --dry-run      # parsea pero no escribe en DB

Códigos de salida:
  0 = OK (incluye "no hay boletines nuevos")
  1 = Error fatal — Task Scheduler lo marcará como falla y reintentará en el
      próximo ciclo. NO hace falta marcar el cron como "running" porque el
      flag ImportState ya lo gestiona en DB.

Salida estándar y un archivo logs/import-boletin-YYYYMMDD.log reciben:
  - cuántas marcas se agregaron (filas nuevas)
  - cuántas se actualizaron (acta+clase ya existían)
  - cuántas se ignoraron (boletines que ya estaban en boletin_log)

Pensado para correrse desde Windows Task Scheduler vía import-boletin.ps1.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

# Permitir ejecutar el script desde cualquier directorio
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Cargar .env si existe (para correr local sin variables exportadas)
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from database import (  # noqa: E402
    init_db, count_marcas, get_session, get_last_imported_boletin,
    BoletinLog,
)
from bulk_importer import (  # noqa: E402
    import_new_only, bulk_import, detect_latest_bulletin,
)


def setup_logging() -> Path:
    """Configura logging dual: stdout + archivo logs/import-boletin-YYYYMMDD.log."""
    logs_dir = ROOT / "logs"
    logs_dir.mkdir(exist_ok=True)
    log_file = logs_dir / f"import-boletin-{date.today().isoformat()}.log"

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Limpiar handlers previos para evitar duplicados al re-ejecutar en mismo proceso
    for h in list(root.handlers):
        root.removeHandler(h)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)

    return log_file


def snapshot_state() -> tuple[int, int]:
    """Retorna (total_marcas, ultimo_boletin_logueado) antes de la corrida."""
    return count_marcas(), get_last_imported_boletin()


def boletines_processed_since(min_numero: int) -> list[BoletinLog]:
    """Retorna los registros de boletin_log con numero > min_numero."""
    with get_session() as s:
        return (
            s.query(BoletinLog)
            .filter(BoletinLog.numero > min_numero)
            .order_by(BoletinLog.numero)
            .all()
        )


def run(force_from: int | None, dry_run: bool) -> int:
    log = logging.getLogger("import-boletin")

    log.info("=" * 60)
    log.info("Importador semanal de boletines INPI — LegalPacers")
    log.info("Inicio: %s", datetime.now().isoformat(timespec="seconds"))

    if not os.getenv("DATABASE_URL"):
        log.warning("DATABASE_URL no está seteada — usando SQLite local (marcas.db)")

    # Garantizar que el schema esté al día
    init_db()

    total_before, ultimo_boletin_antes = snapshot_state()
    latest = detect_latest_bulletin()
    log.info("Estado inicial: %d marcas en DB, último boletín importado=%d, "
             "boletín más reciente disponible=%d",
             total_before, ultimo_boletin_antes, latest)

    if dry_run:
        log.info("MODO DRY-RUN: no se escribirá en DB")

    # Decidir el rango a importar
    if force_from is not None:
        log.info("Modo --force-from: importando %d → %d", force_from, latest)
        if not dry_run:
            bulk_import(force_from, latest)
    else:
        if ultimo_boletin_antes >= latest:
            log.info("No hay boletines nuevos. Última importación está al día.")
            log.info("Resultado: agregados=0  actualizados=0  ignorados=0")
            return 0
        log.info("Importando boletines nuevos: %d → %d",
                 ultimo_boletin_antes + 1, latest)
        if not dry_run:
            import_new_only()

    # Contabilizar resultado
    total_after, _ = snapshot_state()
    procesados = boletines_processed_since(ultimo_boletin_antes)

    boletines_ok = [b for b in procesados if b.status == "ok"]
    boletines_skip = [b for b in procesados if b.status == "skip"]
    boletines_error = [b for b in procesados if b.status == "error"]

    registros_procesados = sum(b.registros or 0 for b in boletines_ok)
    agregados = max(0, total_after - total_before)
    actualizados = max(0, registros_procesados - agregados)

    log.info("-" * 60)
    log.info("Boletines procesados: %d (ok=%d, skip=%d, error=%d)",
             len(procesados), len(boletines_ok), len(boletines_skip),
             len(boletines_error))
    log.info("Resultado: agregados=%d  actualizados=%d  ignorados=%d",
             agregados, actualizados, len(boletines_skip))
    if boletines_error:
        log.warning("Boletines con error (no detendrán el cron — se reintentan): %s",
                    ", ".join(str(b.numero) for b in boletines_error))
    log.info("Total marcas en DB ahora: %d (antes: %d)", total_after, total_before)
    log.info("Fin: %s", datetime.now().isoformat(timespec="seconds"))
    log.info("=" * 60)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Importa los nuevos boletines INPI a la base de datos."
    )
    parser.add_argument(
        "--force-from", type=int, default=None,
        help="Forzar la importación desde un número de boletín específico "
             "(ignora el último importado).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Hacer todos los chequeos sin escribir en la DB.",
    )
    args = parser.parse_args()

    log_file = setup_logging()
    log = logging.getLogger("import-boletin")
    log.info("Log file: %s", log_file)

    try:
        return run(args.force_from, args.dry_run)
    except Exception as e:
        log.exception("Falla fatal del importador: %s", e)
        return 1


if __name__ == "__main__":
    sys.exit(main())
