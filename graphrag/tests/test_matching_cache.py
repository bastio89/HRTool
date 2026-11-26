from __future__ import annotations

from datetime import datetime, timezone

import psycopg
import httpx
import json
import asyncio
from unittest.mock import AsyncMock, Mock
from uuid import uuid4
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
import pytest

from services.postgres_store import PostgresStore
from services.matching_cache import (
    MatchingInputSnapshot, MatchingLeaseLostError, MatchingPairCache, MatchingPairPlan, SCORING_VERSION,
)
from services.llm import LLMService
from services.model_config import ModelConfigService
from services.prompt_service import PromptService
from services.matching_orchestrator import MatchingOrchestrator
from services.skill_matching import SkillMatchingService
from models import MatchingCandidateInput, MatchingJobInput


def make_snapshot(method="vector", *, candidate_id=5, job_id=38, **changes):
    values = {
        "candidate": {"skills": ["Python"], "updated_at": "yesterday"},
        "job": {"title": "Engineer", "required_skills": ["Python", "SQL"]},
        "payload": {"need": ["Python", "SQL"], "has": ["Python"]},
        "configuration": {
            "provider": "ollama", "base_url": "http://localhost:11434/", "model": "embed",
            "dimensions": 3, "cutoff": 0.75, "scoring_version": SCORING_VERSION,
            "esco_snapshot": [{"uri": "python", "description": "Programming"}],
            "prompt": "Evaluate", "prompt_version": 1, "reasoning_level": "none",
            "fixed_instruction": "Explain", "json_instruction": "JSON only",
            "generation_parameters": {"temperature": 0, "max_tokens": 1800},
        },
    }
    values.update(changes)
    return MatchingInputSnapshot.create(method, candidate_id, job_id, **values)


@pytest.mark.parametrize("changes", [
    {"candidate": {"skills": ["Python", "Java"]}},
    {"job": {"title": "Engineer", "required_skills": ["Python", "Java"]}},
    {"payload": {"need": ["SQL", "Python"], "has": ["Python"]}},
])
def test_snapshot_tracks_stored_data_and_ordered_evaluated_payload(changes):
    assert make_snapshot(**changes).fingerprint != make_snapshot().fingerprint


@pytest.mark.parametrize("method,key,value", [
    ("vector", "cutoff", 0.8), ("vector", "model", "embed-v2"), ("vector", "dimensions", 6),
    ("vector", "esco_snapshot", [{"uri": "python", "description": "Changed"}]),
    ("vector", "scoring_version", "changed"),
    ("ai", "prompt", "Changed"), ("ai", "prompt_version", 2), ("ai", "model", "chat-v2"),
    ("ai", "generation_parameters", {"temperature": 0.2}), ("ai", "json_instruction", "New JSON"),
])
def test_snapshot_tracks_method_relevant_configuration(method, key, value):
    first = make_snapshot(method)
    second = make_snapshot(method, configuration={**first.model_snapshot, key: value})
    assert first.fingerprint != second.fingerprint


def test_snapshot_is_immutable_credential_free_and_ignores_bookkeeping_and_other_method_settings():
    first = make_snapshot()
    config = {**first.model_snapshot, "api_key": "do-not-store", "prompt": "unrelated AI change",
              "base_url": "http://user:password@localhost:11434/?api_key=do-not-store"}
    candidate = {"skills": ["Python"], "updated_at": "today", "logs": ["accessed"], "password": "do-not-store"}
    second = make_snapshot(candidate=candidate, configuration=config)
    assert first.fingerprint == second.fingerprint
    assert all(secret not in second.canonical_json for secret in ("do-not-store", "password", "user:"))
    candidate["skills"].append("SQL")
    config["model"] = "changed"
    assert first.fingerprint == second.fingerprint
    assert make_snapshot("ai").fingerprint != first.fingerprint


