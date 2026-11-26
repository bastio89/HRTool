from __future__ import annotations

from uuid import uuid4
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
import asyncio
import json

import httpx
import psycopg
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException

from matching_api import create_matching_router
from batch_api import create_batch_router
from models import CandidateProfileExtraction, JobProfileExtraction, MatchingCandidateInput, MatchingJobInput
from plugins.billing.service import BillingService, BillingUserClaims
from services.llm import LLMService
from services.model_config import ModelConfigService, ModelRuntimeConfig
from services.matching_pipeline import MatchingRequestCoordinator
from services.matching_cache import MatchingLeaseLostError, MatchingPairCache, MatchingPendingError
from services.postgres_store import PostgresStore
from services.candidate_persistence import persist_candidate_profile
from services.candidate_identity import DuplicateCandidateError
from services.candidate_privacy import CandidatePrivacyService
from services.job_persistence import persist_job_profile
from fast_cvjob_parsing.app.schemas import CVResponse


@pytest_asyncio.fixture
async def batch_client(import_expansion, monkeypatch):
    env = import_expansion
    # JWT cryptography is covered by billing tests; keep actual stored-user authorization here.
    monkeypatch.setattr(
        "plugins.billing.service.verify_hs256_jwt",
        lambda token, _secret: {"id": int(token), "role": "admin"},
    )
    app = FastAPI()
    app.include_router(create_batch_router(env.store))
    app.include_router(create_matching_router(db_service=SimpleNamespace(postgres_store=env.store)))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield SimpleNamespace(**vars(env), client=client)


@pytest_asyncio.fixture
async def batch_admin(batch_client):
    async with await psycopg.AsyncConnection.connect(batch_client.store.database_url) as connection:
        await connection.execute("INSERT INTO users (id, username, role) VALUES (2, 'batch-admin', 'admin')")
    batch_client.client.headers["Authorization"] = "Bearer 2"
    return batch_client


@pytest.mark.anyio
async def test_batch_access_uses_stored_roles_and_own_status_remains_private(batch_client):
    env = batch_client
    candidate_id, = await env.add("candidate")
    run_id = await env.enqueue("candidate", candidate_id)
    admin_url, own_url = f"/admin/batches/{run_id}", f"/matching/runs/{run_id}"
    for headers in ({}, {"x-api-key": "not-an-admin-role"}):
        assert (await env.client.get(admin_url, headers=headers)).status_code == 401
        assert (await env.client.get(own_url, headers=headers)).status_code == 401
        assert (await env.client.post(admin_url + "/retry", headers=headers, json={"pairIds": [1]})).status_code == 401
    owner = {"Authorization": "Bearer 1"}
    assert (await env.client.get(admin_url, headers=owner)).status_code == 403
    assert (await env.client.get("/admin/batches/summary", headers=owner)).status_code == 403
    assert (await env.client.post(admin_url + "/retry", headers=owner, json={"pairIds": [1]})).status_code == 403
    own = await env.client.get(own_url, headers=owner)
    assert own.status_code == 200, own.text
    assert own.json()["counters"]["progressPercent"] is None
    assert own.json()["resultPayload"] is None
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("INSERT INTO users (id, username, role) VALUES (2, 'other', 'recruiter')")
    other = {"Authorization": "Bearer 2"}
    assert (await env.client.get(own_url, headers=other)).status_code == 404
    assert (await env.client.get(admin_url, headers=other)).status_code == 403
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE users SET role = 'admin' WHERE id = 2")
    assert (await env.client.get(own_url, headers=other)).status_code == 200
    detail = await env.client.get(admin_url, headers=other)
    assert detail.status_code == 200, detail.text
    assert detail.json()["run"]["actorUserId"] == 1
    assert detail.json()["run"]["entityId"] == candidate_id
    assert detail.json()["run"]["creditStatus"] == "pending"
    assert all(key not in detail.text for key in ("request_payload", "client_context", "lease_owner"))
    assert (await env.client.get("/admin/batches/summary", headers=other)).status_code == 200
    assert (await env.client.get(f"/admin/batches/{uuid4()}", headers=other)).status_code == 404
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("DELETE FROM users WHERE id = 2")
    assert (await env.client.get(admin_url, headers=other)).status_code == 401


@pytest.mark.anyio
async def test_batch_queue_filters_keyset_ties_and_sanitizes_persisted_errors(batch_admin):
    env = batch_admin
    candidate_id, = await env.add("candidate")
    runs = [await env.enqueue("candidate", candidate_id) for _ in range(3)]
    other_source = await env.store.enqueue_matching_import(
        "candidate", candidate_id, actor_user_id=1, source="CSV-Import", event_key=str(uuid4()),
    )
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE matching_runs SET created_at = '2025-01-01T00:00:00Z'")
        await connection.execute(
            """UPDATE matching_runs SET stage = 'failed', error_code = 'private-provider-secret',
                request_payload = '{"private-profile": "not-public"}'::jsonb WHERE id = %s""", (runs[1],),
        )
    first = await env.client.get("/admin/batches", params={"limit": 2})
    assert first.status_code == 200, first.text
    page = first.json()
    assert len(page["items"]) == 2 and page["nextCursor"] is not None
    second = await env.client.get("/admin/batches", params={"limit": 2, "cursor": page["nextCursor"]})
    assert second.status_code == 200, second.text
    assert second.json()["nextCursor"] is None
    items = page["items"] + second.json()["items"]
    assert [item["run"]["runId"] for item in items] == sorted([*runs, other_source], reverse=True)
    assert all(item["counters"]["progressPercent"] is None for item in items)
    assert "private-provider-secret" not in first.text + second.text
    assert "private-profile" not in first.text + second.text
    failed = await env.client.get("/admin/batches", params={"status": "failed"})
    assert [item["run"]["runId"] for item in failed.json()["items"]] == [runs[1]]
    assert failed.json()["items"][0]["run"]["errorCode"] == "matching_failed"
    summary = await env.client.get("/admin/batches/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json() == {
        "queuedCount": 3, "runningCount": 0, "blockedCreditsCount": 0,
        "needsReviewCount": 0, "failedCount": 1, "completedWithErrorsCount": 0,
    }
    filtered = await env.client.get("/admin/batches", params={"status": "queued", "source": "expansion-test"})
    assert {item["run"]["runId"] for item in filtered.json()["items"]} == {runs[0], runs[2]}
    assert (await env.client.get("/admin/batches", params={"source": "unknown"})).json()["items"] == []
    for params in ({"limit": 0}, {"limit": 101}, {"status": "made-up"}, {"cursor": "invalid"}, {"cursor": str(uuid4())}):
        assert (await env.client.get("/admin/batches", params=params)).status_code == 422


@pytest.mark.anyio
async def test_batch_pair_pages_keep_original_ids_times_cache_metadata_and_preparation_errors(batch_admin, import_worker):
    env = import_worker
    client = batch_admin.client
    candidate_id = await env.create("candidate")
    jobs = [await env.create("job") for _ in range(3)]
    first_run = await env.enqueue("candidate", candidate_id)
    assert (await env.process(first_run))["stage"] == "completed"
    original_response = await client.get(f"/admin/batches/{first_run}")
    assert original_response.status_code == 200, original_response.text
    original = original_response.json()
    assert original["run"]["creditStatus"] == "charged"
    assert Decimal(original["run"]["chargedAmount"]) == Decimal("-0.10")
    original_pairs = {row["jobId"]: row for row in original["pairs"]}
    cached_run = await env.enqueue("candidate", candidate_id)
    assert (await env.process(cached_run))["stage"] == "completed"
    before = len(env.calls)
    page = (await client.get(f"/admin/batches/{cached_run}", params={"limit": 2, "pairStatus": "cached"})).json()
    assert len(page["pairs"]) == 2 and page["nextCursor"] is not None
    assert page["run"]["creditStatus"] == "free"
    assert page["counters"]["cachedCount"] == 3 and page["counters"]["progressPercent"] == 100
    last = (await client.get(
        f"/admin/batches/{cached_run}", params={"cursor": page["nextCursor"], "pairStatus": "cached"},
    )).json()
    assert len(last["pairs"]) == 1 and last["nextCursor"] is None
    pairs = page["pairs"] + last["pairs"]
    assert {row["jobId"] for row in pairs} == {str(job_id) for job_id in jobs}
    for row in pairs:
        assert row["candidateId"] == str(candidate_id)
        assert row["matchedAt"] == original_pairs[row["jobId"]]["matchedAt"]
        assert row["evaluationId"] == original_pairs[row["jobId"]]["evaluationId"]
        assert row["resultPayload"]["cacheStatus"] == "hit"
    assert len({row["pairId"] for row in pairs}) == 3
    for params in (
        {"limit": 101}, {"cursor": 0}, {"cursor": 9223372036854775808},
        {"cursor": original["pairs"][0]["pairId"]}, {"pairStatus": "succeeded"},
    ):
        assert (await client.get(f"/admin/batches/{cached_run}", params=params)).status_code == 422
    assert len(env.calls) == before
    missing_job = await env.create("job", skills="")
    error_run = await env.enqueue("candidate", candidate_id)
    assert (await env.process(error_run))["stage"] == "completed_with_errors"
    failed = (await client.get(
        f"/admin/batches/{error_run}", params={"pairStatus": "preparation_required"},
    )).json()
    assert len(failed["pairs"]) == 1
    pair = failed["pairs"][0]
    assert pair["jobId"] == str(missing_job) and pair["evaluationId"] is None
    assert pair["errorCode"] == "missing_job_skills" and pair["resultPayload"] is None and pair["matchedAt"] is None
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(
            "UPDATE matching_run_pairs SET error_code = 'private-provider-secret' WHERE id = %s", (pair["pairId"],),
        )
    sanitized = await client.get(f"/admin/batches/{error_run}", params={"pairStatus": "preparation_required"})
    assert sanitized.json()["pairs"][0]["errorCode"] == "matching_failed"
    assert "private-provider-secret" not in sanitized.text


