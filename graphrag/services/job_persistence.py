from __future__ import annotations

from models import JobProfileExtraction

from services.postgres_store import PostgresStore


async def persist_job_profile(
	*,
	postgres_store: PostgresStore,
	job_id: str,
	raw_text: str,
	profile: JobProfileExtraction,
	source: str | None = None,
	source_hash: str | None = None,
	profile_hash: str | None = None,
) -> int:
	return await postgres_store.upsert_job(
		job_id=job_id,
		raw_text=raw_text,
		profile=profile,
		source=source,
		source_hash=source_hash,
		profile_hash=profile_hash,
	)