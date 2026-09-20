from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, Request, Response, UploadFile

from config import settings
from legacy_api import create_legacy_router
from models import (
	CandidateIngestRequest,
	CandidatePrivacyRequest,
	CandidatePrivacyResponse,
	CandidateProfileExtraction,
	AiUsageMetrics,
	HealthResponse,
	IngestResponse,
	JobIngestRequest,
	JobIngestResponse,
	JobProfileExtraction,
	MatchCandidateResponse,
	MatchResponse,
)
from services.candidate_privacy import CandidatePrivacyService
from services.candidate_extraction import extract_candidate_profile
from services.candidate_persistence import persist_candidate_profile
from services.db import Neo4jService
from matching_api import create_matching_router
from services.model_config import ModelConfigService
from services.prompt_service import PromptService
from services.job_persistence import persist_job_profile
from services.llm import LLMService
from services.document_text import ALLOWED_DOCUMENT_TYPES, extract_document_text
from services.pdf import PDFService
from services.postgres_store import PostgresStore
from services.candidate_text_renderer import render_candidate_fulltext
from plugins.registry import build_plugins
from prompts_api import create_prompts_router
pdf_service = PDFService()
postgres_store = PostgresStore(settings.database_url)
candidate_privacy_service = CandidatePrivacyService(postgres_store)
prompt_service = PromptService(postgres_store)
model_config_service = ModelConfigService(
	postgres_store,
	default_chat_base_url="",
	default_chat_model=settings.resolved_chat_model,
	default_embedding_model=settings.initial_embedding_model or settings.resolved_embedding_model,
	default_provider="auto",
	default_api_key=settings.resolved_api_key,
	default_reasoning_level=settings.resolved_reasoning_level,
)
llm_service = LLMService(
	provider=settings.resolved_provider,
	base_url=settings.resolved_ai_base_url,
	api_key=settings.resolved_api_key,
	chat_model=settings.resolved_chat_model,
	embedding_model=settings.resolved_embedding_model,
	embedding_dimensions=settings.embedding_dimensions,
		enable_reasoning=settings.resolved_reasoning_level != "none",
	reasoning_level=settings.resolved_reasoning_level,
	enable_parse_latency_aggregation=settings.enable_parse_latency_aggregation,
	parse_latency_window_size=settings.parse_latency_window_size,
	parse_latency_log_every=settings.parse_latency_log_every,
	enable_call_logging=True,
	database_url=settings.database_url,
	model_config_service=model_config_service,
	prompt_service=prompt_service,
)
db_service = Neo4jService(
	uri=settings.neo4j_uri,
	user=settings.neo4j_user,
	password=settings.neo4j_password,
	postgres_store=postgres_store,
)
logger = logging.getLogger(__name__)
plugins = build_plugins(settings, postgres_store, llm_service, db_service)


def _normalized_text_hash(text: str | None) -> str | None:
	if not isinstance(text, str):
		return None
	normalized = " ".join(text.split()).strip()
	if not normalized:
		return None
	return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _normalized_profile_hash(profile: Any) -> str | None:
	try:
		payload = profile.model_dump(mode="json") if hasattr(profile, "model_dump") else profile
		serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
		return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
	except Exception:
		return None


@asynccontextmanager
async def lifespan(_: FastAPI):
	if not (settings.graphrag_api_key or "").strip():
		logging.getLogger(__name__).warning(
			"GRAPHRAG_API_KEY ist nicht gesetzt - die API nimmt Anfragen ohne Authentifizierung entgegen."
		)
	await postgres_store.ensure_schema()
	await postgres_store.ensure_setting_if_blank("ai_embedding_model", settings.initial_embedding_model)
	await postgres_store.ensure_setting("ai_reasoning_level", settings.resolved_reasoning_level)
	await postgres_store.seed_default_prompts()
	model_config_service.invalidate()
	prompt_service.invalidate()
	await postgres_store.ensure_setting_if_blank("plugin.linkedin.enabled", "1" if settings.linkedin_plugin_enabled else "0")
	await postgres_store.ensure_setting_if_blank("plugin.jobs_ch.enabled", "1" if settings.jobs_ch_plugin_enabled else "0")
	yield
	await db_service.close()
	await llm_service.close()