@pytest.mark.anyio
async def test_batch_retry_selects_preparation_targets_without_evaluations_and_preserves_charge(batch_admin, import_worker):
    env, client = import_worker, batch_admin.client
    candidate = await env.create("candidate")
    good = await env.create("job")
    bad = [await env.create("job", skills="") for _ in range(2)]
    run_id = await env.enqueue("candidate", candidate)
    await env.process(run_id)
    original = (await client.get(f"/admin/batches/{run_id}")).json()
    good_pair = next(row for row in original["pairs"] if row["jobId"] == str(good))
    selected = next(row for row in original["pairs"] if row["jobId"] == str(bad[0]))
    url = f"/admin/batches/{run_id}/retry"
    assert (await client.post(url, json={"pairIds": [selected["pairId"], good_pair["pairId"]]})).status_code == 409
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_retry_audit")).fetchone() == (0,)
        await connection.execute("UPDATE jobs SET skills = 'Python' WHERE id = ANY(%s)", (bad,))
        await connection.execute("UPDATE jobs SET skills = 'Rust' WHERE id = %s", (good,))
        await connection.execute(
            "UPDATE matching_runs SET lease_owner = gen_random_uuid(), lease_until = clock_timestamp() + INTERVAL '1 minute' WHERE id = %s",
            (run_id,),
        )
    assert (await client.post(url, json={"pairIds": [selected["pairId"]]})).status_code == 409
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE matching_runs SET lease_owner = NULL, lease_until = NULL WHERE id = %s", (run_id,))
    responses = await asyncio.gather(*[
        client.post(url, json={"pairIds": [selected["pairId"]]}) for _ in range(2)
    ])
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert (await env.process(run_id))["stage"] == "completed_with_errors"
    retried = (await client.get(f"/admin/batches/{run_id}")).json()
    unchanged = next(row for row in retried["pairs"] if row["jobId"] == str(good))
    assert {key: value for key, value in unchanged.items() if key != "updatedAt"} == {
        key: value for key, value in good_pair.items() if key != "updatedAt"
    }
    assert retried["counters"]["computedCount"] == 2 and retried["counters"]["preparationRequiredCount"] == 1
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT COUNT(*), SUM(amount) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone() == (1, Decimal("-0.10"))
        assert await (await connection.execute(
            "SELECT pair_id, actor_user_id, previous_disposition, decision, evaluation_id FROM matching_retry_audit",
        )).fetchall() == [(selected["pairId"], 2, "preparation_required", "retry", None)]


@pytest.mark.anyio
async def test_batch_retry_requires_uncertainty_confirmation_and_resumes_original_owner_free(batch_admin, import_worker):
    env, client = import_worker, batch_admin.client
    candidate = await env.create("candidate")
    job = await env.create("job")
    run_a = await env.enqueue("candidate", candidate)
    await env.process(run_a)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(
            """UPDATE matching_pair_evaluations SET status = 'needs_review', result_payload = NULL,
               call_started_at = clock_timestamp(), completed_at = NULL, error_code = 'uncertain_provider_result'""",
        )
        await connection.execute("UPDATE matching_run_pairs SET disposition = 'needs_review'")
        await connection.execute("UPDATE matching_runs SET stage = 'needs_review' WHERE id = %s", (run_a,))
    run_b = await env.enqueue("job", job)
    await env.process(run_b)
    detail = (await client.get(f"/admin/batches/{run_b}")).json()
    pair = detail["pairs"][0]
    url = f"/admin/batches/{run_b}/retry"
    denied = await client.post(url, json={"pairIds": [pair["pairId"]]})
    assert denied.status_code == 409 and "Providerkosten" in denied.text
    assert (await client.post(url, json={"pairIds": [pair["pairId"]], "confirmUncertain": "true"})).status_code == 422
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(
            "UPDATE matching_pair_evaluations SET status = 'running', lease_owner = gen_random_uuid(), lease_until = clock_timestamp() + INTERVAL '1 minute'",
        )
    assert (await client.post(url, json={"pairIds": [pair["pairId"]], "confirmUncertain": True})).status_code == 409
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE matching_pair_evaluations SET status = 'needs_review', lease_owner = NULL, lease_until = NULL")
    assert (await client.post(url, json={"pairIds": [pair["pairId"]], "confirmUncertain": True})).status_code == 200
    assert (await env.process(run_b))["stage"] == "matching"
    assert (await env.process(run_a))["stage"] == "completed"
    assert (await env.process(run_b))["stage"] == "completed"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT matching_run_id::text, amount FROM credit_transactions",
        )).fetchall() == [(run_a, Decimal("-0.10"))]
        assert await (await connection.execute(
            "SELECT pair_id, actor_user_id, decision FROM matching_retry_audit",
        )).fetchall() == [(pair["pairId"], 2, "confirmed_uncertain_retry")]


@pytest.mark.anyio
async def test_interactive_retry_replays_unselected_results_even_when_current_inputs_change(batch_admin, import_worker):
    env, client = import_worker, batch_admin.client
    candidate = await env.create("candidate")
    good, bad = await env.create("job"), await env.create("job", skills="")
    run_id = await env.enqueue("candidate", candidate)
    await env.process(run_id)
    before = (await client.get(f"/admin/batches/{run_id}")).json()["pairs"]
    failed = next(row for row in before if row["jobId"] == str(bad))
    original = next(row for row in before if row["jobId"] == str(good))
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(
            """UPDATE matching_runs SET request_kind = 'interactive', request_payload = '{"handler":"external_matrix"}'
               WHERE id = %s""", (run_id,),
        )
        await connection.execute("UPDATE jobs SET skills = 'Python' WHERE id = %s", (bad,))
        await connection.execute("UPDATE jobs SET skills = '' WHERE id = %s", (good,))
    assert (await client.post(f"/admin/batches/{run_id}/retry", json={"pairIds": [failed["pairId"]]})).status_code == 200
    owner = str(uuid4())
    assert await env.store.claim_matching_request(run_id, owner) is not None

    async def on_plan(plans):
        await env.store.attach_matching_run_pairs(run_id, plans, run_owner=owner)
        await BillingService(env.store).charge_matching_run(run_id, "-0.10", "3D_MATCH")

    rows, _ = await env.orchestrator.match_skill_matrix(
        [MatchingJobInput(id=good, required_skills=[]), MatchingJobInput(id=bad, required_skills=[{"name": "Python"}])],
        [MatchingCandidateInput(id=candidate, skills=["Python"])],
        model="worker-embedding", run_id=run_id, on_plan=on_plan,
    )
    replayed = next(row for row in rows if row["jobId"] == str(good))
    assert replayed["matchedAt"] == original["matchedAt"] and replayed["evaluationId"] == original["evaluationId"]
    assert len(rows) == 2
    await env.store.complete_matching_request(run_id, owner, {"matrix": rows})
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (2,)
        assert await (await connection.execute(
            "SELECT COUNT(*), SUM(amount) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone() == (1, Decimal("-0.10"))


@pytest.mark.anyio
async def test_credit_retry_does_not_start_unselected_pending_pairs(batch_admin, import_worker):
    env, client = import_worker, batch_admin.client
    candidate = await env.create("candidate")
    for _ in range(3):
        await env.create("job")
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 0 WHERE id = 1")
    run_id = await env.enqueue("candidate", candidate)
    with pytest.raises(HTTPException) as blocked:
        await env.process(run_id)
    assert blocked.value.status_code == 402
    detail = (await client.get(f"/admin/batches/{run_id}")).json()
    assert detail["run"]["stage"] == "blocked_credits" and detail["counters"]["pendingCount"] == 3
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 1 WHERE id = 1")
    assert (await client.post(
        f"/admin/batches/{run_id}/retry", json={"pairIds": [detail["pairs"][0]["pairId"]]},
    )).status_code == 200
    assert (await env.process(run_id))["stage"] == "completed_with_errors"
    result = (await client.get(f"/admin/batches/{run_id}")).json()
    assert result["counters"]["computedCount"] == 1 and result["counters"]["failedCount"] == 2
    assert {row["errorCode"] for row in result["pairs"] if row["status"] == "failed"} == {"retry_not_selected"}
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (1,)
        assert await (await connection.execute("SELECT COUNT(*), SUM(amount) FROM credit_transactions")).fetchone() == (1, Decimal("-0.10"))


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["candidate", "job"])
async def test_import_expansion_fixes_all_counterparts_without_top_n_or_status_filter(import_expansion, kind):
    env = import_expansion
    counterpart_kind = "job" if kind == "candidate" else "candidate"
    source_id, = await env.add(kind)
    counterpart_ids = await env.add(counterpart_kind, 105)
    run_id = await env.enqueue(kind, source_id)
    owner = str(uuid4())
    expanded = await env.worker.expand(run_id, owner)
    assert expanded["target_count"] == 105 and expanded["stage"] == "matching"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        rows = await (await connection.execute(
            "SELECT candidate_id, job_id, method, disposition FROM matching_run_pairs WHERE run_id = %s", (run_id,),
        )).fetchall()
        assert {(row[0], row[1]) for row in rows} == {
            (source_id, other) if kind == "candidate" else (other, source_id) for other in counterpart_ids
        }
        assert all(row[2:] == ("vector", "pending") for row in rows)
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (0,)
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (0,)
    await env.add(counterpart_kind)
    repeated = await env.store.expand_matching_import(run_id, owner)
    assert repeated["target_count"] == 105


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["candidate", "job"])
async def test_empty_import_expansion_completes_without_charge_and_does_not_grow_later(import_expansion, kind):
    env = import_expansion
    source_id, = await env.add(kind)
    run_id = await env.enqueue(kind, source_id)
    expanded = await env.worker.expand(run_id, str(uuid4()))
    assert expanded["stage"] == "completed" and expanded["target_count"] == 0
    assert expanded["lease_owner"] is None
    await env.add("job" if kind == "candidate" else "candidate")
    assert await env.worker.expand(run_id, str(uuid4())) is None
    assert (await env.store.get_matching_run(run_id))["target_count"] == 0
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (0,)


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["candidate", "job"])
async def test_deleted_counterpart_is_skipped_without_stopping_import_or_changing_denominator(import_expansion, kind):
    env = import_expansion
    source_id, = await env.add(kind)
    counterpart_kind = "job" if kind == "candidate" else "candidate"
    removed, _retained = await env.add(counterpart_kind, 2)
    run_id = await env.enqueue(kind, source_id)
    owner = str(uuid4())
    await env.worker.expand(run_id, owner)
    table, column = ("jobs", "job_id") if counterpart_kind == "job" else ("candidates", "candidate_id")
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(f"DELETE FROM {table} WHERE id = %s", (removed,))
        assert await (await connection.execute(
            f"SELECT disposition, error_code FROM matching_run_pairs WHERE run_id = %s AND {column} = %s",
            (run_id, removed),
        )).fetchone() == ("skipped", "source_deleted")
    run = await env.store.get_matching_run(run_id)
    assert run["target_count"] == 2 and run["stage"] == "matching" and run["error_code"] is None
    assert str(run["lease_owner"]) == owner


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["candidate", "job"])
async def test_deleted_import_source_invalidates_even_an_unexpanded_run(import_expansion, kind):
    env = import_expansion
    source_id, = await env.add(kind)
    run_id = await env.enqueue(kind, source_id)
    table = "candidates" if kind == "candidate" else "jobs"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(f"DELETE FROM {table} WHERE id = %s", (source_id,))
    run = await env.store.get_matching_run(run_id)
    assert run["stage"] == "failed" and run["error_code"] == "source_deleted"
    assert await env.worker.expand(run_id, str(uuid4())) is None


