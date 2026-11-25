from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, Literal, get_type_hints
from uuid import UUID, uuid4

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, TypeAdapter

from config import settings
from models import MatchingCandidateInput, MatchingJobInput, MatchingPendingResponse, VectorMatchRequest
from plugins.billing.service import BillingService
from services.db import Neo4jService
from services.matching_cache import MatchingLeaseLostError, MatchingPairPlan, MatchingPendingError, normalize_matching_data
from services.matching_orchestrator import MatchingOrchestrator, normalize_skill_entries
from services.postgres_store import MatchingPreparationChangedError, PostgresStore


logger = logging.getLogger(__name__)
MATCHING_REQUEST_WAIT_SECONDS = 10
MATCHING_IMPORT_BLOCK_SIZE = 25
MATCHING_RUN_HEARTBEAT_SECONDS = 20


class ImportPreparationError(RuntimeError):
    pass


class MatchingImportWorker:
    def __init__(self, store: PostgresStore) -> None:
        self.store = store
        self.billing = BillingService(store)
        self._tasks: dict[str, asyncio.Task] = {}
        self._active: set[str] = set()
        self._slots = asyncio.Semaphore(2)
        self._worker: asyncio.Task | None = None
        self._process_run: Callable[[str], Awaitable[dict[str, Any] | None]] | None = None
        self._stopping = False

    async def expand(self, run_id: str, owner: str) -> dict[str, Any] | None:
        run = await self.store.claim_matching_import(run_id, owner)
        if run is None:
            return None
        return await self.store.expand_matching_import(run_id, owner)

    async def process(
        self, run_id: str, *, db_service: Neo4jService, orchestrator: MatchingOrchestrator,
        prepare_candidate: Callable[[int], Awaitable[tuple[str, int]]],
        prepare_job: Callable[[int], Awaitable[tuple[str, int]]],
    ) -> dict[str, Any] | None:
        owner = str(uuid4())
        run = await self.expand(run_id, owner)
        if run is None or run["stage"] != "matching":
            return run

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(MATCHING_RUN_HEARTBEAT_SECONDS)
                await self.store.heartbeat_matching_request(run_id, owner)

        async def ready(kind: Literal["candidate", "job"], entity_id: int) -> dict[str, Any]:
            snapshot = await self.store.matching_source_snapshot(kind, entity_id)
            if snapshot["prepared_revision"] != snapshot["revision"]:
                await self.store.set_matching_import_stage(run_id, owner, "preparing")
                await (prepare_candidate if kind == "candidate" else prepare_job)(entity_id)
                snapshot = await self.store.matching_source_snapshot(kind, entity_id)
            if snapshot["prepared_revision"] != snapshot["revision"]:
                raise MatchingPreparationChangedError("Quelle ist nach Aufbereitung nicht aktuell.")
            return snapshot

        async def process_pairs() -> None:
            if run["actor_user_id"] is None or await self.store.get_matching_actor(run["actor_user_id"]) is None:
                await self.store.release_unbilled_matching_claims(run_id)
                await self.store.block_matching_run(run_id, "missing_actor")
                raise HTTPException(status_code=409, detail="Matching actor no longer exists")
            cursor = 0
            charged = False
            pending = False
            while targets := await self.store.list_matching_import_targets(
                run_id, owner, after_id=cursor, limit=MATCHING_IMPORT_BLOCK_SIZE,
            ):
                for target in targets:
                    try:
                        candidate = await ready("candidate", target["candidate_id"])
                        job = await ready("job", target["job_id"])
                        jobs = await db_service.get_jobs_for_vectormatch([job["row"]["uuid"]])
                        candidates = await db_service.get_candidates_for_vectormatch([candidate["row"]["uuid"]])
                        if len(jobs) != 1 or len(candidates) != 1:
                            raise ImportPreparationError("graph_source_missing")
                        if not normalize_skill_entries(jobs[0].get("required_skills")):
                            raise ImportPreparationError("missing_job_skills")
                        await self.store.set_matching_import_stage(run_id, owner, "matching")
                    except MatchingLeaseLostError:
                        raise
                    except Exception as error:
                        logger.warning("Import preparation failed: run=%s pair=%s", run_id, target["id"], exc_info=True)
                        await self.store.mark_matching_import_pair_error(
                            run_id, owner, target["id"], disposition="preparation_required",
                            error_code=str(error) if isinstance(error, ImportPreparationError) else (
                                "source_changed" if isinstance(error, MatchingPreparationChangedError)
                                else "graph_preparation_failed"
                            ),
                        )
                        continue

                    async def validate_inputs(_plan: MatchingPairPlan) -> None:
                        await self.store.heartbeat_matching_request(run_id, owner)
                        for snapshot in (candidate, job):
                            current = await self.store.matching_source_snapshot(
                                snapshot["entity_type"], snapshot["entity_id"],
                            )
                            if current["revision"] != snapshot["revision"] or current["prepared_revision"] != current["revision"]:
                                raise MatchingPreparationChangedError("Quelle wurde vor der Paarbewertung geaendert.")

                    async def on_plan(plans: list[MatchingPairPlan]) -> None:
                        nonlocal charged
                        await self.store.attach_matching_run_pairs(run_id, plans, run_owner=owner)
                        try:
                            await validate_inputs(plans[0])
                            if not charged and any(plan.owns_computation for plan in plans):
                                try:
                                    await self.billing.charge_matching_run(run_id, "-0.10", "3D_MATCH", note=run["source"])
                                except HTTPException:
                                    await self.store.release_unbilled_matching_claims(run_id)
                                    raise
                                charged = True
                        except Exception:
                            for plan in plans:
                                if plan.owns_computation:
                                    await self.store.fail_matching_evaluation(
                                        plan.evaluation["id"], plan.lease_owner, plan.evaluation["fence"],
                                    )
                            raise

                    try:
                        await orchestrator.match_skill_matrix(
                            [MatchingJobInput.model_validate({**jobs[0], "id": target["job_id"]})],
                            [MatchingCandidateInput.model_validate({**candidates[0], "id": target["candidate_id"]})],
                            model=settings.resolved_embedding_model, run_id=run_id,
                            on_plan=on_plan, before_model_call=validate_inputs,
                        )
                    except MatchingPendingError:
                        pending = True
                    except (HTTPException, MatchingLeaseLostError):
                        raise
                    except MatchingPreparationChangedError:
                        logger.exception("Import inputs changed: run=%s pair=%s", run_id, target["id"])
                        await self.store.mark_matching_import_pair_error(
                            run_id, owner, target["id"], disposition="preparation_required", error_code="source_changed",
                        )
                    except Exception:
                        logger.exception("Import pair matching failed: run=%s pair=%s", run_id, target["id"])
                        await self.store.mark_matching_import_pair_error(
                            run_id, owner, target["id"], disposition="failed", error_code="pair_matching_failed",
                        )
                cursor = targets[-1]["id"]
            if pending:
                await self.store.release_matching_request(run_id, owner)
            else:
                await self.store.complete_matching_request(run_id, owner, {})

        keeper = asyncio.create_task(heartbeat())
        work = asyncio.create_task(process_pairs())
        try:
            done, _ = await asyncio.wait((keeper, work), return_when=asyncio.FIRST_COMPLETED)
            if keeper in done:
                await keeper
            await work
        except MatchingPendingError:
            await self.store.release_matching_request(run_id, owner)
        except MatchingLeaseLostError:
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)
            await self.store.interrupt_matching_request(run_id, owner)
            logger.warning("Import worker lease lost: run=%s; original run will be recovered", run_id)
        except asyncio.CancelledError:
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)
            await self.store.interrupt_matching_request(run_id, owner)
            raise
        except Exception:
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)
            await self.store.fail_matching_request(run_id, owner)
            raise
        finally:
            keeper.cancel()
            await asyncio.gather(keeper, return_exceptions=True)
        return await self.store.get_matching_run(run_id)

    async def resume(self) -> None:
        if self._stopping:
            return
        if self._process_run is None:
            raise RuntimeError("Import worker has not been configured")
        for run_id in await self.store.list_recoverable_matching_imports():
            if run_id in self._tasks:
                continue
            task = asyncio.create_task(self._process_run(run_id))
            self._tasks[run_id] = task

            def finished(completed: asyncio.Task, claimed_run_id: str = run_id) -> None:
                self._tasks.pop(claimed_run_id, None)
                if not completed.cancelled() and (error := completed.exception()) is not None:
                    logger.error("Matching import %s failed", claimed_run_id, exc_info=(type(error), error, error.__traceback__))

            task.add_done_callback(finished)

    async def start(
        self, *, db_service: Neo4jService, orchestrator: MatchingOrchestrator,
        prepare_candidate: Callable[[int], Awaitable[tuple[str, int]]],
        prepare_job: Callable[[int], Awaitable[tuple[str, int]]],
    ) -> None:
        if self._worker is not None:
            return
        self._stopping = False

        async def execute(run_id: str) -> dict[str, Any] | None:
            async with self._slots:
                if self._stopping:
                    return None
                self._active.add(run_id)
                try:
                    return await self.process(
                        run_id, db_service=db_service, orchestrator=orchestrator,
                        prepare_candidate=prepare_candidate, prepare_job=prepare_job,
                    )
                finally:
                    self._active.discard(run_id)

        self._process_run = execute
        await self.resume()

        async def work() -> None:
            while True:
                await asyncio.sleep(3)
                try:
                    await self.resume()
                except Exception:
                    logger.exception("Matching import recovery failed; retrying next interval")

        self._worker = asyncio.create_task(work())

    async def shutdown(self, *, timeout: float = 30) -> None:
        self._stopping = True
        if self._worker is not None:
            self._worker.cancel()
            await asyncio.gather(self._worker, return_exceptions=True)
            self._worker = None
        tasks = list(self._tasks.items())
        for run_id, task in tasks:
            if run_id not in self._active:
                task.cancel()
        if tasks:
            _, pending = await asyncio.wait([task for _, task in tasks], timeout=timeout)
            for task in pending:
                task.cancel()
            await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)
        self._process_run = None


