from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, replace
from math import fsum, isfinite, sqrt
from typing import Any, Literal, Protocol

from services.esco_catalog import build_alias_index, normalize_alias, resolve_alias


class EmbeddingProvider(Protocol):
    async def create_embedding(
        self,
        payload: dict[str, Any],
        *,
        allow_fallback: bool = True,
    ) -> list[float]: ...


class EscoCatalog(Protocol):
    async def get_esco_concepts_for_aliases(self, aliases: list[str]) -> list[dict[str, Any]]: ...


@dataclass(frozen=True)
class ResolvedSkill:
    name: str
    normalized_name: str
    resolution_status: Literal["resolved", "ambiguous", "unknown"]
    esco_uri: str | None = None
    preferred_label: str | None = None
    description: str | None = None
    candidates: tuple[str, ...] = ()
    embedding: tuple[float, ...] = ()


@dataclass(frozen=True)
class SkillSimilarity:
    value: float
    match_type: Literal["canonical", "semantic"]


SkillPriority = Literal["mandatory", "nice_to_have"]


@dataclass(frozen=True)
class RequiredSkill:
    name: str
    priority: SkillPriority = "mandatory"


@dataclass(frozen=True)
class SkillMatchDetail:
    need_skill: str
    need_esco_uri: str | None
    need_resolution_status: Literal["resolved", "ambiguous", "unknown"]
    has_skill: str | None
    has_esco_uri: str | None
    has_resolution_status: Literal["resolved", "ambiguous", "unknown"] | None
    similarity: float
    weighted_similarity: float
    priority: SkillPriority
    covered: bool
    match_type: Literal["canonical", "semantic", "none"]
    reason: str


@dataclass(frozen=True)
class SkillMatchMatrixCell:
    need_skill: str
    need_resolution_status: Literal["resolved", "ambiguous", "unknown"]
    has_skill: str | None
    has_resolution_status: Literal["resolved", "ambiguous", "unknown"] | None
    similarity: float
    weighted_similarity: float
    best_candidate: bool
    score_contribution: float
    priority: SkillPriority
    covered: bool
    match_type: Literal["canonical", "semantic", "none"]
    reason: str


@dataclass(frozen=True)
class SkillMatchingResult:
    score: int
    qualified: bool
    matches: tuple[SkillMatchDetail, ...]
    matrix: tuple[SkillMatchMatrixCell, ...]

    @property
    def missing_skills(self) -> tuple[SkillMatchDetail, ...]:
        return tuple(match for match in self.matches if not match.covered)


