from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService


@pytest.mark.asyncio
async def test_generate_json_writes_llm_call_log(tmp_path) -> None:
    log_path = tmp_path / "llm-calls.jsonl"
    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
        enable_call_logging=True,
        call_log_path=str(log_path),
    )
    service.client.post = AsyncMock(
        return_value=httpx.Response(
            200,
            request=httpx.Request("POST", "http://fake-ai/api/generate"),
            json={"response": '{"name":"Anna Mueller"}'},
        )
    )

    try:
        result = await service._generate_json(
            system_prompt="Extract a profile.",
            user_content="Anna Mueller\nSenior Data Engineer",
            call_context="test-context",
            required_keys=("name",),
        )
    finally:
        await service.close()

    assert result["name"] == "Anna Mueller"
    assert log_path.exists()

    lines = log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1

    entry = json.loads(lines[0])
    assert entry["context"] == "test-context"
    assert entry["success"] is True
    assert entry["parsed_result"]["name"] == "Anna Mueller"
    assert entry["request_body"]["model"] == "test-model"