app = FastAPI(
	title="HR Graph Matching API",
	description="High-efficiency 3-stage candidate-job matching service",
	version="1.0.0",
	lifespan=lifespan,
)

app.include_router(create_matching_router(llm_service, db_service))
app.include_router(create_legacy_router(postgres_store))
app.include_router(create_prompts_router(prompt_service))
for plugin in plugins:
	plugin.register(app)


# Bis hierher war kein einziger Endpunkt geschuetzt, waehrend nginx den Dienst
# unter /graphrag-api/ nach aussen durchreicht. /candidates/deanon hebt die
# Anonymisierung von Bewerbern auf, /ingest und /match verarbeiten
# Personendaten - nichts davon ruft der Browser je auf, das macht
# ausschliesslich das Node-Backend.
#
# OPEN_PATHS: Statuspruefungen, die ohne Schluessel erreichbar bleiben muessen.
# BROWSER_PATHS: Browser-Aufrufe des Frontends laufen heute nur noch fuer den
# CV-Parser direkt zum Dienst; LinkedIn wird ueber den Node-Proxy abgewickelt.
OPEN_PATHS = {"/health", "/health/live", "/docs", "/openapi.json", "/redoc"}
BROWSER_PATHS = {"/cv-parser/parse"}


@app.middleware("http")
async def require_api_key(request: Request, call_next):
	api_key = (settings.graphrag_api_key or "").strip()
	path = request.url.path.rstrip("/") or "/"
	if not api_key or path in OPEN_PATHS or path in BROWSER_PATHS:
		return await call_next(request)
	if request.headers.get("x-api-key") != api_key:
		return Response(
			content='{"detail":"Invalid or missing API key"}',
			status_code=401,
			media_type="application/json",
		)
	return await call_next(request)


async def _extract_raw_text(raw_text: str | None, file: UploadFile | None, is_candidate: bool) -> str:
	if raw_text and raw_text.strip():
		return raw_text.strip()
	if file is not None:
		data = await file.read()
		file_name = (file.filename or "").lower()
		file_content_type = (file.content_type or "").lower()
		is_pdf = file_name.endswith(".pdf") or file_content_type == "application/pdf"

		if is_pdf:
			if not is_candidate:
				raise HTTPException(status_code=400, detail="PDF upload is only supported for candidate CV ingestion.")
			try:
				text = pdf_service.extract_text(data)
			except ValueError as exc:
				raise HTTPException(status_code=400, detail=str(exc)) from exc
		else:
			text = data.decode("utf-8", errors="ignore").strip()

		if text:
			return text
	raise HTTPException(status_code=400, detail="Provide either raw_text or a non-empty file.")


async def _extract_candidate_payload_from_request(request: Request) -> tuple[str | None, CandidateProfileExtraction | None]:
	content_type = request.headers.get("content-type", "").lower()

	raw_text: str | None = None
	profile: CandidateProfileExtraction | None = None
	file: UploadFile | None = None

	if "application/json" in content_type:
		payload_data = await request.json()
		payload = CandidateIngestRequest.model_validate(payload_data)
		raw_text = payload.raw_text
		profile = payload.profile
	elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
		form = await request.form()
		form_raw_text = form.get("raw_text")
		form_file = form.get("file")

		if isinstance(form_raw_text, str):
			raw_text = form_raw_text
		if form_file is not None and hasattr(form_file, "read"):
			file = form_file
	elif content_type:
		raise HTTPException(
			status_code=415,
			detail="Unsupported content type. Use application/json or multipart/form-data.",
		)

	if profile is not None:
		return raw_text, profile

	text = await _extract_raw_text(raw_text=raw_text, file=file, is_candidate=True)
	validated = CandidateIngestRequest.model_validate({"raw_text": text})
	return validated.raw_text, None


