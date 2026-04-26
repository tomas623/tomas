"""
One-shot migration: SQLite (marcas.db) -> Railway PostgreSQL.

Usage:
    python migrate_to_postgres.py "postgresql://user:pass@host:port/dbname"

Tolerant of intermittent SSL drops — retries each chunk and reconnects
between large tables.
"""
import os
import sys
import time

os.environ.pop("DATABASE_URL", None)

from sqlalchemy import create_engine, select, func
from sqlalchemy.exc import OperationalError, DBAPIError
from database import Base  # noqa: E402


SQLITE_URL = "sqlite:///marcas.db"
CHUNK = 500
MAX_RETRIES = 5


def make_dst_engine(pg_url: str):
    return create_engine(
        pg_url,
        pool_pre_ping=True,
        connect_args={
            "keepalives": 1,
            "keepalives_idle": 30,
            "keepalives_interval": 10,
            "keepalives_count": 5,
            "connect_timeout": 30,
        },
    )


def insert_batch_with_retry(dst_engine, table, batch):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with dst_engine.begin() as conn:
                conn.execute(table.insert(), batch)
            return
        except (OperationalError, DBAPIError) as e:
            if attempt == MAX_RETRIES:
                raise
            wait = 2 ** attempt
            print(f"\n    retry {attempt}/{MAX_RETRIES} after error: {type(e).__name__}; sleeping {wait}s")
            time.sleep(wait)


def main(pg_url: str) -> None:
    if pg_url.startswith("postgres://"):
        pg_url = pg_url.replace("postgres://", "postgresql://", 1)

    print(f"Source: {SQLITE_URL}")
    print(f"Target: {pg_url.rsplit('@', 1)[-1]}")

    src = create_engine(SQLITE_URL)
    dst = make_dst_engine(pg_url)

    print(f"Tables: {[t.name for t in Base.metadata.sorted_tables]}")

    print("\nDropping existing tables in Postgres (if any)...")
    Base.metadata.drop_all(bind=dst, checkfirst=True)

    print("Creating tables in Postgres...")
    Base.metadata.create_all(bind=dst)

    total_start = time.time()

    with src.connect() as src_conn:
        for table in Base.metadata.sorted_tables:
            count = src_conn.execute(
                select(func.count()).select_from(table)
            ).scalar() or 0

            if not count:
                print(f"  {table.name}: 0 rows (skip)")
                continue

            print(f"  {table.name}: copying {count:,} rows...")
            t0 = time.time()
            copied = 0

            result = src_conn.execution_options(stream_results=True).execute(
                table.select()
            )
            batch = []
            for row in result:
                batch.append(dict(row._mapping))
                if len(batch) >= CHUNK:
                    insert_batch_with_retry(dst, table, batch)
                    copied += len(batch)
                    batch = []
                    if copied % 10000 == 0:
                        elapsed = time.time() - t0
                        rate = copied / elapsed
                        eta = (count - copied) / rate
                        print(f"    {copied:,}/{count:,}  ({rate:.0f}/s, ETA {eta:.0f}s)")
            if batch:
                insert_batch_with_retry(dst, table, batch)
                copied += len(batch)

            dt = time.time() - t0
            print(f"    done {copied:,} rows in {dt:.1f}s ({copied/dt:.0f}/s)")

    print(f"\nMigration complete in {time.time()-total_start:.1f}s")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print('Usage: python migrate_to_postgres.py "postgresql://..."')
        sys.exit(1)
    main(sys.argv[1])
