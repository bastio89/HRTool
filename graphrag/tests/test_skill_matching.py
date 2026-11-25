from __future__ import annotations

from unittest.mock import AsyncMock
import json
from uuid import uuid4

import pytest
import httpx
import psycopg

from models import MatchingCandidateInput, MatchingJobInput
from services.llm import LLMService

from services.skill_matching import (
    RequiredSkill,
    ResolvedSkill,
    SkillMatchingService,
    compare_skills,
    cosine_similarity,
)
from services.matching_orchestrator import MatchingOrchestrator, normalize_skill_entries


class _FakeCatalog:
    def __init__(self, concepts: list[dict[str, object]]) -> None:
        self.concepts = concepts
        self.requested_aliases: list[str] = []

    async def get_esco_concepts_for_aliases(self, aliases: list[str]) -> list[dict[str, object]]:
        self.requested_aliases = aliases
        return self.concepts


class _MapEmbedding:
    def __init__(self, vectors: dict[str, list[float]]) -> None:
        self.vectors = vectors

    async def create_embedding(
        self,
        payload: dict[str, object],
        *,
        allow_fallback: bool = True,
    ) -> list[float]:
        return self.vectors[str(payload["name"])]


def test_orchestrator_preserves_priorities_categories_and_skill_formats() -> None:
    skills = normalize_skill_entries([
        {"label": " Python ", "importance": "Mandatory", "category": "HardSkill"},
        {"skill": "Coaching", "priority": "NiceToHave", "category": "SoftSkill"},
        {"name": "SQL"},
        {"name": "Testing", "priority": "nice_to_have"},
    ])
    assert [(skill.name, skill.priority, skill.category) for skill in skills] == [
        ("Python", "mandatory", "HardSkill"),
        ("Coaching", "nice_to_have", "SoftSkill"),
        ("SQL", "mandatory", "HardSkill"),
        ("Testing", "nice_to_have", "HardSkill"),
    ]
    assert [skill.name for skill in normalize_skill_entries("Python; SQL\nTesting")] == [
        "Python", "SQL", "Testing",
    ]
    with pytest.raises(ValueError, match="Prioritaet"):
        normalize_skill_entries([{"name": "Python", "priority": "Optional"}])
    with pytest.raises(ValueError, match="Skill-Namen"):
        normalize_skill_entries([{"name": " "}])


@pytest.mark.anyio
async def test_orchestrator_requires_prepared_job_skills_without_model_calls() -> None:
    embeddings = AsyncMock()
    service = SkillMatchingService(
        type("EmbeddingService", (), {"create_embedding": embeddings})(),
        _FakeCatalog([]),
    )
    with pytest.raises(ValueError, match="vor dem Matching aufbereiten"):
        await MatchingOrchestrator(service).match_skills(None, ["Python"])
    embeddings.assert_not_awaited()


@pytest.mark.anyio
async def test_orchestrator_preserves_partial_coverage_and_reports_missing_mandatory_skills() -> None:
    embeddings = _MapEmbedding({"Python": [1.0, 0.0], "Coaching": [0.0, 1.0]})
    orchestrator = MatchingOrchestrator(SkillMatchingService(embeddings, _FakeCatalog([])))
    result = await orchestrator.match_skills([
        {"name": "Python", "category": "HardSkill"},
        {"name": "Coaching", "category": "SoftSkill"},
    ], [{"name": "Python", "priority": "Neutral"}])

    assert result.result.score == 50
    assert result.result.qualified is False
    assert result.categories["HardSkill"].score == 100
    assert result.categories["SoftSkill"].score == 0
    assert len(result.result.matrix) == 2
    assert result.method == "vector"

    empty = await orchestrator.match_skills(
        [{"name": "Python", "category": "SoftSkill", "priority": "NiceToHave"}], [],
    )
    assert empty.result.score == 0
    assert empty.result.qualified is True
    assert empty.categories["SoftSkill"].score == 0
    assert "HardSkill" not in empty.categories