async def _extract_job_payload_from_request(request: Request) -> tuple[str | None, JobProfileExtraction | None]:
	content_type = request.headers.get("content-type", "").lower()

	raw_text: str | None = None
	profile: JobProfileExtraction | None = None
	file: UploadFile | None = None

	if "application/json" in content_type:
		payload_data = await request.json()
		payload = JobIngestRequest.model_validate(payload_data)
		raw_text = payload.raw_text
		profile = payload.profile
	elif content_type.startswith("text/plain") or not content_type:
		body = (await request.body()).decode("utf-8", errors="ignore").strip()
		raw_text = body or None
	elif "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
		form = await request.form()
		form_raw_text = form.get("raw_text")
		form_file = form.get("file")

		if isinstance(form_raw_text, str):
			raw_text = form_raw_text
		if form_file is not None and hasattr(form_file, "read"):
			file = form_file
	elif content_type:
		raise HTTPException(
			status_code=415,
			detail="Unsupported content type. Use application/json or multipart/form-data.",
		)

	if profile is not None:
		return raw_text, profile

	if raw_text is None and file is None:
		return None, None

	text = await _extract_raw_text(raw_text=raw_text, file=file, is_candidate=False)
	validated = JobIngestRequest.model_validate({"raw_text": text})
	return validated.raw_text, None


async def _build_skill_embeddings(skill_names: list[str]) -> dict[str, list[float]]:
	unique_names = sorted({name.strip() for name in skill_names if isinstance(name, str) and name.strip()})
	if not unique_names:
		return {}

	vectors = await asyncio.gather(
		*(
			llm_service.create_embedding(
				{
					"entity": "skill",
					"name": skill_name,
				},
				allow_fallback=False,
			)
			for skill_name in unique_names
		)
	)
	return {name.lower(): vector for name, vector in zip(unique_names, vectors)}


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
	return HealthResponse(ai_usage=await postgres_store.read_ai_usage())


@app.get("/health/live")
async def health_live() -> dict[str, str]:
	return {"status": "ok"}


@app.post("/candidates/anon", response_model=CandidatePrivacyResponse)
async def anonymize_candidate(request: CandidatePrivacyRequest) -> CandidatePrivacyResponse:
	try:
		return CandidatePrivacyResponse.model_validate(
			await candidate_privacy_service.anonymize_candidate(request.candidate_id)
		)
	except LookupError as exc:
		raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/candidates/deanon", response_model=CandidatePrivacyResponse)
