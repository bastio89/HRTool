#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path
from typing import Any

import psycopg


def quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def sqlite_type_to_pg(sqlite_type: str | None) -> str:
    t = (sqlite_type or "TEXT").upper()
    if "INT" in t or "SERIAL" in t:
        return "BIGINT"
    if "REAL" in t or "FLOA" in t or "DOUB" in t:
        return "DOUBLE PRECISION"
    if "BOOL" in t:
        return "BOOLEAN"
    if "BLOB" in t:
        return "BYTEA"
    if "DATE" in t or "TIME" in t or "DATETIME" in t:
        return "TIMESTAMP"
    if "CHAR" in t or "TEXT" in t or "CLOB" in t:
        return "TEXT"
    return "TEXT"


def default_sqlite_to_pg(default_value: str | None) -> str | None:
    if default_value is None:
        return None
    stripped = default_value.strip()
    if not stripped:
        return None
    upper = stripped.upper()
    if upper in {"CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME"}:
        return f"DEFAULT {upper}"
    if stripped.startswith("'") and stripped.endswith("'"):
        return f"DEFAULT {stripped}"
    if stripped.startswith('"') and stripped.endswith('"'):
        return f"DEFAULT {stripped}"
    return f"DEFAULT {stripped}"


def get_sqlite_tables(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [row[0] for row in rows]


def create_postgres_table(pg_conn: psycopg.Connection, table_name: str, sqlite_conn: sqlite3.Connection, reset: bool = False) -> None:
    with sqlite_conn:
        columns = sqlite_conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()
    if not columns:
        return

    if reset:
        with pg_conn.cursor() as cur:
            cur.execute(f"DROP TABLE IF EXISTS {quote_ident(table_name)} CASCADE")

    column_defs: list[str] = []
    for column in columns:
        cid, name, col_type, notnull, default_value, pk = column
        base_type = sqlite_type_to_pg(col_type)
        field = f"{quote_ident(name)} {base_type}"

        if pk:
            if (col_type or "").upper() in {"INTEGER", "INT", "SMALLINT", "BIGINT"} or "INT" in (col_type or "").upper():
                field = f"{quote_ident(name)} BIGINT"
            else:
                field = f"{quote_ident(name)} {base_type}"
            field += " PRIMARY KEY"
        elif notnull:
            field += " NOT NULL"

        default_sql = default_sqlite_to_pg(default_value)
        if default_sql:
            field += f" {default_sql}"
        column_defs.append(field)

    table_sql = f"CREATE TABLE IF NOT EXISTS {quote_ident(table_name)} (\n  " + ",\n  ".join(column_defs) + "\n);"
    with pg_conn.cursor() as cur:
        cur.execute(table_sql)
    pg_conn.commit()


def migrate_table(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection, table_name: str) -> int:
    columns = sqlite_conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()
    if not columns:
        return 0

    col_names = [column[1] for column in columns]
    ident_names = ", ".join(quote_ident(name) for name in col_names)
    placeholders = ", ".join(["%s"] * len(col_names))
    insert_sql = f"INSERT INTO {quote_ident(table_name)} ({ident_names}) VALUES ({placeholders})"

    rows = sqlite_conn.execute(f'SELECT * FROM "{table_name}"').fetchall()
    if not rows:
        return 0

    with pg_conn.cursor() as cur:
        for row in rows:
            cur.execute(insert_sql, row)
    pg_conn.commit()
    return len(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate SQLite data into PostgreSQL.")
    parser.add_argument("--sqlite-db", default="backend/data/hrtool.db", help="Path to the SQLite database file.")
    parser.add_argument(
        "--postgres-url",
        default=os.getenv("DATABASE_URL", "postgresql://hrtool:hrtoolpass@localhost:5432/hrtool"),
        help="PostgreSQL connection URL.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop target tables before re-importing.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    sqlite_path = Path(args.sqlite_db).resolve()
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {sqlite_path}")

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row

    pg_conn = psycopg.connect(args.postgres_url)
    try:
        tables = get_sqlite_tables(sqlite_conn)
        if not tables:
            print(f"No tables found in SQLite database: {sqlite_path}")
            return

        print(f"Found {len(tables)} SQLite table(s): {', '.join(tables)}")

        for table_name in tables:
            print(f"Migrating table: {table_name}")
            create_postgres_table(pg_conn, table_name, sqlite_conn, reset=args.reset)
            count = migrate_table(sqlite_conn, pg_conn, table_name)
            print(f"  -> imported {count} row(s)")

        print("Migration complete.")
    finally:
        pg_conn.close()
        sqlite_conn.close()


if __name__ == "__main__":
    main()
