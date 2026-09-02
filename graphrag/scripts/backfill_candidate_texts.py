#!/usr/bin/env python3
"""Backfill stored CV fulltext for existing candidates in PostgreSQL."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import settings
from services.candidate_text_renderer import build_candidate_profile_json, render_candidate_fulltext
from services.db import Neo4jService
from services.postgres_store import PostgresStore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill candidate CV fulltext into PostgreSQL candidate_texts.")
    parser.add_argument("--overwrite", action="store_true", help="Rewrite existing candidate_texts rows.")
    parser.add_argument("--source", choices=("postgres", "neo4j", "both"), default="both")
    return parser.parse_args()


def _decode_rows(value: object) -> list[dict[str, object]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    return []


async def _backfill_rows(
    postgres_store: PostgresStore,
    rows: list[dict[str, object]],
    *,
    source_label: str,
    overwrite: bool,
) -> tuple[int, int]:
    written = 0
    skipped = 0
    for row in rows:
        candidate_id = str(row.get("candidate_id") or "").strip()
        if not candidate_id:
            skipped += 1
            continue
        if not overwrite and await postgres_store.get_candidate_text(candidate_id):
            skipped += 1
            continue

        work_history = _decode_rows(row.get("work_history"))
        education_history = _decode_rows(row.get("education_history"))
        original_text = render_candidate_fulltext(row, work_history=work_history, education_history=education_history)
        if not original_text:
            skipped += 1
            continue

        profile_json = build_candidate_profile_json(
            row,
            work_history=work_history,
            education_history=education_history,
        )
        await postgres_store.store_candidate_text(
            candidate_id,
            original_text,
            candidate_name=str(row.get("name") or "").strip() or None,
            source=source_label,
            profile_json=profile_json,
        )
        written += 1
    return written, skipped


async def run_backfill(args: argparse.Namespace) -> int:
    postgres_store = PostgresStore(settings.database_url)
    graph_service = Neo4jService(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)

    try:
        await postgres_store.ensure_schema()

        written = 0
        skipped = 0

        if args.source in {"postgres", "both"}:
            postgres_rows = await postgres_store.list_candidates_for_backfill()
            result_written, result_skipped = await _backfill_rows(
                postgres_store,
                postgres_rows,
                source_label="backfill_postgres_candidates",
                overwrite=args.overwrite,
            )
            written += result_written
            skipped += result_skipped

        if args.source in {"neo4j", "both"}:
            graph_rows = await graph_service.list_candidates_for_backfill()
            result_written, result_skipped = await _backfill_rows(
                postgres_store,
                graph_rows,
                source_label="backfill_neo4j_candidates",
                overwrite=args.overwrite,
            )
            written += result_written
            skipped += result_skipped

        print(f"Backfill complete. written={written} skipped={skipped} source={args.source} overwrite={args.overwrite}")
        return 0
    finally:
        await graph_service.close()


def main() -> int:
    args = parse_args()
    return asyncio.run(run_backfill(args))


if __name__ == "__main__":
    sys.exit(main())