@pytest.mark.anyio
async def test_overlapping_imports_share_canonical_targets_and_run_claims_are_fenced(import_expansion):
    env = import_expansion
    candidate_id, = await env.add("candidate")
    job_id, = await env.add("job")
    candidate_run, job_run = await asyncio.gather(
        env.enqueue("candidate", candidate_id), env.enqueue("job", job_id),
    )
    owner, stale_owner = str(uuid4()), str(uuid4())
    contenders = await asyncio.gather(
        env.worker.expand(candidate_run, owner), env.worker.expand(candidate_run, stale_owner),
    )
    assert sum(run is not None for run in contenders) == 1
    await env.worker.expand(job_run, str(uuid4()))
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        rows = await (await connection.execute(
            "SELECT candidate_id, job_id, method FROM matching_run_pairs ORDER BY run_id",
        )).fetchall()
        assert rows == [(candidate_id, job_id, "vector")] * 2
        await connection.execute(
            "UPDATE matching_runs SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE id = %s",
            (candidate_run,),
        )
    new_owner = str(uuid4())
    resumed = await env.worker.expand(candidate_run, new_owner)
    assert resumed["target_count"] == 1
    with pytest.raises(MatchingLeaseLostError):
        await env.store.expand_matching_import(candidate_run, owner)


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["candidate", "job"])
async def test_import_worker_prepares_all_pairs_in_blocks_using_only_central_skill_matching(import_worker, monkeypatch, kind):
    env = import_worker
    source_id = await env.create(kind)
    for _ in range(5):
        await env.create("job" if kind == "candidate" else "candidate")
    monkeypatch.setattr("services.matching_pipeline.MATCHING_IMPORT_BLOCK_SIZE", 2)
    blocks = AsyncMock(wraps=env.store.list_matching_import_targets)
    monkeypatch.setattr(env.store, "list_matching_import_targets", blocks)
    run_id = await env.enqueue(kind, source_id)
    finished = await env.process(run_id)
    assert finished["stage"] == "completed" and finished["target_count"] == 5
    assert blocks.await_count == 4 and len(env.prepare.await_args_list) == 6
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT method, disposition, COUNT(*) FROM matching_run_pairs GROUP BY method, disposition",
        )).fetchall() == [("vector", "computed", 5)]
        assert await (await connection.execute(
            "SELECT method, COUNT(*), MIN(score), MAX(score) FROM matching_pair_results GROUP BY method",
        )).fetchall() == [("vector", 5, 100, 100)]
        assert await (await connection.execute(
            "SELECT COUNT(*), SUM(amount) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone() == (1, Decimal("-0.10"))
    assert env.calls


@pytest.mark.anyio
async def test_import_worker_isolates_missing_job_requirements_and_preparation_failure(import_worker):
    env = import_worker
    candidate_id = await env.create("candidate")
    good = await env.create("job")
    missing_skills = await env.create("job", skills="")
    broken = await env.create("job")
    prepare = env.prepare.side_effect

    async def fail_one(kind, entity_id):
        if kind == "job" and entity_id == broken:
            raise RuntimeError("Graph temporarily unavailable")
        return await prepare(kind, entity_id)

    env.prepare.side_effect = fail_one
    run_id = await env.enqueue("candidate", candidate_id)
    finished = await env.process(run_id)
    assert finished["stage"] == "completed_with_errors"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        rows = await (await connection.execute(
            "SELECT job_id, disposition, error_code FROM matching_run_pairs WHERE run_id = %s", (run_id,),
        )).fetchall()
        assert set(rows) == {
            (good, "computed", None), (missing_skills, "preparation_required", "missing_job_skills"),
            (broken, "preparation_required", "graph_preparation_failed"),
        }
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (1,)


@pytest.mark.anyio
async def test_import_worker_shows_preparation_before_any_model_or_charge_and_reuses_confirmed_inputs(import_worker):
    env = import_worker
    candidate_id = await env.create("candidate")
    await env.create("job")
    started, release = asyncio.Event(), asyncio.Event()
    prepare = env.prepare.side_effect

    async def delayed(kind, entity_id):
        started.set()
        await release.wait()
        return await prepare(kind, entity_id)

    env.prepare.side_effect = delayed
    run_id = await env.enqueue("candidate", candidate_id)
    work = asyncio.create_task(env.process(run_id))
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        assert (await env.store.get_matching_run(run_id))["stage"] == "preparing"
        assert not env.calls
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (0,)
    finally:
        release.set()
        await work
    before = len(env.calls)
    env.prepare.reset_mock()
    second_run = await env.enqueue("candidate", candidate_id)
    assert (await env.process(second_run))["stage"] == "completed"
    env.prepare.assert_not_awaited()
    assert len(env.calls) == before


@pytest.mark.anyio
async def test_import_worker_continues_other_pairs_after_uncertain_provider_failure(import_worker):
    env = import_worker
    candidate_id = await env.create("candidate")
    await env.create("job")
    await env.create("job")
    original = env.llm.client
    responses = []

    def respond(request):
        responses.append(request.url.path)
        if len(responses) == 1:
            return httpx.Response(500, json={"error": "Provider unavailable"})
        return httpx.Response(200, json={"data": [{"embedding": [1.0, 0.0, 0.0]}]})

    env.llm.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    await original.aclose()
    run_id = await env.enqueue("candidate", candidate_id)
    finished = await env.process(run_id)
    assert finished["stage"] == "needs_review"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT disposition, COUNT(*) FROM matching_run_pairs GROUP BY disposition ORDER BY disposition",
        )).fetchall() == [("computed", 1), ("needs_review", 1)]
    before = len(responses)
    assert await env.process(run_id) is None
    assert len(responses) == before and all(path.endswith("/embeddings") for path in responses)


@pytest.mark.anyio
async def test_import_worker_rejects_source_changes_between_graph_read_and_cache_plan(import_worker, monkeypatch):
    env = import_worker
    candidate_id = await env.create("candidate")
    await env.create("job")
    read = env.db.get_candidates_for_vectormatch.side_effect

    async def change_after_graph_read(ids):
        rows = read(ids)
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            await connection.execute("UPDATE candidates SET skills = 'SQL' WHERE id = %s", (candidate_id,))
        return rows

    monkeypatch.setattr(env.db, "get_candidates_for_vectormatch", AsyncMock(side_effect=change_after_graph_read))
    run_id = await env.enqueue("candidate", candidate_id)
    assert (await env.process(run_id))["stage"] == "completed_with_errors"
    assert not env.calls
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT disposition, error_code FROM matching_run_pairs WHERE run_id = %s", (run_id,),
        )).fetchone() == ("preparation_required", "source_changed")
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (0,)
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_pair_evaluations WHERE status = 'running'",
        )).fetchone() == (0,)


@pytest.mark.anyio
async def test_live_progress_survives_reload_and_reports_exactly_six_of_eight_without_double_counting(import_worker, monkeypatch, batch_admin):
    env = import_worker
    candidate_id = await env.create("candidate")
    jobs = [await env.create("job") for _ in range(8)]
    for job_id in jobs[3:5]:
        await env.process(await env.enqueue("job", job_id))
    run_id = await env.enqueue("candidate", candidate_id)
    original = env.orchestrator.match_skill_matrix
    started, release = asyncio.Event(), asyncio.Event()

    async def controlled(job_inputs, candidates, **kwargs):
        if job_inputs[0].id == jobs[5]:
            raise ValueError("Isolated pair validation failure")
        if job_inputs[0].id == jobs[6]:
            started.set()
            await release.wait()
        return await original(job_inputs, candidates, **kwargs)

    monkeypatch.setattr(env.orchestrator, "match_skill_matrix", controlled)
    work = asyncio.create_task(env.process(run_id))
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
        progress = await env.store.get_matching_run_progress(run_id)
        assert {key: progress[key] for key in (
            "targetCount", "processedCount", "computedCount", "cachedCount", "failedCount", "pendingCount", "progressPercent",
        )} == {
            "targetCount": 8, "processedCount": 6, "computedCount": 3, "cachedCount": 2,
            "failedCount": 1, "pendingCount": 2, "progressPercent": 75.0,
        }
        restarted = PostgresStore(env.store.database_url)
        assert await restarted.get_matching_run_progress(run_id) == progress
        assert await restarted.get_matching_run_progress(run_id) == progress
        active = await env.store.get_matching_run(run_id)
        assert active["stage"] == "matching"
        detail = await batch_admin.client.get(f"/admin/batches/{run_id}", params={"pairStatus": "pending", "limit": 1})
        assert detail.status_code == 200, detail.text
        assert detail.json()["counters"]["progressPercent"] == 75
        assert detail.json()["counters"]["processedCount"] == 6 and len(detail.json()["pairs"]) == 1
        with pytest.raises(MatchingPendingError):
            await env.store.complete_matching_request(run_id, str(active["lease_owner"]), {})
        assert await env.store.get_matching_run_progress(run_id) == progress
    finally:
        release.set()
        await work
    finished = await env.store.get_matching_run_progress(run_id)
    assert (finished["processedCount"], finished["computedCount"], finished["cachedCount"], finished["failedCount"]) == (8, 5, 2, 1)
    assert finished["progressPercent"] == 100
    assert (await env.store.get_matching_run(run_id))["stage"] == "completed_with_errors"


