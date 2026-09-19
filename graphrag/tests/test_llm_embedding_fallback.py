from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService


@pytest.mark.anyio
async def test_ollama_embedding_falls_back_even_when_strict() -> None:
    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="openai/text-embedding-3-small",
        embedding_dimensions=8,
        provider="ollama",
    )
    service.client.post = AsyncMock(side_effect=RuntimeError("model missing"))

    try:
        vector = await service.create_embedding({"entity": "candidate", "name": "Ada Lovelace"}, allow_fallback=False)
    finally:
        await service.close()

    assert len(vector) == 8
    assert any(item != 0 for item in vector)