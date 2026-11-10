"""Eindeutige Identitaet in GraphRAG: Name + Geburtsdatum machen eine Person
eindeutig (Geburtsdatum optional), PostgreSQL vergibt die UUID und der
Neo4j-Knoten traegt genau diese. Das Geburtsdatum geht nie in Embeddings.

Die PostgreSQL-Tests laufen gegen DATABASE_URL (wie in CI); Neo4j, Sprachmodell
und Abrechnung werden ersetzt.
"""

from __future__ import annotations

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import psycopg
import pytest

from models import CandidateProfileExtraction, CandidateSkillExtraction
from services.candidate_identity import (
	CandidateIdentityError,
	DuplicateCandidateError,
	ensure_birth_date,
	extract_birth_date,
	normalize_birth_date,
	require_identity,
)
from services.candidate_persistence import create_candidate
from services.postgres_store import PostgresStore


DATABASE_URL = os.getenv("DATABASE_URL", "")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL nicht gesetzt")
MARKER = f"gr-{uuid.uuid4().hex[:8]}"


@pytest.mark.parametrize(
	("text", "expected"),
	[
		("Geburtsdatum: 12.03.1985", "1985-03-12"),
		("geb. 3. März 1990 in Bern", "1990-03-03"),
		("Date of birth: March 7th, 1988", "1988-03-07"),
		("DOB 1979-11-30", "1979-11-30"),
		("Né le 05/06/1992", "1992-06-05"),
		("Data di nascita: 1 settembre 1984", "1984-09-01"),
		("Geburtsdatum 31.02.1990", None),
		# Datumsangaben aus dem Werdegang sind kein Geburtsdatum.
		("Berufserfahrung 12.03.2015 - heute", None),
		("geb. Müller, Projekte 01.2020 - 03.2023", None),
	],
)
def test_extract_birth_date_only_from_labelled_dates(text, expected):
	assert extract_birth_date(text) == expected


def test_profile_normalizes_birth_date_and_only_the_name_is_required():
	profile = CandidateProfileExtraction(name="Anna Muster", birth_date="3.7.1985")
	assert profile.birth_date == "1985-07-03"
	assert normalize_birth_date("01.01.2999") is None
	assert require_identity(profile) == ("Anna Muster", "1985-07-03")

	without = CandidateProfileExtraction(name="Anna Muster")
	assert require_identity(without) == ("Anna Muster", None)
	with pytest.raises(CandidateIdentityError) as error:
		require_identity(CandidateProfileExtraction(name="  "))
	assert error.value.field == "name"
	with pytest.raises(CandidateIdentityError) as error:
		require_identity(SimpleNamespace(name="Anna Muster", birth_date="31.02.1990"))
	assert error.value.field == "birth_date"
	assert ensure_birth_date(without, "Lebenslauf\nGeburtsdatum: 03.07.1985").birth_date == "1985-07-03"


@pytest.fixture
async def store():
	instance = PostgresStore(DATABASE_URL)
	await instance.ensure_schema()
	yield instance
	async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as connection:
		ids = [row[0] for row in await (await connection.execute("SELECT id FROM candidates WHERE name LIKE %s", (f"%{MARKER}%",))).fetchall()]
		for candidate_id in ids:
			await connection.execute("DELETE FROM candidate_texts WHERE candidate_id = %s", (str(candidate_id),))
		await connection.execute("DELETE FROM candidates WHERE name LIKE %s", (f"%{MARKER}%",))


def _profile(name: str, birth_date: str | None = "14.02.1990") -> CandidateProfileExtraction:
	return CandidateProfileExtraction(
		name=name,
		email=f"{MARKER}@example.com",
		birth_date=birth_date,
		skills=[CandidateSkillExtraction(name="Python", category="HardSkill")],
	)


@needs_db
async def test_insert_candidate_blocks_the_same_person(store):
	stored = await store.insert_candidate(_profile(f"Lena Lorenz {MARKER}"), source="Test")
	assert isinstance(stored["id"], int)
	uuid.UUID(stored["uuid"])

	with pytest.raises(DuplicateCandidateError) as duplicate:
		await store.insert_candidate(_profile(f"  lena   LORENZ {MARKER} ", "1990-02-14"), source="Test")
	assert duplicate.value.existing["id"] == stored["id"]
	assert duplicate.value.to_detail()["code"] == "DUPLICATE_CANDIDATE"

	# Namensvetter mit anderem Geburtsdatum ist eine andere Person.
	other = await store.insert_candidate(_profile(f"Lena Lorenz {MARKER}", "15.02.1990"), source="Test")
	assert other["id"] != stored["id"]

	# Ohne Geburtsdatum keine Dublettenpruefung: beide werden angelegt.
	first = await store.insert_candidate(_profile(f"Ohne Datum {MARKER}", None), source="Test")
	second = await store.insert_candidate(_profile(f"Ohne Datum {MARKER}", None), source="Test")
	assert first["id"] != second["id"]
	assert await store.find_candidate_by_identity(f"Ohne Datum {MARKER}", None) is None


