from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService
from services.model_config import ModelRuntimeConfig


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


@pytest.mark.anyio
async def test_create_embedding_uses_dynamic_model_config(monkeypatch) -> None:
    config_service = AsyncMock()
    config_service.get_embedding_model.return_value = ModelRuntimeConfig(
        task="embedding",
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        model="openrouter/embedding-model",
        api_key="secret-key",
        reasoning_level="none",
    )

    service = LLMService(
        base_url="http://ignored",
        chat_model="chat-model",
        embedding_model="fallback-embedding",
        embedding_dimensions=3,
        provider="ollama",
        model_config_service=config_service,
    )
    captured: dict[str, object] = {}

    async def fake_post(url, headers=None, json=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return FakeResponse({"data": [{"embedding": [0.1, 0.2, 0.3]}]})

    service.client.post = fake_post

    try:
        vector = await service.create_embedding({"entity": "skill", "name": "Python"}, allow_fallback=False)
    finally:
        await service.close()

    assert vector == [0.1, 0.2, 0.3]
    assert captured["url"] == "https://openrouter.ai/api/v1/embeddings"
    assert captured["headers"] == {"Authorization": "Bearer secret-key"}
    assert captured["json"]["model"] == "openrouter/embedding-model"
    assert config_service.get_embedding_model.await_count == 1


@pytest.mark.anyio
async def test_parse_job_description_uses_dynamic_chat_config(monkeypatch) -> None:
    config_service = AsyncMock()
    config_service.get_chat_model.return_value = ModelRuntimeConfig(
        task="chat",
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        model="openrouter/chat-model",
        api_key="secret-key",
        reasoning_level="none",
    )
    prompt_service = AsyncMock()
    prompt_service.get_prompt.side_effect = lambda key, variables=None: {
        "job_profile_extraction": "Prompt job_profile_extraction",
        "job_profile_extraction_lightweight": "Prompt job_profile_extraction_lightweight",
        "json_only_response_instruction": "Antworte ausschließlich mit gültigem JSON und ohne Markdown oder zusätzlichen Text. Wandle die Eingabe in eine strukturierte JSON-Antwort um.",
    }[key]

    service = LLMService(
        base_url="http://ignored",
        chat_model="fallback-chat",
        embedding_model="fallback-embedding",
        embedding_dimensions=3,
        provider="ollama",
        model_config_service=config_service,
        prompt_service=prompt_service,
    )
    captured: dict[str, object] = {}

    async def fake_post(url, headers=None, json=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return FakeResponse({
            "choices": [
                {
                    "message": {
                        "content": '{"title":"Backend Engineer","company":"Acme","location":"Bern","employment_type":"Vollzeit","department":null,"about_us":"","description":"","requirements":"","benefits":"","required_skills":[],"required_languages":[],"required_degrees":[],"industries":[]}'
                    }
                }
            ]
        })

    service.client.post = fake_post

    try:
        result = await service.parse_job_description("Backend Engineer\nAcme\nBern")
    finally:
        await service.close()

    assert result.title == "Backend Engineer"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert captured["headers"] == {"Authorization": "Bearer secret-key"}
    assert captured["json"]["model"] == "openrouter/chat-model"
    assert config_service.get_chat_model.await_count == 1


@pytest.mark.anyio
async def test_llm_service_reports_missing_prompt_resolver() -> None:
    service = LLMService(
        base_url="http://ignored",
        chat_model="fallback-chat",
        embedding_model="fallback-embedding",
        embedding_dimensions=3,
        provider="ollama",
    )

    with pytest.raises(RuntimeError, match="Prompt-Resolver ist nicht konfiguriert"):
        await service._resolve_prompt("candidate_name_extraction")
