from __future__ import annotations

import sys
from pathlib import Path

import pytest
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService


@pytest.mark.anyio
async def test_parse_candidate_cv_recovers_work_history_dates_from_pdf_text() -> None:
    fixture_path = Path(__file__).parent / "CV 16 - Android Entwickler (Öffentlicher Verkehr) Omar El-Sayed Alter_ 34 - Google Docs.pdf"
    raw_text = "\n".join(page.extract_text() or "" for page in PdfReader(str(fixture_path)).pages)

    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
    )

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
    fixture_path = Path(__file__).parent / "CV 16 - Android Entwickler (Öffentlicher Verkehr) Omar El-Sayed Alter_ 34 - Google Docs.pdf"
    raw_text = "\n".join(page.extract_text() or "" for page in PdfReader(str(fixture_path)).pages)

    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
    )

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
async def test_parse_job_description_falls_back_when_ai_returns_non_json() -> None:
    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
    )

    async def fake_generate_json(*args, **kwargs):
        return "unexpected plain text response"

    service._generate_json = fake_generate_json  # type: ignore[method-assign]

    try:
        profile = await service.parse_job_description("Senior Backend Engineer with Node.js and SQL")
    finally:
        await service.close()

    assert profile.title == "Senior Backend Engineer"
    assert profile.required_skills == []