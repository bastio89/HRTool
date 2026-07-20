#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import settings
from services.db import Neo4jService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Match CVs and jobs in both directions using Neo4j skill overlap and skill embeddings."
    )
    parser.add_argument(
        "mode",
        choices=("cv-job", "job-cv"),
        help="Match direction: cv-job (candidate -> jobs) or job-cv (job -> candidates)",
    )
    parser.add_argument(
        "name",
        help="Candidate name for cv-job or job title for job-cv (case-insensitive)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Maximum number of matches to print (default: 10)",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show skill details instead of only the match score",
    )
    return parser.parse_args()


def _format_skill_list(values: list[object]) -> str:
    cleaned = [str(value) for value in values if value]
    return ", ".join(cleaned) if cleaned else "-"


def _format_job_match(index: int, match: dict[str, object], verbose: bool) -> str:
    title = str(match.get("title") or match.get("job_id") or "<unknown>")
    job_id = str(match.get("job_id") or "")
    score = float(match.get("skill_similarity") or 0.0)

    lines = [f"{index}. {title} [{job_id}] score={score:.3f}"]
    if verbose:
        lines.append(f"   matched_skills: {_format_skill_list(match.get('shared_skills', []))}")
        lines.append(f"   similar_skills: {_format_skill_list(match.get('similar_skills', []))}")
        lines.append(f"   candidate_skills: {_format_skill_list(match.get('candidate_skills', []))}")
        lines.append(f"   job_skills: {_format_skill_list(match.get('job_skills', []))}")
    return "\n".join(lines)


def _format_candidate_match(index: int, match: dict[str, object], verbose: bool) -> str:
    name = str(match.get("name") or match.get("candidate_id") or "<unknown>")
    candidate_id = str(match.get("candidate_id") or "")
    score = float(match.get("skill_similarity") or 0.0)

    lines = [f"{index}. {name} [{candidate_id}] score={score:.3f}"]
    if verbose:
        lines.append(f"   matched_skills: {_format_skill_list(match.get('shared_skills', []))}")
        lines.append(f"   similar_skills: {_format_skill_list(match.get('similar_skills', []))}")
        lines.append(f"   candidate_skills: {_format_skill_list(match.get('candidate_skills', []))}")
        lines.append(f"   job_skills: {_format_skill_list(match.get('job_skills', []))}")
    return "\n".join(lines)


async def _match_cv_to_jobs(db_service: Neo4jService, candidate_name: str, limit: int, verbose: bool) -> int:
    candidate = await db_service.find_candidate_by_name(candidate_name)
    if candidate is None:
        print(f"No candidate found for name: {candidate_name}")
        return 1

    matches = await db_service.get_top_job_matches_for_candidate(candidate["id"], limit=limit)

    print(f"Candidate: {candidate['name']} [{candidate['id']}]")
    if candidate.get("location"):
        print(f"Location: {candidate['location']}")
    if candidate.get("experience_years") is not None:
        print(f"Experience years: {candidate['experience_years']}")

    if not matches:
        print("No job matches found.")
        return 0

    print(f"Top {len(matches)} job matches:")
    for index, match in enumerate((item.model_dump() for item in matches), start=1):
        print(_format_job_match(index, match, verbose))
    return 0


async def _match_job_to_cvs(db_service: Neo4jService, job_name: str, limit: int, verbose: bool) -> int:
    job = await db_service.find_job_by_name(job_name)
    if job is None:
        print(f"No job found for title: {job_name}")
        return 1

    matches = await db_service.get_top_candidate_matches_for_job(job["id"], limit=limit)

    print(f"Job: {job['title']} [{job['id']}]")
    if job.get("company"):
        print(f"Company: {job['company']}")
    if job.get("department"):
        print(f"Department: {job['department']}")
    if job.get("location"):
        print(f"Location: {job['location']}")

    if not matches:
        print("No candidate matches found.")
        return 0

    print(f"Top {len(matches)} candidate matches:")
    for index, match in enumerate((item.model_dump() for item in matches), start=1):
        print(_format_candidate_match(index, match, verbose))
    return 0


async def run_match(mode: str, name: str, limit: int, verbose: bool) -> int:
    db_service = Neo4jService(
        uri=settings.neo4j_uri,
        user=settings.neo4j_user,
        password=settings.neo4j_password,
    )

    try:
        if mode == "cv-job":
            return await _match_cv_to_jobs(db_service, name, limit=limit, verbose=verbose)
        return await _match_job_to_cvs(db_service, name, limit=limit, verbose=verbose)
    finally:
        await db_service.close()


def main() -> int:
    args = parse_args()
    return asyncio.run(run_match(args.mode, args.name, args.limit, args.verbose))


if __name__ == "__main__":
    raise SystemExit(main())