async def deanonymize_candidate(request: CandidatePrivacyRequest) -> CandidatePrivacyResponse:
	try:
		return CandidatePrivacyResponse.model_validate(
			await candidate_privacy_service.deanonymize_candidate(request.candidate_id)
		)
	except LookupError as exc:
		raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post(
	"/cv-parser/parse",
	tags=["CV Parser"],
	summary="CV parsen und optional in Neo4j speichern",
	responses={
		400: {"description": "Keine Datei oder ungültiges Format"},
		422: {"description": "Kein lesbarer Text gefunden"},
		502: {"description": "CV-Parsing fehlgeschlagen"},
		503: {"description": "Neo4j-Speicherung fehlgeschlagen"},
	},
)
async def parse_cv(
	file: list[UploadFile] | None = File(default=None),
	persist: bool = Query(default=False),
) -> dict[str, Any]:
	files = file or []
	if not files:
		raise HTTPException(status_code=400, detail="Keine Datei hochgeladen")
	if len(files) > 10:
		raise HTTPException(status_code=400, detail="Maximal 10 Dateien erlaubt")

	filenames: list[str] = []
	text_parts: list[str] = []
	for uploaded_file in files:
		filename = uploaded_file.filename or "unbenannt"
		content_type = (uploaded_file.content_type or "application/octet-stream").lower()
		if content_type not in ALLOWED_DOCUMENT_TYPES:
			raise HTTPException(status_code=400, detail="Nur PDF, Word und Bilddateien erlaubt")

		data = await uploaded_file.read(20 * 1024 * 1024 + 1)
		if len(data) > 20 * 1024 * 1024:
			raise HTTPException(status_code=400, detail="Datei zu groß (max. 20 MB)")
		filenames.append(filename)
		try:
			if content_type == "application/pdf":
				text = pdf_service.extract_text(data)
			else:
				text = extract_document_text(data, content_type)
		except ValueError as exc:
			logger.warning("Could not extract text from %s: %s", filename, exc)
			continue
		if len(text.strip()) > 5:
			text_parts.append(text.strip())

	combined_text = "\n\n".join(text_parts)
	if len(combined_text.strip()) < 20:
		raise HTTPException(
			status_code=422,
			detail="Kein lesbarer Text in den Dateien gefunden. Möglicherweise ist OCR erforderlich.",
		)

	try:
		profile = await extract_candidate_profile(llm_service, combined_text)
	except Exception as exc:
		logger.exception("Candidate parsing failed")
		raise HTTPException(status_code=502, detail=f"Candidate parsing failed: {exc}") from exc

	graph_candidate_id: str | None = None
	postgres_candidate_id: int | None = None
	if persist:
		graph_candidate_id = str(uuid4())
		try:
			embedding = await llm_service.create_embedding(profile.model_dump(), allow_fallback=False)
			skill_embeddings = await _build_skill_embeddings([item.name for item in profile.skills])
			await db_service.upsert_candidate(
				candidate_id=graph_candidate_id,
				profile=profile,
				embedding=embedding,
				skill_embeddings=skill_embeddings,
			)
			candidate_text = combined_text or render_candidate_fulltext(
				profile.model_dump(mode="json"),
				work_history=[item.model_dump(mode="json") for item in profile.work_history],
				education_history=[item.model_dump(mode="json") for item in profile.education_history],
			)
			postgres_candidate_id = await persist_candidate_profile(
				postgres_store=postgres_store,
				candidate_privacy_service=candidate_privacy_service,
				profile=profile,
				candidate_text=candidate_text,
				source="CV-Import",
			)
		except Exception as exc:
			logger.exception("Candidate persistence failed")
			raise HTTPException(status_code=503, detail=f"Candidate persistence failed: {exc}") from exc

	profile_payload = profile.model_dump(mode="json")
	candidate_payload = {**profile_payload, **({"id": postgres_candidate_id} if postgres_candidate_id else {})}
	graph_rag = {
		"id": graph_candidate_id,
		"message": "Candidate ingested successfully" if persist else "Candidate parsed successfully",
		"profile": profile_payload,
		"persisted": persist,
	}
	return {
		"success": True,
		"filenames": filenames,
		"filename": filenames[0],
		"candidate": candidate_payload,
		"profile": profile_payload,
		"localCandidate": candidate_payload if postgres_candidate_id else None,
		"graphRag": graph_rag,
		"storage": {"postgres": postgres_candidate_id is not None, "neo4j": graph_candidate_id is not None},
		"textLength": len(combined_text),
		"persisted": persist,
		"parsingMethod": profile.parsing_method,
	}


@app.post("/ingest/candidate", response_model=IngestResponse)
async def ingest_candidate(
	request: Request,
) -> IngestResponse:
	text, provided_profile = await _extract_candidate_payload_from_request(request=request)
	try:
		if provided_profile is None:
			if text is None:
				raise HTTPException(status_code=400, detail="Provide either raw_text or profile.")
			profile = await extract_candidate_profile(llm_service, text)
		else:
			profile = provided_profile
	except Exception as exc:
		logger.exception("Candidate parsing failed")
		raise HTTPException(status_code=502, detail=f"Candidate parsing failed: {exc}") from exc

	text_hash = _normalized_text_hash(text)
	profile_hash = _normalized_profile_hash(profile)
	duplicate_candidate = None
	if text_hash:
		duplicate_candidate = await db_service.find_candidate_by_source_hash(text_hash)
	if duplicate_candidate is None and profile_hash:
		duplicate_candidate = await db_service.find_candidate_by_profile_hash(profile_hash)
	candidate_id = duplicate_candidate["id"] if duplicate_candidate else str(uuid4())

	try:
		embedding = await llm_service.create_embedding(profile.model_dump(), allow_fallback=False)
		skill_embeddings = await _build_skill_embeddings([item.name for item in profile.skills])
	except Exception as exc:
		logger.exception("Candidate embedding creation failed")
		raise HTTPException(status_code=502, detail=f"Candidate embedding creation failed: {exc}") from exc

	try:
		await db_service.upsert_candidate(
			candidate_id=candidate_id,
			profile=profile,
			embedding=embedding,
			skill_embeddings=skill_embeddings,
			source_hash=text_hash,
			profile_hash=profile_hash,
		)
		candidate_text = text or render_candidate_fulltext(
			profile.model_dump(mode="json"),
			work_history=[item.model_dump(mode="json") for item in profile.work_history],
			education_history=[item.model_dump(mode="json") for item in profile.education_history],
		)
		await persist_candidate_profile(
			postgres_store=postgres_store,
			candidate_privacy_service=candidate_privacy_service,
			profile=profile,
			candidate_text=candidate_text,
			source="Candidate-Ingest",
		)
	except Exception as exc:
		logger.exception("Candidate persistence failed")
		raise HTTPException(status_code=503, detail=f"Candidate persistence failed: {exc}") from exc

	return IngestResponse(id=candidate_id, message="Candidate ingested successfully")


