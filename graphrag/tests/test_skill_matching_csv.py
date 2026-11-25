from __future__ import annotations

import json
import os

import psycopg
from psycopg.types.json import Jsonb
import pytest

from config import settings
from models import SkillMatchingRequest
from services.skill_matching import RequiredSkill, SkillMatchingService
from services.skill_matching_test_cases import SkillMatchingTestCaseStore


def test_skill_matching_test_case_seed_is_valid() -> None:
    cases = SkillMatchingTestCaseStore._read_seed_cases()
    assert cases
    assert all(case.need_skills for case in cases)
    assert all(0 <= case.expected_score <= 100 for case in cases)


@pytest.mark.anyio
@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="DATABASE_URL fuer Testdatenbank fehlt.")
@pytest.mark.parametrize("customization", [None, "expected-score", "skills"])
async def test_score_rule_migration_updates_only_the_unchanged_builtin_case(customization) -> None:
    case = next(case for case in SkillMatchingTestCaseStore._read_seed_cases() if case.test_id == "missing_mandatory_gate")
    expected_score = 25 if customization == "expected-score" else 0
    has_skills = ["Python", "welding"] if customization == "skills" else case.has_skills
    async with await psycopg.AsyncConnection.connect(os.environ["DATABASE_URL"]) as connection:
        async with connection.cursor() as cursor:
            await cursor.execute(
                """CREATE TEMP TABLE skill_matching_test_cases (
                    test_id TEXT PRIMARY KEY, need_skills JSONB, has_skills JSONB,
                    expected_score INTEGER, updated_at TIMESTAMPTZ
                )"""
            )
            await cursor.execute(
                "CREATE TEMP TABLE skill_matching_test_case_migrations (version INTEGER PRIMARY KEY)"
            )
            await cursor.execute(
                "INSERT INTO skill_matching_test_cases (test_id, need_skills, has_skills, expected_score) VALUES (%s, %s, %s, %s)",
                (case.test_id, Jsonb([skill.model_dump() for skill in case.need_skills]), Jsonb(has_skills), expected_score),
            )

            await SkillMatchingTestCaseStore._migrate_score_rule(cursor)
            await SkillMatchingTestCaseStore._migrate_score_rule(cursor)

            await cursor.execute("SELECT expected_score, has_skills FROM skill_matching_test_cases")
            assert await cursor.fetchone() == (33 if customization is None else expected_score, has_skills)
            await cursor.execute("SELECT COUNT(*) FROM skill_matching_test_case_migrations")
            assert await cursor.fetchone() == (1,)


@pytest.mark.anyio
@pytest.mark.skipif(
    os.getenv("RUN_SKILL_MATCHING_CSV_TESTS") != "1",
    reason="Opt-in: RUN_SKILL_MATCHING_CSV_TESTS=1 benötigt Neo4j/ESCO und Embedding-Konfiguration.",
)
async def test_skill_matching_csv_scores_against_configured_graphrag() -> None:
    if not settings.initial_embedding_model and not settings.resolved_embedding_model:
        pytest.fail("Für den CSV-Integrationstest muss ein Embedding-Modell konfiguriert sein.")
    if settings.neo4j_password in {"test-password", "your_neo4j_password"}:
        pytest.fail("Für den CSV-Integrationstest müssen echte Neo4j-Zugangsdaten gesetzt sein.")

    from main import db_service, llm_service, skill_matching_test_case_store
    from main import model_config_service
    from matching_api import SKILL_MATCHING_API_METHOD, SKILL_MATCHING_API_PATH

    await skill_matching_test_case_store.ensure_schema()
    cases = await skill_matching_test_case_store.list_cases()
    if not cases:
        pytest.fail("In PostgreSQL sind keine Skill-Matching-Testfälle hinterlegt.")

    service = SkillMatchingService(
        llm_service,
        db_service,
        similarity_cutoff=settings.skill_matching_cutoff,
    )
    failures = []
    try:
        print("Testid | Soll-Score | Ist-Score | Differenz | Ergebnis")
        for case in cases:
            payload = SkillMatchingRequest.model_validate(
                {
                    "need_skills": case["need_skills"],
                    "has_skills": case["has_skills"],
                }
            )
            result = await service.match(
                [
                    RequiredSkill(name=skill.name, priority=skill.priority)
                    for skill in payload.need_skills
                ],
                payload.has_skills,
            )
            for match in result.matrix:
                print(
                    "SKILL_MATCHING_MATRIX_JSON:"
                    + json.dumps(
                        {
                            "test_id": case["test_id"],
                            "need_skill": match.need_skill,
                            "has_skill": match.has_skill,
                            "need_resolution_status": match.need_resolution_status,
                            "has_resolution_status": match.has_resolution_status,
                            "similarity": match.similarity,
                            "weighted_similarity": match.weighted_similarity,
                            "best_candidate": match.best_candidate,
                            "score_contribution": match.score_contribution,
                            "priority": match.priority,
                            "covered": match.covered,
                            "match_type": match.match_type,
                            "reason": match.reason,
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
            expected = case["expected_score"]
            difference = abs(result.score - expected)
            passed = difference <= 5
            print(
                f"{case['test_id']} | {expected} | {result.score} | {difference} | "
                f"{'OK' if passed else 'FEHLER'}"
            )
            if not passed:
                failures.append(
                    f"{case['test_id']}: Soll={expected}, Ist={result.score}, Differenz={difference}"
                )
        embedding_config = await model_config_service.get_embedding_model()
        print(
            "SKILL_MATCHING_EMBEDDING_JSON:"
            + json.dumps(
                {"model": embedding_config.model, "provider": embedding_config.provider},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        service_type = type(service)
        print(
            "SKILL_MATCHING_SERVICE_JSON:"
            + json.dumps(
                {
                    "implementation": f"{service_type.__module__}.{service_type.__qualname__}",
                    "method": service.match.__name__,
                    "api_method": SKILL_MATCHING_API_METHOD,
                    "api_path": SKILL_MATCHING_API_PATH,
                    "invocation": "direct",
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        assert not failures, "\n".join(failures)
    finally:
        await db_service.close()
        await llm_service.close()