def _request_references(arguments: dict[str, Any]) -> dict[str, list[str]]:
    references: dict[str, set[str]] = {"candidate_refs": set(), "job_refs": set()}

    def collect(value: Any) -> None:
        if not isinstance(value, dict):
            return
        for key, item in value.items():
            if key in {"job_id", "jobId"} and item is not None:
                references["job_refs"].add(str(item))
            elif key in {"candidate_id", "candidateId", "cvId"} and item is not None:
                references["candidate_refs"].add(str(item))
            elif key in {"job_ids", "jobIds", "cv_ids", "candidateIds", "cvIds"} and isinstance(item, list):
                references["job_refs" if key in {"job_ids", "jobIds"} else "candidate_refs"].update(map(str, item))
            elif key in {"jobs", "candidates"} and isinstance(item, list):
                references["job_refs" if key == "jobs" else "candidate_refs"].update(
                    str(row["id"]) for row in item if isinstance(row, dict) and row.get("id") is not None
                )
            elif key == "job" and isinstance(item, dict) and item.get("id") is not None:
                references["job_refs"].add(str(item["id"]))
            if isinstance(item, dict):
                collect(item)
            elif isinstance(item, list):
                for child in item:
                    collect(child)

    collect(arguments)
    return {key: sorted(values) for key, values in references.items()}