class SkillMatchingService:
    def __init__(
        self,
        llm_service: EmbeddingProvider,
        db_service: EscoCatalog,
        *,
        similarity_cutoff: float = 0.75,
    ) -> None:
        if not 0.0 <= similarity_cutoff <= 1.0:
            raise ValueError("Skill-Matching-Cutoff muss zwischen 0.0 und 1.0 liegen.")
        self.llm_service = llm_service
        self.db_service = db_service
        self.similarity_cutoff = similarity_cutoff

    async def resolve_skills(self, names: Sequence[str]) -> list[ResolvedSkill]:
        cleaned_names = [name.strip() for name in names]
        if any(not name for name in cleaned_names):
            raise ValueError("Skill-Namen dürfen nicht leer sein.")
        if not cleaned_names:
            return []

        normalized_names = [normalize_alias(name) for name in cleaned_names]
        concepts = await self.db_service.get_esco_concepts_for_aliases(normalized_names)
        alias_index = build_alias_index(concepts)
        concepts_by_uri = {
            str(concept["uri"]): concept
            for concept in concepts
            if concept.get("uri")
        }

        resolved: list[ResolvedSkill] = []
        embedding_keys: dict[tuple[str, str], ResolvedSkill] = {}
        for name, normalized_name in zip(cleaned_names, normalized_names):
            resolution = resolve_alias(name, alias_index)
            concept = concepts_by_uri.get(resolution.uri) if resolution.uri else None
            if resolution.uri and concept is None:
                raise ValueError(f"ESCO-Konzept {resolution.uri!r} fehlt im Katalogergebnis.")

            profile = ResolvedSkill(
                name=name,
                normalized_name=normalized_name,
                resolution_status=resolution.status,
                esco_uri=resolution.uri,
                preferred_label=str(concept["preferred_label"]) if concept else None,
                description=str(concept["description"]) if concept and concept.get("description") else None,
                candidates=resolution.candidates,
            )
            resolved.append(profile)
            key = ("uri", profile.esco_uri) if profile.esco_uri else ("label", profile.normalized_name)
            embedding_keys.setdefault(key, profile)

        keys = list(embedding_keys)
        profiles = list(embedding_keys.values())
        vectors = await asyncio.gather(
            *(
                self.llm_service.create_embedding(
                    {
                        "entity": "skill",
                        "name": profile.preferred_label or profile.name,
                        "description": profile.description or "",
                    },
                    allow_fallback=False,
                )
                for profile in profiles
            )
        )
        embeddings = {
            key: tuple(self._validated_embedding(vector))
            for key, vector in zip(keys, vectors)
        }
        return [
            replace(
                profile,
                embedding=embeddings[
                    ("uri", profile.esco_uri)
                    if profile.esco_uri
                    else ("label", profile.normalized_name)
                ],
            )
            for profile in resolved
        ]

    async def match(
        self,
        need_skills: Sequence[RequiredSkill],
        has_skills: Sequence[str],
    ) -> SkillMatchingResult:
        if not need_skills:
            raise ValueError("Mindestens ein Bedarfsskill ist erforderlich.")
        if any(not skill.name.strip() for skill in need_skills):
            raise ValueError("Skill-Namen dürfen nicht leer sein.")
        if any(skill.priority not in {"mandatory", "nice_to_have"} for skill in need_skills):
            raise ValueError("Skill-Priorität muss mandatory oder nice_to_have sein.")

        profiles = await self.resolve_skills(
            [skill.name for skill in need_skills] + list(has_skills)
        )
        needs = profiles[: len(need_skills)]
        candidates = profiles[len(need_skills) :]

        matches: list[SkillMatchDetail] = []
        matrix: list[SkillMatchMatrixCell] = []
        selected_matrix_indices: list[int | None] = []
        weighted_sum = 0.0
        total_weight = 0.0
        for requirement, need in zip(need_skills, needs):
            best_candidate: ResolvedSkill | None = None
            best_matrix_index: int | None = None
            best_similarity = SkillSimilarity(value=0.0, match_type="semantic")
            for candidate in candidates:
                similarity = compare_skills(need, candidate)
                covered = similarity.value >= self.similarity_cutoff
                weighted_similarity = (
                    1.0
                    if covered and similarity.value >= 0.90
                    else similarity.value
                    if covered
                    else 0.0
                )
                if similarity.match_type == "canonical":
                    cell_reason = "Identische kanonische ESCO-URI."
                elif need.normalized_name == candidate.normalized_name:
                    cell_reason = "Identische Skill-Bezeichnung nach Normalisierung."
                else:
                    comparison = "erreicht" if covered else "liegt unter"
                    cell_reason = (
                        f"Semantische Ähnlichkeit {similarity.value:.4f} "
                        f"{comparison} dem Cutoff {self.similarity_cutoff:.2f}."
                    )
                matrix.append(
                    SkillMatchMatrixCell(
                        need_skill=need.name,
                        need_resolution_status=need.resolution_status,
                        has_skill=candidate.name,
                        has_resolution_status=candidate.resolution_status,
                        similarity=round(similarity.value, 4),
                        weighted_similarity=round(weighted_similarity, 4),
                        best_candidate=False,
                        score_contribution=0.0,
                        priority=requirement.priority,
                        covered=covered,
                        match_type=similarity.match_type,
                        reason=cell_reason,
                    )
                )
                if best_candidate is None or similarity.value > best_similarity.value:
                    best_candidate = candidate
                    best_similarity = similarity
                    best_matrix_index = len(matrix) - 1

            if not candidates:
                matrix.append(
                    SkillMatchMatrixCell(
                        need_skill=need.name,
                        need_resolution_status=need.resolution_status,
                        has_skill=None,
                        has_resolution_status=None,
                        similarity=0.0,
                        weighted_similarity=0.0,
                        best_candidate=False,
                        score_contribution=0.0,
                        priority=requirement.priority,
                        covered=False,
                        match_type="none",
                        reason="Keine Kandidaten-Skills angegeben.",
                    )
                )
            selected_matrix_indices.append(best_matrix_index)

            covered = best_candidate is not None and best_similarity.value >= self.similarity_cutoff
            weighted_similarity = (
                1.0
                if covered and best_similarity.value >= 0.90
                else best_similarity.value
                if covered
                else 0.0
            )
            weight = 2.0 if requirement.priority == "mandatory" else 1.0
            total_weight += weight
            weighted_sum += weight * weighted_similarity

            if best_candidate is None:
                match_type: Literal["canonical", "semantic", "none"] = "none"
                reason = "Keine Kandidaten-Skills angegeben."
            elif best_similarity.match_type == "canonical":
                match_type = "canonical"
                reason = "Identische kanonische ESCO-URI."
            elif need.normalized_name == best_candidate.normalized_name:
                match_type = "semantic"
                reason = "Identische Skill-Bezeichnung nach Normalisierung."
            else:
                match_type = "semantic"
                comparison = "erreicht" if covered else "liegt unter"
                reason = (
                    f"Semantische Ähnlichkeit {best_similarity.value:.4f} "
                    f"{comparison} dem Cutoff {self.similarity_cutoff:.2f}."
                )

            matches.append(
                SkillMatchDetail(
                    need_skill=requirement.name,
                    need_esco_uri=need.esco_uri,
                    need_resolution_status=need.resolution_status,
                    has_skill=best_candidate.name if best_candidate else None,
                    has_esco_uri=best_candidate.esco_uri if best_candidate else None,
                    has_resolution_status=best_candidate.resolution_status if best_candidate else None,
                    similarity=round(best_similarity.value, 4),
                    weighted_similarity=round(weighted_similarity, 4),
                    priority=requirement.priority,
                    covered=covered,
                    match_type=match_type,
                    reason=reason,
                )
            )

        qualified = all(
            match.covered
            for match in matches
            if match.priority == "mandatory"
        )
        if total_weight:
            for match, matrix_index in zip(matches, selected_matrix_indices):
                if matrix_index is not None:
                    matrix[matrix_index] = replace(
                        matrix[matrix_index],
                        best_candidate=True,
                        score_contribution=round(
                            (
                                (2.0 if match.priority == "mandatory" else 1.0)
                                * match.weighted_similarity
                                / total_weight
                                * 100
                            )
                            if qualified
                            else 0.0,
                            4,
                        ),
                    )
        score = round((weighted_sum / total_weight) * 100) if total_weight else 0
        return SkillMatchingResult(
            score=score if qualified else 0,
            qualified=qualified,
            matches=tuple(matches),
            matrix=tuple(matrix),
        )

    @staticmethod
    def _validated_embedding(vector: Sequence[float]) -> list[float]:
        values = [float(value) for value in vector]
        if not values or any(not isfinite(value) for value in values):
            raise ValueError("Embedding muss mindestens einen endlichen Zahlenwert enthalten.")
        return values


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0
    if len(left) != len(right):
        raise ValueError("Embedding-Vektoren müssen dieselbe Dimension haben.")

    left_values = [float(value) for value in left]
    right_values = [float(value) for value in right]
    if any(not isfinite(value) for value in (*left_values, *right_values)):
        raise ValueError("Embedding-Vektoren dürfen nur endliche Zahlen enthalten.")

    left_norm = sqrt(fsum(value * value for value in left_values))
    right_norm = sqrt(fsum(value * value for value in right_values))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0

    similarity = fsum(a * b for a, b in zip(left_values, right_values)) / (left_norm * right_norm)
    return max(0.0, min(1.0, similarity))


def compare_skills(left: ResolvedSkill, right: ResolvedSkill) -> SkillSimilarity:
    if left.esco_uri and left.esco_uri == right.esco_uri:
        return SkillSimilarity(value=1.0, match_type="canonical")
    if left.normalized_name == right.normalized_name:
        return SkillSimilarity(value=1.0, match_type="semantic")
    return SkillSimilarity(
        value=cosine_similarity(left.embedding, right.embedding),
        match_type="semantic",
    )
