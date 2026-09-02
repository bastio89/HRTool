from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from services.candidate_privacy import CandidatePrivacyService


class _FakePrivacyStore:
    def __init__(self, record: dict[str, object] | None) -> None:
        self.record = record
        self.anonymization_calls: list[tuple[str, str, dict[str, str]]] = []

    async def get_candidate_text(self, candidate_id: str):
        if self.record and self.record.get("candidate_id") == candidate_id:
            return self.record
        return None

    async def store_candidate_anonymization(self, candidate_id: str, anonymized_text: str, mapping: dict[str, str]) -> None:
        self.anonymization_calls.append((candidate_id, anonymized_text, mapping))
        if self.record is not None:
            self.record = {**self.record, "anonymized_text": anonymized_text, "mapping": mapping}


@pytest.mark.anyio
async def test_candidate_privacy_service_anonymizes_and_stores_mapping() -> None:
    raw_text = (
        "Max Müller\n"
        "Musterstrasse 12\n"
        "8000 Zürich\n"
        "Tel. +41 79 123 45 67\n"
        "max.mueller@example.com\n"
        "https://linkedin.com/in/maxmueller\n"
    )
    store = _FakePrivacyStore(
        {
            "candidate_id": "cand-1",
            "candidate_name": "Max Müller",
            "original_text": raw_text,
            "anonymized_text": None,
            "mapping": {},
        }
    )
    service = CandidatePrivacyService(store)  # type: ignore[arg-type]

    result = await service.anonymize_candidate("cand-1")

    assert result["mode"] == "anon"
    assert result["candidate_id"] == "cand-1"
    assert result["original_text"] == raw_text
    assert result["text"] == result["anonymized_text"]
    assert "Vorname1" in result["text"]
    assert "Name1" in result["text"]
    assert "Tel1" in result["text"]
    assert "Email1" in result["text"]
    assert "URL1" in result["text"]
    assert result["mapping"]["Max"] == "Vorname1"
    assert result["mapping"]["Müller"] == "Name1"
    assert store.anonymization_calls
    assert store.anonymization_calls[0][0] == "cand-1"


@pytest.mark.anyio
async def test_candidate_privacy_service_deanonymizes_from_stored_original() -> None:
    store = _FakePrivacyStore(
        {
            "candidate_id": "cand-2",
            "candidate_name": "Ada Lovelace",
            "original_text": "Ada Lovelace\nLondon\n",
            "anonymized_text": "Vorname1 Name1\nAdresse1\n",
            "mapping": {"Ada": "Vorname1", "Lovelace": "Name1"},
        }
    )
    service = CandidatePrivacyService(store)  # type: ignore[arg-type]

    result = await service.deanonymize_candidate("cand-2")

    assert result["mode"] == "deanon"
    assert result["text"] == "Ada Lovelace\nLondon\n"
    assert result["anonymized_text"] == "Vorname1 Name1\nAdresse1\n"
    assert result["mapping"]["Ada"] == "Vorname1"


@pytest.mark.anyio
async def test_candidate_privacy_routes_delegate_to_service(app_module, api_client, monkeypatch):
    anon_result = {
        "candidate_id": "cand-3",
        "mode": "anon",
        "text": "Vorname1 Name1",
        "original_text": "Max Müller",
        "anonymized_text": "Vorname1 Name1",
        "mapping": {"Max": "Vorname1", "Müller": "Name1"},
    }
    deanon_result = {
        "candidate_id": "cand-3",
        "mode": "deanon",
        "text": "Max Müller",
        "original_text": "Max Müller",
        "anonymized_text": "Vorname1 Name1",
        "mapping": {"Max": "Vorname1", "Müller": "Name1"},
    }

    anon_mock = AsyncMock(return_value=anon_result)
    deanon_mock = AsyncMock(return_value=deanon_result)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anon_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "deanonymize_candidate", deanon_mock)

    anon_response = await api_client.post("/candidates/anon", json={"candidate_id": "cand-3"})
    deanon_response = await api_client.post("/candidates/deanon", json={"candidate_id": "cand-3"})

    assert anon_response.status_code == 200
    assert anon_response.json()["mode"] == "anon"
    assert deanon_response.status_code == 200
    assert deanon_response.json()["mode"] == "deanon"
    anon_mock.assert_awaited_once_with("cand-3")
    deanon_mock.assert_awaited_once_with("cand-3")
