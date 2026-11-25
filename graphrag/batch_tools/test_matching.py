from __future__ import annotations

import importlib
import csv
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import psycopg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from config import settings
from plugins.billing.service import BillingService
from services.db import Neo4jService
from services.matching_orchestrator import MatchingOrchestrator
from services.skill_matching import SkillMatchingService
from services.postgres_store import PostgresStore
from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
)


_REAL_PASSWORDS = {"your_neo4j_password", "test-password"}


@pytest.fixture
def central_batch_services(monkeypatch, matching_cache_doubles):
    jobs = [
        {"id": "j-other", "title": "Other", "required_skills": [{"name": "SQL"}]},
        {"id": "j-python", "title": "Python Job", "required_skills": [{"name": "Python"}]},
    ]
    candidates = [
        {"id": "c-empty", "name": "Empty", "has_skill": []},
        {"id": "c-alias", "name": "Alias CV", "has_skill": ["Coding", "Extra"]},
    ]
    async def load(*, job_ids=None, candidate_ids=None):
        return (
            [job for job in jobs if job_ids is None or job["id"] in job_ids],
            [candidate for candidate in candidates if candidate_ids is None or candidate["id"] in candidate_ids],
        )

    db = object.__new__(Neo4jService)
    monkeypatch.setattr(db, "get_skill_matching_inputs", AsyncMock(side_effect=load))
    monkeypatch.setattr(db, "find_candidate_by_name", AsyncMock(return_value=candidates[1]))
    monkeypatch.setattr(db, "find_job_by_name", AsyncMock(return_value=jobs[1]))
    monkeypatch.setattr(db, "get_esco_concepts_for_aliases", AsyncMock(return_value=[
        {"uri": "skill:python", "preferred_label": "Python", "aliases": ["Coding"]},
    ]))
    legacy = AsyncMock(side_effect=AssertionError("No legacy prefilter"))
    monkeypatch.setattr(db, "_deprecated_top_job_matches_by_overlap", legacy)
    monkeypatch.setattr(db, "_deprecated_top_candidates_by_overlap", legacy)
    vectors = {"Python": [1.0, 0.0, 0.0], "SQL": [0.0, 1.0, 0.0], "Extra": [0.0, 0.0, 1.0]}
    llm = SimpleNamespace(
        create_embedding=AsyncMock(side_effect=lambda payload, **_kwargs: vectors[payload["name"]]),
        rerank_candidates=AsyncMock(side_effect=AssertionError("No AI matching")),
        parse_job_description=AsyncMock(side_effect=AssertionError("No skill extraction")),
        close=AsyncMock(),
    )
    store = AsyncMock(spec=PostgresStore)
    matching_cache_doubles(store, llm)
    identifiers = {"jobs": {"j-other": 11, "j-python": 12}, "candidates": {"c-empty": 21, "c-alias": 22}}
    store.matching_ids_for.side_effect = lambda table, values: {value: identifiers[table][value] for value in values}
    orchestrator = MatchingOrchestrator(SkillMatchingService(llm, db), postgres_store=store)
    return db, orchestrator, store, llm


@pytest.mark.anyio
@pytest.mark.parametrize("direction", ["cv-job", "job-cv"])
async def test_batch_directions_use_central_job_to_cv_scoring_before_top_n(central_batch_services, capsys, direction):
    from batch_tools import match

    db, orchestrator, store, llm = central_batch_services
    if direction == "cv-job":
        status = await match._match_cv_to_jobs(db, "Alias CV", 1, True, orchestrator)
    else:
        status = await match._match_job_to_cvs(db, "Python Job", 1, True, orchestrator)
    assert status == 0
    assert "score=1.000" in capsys.readouterr().out
    rows = [call.args[4] for call in store.complete_matching_evaluation.await_args_list]
    assert len(rows) == 2
    assert next(row for row in rows if row["jobId"] == "12" and row["candidateId"] == "22")["score"] == 100
    assert any(row["score"] == 0 and row["qualified"] is False for row in rows)
    assert all(call.args[0].method == "vector" for call in store.complete_matching_evaluation.await_args_list)
    llm.rerank_candidates.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("write_fails", [False, True])
