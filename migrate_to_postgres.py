"""
One-shot migration: SQLite (marcas.db) -> Railway PostgreSQL.

Imports the ORM models from database.py so the column types translate
correctly per dialect (DATETIME on SQLite, TIMESTAMP on Postgres).

Usage:
    python migrate_to_postgres.py "postgresql://user:pass@host:port/dbname"
"""
import os
import sys
import time

# Ensure database.py reads from local SQLite, not from any DATABASE_URL env var
os.environ.pop("DATABASE_URL", None)

from sqlalchemy import create_engine, select, func
from database import Base  # noqa: E402  -- imports all model classes


SQLITE_URL = "sqlite:///marcas.db"
CHUNK = 2000


def main(pg_url: str) -> None:
    if pg_url.startswith("postgres://"):
        pg_url = pg_url.replace("postgres://", "postgresql://", 1)

    print(f"Source: {SQLITE_URL}")
    print(f"Target: {pg_url.rsplit('@', 1)[-1]}")

    src = create_engine(SQLITE_URL)
    dst = create_engine(pg_url)

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
            with dst.begin() as dst_conn:
                for row in result:
                    batch.append(dict(row._mapping))
                    if len(batch) >= CHUNK:
                        dst_conn.execute(table.insert(), batch)
                        copied += len(batch)
                        batch = []
                        print(f"    ...{copied:,}/{count:,}", end="\r")
                if batch:
                    dst_conn.execute(table.insert(), batch)
                    copied += len(batch)

            dt = time.time() - t0
            print(f"    done {copied:,} rows in {dt:.1f}s ({copied/dt:.0f}/s)")

    print(f"\nMigration complete in {time.time()-total_start:.1f}s")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print('Usage: python migrate_to_postgres.py "postgresql://..."')
        sys.exit(1)
    main(sys.argv[1])
