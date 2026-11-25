from __future__ import annotations

from uuid import uuid4
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import psycopg
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fast_cvjob_parsing.app.schemas import JobResponse

from models import JobProfileExtraction, JobSkillExtraction
from jobs_ch_to_pdf import JobPosting, description_to_text
from plugins.jobs_ch.service import JobsChImportService
from plugins.jobs_ch.router import build_jobs_ch_router
from plugins.jobs_ch.schemas import JobsChImportRequest
from plugins.billing.service import BillingService, BillingUserClaims
import jobs_ch_to_pdf


def test_jobs_ch_llm_input_matches_exported_pdf_text_structure() -> None:
    job = JobPosting(
        title="Fachkundiger Projektleiter Elektroplanung",
        company="Dottikon Exclusive Synthesis AG",
        location="Dottikon",
        employment_type="Festanstellung",
        date_posted="2026-09-25T14:06:31+02:00",
        source_url="https://www.jobs.ch/de/stellenangebote/detail/example/",
        description=(
            "<h2>Ihre Verantwortung</h2>"
            "<ul><li>Projektleitung in der Elektro- und MSR-Technik</li>"
            "<li>Erstellen von Konzeptstudien und Ausschreibungen</li></ul>"
            "<h2>Ihr Profil</h2>"
            "<ul><li>Abgeschlossene Ausbildung als Elektroplaner</li>"
            "<li>Teamfähig, zuverlässig und flexibel</li></ul>"
        ),
    )

    parsed_description = description_to_text(job.description)
    llm_text = JobsChImportService._build_raw_text(job)

    assert "<h2>" not in llm_text
    assert "Ihre Verantwortung" in llm_text
    assert "Projektleitung in der Elektro- und MSR-Technik" in llm_text
    assert "Ihr Profil" in llm_text
    assert "Abgeschlossene Ausbildung als Elektroplaner" in llm_text
    assert llm_text.index("Dottikon Exclusive Synthesis AG") < llm_text.index("Ihre Verantwortung")
    assert llm_text.index("Quelle:") > llm_text.index("Teamfähig, zuverlässig und flexibel")
    assert parsed_description == (
        "Ihre Verantwortung\n"
        "- Projektleitung in der Elektro- und MSR-Technik\n"
        "- Erstellen von Konzeptstudien und Ausschreibungen\n"
        "Ihr Profil\n"
        "- Abgeschlossene Ausbildung als Elektroplaner\n"
        "- Teamfähig, zuverlässig und flexibel"
    )


@pytest.mark.anyio
@pytest.mark.parametrize("existing", [True, False])
async def test_import_keeps_complete_skills_for_new_and_existing_jobs(stored_matching_pair, existing) -> None:
    store, _, existing_id = stored_matching_pair
    result = None
    profile = JobProfileExtraction(
        title=f"Projektleitung Elektroplanung {uuid4()}",
        required_skills=[
            JobSkillExtraction(name="Elektroplanung", priority="Mandatory"),
            JobSkillExtraction(name="MSR-Technik", priority="NiceToHave"),
        ],
    )
    try:
        result = await store.upsert_job(
            job_id=str(existing_id) if existing else None,
            raw_text="Projektleitung Elektroplanung", profile=profile, source="Jobs.ch-import",
        )
        assert result["duplicate"] is existing
        assert result["changed"] is True
        if existing:
            assert result["id"] == existing_id
        stored = (await store.list_jobs_for_sync([result["id"]]))[0]
        assert stored["skills"] == "Elektroplanung, MSR-Technik"
        if not existing:
            assert stored["graph_job_id"] == stored["uuid"]
        details = await store.get_job_text(str(result["id"]))
        assert details["parsed_profile_json"]["required_skills"] == profile.model_dump()["required_skills"]
    finally:
        if result is not None and not existing:
            async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
                await connection.execute("DELETE FROM jobs WHERE id = %s", (result["id"],))


