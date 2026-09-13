#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql

GRAPHRAG_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


EXAMPLE_ENV = _read_env_file(REPO_ROOT / ".env.docker.example")
WORKSPACE_ENV = _read_env_file(REPO_ROOT / ".env")
LOCAL_ENV = {**EXAMPLE_ENV, **WORKSPACE_ENV}

for key, default in (
    ("NEO4J_URI", "bolt://localhost:7687"),
    ("NEO4J_USER", "neo4j"),
    ("NEO4J_PASSWORD", "password"),
    ("DATABASE_URL", ""),
    ("POSTGRES_DB", "hrtool"),
    ("POSTGRES_USER", "hrtool"),
    ("POSTGRES_PASSWORD", "hrtoolpw"),
):
    value = LOCAL_ENV.get(key)
    if value:
        os.environ[key] = value
    elif default:
        os.environ.setdefault(key, default)

if str(GRAPHRAG_ROOT) not in sys.path:
    sys.path.insert(0, str(GRAPHRAG_ROOT))

from config import settings
from services.db import Neo4jService
from services.postgres_store import PostgresStore


POSTGRES_TABLES = [
    "candidate_education",
    "candidate_work_history",
    "candidate_texts",
    "candidates",
    "jobs",
]


def _merged_env(key: str, default: str | None = None) -> str | None:
    value = os.environ.get(key)
    if value:
        return value
    value = LOCAL_ENV.get(key)
    if value:
        return value
    return default


def _neo4j_password_candidates() -> list[str]:
    candidates = [
        os.environ.get("NEO4J_PASSWORD"),
        WORKSPACE_ENV.get("NEO4J_PASSWORD"),
        EXAMPLE_ENV.get("NEO4J_PASSWORD"),
    ]
    cleaned: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
    return cleaned


def _build_database_url(host: str, *, user: str, password: str, database: str, port: str = "5432") -> str:
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


def _candidate_database_urls() -> list[str]:
    candidates: list[str] = []

    explicit = os.environ.get("DATABASE_URL") or LOCAL_ENV.get("DATABASE_URL")
    if explicit:
        candidates.append(explicit)

    user = _merged_env("POSTGRES_USER", "hrtool") or "hrtool"
    password = _merged_env("POSTGRES_PASSWORD", "hrtoolpw") or "hrtoolpw"
    database = _merged_env("POSTGRES_DB", "hrtool") or "hrtool"

    for host in ("localhost", "127.0.0.1", "postgres"):
        candidates.append(_build_database_url(host, user=user, password=password, database=database))

    cleaned: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in cleaned:
            cleaned.append(candidate)
    return cleaned


async def _probe_database_url(database_url: str) -> bool:
    try:
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT 1")
                await cursor.fetchone()
        return True
    except Exception:
        return False


async def _probe_neo4j_connection(uri: str, user: str, password: str) -> bool:
    try:
        db_service = Neo4jService(uri=uri, user=user, password=password, postgres_store=None)
        try:
            async with db_service.driver.session() as session:
                result = await session.run("RETURN 1 AS ok")
                record = await result.single()
                return bool(record and record["ok"] == 1)
        finally:
            await db_service.close()
    except Exception:
        return False


async def _resolve_neo4j_config(
    uri_override: str | None = None,
    user_override: str | None = None,
    password_override: str | None = None,
) -> tuple[str, str, str]:
    uri = uri_override or _merged_env("NEO4J_URI", "bolt://localhost:7687") or "bolt://localhost:7687"
    user = user_override or _merged_env("NEO4J_USER", "neo4j") or "neo4j"
    password_candidates = []
    if password_override:
        password_candidates.append(password_override)
    password_candidates.extend(_neo4j_password_candidates())
    for password in password_candidates or [_merged_env("NEO4J_PASSWORD", "password") or "password"]:
        if await _probe_neo4j_connection(uri, user, password):
            return uri, user, password
    raise RuntimeError("Unable to authenticate with Neo4j using the known password candidates.")


async def _resolve_database_url() -> str:
    for candidate in _candidate_database_urls():
        if await _probe_database_url(candidate):
            return candidate
    raise RuntimeError("Unable to connect to Postgres with any known database URL candidate.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete all job and CV data from Graphrag's Postgres and Neo4j databases."
    )
    parser.add_argument("--database-url", default=None, help="Explicit Postgres connection string to use.")
    parser.add_argument("--neo4j-uri", default=None, help="Explicit Neo4j bolt URI to use.")
    parser.add_argument("--neo4j-user", default=None, help="Explicit Neo4j username to use.")
    parser.add_argument("--neo4j-password", default=None, help="Explicit Neo4j password to use.")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Actually execute the deletion. Without this flag the script only prints what it would do.",
    )
    return parser.parse_args()


async def _clear_postgres(postgres_store: PostgresStore) -> list[str]:
    async with await psycopg.AsyncConnection.connect(postgres_store.database_url) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = current_schema()
                  AND tablename = ANY(%s)
                ORDER BY tablename
                """,
                (POSTGRES_TABLES,),
            )
            existing_tables = [row[0] for row in await cursor.fetchall()]

            if not existing_tables:
                return []

            truncate_query = sql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
                sql.SQL(", ").join(sql.Identifier(table) for table in existing_tables)
            )
            await cursor.execute(truncate_query)

    return existing_tables


async def _clear_neo4j(db_service: Neo4jService) -> int:
    async with db_service.driver.session() as session:
        count_result = await session.run("MATCH (n) RETURN count(n) AS node_count")
        count_record = await count_result.single()
        node_count = int(count_record["node_count"] or 0) if count_record else 0
        delete_result = await session.run("MATCH (n) DETACH DELETE n")
        await delete_result.consume()
    return node_count


async def _run_cleanup(args: argparse.Namespace) -> tuple[list[str], int]:
    database_url = args.database_url or await _resolve_database_url()
    neo4j_uri, neo4j_user, neo4j_password = await _resolve_neo4j_config(
        uri_override=args.neo4j_uri,
        user_override=args.neo4j_user,
        password_override=args.neo4j_password,
    )
    postgres_store = PostgresStore(database_url)
    db_service = Neo4jService(
        uri=neo4j_uri,
        user=neo4j_user,
        password=neo4j_password,
        postgres_store=postgres_store,
    )
    try:
        postgres_tables = await _clear_postgres(postgres_store)
        neo4j_node_count = await _clear_neo4j(db_service)
    finally:
        await db_service.close()
    return postgres_tables, neo4j_node_count


def main() -> int:
    args = parse_args()

    print("This will remove all job and CV data from Postgres and Neo4j.")
    print(f"Postgres tables targeted: {', '.join(POSTGRES_TABLES)}")
    print("Neo4j target: all nodes and relationships in the Graphrag graph")

    if not args.yes:
        print("Dry run only. Re-run with --yes to execute the deletion.")
        return 2

    try:
        postgres_tables, neo4j_node_count = asyncio.run(_run_cleanup(args))
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if postgres_tables:
        print(f"Postgres cleared: {', '.join(postgres_tables)}")
    else:
        print("Postgres: no target tables were present.")
    print(f"Neo4j cleared: {neo4j_node_count} node(s) deleted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())