@pytest.mark.anyio
async def test_frozen_matching_uses_the_fingerprinted_provider_and_prompts_after_config_changes():
    settings = {
        "ai_provider": "openrouter", "ai_base_url": "http://provider-one/v1",
        "ai_model": "chat-old", "ai_embedding_model": "embedding-old", "ai_api_key": "private-key",
    }
    prompts = [
        {"key": "matching_rerank", "template": "Original assessment", "version": 1},
        {"key": "json_only_response_instruction", "template": "Original JSON instruction", "version": 1},
    ]
    store = Mock(spec=PostgresStore)
    store.get_settings = AsyncMock(side_effect=lambda keys: dict(settings))
    store.list_prompts = AsyncMock(return_value=prompts)
    service = LLMService(
        "http://fallback", "fallback-chat", "fallback-embedding", 3,
        model_config_service=ModelConfigService(store), prompt_service=PromptService(store),
    )
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path.endswith("/embeddings"):
            return httpx.Response(200, json={"data": [{"embedding": [1.0, 0.0, 0.0]}]})
        ranked = {"ranked_candidates": [{
            "candidate_id": "5", "score": 50, "explanation": "Partial coverage",
            "strengths": ["Python"], "weaknesses": ["SQL"],
        }]}
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(ranked)}}]})

    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        embedding, embedding_config = await service.freeze_matching("vector")
        ai, ai_config = await service.freeze_matching("ai")
        fingerprint = make_snapshot("ai", configuration=ai_config).fingerprint
        settings.update(ai_base_url="http://provider-two/v1", ai_model="chat-new", ai_embedding_model="embedding-new")
        prompts[0].update(template="Changed assessment", version=2)
        prompts[1]["template"] = "Changed JSON instruction"
        assert await embedding.create_embedding({"name": "Python"}, allow_fallback=False) == [1.0, 0.0, 0.0]
        assert (await ai.rerank_candidates({"id": "38"}, [{"id": "5"}])).ranked_candidates[0].score == 50
        assert all(request.url.host == "provider-one" for request in requests)
        assert json.loads(requests[0].content)["model"] == embedding_config["model"] == "embedding-old"
        body = json.loads(requests[1].content)
        assert body["model"] == ai_config["model"] == "chat-old"
        assert body["messages"][0]["content"] == f"{ai_config['prompt']}\n\n{ai_config['fixed_instruction']}"
        assert body["messages"][1]["content"].startswith(ai_config["json_instruction"])
        assert "private-key" not in make_snapshot("ai", configuration=ai_config).canonical_json
        assert make_snapshot("ai", configuration=ai_config).fingerprint == fingerprint
        _, changed_config = await service.freeze_matching("ai")
        assert make_snapshot("ai", configuration=changed_config).fingerprint != fingerprint
        await ai.close()
        assert not service.client.is_closed
    finally:
        await service.close()


@pytest.mark.anyio
async def test_frozen_local_embedding_failure_is_not_cached_as_a_synthetic_result_or_replayed():
    service = LLMService("http://local", "chat", "embedding", 3, provider="ollama")
    requests = []

    def unavailable(request):
        requests.append(request)
        return httpx.Response(503, json={"error": "temporarily unavailable"})

    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(unavailable))
    try:
        frozen, _ = await service.freeze_matching("vector")
        with pytest.raises(RuntimeError, match="Embedding generation failed"):
            await frozen.create_embedding({"name": "Python"}, allow_fallback=False)
        assert len(requests) == 1
    finally:
        await service.close()