@needs_db
async def test_create_candidate_uses_the_postgres_uuid_for_neo4j_and_keeps_birth_date_out(store):
	db_service = SimpleNamespace(upsert_candidate=AsyncMock())
	llm_service = SimpleNamespace(create_embedding=AsyncMock(return_value=[0.1, 0.2]))
	privacy = SimpleNamespace(anonymize_candidate=AsyncMock())

	stored = await create_candidate(
		postgres_store=store,
		candidate_privacy_service=privacy,
		db_service=db_service,
		llm_service=llm_service,
		build_skill_embeddings=AsyncMock(return_value={}),
		profile=_profile(f"Nora Neu {MARKER}"),
		candidate_text="Nora Neu\nGeburtsdatum: 14.02.1990",
		source="Test",
	)

	assert db_service.upsert_candidate.await_args.kwargs["candidate_id"] == stored["uuid"]
	embedded = llm_service.create_embedding.await_args.args[0]
	assert "birth_date" not in embedded
	text = await store.get_candidate_text(str(stored["id"]))
	assert "birth_date" not in (text["profile_json"] or {})
	async with await psycopg.AsyncConnection.connect(DATABASE_URL) as connection:
		row = await (await connection.execute(
			"SELECT graph_candidate_id, birth_date::text FROM candidates WHERE id = %s", (stored["id"],)
		)).fetchone()
	assert row == (stored["uuid"], "1990-02-14")


@needs_db
async def test_create_candidate_rolls_back_postgres_when_neo4j_fails(store):
	db_service = SimpleNamespace(upsert_candidate=AsyncMock(side_effect=RuntimeError("neo4j down")))
	with pytest.raises(RuntimeError):
		await create_candidate(
			postgres_store=store,
			candidate_privacy_service=SimpleNamespace(anonymize_candidate=AsyncMock()),
			db_service=db_service,
			llm_service=SimpleNamespace(create_embedding=AsyncMock(return_value=[0.1])),
			build_skill_embeddings=AsyncMock(return_value={}),
			profile=_profile(f"Rolf Rueckbau {MARKER}"),
			candidate_text="CV",
			source="Test",
		)
	assert await store.find_candidate_by_identity(f"Rolf Rueckbau {MARKER}", "1990-02-14") is None


@needs_db
async def test_ingest_candidate_route_blocks_duplicates_and_parses_without_storing(app_module, api_client, monkeypatch, store):
	monkeypatch.setattr(app_module, "postgres_store", store)
	monkeypatch.setattr(app_module.billing_service, "charge", AsyncMock())
	monkeypatch.setattr(app_module.db_service, "upsert_candidate", AsyncMock())
	monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.1]))
	monkeypatch.setattr(app_module, "_build_skill_embeddings", AsyncMock(return_value={}))
	monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", AsyncMock())
	profile = {"name": f"Ida Ingest {MARKER}", "birth_date": "1988-11-02", "skills": [{"name": "SQL"}]}

	parsed = await api_client.post("/ingest/candidate?persist=0", json={"profile": profile})
	assert parsed.status_code == 200
	assert parsed.json()["persisted"] is False
	assert await store.find_candidate_by_identity(profile["name"], "1988-11-02") is None

	created = await api_client.post("/ingest/candidate", json={"profile": profile})
	assert created.status_code == 200
	body = created.json()
	assert body["persisted"] is True
	assert body["id"] == (await store.find_candidate_by_identity(profile["name"], "1988-11-02"))["uuid"]
	assert app_module.db_service.upsert_candidate.await_args.kwargs["candidate_id"] == body["id"]

	duplicate = await api_client.post("/ingest/candidate", json={"profile": {**profile, "name": profile["name"].upper()}})
	assert duplicate.status_code == 409
	assert duplicate.json()["detail"]["existing"]["id"] == body["postgres_id"]

	without = await api_client.post("/ingest/candidate", json={"profile": {"name": f"Ohne {MARKER}"}})
	assert without.status_code == 200
	assert without.json()["persisted"] is True


@needs_db
async def test_sync_candidates_writes_the_uuid_node_and_removes_stale_nodes(app_module, api_client, monkeypatch, store):
	stored = await store.insert_candidate(_profile(f"Sven Sync {MARKER}"), source="Test")
	async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as connection:
		await connection.execute(
			"UPDATE candidates SET graph_candidate_id = %s, graph_candidate_ids = ARRAY[%s, %s]::TEXT[] WHERE id = %s",
			("old-node-2", "old-node-1", "old-node-2", stored["id"]),
		)
	monkeypatch.setattr(app_module, "postgres_store", store)
	upsert = AsyncMock()
	delete = AsyncMock(return_value=1)
	monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert)
	monkeypatch.setattr(app_module.db_service, "delete_candidate", delete)
	embedding = AsyncMock(return_value=[0.1])
	monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding)
	monkeypatch.setattr(app_module, "_build_skill_embeddings", AsyncMock(return_value={}))

	response = await api_client.post("/sync/candidates", json={"candidate_ids": [stored["id"]]})
	assert response.status_code == 200
	assert response.json()["synced"] == 1
	assert response.json()["removed_stale_nodes"] == 2
	assert upsert.await_args.kwargs["candidate_id"] == stored["uuid"]
	assert sorted(call.args[0] for call in delete.await_args_list) == ["old-node-1", "old-node-2"]
	assert "birth_date" not in embedding.await_args.args[0]
	async with await psycopg.AsyncConnection.connect(DATABASE_URL) as connection:
		row = await (await connection.execute(
			"SELECT graph_candidate_id, graph_candidate_ids FROM candidates WHERE id = %s", (stored["id"],)
		)).fetchone()
	assert row == (stored["uuid"], [stored["uuid"]])
