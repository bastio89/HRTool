from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.model_config import ModelConfigService, ModelRuntimeConfig
from services.postgres_store import PostgresStore


@pytest.mark.anyio
async def test_model_config_service_caches_and_invalidates(monkeypatch) -> None:
    store = PostgresStore("postgresql://example")
    get_settings = AsyncMock(side_effect=[
        {
            "ai_base_url": "https://openrouter.ai/api/v1",
            "ai_model": "chat-a",
            "ai_embedding_model": "embed-a",
            "ai_provider": "openai",
            "ai_api_key": "secret-a",
            "ai_reasoning_level": "medium",
        },
        {
            "ai_base_url": "http://localhost:11434",
            "ai_model": "chat-b",
            "ai_embedding_model": "embed-b",
            "ai_provider": "ollama",
            "ai_api_key": "secret-b",
            "ai_reasoning_level": "low",
        },
    ])
    monkeypatch.setattr(store, "get_settings", get_settings)

    service = ModelConfigService(store, ttl_seconds=60)

    first = await service.get_chat_model()
    second = await service.get_chat_model()
    assert first == second
    assert first.provider == "openrouter"
    assert first.model == "chat-a"
    assert first.reasoning_level == "medium"
    assert get_settings.await_count == 1

    service.invalidate()
    refreshed = await service.get_chat_model()
    assert refreshed.provider == "ollama"
    assert refreshed.model == "chat-b"
    assert refreshed.api_key == "secret-b"
    assert get_settings.await_count == 2


@pytest.mark.anyio
async def test_model_config_service_separates_chat_and_embedding_models(monkeypatch) -> None:
    store = PostgresStore("postgresql://example")
    monkeypatch.setattr(
        store,
        "get_settings",
        AsyncMock(return_value={
            "ai_base_url": "https://openrouter.ai/api/v1",
            "ai_model": "chat-model",
            "ai_embedding_model": "embedding-model",
            "ai_provider": "openai",
        }),
    )

    service = ModelConfigService(store)

    chat_config = await service.get_chat_model()
    embedding_config = await service.get_embedding_model()

    assert chat_config.task == "chat"
    assert embedding_config.task == "embedding"
    assert chat_config.model == "chat-model"
    assert embedding_config.model == "embedding-model"
    assert chat_config.provider == embedding_config.provider == "openrouter"