@pytest.mark.anyio
async def test_restart_after_confirmed_pair_keeps_its_computed_attribution_and_original_timestamp(import_worker, monkeypatch):
    env = import_worker
    candidate_id = await env.create("candidate")
    first, second = [await env.create("job") for _ in range(2)]
    run_id = await env.enqueue("candidate", candidate_id)
    original = env.orchestrator.match_skill_matrix
    started = asyncio.Event()

    async def stop_after_first(jobs, candidates, **kwargs):
        if jobs[0].id == second:
            started.set()
            await asyncio.Event().wait()
        return await original(jobs, candidates, **kwargs)

    monkeypatch.setattr(env.orchestrator, "match_skill_matrix", stop_after_first)
    work = asyncio.create_task(env.process(run_id))
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
    finally:
        work.cancel()
        with pytest.raises(asyncio.CancelledError):
            await work
    before = len(env.calls)
    assert (await env.store.get_matching_run(run_id))["stage"] == "queued"
    assert (await env.store.get_matching_run_progress(run_id))["computedCount"] == 1
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        timestamp = await (await connection.execute(
            "SELECT matched_at FROM matching_pair_results WHERE job_id = %s", (first,),
        )).fetchone()
    monkeypatch.setattr(env.orchestrator, "match_skill_matrix", original)
    assert (await env.process(run_id))["stage"] == "completed"
    progress = await env.store.get_matching_run_progress(run_id)
    assert (progress["computedCount"], progress["cachedCount"], progress["processedCount"]) == (2, 0, 2)
    assert len(env.calls) == before * 2
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT matched_at FROM matching_pair_results WHERE job_id = %s", (first,),
        )).fetchone() == timestamp
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (2,)
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (1,)


@pytest.mark.anyio
async def test_progress_distinguishes_unknown_preparation_from_a_confirmed_empty_run(import_expansion):
    env = import_expansion
    candidate_id, = await env.add("candidate")
    run_id = await env.enqueue("candidate", candidate_id)
    pending = await env.store.get_matching_run_progress(run_id)
    assert pending["targetCount"] is None and pending["progressPercent"] is None and pending["processedCount"] == 0
    await env.worker.expand(run_id, str(uuid4()))
    finished = await env.store.get_matching_run_progress(run_id)
    assert finished["targetCount"] == 0 and finished["processedCount"] == 0 and finished["progressPercent"] == 100


@pytest.mark.anyio
async def test_worker_stop_before_model_recovers_current_source_with_same_run_and_debit(import_worker, monkeypatch):
    env = import_worker
    candidate_id = await env.create("candidate")
    await env.create("job")
    run_id = await env.enqueue("candidate", candidate_id)
    started = asyncio.Event()
    heartbeat = env.store.heartbeat_matching_evaluation

    async def pause_before_model(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(env.store, "heartbeat_matching_evaluation", pause_before_model)
    await env.start()
    await asyncio.wait_for(started.wait(), timeout=5)
    await env.worker.shutdown(timeout=0)
    assert not env.calls and not env.worker._tasks
    assert (await env.store.get_matching_run(run_id))["stage"] == "queued"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE candidates SET skills = 'SQL' WHERE id = %s", (candidate_id,))
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_pair_evaluations WHERE call_started_at IS NOT NULL",
        )).fetchone() == (0,)
    resumed = asyncio.Event()

    async def resumed_heartbeat(*args, **kwargs):
        resumed.set()
        return await heartbeat(*args, **kwargs)

    monkeypatch.setattr(env.store, "heartbeat_matching_evaluation", resumed_heartbeat)
    await env.start()
    await asyncio.wait_for(resumed.wait(), timeout=5)
    await env.worker.shutdown(timeout=5)
    assert (await env.store.get_matching_run(run_id))["stage"] == "completed"
    assert "sql" in json.dumps(env.calls).casefold()
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (1,)
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_pair_evaluations WHERE status = 'succeeded'",
        )).fetchone() == (1,)


@pytest.mark.anyio
async def test_worker_lease_loss_after_provider_start_requires_review_and_is_never_replayed(import_worker, monkeypatch):
    env = import_worker
    candidate_id = await env.create("candidate")
    await env.create("job")
    run_id = await env.enqueue("candidate", candidate_id)
    started = asyncio.Event()
    attempts = []

    async def in_flight(request):
        attempts.append(request.url.path)
        started.set()
        await asyncio.Event().wait()

    await env.llm.client.aclose()
    env.llm.client = httpx.AsyncClient(transport=httpx.MockTransport(in_flight))
    monkeypatch.setattr("services.matching_pipeline.MATCHING_RUN_HEARTBEAT_SECONDS", 0.01)
    await env.start()
    await asyncio.wait_for(started.wait(), timeout=5)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(
            "UPDATE matching_runs SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE id = %s", (run_id,),
        )
    await asyncio.wait_for(asyncio.gather(*list(env.worker._tasks.values())), timeout=5)
    assert (await env.store.get_matching_run(run_id))["stage"] == "needs_review"
    await env.worker.resume()
    await env.worker.shutdown(timeout=0)
    await env.start()
    await env.worker.shutdown(timeout=0)
    assert len(attempts) == 1
    assert (await env.store.get_matching_run_progress(run_id))["needsReviewCount"] == 1


@pytest.mark.anyio
async def test_worker_drain_finishes_active_runs_without_starting_waiting_runs(import_worker):
    env = import_worker
    await env.create("job")
    candidates = [await env.create("candidate") for _ in range(3)]
    runs = [await env.enqueue("candidate", candidate_id) for candidate_id in candidates]
    started, release = asyncio.Event(), asyncio.Event()
    active = set()
    prepare = env.prepare.side_effect

    async def delayed(kind, entity_id):
        if kind == "candidate":
            active.add(entity_id)
            if len(active) == 2:
                started.set()
            await release.wait()
        return await prepare(kind, entity_id)

    env.prepare.side_effect = delayed
    await env.start()
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        stopping = asyncio.create_task(env.worker.shutdown(timeout=5))
        await asyncio.sleep(0)
        release.set()
        await stopping
    finally:
        release.set()
        await env.worker.shutdown(timeout=0)
    stages = [(await env.store.get_matching_run(run_id))["stage"] for run_id in runs]
    assert sorted(stages) == ["completed", "completed", "queued"]
    assert len(active) == 2 and not env.worker._tasks


@pytest.mark.anyio
@pytest.mark.parametrize("startup_failure", [False, True])
async def test_lifespan_starts_import_recovery_and_stops_it_before_closing_clients(app_module, monkeypatch, startup_failure):
    import sys
    from types import ModuleType

    events = []
    parser = ModuleType("fast_cvjob_parsing.app.parser")
    parser.__dict__["ResumeJobParser"] = SimpleNamespace(load=lambda: object())
    monkeypatch.setitem(sys.modules, parser.__name__, parser)

    def step(name):
        return AsyncMock(side_effect=lambda *args, **kwargs: events.append(name))

    store = SimpleNamespace(
        ensure_schema=AsyncMock(), ensure_setting_if_blank=AsyncMock(), ensure_setting=AsyncMock(),
        seed_default_prompts=AsyncMock(),
    )
    imports = SimpleNamespace(start=step("imports:start"), shutdown=step("imports:stop"))
    if startup_failure:
        async def fail_start(**kwargs):
            events.append("imports:start")
            raise RuntimeError("Import queue unavailable")
        imports.start = AsyncMock(side_effect=fail_start)
    requests = SimpleNamespace(start=step("requests:start"), shutdown=step("requests:stop"))
    monkeypatch.setattr(app_module, "postgres_store", store)
    monkeypatch.setattr(app_module, "matching_imports", imports)
    monkeypatch.setattr(app_module, "matching_requests", requests)
    monkeypatch.setattr(app_module.skill_matching_test_case_store, "ensure_schema", AsyncMock())
    monkeypatch.setattr(app_module.db_service, "close", step("graph:close"))
    monkeypatch.setattr(app_module.llm_service, "close", step("models:close"))
    if startup_failure:
        with pytest.raises(RuntimeError, match="Import queue unavailable"):
            async with app_module.lifespan(app_module.app):
                pytest.fail("Startup failure must not yield an available app")
    else:
        async with app_module.lifespan(app_module.app):
            assert events == ["requests:start", "imports:start"]
    assert imports.start.await_args.kwargs["prepare_candidate"] is app_module._prepare_candidate
    assert imports.start.await_args.kwargs["prepare_job"] is app_module._prepare_job
    assert events == ["requests:start", "imports:start", "imports:stop", "requests:stop", "graph:close", "models:close"]
    assert app_module.app.state.cv_job_parser is None