@pytest_asyncio.fixture
async def jobs_import(app_module, stored_matching_pair, matching_actor, monkeypatch):
    store, _, _ = stored_matching_pair
    marker = f"jobs-ch-pipeline-{uuid4()}"
    posting = JobPosting(
        title=marker, company="Test Employer", location="Test Location", employment_type="Vollzeit",
        source_url=f"https://example.invalid/{marker}", description="<p>Java and teamwork experience</p>",
    )
    profile = JobProfileExtraction(
        title=marker, description="Imported Java requirements",
        required_skills=[JobSkillExtraction(name="Java", priority="NiceToHave"),
                         JobSkillExtraction(name="Teamwork", category="SoftSkill", priority="Mandatory")],
    )
    monkeypatch.setattr(app_module, "postgres_store", store)
    monkeypatch.setattr(app_module.llm_service, "parse_job_description", AsyncMock(return_value=profile))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[1.0, 0.0]))
    monkeypatch.setattr(app_module, "_build_skill_embeddings", AsyncMock(return_value={}))
    monkeypatch.setattr(app_module.db_service, "upsert_job", AsyncMock())
    scorer = AsyncMock(side_effect=AssertionError("Import darf keine Paarberechnung ausfuehren"))
    ai = AsyncMock(side_effect=AssertionError("Import darf kein AI-Matching ausfuehren"))
    monkeypatch.setattr(app_module.MatchingOrchestrator, "match_skill_matrix", scorer)
    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", ai)
    fetch = Mock(return_value=posting)
    monkeypatch.setattr(jobs_ch_to_pdf, "fetch_job", fetch)
    monkeypatch.setattr(jobs_ch_to_pdf, "write_pdf", lambda job, path: path.write_bytes(b"%PDF-test"))
    parsed = JobResponse.model_validate({
        "job_title": marker, "company_name": posting.company,
        "required_skills": {"it_skills": ["Java"], "soft_skills": ["Teamwork"]},
    })
    fast_parser = SimpleNamespace(parse_job_with_text=Mock(return_value=(parsed, "original text")))
    service = JobsChImportService(
        llm_service=app_module.llm_service, postgres_store=store, db_service=app_module.db_service,
        prepare_job=app_module._prepare_job,
    )
    try:
        yield SimpleNamespace(
            main=app_module, store=store, actor=matching_actor, posting=posting, profile=profile,
            fetch=fetch, parser=fast_parser, service=service, scorer=scorer, ai=ai,
            payload=JobsChImportRequest(links=[posting.source_url]),
        )
    finally:
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            ids = await (await connection.execute(
                "SELECT entity_id FROM matching_runs WHERE actor_user_id = %s AND entity_type = 'job'", (matching_actor,),
            )).fetchall()
            await connection.execute("DELETE FROM matching_runs WHERE actor_user_id = %s", (matching_actor,))
            for (job_id,) in ids:
                await connection.execute("DELETE FROM jobs WHERE id = %s", (job_id,))


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["fast_import", "llm_import"])
async def test_jobs_ch_import_returns_owned_run_and_current_prepared_revision_without_pair_matching(jobs_import, mode):
    env = jobs_import
    result = await env.service.import_links(
        env.payload.model_copy(update={"import_mode": mode}), fast_parser=env.parser, actor_user_id=env.actor,
    )
    assert result.imported == 1 and result.failed == 0
    item = result.items[0]
    assert item.imported and not item.duplicate
    assert item.matchingRunId and item.matchingStatus == "queued"
    assert item.preparationStatus == "ready" and item.preparedRevision
    run = await env.store.get_matching_run(item.matchingRunId)
    assert run["actor_user_id"] == env.actor and run["method"] == "vector"
    assert run["entity_type"] == "job" and run["request_kind"] == "import"
    snapshot = await env.store.matching_source_snapshot("job", run["entity_id"])
    assert snapshot["revision"] == item.preparedRevision
    stored = await env.store.get_job_text(str(run["entity_id"]))
    skills = stored["parsed_profile_json"]["required_skills"]
    assert sorted((skill["name"], skill["priority"]) for skill in skills) == [
        ("Java", "Mandatory" if mode == "fast_import" else "NiceToHave"), ("Teamwork", "Mandatory"),
    ]
    env.scorer.assert_not_awaited()
    env.ai.assert_not_awaited()


