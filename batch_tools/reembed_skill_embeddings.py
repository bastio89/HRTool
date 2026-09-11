#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
GRAPHRAG_ROOT = PROJECT_ROOT / "graphrag"
for path in (GRAPHRAG_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("DATABASE_URL", "postgresql://hrtool:hrtoolpw@localhost:5432/hrtool")

from config import settings
from services.db import Neo4jService
from services.llm import LLMService


DEFAULT_BATCH_SIZE = 32


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild all Neo4j Skill embeddings with the current configured embedding model.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be updated without writing to Neo4j.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only refresh skills whose embedding is currently missing.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Number of skill embeddings to write per Neo4j batch (default: {DEFAULT_BATCH_SIZE})",
    )
    return parser.parse_args()


def _print_config() -> None:
    print("Embedding-Konfiguration")
    print("=======================")
    print(f"Provider: {settings.resolved_provider}")
    print(f"Base URL: {settings.resolved_ai_base_url}")
    print(f"Embedding Model: {settings.resolved_embedding_model}")
    print(f"Chat Model: {settings.resolved_chat_model}")


async def _load_skills(db_service: Neo4jService, only_missing: bool) -> list[dict[str, Any]]:
    query = """
    MATCH (s:Skill)
    WHERE $only_missing = false OR s.embedding IS NULL
    RETURN toLower(s.name) AS name,
           s.category AS category,
           s.embedding AS embedding
    ORDER BY name
    """
    async with db_service.driver.session() as session:
        result = await session.run(query, only_missing=only_missing)
        rows = await result.data()
    return [row for row in rows if str(row.get("name") or "").strip()]


async def _build_skill_embeddings(llm_service: LLMService, skill_names: list[str]) -> dict[str, list[float]]:
    vectors = await asyncio.gather(
        *(llm_service.create_embedding({"entity": "skill", "name": skill_name}, allow_fallback=False) for skill_name in skill_names)
    )
    return {name: vector for name, vector in zip(skill_names, vectors, strict=True)}


async def _write_skill_embeddings(db_service: Neo4jService, rows: list[dict[str, Any]], batch_size: int) -> int:
    if not rows:
        return 0

    query = """
    UNWIND $rows AS row
    MATCH (s:Skill {name: row.name})
    SET s.embedding = row.embedding
    """
    written = 0
    async with db_service.driver.session() as session:
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            result = await session.run(query, rows=batch)
            await result.consume()
            written += len(batch)
    return written


async def run(args: argparse.Namespace) -> int:
    _print_config()
    db_service = Neo4jService(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    llm_service = LLMService(
        provider=settings.resolved_provider,
        base_url=settings.resolved_ai_base_url,
        api_key=settings.resolved_api_key,
        chat_model=settings.resolved_chat_model,
        embedding_model=settings.resolved_embedding_model,
        embedding_dimensions=settings.embedding_dimensions,
        enable_reasoning=settings.ollama_enable_reasoning,
        reasoning_level=settings.resolved_reasoning_level,
        enable_call_logging=False,
        database_url=settings.database_url,
    )

    try:
        skills = await _load_skills(db_service, args.only_missing)
        print()
        print(f"Found {len(skills)} skills to refresh.")
        if not skills:
            return 0

        skill_names = [str(row["name"]) for row in skills]
        embeddings = await _build_skill_embeddings(llm_service, skill_names)

        update_rows = [
            {
                "name": name,
                "embedding": embeddings[name],
            }
            for name in skill_names
            if name in embeddings
        ]

        if args.dry_run:
            print(f"Dry run: would update {len(update_rows)} skill embeddings in Neo4j.")
            return 0

        written = await _write_skill_embeddings(db_service, update_rows, max(1, args.batch_size))
        print(f"Updated {written} skill embeddings in Neo4j.")
        return 0
    finally:
        await db_service.close()
        await llm_service.close()


def main() -> int:
    args = parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