@pytest_asyncio.fixture
async def import_routes(app_module, api_client, stored_matching_pair, matching_actor, monkeypatch):
    store, _, _ = stored_matching_pair
    marker = f"pipeline-import-{uuid4()}"
    claims = BillingUserClaims(matching_actor, "test", None, None, "recruiter")
    billing = BillingService(store)
    monkeypatch.setattr(billing, "_claims_from_request", lambda request: claims)
    monkeypatch.setattr(billing, "charge", AsyncMock())
    monkeypatch.setattr(app_module, "billing_service", billing)
    monkeypatch.setattr(app_module, "postgres_store", store)
    monkeypatch.setattr(app_module, "candidate_privacy_service", CandidatePrivacyService(store))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[1.0, 0.0]))
    monkeypatch.setattr(app_module, "_build_skill_embeddings", AsyncMock(return_value={}))
    for method in ("find_job_by_source_hash", "find_job_by_profile_hash"):
        monkeypatch.setattr(app_module.db_service, method, AsyncMock(return_value=None))
    for method in ("upsert_candidate", "upsert_job"):
        monkeypatch.setattr(app_module.db_service, method, AsyncMock())
    profile = CandidateProfileExtraction(
        name=marker, birth_date="1990-02-14",
        skills=[{"name": "Java", "category": "HardSkill"}, {"name": "Teamwork", "category": "SoftSkill"}],
    )
    job = JobProfileExtraction(
        title=marker, description="Imported job description",
        required_skills=[{"name": "Java", "category": "HardSkill", "priority": "NiceToHave"},
                         {"name": "Teamwork", "category": "SoftSkill", "priority": "Mandatory"}],
    )
    monkeypatch.setattr(app_module, "extract_candidate_profile", AsyncMock(return_value=profile))
    monkeypatch.setattr(app_module.llm_service, "parse_job_description", AsyncMock(return_value=job))
    monkeypatch.setattr(app_module.pdf_service, "extract_text", lambda data: f"{marker}\nGeburtsdatum: 14.02.1990\nJava Teamwork")
    app_module.app.state.cv_job_parser = object()
    parsed = CVResponse.model_validate({
        "personal_data": {"full_name": marker}, "work_experience": [], "education": [],
        "skills": {"it_skills": ["Java"], "soft_skills": ["Teamwork"]},
    })
    monkeypatch.setattr(app_module, "parse_cv_bytes", AsyncMock(return_value=parsed))
    scoring = AsyncMock(side_effect=AssertionError("Import darf keine Paarberechnung ausfuehren"))
    ai = AsyncMock(side_effect=AssertionError("Import darf kein AI-Matching ausfuehren"))
    monkeypatch.setattr(app_module.MatchingOrchestrator, "match_skill_matrix", scoring)
    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", ai)

    async def perform(kind, persist="true"):
        if kind in {"fast", "llm"}:
            path = "/cv-fast-importer/import" if kind == "fast" else "/cv-parser/parse"
            return await api_client.post(
                f"{path}?persist={persist}", files={"file": ("cv.pdf", b"%PDF-test", "application/pdf")},
            )
        return await api_client.post(
            f"/ingest/{'job' if kind == 'job' else 'candidate'}?persist={persist}",
            json={"raw_text": f"{marker} Java Teamwork"} if kind == "job" else {"profile": profile.model_dump(mode="json")},
        )

    try:
        yield SimpleNamespace(
            app=app_module, store=store, client=api_client, actor=matching_actor,
            perform=perform, billing=billing, scoring=scoring, ai=ai, marker=marker,
        )
    finally:
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            sources = await (await connection.execute(
                "SELECT entity_type, entity_id FROM matching_runs WHERE actor_user_id = %s", (matching_actor,),
            )).fetchall()
            await connection.execute("DELETE FROM matching_runs WHERE actor_user_id = %s", (matching_actor,))
            for entity_type, entity_id in sources:
                if entity_type == "candidate":
                    await connection.execute("DELETE FROM candidate_texts WHERE candidate_id = %s", (str(entity_id),))
                    await connection.execute("DELETE FROM candidates WHERE id = %s", (entity_id,))
                else:
                    await connection.execute("DELETE FROM jobs WHERE id = %s", (entity_id,))


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["fast", "llm", "json", "job"])
@pytest.mark.parametrize("persist", ["true", "0"])
async def test_import_routes_return_owned_pending_run_only_after_persistence(import_routes, kind, persist):
    env = import_routes
    response = await env.perform(kind, persist)
    assert response.status_code == 200, response.text
    body = response.json()
    env.scoring.assert_not_awaited()
    env.ai.assert_not_awaited()
    if persist == "0":
        assert body["persisted"] is False
        assert not body.get("matchingRunId") and not body.get("preparedRevision")
        env.app.db_service.upsert_candidate.assert_not_awaited()
        env.app.db_service.upsert_job.assert_not_awaited()
        env.app.llm_service.create_embedding.assert_not_awaited()
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT COUNT(*) FROM matching_runs WHERE actor_user_id = %s", (env.actor,),
            )).fetchone() == (0,)
        return
    run = await env.store.get_matching_run(body["matchingRunId"])
    entity_type = "job" if kind == "job" else "candidate"
    assert run["actor_user_id"] == env.actor and run["entity_type"] == entity_type
    assert run["stage"] == body["matchingStatus"] == "queued"
    assert body["matchingStatusUrl"] == f"/matching/runs/{run['id']}"
    assert body["preparationStatus"] == "ready"
    snapshot = await env.store.matching_source_snapshot(entity_type, run["entity_id"])
    assert body["preparedRevision"] == snapshot["revision"]
    table = "jobs" if kind == "job" else "candidates"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            f"SELECT matching_prepared_revision FROM {table} WHERE id = %s", (run["entity_id"],),
        )).fetchone() == (body["preparedRevision"],)
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_run_pairs WHERE run_id = %s", (run["id"],),
        )).fetchone() == (0,)
    if kind in {"fast", "llm"}:
        assert body["storage"] == {"postgres": True, "neo4j": True}
        assert body["graphRag"]["matchingRunId"] == body["matchingRunId"]


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["fast", "llm", "json", "job"])
async def test_import_graph_failure_preserves_pending_run_and_exposes_required_preparation(import_routes, monkeypatch, kind):
    env = import_routes
    method = "upsert_job" if kind == "job" else "upsert_candidate"
    monkeypatch.setattr(env.app.db_service, method, AsyncMock(side_effect=RuntimeError("graph unavailable")))
    response = await env.perform(kind)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["persisted"] is True and body["matchingStatus"] == "queued"
    assert body["preparationStatus"] == "required"
    assert body["preparationError"] == "graph_preparation_failed" and not body.get("preparedRevision")
    run = await env.store.get_matching_run(body["matchingRunId"])
    assert run["stage"] == "queued" and run["actor_user_id"] == env.actor
    if kind in {"fast", "llm"}:
        assert body["storage"] == {"postgres": True, "neo4j": False}
        assert body["graphRag"]["preparationStatus"] == "required"
    monkeypatch.setattr(env.app.db_service, method, AsyncMock())
    path, key = ("/sync/jobs", "job_ids") if kind == "job" else ("/sync/candidates", "candidate_ids")
    synced = await env.client.post(path, json={key: [run["entity_id"]]})
    assert synced.json()["synced"] == 1, synced.text
    assert str(run["entity_id"]) in synced.json()["preparedRevisions"]
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_runs WHERE actor_user_id = %s", (env.actor,),
        )).fetchone() == (1,)
    env.scoring.assert_not_awaited()
    env.ai.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["json", "job"])
async def test_sync_rejects_late_source_version_and_preserves_only_current_skill_metadata(import_routes, monkeypatch, kind):
    env = import_routes
    imported = (await env.perform(kind)).json()
    run = await env.store.get_matching_run(imported["matchingRunId"])
    table, path, key = ("jobs", "/sync/jobs", "job_ids") if kind == "job" else ("candidates", "/sync/candidates", "candidate_ids")
    changed = False

    async def edit_during_embedding(*args, **kwargs):
        nonlocal changed
        if not changed:
            changed = True
            async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
                await connection.execute(f"UPDATE {table} SET skills = 'SQL, Java' WHERE id = %s", (run["entity_id"],))
        return [1.0, 0.0]

    monkeypatch.setattr(env.app.llm_service, "create_embedding", AsyncMock(side_effect=edit_during_embedding))
    stale = (await env.client.post(path, json={key: [run["entity_id"]]})).json()
    assert stale["synced"] == 0 and stale["failed"] == 1 and not stale["preparedRevisions"]
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            f"SELECT matching_prepared_revision FROM {table} WHERE id = %s", (run["entity_id"],),
        )).fetchone() == (None,)
    fresh = (await env.client.post(path, json={key: [run["entity_id"]]})).json()
    snapshot = await env.store.matching_source_snapshot(run["entity_type"], run["entity_id"])
    assert fresh["preparedRevisions"] == {str(run["entity_id"]): snapshot["revision"]}
    assert snapshot["revision"] != imported["preparedRevision"]
    upsert = env.app.db_service.upsert_job if kind == "job" else env.app.db_service.upsert_candidate
    profile = upsert.await_args.kwargs["profile"]
    skills = profile.required_skills if kind == "job" else profile.skills
    assert [skill.name for skill in skills] == ["SQL", "Java"]
    assert skills[1].category == "HardSkill"
    if kind == "job":
        assert [skill.priority for skill in skills] == ["Mandatory", "NiceToHave"]
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(f"UPDATE {table} SET skills = '' WHERE id = %s", (run["entity_id"],))
    cleared = (await env.client.post(path, json={key: [run["entity_id"]]})).json()
    assert cleared["synced"] == 1
    profile = upsert.await_args.kwargs["profile"]
    assert (profile.required_skills if kind == "job" else profile.skills) == []


@pytest.mark.anyio
async def test_postgres_only_job_import_does_not_require_graph_availability(import_routes):
    env = import_routes
    response = await env.perform("job", "postgres")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["matchingRunId"] and body["matchingStatus"] == "queued"
    assert body["postgres_id"] and body["preparationStatus"] == "required"
    env.app.llm_service.create_embedding.assert_not_awaited()
    env.app.db_service.upsert_job.assert_not_awaited()


@pytest.mark.anyio
async def test_graph_only_job_sync_cannot_certify_a_different_stored_profile_or_identity_or_enqueue_again(import_routes):
    env = import_routes
    imported = (await env.perform("job")).json()
    run = await env.store.get_matching_run(imported["matchingRunId"])
    profile = env.app.db_service.upsert_job.await_args.kwargs["profile"].model_dump(mode="json")
    path = f"/ingest/job?persist=neo4j&job_id={imported['id']}"
    same = await env.client.post(path, json={"profile": profile})
    assert same.status_code == 200, same.text
    assert same.json()["preparationStatus"] == "ready"
    assert same.json()["preparedRevision"] == imported["preparedRevision"]
    alias = await env.client.post(
        f"/ingest/job?persist=neo4j&job_id={run['entity_id']}", json={"profile": profile},
    )
    assert alias.status_code == 200, alias.text
    assert alias.json()["preparationStatus"] == "required"
    assert alias.json()["preparationError"] == "graph_identity_differs"
    changed = await env.client.post(path, json={"profile": {
        **profile, "required_skills": [{"name": "Rust", "priority": "Mandatory"}],
    }})
    assert changed.status_code == 200, changed.text
    assert changed.json()["preparationStatus"] == "required"
    assert changed.json()["preparationError"] == "stored_profile_differs"
    assert not changed.json()["matchingRunId"]
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT matching_prepared_revision FROM jobs WHERE id = %s", (run["entity_id"],),
        )).fetchone() == (None,)
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_runs WHERE actor_user_id = %s", (env.actor,),
        )).fetchone() == (1,)


