from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from plugins.skill_matching_tests import build_skill_matching_tests_router


def _test_case(test_id: str = "case_one") -> dict[str, object]:
    return {
        "id": 1,
        "test_id": test_id,
        "need_skills": [{"name": "Python", "priority": "mandatory"}],
        "has_skills": ["Python"],
        "expected_score": 100,
    }


@pytest.mark.anyio
async def test_run_endpoint_invokes_opt_in_csv_pytest(monkeypatch) -> None:
    process = type(
        "FakeProcess",
        (),
        {
            "returncode": 0,
                "communicate": AsyncMock(return_value=(
                    b'2 passed\nSKILL_MATCHING_EMBEDDING_JSON:{"model":"nomic-embed-text","provider":"ollama"}\nSKILL_MATCHING_SERVICE_JSON:{"implementation":"services.skill_matching.SkillMatchingService","method":"match","api_method":"POST","api_path":"/match/skills","invocation":"direct"}\nSKILL_MATCHING_MATRIX_JSON:{"test_id":"p1","need_skill":"Schreiner","has_skill":"Schreiner","need_resolution_status":"unknown","has_resolution_status":"unknown","similarity":1.0,"weighted_similarity":1.0,"best_candidate":true,"score_contribution":100.0,"priority":"mandatory","covered":true,"match_type":"semantic","reason":"Identische Skill-Bezeichnung nach Normalisierung."}',
                    None,
                )),
        },
    )()
    captured: dict[str, object] = {}

    async def fake_create_subprocess_exec(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return process

    monkeypatch.setattr(
        "plugins.skill_matching_tests.asyncio.create_subprocess_exec",
        fake_create_subprocess_exec,
    )
    app = FastAPI()
    store = SimpleNamespace(
        list_cases=AsyncMock(return_value=[]),
        create_case=AsyncMock(),
        update_case=AsyncMock(),
        delete_case=AsyncMock(),
    )
    app.include_router(build_skill_matching_tests_router(store))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/plugins/skill_matching_tests/run")

    assert response.status_code == 200
    assert response.json() == {
        "passed": True,
        "return_code": 0,
        "output": "2 passed",
        "embedding_model": {"model": "nomic-embed-text", "provider": "ollama"},
        "matching_service": {
            "implementation": "services.skill_matching.SkillMatchingService",
            "method": "match",
            "api_method": "POST",
            "api_path": "/match/skills",
            "invocation": "direct",
        },
        "matrix": [{
            "test_id": "p1",
            "need_skill": "Schreiner",
            "has_skill": "Schreiner",
            "need_resolution_status": "unknown",
            "has_resolution_status": "unknown",
            "similarity": 1.0,
            "weighted_similarity": 1.0,
            "best_candidate": True,
            "score_contribution": 100.0,
            "priority": "mandatory",
            "covered": True,
            "match_type": "semantic",
            "reason": "Identische Skill-Bezeichnung nach Normalisierung.",
        }],
    }
    assert captured["args"][-5:] == ("-m", "pytest", "-q", "-s", "tests/test_skill_matching_csv.py")
    assert captured["kwargs"]["env"]["RUN_SKILL_MATCHING_CSV_TESTS"] == "1"


@pytest.mark.anyio
async def test_case_editor_routes_read_create_update_and_delete_cases() -> None:
    case = _test_case()
    store = SimpleNamespace(
        list_cases=AsyncMock(return_value=[case]),
        create_case=AsyncMock(return_value=case),
        update_case=AsyncMock(return_value=case),
        delete_case=AsyncMock(return_value=True),
    )
    app = FastAPI()
    app.include_router(build_skill_matching_tests_router(store))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listing = await client.get("/plugins/skill_matching_tests/cases")
        created = await client.post("/plugins/skill_matching_tests/cases", json={
            "test_id": "case_one",
            "need_skills": [{"name": "Python", "priority": "mandatory"}],
            "has_skills": ["Python"],
            "expected_score": 100,
        })
        updated = await client.put("/plugins/skill_matching_tests/cases/1", json={
            "test_id": "case_one",
            "need_skills": [{"name": "Python", "priority": "mandatory"}],
            "has_skills": ["Python"],
            "expected_score": 100,
        })
        deleted = await client.delete("/plugins/skill_matching_tests/cases/1")

    assert listing.json() == {"cases": [case]}
    assert created.status_code == 201
    assert created.json() == case
    assert updated.json() == case
    assert deleted.json() == {"deleted": True}
    store.create_case.assert_awaited_once()
    store.update_case.assert_awaited_once()
    store.delete_case.assert_awaited_once_with(1)
