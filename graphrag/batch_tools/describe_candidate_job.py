#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import math
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg

PROJECT_ROOT = Path(__file__).resolve().parents[2]
GRAPHRAG_ROOT = PROJECT_ROOT / "graphrag"
for path in (GRAPHRAG_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("DATABASE_URL", "postgresql://hrtool:hrtoolpw@localhost:5432/hrtool")

from config import settings
from services.candidate_text_renderer import build_candidate_profile_json, render_candidate_fulltext
from services.db import Neo4jService
from services.model_config import ModelConfigService
from services.llm import LLMService
from services.postgres_store import PostgresStore
from services.matching_orchestrator import MatchingOrchestrator
from services.skill_matching import SkillMatchingResult, SkillMatchingService


DEFAULT_CANDIDATE_NAME = "Chantal Moiree"
DEFAULT_JOB_TITLE = "PostgreSQL-Datenbank-Administrator (w/m/d)"
DEFAULT_TOP_PAIRS = 100


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


def _candidate_database_urls(database_url: str) -> list[str]:
    urls = [database_url]
    parsed = urlsplit(database_url)
    if parsed.hostname == "postgres":
        fallback_netloc = parsed.netloc.replace("postgres", "localhost", 1)
        fallback_url = urlunsplit((parsed.scheme, fallback_netloc, parsed.path, parsed.query, parsed.fragment))
        if fallback_url not in urls:
            urls.append(fallback_url)
    return urls


def _build_llm_service(database_url: str) -> LLMService:
    postgres_store = PostgresStore(database_url)
    model_config_service = ModelConfigService(
        postgres_store,
        default_chat_base_url=settings.resolved_ai_base_url,
        default_chat_model=settings.resolved_chat_model,
        default_embedding_model=settings.initial_embedding_model or settings.resolved_embedding_model,
        default_provider=settings.resolved_provider,
        default_api_key=settings.resolved_api_key,
        default_reasoning_level=settings.resolved_reasoning_level,
    )
    return LLMService(
        provider=settings.resolved_provider,
        base_url=settings.resolved_ai_base_url,
        api_key=settings.resolved_api_key,
        chat_model=settings.resolved_chat_model,
        embedding_model=settings.resolved_embedding_model,
        embedding_dimensions=settings.embedding_dimensions,
        enable_reasoning=settings.resolved_reasoning_level != "none",
        reasoning_level=settings.resolved_reasoning_level,
        enable_call_logging=False,
        database_url=database_url,
        model_config_service=model_config_service,
    )


def _embedding_config_summary() -> dict[str, str]:
    return {
        "provider": settings.resolved_provider,
        "base_url": settings.resolved_ai_base_url,
        "chat_model": settings.resolved_chat_model,
        "embedding_model": settings.resolved_embedding_model,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="List candidate CV and job details including Neo4j skills and embeddings."
    )
    parser.add_argument(
        "--candidate-name",
        default=DEFAULT_CANDIDATE_NAME,
        help=f"Candidate name to load (default: {DEFAULT_CANDIDATE_NAME})",
    )
    parser.add_argument(
        "--job-title",
        default=DEFAULT_JOB_TITLE,
        help=f"Job title to load (default: {DEFAULT_JOB_TITLE})",
    )
    parser.add_argument(
        "--top-pairs",
        type=int,
        default=DEFAULT_TOP_PAIRS,
        help=f"How many central skill matrix cells to print after full scoring (default: {DEFAULT_TOP_PAIRS})",
    )
    return parser.parse_args()


def _format_value(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or "-"
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        if not value:
            return "-"
        if all(isinstance(item, (int, float)) for item in value):
            return ", ".join(f"{float(item):.6f}" for item in value)
        return ", ".join(_format_value(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _print_section(title: str) -> None:
    print()
    print(title)
    print("=" * len(title))


def _print_kv(label: str, value: Any) -> None:
    print(f"{label}: {_format_value(value)}")


def _cosine_similarity(left: list[float] | tuple[float, ...], right: list[float] | tuple[float, ...]) -> float:
    """Document diagnostics only; deprecated for skills in favor of SkillMatchingService."""
    if not left or not right:
        return 0.0
    length = min(len(left), len(right))
    if length == 0:
        return 0.0
    dot_product = sum(float(left[index]) * float(right[index]) for index in range(length))
    left_norm = math.sqrt(sum(float(left[index]) ** 2 for index in range(length)))
    right_norm = math.sqrt(sum(float(right[index]) ** 2 for index in range(length)))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, min(1.0, dot_product / (left_norm * right_norm)))


def _dot_product(left: list[float] | tuple[float, ...], right: list[float] | tuple[float, ...]) -> float:
    """Deprecated skill-diagnostic reference; use the central SkillMatchingResult matrix."""
    length = min(len(left), len(right))
    return sum(float(left[index]) * float(right[index]) for index in range(length)) if length else 0.0


def _vector_norm(values: list[float] | tuple[float, ...]) -> float:
    """Deprecated skill-diagnostic reference; use the central SkillMatchingResult matrix."""
    return math.sqrt(sum(float(value) ** 2 for value in values)) if values else 0.0


def _format_vector_preview(values: list[float] | tuple[float, ...], limit: int = 8) -> str:
    if not values:
        return "[]"
    preview = ", ".join(f"{float(value):.6f}" for value in values[:limit])
    suffix = " ..." if len(values) > limit else ""
    return f"[{preview}{suffix}]"


def _normalize_skill_name(value: Any) -> str:
    return str(value).strip().lower()


def _collect_skill_names(skill_pairs: list[dict[str, Any]]) -> list[str]:
    """Deprecated diagnostic cache helper; SkillMatchingService handles resolution."""
    ordered_names: list[str] = []
    seen_names: set[str] = set()
    for row in skill_pairs:
        for key in ("job_skill", "cv_skill"):
            name = _normalize_skill_name(row.get(key))
            if name and name not in seen_names:
                seen_names.add(name)
                ordered_names.append(name)
    return ordered_names


async def _build_skill_embedding_cache(llm_service: LLMService, skill_names: list[str]) -> dict[str, list[float]]:
    """Deprecated reference; SkillMatchingService owns embeddings and their configuration."""
    ordered_names = [name for name in skill_names if name]
    if not ordered_names:
        return {}
    vectors = await asyncio.gather(
        *(llm_service.create_embedding({"entity": "skill", "name": skill_name}, allow_fallback=False) for skill_name in ordered_names)
    )
    return {name: vector for name, vector in zip(ordered_names, vectors, strict=True)}


async def _load_top_cosine_pairs(
    db_service: Neo4jService,
    candidate_id: str,
    job_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Deprecated reference only; use MatchingOrchestrator.match_skills and its full matrix."""
    query = """
    MATCH (j:Job {id: $job_id})
    MATCH (c:Candidate {id: $candidate_id})
    OPTIONAL MATCH (j)-[job_rel:REQUIRES_SKILL|NEED_SKILL]->(js:Skill)
    OPTIONAL MATCH (c)-[cand_rel:HAS_SKILL]->(cs:Skill)
    WITH j, c,
            collect(DISTINCT {name: toLower(js.name), category: coalesce(js.category, 'HardSkill'), embedding: js.embedding}) AS job_skills,
            collect(DISTINCT {name: toLower(cs.name), category: coalesce(cs.category, 'HardSkill'), embedding: cs.embedding}) AS candidate_skills
    UNWIND job_skills AS jobSkill
    UNWIND candidate_skills AS candidateSkill
    WITH jobSkill, candidateSkill,
            vector.similarity.cosine(jobSkill.embedding, candidateSkill.embedding) AS cosine
    WHERE jobSkill.name IS NOT NULL
      AND candidateSkill.name IS NOT NULL
      AND jobSkill.embedding IS NOT NULL
      AND candidateSkill.embedding IS NOT NULL
    RETURN jobSkill.name AS job_skill,
           candidateSkill.name AS cv_skill,
             jobSkill.embedding AS job_embedding,
             candidateSkill.embedding AS cv_embedding,
             cosine
    ORDER BY cosine DESC
    LIMIT $limit
    """
    async with db_service.driver.session() as session:
        result = await session.run(query, candidate_id=candidate_id, job_id=job_id, limit=limit)
        rows = await result.data()
    return rows


async def _load_candidate_text(postgres_store: PostgresStore, candidate_id: str) -> dict[str, Any] | None:
    try:
        candidate_text = await postgres_store.get_candidate_text(candidate_id)
        if candidate_text is None:
            return None
        return candidate_text
    except psycopg.OperationalError:
        return None


async def _load_candidate_graph(db_service: Neo4jService, candidate_name: str) -> dict[str, Any] | None:
    candidate = await db_service.find_candidate_by_name(candidate_name)
    if candidate is None:
        return None
    rows = await db_service.get_candidates_for_vectormatch([candidate["id"]], [candidate_name])
    skill_rows = rows[0].get("has_skill", []) if rows else []
    return {"candidate": candidate, "skills": skill_rows}


async def _load_candidate_profile_from_graph(db_service: Neo4jService, candidate_id: str) -> dict[str, Any] | None:
    rows = await db_service.list_candidates_for_backfill()
    for row in rows:
        if str(row.get("candidate_id")) == candidate_id:
            return row
    return None


async def _load_job_graph(db_service: Neo4jService, job_title: str) -> dict[str, Any] | None:
    job = await db_service.find_job_by_name(job_title)
    if job is None:
        return None
    rows = await db_service.get_jobs_for_vectormatch([job["id"]], [job_title])
    skill_rows = rows[0].get("required_skills", []) if rows else []
    job_profile = await db_service.get_job_profile(job["id"])
    return {"job": job, "skills": skill_rows, "profile": job_profile}


def _print_skill_rows(header: str, skills: list[dict[str, Any]]) -> None:
    _print_section(header)
    if not skills:
        print("-")
        return
    for index, skill in enumerate(skills, start=1):
        name = _format_value(skill.get("name"))
        category = _format_value(skill.get("category"))
        level = _format_value(skill.get("level"))
        experience_years = skill.get("experience_years")
        line = f"{index}. {name}"
        details: list[str] = []
        if category != "-":
            details.append(f"Kategorie={category}")
        if level != "-":
            details.append(f"Level={level}")
        if experience_years is not None:
            details.append(f"Jahre={_format_value(experience_years)}")
        print(f"{line} ({'; '.join(details)})")


def _vector_similarity_report(
    name: str,
    neo4j_embedding: list[float],
    python_embedding: list[float],
) -> dict[str, Any]:
    """Deprecated skill-vector diagnostic reference; use the central pair matrix."""
    length = min(len(neo4j_embedding), len(python_embedding))
    if length:
        deltas = [abs(float(neo4j_embedding[index]) - float(python_embedding[index])) for index in range(length)]
        l2_delta = math.sqrt(sum(delta ** 2 for delta in deltas))
        max_abs_delta = max(deltas)
    else:
        l2_delta = 0.0
        max_abs_delta = 0.0
    return {
        "name": name,
        "neo4j_preview": _format_vector_preview(neo4j_embedding),
        "python_preview": _format_vector_preview(python_embedding),
        "neo4j_length": len(neo4j_embedding),
        "python_length": len(python_embedding),
        "embedding_cosine": _cosine_similarity(neo4j_embedding, python_embedding),
        "l2_delta": l2_delta,
        "max_abs_delta": max_abs_delta,
    }


async def _print_skill_matching(
    orchestrator: MatchingOrchestrator, required_skills: object, candidate_skills: object, *, top_pairs: int,
) -> SkillMatchingResult:
    if top_pairs < 1:
        raise ValueError("top_pairs must be positive.")
    assessment = await orchestrator.match_skills(required_skills, candidate_skills)
    result = assessment.result
    _print_section("Zentrale Skill-Abdeckung (Diagnose ohne Paarpersistenz)")
    _print_kv("Score (0-100)", result.score)
    _print_kv("Muss-Skills abgedeckt", result.qualified)
    _print_kv("Vollstaendige Skill-Paarmatrix", len(result.matrix))
    for index, cell in enumerate(sorted(result.matrix, key=lambda cell: cell.similarity, reverse=True)[:top_pairs], start=1):
        print(
            f"{index}. {cell.need_skill} / {cell.has_skill or '-'} / "
            f"raw={cell.similarity:.6f} / weighted={cell.weighted_similarity:.6f} / "
            f"resolution={cell.need_resolution_status}:{cell.has_resolution_status or '-'} / "
            f"priority={cell.priority} / best={cell.best_candidate} / contribution={cell.score_contribution:.6f} / "
            f"covered={cell.covered} / reason={cell.reason}"
        )
    return result


async def _print_document_diagnostics(db_service: Neo4jService, candidate_id: str, job_id: str) -> None:
    _print_section("Ganzdokument-Diagnostik (kein Skill-/AI-Score)")
    async with db_service.driver.session() as session:
        result = await session.run(
            "MATCH (c:Candidate {id: $candidate_id}), (j:Job {id: $job_id}) "
            "RETURN c.embedding AS candidate_embedding, j.embedding AS job_embedding",
            candidate_id=candidate_id, job_id=job_id,
        )
        record = await result.single()
    if record is None or not record["candidate_embedding"] or not record["job_embedding"]:
        print("Dokumentvektoren nicht vorhanden.")
        return
    candidate_vector, job_vector = record["candidate_embedding"], record["job_embedding"]
    if len(candidate_vector) != len(job_vector):
        raise ValueError("Dokumentvektoren haben unterschiedliche Dimensionen.")
    _print_kv("CV-Vektor", _format_vector_preview(candidate_vector))
    _print_kv("Job-Vektor", _format_vector_preview(job_vector))
    _print_kv("Dokument-Cosinus (nur Diagnose)", _cosine_similarity(candidate_vector, job_vector))


async def run(args: argparse.Namespace) -> int:
    _load_env_file(PROJECT_ROOT / ".env")

    database_url = settings.database_url
    neo4j_uri = settings.neo4j_uri
    neo4j_user = settings.neo4j_user
    neo4j_password = settings.neo4j_password

    if not neo4j_password:
        print("NEO4J_PASSWORD ist nicht gesetzt.")
        return 1

    postgres_store = PostgresStore(database_url)
    db_service = Neo4jService(neo4j_uri, neo4j_user, neo4j_password)
    llm_service = _build_llm_service(database_url)

    try:
        embedding_config = _embedding_config_summary()

        candidate_graph = await _load_candidate_graph(db_service, args.candidate_name)
        if candidate_graph is None:
            print(f"Kein Kandidat in Neo4j gefunden: {args.candidate_name}")
            return 1

        candidate_id = str(candidate_graph["candidate"]["id"])
        candidate_text = await _load_candidate_text(postgres_store, candidate_id)
        if candidate_text is None:
            for fallback_database_url in _candidate_database_urls(database_url)[1:]:
                candidate_text = await _load_candidate_text(PostgresStore(fallback_database_url), candidate_id)
                if candidate_text is not None:
                    break
        if candidate_text is None:
            candidate_profile = await _load_candidate_profile_from_graph(db_service, candidate_id)
            if candidate_profile is not None:
                work_history = candidate_profile.get("work_history") or []
                education_history = candidate_profile.get("education_history") or []
                candidate_text = {
                    "candidate_id": candidate_id,
                    "candidate_name": candidate_profile.get("name") or candidate_graph["candidate"].get("name"),
                    "source": "neo4j_backfill_fallback",
                    "original_text": render_candidate_fulltext(
                        candidate_profile,
                        work_history=work_history,
                        education_history=education_history,
                    ),
                    "anonymized_text": None,
                    "mapping": {},
                    "profile_json": build_candidate_profile_json(
                        candidate_profile,
                        work_history=work_history,
                        education_history=education_history,
                    ),
                }
        if candidate_text is None:
            print(f"Kein CV-Text in PostgreSQL gefunden für Kandidat-Id {candidate_id}")
            return 1

        job_graph = await _load_job_graph(db_service, args.job_title)
        if job_graph is None:
            print(f"Kein Job in Neo4j gefunden: {args.job_title}")
            return 1

        job_id = str(job_graph["job"]["id"])

        _print_section("Kandidat")
        _print_kv("Name", candidate_graph["candidate"].get("name"))
        _print_kv("Neo4j-ID", candidate_id)
        _print_kv("Ort", candidate_graph["candidate"].get("location"))
        _print_kv("Berufserfahrung", candidate_text.get("original_text"))
        profile_json = candidate_text.get("profile_json") or {}
        if isinstance(profile_json, dict):
            _print_kv("Aktuelle Position", profile_json.get("current_position"))
            _print_kv("Aktueller Arbeitgeber", profile_json.get("current_employer"))
            _print_kv("Ausbildung", profile_json.get("education"))
            _print_kv("Verfügbarkeit", profile_json.get("availability"))
            _print_kv("Sprachen", profile_json.get("languages"))
            _print_kv("Skills-Text", profile_json.get("skills"))

        _print_skill_rows("Kandidat-Skills aus Neo4j", candidate_graph["skills"])

        _print_section("Job")
        _print_kv("Titel", job_graph["job"].get("title"))
        _print_kv("Neo4j-ID", job_id)
        _print_kv("Unternehmen", job_graph["job"].get("company"))
        _print_kv("Abteilung", job_graph["job"].get("department"))
        _print_kv("Ort", job_graph["job"].get("location"))
        _print_kv("Employment Type", job_graph["job"].get("employment_type"))
        job_profile = job_graph.get("profile") or {}
        if isinstance(job_profile, dict):
            _print_kv("Job-Beschreibung", job_profile.get("description"))
            _print_kv("Anforderungen", job_profile.get("required_skills"))

        _print_skill_rows("Job-Skills aus Neo4j", job_graph["skills"])

        _print_section("Embedding-Konfiguration")
        _print_kv("Provider", embedding_config["provider"])
        _print_kv("Base URL", embedding_config["base_url"])
        _print_kv("Chat Model", embedding_config["chat_model"])
        _print_kv("Embedding Model", embedding_config["embedding_model"])

        await _print_skill_matching(
            MatchingOrchestrator(SkillMatchingService(llm_service, db_service, similarity_cutoff=settings.skill_matching_cutoff)),
            job_graph["skills"], candidate_graph["skills"], top_pairs=args.top_pairs,
        )
        await _print_document_diagnostics(db_service, candidate_id, job_id)

        return 0
    finally:
        await db_service.close()
        await llm_service.close()


def main() -> int:
    args = parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())