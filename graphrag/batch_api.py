from __future__ import annotations

from uuid import UUID
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from plugins.billing.service import BillingService
from services.postgres_store import PostgresStore


RunStage = Literal[
    "queued", "preparing", "matching", "blocked_credits", "completed",
    "completed_with_errors", "needs_review", "failed",
]
PairStatus = Literal[
    "pending", "running", "computed", "cached", "shared", "failed", "skipped",
    "preparation_required", "needs_review",
]
PageLimit = Annotated[int, Query(ge=1, le=100)]


class BatchRetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pairIds: list[Annotated[int, Field(strict=True, gt=0, le=9223372036854775807)]] = Field(min_length=1, max_length=100)
    confirmUncertain: StrictBool = False


_PUBLIC_ERROR_CODES = frozenset({
    "source_deleted", "source_changed", "missing_actor", "insufficient_credits",
    "missing_job_skills", "graph_source_missing", "graph_preparation_failed", "preparation_failed",
    "pair_matching_failed", "request_failed", "evaluation_failed", "uncertain_provider_result", "retry_not_selected",
})


def public_matching_error(code: str | None) -> str | None:
    if code is None:
        return None
    return code if code in _PUBLIC_ERROR_CODES else "matching_failed"


def create_batch_router(postgres_store: PostgresStore) -> APIRouter:
    router = APIRouter(prefix="/admin/batches", tags=["Batchverarbeitung"])
    billing = BillingService(postgres_store)

    @router.post("/{run_id}/retry")
    async def batch_retry(run_id: UUID, payload: BatchRetryRequest, request: Request):
        actor = await billing.require_matching_admin(request)
        try:
            result = await postgres_store.retry_matching_pairs(
                str(run_id), payload.pairIds, actor_user_id=actor.user_id, confirm_uncertain=payload.confirmUncertain,
            )
        except PermissionError as error:
            raise HTTPException(status_code=403, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if result is None:
            raise HTTPException(status_code=404, detail="Matching run not found")
        return result

    async def summary(run: dict[str, Any]) -> dict[str, Any]:
        run["errorCode"] = public_matching_error(run["errorCode"])
        counters = await postgres_store.get_matching_run_progress(str(run["runId"]))
        run["updatedAt"] = counters["updatedAt"]
        return {"run": run, "counters": counters}

    @router.get("")
    async def batch_list(
        request: Request, status: RunStage | None = None,
        source: Annotated[str | None, Query(min_length=1, max_length=255)] = None,
        cursor: UUID | None = None, limit: PageLimit = 25,
    ):
        await billing.require_matching_admin(request)
        try:
            page = await postgres_store.list_matching_batches(
                status=status, source=source, cursor=str(cursor) if cursor is not None else None, limit=limit,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {"items": [await summary(run) for run in page["items"]], "nextCursor": page["nextCursor"]}

    @router.get("/{run_id}")
    async def batch_detail(
        run_id: UUID, request: Request,
        pair_status: Annotated[PairStatus | None, Query(alias="pairStatus")] = None,
        cursor: Annotated[int | None, Query(ge=1, le=9223372036854775807)] = None,
        limit: PageLimit = 25,
    ):
        await billing.require_matching_admin(request)
        run = await postgres_store.get_matching_batch_run(str(run_id))
        if run is None:
            raise HTTPException(status_code=404, detail="Matching run not found")
        try:
            page = await postgres_store.list_matching_batch_pairs(
                str(run_id), status=pair_status, cursor=cursor, limit=limit,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        pairs = []
        for row in page["items"]:
            payload = row["result_payload"] if row["disposition"] in {"computed", "cached", "shared"} else None
            if payload is not None:
                payload = {**payload, "cacheStatus": "computed" if row["disposition"] == "computed" else "hit"}
            pairs.append({
                "pairId": row["id"], "candidateId": str(row["candidate_id"]) if row["candidate_id"] is not None else None,
                "jobId": str(row["job_id"]) if row["job_id"] is not None else None,
                "method": row["method"], "status": row["disposition"], "evaluationId": row["evaluation_id"],
                "errorCode": public_matching_error(row["error_code"]), "updatedAt": row["updated_at"],
                "matchedAt": payload.get("matchedAt") if payload is not None else None, "resultPayload": payload,
            })
        return {**await summary(run), "pairs": pairs, "nextCursor": page["nextCursor"]}

    return router
