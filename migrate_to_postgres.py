"""
One-shot migration: SQLite (marcas.db) -> Railway PostgreSQL.

Usage:
    python migrate_to_postgres.py "postgresql://user:pass@host:port/dbname"

Reads the schema directly from marcas.db and creates the same tables in
Postgres. Drops any existing tables in Postgres first (destination is
expected to be empty or stale from a previous run).
"""
import sys
import time
from sqlalchemy import create_engine, MetaData


SQLITE_URL = "sqlite:///marcas.db"
CHUNK = 2000


def main(pg_url: str) -> None:
    if pg_url.startswith("postgres://"):
        pg_url = pg_url.replace("postgres://", "postgresql://", 1)

    print(f"Source: {SQLITE_URL}")
    print(f"Target: {pg_url.rsplit('@', 1)[-1]}")

    src = create_engine(SQLITE_URL)
    dst = create_engine(pg_url)

    meta = MetaData()
    meta.reflect(bind=src)
    print(f"Tables found: {[t.name for t in meta.sorted_tables]}")

    print("\nDropping existing tables in Postgres (if any)...")
    meta.drop_all(bind=dst, checkfirst=True)

    print("Creating tables in Postgres...")
    meta.create_all(bind=dst)

    total_start = time.time()

    with src.connect() as src_conn:
        for table in meta.sorted_tables:
            count = src_conn.execute(
                table.count() if hasattr(table, "count")
                else __import__("sqlalchemy").select(__import__("sqlalchemy").func.count()).select_from(table)
            ).scalar()
            if not count:
                print(f"  {table.name}: 0 rows (skip)")
                continue

            print(f"  {table.name}: copying {count:,} rows...")
            t0 = time.time()
            copied = 0

            result = src_conn.execution_options(stream_results=True).execute(table.select())
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