@pytest.mark.anyio
async def test_stored_matrix_reuses_full_results_across_id_forms_and_only_computes_missing_pairs(
    stored_matching_pair, monkeypatch,
):
    store, candidate_id, job_id = stored_matching_pair
    requests, scoring_calls = [], []
    service = LLMService("http://embedding-provider", "chat", "embedding-v1", 2)

    def respond(request):
        requests.append(request)
        skill = json.loads(json.loads(request.content)["prompt"])["name"]
        return httpx.Response(200, json={"embedding": [1.0, 0.0] if skill == "Python" else [0.0, 1.0]})

    original_match = SkillMatchingService.match

    async def tracked_match(self, need_skills, has_skills):
        scoring_calls.append((need_skills, has_skills))
        return await original_match(self, need_skills, has_skills)

    monkeypatch.setattr(SkillMatchingService, "match", tracked_match)
    await service.client.aclose()
    service.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    orchestrator = MatchingOrchestrator(
        SkillMatchingService(service, _FakeCatalog([])), postgres_store=store,
    )
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        candidate_uuid = (await (await connection.execute(
            "SELECT uuid::text FROM candidates WHERE id = %s", (candidate_id,),
        )).fetchone())[0]
        job_uuid = (await (await connection.execute(
            "SELECT uuid::text FROM jobs WHERE id = %s", (job_id,),
        )).fetchone())[0]
        peer = await (await connection.execute(
            "INSERT INTO candidates (name) VALUES (%s) RETURNING id", (f"cache-peer-{uuid4()}",),
        )).fetchone()
    peer_id = peer[0]
    job = MatchingJobInput(id=str(job_id), title="Engineer", required_skills=[{"name": "Python"}, {"name": "SQL"}])
    candidate = MatchingCandidateInput(id=str(candidate_id), name="Ada", has_skill=["Python"])
    try:
        first, _ = await orchestrator.match_skill_matrix([job], [candidate], model="compatibility-label")
        count = len(requests), len(scoring_calls)
        assert count[0] > 0 and count[1] > 0
        assert first[0]["score"] == 50 and first[0]["qualified"] is False
        assert first[0]["model"] == "embedding-v1" and first[0]["cacheStatus"] == "computed"
        second, _ = await orchestrator.match_skill_matrix(
            [job.model_copy(update={"id": job_uuid})],
            [candidate.model_copy(update={"id": candidate_uuid})], model="another-compatibility-label", engine="neo4j",
        )
        assert second == [{
            **first[0], "cacheStatus": "hit", "candidateId": candidate_uuid, "jobId": job_uuid,
        }]
        assert (len(requests), len(scoring_calls)) == count
        mixed, _ = await orchestrator.match_skill_matrix(
            [job], [candidate, candidate.model_copy(update={"id": str(peer_id), "name": "Peer"})], model="label",
        )
        assert [row["cacheStatus"] for row in mixed] == ["hit", "computed"]
        assert (len(requests), len(scoring_calls)) == (count[0] * 2, count[1] * 2)
    finally:
        await service.close()
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            await connection.execute("DELETE FROM candidates WHERE id = %s", (peer_id,))


@pytest.mark.anyio
async def test_resolve_skills_uses_canonical_labels_and_informative_descriptions() -> None:
    catalog = _FakeCatalog(
        [
            {
                "uri": "https://example.test/skill/python",
                "preferred_label": "Python programming",
                "aliases": ["Coding with Python"],
                "description": "Use the Python programming language.",
            }
        ]
    )
    embedding = AsyncMock(return_value=[1.0, 0.0])
    service = SkillMatchingService(
        llm_service=type("EmbeddingService", (), {"create_embedding": embedding})(),
        db_service=catalog,
    )

    resolved = await service.resolve_skills(["  Coding with Python "])

    assert catalog.requested_aliases == ["coding with python"]
    assert resolved[0].resolution_status == "resolved"
    assert resolved[0].esco_uri == "https://example.test/skill/python"
    embedding.assert_awaited_once_with(
        {
            "entity": "skill",
            "name": "Python programming",
            "description": "Use the Python programming language.",
        },
        allow_fallback=False,
    )


