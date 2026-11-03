"""3D-Matching ueber die UUID: PostgreSQL-IDs werden in die UUID des
Datensatzes uebersetzt, Neo4j wird nur per ID abgefragt (kein Rueckfall auf
den Namen) und fehlende Eintraege werden gemeldet statt verschluckt.
Ausserdem: Abgleich von Stellen (/sync/jobs) und fehlender CV-Text beim
Abgleich manuell angelegter Bewerber.

Laeuft gegen DATABASE_URL (wie in CI); Neo4j, Sprachmodell und Abrechnung
werden ersetzt.
"""

from __future__ import annotations

import os
import uuid
from unittest.mock import AsyncMock

import psycopg
import pytest

from plugins.billing.service import BillingService
from services.db import Neo4jService
from services.postgres_store import PostgresStore


DATABASE_URL = os.getenv("DATABASE_URL", "")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL nicht gesetzt")
MARKER = f"mu-{uuid.uuid4().hex[:8]}"


class _FakeResult:
	def __init__(self, rows):
		self._rows = rows

	async def data(self):
		return self._rows


class _FakeSession:
	def __init__(self, rows, calls):
		self._rows = rows
		self._calls = calls

	async def __aenter__(self):
		return self

	async def __aexit__(self, *_args):
		return None

	async def run(self, query, **params):
		self._calls.append(params)
		return _FakeResult(self._rows)


class _FakeDriver:
	def __init__(self, rows):
		self.rows = rows
		self.calls = []

	def session(self):
		return _FakeSession(self.rows, self.calls)


async def test_lookup_by_id_never_falls_back_to_the_name():
	service = Neo4jService("bolt://localhost:7687", "neo4j", "x")
	service.driver = _FakeDriver([])
	service.find_candidate_by_name = AsyncMock(return_value={"id": "falsche-person"})
	service.find_job_by_name = AsyncMock(return_value={"id": "falsche-stelle"})

	assert await service.get_candidates_for_vectormatch(["uuid-fehlt"], ["Anna Muster"]) == []
	assert await service.get_jobs_for_vectormatch(["uuid-fehlt"], ["Data Engineer"]) == []
	service.find_candidate_by_name.assert_not_awaited()
	service.find_job_by_name.assert_not_awaited()
	assert service.driver.calls == [{"candidate_ids": ["uuid-fehlt"]}, {"job_ids": ["uuid-fehlt"]}]


@pytest.fixture
async def seeded():
	store = PostgresStore(DATABASE_URL)
	await store.ensure_schema()
	async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as connection:
		candidate = await (await connection.execute(
			"INSERT INTO candidates (name, skills) VALUES (%s, 'Python, SQL') RETURNING id, uuid::text", (f"Manuel Manuell {MARKER}",)
		)).fetchone()
		job = await (await connection.execute(
			"INSERT INTO jobs (title, company, location, skills, graph_job_id) VALUES (%s, 'ACME', 'Bern', 'Python; Kubernetes', 'alter-knoten') RETURNING id, uuid::text",
			(f"Data Engineer {MARKER}",),
		)).fetchone()
	yield {"store": store, "candidate_id": candidate[0], "candidate_uuid": candidate[1], "job_id": job[0], "job_uuid": job[1]}
	async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as connection:
		await connection.execute("DELETE FROM candidate_texts WHERE candidate_id = %s", (str(candidate[0]),))
		await connection.execute("DELETE FROM candidates WHERE id = %s", (candidate[0],))
		await connection.execute("DELETE FROM jobs WHERE id = %s", (job[0],))


