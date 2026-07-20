#!/usr/bin/env python3
"""Import CV or job PDFs from a folder, then move processed files to done/."""

from __future__ import annotations

import asyncio
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from uuid import uuid4
from urllib import error, request

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from config import settings
from services.db import Neo4jService
from services.llm import LLMService
from services.pdf import PDFService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read all CV or job PDFs, extract raw text locally, "
            "ingest via project API, then move successful files to done/."
        )
    )
    parser.add_argument(
        "--mode",
        choices=("cv", "job"),
        default="cv",
        help="Import mode: cv -> direct Neo4j CV import, job -> /ingest/job via API (default: cv)",
    )
    parser.add_argument(
        "--api-base",
        default="http://localhost:8000",
        help="Base API URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--input-dir",
        default="cv_input",
        help="Directory that contains .pdf files (default: cv_input)",
    )
    parser.add_argument(
        "--done-dir",
        default=None,
        help="Directory where successfully imported PDFs are moved (default: <input-dir>/done)",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=180,
        help="HTTP timeout in seconds for API calls",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run extraction only, skip API ingest and file move",
    )
    parser.add_argument(
        "--match-limit",
        type=int,
        default=10,
        help="Number of job matches to print per imported CV (default: 10)",
    )
    return parser.parse_args()


def post_json(
    url: str,
    payload: dict,
    timeout_seconds: int,
) -> dict:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    req = request.Request(
        url,
        data=body,
        headers=headers,
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


def ensure_unique_destination(done_dir: Path, file_name: str) -> Path:
    destination = done_dir / file_name
    if not destination.exists():
        return destination

    stem = destination.stem
    suffix = destination.suffix
    counter = 1
    while True:
        candidate = done_dir / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def _normalized_text_hash(text: str) -> str:
    normalized = " ".join(text.split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _normalized_profile_hash(profile) -> str:
    def _clean_text(value: object | None) -> str:
        return " ".join(str(value or "").split()).strip().lower()

    def _clean_float(value: object | None) -> float | None:
        if value is None:
            return None
        return float(value)

    payload = {
        "name": _clean_text(getattr(profile, "name", None)),
        "location": _clean_text(getattr(profile, "location", None)),
        "experience_years": _clean_float(getattr(profile, "experience_years", None)),
        "salary_expectation": _clean_float(getattr(profile, "salary_expectation", None)),
        "skills": sorted(
            {
                json.dumps(
                    {
                        "name": _clean_text(skill.name),
                        "category": _clean_text(skill.category),
                        "level": _clean_text(skill.level),
                        "experience_years": _clean_float(skill.experience_years),
                    },
                    sort_keys=True,
                    ensure_ascii=True,
                )
                for skill in getattr(profile, "skills", [])
            }
        ),
        "languages": sorted(
            {
                json.dumps(
                    {"name": _clean_text(lang.name), "level": _clean_text(lang.level)},
                    sort_keys=True,
                    ensure_ascii=True,
                )
                for lang in getattr(profile, "languages", [])
            }
        ),
        "educations": sorted(
            {
                json.dumps(
                    {
                        "level": _clean_text(edu.level),
                        "field_of_study": _clean_text(edu.field_of_study),
                    },
                    sort_keys=True,
                    ensure_ascii=True,
                )
                for edu in getattr(profile, "educations", [])
            }
        ),
        "industries": sorted({_clean_text(industry.name) for industry in getattr(profile, "industries", []) if _clean_text(industry.name)}),
        "preferred_roles": sorted({_clean_text(role) for role in getattr(profile, "preferred_roles", []) if _clean_text(role)}),
    }
    normalized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _format_job_matches(matches: list[dict[str, object]]) -> list[str]:
    lines: list[str] = []
    for index, match in enumerate(matches, start=1):
        title = str(match.get("title") or match.get("job_id") or "<unknown>")
        job_id = str(match.get("job_id") or "")
        similarity = float(match.get("skill_similarity") or 0.0)
        shared_skills = ", ".join(str(skill) for skill in match.get("shared_skills", []) if skill)
        suffix = f" shared={shared_skills}" if shared_skills else ""
        lines.append(f"{index}. {title} [{job_id}] similarity={similarity:.3f}{suffix}")
    return lines


async def _build_skill_embeddings(
    skill_names: list[str],
    llm_service: LLMService,
) -> dict[str, list[float]]:
    unique_names = sorted({name.strip() for name in skill_names if isinstance(name, str) and name.strip()})
    if not unique_names:
        return {}

    vectors = await asyncio.gather(
        *(
            llm_service.create_embedding(
                {
                    "entity": "skill",
                    "name": skill_name,
                }
            )
            for skill_name in unique_names
        )
    )
    return {name.lower(): vector for name, vector in zip(unique_names, vectors)}


async def _store_candidate_and_fetch_job_matches(
    *,
    profile,
    candidate_id: str,
    source_hash: str,
    profile_hash: str,
    db_service: Neo4jService,
    llm_service: LLMService,
    match_limit: int,
) -> list[dict[str, object]]:
    # Create the candidate node first so the database contains the imported CV.
    embedding = await llm_service.create_embedding(profile.model_dump())
    skill_embeddings = await _build_skill_embeddings([item.name for item in profile.skills], llm_service)

    await db_service.upsert_candidate(
        candidate_id=candidate_id,
        profile=profile,
        embedding=embedding,
        skill_embeddings=skill_embeddings,
        source_hash=source_hash,
        profile_hash=profile_hash,
    )

    # Fetch the best matching jobs directly from Neo4j after the candidate exists.
    matches = await db_service.get_top_job_matches_for_candidate(candidate_id, limit=match_limit)
    return [match.model_dump() for match in matches]


def process_job_file(
    pdf_path: Path,
    api_base: str,
    done_dir: Path,
    timeout_seconds: int,
    dry_run: bool,
    mode: str,
    pdf_service: PDFService,
) -> tuple[bool, str]:
    try:
        extracted_text = pdf_service.extract_text(pdf_path.read_bytes())
    except ValueError as exc:
        return False, f"PDF extraction failed: {exc}"

    endpoint = "/ingest/candidate" if mode == "cv" else "/ingest/job"
    entity_name = "candidate" if mode == "cv" else "job"

    if dry_run:
        return True, f"dry-run ok: mode={mode} extracted_chars={len(extracted_text)}"

    created = post_json(
        f"{api_base.rstrip('/')}{endpoint}",
        {"raw_text": extracted_text},
        timeout_seconds,
    )
    if not created.get("id"):
        return False, f"{endpoint} response has no id"

    done_dir.mkdir(parents=True, exist_ok=True)
    destination = ensure_unique_destination(done_dir, pdf_path.name)
    shutil.move(str(pdf_path), str(destination))

    return True, f"imported as {entity_name} id={created['id']}"


async def process_cv_file(
    pdf_path: Path,
    done_dir: Path,
    dry_run: bool,
    pdf_service: PDFService,
    db_service: Neo4jService,
    llm_service: LLMService,
    match_limit: int,
) -> tuple[bool, str]:
    # Step 1: read and normalize the PDF text so duplicate detection is stable.
    try:
        extracted_text = pdf_service.extract_text(pdf_path.read_bytes())
    except ValueError as exc:
        return False, f"PDF extraction failed: {exc}"

    source_hash = _normalized_text_hash(extracted_text)
    if dry_run:
        return True, f"dry-run ok: mode=cv extracted_chars={len(extracted_text)} source_hash={source_hash[:12]}"

    # Step 2: skip files whose normalized text already exists in Neo4j.
    existing_candidate = await db_service.find_candidate_by_source_hash(source_hash)
    duplicate_dir = done_dir / "duplicates"
    if existing_candidate is not None:
        duplicate_dir.mkdir(parents=True, exist_ok=True)
        destination = ensure_unique_destination(duplicate_dir, pdf_path.name)
        shutil.move(str(pdf_path), str(destination))
        return (
            True,
            f"duplicate skipped: existing_candidate_id={existing_candidate['id']} moved_to={destination}",
        )

    try:
        profile = await llm_service.parse_candidate_cv(extracted_text)
    except Exception as exc:
        return False, f"candidate parsing failed: {exc}"

    profile_hash = _normalized_profile_hash(profile)
    existing_profile = await db_service.find_candidate_by_profile_hash(profile_hash)
    duplicate_dir = done_dir / "duplicates"
    if existing_profile is not None:
        duplicate_dir.mkdir(parents=True, exist_ok=True)
        destination = ensure_unique_destination(duplicate_dir, pdf_path.name)
        shutil.move(str(pdf_path), str(destination))
        return (
            True,
            f"duplicate skipped: existing_candidate_id={existing_profile['id']} moved_to={destination}",
        )

    candidate_id = str(uuid4())
    try:
        matches = await _store_candidate_and_fetch_job_matches(
            profile=profile,
            candidate_id=candidate_id,
            source_hash=source_hash,
            profile_hash=profile_hash,
            db_service=db_service,
            llm_service=llm_service,
            match_limit=match_limit,
        )
    except Exception as exc:
        return False, f"candidate embedding creation failed: {exc}"

    # Step 3: move the processed PDF only after Neo4j persistence succeeded.
    done_dir.mkdir(parents=True, exist_ok=True)
    destination = ensure_unique_destination(done_dir, pdf_path.name)
    shutil.move(str(pdf_path), str(destination))

    lines = [f"imported as candidate id={candidate_id}"]
    if matches:
        lines.append("top job matches:")
        lines.extend(f"  {line}" for line in _format_job_matches(matches))
    else:
        lines.append("top job matches: none found")
    return True, "\n".join(lines)


async def run_cv_import(args: argparse.Namespace) -> int:
    pdf_service = PDFService()
    db_service = Neo4jService(
        uri=settings.neo4j_uri,
        user=settings.neo4j_user,
        password=settings.neo4j_password,
    )
    llm_service = LLMService(
        base_url=settings.ollama_base_url,
        chat_model=settings.ollama_chat_model,
        embedding_model=settings.ollama_embedding_model,
        embedding_dimensions=settings.embedding_dimensions,
        enable_reasoning=settings.ollama_enable_reasoning,
        enable_parse_latency_aggregation=settings.enable_parse_latency_aggregation,
        parse_latency_window_size=settings.parse_latency_window_size,
        parse_latency_log_every=settings.parse_latency_log_every,
    )

    input_dir = Path(args.input_dir)
    done_dir = Path(args.done_dir) if args.done_dir else (input_dir / "done")

    try:
        if not input_dir.exists():
            print(f"Input directory does not exist: {input_dir}")
            return 1

        pdf_files = sorted(
            p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"
        )

        if not pdf_files:
            print(f"No PDF files found in {input_dir}")
            return 0

        ok_count = 0
        fail_count = 0

        for pdf in pdf_files:
            print(f"Processing {pdf.name} ...")
            try:
                ok, message = await process_cv_file(
                    pdf_path=pdf,
                    done_dir=done_dir,
                    dry_run=args.dry_run,
                    pdf_service=pdf_service,
                    db_service=db_service,
                    llm_service=llm_service,
                    match_limit=args.match_limit,
                )
                if ok:
                    ok_count += 1
                    print(f"  OK: {message}")
                else:
                    fail_count += 1
                    print(f"  FAIL: {message}")
            except Exception as exc:
                fail_count += 1
                print(f"  FAIL: {exc}")

        print(
            f"Finished. success={ok_count} failed={fail_count} "
            f"done_dir={done_dir}"
        )

        return 0 if fail_count == 0 else 2
    finally:
        await db_service.close()
        await llm_service.close()


def main() -> int:
    args = parse_args()
    if args.mode == "cv":
        return asyncio.run(run_cv_import(args))

    pdf_service = PDFService()

    input_dir = Path(args.input_dir)
    done_dir = Path(args.done_dir) if args.done_dir else (input_dir / "done")

    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}")
        return 1

    pdf_files = sorted(
        p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"
    )

    if not pdf_files:
        print(f"No PDF files found in {input_dir}")
        return 0

    ok_count = 0
    fail_count = 0

    for pdf in pdf_files:
        print(f"Processing {pdf.name} ...")
        try:
            ok, message = process_job_file(
                pdf_path=pdf,
                api_base=args.api_base,
                done_dir=done_dir,
                timeout_seconds=args.timeout_seconds,
                dry_run=args.dry_run,
                mode=args.mode,
                pdf_service=pdf_service,
            )
            if ok:
                ok_count += 1
                print(f"  OK: {message}")
            else:
                fail_count += 1
                print(f"  FAIL: {message}")
        except Exception as exc:
            fail_count += 1
            print(f"  FAIL: {exc}")

    print(
        f"Finished. success={ok_count} failed={fail_count} "
        f"done_dir={done_dir}"
    )

    return 0 if fail_count == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