async def test_csv_cli_uses_central_scores_and_never_writes_a_success_csv_after_pair_failure(
    central_batch_services, monkeypatch, tmp_path, write_fails,
):
    from batch_tools import matrix

    db, _orchestrator, store, llm = central_batch_services
    monkeypatch.setattr(matrix, "init_schema", AsyncMock())
    monkeypatch.setattr(matrix, "Neo4jService", lambda **_kwargs: db)
    monkeypatch.setattr(matrix, "PostgresStore", lambda _url: store)
    monkeypatch.setattr(matrix, "LLMService", lambda **_kwargs: llm)
    monkeypatch.setattr(db, "close", AsyncMock())
    monkeypatch.setattr(matrix, "_score_pair", lambda *_args: pytest.fail("No legacy score"))
    monkeypatch.setattr(matrix, "_find_similar_skills", AsyncMock(side_effect=AssertionError("No legacy skill lookup")))
    monkeypatch.chdir(tmp_path)
    if write_fails:
        store.complete_matching_evaluation.side_effect = RuntimeError("Pair write failed")
        with pytest.raises(RuntimeError, match="Pair write failed"):
            await matrix.run()
        assert not list(tmp_path.glob("match_*.csv"))
    else:
        output = await matrix.run()
        with output.open(newline="", encoding="utf-8") as file:
            assert list(csv.reader(file)) == [
                ["job_id", "job_title", "Empty [c-empty]", "Alias CV [c-alias]"],
                ["j-other", "Other", "0.000", "0.000"],
                ["j-python", "Python Job", "0.000", "1.000"],
            ]
        assert store.complete_matching_evaluation.await_count == 4
    llm.rerank_candidates.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()


@pytest.mark.anyio
async def test_skill_diagnostics_show_central_cells_and_limit_only_after_full_comparison(
    central_batch_services, monkeypatch, capsys,
):
    from batch_tools import describe_candidate_job as diagnostic

    _db, orchestrator, store, llm = central_batch_services
    vectors = {"Python": [1.0, 0.0, 0.0], "SQL": [0.0, 1.0, 0.0], "Extra": [0.0, 0.92, (1 - 0.92 ** 2) ** 0.5]}
    llm.create_embedding.side_effect = lambda payload, **_kwargs: vectors[payload["name"]]
    monkeypatch.setattr(diagnostic, "_cosine_similarity", lambda *_args: pytest.fail("No separate skill cosine"))
    monkeypatch.setattr(diagnostic, "_load_top_cosine_pairs", AsyncMock(side_effect=AssertionError("No Cypher skill scoring")))
    result = await diagnostic._print_skill_matching(
        orchestrator, [{"name": "Python"}, {"name": "SQL", "priority": "NiceToHave"}],
        ["Coding", "Extra"], top_pairs=1,
    )
    assert len(result.matrix) == 4
    semantic = next(cell for cell in result.matrix if cell.need_skill == "SQL" and cell.has_skill == "Extra")
    assert semantic.similarity == pytest.approx(0.92)
    assert semantic.weighted_similarity == 1
    output = capsys.readouterr().out
    assert "Vollstaendige Skill-Paarmatrix: 4" in output
    assert "raw=1.000000 / weighted=1.000000 / resolution=resolved:resolved" in output
    assert f"reason={result.matrix[0].reason}" in output
    assert "SQL / Extra" not in output
    store.record_matching_pairs.assert_not_awaited()
    llm.rerank_candidates.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("has_vectors", [False, True])
async def test_document_diagnostics_remain_separate_and_do_not_invent_missing_scores(
    central_batch_services, capsys, has_vectors,
):
    from batch_tools import describe_candidate_job as diagnostic

    db, _orchestrator, store, llm = central_batch_services
    record = {"candidate_embedding": [1.0, 0.0], "job_embedding": [0.0, 1.0]} if has_vectors else None
    session = MagicMock()
    session.__aenter__.return_value = session
    session.run = AsyncMock(return_value=SimpleNamespace(single=AsyncMock(return_value=record)))
    db.driver = SimpleNamespace(session=lambda: session)
    await diagnostic._print_document_diagnostics(db, "c-alias", "j-python")
    output = capsys.readouterr().out
    assert "Ganzdokument-Diagnostik (kein Skill-/AI-Score)" in output
    if has_vectors:
        assert "Dokument-Cosinus (nur Diagnose): 0.0" in output
    else:
        assert "Dokumentvektoren nicht vorhanden." in output
        assert "Dokument-Cosinus" not in output
    store.record_matching_pairs.assert_not_awaited()
    llm.create_embedding.assert_not_awaited()


