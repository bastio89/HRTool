from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio

from matching_api import create_matching_router
from models import (
    KiMatchPairInput, KiMatchPairResult, LLMRerankResponse, MatchCandidateResponse, MatchingMatrixRow,
    MatchingPendingResponse, MatchingResultItem, VectorMatchPayload, VectorMatchRequest, VectorMatchRow,
)
from pydantic import ValidationError
from plugins.billing.service import BillingService
from services.postgres_store import PostgresStore
from services.skill_matching import SkillMatchingService


def test_method_specific_results_preserve_zero_null_and_identifier_aliases() -> None:
    pair = KiMatchPairInput.model_validate({"jobId": 2, "cvId": 7})
    request = VectorMatchRequest.model_validate({"jobIds": [pair.job_id], "candidateIds": [pair.candidate_id]})
    skill = VectorMatchRow(
        jobId=str(request.job_ids[0]), candidateId=str(request.cv_ids[0]), score=0, qualified=False,
    )
    ai = KiMatchPairResult(jobId=skill.jobId, candidateId=skill.candidateId, score=85)
    search = MatchCandidateResponse(
        candidate_id=skill.candidateId, score=skill.score, qualified=skill.qualified,
        explanation="Fehlender Muss-Skill.", profile={},
    ).model_dump()

    assert (skill.score, skill.qualified, ai.score, ai.qualified) == (0, False, 85, None)
    assert (skill.method, ai.method, skill.jobId, skill.candidateId) == ("vector", "ai", "2", "7")
    assert search["jaccard_score"] is None
    assert search["vector_score"] is None
    assert search["combined_score"] is None
    assert "contextScore" not in search and "contextScore" not in ai.model_dump()


@pytest.mark.parametrize("result_type", [VectorMatchRow, MatchingMatrixRow, MatchingResultItem, KiMatchPairResult])
def test_result_metadata_preserves_original_model_time_and_score_units(result_type):
    result = result_type.model_validate({
        "method": "ai" if result_type is KiMatchPairResult else "vector",
        "candidateId": "7", "jobId": "2", "score": 50, "vectorScore": 0.5,
        "hardSkillScore": 0.5, "cacheStatus": "hit", "model": "original-model",
        "matchedAt": "2026-01-02T00:00:00Z", "evaluationId": 3,
    }).model_dump(mode="json")
    assert (result["score"], result["model"], result["matchedAt"], result["evaluationId"], result["cacheStatus"]) == (
        50, "original-model", "2026-01-02T00:00:00Z", 3, "hit",
    )
    if result_type is VectorMatchRow:
        assert result["vectorScore"] == result["hardSkillScore"] == 0.5


def test_pending_has_no_result_score_and_completion_preserves_existing_success_shape():
    run_id = uuid4()
    values = {
        "runId": run_id, "statusUrl": f"/matching/runs/{run_id}",
        "pendingPairs": [{"method": "vector", "candidateId": "7", "jobId": "2"}],
    }
    pending = MatchingPendingResponse.model_validate(values).model_dump(mode="json")
    assert "score" not in pending and "score" not in pending["pendingPairs"][0]
    assert pending["availableResults"] == []
    with pytest.raises(ValidationError):
        MatchingPendingResponse.model_validate({**values, "score": 0})
    complete = VectorMatchPayload(
        matchedAt="2026-01-02T00:00:00Z", runId=run_id, statusUrl=values["statusUrl"],
        matrix=[VectorMatchRow(jobId="2", candidateId="7", score=0, qualified=False)],
    ).model_dump(mode="json")
    assert complete["type"] == "vectormatch" and complete["runId"] == str(run_id)
    assert complete["matrix"][0]["score"] == 0 and complete["matrix"][0]["qualified"] is False


