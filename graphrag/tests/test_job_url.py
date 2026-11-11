"""Stellen-URL: Importe speichern den Link zur Ausschreibung (jobs.ch:
"Quelle: <Link>" im Text). Ohne URL nimmt das CRM die Rueckgabe nicht an,
und die Eindeutigkeit der Stelle haengt an der URL.

Laeuft gegen DATABASE_URL (wie in CI).
"""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from models import JobProfileExtraction
from services.job_persistence import persist_job_profile, source_url_from_text
from services.postgres_store import PostgresStore


DATABASE_URL = os.getenv("DATABASE_URL", "")
needs_db = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL nicht gesetzt")
MARKER = f"url-{uuid.uuid4().hex[:8]}"


def test_source_url_from_text():
	assert source_url_from_text("Titel\nText\n\nQuelle: https://www.jobs.ch/de/stellenangebote/detail/abc/") == "https://www.jobs.ch/de/stellenangebote/detail/abc/"
	assert source_url_from_text("  quelle: https://example.org/job/1).") == "https://example.org/job/1"
	assert source_url_from_text("Die Quelle: unbekannt") is None
	assert source_url_from_text(None) is None


@pytest.fixture
async def store():
	instance = PostgresStore(DATABASE_URL)
	await instance.ensure_schema()
	yield instance
	async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as connection:
		await connection.execute("DELETE FROM jobs WHERE title LIKE %s", (f"%{MARKER}%",))


async def _url(job_id: int) -> str | None:
	async with await psycopg.AsyncConnection.connect(DATABASE_URL) as connection:
		row = await (await connection.execute("SELECT url FROM jobs WHERE id = %s", (job_id,))).fetchone()
	return row[0]


@needs_db
async def test_import_stores_the_link_and_fills_it_in_for_an_existing_job(store):
	link = f"https://www.jobs.ch/de/stellenangebote/detail/{MARKER}/"
	profile = JobProfileExtraction(title=f"Data Engineer {MARKER}", company="Quelle AG", location="Basel")

	stored = await persist_job_profile(postgres_store=store, job_id=None, raw_text=f"Data Engineer\n\nQuelle: {link}", profile=profile, source="jobs.ch")
	assert stored["duplicate"] is False
	assert await _url(stored["id"]) == link

	# Dieselbe Stelle erneut: gefunden ueber die URL, nicht doppelt angelegt.
	again = await persist_job_profile(postgres_store=store, job_id=None, raw_text="anderer Text", profile=profile.model_copy(update={"location": "Bern"}), url=link)
	assert again == {"id": stored["id"], "uuid": stored["uuid"], "duplicate": True}

	# Eine vorhandene Stelle ohne URL bekommt sie beim naechsten Import.
	other = JobProfileExtraction(title=f"Analyst {MARKER}", company="Quelle AG", location="Zug")
	first = await persist_job_profile(postgres_store=store, job_id=None, raw_text="ohne Link", profile=other)
	assert await _url(first["id"]) is None
	second = await persist_job_profile(postgres_store=store, job_id=None, raw_text="ohne Link", profile=other, url=f"{link}analyst")
	assert second["id"] == first["id"]
	assert await _url(first["id"]) == f"{link}analyst"
