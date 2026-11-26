from __future__ import annotations

import hashlib
import json
import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Literal
from uuid import uuid4

import psycopg

if TYPE_CHECKING:
    from services.postgres_store import PostgresStore
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


MatchingMethod = Literal["vector", "ai"]


class MatchingLeaseLostError(RuntimeError):
    pass


class MatchingPendingError(RuntimeError):
    def __init__(self, evaluation_ids: list[int], *, available_results: list[dict[str, Any]] | None = None) -> None:
        super().__init__("Matching-Paare werden bereits berechnet.")
        self.evaluation_ids = evaluation_ids
        self.available_results = available_results or []


class MatchingEvaluationError(RuntimeError):
    def __init__(self, evaluation_id: int, status: str) -> None:
        super().__init__(f"Matching-Evaluation {evaluation_id}: {status}")
        self.evaluation_id = evaluation_id
        self.status = status


SCORING_VERSION = "weighted-coverage-v3-one-to-one-category-guard"
_SECRETS = {
    "api_key", "apikey", "authorization", "access_token", "refresh_token",
    "jwt", "password", "password_hash", "secret", "token", "credentials",
}
_BOOKKEEPING = {
    "created_at", "updated_at", "matched_at", "last_accessed_at", "synced_at",
    "graph_synced_at", "logs", "access_log", "graph_candidate_id", "graph_candidate_ids",
    "graph_job_id",
}
_CONFIG_KEYS = {
    "vector": {
        "provider", "base_url", "model", "dimensions", "cutoff", "scoring_version", "esco_snapshot",
    },
    "ai": {
        "provider", "base_url", "model", "reasoning_level", "prompt", "prompt_version",
        "fixed_instruction", "json_instruction", "generation_parameters", "schema_version",
    },
}


def _key(value: str) -> str:
    return value.casefold().replace("-", "_")


def _public_url(value: str) -> str:
    parts = urlsplit(value)
    if not parts.hostname:
        raise ValueError("Matching-Modell benoetigt eine absolute Provider-URL.")
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    if parts.port is not None:
        host += f":{parts.port}"
    query = [(key, item) for key, item in parse_qsl(parts.query, keep_blank_values=True)
             if _key(key) not in _SECRETS | {"key"}]
    return urlunsplit((parts.scheme.lower(), host, parts.path.rstrip("/"), urlencode(sorted(query)), ""))


def normalize_matching_data(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: _public_url(item) if _key(key) == "base_url" and isinstance(item, str)
            else normalize_matching_data(item)
            for key, item in value.items()
            if _key(key) not in _SECRETS | _BOOKKEEPING
        }
    if isinstance(value, (list, tuple)):
        return [normalize_matching_data(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(normalize_matching_data(value), sort_keys=True, ensure_ascii=True,
                      separators=(",", ":"), allow_nan=False)


@dataclass(frozen=True)
class MatchingInputSnapshot:
    method: MatchingMethod
    candidate_id: int
    job_id: int
    canonical_json: str
    configuration_json: str

    @classmethod
    def create(
        cls,
        method: MatchingMethod,
        candidate_id: int,
        job_id: int,
        *,
        candidate: Mapping[str, Any],
        job: Mapping[str, Any],
        payload: Mapping[str, Any],
        configuration: Mapping[str, Any],
    ) -> MatchingInputSnapshot:
        if method not in _CONFIG_KEYS or candidate_id <= 0 or job_id <= 0:
            raise ValueError("Matching-Snapshot benoetigt eine Methode und kanonische PostgreSQL-IDs.")
        config = {key: value for key, value in configuration.items() if key in _CONFIG_KEYS[method]}
        configuration_json = _canonical_json(config)
        canonical_json = _canonical_json({
            "version": 1, "method": method, "candidate_id": candidate_id, "job_id": job_id,
            "candidate": candidate, "job": job, "payload": payload, "configuration": config,
        })
        return cls(method, candidate_id, job_id, canonical_json, configuration_json)

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(self.canonical_json.encode("utf-8")).hexdigest()

    @property
    def model_snapshot(self) -> dict[str, Any]:
        return json.loads(self.configuration_json)

    @property
    def payload(self) -> dict[str, Any]:
        return json.loads(self.canonical_json)["payload"]


@dataclass(frozen=True)
class MatchingPairPlan:
    snapshot: MatchingInputSnapshot
    lease_owner: str
    evaluation: dict[str, Any]

    @property
    def owns_computation(self) -> bool:
        return self.evaluation["disposition"] == "owned"


class MatchingPairCache:
    def __init__(self, store: PostgresStore) -> None:
        self.store = store

    async def plan(self, snapshot: MatchingInputSnapshot, *, run_id: str | None = None) -> MatchingPairPlan:
        owner = str(uuid4())
        cached = await self.store.get_cached_matching_evaluation(snapshot)
        if cached is not None:
            return MatchingPairPlan(snapshot, owner, {**cached, "disposition": "cached"})
        return MatchingPairPlan(
            snapshot, owner, await self.store.claim_matching_evaluation(snapshot, owner, owner_run_id=run_id),
        )

    async def execute(
        self,
        plan: MatchingPairPlan,
        evaluate: Callable[[], Awaitable[dict[str, Any]]],
        refresh_snapshot: Callable[
            [psycopg.AsyncConnection[Any], dict[str, Any], dict[str, Any]], Awaitable[MatchingInputSnapshot]
        ],
        *,
        engine: str = "python",
    ) -> dict[str, Any]:
        evaluation = plan.evaluation
        if plan.owns_computation:
            await self.store.heartbeat_matching_evaluation(evaluation["id"], plan.lease_owner, evaluation["fence"])
        if not plan.owns_computation:
            cached = evaluation if evaluation["disposition"] == "cached" else (
                await self.store.get_cached_matching_evaluation(plan.snapshot)
            )
            if cached is not None:
                return {**cached["result_payload"], "cacheStatus": "hit", "evaluationId": cached["id"]}
            if evaluation["disposition"] == "pending":
                raise MatchingPendingError([evaluation["id"]])
            raise MatchingEvaluationError(evaluation["id"], evaluation["disposition"])

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(20)
                await self.store.heartbeat_matching_evaluation(
                    evaluation["id"], plan.lease_owner, evaluation["fence"],
                )

        keeper = asyncio.create_task(heartbeat())
        computation = asyncio.create_task(evaluate())
        try:
            done, _ = await asyncio.wait((keeper, computation), return_when=asyncio.FIRST_COMPLETED)
            if keeper in done:
                await keeper
            payload = await computation
            completed = await self.store.complete_matching_evaluation(
                plan.snapshot, evaluation["id"], plan.lease_owner, evaluation["fence"], payload,
                refresh_snapshot=refresh_snapshot, engine=engine,
            )
            if completed["status"] != "succeeded":
                raise MatchingEvaluationError(evaluation["id"], completed["status"])
            return {**completed["result_payload"], "cacheStatus": "computed", "evaluationId": completed["id"]}
        except (Exception, asyncio.CancelledError):
            await self.store.fail_matching_evaluation(evaluation["id"], plan.lease_owner, evaluation["fence"])
            raise
        finally:
            keeper.cancel()
            computation.cancel()
            await asyncio.gather(keeper, computation, return_exceptions=True)