@pytest.mark.anyio
async def test_identical_unresolved_skill_names_match_even_with_zero_embeddings() -> None:
    service = SkillMatchingService(
        _MapEmbedding({"Schreiner": [0.0, 0.0]}),
        _FakeCatalog([]),
    )

    result = await service.match([RequiredSkill("Schreiner")], ["Schreiner"])

    assert result.score == 100
    assert result.qualified is True
    assert result.matches[0].similarity == 1.0
    assert result.matches[0].covered is True
    assert result.matches[0].reason == "Identische Skill-Bezeichnung nach Normalisierung."
    assert result.matrix[0].need_skill == "Schreiner"
    assert result.matrix[0].has_skill == "Schreiner"
    assert result.matrix[0].similarity == 1.0
    assert result.matrix[0].covered is True


@pytest.mark.anyio
async def test_matching_result_contains_each_required_candidate_pair() -> None:
    service = SkillMatchingService(
        _MapEmbedding({
            "Need": [1.0, 0.0],
            "Candidate A": [1.0, 0.0],
            "Candidate B": [0.0, 1.0],
        }),
        _FakeCatalog([]),
    )

    result = await service.match([RequiredSkill("Need")], ["Candidate A", "Candidate B"])

    assert [(cell.need_skill, cell.has_skill) for cell in result.matrix] == [
        ("Need", "Candidate A"),
        ("Need", "Candidate B"),
    ]
    assert [cell.similarity for cell in result.matrix] == [1.0, 0.0]
    assert [cell.best_candidate for cell in result.matrix] == [True, False]
    assert [cell.score_contribution for cell in result.matrix] == [100.0, 0.0]


@pytest.mark.anyio
async def test_score_contribution_remains_weighted_when_a_mandatory_skill_is_missing() -> None:
    service = SkillMatchingService(
        _MapEmbedding({
            "Mandatory": [1.0, 0.0],
            "Nice-to-have": [1.0, 0.0],
            "Unmatched mandatory": [0.0, 1.0],
            "Candidate": [1.0, 0.0],
        }),
        _FakeCatalog([]),
        similarity_cutoff=0.75,
    )

    qualified = await service.match(
        [RequiredSkill("Mandatory"), RequiredSkill("Nice-to-have", "nice_to_have")],
        ["Candidate"],
    )
    partial = await service.match(
        [RequiredSkill("Unmatched mandatory"), RequiredSkill("Nice-to-have", "nice_to_have")],
        ["Candidate"],
    )

    assert qualified.score == 100
    assert sum(cell.score_contribution for cell in qualified.matrix) == pytest.approx(100.0)
    assert [cell.score_contribution for cell in qualified.matrix] == [66.6667, 33.3333]
    assert partial.score == 33
    assert partial.qualified is False
    assert [cell.best_candidate for cell in partial.matrix] == [True, True]
    assert [cell.score_contribution for cell in partial.matrix] == [0.0, 33.3333]


@pytest.mark.anyio
async def test_ambiguous_and_unknown_skill_names_remain_unresolved() -> None:
    catalog = _FakeCatalog(
        [
            {"uri": "skill:one", "preferred_label": "Alpha", "aliases": ["shared"], "description": "First."},
            {"uri": "skill:two", "preferred_label": "Beta", "aliases": ["shared"], "description": "Second."},
        ]
    )
    embedding = AsyncMock(side_effect=[[1.0, 0.0], [0.0, 1.0]])
    service = SkillMatchingService(
        llm_service=type("EmbeddingService", (), {"create_embedding": embedding})(),
        db_service=catalog,
    )

    resolved = await service.resolve_skills(["shared", "unknown skill"])

    assert resolved[0].resolution_status == "ambiguous"
    assert resolved[0].esco_uri is None
    assert resolved[0].candidates == ("skill:one", "skill:two")
    assert resolved[1].resolution_status == "unknown"
    assert resolved[1].esco_uri is None


