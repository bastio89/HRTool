from __future__ import annotations

from models import JobProfileExtraction

from services.postgres_store import PostgresStore


async def persist_job_profile(
	*,
	postgres_store: PostgresStore,
	job_id: str | None,
	raw_text: str,
	profile: JobProfileExtraction,
	source: str | None = None,
	source_hash: str | None = None,
	profile_hash: str | None = None,
) -> dict:
	"""Legt die Stelle an oder findet die vorhandene (gleiche URL oder Titel +
	Firma + Ort). Liefert {"id", "uuid", "duplicate"}; die UUID ist zugleich die
	ID des Neo4j-Knotens."""
	return await postgres_store.upsert_job(
		job_id=job_id,
		raw_text=raw_text,
		profile=profile,
		source=source,
		source_hash=source_hash,
		profile_hash=profile_hash,
	)