class _FakeCatalog:
    def __init__(self) -> None:
        self.postgres_store = AsyncMock(spec=PostgresStore)
        self.postgres_store.matching_ids_for.side_effect = lambda _table, values: {
            value: index + 1 for index, value in enumerate(values)
        }
        self.postgres_store.graph_ids_for.side_effect = lambda _table, values: {
            value: value for value in values
        }

    async def get_jobs_for_vectormatch(
        self,
        job_ids: list[str],
        job_titles: list[str] | None = None,
    ) -> list[dict[str, object]]:
        return [{"id": job_ids[0], "title": "Data Engineer", "required_skills": [{"name": "Python"}]}]

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
        return [0.0, 1.0] if payload["name"] == "SQL" else [1.0, 0.0]


@pytest.fixture
def matching_services(monkeypatch, matching_cache_doubles):
    monkeypatch.setattr(BillingService, "charge", AsyncMock(side_effect=AssertionError("Keine Vorab-Abbuchung")))
    llm = SimpleNamespace(
        create_embedding=AsyncMock(side_effect=_FakeEmbedding().create_embedding),
        parse_job_description=AsyncMock(side_effect=AssertionError("Keine Extraktion im schnellen Lauf")),
        rerank_candidates=AsyncMock(side_effect=AssertionError("Kein AI-Reranking im schnellen Lauf")),
    )
    catalog = _FakeCatalog()
    matching_cache_doubles(catalog.postgres_store, llm)
    charge = BillingService.charge_matching_run
    monkeypatch.setattr(catalog, "get_vectormatch_neo4j_rows", AsyncMock(
        side_effect=AssertionError("Kein altes Cypher-Scoring"),
    ), raising=False)
    return llm, catalog, charge


@pytest_asyncio.fixture
async def api_client(matching_services):
    llm, catalog, _charge = matching_services
    app = FastAPI()
    app.include_router(create_matching_router(llm, catalog))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.anyio
@pytest.mark.parametrize("endpoint", ["/match/external/run", "/match/external/matrix", "/match/external/matrix_neo4j"])
async def test_external_routes_persist_partial_coverage_and_never_run_ai(api_client, matching_services, endpoint):
    llm, catalog, charge = matching_services
    job = {"id": 2, "title": "Engineer", "required_skills": [{"name": "Python"}, {"name": "SQL"}]}
    candidates = [{"id": 7, "name": "Ada", "has_skill": [{"name": "Python"}]}]
    payload = {"job": job, "candidates": candidates} if endpoint.endswith("/run") else {"jobs": [job], "candidates": candidates}

    response = await api_client.post(endpoint, json=payload)

    assert response.status_code == 200
    body = response.json()
    row = body["results"][0] if endpoint.endswith("/run") else body["matrix"][0]
    assert row["score"] == 50 and row["qualified"] is False
    assert row["candidateName"] == "Ada" and row["method"] == "vector"
    assert body["pairsPersisted"] is True
    catalog.postgres_store.complete_matching_evaluation.assert_awaited_once()
    assert catalog.postgres_store.complete_matching_evaluation.await_args.args[0].method == "vector"
    charge.assert_awaited_once()
    assert charge.await_args.args[1:] == (
        ("-1.00", "AI_MATCH") if endpoint.endswith("/run") else ("-0.10", "3D_MATCH")
    )
    llm.parse_job_description.assert_not_awaited()
    llm.rerank_candidates.assert_not_awaited()


@pytest.mark.anyio
async def test_mixed_matrix_charges_once_only_for_owned_misses(api_client, matching_services):
    llm, catalog, charge = matching_services
    job = {"id": 2, "title": "Engineer", "required_skills": ["Python"]}
    candidates = [{"id": 7, "name": "Ada", "skills": ["Python"]}]
    first = await api_client.post("/match/external/matrix", json={"jobs": [job], "candidates": candidates})
    assert first.status_code == 200
    charge.reset_mock()
    llm.create_embedding.reset_mock()

    hit = await api_client.post("/match/external/matrix", json={"jobs": [job], "candidates": candidates})
    assert hit.status_code == 200
    assert hit.json()["matrix"][0]["cacheStatus"] == "hit"
    charge.assert_not_awaited()
    llm.create_embedding.assert_not_awaited()

    mixed = await api_client.post("/match/external/matrix", json={
        "jobs": [job], "candidates": [*candidates, {"id": 8, "name": "Bob", "skills": ["Python"]}],
    })
    assert mixed.status_code == 200
    assert [row["cacheStatus"] for row in mixed.json()["matrix"]] == ["hit", "computed"]
    charge.assert_awaited_once()
    assert charge.await_args.args[1:] == ("-0.10", "3D_MATCH")
    assert catalog.postgres_store.complete_matching_evaluation.await_count == 2


