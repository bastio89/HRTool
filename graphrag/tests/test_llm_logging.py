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
async def test_generate_json_writes_llm_call_log_to_postgres() -> None:
    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
        enable_call_logging=True,
        database_url="postgresql://test:test@localhost/test",
    )
    write_log_mock = AsyncMock()
    service.postgres_store.write_ai_log = write_log_mock
    service.client.post = AsyncMock(
        return_value=httpx.Response(
            200,
            request=httpx.Request("POST", "http://fake-ai/api/generate"),
            json={"response": '{"name":"Anna Mueller","required_skills":[{"name":"Python"},{"name":"SQL"}]}'},
        )
    )

    try:
        result = await service._generate_json(
            system_prompt="Extract a profile.",
            user_content="Anna Mueller\nSenior Data Engineer",
            call_context="test-context",
            required_keys=("name", "required_skills"),
        )
    finally:
        await service.close()

    assert result["name"] == "Anna Mueller"
    assert [skill["name"] for skill in result["required_skills"]] == ["Python", "SQL"]

    write_log_mock.assert_awaited_once()
    row = write_log_mock.await_args.args[0]
    assert row[1] == "test-context"
    assert row[2] == "test-model"
    assert json.loads(row[5])["model"] == "test-model"
    assert json.loads(row[6])["response"] == '{"name":"Anna Mueller","required_skills":[{"name":"Python"},{"name":"SQL"}]}'
    assert json.loads(row[7])["name"] == "Anna Mueller"
    assert row[8] == "Python, SQL"
    assert row[12] == 1