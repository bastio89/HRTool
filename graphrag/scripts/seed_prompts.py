from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

import psycopg


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed default prompt templates into PostgreSQL.")
    parser.add_argument("--database-url", default=None, help="PostgreSQL connection string")
    args = parser.parse_args()
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("--database-url or DATABASE_URL is required")

    seed_path = Path(__file__).resolve().parents[1] / "seeds" / "prompts.sql"
    sql = seed_path.read_text(encoding="utf-8")

    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(sql)


if __name__ == "__main__":
    asyncio.run(main())