@pytest.mark.anyio
async def test_batch_csv_and_diagnostics_preserve_identical_alias_priorities(
    central_batch_services, monkeypatch, tmp_path, capsys,
):
    from batch_tools import describe_candidate_job as diagnostic
    from batch_tools import match, matrix

    db, orchestrator, store, llm = central_batch_services
    jobs, candidates = await db.get_skill_matching_inputs()
    job, candidate = jobs[1], candidates[1]
    job["required_skills"].append({"name": "SQL", "priority": "NiceToHave", "category": "SoftSkill"})
    assessment = await orchestrator.match_skills(job["required_skills"], candidate["has_skill"])
    assert (assessment.result.score, assessment.result.qualified) == (67, True)
    store.record_matching_pairs.assert_not_awaited()

    def assert_persisted_pair():
        rows = [call.args[4] for call in store.complete_matching_evaluation.await_args_list]
        pair = next(row for row in rows if (row["jobId"], row["candidateId"]) == ("12", "22"))
        assert (pair["score"], pair["qualified"], pair["hardSkillScore"], pair["softSkillScore"]) == (67, True, 1, 0)

    for direction in (match._match_cv_to_jobs, match._match_job_to_cvs):
        name = "Alias CV" if direction is match._match_cv_to_jobs else "Python Job"
        assert await direction(db, name, 1, True, orchestrator) == 0
        assert_persisted_pair()
    _candidates, _jobs, scores = await matrix._build_matrix(db, orchestrator=orchestrator, model="test-model")
    assert scores[("j-python", "c-alias")] == 0.67
    assert_persisted_pair()

    writes_before_diagnosis = store.complete_matching_evaluation.await_count
    result = await diagnostic._print_skill_matching(
        orchestrator, job["required_skills"], candidate["has_skill"], top_pairs=1,
    )
    assert result == assessment.result
    assert "Vollstaendige Skill-Paarmatrix: 4" in capsys.readouterr().out
    assert store.complete_matching_evaluation.await_count == writes_before_diagnosis
    llm.rerank_candidates.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()


