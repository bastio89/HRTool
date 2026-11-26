from __future__ import annotations

import re
import json
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Protocol, runtime_checkable

import psycopg

from models import KiMatchPairResult, LLMRerankResponse, MatchingCandidateInput, MatchingJobInput
from services.postgres_store import PostgresStore
from services.skill_matching import EmbeddingProvider, RequiredSkill, SkillMatchingResult, SkillMatchingService, SkillPriority
from services.esco_catalog import normalize_alias
from services.matching_cache import (
    MatchingInputSnapshot, MatchingPairCache, MatchingPairPlan, MatchingPendingError, SCORING_VERSION,
)


@dataclass(frozen=True)
class PreparedSkill:
    name: str
    priority: SkillPriority
    category: str | None


def normalize_skill_entries(
    value: object,
    *,
    required: bool = True,
) -> list[PreparedSkill]:
    if value is None:
        return []
    if isinstance(value, str):
        items = [part.strip() for part in re.split(r"[,;\n|]+", value) if part.strip()]
    elif isinstance(value, dict):
        items = [value]
    elif isinstance(value, list):
        items = value
    else:
        raise ValueError("Skills muessen als Liste, Skillobjekt oder getrennte Skillnamen vorliegen.")

    skills: list[PreparedSkill] = []
    for item in items:
        if isinstance(item, str):
            name, priority, category = item, None, "HardSkill"
        elif isinstance(item, dict):
            name = next(
                (item[key] for key in ("name", "label", "title", "skill", "value") if item.get(key)),
                None,
            )
            priority = item.get("priority", item.get("importance"))
            category = item.get("category", "HardSkill")
        else:
            raise ValueError("Jeder Skill muss einen Skillnamen enthalten.")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Skill-Namen duerfen nicht leer sein.")
        if category is not None and not isinstance(category, str):
            raise ValueError("Skill-Kategorie muss eine Zeichenkette sein.")
        normalized_priority: SkillPriority = "mandatory"
        if required and priority is not None:
            if priority in ("Mandatory", "mandatory"):
                normalized_priority = "mandatory"
            elif priority in ("NiceToHave", "nice_to_have"):
                normalized_priority = "nice_to_have"
            else:
                raise ValueError(f"Unbekannte Skill-Prioritaet: {priority!r}.")
        skills.append(PreparedSkill(name.strip(), normalized_priority, category))
    return skills


@dataclass(frozen=True)
class SkillAssessment:
    result: SkillMatchingResult
    categories: dict[str, SkillMatchingResult]
    requirements: tuple[PreparedSkill, ...]
    method: Literal["vector"] = "vector"


class AiRanker(Protocol):
    chat_model: str

    async def rerank_candidates(
        self, job_profile: dict[str, Any], candidates: list[dict[str, Any]],
    ) -> LLMRerankResponse: ...


