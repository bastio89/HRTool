from __future__ import annotations

import csv
import json
import os
from pathlib import Path

import pytest

from config import settings
from models import SkillMatchingRequest
from services.skill_matching import RequiredSkill, SkillMatchingService


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "skill_matching_cases.csv"
EXPECTED_COLUMNS = [
    "Testid",
    "need-skills (Liste)",
    "has-skills (Liste)",
    "soll-Score",
]


def _load_cases() -> list[dict[str, str]]:
    with FIXTURE_PATH.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != EXPECTED_COLUMNS:
            raise ValueError(f"Unerwartete CSV-Spalten: {reader.fieldnames!r}")
        return list(reader)


def test_skill_matching_csv_has_valid_four_column_cases() -> None:
    cases = _load_cases()
    assert cases
    for row in cases:
        payload = SkillMatchingRequest.model_validate(
            {
                "need_skills": json.loads(row["need-skills (Liste)"]),
                "has_skills": json.loads(row["has-skills (Liste)"]),
            }
        )
        expected = int(row["soll-Score"])
        assert row["Testid"].strip()
        assert payload.need_skills
        assert 0 <= expected <= 100


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

    from main import db_service, llm_service

    service = SkillMatchingService(
        llm_service,
        db_service,
        similarity_cutoff=settings.skill_matching_cutoff,
    )
    try:
        for row in _load_cases():
            payload = SkillMatchingRequest.model_validate(
                {
                    "need_skills": json.loads(row["need-skills (Liste)"]),
                    "has_skills": json.loads(row["has-skills (Liste)"]),
                }
            )
            result = await service.match(
                [
                    RequiredSkill(name=skill.name, priority=skill.priority)
                    for skill in payload.need_skills
                ],
                payload.has_skills,
            )
            expected = int(row["soll-Score"])
            difference = abs(result.score - expected)
            assert difference <= 5, (
                f"{row['Testid']}: Soll={expected}, Ist={result.score}, Differenz={difference}"
            )
    finally:
        await db_service.close()
        await llm_service.close()