@needs_db
async def test_vectormatch_resolves_postgres_ids_to_uuids_and_reports_missing(app_module, api_client, monkeypatch, seeded):
	monkeypatch.setattr(BillingService, "charge", AsyncMock())
	jobs = AsyncMock(return_value=[{"id": seeded["job_uuid"], "title": "Data Engineer", "required_skills": []}])
	candidates = AsyncMock(return_value=[{"id": seeded["candidate_uuid"], "name": "Manuel", "has_skill": [], "skills": []}])
	monkeypatch.setattr(app_module.db_service, "get_jobs_for_vectormatch", jobs)
	monkeypatch.setattr(app_module.db_service, "get_candidates_for_vectormatch", candidates)

	response = await api_client.post("/match/vectormatch", json={
		"jobIds": [seeded["job_id"]],
		"cvIds": [seeded["candidate_id"], "0b7a7e55-0000-4000-8000-000000000000"],
		"engine": "python",
	})
	assert response.status_code == 200
	body = response.json()
	# PostgreSQL-IDs wurden ueber die UUID gesucht.
	assert jobs.await_args.args[0] == [seeded["job_uuid"]]
	assert candidates.await_args.args[0] == [seeded["candidate_uuid"], "0b7a7e55-0000-4000-8000-000000000000"]
	assert body["matrix"][0]["candidateId"] == seeded["candidate_uuid"]
	assert body["missingCandidateIds"] == ["0b7a7e55-0000-4000-8000-000000000000"]
	assert body["missingJobIds"] == []


@needs_db
async def test_vectormatch_explains_when_no_candidate_is_in_neo4j(app_module, api_client, monkeypatch, seeded):
	monkeypatch.setattr(BillingService, "charge", AsyncMock())
	monkeypatch.setattr(app_module.db_service, "get_jobs_for_vectormatch", AsyncMock(return_value=[{"id": seeded["job_uuid"], "title": "x"}]))
	monkeypatch.setattr(app_module.db_service, "get_candidates_for_vectormatch", AsyncMock(return_value=[]))

	response = await api_client.post("/match/vectormatch", json={"jobIds": [seeded["job_id"]], "cvIds": [seeded["candidate_id"]]})
	assert response.status_code == 404
	detail = response.json()["detail"]
	assert detail["error"] == "Keiner der angegebenen Bewerber ist in Neo4j vorhanden"
	assert detail["missingCandidateIds"] == [str(seeded["candidate_id"])]


@needs_db
async def test_sync_jobs_writes_the_uuid_node_and_removes_the_old_one(app_module, api_client, monkeypatch, seeded):
	monkeypatch.setattr(app_module, "postgres_store", seeded["store"])
	upsert = AsyncMock()
	delete = AsyncMock(return_value=1)
	monkeypatch.setattr(app_module.db_service, "upsert_job", upsert)
	monkeypatch.setattr(app_module.db_service, "delete_job", delete)
	monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.1]))
	monkeypatch.setattr(app_module, "_build_skill_embeddings", AsyncMock(return_value={}))

	response = await api_client.post("/sync/jobs", json={"job_ids": [seeded["job_id"]]})
	assert response.status_code == 200
	assert response.json() == {"synced": 1, "failed": 0, "removed_stale_nodes": 1, "errors": []}
	assert upsert.await_args.kwargs["job_id"] == seeded["job_uuid"]
	profile = upsert.await_args.kwargs["profile"]
	assert [skill.name for skill in profile.required_skills] == ["Python", "Kubernetes"]
	assert profile.company == "ACME"
	delete.assert_awaited_once_with("alter-knoten")
	async with await psycopg.AsyncConnection.connect(DATABASE_URL) as connection:
		row = await (await connection.execute("SELECT graph_job_id FROM jobs WHERE id = %s", (seeded["job_id"],))).fetchone()
	assert row[0] == seeded["job_uuid"]


@needs_db
async def test_sync_candidates_creates_the_missing_cv_text_for_manual_candidates(app_module, api_client, monkeypatch, seeded):
	monkeypatch.setattr(app_module, "postgres_store", seeded["store"])
	monkeypatch.setattr(app_module.db_service, "upsert_candidate", AsyncMock())
	monkeypatch.setattr(app_module.llm_service, "create_embedding", AsyncMock(return_value=[0.1]))
	monkeypatch.setattr(app_module, "_build_skill_embeddings", AsyncMock(return_value={}))
	anonymize = AsyncMock()
	monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize)

	response = await api_client.post("/sync/candidates", json={"candidate_ids": [seeded["candidate_id"]]})
	assert response.status_code == 200
	assert response.json()["synced"] == 1
	text = await seeded["store"].get_candidate_text(str(seeded["candidate_id"]))
	assert text is not None
	assert f"Manuel Manuell {MARKER}" in text["original_text"]
	assert "Python" in text["original_text"]
	anonymize.assert_awaited_once_with(str(seeded["candidate_id"]))
