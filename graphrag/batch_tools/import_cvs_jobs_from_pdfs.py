#!/usr/bin/env python3
"""Import CV PDFs into GraphRAG or job PDFs via the GUI backend, then move processed files to done/."""

from __future__ import annotations

import asyncio
import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from uuid import uuid4
from urllib import error, request
from urllib.parse import urlsplit, urlunsplit
import httpx
import psycopg

GRAPHRAG_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(REPO_ROOT / ".env")

os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USER", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "password")
os.environ.setdefault("DATABASE_URL", "postgresql://hrtool:hrtoolpw@localhost:5432/hrtool")

if str(GRAPHRAG_ROOT) not in sys.path:
    sys.path.insert(0, str(GRAPHRAG_ROOT))

from config import settings
from services.candidate_privacy import CandidatePrivacyService
from services.candidate_extraction import extract_candidate_profile
from services.candidate_identity import CandidateIdentityError, DuplicateCandidateError, ensure_birth_date
from services.candidate_persistence import create_candidate
from services.db import Neo4jService
from services.model_config import ModelConfigService
from services.llm import LLMService
from services.pdf import PDFService
from services.prompt_service import PromptService
from services.postgres_store import PostgresStore
from scripts.init_neo4j import init_schema


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read all CV or job PDFs, extract raw text locally, "
            "parse structured profiles, ingest into Neo4j, then move successful files to done/."
        )
    )
    parser.add_argument(
        "--mode",
        choices=("cv", "job"),
        default="cv",
        help="Import mode: cv -> GraphRAG CV import, job -> GUI backend job import (default: cv)",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("HRTOOL_BACKEND_API_BASE", "http://127.0.0.1:3001/api"),
        help="Backend API for job imports and CV token verification (default: HRTOOL_BACKEND_API_BASE or http://127.0.0.1:3001/api)",
    )
    parser.add_argument(
        "--input-dir",
        default=None,
        help="Directory that contains .pdf files (default: cv_input for CV mode, job_input for job mode)",
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
        help="HTTP timeout in seconds for backend API calls",
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
        help="Deprecated and ignored: imports queue asynchronous matching against all stored counterparts",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="JWT token for authenticated backend API calls",
    )
    parser.add_argument(
        "--username",
        default=None,
        help="Username for backend /auth/login (used if no token is provided)",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="Password for backend /auth/login (used if no token is provided)",
    )
    return parser.parse_args()


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


def _resolve_local_database_url(database_url: str) -> str:
    parsed = urlsplit(database_url)
    if parsed.hostname == "postgres":
        fallback_netloc = parsed.netloc.replace("postgres", "localhost", 1)
        return urlunsplit((parsed.scheme, fallback_netloc, parsed.path, parsed.query, parsed.fragment))
    return database_url


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


def _resolve_input_dir(args: argparse.Namespace) -> Path:
    if args.input_dir:
        return Path(args.input_dir)
    return Path("job_input" if args.mode == "job" else "cv_input")


def _job_profile_issues(job: dict[str, object]) -> list[str]:
    issues = []
    if not str(job.get("title") or "").strip():
        issues.append("title")
    if not str(job.get("skills") or "").strip():
        issues.append("skills")
    if not any(str(job.get(field) or "").strip() for field in ("description", "requirements", "about_us")):
        issues.append("description/requirements")
    return issues


def _is_real_pdf_file(path: Path) -> bool:
    if not path.is_file():
        return False

    name = path.name
    if name.startswith("._") or name == ".DS_Store":
        return False

    return path.suffix.lower() == ".pdf"


def post_json(
    url: str,
    payload: dict,
    timeout_seconds: int,
    token: str | None = None,
) -> dict:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(url, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


def post_multipart_file(
    url: str,
    file_path: Path,
    timeout_seconds: int,
    token: str | None = None,
    field_name: str = "file",
) -> dict:
    boundary = f"----hrtool-{uuid4().hex}"
    filename = file_path.name
    file_bytes = file_path.read_bytes()

    preamble = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{filename}\"\r\n"
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8")
    closing = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = preamble + file_bytes + closing

    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(url, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


def resolve_auth_token(args: argparse.Namespace) -> str | None:
    token = args.token or os.environ.get("HRTOOL_API_TOKEN")
    if token:
        return token

    username = args.username or os.environ.get("HRTOOL_USERNAME")
    password = args.password or os.environ.get("HRTOOL_PASSWORD")
    if not username and not password and args.mode == "job":
        username = "admin"
        password = "admin123"

    if username and password:
        login_result = post_json(
            f"{args.api_base.rstrip('/')}/auth/login",
            {"username": username, "password": password},
            args.timeout_seconds,
        )
        login_token = str(login_result.get("token") or "").strip()
        if not login_token:
            raise RuntimeError("Login succeeded but response has no token")
        return login_token

    raise RuntimeError(
        "No backend auth token available. Set HRTOOL_API_TOKEN or provide HRTOOL_USERNAME/HRTOOL_PASSWORD."
    )


async def validate_cv_import_actor(
    api_base: str, timeout_seconds: int, token: str | None, postgres_store: PostgresStore,
) -> int:
    if not token:
        raise RuntimeError("CV import requires an authenticated bearer token")
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.get(
            f"{api_base.rstrip('/')}/auth/me", headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()
    payload = response.json()
    raw_id = payload.get("id") if isinstance(payload, dict) else None
    if isinstance(raw_id, bool) or not isinstance(raw_id, (int, str)):
        raise RuntimeError("Backend did not confirm an authenticated user")
    user_id = int(raw_id)
    if user_id <= 0 or await postgres_store.get_matching_actor(user_id) is None:
        raise RuntimeError("Authenticated import user no longer exists in the configured PostgreSQL database")
    return user_id


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
                },
                allow_fallback=False,
            )
            for skill_name in unique_names
        )
    )
    return {name.lower(): vector for name, vector in zip(unique_names, vectors)}


