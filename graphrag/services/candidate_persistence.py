from __future__ import annotations

from models import CandidateProfileExtraction

from services.candidate_privacy import CandidatePrivacyService
from services.postgres_store import PostgresStore


async def persist_candidate_profile(
	*,
	postgres_store: PostgresStore,
	candidate_privacy_service: CandidatePrivacyService,
	profile: CandidateProfileExtraction,
	candidate_text: str,
	source: str,
) -> int:
	postgres_candidate_id = await postgres_store.insert_candidate(profile, source=source)
	await postgres_store.store_candidate_text(
		str(postgres_candidate_id),
		candidate_text,
		candidate_name=profile.name,
		source=source,
		profile_json=profile.model_dump(mode="json"),
	)
	await candidate_privacy_service.anonymize_candidate(str(postgres_candidate_id))
	return postgres_candidate_id