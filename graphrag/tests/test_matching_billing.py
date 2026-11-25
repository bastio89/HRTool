from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest
from fastapi import HTTPException, Request

from services.postgres_store import PostgresStore
from plugins.billing.service import BillingService
from services.matching_cache import MatchingInputSnapshot, MatchingPairCache


_TEST_SECRET = "matching-tests-only"


def signed_request(claims):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=")
    parts = encode({"alg": "HS256", "typ": "JWT"}) + b"." + encode({"exp": time.time() + 60, **claims})
    signature = base64.urlsafe_b64encode(hmac.new(_TEST_SECRET.encode(), parts, hashlib.sha256).digest()).rstrip(b"=")
    token = (parts + b"." + signature).decode()
    return Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}), token


async def import_run(store, candidate_id, actor):
    return await store.enqueue_matching_import(
        "candidate", candidate_id, actor_user_id=actor, source="billing-test", event_key=f"billing-{uuid4()}",
    )


@pytest.mark.anyio
async def test_automatic_import_charges_once_for_many_pairs_and_nothing_for_an_overlapping_cache_run(import_worker):
    env = import_worker
    candidate_id = await env.create("candidate")
    jobs = [await env.create("job") for _ in range(4)]
    owning_run = await env.enqueue("candidate", candidate_id)
    cached_run = await env.enqueue("job", jobs[0])
    assert (await env.process(owning_run))["stage"] == "completed"
    calls = len(env.calls)
    env.prepare.reset_mock()
    assert (await env.process(cached_run))["stage"] == "completed"
    assert len(env.calls) == calls
    env.prepare.assert_not_awaited()
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT matching_run_id::text, amount, action_type FROM credit_transactions",
        )).fetchall() == [(owning_run, Decimal("-0.10"), "3D_MATCH")]
        assert await (await connection.execute(
            "SELECT current_balance, total_credits_used FROM users WHERE id = 1",
        )).fetchone() == (Decimal("0.90"), Decimal("0.10"))
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (4,)


@pytest.mark.anyio
async def test_automatic_import_join_does_not_charge_or_start_a_second_provider_call(import_worker, monkeypatch):
    env = import_worker
    candidate_id = await env.create("candidate")
    job_id = await env.create("job")
    owning_run = await env.enqueue("candidate", candidate_id)
    joining_run = await env.enqueue("job", job_id)
    started, release = asyncio.Event(), asyncio.Event()
    post = env.llm.client.post
    posted = []

    async def delayed(*args, **kwargs):
        posted.append(args)
        started.set()
        await release.wait()
        return await post(*args, **kwargs)

    monkeypatch.setattr(env.llm.client, "post", delayed)
    work = asyncio.create_task(env.process(owning_run))
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        joined = await asyncio.wait_for(env.process(joining_run), timeout=5)
        assert joined["stage"] == "matching" and len(posted) == 1
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT matching_run_id::text, amount FROM credit_transactions",
            )).fetchall() == [(owning_run, Decimal("-0.10"))]
    finally:
        release.set()
        await work
    before = len(posted)
    assert (await env.process(joining_run))["stage"] == "completed"
    assert len(posted) == before
    progress = await env.store.get_matching_run_progress(joining_run)
    assert (progress["sharedCount"], progress["cachedCount"], progress["computedCount"]) == (1, 0, 0)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (1,)
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (1,)


@pytest.mark.anyio
@pytest.mark.parametrize("reason", ["insufficient_credits", "missing_actor"])
async def test_automatic_import_blocks_before_pair_models_and_credit_retry_keeps_the_same_run(import_worker, reason):
    env = import_worker
    candidate_id = await env.create("candidate")
    await env.create("job")
    run_id = await env.enqueue("candidate", candidate_id)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        if reason == "missing_actor":
            await connection.execute("DELETE FROM users WHERE id = 1")
        else:
            await connection.execute("UPDATE users SET current_balance = 0 WHERE id = 1")
    with pytest.raises(HTTPException) as error:
        await env.process(run_id)
    assert error.value.status_code == (402 if reason == "insufficient_credits" else 409)
    run = await env.store.get_matching_run(run_id)
    assert run["stage"] == "blocked_credits" and run["error_code"] == reason
    assert not env.calls
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute("SELECT COUNT(*) FROM credit_transactions")).fetchone() == (0,)
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_pair_evaluations WHERE call_started_at IS NOT NULL OR status = 'running'",
        )).fetchone() == (0,)
        if reason == "insufficient_credits":
            await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = 1")
            await connection.execute("UPDATE matching_runs SET stage = 'queued', error_code = NULL WHERE id = %s", (run_id,))
    if reason == "missing_actor":
        env.prepare.assert_not_awaited()
    else:
        assert (await env.process(run_id))["stage"] == "completed"
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT matching_run_id::text, amount FROM credit_transactions",
            )).fetchall() == [(run_id, Decimal("-0.10"))]