@app.post("/add/job/", response_model=JobIngestResponse, status_code=201)
@app.post("/ingest/job", response_model=JobIngestResponse)
async def ingest_job(
	request: Request,
	persist: str = Query(default="true"),
) -> JobIngestResponse:
	text, provided_profile = await _extract_job_payload_from_request(request=request)
	try:
		if provided_profile is None:
			if text is None:
				raise HTTPException(status_code=400, detail="Provide either raw_text or profile.")
			logger.warning("ingest_job: calling parse_job_description (chars=%d)", len(text))
			profile = await llm_service.parse_job_description(text)
		else:
			if text is None:
				profile = provided_profile
			else:
				logger.warning("ingest_job: parsing raw_text to enrich provided profile (chars=%d)", len(text))
				parsed_profile = await llm_service.parse_job_description(text)
				merged = parsed_profile.model_dump()
				override_fields = (
					"title",
					"department",
					"company",
					"recruiter_company",
					"employer_company",
					"location",
					"employment_type",
				)
				for field_name in override_fields:
					value = getattr(provided_profile, field_name)
					if value not in (None, ""):
						merged[field_name] = value
				for field_name in ("required_skills", "required_languages", "required_degrees", "industries"):
					value = getattr(provided_profile, field_name)
					if value:
						merged[field_name] = value
				profile = JobProfileExtraction.model_validate(merged)
	except Exception as exc:
		logger.exception("Job parsing failed")
		raise HTTPException(status_code=502, detail=f"Job parsing failed: {exc}") from exc
	logger.warning(
		"ingest_job: parse_job_description returned title=%r required_skills=%d",
		profile.title,
		len(profile.required_skills),
	)

	text_hash = _normalized_text_hash(text)
	profile_hash = _normalized_profile_hash(profile)
	duplicate_job = None
	try:
		if text_hash:
			duplicate_job = await db_service.find_job_by_source_hash(text_hash)
		if duplicate_job is None and profile_hash:
			duplicate_job = await db_service.find_job_by_profile_hash(profile_hash)
	except Exception:
		logger.warning("ingest_job duplicate lookup failed; continuing without dedupe", exc_info=True)
		duplicate_job = None

	persist_value = str(persist or "").strip().lower()
	persist_postgres = persist_value not in {"0", "false", "no", "none", "off", "neo4j", "graph", "neo4j_only", "graph_only"}
	persist_neo4j = persist_value not in {"0", "false", "no", "none", "off", "postgres", "sql", "db"}
	if persist_value in {"neo4j", "graph", "neo4j_only", "graph_only"}:
		persist_postgres = False
		persist_neo4j = True
	elif persist_value in {"postgres", "sql", "db"}:
		persist_postgres = True
		persist_neo4j = False
	elif persist_value in {"0", "false", "no", "none", "off"}:
		persist_postgres = False
		persist_neo4j = False
	else:
		persist_postgres = True
		persist_neo4j = True

	job_id = duplicate_job["id"] if duplicate_job else str(uuid4())
	if not persist_postgres and not persist_neo4j:
		return JobIngestResponse(id=job_id, message="Job ingested successfully", profile=profile, persisted=False)

	try:
		embedding = await llm_service.create_embedding(profile.model_dump(), allow_fallback=False)
		skill_embeddings = await _build_skill_embeddings([item.name for item in profile.required_skills])
	except Exception as exc:
		logger.exception("Job embedding creation failed")
		raise HTTPException(status_code=502, detail=f"Job embedding creation failed: {exc}") from exc

	if persist_postgres:
		try:
			await persist_job_profile(
				postgres_store=postgres_store,
				job_id=job_id,
				raw_text=text or "",
				profile=profile,
				source_hash=text_hash,
				profile_hash=profile_hash,
			)
		except Exception as exc:
			logger.exception("Job PostgreSQL persistence failed")
			raise HTTPException(status_code=503, detail=f"Job PostgreSQL persistence failed: {exc}") from exc

	if persist_neo4j:
		try:
			await db_service.upsert_job(
				job_id=job_id,
				profile=profile,
				embedding=embedding,
				skill_embeddings=skill_embeddings,
				source_hash=text_hash,
				profile_hash=profile_hash,
			)
		except Exception as exc:
			logger.exception("Job persistence failed")
			raise HTTPException(status_code=503, detail=f"Job persistence failed: {exc}") from exc

	return JobIngestResponse(id=job_id, message="Job ingested successfully", profile=profile, persisted=True)


