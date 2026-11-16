#!/usr/bin/env python3
"""Import a locally downloaded ESCO CSV release into Neo4j."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from services.esco_catalog import load_esco_concepts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import ESCO skills and terms from local CSV files.")
    parser.add_argument("--input-dir", type=Path, required=True, help="Directory containing ESCO CSV exports.")
    parser.add_argument("--release", required=True, help="Release identifier recorded on imported concepts.")
    parser.add_argument("--languages", default="en,de", help="Comma-separated language codes (default: en,de).")
    parser.add_argument("--dry-run", action="store_true", help="Validate and count concepts without connecting to Neo4j.")
    return parser.parse_args()


async def _write_to_neo4j(concepts: list[dict[str, object]]) -> None:
    from config import settings
    from services.db import Neo4jService

    service = Neo4jService(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
    try:
        await service.upsert_esco_concepts(concepts)
    finally:
        await service.close()


def main() -> int:
    args = parse_args()
    languages = tuple(dict.fromkeys(language.strip().lower() for language in args.languages.split(",") if language.strip()))
    concepts = load_esco_concepts(args.input_dir, release=args.release, languages=languages)

    if args.dry_run:
        print(f"ESCO dry-run valid: concepts={len(concepts)} release={args.release} languages={','.join(languages)}")
        return 0

    asyncio.run(_write_to_neo4j(concepts))
    print(f"ESCO import complete: concepts={len(concepts)} release={args.release}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