@pytest.mark.anyio
async def test_expired_prepaid_claim_cannot_charge_a_joining_import_again(import_worker, monkeypatch):
    env = import_worker
    candidate_id = await env.create("candidate")
    job_id = await env.create("job")
    original_run = await env.enqueue("candidate", candidate_id)
    joining_run = await env.enqueue("job", job_id)
    claimed, release = asyncio.Event(), asyncio.Event()
    heartbeat = env.store.heartbeat_matching_evaluation
    paused = False

    async def pause_before_first_model(*args, **kwargs):
        nonlocal paused
        if not paused:
            paused = True
            claimed.set()
            await release.wait()
        return await heartbeat(*args, **kwargs)

    monkeypatch.setattr(env.store, "heartbeat_matching_evaluation", pause_before_first_model)
    work = asyncio.create_task(env.process(original_run))
    try:
        await asyncio.wait_for(claimed.wait(), timeout=5)
        assert not env.calls
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT COUNT(*) FROM credit_transactions WHERE matching_run_id = %s", (original_run,),
            )).fetchone() == (1,)
            await connection.execute(
                """UPDATE matching_pair_evaluations SET lease_until = clock_timestamp() - INTERVAL '1 second'
                   WHERE owner_run_id = %s AND call_started_at IS NULL""", (original_run,),
            )
            await connection.execute(
                "UPDATE matching_runs SET lease_until = clock_timestamp() - INTERVAL '1 second' WHERE id = %s",
                (original_run,),
            )
        assert (await asyncio.wait_for(env.process(joining_run), timeout=5))["stage"] == "matching"
        assert not env.calls
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            assert await (await connection.execute(
                "SELECT COUNT(*), SUM(amount) FROM credit_transactions",
            )).fetchone() == (1, Decimal("-0.10"))
    finally:
        release.set()
        await asyncio.gather(work, return_exceptions=True)
    assert (await env.store.get_matching_run(original_run))["stage"] == "queued"
    assert (await env.process(original_run))["stage"] == "completed"
    calls = len(env.calls)
    assert (await env.process(joining_run))["stage"] == "completed"
    assert len(env.calls) == calls
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT matching_run_id::text, amount FROM credit_transactions",
        )).fetchall() == [(original_run, Decimal("-0.10"))]
        assert await (await connection.execute("SELECT COUNT(*) FROM matching_pair_evaluations")).fetchone() == (1,)


@pytest.mark.anyio
async def test_parallel_matching_debits_and_restart_return_one_original_transaction(stored_matching_pair, matching_actor):
    store, candidate_id, _ = stored_matching_pair
    run_id = await import_run(store, candidate_id, matching_actor)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = %s", (matching_actor,))
    first, second = await asyncio.gather(
        store.apply_credit_transaction(matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id),
        PostgresStore(store.database_url).apply_credit_transaction(
            matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id,
        ),
    )
    assert first["transaction"]["id"] == second["transaction"]["id"]
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        before = await (await connection.execute(
            "SELECT current_balance, total_credits_used, updated_at FROM users WHERE id = %s", (matching_actor,),
        )).fetchone()
        assert before[:2] == (Decimal("0.90"), Decimal("0.10"))
    third = await PostgresStore(store.database_url).apply_credit_transaction(
        matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id,
    )
    assert third["transaction"]["id"] == first["transaction"]["id"]
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT current_balance, total_credits_used, updated_at FROM users WHERE id = %s", (matching_actor,),
        )).fetchone() == before
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone() == (1,)


@pytest.mark.anyio
async def test_duplicate_run_cannot_change_charge_terms_or_actor(stored_matching_pair, matching_actor):
    store, candidate_id, _ = stored_matching_pair
    run_id = await import_run(store, candidate_id, matching_actor)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = %s", (matching_actor,))
    await store.apply_credit_transaction(matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id)
    for amount, action in (("-0.20", "3D_MATCH"), ("-0.10", "AI_MATCH")):
        with pytest.raises(ValueError, match="different terms"):
            await store.apply_credit_transaction(matching_actor, amount, action, matching_run_id=run_id)
    with pytest.raises(ValueError, match="actor"):
        await store.apply_credit_transaction(-1, "-0.10", "3D_MATCH", matching_run_id=run_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT current_balance, total_credits_used FROM users WHERE id = %s", (matching_actor,),
        )).fetchone() == (Decimal("0.90"), Decimal("0.10"))