@pytest.mark.anyio
async def test_cv_import_only_queues_without_running_batch_matching(central_batch_services, monkeypatch, tmp_path):
    from batch_tools import import_cvs_jobs_from_pdfs as importer

    db, _orchestrator, store, llm = central_batch_services
    monkeypatch.setattr(db, "find_candidate_by_source_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(store, "get_matching_actor", AsyncMock(return_value={"id": 7}), raising=False)
    monkeypatch.setattr(importer, "create_candidate", AsyncMock(return_value={
        "uuid": "c-alias", "matchingRunId": "import-run", "matchingStatus": "queued",
        "preparationStatus": "ready",
    }))
    monkeypatch.setattr(importer, "extract_candidate_profile", AsyncMock(return_value=CandidateProfileExtraction(name="Alias CV")))
    pdf_path = tmp_path / "cv.pdf"
    pdf_path.write_bytes(b"cv")
    ok, message = await importer.process_cv_file(
        pdf_path, tmp_path / "done", False, SimpleNamespace(extract_text=lambda _data: "Imported CV"),
        db, llm, store, None, match_limit=1, actor_user_id=7,
    )
    assert ok is True and "matching run id=import-run status=queued" in message
    store.record_matching_pairs.assert_not_awaited()
    llm.create_embedding.assert_not_awaited()
    llm.rerank_candidates.assert_not_awaited()
    llm.parse_job_description.assert_not_awaited()


def _require_real_neo4j_credentials() -> None:
    if os.getenv("RUN_MATCHING_GRAPH_TESTS") != "1":
        pytest.skip("Opt-in: RUN_MATCHING_GRAPH_TESTS=1 requires isolated Neo4j/PostgreSQL test databases.")
    uri = settings.neo4j_uri
    user = settings.neo4j_user
    password = settings.neo4j_password
    if not uri or not user or not password or password in _REAL_PASSWORDS:
        pytest.skip("Set real Neo4j credentials to run the matching integration suite.")


@pytest.fixture
def app_module():
    _require_real_neo4j_credentials()
    import main

    return importlib.reload(main)


@pytest_asyncio.fixture
async def api_client(app_module, monkeypatch):
    if not os.getenv("DATABASE_URL"):
        pytest.skip("Set DATABASE_URL to an isolated PostgreSQL test database.")
    await app_module.postgres_store.ensure_schema()
    monkeypatch.setattr(BillingService, "charge", AsyncMock())
    transport = ASGITransport(app=app_module.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.anyio
@pytest.mark.parametrize("candidate_count", [1, 2])
async def test_live_graph_search_persists_central_scores_without_old_funnel(
    app_module, api_client, monkeypatch, candidate_count,
):
    job_id = str(uuid4())
    candidate_ids = [str(uuid4()) for _ in range(candidate_count)]
    unique_skill = f"central-test-skill-{uuid4().hex}"
    full_embedding = [1.0] + [0.0] * (app_module.llm_service.embedding_dimensions - 1)
    other_embedding = [0.0, 1.0] + [0.0] * (app_module.llm_service.embedding_dimensions - 2)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(
        side_effect=lambda payload, **_kwargs: full_embedding if payload["name"] == unique_skill else other_embedding,
    ))
    for service, names in [
        (app_module.llm_service, ("rerank_candidates", "parse_job_description")),
        (app_module.db_service, ("stage1_filter_candidates", "stage2_rank_candidates", "get_vectormatch_neo4j_rows")),
    ]:
        for name in names:
            monkeypatch.setattr(service, name, AsyncMock(side_effect=AssertionError("No legacy/AI matching")))
    job_profile = JobProfileExtraction(
        title=f"Central matching {job_id}",
        required_skills=[JobSkillExtraction(name=unique_skill, importance="mandatory")],
    )
    try:
        async with await psycopg.AsyncConnection.connect(os.environ["DATABASE_URL"], autocommit=True) as connection:
            await connection.execute(
                "INSERT INTO jobs (uuid, title, company, location, skills) VALUES (%s, %s, 'Test', 'Test', %s)",
                (job_id, job_profile.title, unique_skill),
            )
            for candidate_id in candidate_ids:
                await connection.execute(
                    "INSERT INTO candidates (uuid, name, skills) VALUES (%s, %s, %s)",
                    (candidate_id, f"Central CV {candidate_id}", unique_skill),
                )
        await app_module.db_service.upsert_job(
            job_id, job_profile, full_embedding, skill_embeddings={unique_skill: full_embedding},
        )
        for candidate_id in candidate_ids:
            await app_module.db_service.upsert_candidate(
                candidate_id,
                CandidateProfileExtraction(
                    name=f"Central CV {candidate_id}",
                    skills=[CandidateSkillExtraction(name=unique_skill)],
                ),
                full_embedding, skill_embeddings={unique_skill: full_embedding},
            )
        response = await api_client.post(f"/match/{job_id}")
        assert response.status_code == 200, response.text
        payload = response.json()
        own_matches = [match for match in payload["matches"] if match["candidate_id"] in candidate_ids]
        assert len(own_matches) == candidate_count
        assert payload["stage1_count"] == payload["stage2_count"] >= candidate_count
        assert all((match["score"], match["qualified"], match["method"]) == (100, True, "vector") for match in own_matches)
        async with await psycopg.AsyncConnection.connect(os.environ["DATABASE_URL"]) as connection:
            rows = await (await connection.execute(
                """SELECT r.method, r.score, r.qualified FROM matching_pair_results r
                   JOIN jobs j ON j.id = r.job_id JOIN candidates c ON c.id = r.candidate_id
                   WHERE j.uuid::text = %s AND c.uuid::text = ANY(%s)""",
                (job_id, candidate_ids),
            )).fetchall()
        assert rows == [("vector", 100, True)] * candidate_count
        app_module.llm_service.rerank_candidates.assert_not_awaited()
        app_module.llm_service.parse_job_description.assert_not_awaited()
    finally:
        for candidate_id in candidate_ids:
            await app_module.db_service.delete_candidate(candidate_id)
        await app_module.db_service.delete_job(job_id)
        async with app_module.db_service.driver.session() as session:
            await session.run(
                "MATCH (s:Skill {name: $name}) WHERE NOT EXISTS { MATCH (s)--() } DELETE s",
                name=unique_skill,
            )
        async with await psycopg.AsyncConnection.connect(os.environ["DATABASE_URL"], autocommit=True) as connection:
            await connection.execute("DELETE FROM candidates WHERE uuid::text = ANY(%s)", (candidate_ids,))
            await connection.execute("DELETE FROM jobs WHERE uuid::text = %s", (job_id,))