@runtime_checkable
class MatchingRuntimeProvider(AiRanker, EmbeddingProvider, Protocol):
    embedding_model: str
    before_model_call: Callable[[], Awaitable[None]] | None

    async def freeze_matching(
        self, method: Literal["vector", "ai"], *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> tuple[MatchingRuntimeProvider, dict[str, Any]]: ...


@dataclass(frozen=True)
class FrozenMatchingCatalog:
    concepts_json: str

    async def get_esco_concepts_for_aliases(self, aliases: list[str]) -> list[dict[str, Any]]:
        return json.loads(self.concepts_json)


class MatchingOrchestrator:
    def __init__(
        self,
        skill_service: SkillMatchingService,
        *,
        postgres_store: PostgresStore | None = None,
        llm_service: AiRanker | None = None,
    ) -> None:
        self.skill_service = skill_service
        self.postgres_store = postgres_store
        self.llm_service = llm_service

    async def match_skills(self, required_skills: object, candidate_skills: object) -> SkillAssessment:
        requirements = normalize_skill_entries(required_skills)
        if not requirements:
            raise ValueError("Job-Skills fehlen: strukturierte Anforderungen vor dem Matching aufbereiten.")
        candidates = normalize_skill_entries(candidate_skills, required=False)
        has_skills = [skill.name for skill in candidates]
        has_skill_categories = [skill.category for skill in candidates]

        async def compare(skills: list[PreparedSkill]) -> SkillMatchingResult:
            return await self.skill_service.match(
                [RequiredSkill(skill.name, skill.priority, skill.category) for skill in skills],
                has_skills,
                has_skill_categories=has_skill_categories,
            )

        result = await compare(requirements)
        categories: dict[str, SkillMatchingResult] = {}
        for category in ("HardSkill", "SoftSkill"):
            subset = [skill for skill in requirements if skill.category == category]
            if subset:
                categories[category] = await compare(subset)
        return SkillAssessment(result, categories, tuple(requirements))

    async def match_skill_matrix(
        self,
        jobs: list[MatchingJobInput],
        candidates: list[MatchingCandidateInput],
        *,
        model: str,
        engine: str = "python",
        run_id: str | None = None,
        on_plan: Callable[[list[MatchingPairPlan]], Awaitable[None]] | None = None,
        before_model_call: Callable[[MatchingPairPlan], Awaitable[None]] | None = None,
    ) -> tuple[list[dict[str, Any]], datetime]:
        store = self.postgres_store
        if store is None:
            raise RuntimeError("Produktives Skill-Matching benoetigt PostgreSQL-Paarpersistenz.")
        started_at = datetime.now(timezone.utc)
        if any(job.id is None or not str(job.id).strip() for job in jobs):
            raise ValueError("Produktives Matching benoetigt gespeicherte Job-IDs.")
        job_ids = await store.matching_ids_for("jobs", [str(job.id) for job in jobs])
        candidate_ids = await store.matching_ids_for("candidates", [str(candidate.id) for candidate in candidates])
        retry_scope = await store.get_matching_retry_scope(run_id) if run_id is not None else None

        def selected(job, candidate) -> bool:
            if retry_scope is None:
                return True
            row = retry_scope.get(("vector", candidate_ids[str(candidate.id)], job_ids[str(job.id)]))
            return row is not None and row["retry_selected"]

        for job in jobs:
            if any(selected(job, candidate) for candidate in candidates) and not normalize_skill_entries(job.required_skills):
                raise ValueError(f"Job {job.id}: strukturierte Anforderungen vor dem Matching aufbereiten.")
        for candidate in candidates:
            if any(selected(job, candidate) for job in jobs):
                normalize_skill_entries(
                    candidate.has_skill if candidate.has_skill is not None else candidate.skills, required=False,
                )
        provider = self.skill_service.llm_service
        if not isinstance(provider, MatchingRuntimeProvider):
            raise RuntimeError("Produktives Matching benoetigt eingefrorene Modell-Snapshots.")
        cache = MatchingPairCache(store)
        planned: list[tuple[MatchingPairPlan, MatchingRuntimeProvider, str, str]] = []
        replayed: list[dict[str, Any]] = []
        replay_failed = False
        for job in jobs:
            for candidate in candidates:
                if not selected(job, candidate):
                    saved = retry_scope.get(("vector", candidate_ids[str(candidate.id)], job_ids[str(job.id)])) if retry_scope is not None else None
                    if saved is not None:
                        if saved["disposition"] in {"computed", "cached", "shared"}:
                            replayed.append({
                                **saved["result_payload"], "evaluationId": saved["evaluation_id"],
                                "cacheStatus": "computed" if saved["disposition"] == "computed" else "hit",
                                "jobId": str(job.id), "candidateId": str(candidate.id),
                            })
                        else:
                            replay_failed = True
                    continue
                payload = {
                    "job": {"title": job.title, "required_skills": [
                        asdict(skill) for skill in normalize_skill_entries(job.required_skills)
                    ]},
                    "candidate": {"name": candidate.name, "skills": [
                        asdict(skill) for skill in normalize_skill_entries(
                            candidate.has_skill if candidate.has_skill is not None else candidate.skills,
                            required=False,
                        )
                    ]},
                }
                frozen, config = await provider.freeze_matching("vector")
                config.update(
                    cutoff=self.skill_service.similarity_cutoff, scoring_version=SCORING_VERSION,
                    esco_snapshot=await self._catalog_snapshot(payload),
                )
                pg_candidate_id = candidate_ids[str(candidate.id)]
                pg_job_id = job_ids[str(job.id)]
                stored_candidate, stored_job = await store.get_matching_pair_content(pg_candidate_id, pg_job_id)
                snapshot = MatchingInputSnapshot.create(
                    "vector", pg_candidate_id, pg_job_id, candidate=stored_candidate, job=stored_job,
                    payload=payload, configuration=config,
                )
                planned.append((await cache.plan(snapshot, run_id=run_id), frozen, str(job.id), str(candidate.id)))

        if on_plan is not None and planned:
            await on_plan([entry[0] for entry in planned])

        rows: list[dict[str, Any]] = replayed
        pending: list[int] = []
        for plan, frozen, requested_job_id, requested_candidate_id in planned:
            payload = plan.snapshot.payload
            current_concepts = plan.snapshot.model_snapshot["esco_snapshot"]

            async def mark_started() -> None:
                if before_model_call is not None:
                    await before_model_call(plan)
                await store.mark_matching_model_started(
                    plan.evaluation["id"], plan.lease_owner, plan.evaluation["fence"],
                )

            frozen.before_model_call = mark_started

            async def evaluate() -> dict[str, Any]:
                nonlocal current_concepts
                scorer = MatchingOrchestrator(SkillMatchingService(
                    frozen, FrozenMatchingCatalog(json.dumps(plan.snapshot.model_snapshot["esco_snapshot"])),
                    similarity_cutoff=plan.snapshot.model_snapshot["cutoff"],
                ))
                assessment = await scorer.match_skills(payload["job"]["required_skills"], payload["candidate"]["skills"])
                result = self._skill_result_row(assessment, plan.snapshot, frozen.embedding_model)
                current_concepts = await self._catalog_snapshot(payload)
                return result

            async def refresh(connection, current_candidate, current_job) -> MatchingInputSnapshot:
                _, config = await provider.freeze_matching("vector", connection=connection)
                config.update(
                    cutoff=self.skill_service.similarity_cutoff, scoring_version=SCORING_VERSION,
                    esco_snapshot=current_concepts,
                )
                return MatchingInputSnapshot.create(
                    "vector", plan.snapshot.candidate_id, plan.snapshot.job_id, candidate=current_candidate,
                    job=current_job, payload=payload, configuration=config,
                )

            try:
                result_row = await cache.execute(plan, evaluate, refresh, engine=engine)
                rows.append({**result_row, "jobId": requested_job_id, "candidateId": requested_candidate_id})
            except MatchingPendingError as error:
                pending.extend(error.evaluation_ids)
        if pending:
            raise MatchingPendingError(pending, available_results=rows)
        if replay_failed:
            raise RuntimeError("Nicht ausgewaehlte Paarungen sind weiterhin unvollstaendig.")
        rows.sort(key=lambda row: row["score"], reverse=True)
        return rows, started_at

    async def _catalog_snapshot(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        aliases = sorted({normalize_alias(skill["name"]) for skill in [
            *payload["job"]["required_skills"], *payload["candidate"]["skills"],
        ]})
        concepts = await self.skill_service.db_service.get_esco_concepts_for_aliases(aliases)
        return sorted([{
            key: sorted(value) if key == "aliases" else value
            for key, value in concept.items()
            if key in {"uri", "preferred_label", "description", "release", "aliases"}
        } for concept in concepts], key=lambda concept: str(concept["uri"]))

    @staticmethod
    def _skill_result_row(
        assessment: SkillAssessment, snapshot: MatchingInputSnapshot, model: str,
    ) -> dict[str, Any]:
        payload = snapshot.payload
        job, candidate = payload["job"], payload["candidate"]
        result = assessment.result
        candidate_categories = {skill["name"]: skill["category"] for skill in candidate["skills"]}
        return {
            "method": "vector", "qualified": result.qualified,
            "jobId": str(snapshot.job_id), "jobTitle": job["title"],
            "candidateId": str(snapshot.candidate_id), "candidateName": candidate["name"],
            "score": result.score, "vectorScore": result.score / 100,
            "hardSkillScore": assessment.categories["HardSkill"].score / 100 if "HardSkill" in assessment.categories else 0.0,
            "softSkillScore": assessment.categories["SoftSkill"].score / 100 if "SoftSkill" in assessment.categories else 0.0,
            "strengths": [f"{match.need_skill} -> {match.has_skill}" for match in result.matches if match.covered],
            "weaknesses": [f"{match.need_skill}: {match.reason}" for match in result.missing_skills],
            "summary": (
                f"{candidate['name'] or snapshot.candidate_id} deckt {sum(match.covered for match in result.matches)}/"
                f"{len(result.matches)} erforderliche Skills fuer {job['title'] or snapshot.job_id} ab."
            ),
            "matchedSkills": [{
                **asdict(match), "jobSkill": match.need_skill, "candidateSkill": match.has_skill,
                "jobSkillCategory": requirement.category,
                "candidateSkillCategory": candidate_categories.get(match.has_skill) if match.has_skill else None,
            } for match, requirement in zip(result.matches, assessment.requirements)],
            "model": model, "matchedAt": datetime.now(timezone.utc).isoformat(),
        }

    async def match_ai_pair(
        self, job_id: str, candidate_id: str, *, run_id: str | None = None,
        on_plan: Callable[[list[MatchingPairPlan]], Awaitable[None]] | None = None,
    ) -> KiMatchPairResult:
        store = self.postgres_store
        provider = self.llm_service
        if store is None or not isinstance(provider, MatchingRuntimeProvider):
            raise RuntimeError("AI-Matching benoetigt PostgreSQL und den AI-Dienst.")
        job_ids = await store.matching_ids_for("jobs", [job_id])
        candidate_ids = await store.matching_ids_for("candidates", [candidate_id])
        pg_candidate_id, pg_job_id = candidate_ids[candidate_id], job_ids[job_id]
        retry_scope = await store.get_matching_retry_scope(run_id) if run_id is not None else None
        if retry_scope is not None:
            saved = retry_scope.get(("ai", pg_candidate_id, pg_job_id))
            if saved is None or not saved["retry_selected"]:
                if saved is None or saved["disposition"] not in {"computed", "cached", "shared"}:
                    raise ValueError("Nicht ausgewaehlte Paarung ist weiterhin unvollstaendig.")
                return KiMatchPairResult.model_validate({
                    **saved["result_payload"], "evaluationId": saved["evaluation_id"],
                    "cacheStatus": "computed" if saved["disposition"] == "computed" else "hit",
                    "jobId": job_id, "candidateId": candidate_id,
                })
        candidate, job = await store.get_matching_pair_content(pg_candidate_id, pg_job_id)
        payload = self._ai_payload(candidate, job, pg_candidate_id, pg_job_id)
        frozen, config = await provider.freeze_matching("ai")
        snapshot = MatchingInputSnapshot.create(
            "ai", pg_candidate_id, pg_job_id, candidate=candidate, job=job, payload=payload, configuration=config,
        )
        cache = MatchingPairCache(store)
        plan = await cache.plan(snapshot, run_id=run_id)
        if on_plan is not None:
            await on_plan([plan])

        async def mark_started() -> None:
            await store.mark_matching_model_started(plan.evaluation["id"], plan.lease_owner, plan.evaluation["fence"])

        frozen.before_model_call = mark_started

        async def evaluate() -> dict[str, Any]:
            ranked = await frozen.rerank_candidates(payload["job_profile"], payload["candidates"])
            if len(ranked.ranked_candidates) != 1 or ranked.ranked_candidates[0].candidate_id != str(pg_candidate_id):
                raise ValueError("AI-Antwort muss genau das ausgewaehlte gespeicherte Paar enthalten.")
            item = ranked.ranked_candidates[0]
            return KiMatchPairResult(
                jobId=str(pg_job_id), candidateId=str(pg_candidate_id), jobTitle=job.get("title"),
                candidateName=candidate.get("name"), score=item.score,
                strengths=item.strengths, weaknesses=item.weaknesses, summary=item.explanation,
                model=frozen.chat_model, matchedAt=datetime.now(timezone.utc),
            ).model_dump(mode="json")

        async def refresh(connection, current_candidate, current_job) -> MatchingInputSnapshot:
            _, current_config = await provider.freeze_matching("ai", connection=connection)
            return MatchingInputSnapshot.create(
                "ai", pg_candidate_id, pg_job_id, candidate=current_candidate, job=current_job,
                payload=self._ai_payload(current_candidate, current_job, pg_candidate_id, pg_job_id),
                configuration=current_config,
            )

        result_row = await cache.execute(plan, evaluate, refresh)
        return KiMatchPairResult.model_validate({**result_row, "jobId": job_id, "candidateId": candidate_id})

    @staticmethod
    def _ai_payload(
        candidate: dict[str, Any], job: dict[str, Any], candidate_id: int, job_id: int,
    ) -> dict[str, Any]:
        text = candidate.get("text")
        if text is None:
            raise ValueError(f"Gespeicherter Profiltext fuer Kandidat {candidate_id} fehlt.")
        return {
            "job_profile": {
                **(job.get("parsed_profile_json") or {}),
                **{key: job.get(key) for key in ("title", "description", "requirements", "raw_text", "location")},
                "id": str(job_id),
            },
            "candidates": [{
                **{key: value for key, value in (text.get("profile_json") or {}).items() if key != "birth_date"},
                "id": str(candidate_id), "name": candidate.get("name"), "raw_text": text["original_text"],
            }],
        }