def test_same_canonical_concept_is_exact_but_different_concepts_stay_semantic() -> None:
    left = ResolvedSkill(
        name="Python",
        normalized_name="python",
        resolution_status="resolved",
        esco_uri="skill:python",
        embedding=(1.0, 0.0),
    )
    same = ResolvedSkill(
        name="Python programming",
        normalized_name="python programming",
        resolution_status="resolved",
        esco_uri="skill:python",
        embedding=(0.0, 1.0),
    )
    distinct = ResolvedSkill(
        name="Data analysis",
        normalized_name="data analysis",
        resolution_status="resolved",
        esco_uri="skill:data-analysis",
        embedding=(1.0, 0.0),
    )

    assert compare_skills(left, same).value == 1.0
    assert compare_skills(left, same).match_type == "canonical"
    assert compare_skills(left, distinct).value == 1.0
    assert compare_skills(left, distinct).match_type == "semantic"


def test_cosine_similarity_handles_zero_vectors_and_rejects_mismatched_dimensions() -> None:
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0
    with pytest.raises(ValueError, match="dieselbe Dimension"):
        cosine_similarity([1.0], [1.0, 0.0])


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("raw_similarity", "weighted_similarity", "covered"),
    [
        (0.74, 0.0, False),
        (0.75, 0.75, True),
        (0.89, 0.89, True),
        (0.90, 1.0, True),
    ],
)
async def test_cutoff_and_full_match_boundary(raw_similarity, weighted_similarity, covered) -> None:
    candidate_vector = [raw_similarity, (1.0 - raw_similarity**2) ** 0.5]
    service = SkillMatchingService(
        _MapEmbedding({"Need": [1.0, 0.0], "Candidate": candidate_vector}),
        _FakeCatalog([]),
        similarity_cutoff=0.75,
    )

    result = await service.match([RequiredSkill("Need")], ["Candidate"])

    assert result.matches[0].similarity == pytest.approx(raw_similarity, abs=0.0001)
    assert result.matches[0].weighted_similarity == pytest.approx(weighted_similarity)
    assert result.matches[0].covered is covered


@pytest.mark.anyio
async def test_nice_to_have_gap_is_weighted_but_does_not_change_mandatory_status() -> None:
    service = SkillMatchingService(
        _MapEmbedding({"Mandatory": [1.0, 0.0], "Nice-to-have": [0.0, 1.0], "Candidate": [1.0, 0.0]}),
        _FakeCatalog([]),
    )

    result = await service.match(
        [RequiredSkill("Mandatory"), RequiredSkill("Nice-to-have", "nice_to_have")],
        ["Candidate"],
    )

    assert result.score == 67
    assert result.qualified is True
    assert [match.covered for match in result.matches] == [True, False]


@pytest.mark.anyio
async def test_missing_mandatory_skill_preserves_partial_score_and_extra_skills_do_not_reduce_score() -> None:
    vectors = {
        "Mandatory": [0.0, 1.0],
        "Nice-to-have": [1.0, 0.0],
        "Candidate": [1.0, 0.0],
        "Extra": [0.0, -1.0],
    }
    service = SkillMatchingService(_MapEmbedding(vectors), _FakeCatalog([]))

    result = await service.match(
        [RequiredSkill("Mandatory"), RequiredSkill("Nice-to-have", "nice_to_have")],
        ["Candidate"],
    )
    with_extra = await service.match(
        [RequiredSkill("Mandatory"), RequiredSkill("Nice-to-have", "nice_to_have")],
        ["Candidate", "Extra"],
    )

    assert result.qualified is False
    assert result.score == 33
    assert result.missing_skills[0].need_skill == "Mandatory"
    assert with_extra.score == result.score
    assert [match.has_skill for match in with_extra.matches] == [match.has_skill for match in result.matches]
