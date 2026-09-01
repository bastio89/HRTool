from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from models import CandidateProfileExtraction


@pytest.mark.anyio
async def test_cv_parser_parse_combines_files_without_persisting(app_module, api_client, monkeypatch):
    profile = CandidateProfileExtraction(name="Ada Lovelace", location="London")
    parse_mock = AsyncMock(return_value=profile)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(
        app_module,
        "extract_document_text",
        lambda data, content_type: data.decode("utf-8"),
    )

    response = await api_client.post(
        "/cv-parser/parse",
        params={"persist": "false"},
        files=[
            ("file", ("cv.pdf", b"Ada Lovelace worked as a software engineer.", "application/pdf")),
            ("file", ("profile.docx", b"She lived and worked in London.", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["filenames"] == ["cv.pdf", "profile.docx"]
    assert payload["filename"] == "cv.pdf"
    assert payload["candidate"]["name"] == "Ada Lovelace"
    assert payload["profile"]["location"] == "London"
    assert payload["storage"] == {"postgres": False, "neo4j": False}
    assert payload["persisted"] is False
    assert "Ada Lovelace" in parse_mock.await_args.args[0]
    assert "London" in parse_mock.await_args.args[0]
    upsert_mock.assert_not_awaited()


@pytest.mark.anyio
async def test_cv_parser_parse_requires_a_file(api_client):
    response = await api_client.post("/cv-parser/parse")

    assert response.status_code == 400
    assert response.json() == {"detail": "Keine Datei hochgeladen"}


@pytest.mark.anyio
async def test_cv_parser_parse_persists_to_neo4j(app_module, api_client, monkeypatch):
    profile = CandidateProfileExtraction(name="Grace Hopper", skills=[])
    monkeypatch.setattr(app_module, "uuid4", lambda: "candidate-123")
    monkeypatch.setattr(app_module, "extract_document_text", lambda data, content_type: data.decode("utf-8"))
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", AsyncMock(return_value=profile))
    monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.1, 0.2]))
    upsert_mock = AsyncMock()
    postgres_mock = AsyncMock(return_value=42)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "insert_candidate", postgres_mock)

    response = await api_client.post(
        "/cv-parser/parse",
        params={"persist": "true"},
        files={"file": ("cv.pdf", b"Grace Hopper developed pioneering compiler technology.", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["persisted"] is True
    assert payload["storage"] == {"postgres": True, "neo4j": True}
    assert payload["candidate"]["id"] == 42
    assert payload["graphRag"]["id"] == "candidate-123"
    postgres_mock.assert_awaited_once_with(profile, source="CV-Import")
    upsert_mock.assert_awaited_once_with(
        candidate_id="candidate-123",
        profile=profile,
        embedding=[0.1, 0.2],
        skill_embeddings={},
    )


@pytest.mark.anyio
async def test_cv_parser_parse_recovers_work_history_when_llm_misses_it(app_module, api_client, monkeypatch):
    profile = CandidateProfileExtraction(name="Alina Moser", skills=[])
    monkeypatch.setattr(app_module, "extract_document_text", lambda data, content_type: data.decode("utf-8"))
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", AsyncMock(return_value=profile))

    raw_text = (
        "Alina Moser\n"
        "Beruflicher Werdegang\n"
        "Junior Python Developer, Farmy.ch AG, Zürich\n"
        "Entwicklung von Backend-Services.\n"
        "Sprachkompetenzen\n"
        "Deutsch, Englisch\n"
    )

    response = await api_client.post(
        "/cv-parser/parse",
        params={"persist": "false"},
        files={"file": ("cv.pdf", raw_text.encode("utf-8"), "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["profile"]["current_employer"] == "Farmy.ch AG"
    assert payload["profile"]["current_position"] == "Junior Python Developer"
    assert len(payload["profile"]["work_history"]) == 1
    assert payload["profile"]["work_history"][0]["employer"] == "Farmy.ch AG"


@pytest.mark.anyio
async def test_cv_parser_parse_logs_warning_when_no_work_history_recoverable(app_module, api_client, monkeypatch, caplog):
    profile = CandidateProfileExtraction(name="No History Person", skills=[])
    monkeypatch.setattr(app_module, "extract_document_text", lambda data, content_type: data.decode("utf-8"))
    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", AsyncMock(return_value=profile))

    with caplog.at_level("WARNING"):
        response = await api_client.post(
            "/cv-parser/parse",
            params={"persist": "false"},
            files={"file": ("cv.pdf", b"No History Person has no clear career section here at all.", "application/pdf")},
        )

    assert response.status_code == 200
    assert "kein Beruflicher Werdegang beim Parsen gefunden" in caplog.text