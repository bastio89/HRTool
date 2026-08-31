from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.llm import LLMService


@pytest.mark.asyncio
async def test_generate_json_writes_llm_call_log_to_sqlite(tmp_path) -> None:
    db_path = tmp_path / "hrtool.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE ai_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                feature TEXT NOT NULL,
                model TEXT,
                model_version TEXT,
                prompt_hash TEXT,
                prompt TEXT,
                response TEXT,
                parsed_result TEXT,
                skills TEXT,
                duration_ms INTEGER,
                input_tokens INTEGER,
                output_tokens INTEGER,
                success INTEGER DEFAULT 1,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.commit()

    service = LLMService(
        base_url="http://fake-ai",
        chat_model="test-model",
        embedding_model="test-embedding",
        embedding_dimensions=8,
        enable_call_logging=True,
        backend_db_path=str(db_path),
    )
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

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT feature, model, prompt, response, parsed_result, skills, success FROM ai_logs LIMIT 1"
        ).fetchone()

    assert row is not None
    assert row[0] == "test-context"
    assert row[1] == "test-model"
    assert json.loads(row[2])["model"] == "test-model"
    assert json.loads(row[3])["response"] == '{"name":"Anna Mueller","required_skills":[{"name":"Python"},{"name":"SQL"}]}'
    assert json.loads(row[4])["name"] == "Anna Mueller"
    assert row[5] == "Python, SQL"
    assert row[6] == 1