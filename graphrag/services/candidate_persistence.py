from __future__ import annotations

from collections.abc import Awaitable, Callable
import logging
from typing import Any
from uuid import uuid4

import psycopg

from models import CandidateProfileExtraction

from services.candidate_identity import require_identity, without_identity_fields
from services.candidate_privacy import CandidatePrivacyService
from services.postgres_store import MatchingPreparationChangedError, PostgresStore

logger = logging.getLogger(__name__)


async def persist_candidate_profile(
	*,
	postgres_store: PostgresStore,
	candidate_privacy_service: CandidatePrivacyService,
	profile: CandidateProfileExtraction,
	candidate_text: str,
	source: str,
	graph_candidate_id: str | None = None,
	actor_user_id: int | None = None,
	event_key: str | None = None,
) -> dict[str, Any]:
	"""Legt den Bewerber in PostgreSQL an (Name Pflicht, Geburtsdatum
	optional; DuplicateCandidateError bei gleichem Name + Geburtsdatum) und speichert CV-Volltext
	und Anonymisierung. Liefert {"id", "uuid"}. graph_candidate_id ist nur fuer
	Altdaten gedacht; neue Neo4j-Knoten tragen die UUID des Bewerbers."""
	await postgres_store.ensure_matching_pair_schema()
	async with await psycopg.AsyncConnection.connect(postgres_store.database_url) as connection, connection.transaction():
		stored = await postgres_store.insert_candidate(profile, source=source, connection=connection)
		postgres_candidate_id = int(stored["id"])
		await postgres_store.set_candidate_graph_id(
			postgres_candidate_id, graph_candidate_id or stored["uuid"], connection=connection,
		)
		await postgres_store.store_candidate_text(
			str(postgres_candidate_id), candidate_text, candidate_name=profile.name, source=source,
			profile_json=without_identity_fields(profile.model_dump(mode="json")), connection=connection,
		)
		await candidate_privacy_service.anonymize_candidate(str(postgres_candidate_id), connection=connection)
		run_id = await postgres_store.enqueue_matching_import(
			"candidate", postgres_candidate_id, actor_user_id=actor_user_id, source=source,
			event_key=event_key if event_key is not None else f"candidate:{postgres_candidate_id}:{uuid4()}",
			connection=connection,
		)
		snapshot = await postgres_store.matching_source_snapshot("candidate", postgres_candidate_id, connection=connection)
	return {
		**stored, "matchingRunId": run_id, "matchingStatus": "queued" if actor_user_id is not None else "blocked_credits",
		"sourceRevision": snapshot["revision"],
	}


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
	actor_user_id: int | None = None,
	event_key: str | None = None,
	prepare_candidate: Callable[[int], Awaitable[str]] | None = None,
) -> dict[str, Any]:
	"""Ein Bewerber entsteht genau einmal und in beiden Datenbanken mit
	derselben ID: zuerst PostgreSQL (mit Pruefung auf Name + Geburtsdatum,
	sofern eines angegeben ist),
	danach der Neo4j-Knoten mit der UUID aus PostgreSQL. Ein Graph-Fehler
	belaesst den atomar gespeicherten Import und Auftrag zur Wiederaufbereitung."""
	require_identity(profile)
	stored = await persist_candidate_profile(
		postgres_store=postgres_store,
		candidate_privacy_service=candidate_privacy_service,
		profile=profile,
		candidate_text=candidate_text,
		source=source,
		actor_user_id=actor_user_id,
		event_key=event_key,
	)
	try:
		if prepare_candidate is not None:
			revision = await prepare_candidate(int(stored["id"]))
		else:
			async with postgres_store.matching_preparation_lock("candidate", int(stored["id"])):
				snapshot = await postgres_store.matching_source_snapshot("candidate", int(stored["id"]))
				if snapshot["revision"] != stored["sourceRevision"]:
					raise MatchingPreparationChangedError("Bewerber wurde seit dem Import geaendert.")
				embedding = await llm_service.create_embedding(without_identity_fields(profile.model_dump()), allow_fallback=False)
				skill_embeddings = await build_skill_embeddings([item.name for item in profile.skills])
				await db_service.upsert_candidate(
					candidate_id=stored["uuid"], profile=profile, embedding=embedding, skill_embeddings=skill_embeddings,
					source_hash=source_hash, profile_hash=profile_hash,
				)
				revision = await postgres_store.confirm_matching_preparation(snapshot)
	except Exception:
		logger.exception("Bewerber %s gespeichert; Graph-Aufbereitung muss wiederholt werden", stored["id"])
		return {**stored, "preparationStatus": "required", "preparationError": "graph_preparation_failed"}
	return {**stored, "preparationStatus": "ready", "preparedRevision": revision}