@pytest.mark.anyio
async def test_join_uses_owners_result_without_its_own_charge(api_client, matching_services):
    llm, catalog, charge = matching_services
    catalog.postgres_store.claim_matching_evaluation.return_value = {"id": 42, "disposition": "pending"}
    catalog.postgres_store.claim_matching_evaluation.side_effect = None
    catalog.postgres_store.get_cached_matching_evaluation.side_effect = [
        None, {"id": 42, "result_payload": {
            "jobId": "2", "candidateId": "7", "score": 50, "qualified": False,
            "model": "original-model", "matchedAt": "2026-01-02T00:00:00Z",
        }},
    ]
    response = await api_client.post("/match/external/matrix", json={
        "jobs": [{"id": 2, "title": "Engineer", "required_skills": ["Python"]}],
        "candidates": [{"id": 7, "name": "Ada", "skills": ["Python"]}],
    })
    assert response.status_code == 200, response.text
    row = response.json()["matrix"][0]
    assert (row["cacheStatus"], row["score"], row["evaluationId"], row["model"]) == ("hit", 50, 42, "original-model")
    charge.assert_not_awaited()
    llm.create_embedding.assert_not_awaited()
    catalog.postgres_store.complete_matching_evaluation.assert_not_awaited()


@pytest.mark.anyio
async def test_credit_block_prevents_any_scoring_and_releases_unbilled_claims(api_client, matching_services):
    llm, catalog, charge = matching_services
    charge.side_effect = HTTPException(status_code=402, detail="Insufficient credits")
    response = await api_client.post("/match/external/matrix", json={
        "jobs": [{"id": 2, "title": "Engineer", "required_skills": ["Python"]}],
        "candidates": [{"id": 7, "name": "Ada", "skills": ["Python"]}],
    })
    assert response.status_code == 402
    llm.create_embedding.assert_not_awaited()
    catalog.postgres_store.complete_matching_evaluation.assert_not_awaited()
    catalog.postgres_store.release_unbilled_matching_claims.assert_awaited_once_with(charge.await_args.args[0])


@pytest.mark.anyio
async def test_selected_ai_batch_charges_once_and_repetition_is_free(api_client, matching_services):
    llm, catalog, charge = matching_services
    catalog.postgres_store.get_matching_pair_content.side_effect = lambda candidate_id, job_id, **kwargs: (
        {"id": candidate_id, "name": f"Candidate {candidate_id}", "text": {
            "profile_json": {"skills": ["Python"]}, "original_text": "Python Engineer",
        }},
        {"id": job_id, "title": "Engineer"},
    )

    async def rank(_job, candidates):
        return LLMRerankResponse.model_validate({"ranked_candidates": [{
            "candidate_id": candidates[0]["id"], "score": 70, "explanation": "Ausgewaehltes Paar",
            "strengths": [], "weaknesses": [],
        }]})

    llm.rerank_candidates.side_effect = rank
    pairs = [{"jobId": 2, "candidateId": value} for value in (7, 8)]
    first = await api_client.post("/match/ki_match_pairs", json={"pairs": pairs})
    assert first.status_code == 200, first.text
    assert first.json()["matchedCount"] == 2
    charge.assert_awaited_once()
    assert charge.await_args.args[1:] == ("-1.00", "AI_MATCH")
    charge.reset_mock()
    second = await api_client.post("/match/ki_match_pairs", json={"pairs": pairs})
    assert second.status_code == 200
    assert [row["cacheStatus"] for row in second.json()["results"]] == ["hit", "hit"]
    for original, cached in zip(first.json()["results"], second.json()["results"]):
        assert {key: cached[key] for key in ("model", "matchedAt", "evaluationId")} == {
            key: original[key] for key in ("model", "matchedAt", "evaluationId")
        }
    charge.assert_not_awaited()
    assert llm.rerank_candidates.await_count == 2