class MatchingRequestCoordinator:
    def __init__(self, store: PostgresStore | None) -> None:
        self.store = store
        self.billing = BillingService(store) if store is not None else None
        self._handlers: dict[str, Any] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._worker: asyncio.Task | None = None
        self._slots = asyncio.Semaphore(2)

    def endpoint(
        self, *, method: Literal["vector", "ai"], amount: str | None, action: str | None, selection: bool = False,
    ):
        def decorate(handler):
            self._handlers[handler.__name__] = handler

            @wraps(handler)
            async def wrapped(*args, **kwargs):
                bound = inspect.signature(handler).bind(*args, **kwargs)
                request = next(value for value in bound.arguments.values() if isinstance(value, Request))
                if getattr(request.state, "matching_run_id", None) is not None:
                    return await handler(*args, **kwargs)
                if self.store is None or self.billing is None:
                    raise HTTPException(status_code=503, detail="Matching services are not available")
                actor = await self.billing.actor_for_request(request)
                arguments = {
                    key: value.model_dump(mode="json", by_alias=True) if isinstance(value, BaseModel) else value
                    for key, value in bound.arguments.items() if not isinstance(value, Request)
                }
                context = normalize_matching_data({
                    "handler": handler.__name__, "arguments": arguments, **_request_references(arguments),
                })
                run_id = await self.store.create_matching_run(
                    actor_user_id=actor.user_id, source=request.url.path, method=method,
                    request_payload=context, tariff_amount=amount, tariff_action=action,
                    request_kind="interactive_selection" if selection else "interactive",
                )
                task = self._launch(run_id, selection=selection)
                done, _ = await asyncio.wait((task,), timeout=MATCHING_REQUEST_WAIT_SECONDS)
                if task in done:
                    result = await task
                    if result is not None:
                        return result
                pending = MatchingPendingResponse.model_validate(
                    await self.store.get_matching_pending_response(run_id),
                )
                return JSONResponse(status_code=202, content=pending.model_dump(mode="json"))

            return wrapped
        return decorate

    def on_plan(self, request: Request):
        run_id = request.state.matching_run_id
        charged = False

        async def planned(plans: list[MatchingPairPlan]) -> None:
            nonlocal charged
            if self.store is None or self.billing is None:
                raise RuntimeError("Matching billing service is not available")
            await self.store.attach_matching_run_pairs(run_id, plans, run_owner=request.state.matching_run_owner)
            if not charged and any(plan.owns_computation for plan in plans):
                try:
                    await self.billing.charge_matching_run(
                        run_id, request.state.matching_tariff_amount, request.state.matching_tariff_action,
                        note=request.url.path,
                    )
                except HTTPException:
                    await self.store.release_unbilled_matching_claims(run_id)
                    raise
                charged = True

        return planned

    async def skill_child(self, request: Request, job_id: int, candidate_ids: list[int], engine: str):
        if self.store is None:
            raise RuntimeError("Matching request needs PostgreSQL")
        retry_scope = await self.store.get_matching_retry_scope(request.state.matching_run_id)
        if retry_scope is not None and not any(
            key[0] == "vector" and key[2] == job_id and row["retry_selected"] for key, row in retry_scope.items()
        ):
            return None
        arguments = {"payload": VectorMatchRequest.model_validate({
            "jobIds": [job_id], "cvIds": candidate_ids, "engine": engine,
        }).model_dump(mode="json", by_alias=True)}
        run_id = await self.store.ensure_matching_child(
            request.state.matching_run_id, request.state.matching_run_owner, str(job_id),
            {"handler": "vector_match", "arguments": arguments, **_request_references(arguments)},
        )
        child = await self.store.get_matching_run(run_id)
        if child is None:
            raise RuntimeError("Matching child disappeared")
        if child["stage"] not in {"queued", "preparing", "matching"}:
            return None
        return self._launch(run_id)

    def _launch(self, run_id: str, *, selection: bool = False) -> asyncio.Task:
        if run_id in self._tasks:
            return self._tasks[run_id]
        task = asyncio.create_task(self._execute(run_id, selection=selection))
        self._tasks[run_id] = task

        def finished(completed: asyncio.Task) -> None:
            self._tasks.pop(run_id, None)
            if not completed.cancelled() and (error := completed.exception()) is not None:
                logger.error("Matching request %s failed", run_id, exc_info=(type(error), error, error.__traceback__))

        task.add_done_callback(finished)
        return task

    async def _execute(self, run_id: str, *, selection: bool = False):
        if selection:
            return await self._execute_claimed(run_id)
        async with self._slots:
            return await self._execute_claimed(run_id)

    async def _execute_claimed(self, run_id: str):
        if self.store is None:
            raise RuntimeError("Matching request needs PostgreSQL")
        owner = str(uuid4())
        run = await self.store.claim_matching_request(run_id, owner)
        if run is None:
            return None

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(MATCHING_RUN_HEARTBEAT_SECONDS)
                await self.store.heartbeat_matching_request(run_id, owner)

        keeper = asyncio.create_task(heartbeat())
        computation: asyncio.Task | None = None
        try:
            if run["actor_user_id"] is None or await self.store.get_matching_actor(run["actor_user_id"]) is None:
                await self.store.block_matching_run(run_id, "missing_actor")
                raise HTTPException(status_code=409, detail="Matching actor no longer exists")
            context = run["request_payload"]
            handler = self._handlers.get(context["handler"])
            if handler is None:
                raise RuntimeError("Saved matching handler is not available")
            annotations = get_type_hints(handler)
            arguments = {
                key: TypeAdapter(annotations[key]).validate_python(value)
                for key, value in context["arguments"].items()
            }
            if context["handler"] in {"ki_match_pairs", "vector_match_selected"}:
                await self.store.prepare_matching_selection_targets(run_id, [
                    (str(pair.job_id).strip(), str(pair.candidate_id).strip()) for pair in arguments["payload"].pairs
                ], run_owner=owner, method=run["method"])
            request = Request({
                "type": "http", "method": "POST", "scheme": "http", "path": run["source"],
                "headers": [], "server": ("matching-worker", 80), "query_string": b"",
            })
            request.state.matching_run_id = run_id
            request.state.matching_run_owner = owner
            request.state.matching_tariff_amount = run["tariff_amount"]
            request.state.matching_tariff_action = run["tariff_action"]
            request.state.matching_on_plan = self.on_plan(request)
            arguments["request"] = request
            computation = asyncio.create_task(handler(**arguments))
            done, _ = await asyncio.wait((keeper, computation), return_when=asyncio.FIRST_COMPLETED)
            if keeper in done:
                await keeper
            result = (await computation).model_copy(update={
                "runId": UUID(run_id), "statusUrl": f"/matching/runs/{run_id}",
            })
            await self.store.complete_matching_request(
                run_id, owner, result.model_dump(mode="json"),
                has_errors=bool(getattr(result, "failedCount", 0)),
            )
            return result
        except MatchingPendingError:
            await self.store.release_matching_request(run_id, owner)
            return None
        except MatchingLeaseLostError:
            if computation is not None:
                computation.cancel()
                await asyncio.gather(computation, return_exceptions=True)
            await self.store.interrupt_matching_request(run_id, owner)
            logger.warning("Matching request lease lost: run=%s; original run will be recovered", run_id)
            return None
        except asyncio.CancelledError:
            if computation is not None:
                computation.cancel()
                await asyncio.gather(computation, return_exceptions=True)
            await self.store.interrupt_matching_request(run_id, owner)
            raise
        except Exception:
            if computation is not None:
                computation.cancel()
                await asyncio.gather(computation, return_exceptions=True)
            await self.store.fail_matching_request(run_id, owner)
            raise
        finally:
            keeper.cancel()
            if computation is not None:
                computation.cancel()
                await asyncio.gather(computation, return_exceptions=True)
            await asyncio.gather(keeper, return_exceptions=True)

    async def resume(self) -> None:
        if self.store is None:
            return
        for run_id in await self.store.list_recoverable_matching_requests():
            run = await self.store.get_matching_run(run_id)
            if run is not None:
                self._launch(run_id, selection=run["request_kind"] == "interactive_selection")

    async def start(self) -> None:
        if self._worker is not None:
            return
        await self.resume()

        async def work() -> None:
            while True:
                await asyncio.sleep(3)
                try:
                    await self.resume()
                except Exception:
                    logger.exception("Matching request recovery failed; retrying next interval")

        self._worker = asyncio.create_task(work())

    async def shutdown(self, *, timeout: float = 30) -> None:
        if self._worker is not None:
            self._worker.cancel()
            await asyncio.gather(self._worker, return_exceptions=True)
            self._worker = None
        tasks = list(self._tasks.values())
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=timeout)
            for task in pending:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