@pytest.mark.anyio
async def test_insufficient_credit_rolls_back_and_same_run_can_resume_once(stored_matching_pair, matching_actor):
    store, candidate_id, _ = stored_matching_pair
    run_id = await import_run(store, candidate_id, matching_actor)
    with pytest.raises(ValueError, match="Insufficient credits"):
        await store.apply_credit_transaction(matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone() == (0,)
        await connection.execute("UPDATE users SET current_balance = 0.20 WHERE id = %s", (matching_actor,))
    paid = await store.apply_credit_transaction(matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id)
    resumed = await store.apply_credit_transaction(matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id)
    assert paid["transaction"]["id"] == resumed["transaction"]["id"]
    assert resumed["current_balance"] == 0.10


@pytest.mark.anyio
async def test_manual_run_targets_are_unique_and_only_unbilled_unstarted_claims_can_be_released(
    stored_matching_pair, matching_actor,
):
    store, candidate_id, job_id = stored_matching_pair
    run_id = await store.create_matching_run(
        actor_user_id=matching_actor, source="/match/external/matrix", method="vector",
    )
    snapshot = MatchingInputSnapshot.create(
        "vector", candidate_id, job_id, candidate={"id": candidate_id}, job={"id": job_id},
        payload={"need": ["Python"], "has": ["Python"]},
        configuration={"provider": "ollama", "base_url": "http://test", "model": "test-embedding"},
    )
    cache = MatchingPairCache(store)
    original = await cache.plan(snapshot, run_id=run_id)
    await store.attach_matching_run_pairs(run_id, [original, original])
    assert (await store.get_matching_run(run_id))["target_count"] == 1
    await store.release_unbilled_matching_claims(run_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT status, owner_run_id, lease_owner, fence FROM matching_pair_evaluations WHERE id = %s",
            (original.evaluation["id"],),
        )).fetchone() == ("queued", None, None, original.evaluation["fence"] + 1)
        await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = %s", (matching_actor,))
    resumed = await cache.plan(snapshot, run_id=run_id)
    await store.apply_credit_transaction(matching_actor, "-0.10", "3D_MATCH", matching_run_id=run_id)
    await store.release_unbilled_matching_claims(run_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT status, fence FROM matching_pair_evaluations WHERE id = %s", (resumed.evaluation["id"],),
        )).fetchone() == ("running", resumed.evaluation["fence"])


@pytest.mark.anyio
async def test_matching_actor_uses_current_database_identity_and_never_persists_bearer_token(
    stored_matching_pair, matching_actor,
):
    store, candidate_id, _ = stored_matching_pair
    service = BillingService(store, jwt_secret=_TEST_SECRET)
    request, token = signed_request({"id": matching_actor, "role": "admin", "private_marker": "not-stored"})
    actor = await service.actor_for_request(request)
    assert actor.user_id == matching_actor and actor.role == "recruiter"
    with pytest.raises(HTTPException) as denied:
        await service.require_matching_admin(request)
    assert denied.value.status_code == 403
    with pytest.raises(HTTPException) as missing:
        await service.actor_for_request(Request({"type": "http", "headers": [(b"x-api-key", b"test-only")]}))
    assert missing.value.status_code == 401
    run_id = await import_run(store, candidate_id, actor.user_id)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = %s", (matching_actor,))
    await service.charge_matching_run(run_id, "-0.10", "3D_MATCH")
    run = await store.get_matching_run(run_id)
    assert run is not None and run["actor_user_id"] == matching_actor
    assert token not in json.dumps(run, default=str) and "not-stored" not in json.dumps(run, default=str)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        metadata = await (await connection.execute(
            "SELECT metadata FROM credit_transactions WHERE matching_run_id = %s", (run_id,),
        )).fetchone()
        assert metadata == ({"matching_run_id": run_id},)


@pytest.mark.anyio
async def test_durable_run_reports_credit_block_and_resumes_without_a_jwt(stored_matching_pair, matching_actor):
    store, candidate_id, _ = stored_matching_pair
    run_id = await import_run(store, candidate_id, matching_actor)
    service = BillingService(store)
    with pytest.raises(HTTPException) as blocked:
        await service.charge_matching_run(run_id, "-0.10", "3D_MATCH")
    assert blocked.value.status_code == 402
    run = await store.get_matching_run(run_id)
    assert run is not None and (run["stage"], run["error_code"]) == ("blocked_credits", "insufficient_credits")
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 0.20 WHERE id = %s", (matching_actor,))
    restarted = BillingService(PostgresStore(store.database_url))
    first = await restarted.charge_matching_run(run_id, "-0.10", "3D_MATCH")
    second = await restarted.charge_matching_run(run_id, "-0.10", "3D_MATCH")
    assert first["transaction"]["id"] == second["transaction"]["id"]
    assert second["current_balance"] == 0.10


@pytest.mark.anyio
async def test_deleted_actor_blocks_matching_instead_of_recreating_a_free_credit_user(stored_matching_pair, matching_actor):
    store, candidate_id, _ = stored_matching_pair
    run_id = await import_run(store, candidate_id, matching_actor)
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        await connection.execute("DELETE FROM users WHERE id = %s", (matching_actor,))
    with pytest.raises(HTTPException) as blocked:
        await BillingService(store).charge_matching_run(run_id, "-0.10", "3D_MATCH")
    assert blocked.value.status_code == 409
    run = await store.get_matching_run(run_id)
    assert run is not None and run["error_code"] == "missing_actor" and run["stage"] == "blocked_credits"
    assert await store.get_matching_actor(matching_actor) is None


@pytest.mark.anyio
@pytest.mark.parametrize("invalid", [True, 0, "fraction"])
async def test_matching_actor_rejects_noncanonical_token_user_ids(stored_matching_pair, matching_actor, invalid):
    store, _, _ = stored_matching_pair
    value = matching_actor + 0.5 if invalid == "fraction" else invalid
    request, _ = signed_request({"id": value})
    with pytest.raises(HTTPException) as denied:
        await BillingService(store, jwt_secret=_TEST_SECRET).actor_for_request(request)
    assert denied.value.status_code == 401