@pytest.mark.anyio
async def test_jobs_ch_changed_reimport_refreshes_one_version_and_unchanged_duplicate_does_not_prepare_again(jobs_import):
    env = jobs_import
    first = (await env.service.import_links(env.payload, actor_user_id=env.actor)).items[0]
    run = await env.store.get_matching_run(first.matchingRunId)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE jobs SET status = 'Archiviert' WHERE id = %s", (run["entity_id"],))
    env.fetch.return_value = replace(env.posting, description="<p>Changed SQL requirements</p>")
    env.main.llm_service.parse_job_description.return_value = env.profile.model_copy(update={
        "description": "Changed SQL requirements", "required_skills": [JobSkillExtraction(name="SQL", priority="Mandatory")],
    })
    changed = (await env.service.import_links(env.payload, actor_user_id=env.actor)).items[0]
    assert changed.imported and changed.duplicate
    assert changed.job_id == first.job_id and changed.matchingRunId != first.matchingRunId
    changed_run = await env.store.get_matching_run(changed.matchingRunId)
    assert changed_run["entity_id"] == run["entity_id"]
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT status, skills FROM jobs WHERE id = %s", (run["entity_id"],),
        )).fetchone() == ("Archiviert", "SQL")
    unchanged = (await env.service.import_links(env.payload, actor_user_id=env.actor)).items[0]
    assert unchanged.imported and unchanged.duplicate
    assert unchanged.matchingRunId is None and unchanged.matchingStatus == "not_required"
    assert unchanged.preparationStatus == "not_requested"
    assert env.main.db_service.upsert_job.await_count == 2
    assert env.main.llm_service.create_embedding.await_count == 2
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT COUNT(*) FROM matching_runs WHERE actor_user_id = %s", (env.actor,),
        )).fetchone() == (2,)


@pytest.mark.anyio
async def test_jobs_ch_graph_failure_retains_the_import_and_queued_run(jobs_import):
    env = jobs_import
    env.main.llm_service.create_embedding.side_effect = RuntimeError("embedding unavailable")
    result = await env.service.import_links(env.payload, actor_user_id=env.actor)
    assert result.imported == 1 and result.failed == 0
    assert result.warning and "Graph-Aufbereitung" in result.warning
    item = result.items[0]
    assert item.imported and item.matchingRunId
    assert item.preparationStatus == "required" and item.preparationError == "graph_preparation_failed"
    assert item.preparedRevision is None and item.error == "embedding unavailable"
    run = await env.store.get_matching_run(item.matchingRunId)
    assert (await env.store.matching_source_snapshot("job", run["entity_id"]))["row"]["uuid"] == item.job_id


@pytest.mark.anyio
async def test_jobs_ch_preparation_cannot_certify_source_changes_during_embeddings(jobs_import):
    env = jobs_import

    async def change_source(*args, **kwargs):
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            await connection.execute("UPDATE jobs SET skills = 'SQL' WHERE url = %s", (env.posting.source_url,))
        return [1.0, 0.0]

    env.main.llm_service.create_embedding.side_effect = change_source
    item = (await env.service.import_links(env.payload, actor_user_id=env.actor)).items[0]
    assert item.imported and item.matchingRunId and item.preparedRevision is None
    assert item.preparationStatus == "required"
    run = await env.store.get_matching_run(item.matchingRunId)
    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        assert await (await connection.execute(
            "SELECT skills, matching_prepared_revision FROM jobs WHERE id = %s", (run["entity_id"],),
        )).fetchone() == ("SQL", None)
    env.scorer.assert_not_awaited()
    env.ai.assert_not_awaited()


@pytest.mark.anyio
async def test_jobs_ch_router_validates_actual_actor_before_charge_and_preserves_import_metadata(jobs_import, monkeypatch):
    env = jobs_import
    claims = BillingUserClaims(env.actor, "test", None, None, "recruiter")
    charge = AsyncMock()
    monkeypatch.setattr(BillingService, "_claims_from_request", lambda self, request: claims)
    monkeypatch.setattr(BillingService, "charge", charge)
    monkeypatch.setattr("plugins.jobs_ch.router.is_enabled", AsyncMock(return_value=True))
    app = FastAPI()
    app.include_router(build_jobs_ch_router(
        env.main.settings, llm_service=env.main.llm_service, postgres_store=env.store,
        db_service=env.main.db_service, prepare_job=env.main._prepare_job,
    ))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/plugins/jobs_ch/import-db", json=env.payload.model_dump())
        assert response.status_code == 200, response.text
        item = response.json()["items"][0]
        assert item["matchingRunId"] and item["matchingStatus"] == "queued"
        assert item["preparationStatus"] == "ready" and item["preparedRevision"]
        assert response.json()["duplicates"] == 0
        charge.assert_awaited_once()
        missing_actor = env.actor + 1_000_000_000
        assert await env.store.get_matching_actor(missing_actor) is None
        claims = BillingUserClaims(missing_actor, "removed", None, None, "recruiter")
        charge.reset_mock()
        env.fetch.reset_mock()
        rejected = await client.post("/plugins/jobs_ch/import-db", json=env.payload.model_dump())
        assert rejected.status_code == 401, rejected.text
        charge.assert_not_awaited()
        env.fetch.assert_not_called()