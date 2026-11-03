from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from models import CandidateProfileExtraction

from services.candidate_identity import require_identity, without_identity_fields
from services.candidate_privacy import CandidatePrivacyService
from services.postgres_store import PostgresStore


async def persist_candidate_profile(
	*,
	postgres_store: PostgresStore,
	candidate_privacy_service: CandidatePrivacyService,
	profile: CandidateProfileExtraction,
	candidate_text: str,
	source: str,
	graph_candidate_id: str | None = None,
) -> dict[str, Any]:
	"""Legt den Bewerber in PostgreSQL an (Name + Geburtsdatum Pflicht,
	DuplicateCandidateError bei vorhandener Person) und speichert CV-Volltext
	und Anonymisierung. Liefert {"id", "uuid"}. graph_candidate_id ist nur fuer
	Altdaten gedacht; neue Neo4j-Knoten tragen die UUID des Bewerbers."""
	stored = await postgres_store.insert_candidate(profile, source=source)
	postgres_candidate_id = int(stored["id"])
	await postgres_store.set_candidate_graph_id(postgres_candidate_id, graph_candidate_id or stored["uuid"])
	await postgres_store.store_candidate_text(
		str(postgres_candidate_id),
		candidate_text,
		candidate_name=profile.name,
		source=source,
		# Das Geburtsdatum bleibt aus den Daten heraus, die ins KI-Matching gehen.
		profile_json=without_identity_fields(profile.model_dump(mode="json")),
	)
	await candidate_privacy_service.anonymize_candidate(str(postgres_candidate_id))
	return stored


async def create_candidate(
	*,
	postgres_store: PostgresStore,
	candidate_privacy_service: CandidatePrivacyService,
	db_service: Any,
	llm_service: Any,
	build_skill_embeddings: Callable[[list[str]], Awaitable[dict[str, list[float]]]],
	profile: CandidateProfileExtraction,
	candidate_text: str,
	source: str,
	source_hash: str | None = None,
	profile_hash: str | None = None,
) -> dict[str, Any]:
	"""Ein Bewerber entsteht genau einmal und in beiden Datenbanken mit
	derselben ID: zuerst PostgreSQL (mit Pruefung auf Name + Geburtsdatum),
	danach der Neo4j-Knoten mit der UUID aus PostgreSQL. Scheitert Neo4j, wird
	der PostgreSQL-Datensatz wieder entfernt."""
	require_identity(profile)
	# Embeddings vorab erzeugen: scheitert das, ist noch nichts gespeichert.
	embedding = await llm_service.create_embedding(without_identity_fields(profile.model_dump()), allow_fallback=False)
	skill_embeddings = await build_skill_embeddings([item.name for item in profile.skills])

	stored = await persist_candidate_profile(
		postgres_store=postgres_store,
		candidate_privacy_service=candidate_privacy_service,
		profile=profile,
		candidate_text=candidate_text,
		source=source,
	)
	try:
		await db_service.upsert_candidate(
			candidate_id=stored["uuid"],
			profile=profile,
			embedding=embedding,
			skill_embeddings=skill_embeddings,
			source_hash=source_hash,
			profile_hash=profile_hash,
		)
	except Exception:
		await postgres_store.delete_candidate_row(int(stored["id"]))
		raise
	return stored