@app.post("/match/{job_id}", response_model=MatchResponse)
async def match_candidates(job_id: str) -> MatchResponse:
	job_profile = await db_service.get_job_profile(job_id)
	if not job_profile:
		raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

	stage1 = await db_service.stage1_filter_candidates(job_id=job_id, limit=100)
	if not stage1:
		return MatchResponse(job_id=job_id, stage1_count=0, stage2_count=0, matches=[])

	stage2 = await db_service.stage2_rank_candidates(
		job_profile=job_profile,
		candidate_ids=[item.id for item in stage1],
		limit=10,
	)
	if not stage2:
		return MatchResponse(job_id=job_id, stage1_count=len(stage1), stage2_count=0, matches=[])

	reranked = await llm_service.rerank_candidates(
		job_profile={
			"id": job_profile["id"],
			"title": job_profile["title"],
			"department": job_profile["department"],
			"company": job_profile.get("company"),
			"location": job_profile["location"],
			"employment_type": job_profile.get("employment_type"),
			"required_skills": job_profile["required_skills"],
			"required_languages": job_profile.get("required_languages", []),
			"required_degrees": job_profile.get("required_degrees", []),
			"industries": job_profile.get("industries", []),
		},
		candidates=[
			{
				"id": item.id,
				"name": item.name,
				"location": item.location,
				"experience_years": item.experience_years,
				"skills": item.skills,
				"preferred_roles": item.preferred_roles,
				"vector_score": item.vector_score,
				"jaccard_score": item.jaccard_score,
				"combined_score": item.combined_score,
			}
			for item in stage2
		],
	)

	stage2_map = {item.id: item for item in stage2}
	matches: list[MatchCandidateResponse] = []
	for item in reranked.ranked_candidates:
		stage2_profile = stage2_map.get(item.candidate_id)
		if stage2_profile is None:
			continue
		matches.append(
			MatchCandidateResponse(
				candidate_id=item.candidate_id,
				score=item.score,
				explanation=item.explanation,
				vector_score=stage2_profile.vector_score,
				jaccard_score=stage2_profile.jaccard_score,
				combined_score=stage2_profile.combined_score,
				profile={
					"name": stage2_profile.name,
					"location": stage2_profile.location,
					"experience_years": stage2_profile.experience_years,
					"skills": stage2_profile.skills,
					"preferred_roles": stage2_profile.preferred_roles,
				},
			)
		)

	matches.sort(key=lambda m: m.score, reverse=True)
	return MatchResponse(
		job_id=job_id,
		stage1_count=len(stage1),
		stage2_count=len(stage2),
		matches=matches,
	)
