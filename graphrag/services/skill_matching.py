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
    category: str | None = None


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
        *,
        has_skill_categories: Sequence[str | None] | None = None,
    ) -> SkillMatchingResult:
        if not need_skills:
            raise ValueError("Mindestens ein Bedarfsskill ist erforderlich.")
        if any(not skill.name.strip() for skill in need_skills):
            raise ValueError("Skill-Namen dürfen nicht leer sein.")
        if any(skill.priority not in {"mandatory", "nice_to_have"} for skill in need_skills):
            raise ValueError("Skill-Priorität muss mandatory oder nice_to_have sein.")
        candidate_categories = (
            list(has_skill_categories)
            if has_skill_categories is not None
            else [None] * len(has_skills)
        )
        if len(candidate_categories) != len(has_skills):
            raise ValueError("Für jeden Kandidaten-Skill muss genau eine Kategorie vorliegen.")

        profiles = await self.resolve_skills(
            [skill.name for skill in need_skills] + list(has_skills)
        )
        needs = profiles[: len(need_skills)]
        candidates = profiles[len(need_skills) :]
        unique_candidates: list[ResolvedSkill] = []
        unique_candidate_categories: list[str | None] = []
        seen_candidates: set[tuple[str, str]] = set()
        for candidate, category in zip(candidates, candidate_categories):
            key = ("uri", candidate.esco_uri) if candidate.esco_uri else ("label", candidate.normalized_name)
            if key in seen_candidates:
                continue
            seen_candidates.add(key)
            unique_candidates.append(candidate)
            unique_candidate_categories.append(category)
        candidates = unique_candidates
        candidate_categories = unique_candidate_categories

        matches: list[SkillMatchDetail] = []
        matrix: list[SkillMatchMatrixCell] = []
        similarity_rows: list[list[SkillSimilarity]] = []
        category_compatibility: list[list[bool]] = []
        assignment_weights: list[list[float | None]] = []
        weighted_sum = 0.0
        total_weight = sum(2.0 if skill.priority == "mandatory" else 1.0 for skill in need_skills)
        for requirement, need in zip(need_skills, needs):
            row_similarities: list[SkillSimilarity] = []
            row_category_compatibility: list[bool] = []
            row_assignment_weights: list[float | None] = []
            for candidate in candidates:
                similarity = compare_skills(need, candidate)
                category_matches = (
                    requirement.category is None
                    or candidate_categories[len(row_similarities)] is None
                    or requirement.category == candidate_categories[len(row_similarities)]
                )
                eligible = category_matches and similarity.value >= self.similarity_cutoff
                weighted_similarity = (
                    1.0
                    if eligible and similarity.value >= 0.90
                    else similarity.value
                    if eligible
                    else 0.0
                )
                if not category_matches:
                    cell_reason = (
                        f"Skill-Kategorie {candidate_categories[len(row_similarities)]} "
                        f"passt nicht zur Anforderungskategorie {requirement.category}."
                    )
                elif similarity.match_type == "canonical":
                    cell_reason = "Identische kanonische ESCO-URI."
                elif need.normalized_name == candidate.normalized_name:
                    cell_reason = "Identische Skill-Bezeichnung nach Normalisierung."
                else:
                    comparison = "erreicht" if eligible else "liegt unter"
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
                        covered=False,
                        match_type=similarity.match_type,
                        reason=cell_reason,
                    )
                )
                row_similarities.append(similarity)
                row_category_compatibility.append(category_matches)
                row_assignment_weights.append(
                    (2.0 if requirement.priority == "mandatory" else 1.0) * weighted_similarity
                    if eligible else None
                )

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
            similarity_rows.append(row_similarities)
            category_compatibility.append(row_category_compatibility)
            assignment_weights.append(row_assignment_weights)

        assignments = _maximum_weight_assignment(assignment_weights)
        selected_matrix_indices: list[int | None] = []
        for requirement_index, (requirement, need) in enumerate(zip(need_skills, needs)):
            assigned_candidate_index = assignments[requirement_index]
            row_similarities = similarity_rows[requirement_index]
            row_category_compatibility = category_compatibility[requirement_index]
            diagnostic_candidates = [
                index for index, compatible in enumerate(row_category_compatibility) if compatible
            ] or list(range(len(candidates)))
            diagnostic_candidate_index = (
                max(diagnostic_candidates, key=lambda index: row_similarities[index].value)
                if diagnostic_candidates else None
            )
            selected_candidate_index = (
                assigned_candidate_index
                if assigned_candidate_index is not None else diagnostic_candidate_index
            )
            selected_matrix_index = (
                requirement_index * len(candidates) + selected_candidate_index
                if selected_candidate_index is not None else None
            )
            selected_matrix_indices.append(selected_matrix_index)

            if assigned_candidate_index is not None:
                best_candidate = candidates[assigned_candidate_index]
                best_similarity = row_similarities[assigned_candidate_index]
                covered = True
                weighted_similarity = (
                    1.0 if best_similarity.value >= 0.90 else best_similarity.value
                )
                reason = matrix[selected_matrix_index].reason
                weight = 2.0 if requirement.priority == "mandatory" else 1.0
                weighted_sum += weight * weighted_similarity
            elif selected_candidate_index is None:
                best_candidate = None
                best_similarity = SkillSimilarity(value=0.0, match_type="semantic")
                covered = False
                weighted_similarity = 0.0
                reason = "Keine Kandidaten-Skills angegeben."
            else:
                best_candidate = candidates[selected_candidate_index]
                best_similarity = row_similarities[selected_candidate_index]
                covered = False
                weighted_similarity = 0.0
                if not row_category_compatibility[selected_candidate_index]:
                    reason = matrix[selected_matrix_index].reason
                elif best_similarity.value < self.similarity_cutoff:
                    reason = matrix[selected_matrix_index].reason
                else:
                    reason = "Nicht ausgewählt, weil die eindeutige Gesamtzuordnung andere Paare bevorzugt."

            for candidate_index in range(len(row_similarities)):
                matrix_index = requirement_index * len(candidates) + candidate_index
                assigned = candidate_index == assigned_candidate_index
                cell_reason = matrix[matrix_index].reason
                if (
                    row_category_compatibility[candidate_index]
                    and assignment_weights[requirement_index][candidate_index] is not None
                    and not assigned
                ):
                    cell_reason = "Nicht ausgewählt, weil die eindeutige Gesamtzuordnung andere Paare bevorzugt."
                matrix[matrix_index] = replace(
                    matrix[matrix_index],
                    best_candidate=assigned,
                    score_contribution=0.0,
                    covered=assigned,
                    reason=cell_reason,
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
                    match_type=best_similarity.match_type if best_candidate else "none",
                    reason=reason,
                )
            )

        qualified = all(
            match.covered
            for match in matches
            if match.priority == "mandatory"
        )
        if total_weight:
            for matrix_index, match in zip(selected_matrix_indices, matches):
                if matrix_index is not None and match.covered:
                    matrix[matrix_index] = replace(
                        matrix[matrix_index],
                        score_contribution=round(
                            (
                                (2.0 if match.priority == "mandatory" else 1.0)
                                * match.weighted_similarity
                                / total_weight
                                * 100
                            ),
                            4,
                        ),
                    )
        score = round((weighted_sum / total_weight) * 100) if total_weight else 0
        return SkillMatchingResult(
            score=score,
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


def _maximum_weight_assignment(weights: Sequence[Sequence[float | None]]) -> list[int | None]:
    row_count = len(weights)
    if row_count == 0:
        return []
    candidate_count = len(weights[0])
    if any(len(row) != candidate_count for row in weights):
        raise ValueError("Die Matching-Gewichtsmatrix muss rechteckig sein.")

    column_count = candidate_count + row_count
    costs = [
        [
            -(weight + 1e-9) if weight is not None else 1.0
            for weight in row
        ] + [0.0] * row_count
        for row in weights
    ]
    row_potentials = [0.0] * (row_count + 1)
    column_potentials = [0.0] * (column_count + 1)
    column_rows = [0] * (column_count + 1)
    previous_columns = [0] * (column_count + 1)

    for row_number in range(1, row_count + 1):
        column_rows[0] = row_number
        current_column = 0
        minimum_costs = [float("inf")] * (column_count + 1)
        used_columns = [False] * (column_count + 1)
        while True:
            used_columns[current_column] = True
            current_row = column_rows[current_column]
            delta = float("inf")
            next_column = 0
            for column in range(1, column_count + 1):
                if used_columns[column]:
                    continue
                reduced_cost = (
                    costs[current_row - 1][column - 1]
                    - row_potentials[current_row]
                    - column_potentials[column]
                )
                if reduced_cost < minimum_costs[column]:
                    minimum_costs[column] = reduced_cost
                    previous_columns[column] = current_column
                if minimum_costs[column] < delta:
                    delta = minimum_costs[column]
                    next_column = column
            for column in range(column_count + 1):
                if used_columns[column]:
                    row_potentials[column_rows[column]] += delta
                    column_potentials[column] -= delta
                else:
                    minimum_costs[column] -= delta
            current_column = next_column
            if column_rows[current_column] == 0:
                break
        while True:
            previous = previous_columns[current_column]
            column_rows[current_column] = column_rows[previous]
            current_column = previous
            if current_column == 0:
                break

    assignment: list[int | None] = [None] * row_count
    for column in range(1, candidate_count + 1):
        row = column_rows[column]
        if row and weights[row - 1][column - 1] is not None:
            assignment[row - 1] = column - 1
    return assignment


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
