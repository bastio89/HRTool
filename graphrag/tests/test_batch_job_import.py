"""Tests fuer den Batch-Import von Stellen-PDFs.

Der Importer orchestrierte frueher LLM, Neo4j und Postgres selbst. Inzwischen
schickt er die Datei an das Backend, das PDF-Parser und Qualitaetspruefung
ausfuehrt und die Datei erst nach einem vollstaendigen Import verschiebt.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import psycopg
import pytest

from batch_tools import import_cvs_jobs_from_pdfs as importer
from models import CandidateProfileExtraction
from services.db import Neo4jService


class FakePdfService:
    def extract_text(self, data: bytes) -> str:
        return "Senior Data Engineer with Python, SQL and German B2 requirements."


class ExplodingPdfService:
    def extract_text(self, data: bytes) -> str:
        raise ValueError("kaputtes PDF")


@pytest.fixture
def cv_import(tmp_path, monkeypatch):
    pdf_path = tmp_path / "cv.pdf"
    pdf_path.write_bytes(b"cv")
    done_dir = tmp_path / "done"
    create = AsyncMock(return_value={
        "id": 7, "uuid": "cv-7", "matchingRunId": "run-7", "matchingStatus": "queued", "preparationStatus": "ready",
    })
    monkeypatch.setattr(importer, "create_candidate", create)
    monkeypatch.setattr(importer, "extract_candidate_profile", AsyncMock(return_value=CandidateProfileExtraction(name="Stored CV")))
    db = object.__new__(Neo4jService)
    monkeypatch.setattr(db, "find_candidate_by_source_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(db, "get_top_job_matches_for_candidate", AsyncMock(side_effect=AssertionError("No synchronous pair matching")))
    monkeypatch.setattr(db, "close", AsyncMock())
    store = SimpleNamespace(get_matching_actor=AsyncMock(return_value={"id": 7}), record_matching_pairs=AsyncMock())
    llm = SimpleNamespace(
        create_embedding=AsyncMock(return_value=[1.0, 0.0]),
        rerank_candidates=AsyncMock(side_effect=AssertionError("No AI matching after import")),
        parse_job_description=AsyncMock(side_effect=AssertionError("No job skill extraction")),
        close=AsyncMock(),
    )
    return SimpleNamespace(
        pdf=pdf_path, done=done_dir, create=create, db=db, llm=llm, store=store,
        privacy=Mock(spec=importer.CandidatePrivacyService),
    )


async def _run_cv(env, **overrides):
    kwargs = dict(
        pdf_path=env.pdf, done_dir=env.done, dry_run=False, pdf_service=FakePdfService(),
        db_service=env.db, llm_service=env.llm, postgres_store=env.store, candidate_privacy_service=env.privacy,
        match_limit=1, actor_user_id=7,
    )
    kwargs.update(overrides)
    return await importer.process_cv_file(**kwargs)


@pytest.mark.anyio
@pytest.mark.parametrize("preparation", ["ready", "required"])
async def test_cv_import_confirms_durable_run_without_synchronous_matching_and_moves_saved_source(cv_import, preparation):
    env = cv_import
    env.create.return_value["preparationStatus"] = preparation
    if preparation == "required":
        env.create.return_value["preparationError"] = "graph_preparation_failed"
    ok, message = await _run_cv(env)
    assert ok is True
    env.create.assert_awaited_once()
    assert env.create.await_args.kwargs["actor_user_id"] == 7
    assert "imported as candidate id=cv-7" in message
    assert "matching run id=run-7 status=queued" in message
    assert "asynchronous, all stored jobs" in message
    assert f"preparation status={preparation}" in message
    assert (env.done / "cv.pdf").exists() and not env.pdf.exists()
    env.db.get_top_job_matches_for_candidate.assert_not_awaited()
    env.store.record_matching_pairs.assert_not_awaited()
    env.llm.rerank_candidates.assert_not_awaited()
    env.llm.parse_job_description.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("duplicate", ["source", "identity"])
async def test_cv_duplicate_keeps_existing_duplicate_destination_semantics_without_a_new_run(cv_import, duplicate):
    env = cv_import
    if duplicate == "source":
        env.db.find_candidate_by_source_hash.return_value = {"id": "existing"}
    else:
        env.create.side_effect = importer.DuplicateCandidateError({"id": "existing", "name": "Stored CV"})
    duplicates = env.done / "duplicates"
    duplicates.mkdir(parents=True)
    (duplicates / "cv.pdf").write_bytes(b"previous")
    ok, message = await _run_cv(env)
    assert ok and "duplicate skipped" in message and "existing_candidate_id=existing" in message
    assert (duplicates / "cv_1.pdf").exists() and not env.pdf.exists()
    assert (duplicates / "cv.pdf").read_bytes() == b"previous"
    env.db.get_top_job_matches_for_candidate.assert_not_awaited()
    env.store.record_matching_pairs.assert_not_awaited()
    if duplicate == "source":
        env.create.assert_not_awaited()


@pytest.mark.anyio
async def test_cv_import_without_current_actor_does_not_parse_persist_or_move_files(cv_import):
    env = cv_import
    env.store.get_matching_actor.return_value = None
    ok, message = await _run_cv(env)
    assert not ok and "existing authenticated user" in message
    env.create.assert_not_awaited()
    env.db.find_candidate_by_source_hash.assert_not_awaited()
    assert env.pdf.exists() and not env.done.exists()


@pytest.mark.anyio
async def test_cv_import_rejects_an_unconfirmed_outbox_instead_of_reporting_matching_success(cv_import):
    env = cv_import
    env.create.return_value.pop("matchingRunId")
    ok, message = await _run_cv(env)
    assert not ok and "without confirmation of a durable matching run" in message
    assert env.pdf.exists() and not env.done.exists()


def _cli_args(env, **overrides):
    values = dict(
        mode="cv", input_dir=str(env.pdf.parent), done_dir=str(env.done), dry_run=False, match_limit=1,
        token="test-token", username=None, password=None, api_base="http://backend:3001/api", timeout_seconds=30,
    )
    return SimpleNamespace(**{**values, **overrides})


@pytest.mark.anyio
@pytest.mark.parametrize("authentication", ["valid", "invalid_token", "removed_actor", "dry_run"])
async def test_cv_cli_verifies_token_and_actor_before_any_schema_or_source_write(cv_import, monkeypatch, authentication):
    env = cv_import
    client_type = httpx.AsyncClient

    def authenticate(req):
        assert authentication != "dry_run", "Dry-run must not contact the backend"
        assert req.method == "GET" and req.url.path == "/api/auth/me"
        assert req.headers["authorization"] == "Bearer test-token"
        return httpx.Response(401 if authentication == "invalid_token" else 200, json={"id": 7})

    if authentication == "removed_actor":
        env.store.get_matching_actor.return_value = None
    monkeypatch.setattr(importer.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(authenticate), **kwargs))
    monkeypatch.setattr(importer, "PostgresStore", lambda _: env.store)
    init = AsyncMock(side_effect=lambda: env.store.get_matching_actor.assert_awaited_once_with(7))
    monkeypatch.setattr(importer, "init_schema", init)
    graph_factory = Mock(return_value=env.db)
    llm_factory = Mock(return_value=env.llm)
    monkeypatch.setattr(importer, "Neo4jService", graph_factory)
    monkeypatch.setattr(importer, "LLMService", llm_factory)
    monkeypatch.setattr(importer, "PDFService", FakePdfService)
    monkeypatch.setattr(importer, "CandidatePrivacyService", lambda _: env.privacy)
    monkeypatch.setattr(importer, "PromptService", lambda _: None)
    monkeypatch.setattr(importer, "ModelConfigService", lambda *args, **kwargs: None)
    result = await importer.run_cv_import(_cli_args(env, dry_run=authentication == "dry_run"))
    if authentication == "dry_run":
        assert result == 0
        init.assert_not_awaited()
        env.store.get_matching_actor.assert_not_awaited()
        env.create.assert_not_awaited()
        assert env.pdf.exists() and not env.done.exists()
    elif authentication != "valid":
        assert result == 1
        init.assert_not_awaited()
        graph_factory.assert_not_called()
        llm_factory.assert_not_called()
        env.create.assert_not_awaited()
        assert env.pdf.exists() and not env.done.exists()
    else:
        assert result == 0
        init.assert_awaited_once()
        assert env.create.await_args.kwargs["actor_user_id"] == 7
        assert (env.done / "cv.pdf").exists()


def test_cv_cli_does_not_guess_a_default_account_when_credentials_are_missing(cv_import, monkeypatch):
    for key in ("HRTOOL_API_TOKEN", "HRTOOL_USERNAME", "HRTOOL_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    login = Mock(side_effect=AssertionError("No implicit default account"))
    monkeypatch.setattr(importer, "post_json", login)
    with pytest.raises(RuntimeError, match="No backend auth token"):
        importer.resolve_auth_token(_cli_args(cv_import, token=None))
    login.assert_not_called()


@pytest.mark.anyio
async def test_cv_dry_run_needs_no_actor_and_never_uses_persistence_or_matching(cv_import):
    env = cv_import
    ok, message = await _run_cv(env, dry_run=True, actor_user_id=None)
    assert ok and "dry-run ok" in message
    env.store.get_matching_actor.assert_not_awaited()
    env.create.assert_not_awaited()
    env.db.find_candidate_by_source_hash.assert_not_awaited()
    assert env.pdf.exists() and not env.done.exists()


@pytest.mark.anyio
async def test_cv_cli_persists_one_real_owned_outbox_and_no_pair_results(tmp_path, stored_matching_pair, matching_actor, monkeypatch):
    store, _, _ = stored_matching_pair
    pdf_path = tmp_path / "cv.pdf"
    pdf_path.write_bytes(b"cv")
    profile = CandidateProfileExtraction(name=f"batch-pipeline-{uuid4()}", skills=[{"name": "Python"}])
    monkeypatch.setattr(importer, "extract_candidate_profile", AsyncMock(return_value=profile))
    db = object.__new__(Neo4jService)
    monkeypatch.setattr(db, "find_candidate_by_source_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(db, "upsert_candidate", AsyncMock())
    monkeypatch.setattr(db, "get_top_job_matches_for_candidate", AsyncMock(side_effect=AssertionError("No synchronous pairs")))
    llm = SimpleNamespace(create_embedding=AsyncMock(return_value=[1.0, 0.0]), rerank_candidates=AsyncMock())
    candidate_id = None
    run_id = None
    try:
        ok, message = await importer.process_cv_file(
            pdf_path, tmp_path / "done", False, FakePdfService(), db, llm, store,
            importer.CandidatePrivacyService(store), match_limit=1, actor_user_id=matching_actor,
        )
        assert ok, message
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            rows = await (await connection.execute(
                "SELECT id, entity_id, method, stage FROM matching_runs WHERE actor_user_id = %s", (matching_actor,),
            )).fetchall()
        assert len(rows) == 1
        run_id, candidate_id, method, stage = rows[0]
        assert method == "vector" and stage == "queued" and str(run_id) in message
        assert (tmp_path / "done" / "cv.pdf").exists()
        db.get_top_job_matches_for_candidate.assert_not_awaited()
        llm.rerank_candidates.assert_not_awaited()
    finally:
        if candidate_id is not None:
            async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
                await connection.execute("DELETE FROM matching_runs WHERE id = %s", (run_id,))
                await connection.execute("DELETE FROM candidate_texts WHERE candidate_id = %s", (str(candidate_id),))
                await connection.execute("DELETE FROM candidates WHERE id = %s", (candidate_id,))


def test_resolve_input_dir_uses_job_input_for_job_mode():
    args = type("Args", (), {"mode": "job", "input_dir": None})()

    assert importer._resolve_input_dir(args).name == "job_input"


async def _run(pdf_path, done_dir, **overrides):
    kwargs = dict(
        pdf_path=pdf_path,
        done_dir=done_dir,
        dry_run=False,
        api_base="http://backend:3001/api",
        timeout_seconds=30,
        token="t0ken",
        pdf_service=FakePdfService(),
    )
    kwargs.update(overrides)
    return await importer.process_job_file(**kwargs)


@pytest.mark.anyio
async def test_process_job_file_posts_to_the_backend_and_files_the_pdf(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")
    done_dir = tmp_path / "done"

    calls = {}

    def fake_post(url, file_path, timeout_seconds, token, field_name="file"):
        calls.update(url=url, file_path=file_path, timeout_seconds=timeout_seconds, token=token)
        return {
            "success": True,
            "job": {
                "id": "job-123", "title": "Senior Data Engineer", "description": "Build data platforms.",
                "skills": "Python, SQL",
            },
            "matchingRunId": "job-run-123", "matchingStatus": "queued",
        }

    monkeypatch.setattr(importer, "post_multipart_file", fake_post)

    ok, message = await _run(pdf_path, done_dir)

    assert ok is True
    assert "imported as job id=job-123" in message
    assert "title=Senior Data Engineer" in message
    assert "matching run id=job-run-123 status=queued" in message
    assert calls["url"] == "http://backend:3001/api/jobs/parse-description?persist=1"
    assert calls["token"] == "t0ken"
    # Die Datei wandert nach dem Import in den Done-Ordner.
    assert pdf_path.exists() is False
    assert (done_dir / "job.pdf").exists() is True


@pytest.mark.anyio
async def test_process_job_file_keeps_the_pdf_when_the_backend_fails(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")
    done_dir = tmp_path / "done"

    def fake_post(*args, **kwargs):
        raise RuntimeError("backend nicht erreichbar")

    monkeypatch.setattr(importer, "post_multipart_file", fake_post)

    ok, message = await _run(pdf_path, done_dir)

    assert ok is False
    assert "backend job parsing failed" in message
    # Wichtig: nichts verschieben, sonst waere die Datei nach einem Ausfall weg.
    assert pdf_path.exists() is True
    assert done_dir.exists() is False


@pytest.mark.anyio
async def test_process_job_file_reports_a_missing_job_id(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")

    monkeypatch.setattr(importer, "post_multipart_file", lambda *a, **k: {"success": True, "job": {}})

    ok, message = await _run(pdf_path, tmp_path / "done")

    assert ok is False
    assert "no job id" in message
    assert pdf_path.exists() is True


@pytest.mark.anyio
async def test_process_job_file_keeps_pdf_when_the_returned_profile_is_incomplete(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf")
    done_dir = tmp_path / "done"
    monkeypatch.setattr(importer, "post_multipart_file", lambda *args, **kwargs: {
        "success": True,
        "job": {"id": "job-123", "title": "Senior Data Engineer"},
        "matchingRunId": "job-run-123",
        "matchingStatus": "queued",
    })

    ok, message = await _run(pdf_path, done_dir)

    assert not ok
    assert "incomplete profile" in message and "skills" in message
    assert pdf_path.exists() and not done_dir.exists()


@pytest.mark.anyio
@pytest.mark.parametrize("matching_status", ["not_required", None])
async def test_job_cli_requires_a_run_confirmation_unless_the_import_was_unchanged(tmp_path, monkeypatch, matching_status):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf")
    done_dir = tmp_path / "done"
    monkeypatch.setattr(importer, "post_multipart_file", lambda *args, **kwargs: {
        "success": True,
        "job": {
            "id": "job-123", "title": "Senior Data Engineer",
            "description": "Build data platforms.", "skills": "Python, SQL",
        },
        "matchingStatus": matching_status,
    })
    ok, message = await _run(pdf_path, done_dir)
    if matching_status == "not_required":
        assert ok and "matching not required: unchanged import" in message
        assert (done_dir / "job.pdf").exists() and not pdf_path.exists()
    else:
        assert not ok and "did not confirm a durable matching run" in message
        assert pdf_path.exists() and not done_dir.exists()


@pytest.mark.anyio
async def test_dry_run_touches_neither_backend_nor_filesystem(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")

    def explode(*args, **kwargs):
        raise AssertionError("dry-run darf das Backend nicht aufrufen")

    monkeypatch.setattr(importer, "post_multipart_file", explode)

    ok, message = await _run(pdf_path, tmp_path / "done", dry_run=True)

    assert ok is True
    assert "dry-run ok" in message
    assert pdf_path.exists() is True


@pytest.mark.anyio
async def test_unreadable_pdf_is_reported_and_left_in_place(tmp_path):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"not really a pdf")

    ok, message = await _run(pdf_path, tmp_path / "done", pdf_service=ExplodingPdfService())

    assert ok is False
    assert "PDF extraction failed" in message
    assert pdf_path.exists() is True