@pytest.mark.anyio
@pytest.mark.parametrize("endpoint,engine", [
    ("/match/vectormatch", "python"), ("/match/vectormatch", "neo4j"),
    ("/match/vectormatch_neo4j", "neo4j"),
    ("/match/external/matrix", "python"), ("/match/external/matrix", "neo4j"),
    ("/match/external/matrix_neo4j", "neo4j"), ("/match/external/run", "python"),
    ("/match/ki_match_pairs", "ai"),
])
async def test_all_productive_routes_return_typed_pending_without_charge_or_fake_scores(
    api_client, matching_services, endpoint, engine,
):
    llm, catalog, charge = matching_services
    store = catalog.postgres_store
    store.get_matching_pair_content.side_effect = lambda candidate_id, job_id, **kwargs: (
        {"id": candidate_id, "text": {"profile_json": {}, "original_text": "Python Engineer"}},
        {"id": job_id, "title": "Engineer"},
    )
    store.claim_matching_evaluation.side_effect = None
    store.claim_matching_evaluation.return_value = {"id": 42, "disposition": "pending"}
    store.get_matching_pending_response.side_effect = lambda run_id: {
        "runId": run_id, "statusUrl": f"/matching/runs/{run_id}",
        "pendingPairs": [{"method": "ai" if engine == "ai" else "vector",
                          "candidateId": "7", "jobId": "2", "evaluationId": 42, "status": "running"}],
    }
    job = {"id": 2, "title": "Engineer", "required_skills": ["Python"]}
    candidate = {"id": 7, "name": "Ada", "skills": ["Python"]}
    if engine == "ai":
        payload = {"pairs": [{"jobId": 2, "candidateId": 7}]}
    elif "/vectormatch" in endpoint:
        payload = {"jobIds": [2], "candidateIds": [7], "engine": engine}
    elif endpoint.endswith("/run"):
        payload = {"job": job, "candidates": [candidate]}
    else:
        payload = {"jobs": [job], "candidates": [candidate], "engine": engine}
    response = await api_client.post(endpoint, json=payload)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "pending" and body["statusUrl"] == f"/matching/runs/{body['runId']}"
    assert body["pendingPairs"][0]["evaluationId"] == 42
    assert "score" not in body and "score" not in body["pendingPairs"][0]
    assert body["availableResults"] == []
    charge.assert_not_awaited()
    llm.create_embedding.assert_not_awaited()
    llm.rerank_candidates.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("sql_priority, score, qualified", [("NiceToHave", 67, True), ("Mandatory", 50, False)])