@pytest.mark.anyio
async def test_sync_accepts_csv_string_profile_fields_without_losing_current_languages(import_routes):
    env = import_routes
    imported = (await env.perform("json")).json()
    run = await env.store.get_matching_run(imported["matchingRunId"])
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(
            "UPDATE candidates SET skills = 'Java, SQL', languages = 'English, German' WHERE id = %s",
            (run["entity_id"],),
        )
        await connection.execute(
            "UPDATE candidate_texts SET profile_json = %s WHERE candidate_id = %s",
            (json.dumps({"name": env.marker, "skills": "Java, SQL", "languages": "English, German"}), str(run["entity_id"])),
        )
    response = await env.client.post("/sync/candidates", json={"candidate_ids": [run["entity_id"]]})
    assert response.json()["synced"] == 1, response.text
    profile = env.app.db_service.upsert_candidate.await_args.kwargs["profile"]
    assert [skill.name for skill in profile.skills] == ["Java", "SQL"]
    assert [language.name for language in profile.languages] == ["English", "German"]


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["json", "job"])
async def test_uuid_change_invalidates_projection_revision_but_not_canonical_matching_content(
    import_routes, stored_matching_pair, monkeypatch, kind,
):
    env = import_routes
    _, candidate_id, job_id = stored_matching_pair
    imported = (await env.perform(kind)).json()
    run = await env.store.get_matching_run(imported["matchingRunId"])
    entity_type = run["entity_type"]
    table, path, key = ("jobs", "/sync/jobs", "job_ids") if kind == "job" else ("candidates", "/sync/candidates", "candidate_ids")
    if kind == "job":
        job_id = run["entity_id"]
    else:
        candidate_id = run["entity_id"]
    original_content = await env.store.get_matching_pair_content(candidate_id, job_id)
    new_uuid = str(uuid4())
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute(f"UPDATE {table} SET uuid = %s WHERE id = %s", (new_uuid, run["entity_id"]))
    current = await env.store.matching_source_snapshot(entity_type, run["entity_id"])
    assert current["revision"] != imported["preparedRevision"]
    assert await env.store.get_matching_pair_content(candidate_id, job_id) == original_content
    monkeypatch.setattr(env.app.db_service, "delete_job" if kind == "job" else "delete_candidate", AsyncMock(return_value=1))
    synced = await env.client.post(path, json={key: [run["entity_id"]]})
    assert synced.json()["preparedRevisions"] == {str(run["entity_id"]): current["revision"]}, synced.text
    upsert = env.app.db_service.upsert_job if kind == "job" else env.app.db_service.upsert_candidate
    assert upsert.await_args.kwargs["job_id" if kind == "job" else "candidate_id"] == new_uuid


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["json", "job"])
async def test_persistent_import_rejects_removed_actor_before_any_write_or_charge(import_routes, monkeypatch, kind):
    env = import_routes
    monkeypatch.setattr(env.billing, "_claims_from_request", lambda request: BillingUserClaims(
        2147483647, "removed", None, None, "admin",
    ))
    response = await env.perform(kind)
    assert response.status_code == 401, response.text
    env.billing.charge.assert_not_awaited()
    env.app.db_service.upsert_candidate.assert_not_awaited()
    env.app.db_service.upsert_job.assert_not_awaited()


@pytest.mark.anyio
async def test_real_import_gui_join_restart_and_repeat_share_versions_and_single_debit(import_worker, monkeypatch):
    env = import_worker
    jobs = [await env.create("job") for _ in range(2)]
    imported = await persist_candidate_profile(
        postgres_store=env.store, candidate_privacy_service=CandidatePrivacyService(env.store),
        profile=CandidateProfileExtraction.model_validate({
            "name": f"Pipeline {uuid4()}", "skills": [{"name": "Python", "category": "HardSkill"}],
        }),
        candidate_text="Python development", source="Integration-Import", actor_user_id=1,
    )
    run_id, candidate_id = imported["matchingRunId"], imported["id"]
    assert imported["matchingStatus"] == "queued"
    monkeypatch.setattr(BillingService, "actor_for_request", AsyncMock(
        return_value=BillingUserClaims(1, "import-test", None, None, "recruiter"),
    ))
    monkeypatch.setattr("services.matching_pipeline.MATCHING_REQUEST_WAIT_SECONDS", 0.02)
    env.db.postgres_store = env.store
    second_started = asyncio.Event()
    execute = MatchingPairCache.execute
    evaluations = []
    match_skills = type(env.orchestrator).match_skills

    async def count_evaluator(self, *args, **kwargs):
        evaluations.append(args)
        return await match_skills(self, *args, **kwargs)

    async def pause_second(self, plan, *args, **kwargs):
        if plan.snapshot.job_id == jobs[1] and plan.owns_computation:
            second_started.set()
            await asyncio.Event().wait()
        return await execute(self, plan, *args, **kwargs)

    monkeypatch.setattr(type(env.orchestrator), "match_skills", count_evaluator)
    monkeypatch.setattr(MatchingPairCache, "execute", pause_second)
    coordinator = MatchingRequestCoordinator(env.store)
    app = FastAPI()
    app.include_router(create_matching_router(env.llm, env.db, matching_requests=coordinator))
    work = asyncio.create_task(env.process(run_id))
    try:
        await asyncio.wait_for(second_started.wait(), timeout=10)
        assert len(evaluations) == 1
        job_graph_ids = await env.store.graph_ids_for("jobs", [str(job_id) for job_id in jobs])
        candidate_graph_ids = await env.store.graph_ids_for("candidates", [str(candidate_id)])
        payload = {
            "jobs": [{**env.graphs["job"][job_graph_ids[str(job_id)]], "id": job_id} for job_id in jobs],
            "candidates": [{**env.graphs["candidate"][candidate_graph_ids[str(candidate_id)]], "id": candidate_id}],
        }
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/match/external/matrix", json=payload)
            assert response.status_code == 202, response.text
            gui_run_id = response.json()["runId"]
            await coordinator.shutdown(timeout=3)
            pending = (await client.get(f"/matching/runs/{gui_run_id}")).json()
            assert len(pending["availableResults"]) == 1, pending
            assert len(pending["pendingPairs"]) == 1, pending
            assert all("score" not in pair for pair in pending["pendingPairs"])
            original_time = pending["availableResults"][0]["matchedAt"]
        assert len(evaluations) == 1
    finally:
        work.cancel()
        with pytest.raises(asyncio.CancelledError):
            await work
        await coordinator.shutdown(timeout=0)

    assert (await env.store.get_matching_run(run_id))["stage"] == "queued"
    monkeypatch.setattr(MatchingPairCache, "execute", execute)
    env.worker = type(env.worker)(env.store)
    assert (await env.process(run_id))["stage"] == "completed"
    assert len(evaluations) == 2
    calls_after_restart = len(env.calls)

    recovered = MatchingRequestCoordinator(env.store)
    create_matching_router(env.llm, env.db, matching_requests=recovered)
    try:
        await recovered.resume()
    finally:
        await recovered.shutdown(timeout=3)
    joined = await env.store.get_matching_run(gui_run_id)
    assert joined["stage"] == "completed"
    assert all(row["cacheStatus"] == "hit" for row in joined["result_payload"]["matrix"])
    assert joined["result_payload"]["matrix"][0]["matchedAt"] == original_time

    repeat_coordinator = MatchingRequestCoordinator(env.store)
    repeated_app = FastAPI()
    repeated_app.include_router(create_matching_router(env.llm, env.db, matching_requests=repeat_coordinator))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=repeated_app), base_url="http://test") as client:
            repeated = await client.post("/match/external/matrix", json=payload)
            assert repeated.status_code in (200, 202), repeated.text
            repeated_run_id = repeated.json()["runId"]
            await repeat_coordinator.shutdown(timeout=3)
            final = (await client.get(f"/matching/runs/{repeated_run_id}")).json()
            assert final["stage"] == "completed", final
            assert all(row["cacheStatus"] == "hit" for row in final["resultPayload"]["matrix"])
            assert final["resultPayload"]["matrix"][0]["matchedAt"] == original_time
    finally:
        await repeat_coordinator.shutdown(timeout=0)
    assert len(evaluations) == 2 and len(env.calls) == calls_after_restart
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        rows = await (await connection.execute(
            "SELECT method, candidate_id, job_id, status FROM matching_pair_evaluations ORDER BY job_id",
        )).fetchall()
        assert rows == [("vector", candidate_id, job_id, "succeeded") for job_id in sorted(jobs)]
        assert await (await connection.execute(
            "SELECT matching_run_id::text, amount::text FROM credit_transactions",
        )).fetchall() == [(run_id, "-0.10")]
        assert await (await connection.execute("SELECT current_balance::text FROM users WHERE id = 1")).fetchone() == ("0.90",)


@pytest_asyncio.fixture
async def durable_requests(stored_matching_pair, matching_actor, monkeypatch):
    store, candidate_id, job_id = stored_matching_pair
    config = {"model": "embedding-before"}
    model_config = ModelConfigService(store)

    async def snapshot(task, *, connection=None):
        return ModelRuntimeConfig(
            task=task, provider="openrouter", base_url="http://test/v1", model=config["model"],
            api_key="private-provider-value",
        )

    monkeypatch.setattr(model_config, "snapshot", snapshot)
    monkeypatch.setattr(BillingService, "actor_for_request", AsyncMock(
        return_value=BillingUserClaims(matching_actor, "test", None, None, "recruiter"),
    ))
    monkeypatch.setattr("services.matching_pipeline.MATCHING_REQUEST_WAIT_SECONDS", 0.02)
    llm = LLMService("http://test/v1", "chat", "embedding-before", 3, model_config_service=model_config)
    calls = []

    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"embedding": [1.0, 0.0, 0.0]}]})

    await llm.client.aclose()
    llm.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    catalog = SimpleNamespace(postgres_store=store, get_esco_concepts_for_aliases=AsyncMock(return_value=[]))
    coordinator = MatchingRequestCoordinator(store)
    app = FastAPI()
    app.include_router(create_matching_router(llm, catalog, matching_requests=coordinator))
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = %s", (matching_actor,))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield SimpleNamespace(
                store=store, client=client, coordinator=coordinator, catalog=catalog, llm=llm,
                candidate_id=candidate_id, job_id=job_id, calls=calls, config=config, actor=matching_actor,
                payload={"jobs": [{"id": job_id, "title": "Engineer", "required_skills": ["Python"]}],
                         "candidates": [{"id": candidate_id, "name": "Ada", "skills": ["Python"]}]},
            )
    finally:
        await coordinator.shutdown(timeout=0)
        await llm.close()