async def process_job_file(
    pdf_path: Path,
    done_dir: Path,
    dry_run: bool,
    api_base: str,
    timeout_seconds: int,
    token: str | None,
    pdf_service: PDFService,
) -> tuple[bool, str]:
    try:
        extracted_text = pdf_service.extract_text(pdf_path.read_bytes())
    except ValueError as exc:
        return False, f"PDF extraction failed: {exc}"

    if dry_run:
        source_hash = _normalized_text_hash(extracted_text)
        return True, f"dry-run ok: mode=job extracted_chars={len(extracted_text)} source_hash={source_hash[:12]}"

    try:
        parsed = post_multipart_file(
            f"{api_base.rstrip('/')}/jobs/parse-description?persist=1",
            pdf_path,
            timeout_seconds,
            token,
        )
    except Exception as exc:
        return False, f"backend job parsing failed: {exc}"

    if not parsed.get("success"):
        return False, f"backend job parsing returned no success flag: {parsed}"

    job_payload = parsed.get("job") or {}
    created_id = job_payload.get("id") or parsed.get("id")
    if not created_id:
        return False, "backend job parsing response has no job id"
    profile_issues = _job_profile_issues(job_payload)
    if profile_issues:
        return False, (
            f"backend saved job id={created_id} but returned an incomplete profile "
            f"(missing {', '.join(profile_issues)}); source PDF retained"
        )
    run_id = parsed.get("matchingRunId") or job_payload.get("matchingRunId")
    matching_status = parsed.get("matchingStatus") or job_payload.get("matchingStatus")
    if not run_id and matching_status != "not_required":
        return False, f"backend saved job id={created_id} but did not confirm a durable matching run"

    done_dir.mkdir(parents=True, exist_ok=True)
    destination = ensure_unique_destination(done_dir, pdf_path.name)
    shutil.move(str(pdf_path), str(destination))

    title = str(job_payload.get("title") or parsed.get("title") or "").strip()
    lines = [f"imported as job id={created_id}"]
    if title:
        lines.append(f"title={title}")
    if run_id:
        lines.append(f"matching run id={run_id} status={matching_status}")
    elif matching_status == "not_required":
        lines.append("matching not required: unchanged import")
    return True, "\n".join(lines)


async def process_cv_file(
    pdf_path: Path,
    done_dir: Path,
    dry_run: bool,
    pdf_service: PDFService,
    db_service: Neo4jService,
    llm_service: LLMService,
    postgres_store: PostgresStore,
    candidate_privacy_service,
    match_limit: int,
    *,
    actor_user_id: int | None = None,
) -> tuple[bool, str]:
    if not dry_run:
        if (isinstance(actor_user_id, bool) or not isinstance(actor_user_id, int) or actor_user_id <= 0
                or await postgres_store.get_matching_actor(actor_user_id) is None):
            return False, "CV import requires an existing authenticated user"
    # Step 1: read and normalize the PDF text so duplicate detection is stable.
    try:
        extracted_text = pdf_service.extract_text(pdf_path.read_bytes())
    except ValueError as exc:
        return False, f"PDF extraction failed: {exc}"

    source_hash = _normalized_text_hash(extracted_text)
    if dry_run:
        return True, f"dry-run ok: mode=cv extracted_chars={len(extracted_text)} source_hash={source_hash[:12]}"

    # Step 2: skip files whose normalized text already exists in Neo4j
    # (spart das Parsen; die Person ist dann bereits angelegt).
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
        profile = await extract_candidate_profile(llm_service, extracted_text)
    except Exception as exc:
        return False, f"candidate parsing failed: {exc}"
    ensure_birth_date(profile, extracted_text)

    # Mit Geburtsdatum machen Name + Geburtsdatum die Person eindeutig
    # (ohne wird nicht auf Dubletten geprueft); PostgreSQL legt an,
    # der Neo4j-Knoten erhaelt dieselbe UUID.
    try:
        stored = await create_candidate(
            postgres_store=postgres_store,
            candidate_privacy_service=candidate_privacy_service,
            db_service=db_service,
            llm_service=llm_service,
            build_skill_embeddings=lambda names: _build_skill_embeddings(names, llm_service),
            profile=profile,
            candidate_text=extracted_text,
            source="CV-Batch-Import",
            source_hash=source_hash,
            profile_hash=_normalized_profile_hash(profile),
            actor_user_id=actor_user_id,
        )
    except DuplicateCandidateError as exc:
        duplicate_dir.mkdir(parents=True, exist_ok=True)
        destination = ensure_unique_destination(duplicate_dir, pdf_path.name)
        shutil.move(str(pdf_path), str(destination))
        return True, f"duplicate skipped: existing_candidate_id={exc.existing.get('id')} moved_to={destination}"
    except CandidateIdentityError as exc:
        return False, f"rejected: {exc}"
    except Exception as exc:
        return False, f"candidate persistence failed: {exc}"

    candidate_id = stored["uuid"]
    run_id = stored.get("matchingRunId")
    if not run_id:
        return False, f"candidate id={candidate_id} saved without confirmation of a durable matching run"

    # Move only after the PostgreSQL source and durable outbox are confirmed.
    done_dir.mkdir(parents=True, exist_ok=True)
    destination = ensure_unique_destination(done_dir, pdf_path.name)
    shutil.move(str(pdf_path), str(destination))

    lines = [f"imported as candidate id={candidate_id}"]
    lines.append(f"matching run id={run_id} status={stored['matchingStatus']} (asynchronous, all stored jobs)")
    lines.append(f"preparation status={stored['preparationStatus']}")
    if stored.get("preparationError"):
        lines.append(f"preparation error={stored['preparationError']}")
    return True, "\n".join(lines)