async def test_direct_external_and_both_graph_engines_have_identical_alias_coverage(
    api_client, matching_services, monkeypatch, sql_priority, score, qualified,
):
    llm, catalog, _charge = matching_services
    requirements = [
        {"name": "Python", "priority": "Mandatory", "category": "HardSkill"},
        {"name": "SQL", "priority": sql_priority, "category": "SoftSkill"},
    ]
    job = {"id": 2, "title": "Engineer", "required_skills": requirements}
    candidate = {"id": 7, "name": "Ada", "has_skill": ["Python programming", "Extra"]}
    monkeypatch.setattr(catalog, "get_jobs_for_vectormatch", AsyncMock(return_value=[job]))
    monkeypatch.setattr(catalog, "get_candidates_for_vectormatch", AsyncMock(return_value=[candidate]))
    real_match = SkillMatchingService.match
    calls = []

    async def record_match(self, need_skills, has_skills, **kwargs):
        result = await real_match(self, need_skills, has_skills, **kwargs)
        calls.append(result)
        return result

    monkeypatch.setattr(SkillMatchingService, "match", record_match)
    direct = await api_client.post("/match/skills", json={
        "need_skills": [
            {"name": "Python", "priority": "mandatory"},
            {"name": "SQL", "priority": "mandatory" if sql_priority == "Mandatory" else "nice_to_have"},
        ],
        "has_skills": candidate["has_skill"],
    })
    assert direct.status_code == 200
    assert (direct.json()["score"], direct.json()["qualified"]) == (score, qualified)
    assert calls[-1].matches[0].match_type == "canonical"
    expected_categories = None
    for index, (endpoint, payload) in enumerate([
        ("/match/external/run", {"job": job, "candidates": [candidate]}),
        ("/match/external/matrix", {"jobs": [job], "candidates": [candidate]}),
        ("/match/external/matrix_neo4j", {"jobs": [job], "candidates": [candidate]}),
        ("/match/vectormatch", {"jobIds": [2], "candidateIds": [7], "engine": "python"}),
        ("/match/vectormatch", {"jobIds": [2], "candidateIds": [7], "engine": "neo4j"}),
        ("/match/vectormatch_neo4j", {"jobIds": [2], "candidateIds": [7]}),
    ]):
        before = len(calls)
        response = await api_client.post(endpoint, json=payload)
        assert response.status_code == 200, response.text
        body = response.json()
        row = body["results"][0] if endpoint.endswith("/run") else body["matrix"][0]
        assert len(calls) > before if index == 0 else len(calls) == before
        assert (row["score"], row["qualified"], row["method"]) == (score, qualified, "vector")
        persisted = catalog.postgres_store.complete_matching_evaluation.await_args.args[4]
        categories = (persisted["hardSkillScore"], persisted["softSkillScore"])
        if expected_categories is None:
            expected_categories = categories
        assert categories == expected_categories
        if endpoint.startswith("/match/vector"):
            assert (row["hardSkillScore"], row["softSkillScore"]) == categories
        assert body["pairsPersisted"] is True
        assert (persisted["score"], persisted["qualified"]) == (score, qualified)
    assert catalog.postgres_store.complete_matching_evaluation.await_count == 1
    _charge.assert_awaited_once()
    assert catalog.get_jobs_for_vectormatch.await_args.args[0] == ["2"]
    assert catalog.get_candidates_for_vectormatch.await_args.args[0] == ["7"]
    catalog.get_vectormatch_neo4j_rows.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()
    llm.rerank_candidates.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("failure", ["missing-skills", "missing-id", "scoring-error", "write-error"])
async def test_external_matrix_reports_preparation_identity_and_storage_errors(api_client, matching_services, monkeypatch, failure):
    llm, catalog, _charge = matching_services
    job = {"id": 2, "title": "Python Engineer", "description": "Python und SQL", "required_skills": ["Python"]}
    if failure == "missing-skills":
        job.pop("required_skills")
    elif failure == "missing-id":
        catalog.postgres_store.matching_ids_for.side_effect = ValueError("Gespeicherte ID fehlt")
    elif failure == "scoring-error":
        monkeypatch.setattr(SkillMatchingService, "match", AsyncMock(side_effect=RuntimeError("Zentrale Bewertung fehlgeschlagen")))
    else:
        catalog.postgres_store.complete_matching_evaluation.side_effect = RuntimeError("Schreibfehler")
    response = await api_client.post(
        "/match/external/matrix", json={"jobs": [job], "candidates": [{"id": 7, "name": "Ada", "skills": []}]},
    )
    assert response.status_code == (503 if failure in {"scoring-error", "write-error"} else 422)
    if failure == "missing-skills":
        assert "aufbereiten" in response.json()["detail"]
    if failure != "write-error":
        catalog.postgres_store.complete_matching_evaluation.assert_not_awaited()
        llm.create_embedding.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()
    llm.rerank_candidates.assert_not_awaited()


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
async def test_skill_match_allows_empty_candidate_skills_and_reports_missing_mandatory_skills(api_client) -> None:
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
    assert [row["candidateId"] for row in body["jobsRanked"][0]["results"]] == ["candidate-1"]
    assert [row["jobId"] for row in body["candidatesRanked"][0]["results"]] == ["job-1"]
    assert isinstance(body["matrix"][0]["score"], int)