@pytest.mark.anyio
async def test_unstarted_request_survives_restart_and_replans_current_version_without_second_debit(
    durable_requests, monkeypatch,
):
    env = durable_requests
    before_model = asyncio.Event()
    never_release = asyncio.Event()
    original_mark = env.store.mark_matching_model_started

    async def pause_before_mark(*args):
        before_model.set()
        await never_release.wait()
        await original_mark(*args)

    monkeypatch.setattr(env.store, "mark_matching_model_started", pause_before_mark)
    response = await env.client.post(
        "/match/external/matrix", json=env.payload, headers={"authorization": "Bearer private-token-value"},
    )
    assert response.status_code == 202, response.text
    pending = response.json()
    assert "score" not in pending and all("score" not in pair for pair in pending["pendingPairs"])
    await asyncio.wait_for(before_model.wait(), timeout=3)
    current = await env.store.get_matching_pending_response(pending["runId"])
    assert len(current["pendingPairs"]) == 1
    assert current["pendingPairs"][0]["status"] == "running" and "score" not in current["pendingPairs"][0]
    await env.coordinator.shutdown(timeout=0)
    assert env.calls == []
    run_id = pending["runId"]
    run = await env.store.get_matching_run(run_id)
    assert run["stage"] == "queued" and run["request_payload"]["handler"] == "external_matrix"
    assert all(value not in json.dumps(run["request_payload"]) for value in ("private-token-value", "private-provider-value"))
    env.config["model"] = "embedding-after"
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE candidates SET name = 'Current Candidate' WHERE id = %s", (env.candidate_id,))
    monkeypatch.setattr(env.store, "mark_matching_model_started", original_mark)
    recovered = MatchingRequestCoordinator(env.store)
    create_matching_router(env.llm, env.catalog, matching_requests=recovered)
    await recovered.resume()
    await recovered.shutdown(timeout=3)
    result = await env.store.get_matching_run(run_id)
    assert result["stage"] == "completed", result
    assert result["result_payload"]["matrix"][0]["model"] == "embedding-after"
    assert result["result_payload"]["runId"] == run_id
    assert env.calls and all(call["model"] == "embedding-after" for call in env.calls)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone() == (1,)
        assert await (await connection.execute(
            "SELECT current_balance::text FROM users WHERE id = %s", (env.actor,),
        )).fetchone() == ("0.90",)


@pytest.mark.anyio
async def test_started_request_is_not_replayed_after_shutdown(durable_requests):
    env = durable_requests
    started = asyncio.Event()
    never_release = asyncio.Event()

    async def block_provider(request):
        env.calls.append(json.loads(request.content))
        started.set()
        await never_release.wait()
        raise AssertionError("Providerantwort darf nicht synthetisch abgeschlossen werden")

    await env.llm.client.aclose()
    env.llm.client = httpx.AsyncClient(transport=httpx.MockTransport(block_provider))
    response = await env.client.post("/match/external/matrix", json=env.payload)
    assert response.status_code == 202
    await asyncio.wait_for(started.wait(), timeout=3)
    await env.coordinator.shutdown(timeout=0)
    run_id = response.json()["runId"]
    assert (await env.store.get_matching_run(run_id))["stage"] == "needs_review"
    assert run_id not in await env.store.list_recoverable_matching_requests()
    assert len(env.calls) == 1


@pytest.mark.anyio
async def test_multijob_selection_recovers_all_children_and_preserves_per_job_tariff(durable_requests, monkeypatch):
    env = durable_requests
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        extra_job = await (await connection.execute(
            "INSERT INTO jobs (title) VALUES (%s) RETURNING id", (f"selection-{uuid4()}",),
        )).fetchone()
    extra_job_id = int(extra_job[0])
    monkeypatch.setattr(env.catalog, "get_jobs_for_vectormatch", AsyncMock(side_effect=lambda ids, titles=None: [
        {"id": value, "title": "Engineer", "required_skills": ["Python"]} for value in ids
    ]), raising=False)
    monkeypatch.setattr(env.catalog, "get_candidates_for_vectormatch", AsyncMock(side_effect=lambda ids, names=None: [
        {"id": value, "name": "Ada", "has_skill": ["Python"]} for value in ids
    ]), raising=False)
    before_collection = asyncio.Event()
    never_release = asyncio.Event()
    original_sync = env.store.sync_matching_children

    async def pause_before_collection(*args):
        before_collection.set()
        await never_release.wait()
        return await original_sync(*args)

    monkeypatch.setattr(env.store, "sync_matching_children", pause_before_collection)
    try:
        response = await env.client.post("/match/vectormatch-selected", json={
            "pairs": [{"jobId": job_id, "candidateId": env.candidate_id} for job_id in (env.job_id, extra_job_id)],
            "selectedCount": 3,
            "localFailures": [{"jobId": str(env.job_id), "candidateId": "999999999", "error": "Bewerber nicht gefunden"}],
        })
        assert response.status_code == 202, response.text
        run_id = response.json()["runId"]
        await asyncio.wait_for(before_collection.wait(), timeout=3)
        preview = await env.store.get_matching_pending_response(run_id)
        assert len(preview["availableResults"]) == 2 and preview["pendingPairs"] == []
        assert all(row["cacheStatus"] == "computed" for row in preview["availableResults"])
        progress = await env.store.get_matching_run_progress(run_id)
        assert (progress["targetCount"], progress["computedCount"], progress["processedCount"], progress["pendingCount"]) == (2, 2, 2, 0)
        await env.coordinator.shutdown(timeout=0)
        assert (await env.store.get_matching_run(run_id))["stage"] == "queued"
        count_before = len(env.calls)
        monkeypatch.setattr(env.store, "sync_matching_children", original_sync)
        recovered = MatchingRequestCoordinator(env.store)
        create_matching_router(env.llm, env.catalog, matching_requests=recovered)
        await recovered.resume()
        await recovered.shutdown(timeout=3)
        run = await env.store.get_matching_run(run_id)
        assert run["stage"] == "completed_with_errors", run
        result = run["result_payload"]
        assert (result["selectedCount"], result["matchedCount"], result["failedCount"]) == (3, 2, 1)
        assert result["failures"][0]["error"] == "Bewerber nicht gefunden"
        assert len(env.calls) == count_before
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT COUNT(*) FROM matching_runs WHERE parent_run_id = %s", (run_id,),
            )).fetchone() == (2,)
            assert await (await connection.execute(
                """SELECT COUNT(*) FROM credit_transactions c JOIN matching_runs r ON r.id = c.matching_run_id
                   WHERE r.parent_run_id = %s""", (run_id,),
            )).fetchone() == (2,)
            assert await (await connection.execute(
                "SELECT COUNT(*) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
            )).fetchone() == (0,)
            assert await (await connection.execute(
                "SELECT current_balance::text FROM users WHERE id = %s", (env.actor,),
            )).fetchone() == ("0.80",)
            parent_pair = await (await connection.execute(
                "SELECT id, evaluation_id FROM matching_run_pairs WHERE run_id = %s AND job_id = %s",
                (run_id, env.job_id),
            )).fetchone()
            await connection.execute("UPDATE users SET role = 'admin' WHERE id = %s", (env.actor,))
            await connection.execute(
                """UPDATE matching_pair_evaluations SET status = 'needs_review', result_payload = NULL,
                   completed_at = NULL, call_started_at = clock_timestamp() WHERE id = %s""", (parent_pair[1],),
            )
            await connection.execute(
                """UPDATE matching_runs SET stage = 'needs_review'
                   WHERE id = %s OR id = (SELECT owner_run_id FROM matching_pair_evaluations WHERE id = %s)""",
                (run_id, parent_pair[1]),
            )
        await env.store.retry_matching_pairs(
            run_id, [parent_pair[0]], actor_user_id=env.actor, confirm_uncertain=True,
        )
        await recovered.resume()
        await recovered.shutdown(timeout=3)
        retried = await env.store.get_matching_run(run_id)
        assert retried["result_payload"]["matchedCount"] == 2 and retried["result_payload"]["failedCount"] == 1
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                """SELECT e.attempt FROM matching_pair_evaluations e
                   WHERE candidate_id = %s AND job_id = %s""", (env.candidate_id, env.job_id),
            )).fetchone() == (2,)
            assert await (await connection.execute(
                "SELECT COUNT(*) FROM credit_transactions WHERE user_id = %s", (env.actor,),
            )).fetchone() == (2,)
    finally:
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            await connection.execute("DELETE FROM jobs WHERE id = %s", (extra_job_id,))


@pytest.mark.anyio
@pytest.mark.parametrize("entity", ["candidate", "job"])
@pytest.mark.parametrize("reference_source", ["request_payload", "client_context"])
async def test_source_deletion_scrubs_request_payload_even_before_evaluation_planning(
    stored_matching_pair, matching_actor, entity, reference_source,
):
    store, candidate_id, job_id = stored_matching_pair
    run_id = await store.create_matching_run(
        actor_user_id=matching_actor, source="/match/external/matrix", method="vector",
        request_payload={
            "handler": "external_matrix", "arguments": {"private_profile": "Remove this"},
            "candidate_refs": [str(candidate_id)], "job_refs": [str(job_id)],
        }, tariff_amount="-0.10", tariff_action="3D_MATCH",
    )
    table, row_id = ("candidates", candidate_id) if entity == "candidate" else ("jobs", job_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        if reference_source == "client_context":
            await connection.execute(
                """UPDATE matching_runs SET client_context = request_payload,
                   request_payload = '{"handler": "external_matrix", "arguments": {}}'::jsonb WHERE id = %s""",
                (run_id,),
            )
        history = await (await connection.execute(
            """INSERT INTO matching_results (job_description, job_title, results, matching_run_id)
               VALUES ('Private input', 'Private title', '{"name": "Private candidate"}', %s) RETURNING id""",
            (run_id,),
        )).fetchone()
        await connection.execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))
        assert await (await connection.execute(
            "SELECT results, job_description FROM matching_results WHERE id = %s", (history[0],),
        )).fetchone() == ("{}", "")
        await connection.execute("DELETE FROM matching_results WHERE id = %s", (history[0],))
    run = await store.get_matching_run(run_id)
    assert run["request_payload"] is None and run["result_payload"] is None and run["client_context"] is None
    assert run["stage"] == "failed" and run["error_code"] == "source_deleted"


