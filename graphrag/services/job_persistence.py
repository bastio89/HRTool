from __future__ import annotations

import re
from uuid import uuid4

import psycopg

from models import JobProfileExtraction

from services.postgres_store import PostgresStore


# jobs.ch-Importe (Text und PDF) enden mit "Quelle: <Link zur Ausschreibung>".
_SOURCE_URL = re.compile(r"^[ \t]*Quelle:[ \t]*(https?://\S+)", re.IGNORECASE | re.MULTILINE)


def source_url_from_text(text: str | None) -> str | None:
	"""Link zur Ausschreibung aus dem Stellentext ("Quelle: https://...") oder None."""
	match = _SOURCE_URL.search(text or "")
	return match.group(1).rstrip(".,;)") if match else None


async def persist_job_profile(
	*,
	postgres_store: PostgresStore,
	job_id: str | None,
	raw_text: str,
	profile: JobProfileExtraction,
	source: str | None = None,
	source_hash: str | None = None,
	profile_hash: str | None = None,
	url: str | None = None,
	actor_user_id: int | None = None,
	event_key: str | None = None,
) -> dict:
	"""Legt die Stelle an oder findet die vorhandene (gleiche URL oder Titel +
	Firma + Ort). Liefert {"id", "uuid", "duplicate"}; die UUID ist zugleich die
	ID des Neo4j-Knotens. url ist der Link zur Ausschreibung; ohne Angabe wird
	er aus "Quelle: ..." im Text gelesen."""
	await postgres_store.ensure_matching_pair_schema()
	async with await psycopg.AsyncConnection.connect(postgres_store.database_url) as connection, connection.transaction():
		stored = await postgres_store.upsert_job(
			job_id=job_id, raw_text=raw_text, profile=profile, source=source,
			source_hash=source_hash, profile_hash=profile_hash,
			url=url or source_url_from_text(raw_text), connection=connection,
		)
		run_id = None
		if stored["changed"]:
			run_id = await postgres_store.enqueue_matching_import(
				"job", stored["id"], actor_user_id=actor_user_id, source=source or "Job-Import",
				event_key=event_key if event_key is not None else f"job:{stored['id']}:{uuid4()}",
				connection=connection,
			)
	return {
		**stored, "matchingRunId": run_id,
		"matchingStatus": ("queued" if actor_user_id is not None else "blocked_credits") if run_id else "not_required",
	}