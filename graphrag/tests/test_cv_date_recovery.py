from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pypdf import PdfReader
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService


def make_llm_service() -> LLMService:
    prompt_service = AsyncMock()
    prompt_service.get_prompt.side_effect = lambda key, variables=None: {
        "candidate_profile_extraction": "Prompt candidate_profile_extraction",
        "candidate_name_extraction": "Prompt candidate_name_extraction",
        "json_only_response_instruction": "Antworte ausschließlich mit gültigem JSON und ohne Markdown oder zusätzlichen Text. Wandle die Eingabe in eine strukturierte JSON-Antwort um.",
    }[key]

    return LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
        prompt_service=prompt_service,
    )


@pytest.mark.anyio
async def test_parse_candidate_cv_recovers_work_history_dates_from_pdf_text() -> None:
    # Per glob statt per Literal: der Dateiname enthaelt ein "OE", und das
    # Literal stand hier in zerlegter Form (O + U+0308), waehrend die Datei
    # zusammengesetzt (U+00D6) im Repository liegt. Unter Linux sind das zwei
    # verschiedene Namen - der Test hat die Datei nie gefunden.
    fixture_path = next(Path(__file__).parent.glob("CV 16*.pdf"))
    raw_text = "\n".join(page.extract_text() or "" for page in PdfReader(str(fixture_path)).pages)

    service = make_llm_service()

    async def fake_generate_json(*args, **kwargs):
        return {
            "name": "Omar El-Sayed",
            "work_history": [
                {
                    "position": "Senior Android Developer",
                    "employer": "SBB AG",
                    "location": "Bern",
                }
            ],
        }

    service._generate_json = fake_generate_json  # type: ignore[method-assign]

    try:
        profile = await service.parse_candidate_cv(raw_text)
    finally:
        await service.close()

    assert profile.work_history[0].position == "Senior Android Developer"
    assert profile.work_history[0].employer == "SBB AG"
    assert profile.work_history[0].from_date == "2016-01"
    assert profile.work_history[0].to_date is None
    assert profile.work_history[0].is_current is True


@pytest.mark.anyio
async def test_parse_candidate_cv_recovers_education_history_dates_from_pdf_text() -> None:
    # Per glob statt per Literal: der Dateiname enthaelt ein "OE", und das
    # Literal stand hier in zerlegter Form (O + U+0308), waehrend die Datei
    # zusammengesetzt (U+00D6) im Repository liegt. Unter Linux sind das zwei
    # verschiedene Namen - der Test hat die Datei nie gefunden.
    fixture_path = next(Path(__file__).parent.glob("CV 16*.pdf"))
    raw_text = "\n".join(page.extract_text() or "" for page in PdfReader(str(fixture_path)).pages)

    service = make_llm_service()

    async def fake_generate_json(*args, **kwargs):
        return {
            "name": "Omar El-Sayed",
            "education_history": [
                {
                    "degree": "Bachelor of Engineering in Computer Science",
                    "institution": "German University in Cairo",
                }
            ],
        }

    service._generate_json = fake_generate_json  # type: ignore[method-assign]

    try:
        profile = await service.parse_candidate_cv(raw_text)
    finally:
        await service.close()

    assert profile.education_history[0].degree == "Bachelor of Engineering in Computer Science"
    assert profile.education_history[0].institution == "German University in Cairo"
    assert profile.education_history[0].from_date == "2010-01"
    assert profile.education_history[0].to_date == "2013-01"


@pytest.mark.anyio
async def test_parse_candidate_cv_recovers_work_history_from_text_when_llm_returns_none() -> None:
    service = make_llm_service()

    async def fake_generate_json(*args, **kwargs):
        return {
            "name": "Alina Moser",
            "skills": [],
        }

    service._generate_json = fake_generate_json  # type: ignore[method-assign]

    raw_text = (
        "Alina Moser\n"
        "Beruflicher Werdegang\n"
        "Junior Python Developer, Farmy.ch AG, Zürich\n"
        "Entwicklung von Backend-Services.\n"
        "Sprachkompetenzen\n"
        "Deutsch, Englisch\n"
    )

    try:
        profile = await service.parse_candidate_cv(raw_text)
    finally:
        await service.close()

    assert len(profile.work_history) == 1
    assert profile.work_history[0].employer == "Farmy.ch AG"
    assert profile.work_history[0].position == "Junior Python Developer"
    assert profile.current_employer == "Farmy.ch AG"
    assert profile.current_position == "Junior Python Developer"


@pytest.mark.anyio
async def test_parse_job_description_falls_back_when_ai_returns_non_json() -> None:
    service = make_llm_service()

    async def fake_generate_json(*args, **kwargs):
        return "unexpected plain text response"

    service._generate_json = fake_generate_json  # type: ignore[method-assign]

    try:
        profile = await service.parse_job_description("Senior Backend Engineer with Node.js and SQL")
    finally:
        await service.close()

    assert profile.title == "Senior Backend Engineer"
    assert profile.required_skills == []