async def run_cv_import(args: argparse.Namespace) -> int:
    database_url = _resolve_local_database_url(settings.database_url)
    postgres_store = PostgresStore(database_url)
    actor_user_id = None
    if not args.dry_run:
        try:
            token = await asyncio.to_thread(resolve_auth_token, args)
            actor_user_id = await validate_cv_import_actor(args.api_base, args.timeout_seconds, token, postgres_store)
        except (RuntimeError, ValueError, httpx.HTTPError, psycopg.Error) as exc:
            print(f"CV import authentication failed before writes: {exc}")
            return 1
        await init_schema()

    pdf_service = PDFService()
    candidate_privacy_service = CandidatePrivacyService(postgres_store)
    prompt_service = PromptService(postgres_store)
    db_service = Neo4jService(
        uri=settings.neo4j_uri,
        user=settings.neo4j_user,
        password=settings.neo4j_password,
        postgres_store=postgres_store,
    )
    model_config_service = ModelConfigService(
        postgres_store,
        default_chat_base_url=settings.resolved_ai_base_url,
        default_chat_model=settings.resolved_chat_model,
        default_embedding_model=settings.initial_embedding_model or settings.resolved_embedding_model,
        default_provider=settings.resolved_provider,
        default_api_key=settings.resolved_api_key,
        default_reasoning_level=settings.resolved_reasoning_level,
    )
    llm_service = LLMService(
        provider=settings.resolved_provider,
        base_url=settings.resolved_ai_base_url,
        api_key=settings.resolved_api_key,
        chat_model=settings.resolved_chat_model,
        embedding_model=settings.resolved_embedding_model,
        embedding_dimensions=settings.embedding_dimensions,
        enable_reasoning=settings.resolved_reasoning_level != "none",
        reasoning_level=settings.resolved_reasoning_level,
        enable_parse_latency_aggregation=settings.enable_parse_latency_aggregation,
        parse_latency_window_size=settings.parse_latency_window_size,
        parse_latency_log_every=settings.parse_latency_log_every,
        database_url=database_url,
        model_config_service=model_config_service,
        prompt_service=prompt_service,
    )

    input_dir = _resolve_input_dir(args)
    done_dir = Path(args.done_dir) if args.done_dir else (input_dir / "done")

    try:
        if not input_dir.exists():
            print(f"Input directory does not exist: {input_dir}")
            return 1

        pdf_files = sorted(p for p in input_dir.iterdir() if _is_real_pdf_file(p))

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
                    postgres_store=postgres_store,
                    candidate_privacy_service=candidate_privacy_service,
                    match_limit=args.match_limit,
                    actor_user_id=actor_user_id,
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


async def run_job_import(args: argparse.Namespace) -> int:
    pdf_service = PDFService()
    token = resolve_auth_token(args)

    input_dir = _resolve_input_dir(args)
    done_dir = Path(args.done_dir) if args.done_dir else (input_dir / "done")

    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}")
        return 1

    pdf_files = sorted(p for p in input_dir.iterdir() if _is_real_pdf_file(p))

    if not pdf_files:
        print(f"No PDF files found in {input_dir}")
        return 0

    ok_count = 0
    fail_count = 0

    for pdf in pdf_files:
        print(f"Processing {pdf.name} ...")
        try:
            ok, message = await process_job_file(
                pdf_path=pdf,
                done_dir=done_dir,
                dry_run=args.dry_run,
                api_base=args.api_base,
                timeout_seconds=args.timeout_seconds,
                token=token,
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


def main() -> int:
    args = parse_args()
    if args.mode == "cv":
        return asyncio.run(run_cv_import(args))
    return asyncio.run(run_job_import(args))


if __name__ == "__main__":
    sys.exit(main())
