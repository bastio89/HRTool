from __future__ import annotations

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio

from matching_api import create_matching_router


class _FakeCatalog:
    async def get_jobs_for_vectormatch(
        self,
        job_ids: list[str],
        job_titles: list[str] | None = None,
    ) -> list[dict[str, object]]:
        return [{"id": job_ids[0], "title": "Data Engineer", "required_skills": []}]

    async def get_candidates_for_vectormatch(
        self,
        candidate_ids: list[str],
        candidate_names: list[str] | None = None,
    ) -> list[dict[str, object]]:
        return [{"id": candidate_ids[0], "name": "Ada", "has_skill": [], "skills": []}]

    async def get_esco_concepts_for_aliases(self, aliases: list[str]) -> list[dict[str, object]]:
        return [
            {
                "uri": "skill:python",
                "preferred_label": "Python",
                "aliases": ["Python programming"],
                "description": "Use the Python programming language.",
            }
        ]


class _FakeEmbedding:
    async def create_embedding(
        self,
        payload: dict[str, object],
        *,
        allow_fallback: bool = True,
    ) -> list[float]:
        return [1.0, 0.0]


@pytest_asyncio.fixture
async def api_client():
    app = FastAPI()
    app.include_router(create_matching_router(_FakeEmbedding(), _FakeCatalog()))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.anyio
async def test_skill_match_returns_canonical_result_and_missing_skill_details(api_client) -> None:
    response = await api_client.post(
        "/match/skills",
        json={
            "need_skills": [{"name": "Python programming"}],
            "has_skills": ["Python"],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "score": 100,
        "qualified": True,
        "cutoff": 0.75,
        "matches": [
            {
                "need_skill": "Python programming",
                "need_esco_uri": "skill:python",
                "need_resolution_status": "resolved",
                "has_skill": "Python",
                "has_esco_uri": "skill:python",
                "has_resolution_status": "resolved",
                "similarity": 1.0,
                "weighted_similarity": 1.0,
                "priority": "mandatory",
                "covered": True,
                "match_type": "canonical",
                "reason": "Identische kanonische ESCO-URI.",
            }
        ],
        "missing_skills": [],
    }


@pytest.mark.anyio
async def test_skill_match_rejects_empty_or_invalid_need_skills(api_client) -> None:
    empty = await api_client.post("/match/skills", json={"need_skills": [], "has_skills": []})
    blank_name = await api_client.post(
        "/match/skills",
        json={"need_skills": [{"name": "   "}], "has_skills": []},
    )
    blank_candidate = await api_client.post(
        "/match/skills",
        json={"need_skills": [{"name": "Python"}], "has_skills": [" "]},
    )

    assert empty.status_code == 422
    assert blank_name.status_code == 422
    assert blank_candidate.status_code == 422


@pytest.mark.anyio
async def test_skill_match_allows_empty_candidate_skills_and_reports_mandatory_gate(api_client) -> None:
    response = await api_client.post(
        "/match/skills",
        json={"need_skills": [{"name": "Python"}], "has_skills": []},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["qualified"] is False
    assert body["score"] == 0
    assert body["matches"][0]["covered"] is False
    assert body["matches"][0]["has_skill"] is None
    assert body["missing_skills"] == [
        {
            "name": "Python",
            "priority": "mandatory",
            "reason": "Keine Kandidaten-Skills angegeben.",
        }
    ]


@pytest.mark.anyio
async def test_new_route_preserves_existing_vectormatch_response_contract(api_client) -> None:
    response = await api_client.post(
        "/match/vectormatch",
        json={"jobIds": ["job-1"], "cvIds": ["candidate-1"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "vectormatch"
    assert body["mode"] == "vectormatch"
    assert body["matrix"][0]["jobId"] == "job-1"
    assert body["matrix"][0]["candidateId"] == "candidate-1"
    assert isinstance(body["matrix"][0]["score"], int)