@pytest.mark.anyio
async def test_run_status_is_private_and_retains_original_completed_payload(durable_requests, monkeypatch):
    env = durable_requests
    response = await env.client.post("/match/external/matrix", json=env.payload)
    assert response.status_code in {200, 202}
    run_id = response.json()["runId"]
    await env.coordinator.shutdown(timeout=3)
    completed = await env.client.get(f"/matching/runs/{run_id}")
    assert completed.status_code == 200, completed.text
    payload = completed.json()
    assert payload["stage"] == "completed" and payload["resultPayload"]["runId"] == run_id
    assert payload["resultPayload"]["matrix"][0]["matchedAt"] == payload["availableResults"][0]["matchedAt"]
    assert all(key not in payload for key in ("request_payload", "client_context", "actor_user_id"))
    calls = len(env.calls)
    assert (await env.client.get(f"/matching/runs/{run_id}")).json() == payload
    assert len(env.calls) == calls
    monkeypatch.setattr(BillingService, "actor_for_request", AsyncMock(
        return_value=BillingUserClaims(env.actor + 1000000, "other", None, None, "recruiter"),
    ))
    assert (await env.client.get(f"/matching/runs/{run_id}")).status_code == 404
    monkeypatch.setattr(BillingService, "actor_for_request", AsyncMock(
        return_value=BillingUserClaims(env.actor + 1000000, "admin", None, None, "admin"),
    ))
    assert (await env.client.get(f"/matching/runs/{run_id}")).status_code == 200


@pytest.mark.anyio
async def test_import_event_is_idempotent_and_targets_do_not_require_evaluations(stored_matching_pair, matching_actor):
    store, candidate_id, job_id = stored_matching_pair
    kwargs = dict(actor_user_id=matching_actor, source="CV-Import", event_key=f"test-{uuid4()}")
    first = await store.enqueue_matching_import("candidate", candidate_id, **kwargs)
    assert await store.enqueue_matching_import("candidate", candidate_id, **kwargs) == first
    with pytest.raises(ValueError, match="anderen Auftrag"):
        await store.enqueue_matching_import("job", job_id, **kwargs)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute(
            """INSERT INTO matching_run_pairs (run_id, method, candidate_id, job_id)
               VALUES (%s, 'vector', %s, %s)""",
            (first, candidate_id, job_id),
        )
        row = await (await connection.execute(
            "SELECT evaluation_id, disposition FROM matching_run_pairs WHERE run_id = %s", (first,),
        )).fetchone()
        assert row == (None, "pending")
        count = await (await connection.execute(
            "SELECT COUNT(*) FROM matching_runs WHERE import_event_key = %s", (kwargs["event_key"],),
        )).fetchone()
        assert count == (1,)


@pytest.mark.anyio
async def test_import_event_and_record_write_share_the_callers_transaction(stored_matching_pair, matching_actor):
    store, candidate_id, _ = stored_matching_pair
    event_key = f"rollback-{uuid4()}"
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        with pytest.raises(RuntimeError, match="rollback"):
            async with connection.transaction():
                await connection.execute(
                    "UPDATE candidates SET notes = 'not-committed' WHERE id = %s", (candidate_id,),
                )
                await store.enqueue_matching_import(
                    "candidate", candidate_id, actor_user_id=matching_actor,
                    source="CV-Import", event_key=event_key, connection=connection,
                )
                raise RuntimeError("rollback")
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_runs WHERE import_event_key = %s", (event_key,),
        )).fetchone() == (0,)
        assert await (await connection.execute(
            "SELECT notes FROM candidates WHERE id = %s", (candidate_id,),
        )).fetchone() == (None,)


@pytest.mark.anyio
@pytest.mark.parametrize("entity", ["candidate", "job"])
async def test_import_record_profile_and_outbox_roll_back_together(
    stored_matching_pair, matching_actor, monkeypatch, entity,
):
    store, _, _ = stored_matching_pair
    marker = f"atomic-import-{uuid4()}"
    enqueue = store.enqueue_matching_import

    async def fail_after_enqueue(*args, **kwargs):
        await enqueue(*args, **kwargs)
        raise RuntimeError("outbox failure")

    monkeypatch.setattr(store, "enqueue_matching_import", fail_after_enqueue)
    with pytest.raises(RuntimeError, match="outbox failure"):
        if entity == "candidate":
            await persist_candidate_profile(
                postgres_store=store, candidate_privacy_service=CandidatePrivacyService(store),
                profile=CandidateProfileExtraction(name=marker, birth_date="1990-01-02"),
                candidate_text=f"{marker}\nPython", source="Test", actor_user_id=matching_actor, event_key=marker,
            )
        else:
            await persist_job_profile(
                postgres_store=store, job_id=None, raw_text="Python",
                profile=JobProfileExtraction(title=marker), source="Test",
                actor_user_id=matching_actor, event_key=marker,
            )
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT count(*) FROM matching_runs WHERE import_event_key = %s", (marker,),
        )).fetchone() == (0,)
        assert await (await connection.execute(
            "SELECT count(*) FROM candidates WHERE name = %s", (marker,),
        )).fetchone() == (0,)
        assert await (await connection.execute(
            "SELECT count(*) FROM candidate_texts WHERE candidate_name = %s", (marker,),
        )).fetchone() == (0,)
        assert await (await connection.execute(
            "SELECT count(*) FROM jobs WHERE title = %s", (marker,),
        )).fetchone() == (0,)


@pytest.mark.anyio
async def test_imports_keep_full_profiles_and_queue_only_created_or_changed_versions(stored_matching_pair, matching_actor):
    store, _, _ = stored_matching_pair
    marker = f"profile-import-{uuid4()}"
    candidate_name = f"Candidate {marker}"
    profile = CandidateProfileExtraction.model_validate({
        "name": candidate_name, "birth_date": "1990-01-02",
        "skills": [{"name": "Python", "category": "HardSkill"}],
    })
    job_profile = JobProfileExtraction.model_validate({
        "title": f"Job {marker}", "company": "Import Company",
        "required_skills": [{"name": "Python", "priority": "Mandatory", "category": "HardSkill"}],
    })
    kwargs = dict(
        postgres_store=store, job_id=None, raw_text="Python needed", profile=job_profile,
        source="Test", actor_user_id=matching_actor, url=f"https://example.test/{marker}",
    )
    try:
        candidate = await persist_candidate_profile(
            postgres_store=store, candidate_privacy_service=CandidatePrivacyService(store),
            profile=profile, candidate_text=f"{candidate_name}\nPython", source="Test", actor_user_id=matching_actor,
        )
        text = await store.get_candidate_text(str(candidate["id"]))
        assert text["profile_json"]["skills"][0]["category"] == "HardSkill"
        assert "birth_date" not in text["profile_json"]
        assert text["anonymized_text"] and text["mapping"]
        assert (await store.get_matching_run(candidate["matchingRunId"]))["actor_user_id"] == matching_actor
        with pytest.raises(DuplicateCandidateError):
            await persist_candidate_profile(
                postgres_store=store, candidate_privacy_service=CandidatePrivacyService(store),
                profile=profile, candidate_text=f"{candidate_name}\nPython", source="Test", actor_user_id=matching_actor,
            )
        job = await persist_job_profile(**kwargs)
        assert job["matchingStatus"] == "queued" and job["changed"] is True
        duplicate = await persist_job_profile(**kwargs)
        assert duplicate["changed"] is False and duplicate["matchingRunId"] is None
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            await connection.execute("UPDATE jobs SET status = 'Pausiert' WHERE id = %s", (job["id"],))
            await connection.execute(
                "INSERT INTO pipeline_entries (candidate_id, job_id, stage) VALUES (%s, %s, 'Interview')",
                (candidate["id"], job["id"]),
            )
        kwargs["profile"] = JobProfileExtraction.model_validate({
            **job_profile.model_dump(), "required_skills": [
                {"name": "Java", "priority": "NiceToHave", "category": "HardSkill"},
            ],
        })
        results = await asyncio.gather(persist_job_profile(**kwargs), persist_job_profile(**kwargs))
        assert sorted(row["changed"] for row in results) == [False, True]
        assert all(row["id"] == job["id"] and row["uuid"] == job["uuid"] for row in results)
        current = await store.get_job_text(str(job["id"]))
        assert current["parsed_profile_json"]["required_skills"][0]["name"] == "Java"
        assert current["parsed_profile_json"]["required_skills"][0]["priority"] == "NiceToHave"
        assert current["status"] == "Pausiert"
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT count(*) FROM matching_runs WHERE entity_type = 'candidate' AND entity_id = %s",
                (candidate["id"],),
            )).fetchone() == (1,)
            assert await (await connection.execute(
                "SELECT count(*) FROM matching_runs WHERE entity_type = 'job' AND entity_id = %s", (job["id"],),
            )).fetchone() == (2,)
            assert await (await connection.execute(
                "SELECT stage FROM pipeline_entries WHERE candidate_id = %s AND job_id = %s",
                (candidate["id"], job["id"]),
            )).fetchone() == ("Interview",)
    finally:
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            await connection.execute(
                "DELETE FROM pipeline_entries WHERE candidate_id IN (SELECT id FROM candidates WHERE name = %s)",
                (candidate_name,),
            )
            await connection.execute("DELETE FROM candidate_texts WHERE candidate_name = %s", (candidate_name,))
            await connection.execute("DELETE FROM candidates WHERE name = %s", (candidate_name,))
            await connection.execute("DELETE FROM jobs WHERE title = %s", (job_profile.title,))
