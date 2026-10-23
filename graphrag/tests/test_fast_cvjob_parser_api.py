from fast_cvjob_parsing.app.schemas import CVResponse, JobResponse

import pytest
from unittest.mock import AsyncMock


class FakeResumeJobParser:
    def __init__(self):
        self.pdfs = []

    def parse_cv(self, pdf_bytes: bytes) -> CVResponse:
        self.pdfs.append(pdf_bytes)
        return CVResponse(
            personal_data={"full_name": "Ada Lovelace"},
            work_experience=[],
            education=[],
            skills={},
        )

    def parse_job(self, pdf_bytes: bytes) -> JobResponse:
        return JobResponse(job_title="Software Engineer", required_skills={})


def test_legacy_cv_parser_route_is_deprecated(app_module):
    operation = app_module.app.openapi()["paths"]["/cv-parser/parse"]["post"]

    assert operation["deprecated"] is True


@pytest.mark.anyio
async def test_graph_rag_exposes_cv_and_job_parser_routes(app_module, api_client):
    app_module.app.state.cv_job_parser = FakeResumeJobParser()
    headers = {"x-api-key": app_module.settings.graphrag_api_key or ""}

    cv_response = await api_client.post(
        "/api/v1/fast-parse/cv",
        files={"file": ("cv.pdf", b"cv bytes", "application/pdf")},
        headers=headers,
    )
    job_response = await api_client.post(
        "/api/v1/fast-parse/job",
        files={"file": ("job.pdf", b"job bytes", "application/pdf")},
        headers=headers,
    )

    assert cv_response.status_code == 200
    assert cv_response.json()["personal_data"]["full_name"] == "Ada Lovelace"
    assert job_response.status_code == 200
    assert job_response.json()["job_title"] == "Software Engineer"


@pytest.mark.anyio
async def test_fast_import_uses_fast_parser_and_preserves_import_response(app_module, api_client, monkeypatch):
    fast_parser = FakeResumeJobParser()
    app_module.app.state.cv_job_parser = fast_parser
    monkeypatch.setattr(app_module.pdf_service, "extract_text", lambda data: "Ada Lovelace software engineer CV text")
    monkeypatch.setattr(app_module.billing_service, "charge", AsyncMock())
    monkeypatch.setattr(app_module.db_service, "find_candidate_by_source_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(app_module.db_service, "find_candidate_by_profile_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(app_module.postgres_store, "_find_existing_candidate", AsyncMock(return_value=None))
    llm_parse = AsyncMock()
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", llm_parse)

    response = await api_client.post(
        "/cv-fast-importer/import",
        params={"persist": "false"},
        files={"file": ("ada.pdf", b"pdf bytes", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["candidate"]["name"] == "Ada Lovelace"
    assert payload["parsingMethod"] == "fast_gliner"
    assert payload["persisted"] is False
    assert fast_parser.pdfs == [b"pdf bytes"]
    llm_parse.assert_not_awaited()


@pytest.mark.anyio
async def test_fast_import_persists_candidate_when_requested(app_module, api_client, monkeypatch):
    app_module.app.state.cv_job_parser = FakeResumeJobParser()
    monkeypatch.setattr(app_module.pdf_service, "extract_text", lambda data: "Ada Lovelace software engineer CV text")
    monkeypatch.setattr(app_module.billing_service, "charge", AsyncMock())
    monkeypatch.setattr(app_module.db_service, "find_candidate_by_source_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(app_module.db_service, "find_candidate_by_profile_hash", AsyncMock(return_value=None))
    monkeypatch.setattr(app_module.postgres_store, "_find_existing_candidate", AsyncMock(return_value=None))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.1, 0.2]))
    upsert = AsyncMock()
    persist_profile = AsyncMock(return_value=42)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert)
    monkeypatch.setattr(app_module, "persist_candidate_profile", persist_profile)
    monkeypatch.setattr(app_module, "uuid4", lambda: "fast-candidate-123")

    response = await api_client.post(
        "/cv-fast-importer/import",
        params={"persist": "true"},
        files={"file": ("ada.pdf", b"pdf bytes", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["persisted"] is True
    assert payload["storage"] == {"postgres": True, "neo4j": True}
    assert payload["candidate"]["id"] == 42
    upsert.assert_awaited_once()
    assert upsert.await_args.kwargs["candidate_id"] == "fast-candidate-123"
    persist_profile.assert_awaited_once()