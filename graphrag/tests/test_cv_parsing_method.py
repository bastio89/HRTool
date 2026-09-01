from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService


@pytest.mark.anyio
async def test_parse_candidate_cv_marks_parsing_method_as_llm_on_success() -> None:
    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
    )

    async def fake_generate_json(*args, **kwargs):
        return {"name": "Ada Lovelace", "skills": [{"name": "Mathematics"}]}

    service._generate_json = fake_generate_json  # type: ignore[method-assign]

    try:
        profile = await service.parse_candidate_cv("Ada Lovelace, mathematician.")
    finally:
        await service.close()

    assert profile.parsing_method == "llm"


@pytest.mark.anyio
async def test_parse_candidate_cv_marks_parsing_method_as_text_heuristik_when_llm_fails() -> None:
    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
    )

    async def failing_generate_json(*args, **kwargs):
        raise ValueError("LLM unreachable")

    service._generate_json = failing_generate_json  # type: ignore[method-assign]

    try:
        profile = await service.parse_candidate_cv("Max Mustermann\nBerlin, Germany")
    finally:
        await service.close()

    assert profile.parsing_method == "text_heuristik"