@pytest.mark.anyio
async def test_cache_readback_preserves_complete_zero_and_independent_ai_results(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    timestamp = datetime(2026, 1, 2, tzinfo=timezone.utc)
    snapshots = {
        method: make_snapshot(method, candidate_id=candidate_id, job_id=job_id) for method in ("vector", "ai")
    }
    payloads = {
        "vector": {
            "score": 0, "qualified": False, "matchedAt": timestamp.isoformat(), "model": "embed",
            "hardSkillScore": 0, "softSkillScore": 0,
            "matchedSkills": [{"need_skill": "SQL", "covered": False}],
            "summary": "No covered skill", "strengths": [], "weaknesses": ["SQL"],
        },
        "ai": {
            "score": 65, "qualified": None, "matchedAt": timestamp.isoformat(), "model": "chat",
            "summary": "Transferable experience", "strengths": ["Experience"], "weaknesses": ["SQL"],
        },
    }
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        for method, snapshot in snapshots.items():
            await connection.execute(
                """INSERT INTO matching_pair_evaluations
                   (method, candidate_id, job_id, input_fingerprint, status, result_payload, model_snapshot, completed_at)
                   VALUES (%s, %s, %s, %s, 'succeeded', %s, %s, %s)""",
                (method, candidate_id, job_id, snapshot.fingerprint,
                 Jsonb(payloads[method]), Jsonb(snapshot.model_snapshot), timestamp),
            )
    for method, snapshot in snapshots.items():
        cached = await store.get_cached_matching_evaluation(snapshot)
        assert cached is not None
        assert cached["result_payload"] == payloads[method]
        assert cached["model_snapshot"] == snapshot.model_snapshot
        assert cached["completed_at"] == timestamp
    changed = make_snapshot(candidate_id=candidate_id, job_id=job_id, candidate={"skills": ["Java"]})
    assert await store.get_cached_matching_evaluation(changed) is None
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute(
            "UPDATE matching_pair_evaluations SET status = 'needs_review' WHERE method = 'vector' AND candidate_id = %s",
            (candidate_id,),
        )
    assert await store.get_cached_matching_evaluation(snapshots["vector"]) is None
    assert (await store.get_cached_matching_evaluation(snapshots["ai"]))["result_payload"] == payloads["ai"]


@pytest.mark.anyio
async def test_two_connections_share_one_claim_and_fence_expired_owners(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    snapshot = make_snapshot(candidate_id=candidate_id, job_id=job_id)
    other_store = PostgresStore(store.database_url)
    first_owner, second_owner = str(uuid4()), str(uuid4())
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        first_run = await (await connection.execute(
            """INSERT INTO matching_runs (source, entity_type, entity_id)
               VALUES ('lease-test', 'candidate', %s) RETURNING id""",
            (candidate_id,),
        )).fetchone()
        second_run = await (await connection.execute(
            """INSERT INTO matching_runs (source, entity_type, entity_id)
               VALUES ('lease-test', 'candidate', %s) RETURNING id""",
            (candidate_id,),
        )).fetchone()
        new_run = await (await connection.execute(
            """INSERT INTO matching_runs (source, entity_type, entity_id)
               VALUES ('lease-test', 'candidate', %s) RETURNING id""",
            (candidate_id,),
        )).fetchone()
    first_run, second_run, new_run = str(first_run[0]), str(second_run[0]), str(new_run[0])
    first, second = await asyncio.gather(
        store.claim_matching_evaluation(snapshot, first_owner, owner_run_id=first_run),
        other_store.claim_matching_evaluation(snapshot, second_owner, owner_run_id=second_run),
    )
    assert sorted([first["disposition"], second["disposition"]]) == ["owned", "pending"]
    assert first["id"] == second["id"]
    active, active_owner = (first, first_owner) if first["disposition"] == "owned" else (second, second_owner)
    await store.heartbeat_matching_evaluation(active["id"], active_owner, active["fence"])
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute(
            "UPDATE matching_pair_evaluations SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE id = %s",
            (active["id"],),
        )
    new_owner = str(uuid4())
    replacement = await other_store.claim_matching_evaluation(snapshot, new_owner, owner_run_id=new_run)
    assert replacement["disposition"] == "owned"
    assert replacement["fence"] > active["fence"]
    assert str(replacement["owner_run_id"]) == new_run
    with pytest.raises(MatchingLeaseLostError):
        await store.mark_matching_model_started(active["id"], active_owner, active["fence"])
    with pytest.raises(MatchingLeaseLostError):
        await store.heartbeat_matching_evaluation(active["id"], active_owner, active["fence"])
    await store.mark_matching_model_started(replacement["id"], new_owner, replacement["fence"])


@pytest.mark.anyio
async def test_planned_evaluation_lease_is_renewed_until_execution(monkeypatch):
    store = Mock()
    heartbeat_called = asyncio.Event()

    async def heartbeat(leases):
        heartbeat_called.set()
        return {evaluation_id for evaluation_id, _, _ in leases}

    store.heartbeat_matching_evaluations = AsyncMock(side_effect=heartbeat)
    cache = MatchingPairCache(store)
    plan = MatchingPairPlan(
        make_snapshot(), "lease-owner", {"id": 73, "fence": 2, "disposition": "owned"},
    )
    plans = []
    waiting_ids = set()
    sleep_calls, ticks = asyncio.Queue(), asyncio.Queue()

    async def fake_sleep(_seconds):
        await sleep_calls.put(None)
        await ticks.get()

    monkeypatch.setattr("services.matching_cache.asyncio.sleep", fake_sleep)
    keeper = asyncio.create_task(cache.keep_planned_leases(plans, waiting_ids))
    try:
        await sleep_calls.get()
        plans.append(plan)
        waiting_ids.add(73)
        await ticks.put(None)
        await heartbeat_called.wait()
        assert store.heartbeat_matching_evaluations.await_args.args == ([(73, "lease-owner", 2)],)

        waiting_ids.clear()
        await sleep_calls.get()
        await ticks.put(None)
        await sleep_calls.get()
        assert store.heartbeat_matching_evaluations.await_count == 1
    finally:
        keeper.cancel()
        await asyncio.gather(keeper, return_exceptions=True)


@pytest.mark.anyio
async def test_batch_heartbeat_renews_only_current_lease_owner(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    snapshot = make_snapshot(candidate_id=candidate_id, job_id=job_id)
    owner = str(uuid4())
    claim = await store.claim_matching_evaluation(snapshot, owner)

    renewed = await store.heartbeat_matching_evaluations([(claim["id"], owner, claim["fence"])])
    stale = await store.heartbeat_matching_evaluations([(claim["id"], str(uuid4()), claim["fence"])])

    assert renewed == {claim["id"]}
    assert stale == set()


@pytest.mark.anyio
async def test_failed_run_releases_unstarted_evaluations_for_retry(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    snapshot = make_snapshot(candidate_id=candidate_id, job_id=job_id)
    run_owner, lease_owner = str(uuid4()), str(uuid4())
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        run = await (await connection.execute(
            """INSERT INTO matching_runs (
                   source, stage, entity_type, entity_id, lease_owner, lease_until
               ) VALUES ('lease-test', 'matching', 'candidate', %s, %s, clock_timestamp() + INTERVAL '1 minute')
               RETURNING id""",
            (candidate_id, run_owner),
        )).fetchone()
    run_id = str(run[0])
    evaluation = await store.claim_matching_evaluation(snapshot, lease_owner, owner_run_id=run_id)

    await store.fail_matching_request(run_id, run_owner)

    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        row = await (await connection.execute(
            """SELECT status, owner_run_id, lease_owner, lease_until
               FROM matching_pair_evaluations WHERE id = %s""",
            (evaluation["id"],),
        )).fetchone()
    assert row == ("queued", None, None, None)

    replacement = await store.claim_matching_evaluation(snapshot, str(uuid4()))
    assert replacement["disposition"] == "owned"


@pytest.mark.anyio
async def test_failed_child_does_not_leave_parent_pairs_pending(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    snapshot = make_snapshot(candidate_id=candidate_id, job_id=job_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        parent = await (await connection.execute(
            """INSERT INTO matching_runs (
                   source, request_kind, method, stage, target_count, request_payload, entity_type, entity_id
               ) VALUES (
                   '/match/vectormatch-selected', 'interactive_selection', 'vector', 'matching', 1,
                   %s, 'candidate', %s
               ) RETURNING id""",
            (Jsonb({"handler": "vector_match_selected"}), candidate_id),
        )).fetchone()
        child = await (await connection.execute(
            """INSERT INTO matching_runs (
                   source, request_kind, method, stage, parent_run_id, child_key, entity_type, entity_id
               ) VALUES ('/match/vectormatch', 'interactive', 'vector', 'failed', %s, %s, 'candidate', %s)
               RETURNING id""",
            (parent[0], str(job_id), candidate_id),
        )).fetchone()
    evaluation = await store.claim_matching_evaluation(
        snapshot, str(uuid4()), owner_run_id=str(child[0]),
    )
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        async with connection.cursor() as cursor:
            await cursor.executemany(
                """INSERT INTO matching_run_pairs
                       (run_id, method, candidate_id, job_id, evaluation_id, disposition)
                   VALUES (%s, 'vector', %s, %s, %s, 'pending')""",
                [(run_id, candidate_id, job_id, evaluation["id"]) for run_id in (parent[0], child[0])],
            )

    progress = await store.get_matching_run_progress(str(parent[0]))

    assert progress["processedCount"] == 1
    assert progress["failedCount"] == 1
    assert progress["pendingCount"] == 0


@pytest.mark.anyio
async def test_expired_started_call_requires_review_instead_of_automatic_replay(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    snapshot = make_snapshot("ai", candidate_id=candidate_id, job_id=job_id)
    owner = str(uuid4())
    active = await store.claim_matching_evaluation(snapshot, owner)
    await store.mark_matching_model_started(active["id"], owner, active["fence"])
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute(
            "UPDATE matching_pair_evaluations SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE id = %s",
            (active["id"],),
        )
    replacement = await PostgresStore(store.database_url).claim_matching_evaluation(snapshot, str(uuid4()))
    assert replacement["disposition"] == replacement["status"] == "needs_review"
    assert replacement["attempt"] == 1
    assert replacement["error_code"] == "uncertain_provider_result"
    with pytest.raises(MatchingLeaseLostError):
        await store.mark_matching_model_started(active["id"], owner, active["fence"])


async def prepare_completion(store, candidate_id, job_id):
    template = make_snapshot(candidate_id=candidate_id, job_id=job_id)
    candidate, job = await store.get_matching_pair_content(candidate_id, job_id)

    def build(current_candidate, current_job, configuration=None):
        return MatchingInputSnapshot.create(
            "vector", candidate_id, job_id, candidate=current_candidate, job=current_job,
            payload=template.payload, configuration=configuration or template.model_snapshot,
        )

    snapshot = build(candidate, job)
    owner = str(uuid4())
    claim = await store.claim_matching_evaluation(snapshot, owner)
    payload = {
        "method": "vector", "candidateId": str(candidate_id), "jobId": str(job_id),
        "score": 50, "qualified": False, "hardSkillScore": 0.5, "softSkillScore": 0.0,
        "model": "embed", "matchedAt": datetime(2026, 1, 2, tzinfo=timezone.utc).isoformat(),
        "summary": "Partial coverage", "strengths": ["Python"], "weaknesses": ["SQL"],
    }

    async def refresh(connection, current_candidate, current_job):
        return build(current_candidate, current_job)

    return snapshot, owner, claim, payload, refresh, build


@pytest.mark.anyio
@pytest.mark.parametrize("change", ["none", "record", "configuration"])
async def test_completion_atomically_publishes_only_the_current_version(stored_matching_pair, change):
    store, candidate_id, job_id = stored_matching_pair
    snapshot, owner, claim, payload, refresh, build = await prepare_completion(store, candidate_id, job_id)
    legacy = {**payload, "score": 10}
    await store.record_matching_pairs(
        "vector", [legacy], model="old", matched_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
    )
    if change == "record":
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            await connection.execute("UPDATE candidates SET notes = 'changed input' WHERE id = %s", (candidate_id,))
    if change == "configuration":
        async def refresh(connection, candidate, job):
            return build(candidate, job, {**snapshot.model_snapshot, "model": "new-embedding"})
    completed = await store.complete_matching_evaluation(
        snapshot, claim["id"], owner, claim["fence"], payload, refresh_snapshot=refresh,
    )
    assert completed["status"] == ("succeeded" if change == "none" else "superseded")
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        pair = await (await connection.execute(
            "SELECT score, evaluation_id FROM matching_pair_results WHERE candidate_id = %s", (candidate_id,),
        )).fetchone()
        assert pair == ((50, claim["id"]) if change == "none" else (10, None))
    cached = await store.get_cached_matching_evaluation(snapshot)
    if change == "none":
        assert cached is not None and cached["result_payload"] == payload
        with pytest.raises(MatchingLeaseLostError):
            await store.complete_matching_evaluation(
                snapshot, claim["id"], owner, claim["fence"], {**payload, "score": 99}, refresh_snapshot=refresh,
            )
    else:
        assert cached is None


@pytest.mark.anyio
async def test_projection_write_failure_rolls_back_full_result_and_completion(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    snapshot, owner, claim, payload, refresh, _ = await prepare_completion(store, candidate_id, job_id)
    with pytest.raises(psycopg.ProgrammingError):
        await store.complete_matching_evaluation(
            snapshot, claim["id"], owner, claim["fence"], {**payload, "summary": {"invalid": "SQL text"}},
            refresh_snapshot=refresh,
        )
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        row = await (await connection.execute(
            "SELECT status, result_payload, completed_at FROM matching_pair_evaluations WHERE id = %s", (claim["id"],),
        )).fetchone()
        assert row == ("running", None, None)
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_pair_results WHERE candidate_id = %s", (candidate_id,),
        )).fetchone() == (0,)
    assert await store.get_cached_matching_evaluation(snapshot) is None


@pytest.mark.anyio
async def test_selected_ai_cache_uses_canonical_pair_and_prompt_version_without_changing_skill_results(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute(
            """INSERT INTO candidate_texts (candidate_id, original_text, profile_json)
               VALUES (%s, 'Python experience', %s)""",
            (str(candidate_id), json.dumps({"skills": ["Python"], "birth_date": "1980-01-01"})),
        )
        identifiers = await (await connection.execute(
            """SELECT c.uuid::text, j.uuid::text FROM candidates c CROSS JOIN jobs j
               WHERE c.id = %s AND j.id = %s""", (candidate_id, job_id),
        )).fetchone()
    prompts = [
        {"key": "matching_rerank", "template": "Assess original", "version": 1},
        {"key": "json_only_response_instruction", "template": "JSON only", "version": 1},
    ]
    prompt_store = Mock(spec=PostgresStore)
    prompt_store.list_prompts = AsyncMock(return_value=prompts)
    service = LLMService("http://models", "selected-ai", "embedding", 2, prompt_service=PromptService(prompt_store))
    ai_requests, embedding_requests = [], []

    def respond(request):
        body = json.loads(request.content)
        if request.url.path.endswith("/api/embeddings"):
            embedding_requests.append(body)
            name = json.loads(body["prompt"])["name"]
            return httpx.Response(200, json={"embedding": [1.0, 0.0] if name == "Python" else [0.0, 1.0]})
        ai_requests.append(body)
        actual = json.loads(body["messages"][1]["content"].split("Eingabe:\n", 1)[1])
        assert actual["candidates"][0]["id"] == str(candidate_id)
        assert "birth_date" not in actual["candidates"][0]
        ranked = {"ranked_candidates": [{
            "candidate_id": str(candidate_id), "score": 85, "explanation": "Independent assessment",
            "strengths": ["Python experience"], "weaknesses": ["SQL not demonstrated"],
        }]}
        return httpx.Response(200, json={"message": {"content": json.dumps(ranked)}})

    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    catalog = Mock()
    catalog.get_esco_concepts_for_aliases = AsyncMock(return_value=[])
    orchestrator = MatchingOrchestrator(SkillMatchingService(service, catalog), postgres_store=store, llm_service=service)
    jobs = [MatchingJobInput(id=str(job_id), required_skills=["Python", "SQL"])]
    candidates = [MatchingCandidateInput(id=str(candidate_id), has_skill=["Python"])]
    try:
        skill, _ = await orchestrator.match_skill_matrix(jobs, candidates, model="label")
        first = await orchestrator.match_ai_pair(str(job_id), str(candidate_id))
        second = await orchestrator.match_ai_pair(identifiers[1], identifiers[0])
        assert first.score == 85 and first.qualified is None and skill[0]["score"] == 50
        assert second.model_dump() == {
            **first.model_dump(), "cacheStatus": "hit", "candidateId": identifiers[0], "jobId": identifiers[1],
        }
        assert len(ai_requests) == 1
        embedding_count = len(embedding_requests)
        prompts[0].update(template="Assess changed", version=2)
        skill_again, _ = await orchestrator.match_skill_matrix(jobs, candidates, model="label")
        assert skill_again == [{**skill[0], "cacheStatus": "hit"}]
        assert len(embedding_requests) == embedding_count and len(ai_requests) == 1
        third = await orchestrator.match_ai_pair(str(job_id), str(candidate_id))
        assert third.cacheStatus == "computed" and third.evaluationId != first.evaluationId
        assert len(ai_requests) == 2 and ai_requests[-1]["messages"][0]["content"].startswith("Assess changed")
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            vector = await (await connection.execute(
                """SELECT score, evaluation_id, model FROM matching_pair_results
                   WHERE method = 'vector' AND candidate_id = %s""", (candidate_id,),
            )).fetchone()
            assert vector == (50, skill[0]["evaluationId"], "embedding")
    finally:
        await service.close()


@pytest.mark.anyio
async def test_cache_schema_preserves_unverified_results_and_full_method_versions(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    timestamp = datetime(2026, 11, 25, tzinfo=timezone.utc)
    await store.record_matching_pairs(
        "vector", [{"candidateId": str(candidate_id), "jobId": str(job_id), "score": 0, "qualified": False}],
        model="legacy", matched_at=timestamp,
    )
    await PostgresStore(store.database_url).ensure_matching_pair_schema()
    payload = {"score": 50, "qualified": False, "matchedSkills": [{"need_skill": "Python", "covered": True}]}
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        async with connection.cursor(row_factory=dict_row) as cursor:
            for method, fingerprint in (("vector", "first"), ("vector", "changed"), ("ai", "first")):
                await cursor.execute(
                    """INSERT INTO matching_pair_evaluations
                       (method, candidate_id, job_id, input_fingerprint, status, result_payload, completed_at)
                       VALUES (%s, %s, %s, %s, 'succeeded', %s, %s)""",
                    (method, candidate_id, job_id, fingerprint, Jsonb(payload), timestamp),
                )
            await cursor.execute(
                "SELECT score, model, matched_at, evaluation_id FROM matching_pair_results WHERE candidate_id = %s",
                (candidate_id,),
            )
            assert await cursor.fetchone() == {
                "score": 0, "model": "legacy", "matched_at": timestamp, "evaluation_id": None,
            }
            await cursor.execute(
                "SELECT result_payload FROM matching_pair_evaluations WHERE candidate_id = %s", (candidate_id,),
            )
            assert [row["result_payload"] for row in await cursor.fetchall()] == [payload] * 3
            with pytest.raises(psycopg.errors.UniqueViolation):
                async with connection.transaction():
                    await cursor.execute(
                        """INSERT INTO matching_pair_evaluations
                           (method, candidate_id, job_id, input_fingerprint)
                           VALUES ('vector', %s, %s, 'first')""",
                        (candidate_id, job_id),
                    )


@pytest.mark.anyio
async def test_deleting_a_record_removes_every_cached_version(stored_matching_pair):
    store, candidate_id, job_id = stored_matching_pair
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute(
            """INSERT INTO matching_pair_evaluations (method, candidate_id, job_id, input_fingerprint)
               VALUES ('vector', %s, %s, 'one'), ('ai', %s, %s, 'two')""",
            (candidate_id, job_id, candidate_id, job_id),
        )
        await connection.execute("DELETE FROM jobs WHERE id = %s", (job_id,))
        row = await (await connection.execute(
            "SELECT COUNT(*) FROM matching_pair_evaluations WHERE candidate_id = %s", (candidate_id,),
        )).fetchone()
        assert row == (0,)


@pytest.mark.anyio
@pytest.mark.parametrize("method", ["vector", "ai"])
async def test_legacy_writes_clear_only_overwritten_evaluation_references(stored_matching_pair, method):
    store, candidate_id, job_id = stored_matching_pair
    pair = {"candidateId": str(candidate_id), "jobId": str(job_id), "score": 0, "qualified": False}
    timestamp = datetime(2026, 1, 2, tzinfo=timezone.utc)
    await store.record_matching_pairs(method, [pair], model="legacy", matched_at=timestamp)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        evaluation = await (await connection.execute(
            """INSERT INTO matching_pair_evaluations (method, candidate_id, job_id, input_fingerprint)
               VALUES (%s, %s, %s, 'verified-reference') RETURNING id""",
            (method, candidate_id, job_id),
        )).fetchone()
        assert evaluation is not None
        await connection.execute(
            "UPDATE matching_pair_results SET evaluation_id = %s WHERE candidate_id = %s",
            (evaluation[0], candidate_id),
        )
    await store.record_matching_pairs(method, [{**pair, "score": 99}], model="older", matched_at=timestamp.replace(day=1))
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT score, evaluation_id FROM matching_pair_results WHERE candidate_id = %s", (candidate_id,),
        )).fetchone() == (0, evaluation[0])
    await store.record_matching_pairs(method, [{**pair, "score": 50}], model="newer", matched_at=timestamp.replace(day=3))
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT score, evaluation_id FROM matching_pair_results WHERE candidate_id = %s", (candidate_id,),
        )).fetchone() == (50, None)
