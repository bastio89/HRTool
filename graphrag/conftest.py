from copy import copy, deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest


@pytest.fixture
def matching_cache_doubles(monkeypatch):
    from plugins.billing.service import BillingService, BillingUserClaims

    def configure(store, llm, *, candidate=None, job=None):
        stored = {}
        claimed = {}
        runs = {}
        for method in (
            "matching_ids_for", "get_matching_pair_content", "get_cached_matching_evaluation",
            "claim_matching_evaluation", "complete_matching_evaluation", "heartbeat_matching_evaluation",
            "mark_matching_model_started", "fail_matching_evaluation",
            "create_matching_run", "attach_matching_run_pairs", "release_unbilled_matching_claims",
            "claim_matching_request", "heartbeat_matching_request", "complete_matching_request",
            "fail_matching_request", "interrupt_matching_request", "release_matching_request",
            "get_matching_pending_response", "list_recoverable_matching_requests", "get_matching_actor",
            "prepare_matching_selection_targets", "get_matching_retry_scope",
        ):
            monkeypatch.setattr(store, method, AsyncMock())

        async def create_run(**kwargs):
            run_id = str(uuid4())
            runs[run_id] = {"id": run_id, **kwargs}
            return run_id

        store.create_matching_run.side_effect = create_run
        store.claim_matching_request.side_effect = lambda run_id, owner: deepcopy(runs[run_id])
        store.get_matching_retry_scope.return_value = None
        store.get_matching_actor.return_value = {"id": 1}
        store.list_recoverable_matching_requests.return_value = []
        monkeypatch.setattr(BillingService, "actor_for_request", AsyncMock(
            return_value=BillingUserClaims(1, "test", None, None, "recruiter"),
        ))
        monkeypatch.setattr(BillingService, "charge_matching_run", AsyncMock())
        monkeypatch.setattr(llm, "chat_model", getattr(llm, "chat_model", "test-ai"), raising=False)
        monkeypatch.setattr(llm, "embedding_model", "test-embedding", raising=False)
        monkeypatch.setattr(llm, "before_model_call", None, raising=False)

        async def freeze(method, *, connection=None):
            return copy(llm), {
                "provider": "ollama", "base_url": "http://test",
                "model": llm.embedding_model if method == "vector" else llm.chat_model, "dimensions": 2,
            }

        async def read(snapshot):
            return deepcopy(stored.get(snapshot.fingerprint))

        async def claim(snapshot, owner, **kwargs):
            key = snapshot.fingerprint
            if key in stored:
                return {**stored[key], "disposition": "cached"}
            if key in claimed:
                return {**claimed[key], "disposition": "pending"}
            claimed[key] = {"id": len(claimed) + 1, "fence": 1, "disposition": "owned"}
            return dict(claimed[key])

        async def complete(snapshot, evaluation_id, owner, fence, payload, *, refresh_snapshot, engine):
            current_candidate, current_job = await store.get_matching_pair_content(snapshot.candidate_id, snapshot.job_id)
            current = await refresh_snapshot(None, current_candidate, current_job)
            assert current.fingerprint == snapshot.fingerprint
            row = {
                "id": evaluation_id, "status": "succeeded", "method": snapshot.method,
                "result_payload": deepcopy(payload), "model_snapshot": snapshot.model_snapshot,
            }
            stored[snapshot.fingerprint] = row
            return deepcopy(row)

        monkeypatch.setattr(llm, "freeze_matching", freeze, raising=False)
        store.matching_ids_for.side_effect = lambda table, values: {
            value: int(value) if value.isdigit() else index + 1 for index, value in enumerate(values)
        }
        store.get_matching_pair_content.side_effect = lambda candidate_id, job_id, **kwargs: (
            deepcopy(candidate) if candidate is not None else {"id": candidate_id},
            deepcopy(job) if job is not None else {"id": job_id},
        )
        store.get_cached_matching_evaluation.side_effect = read
        store.claim_matching_evaluation.side_effect = claim
        store.complete_matching_evaluation.side_effect = complete

    return configure
