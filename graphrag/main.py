from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fast_cvjob_parsing.app.errors import InvalidPDFError
from fast_cvjob_parsing.app.schemas import CVResponse

from config import settings
from fast_cvjob_parsing.app.router import create_cv_job_parser_router, parse_cv_bytes
from legacy_api import create_legacy_router
from models import (
	CandidateIngestRequest,
	CandidateIngestResponse,
	CandidateDeleteRequest,
	CandidateDeleteResponse,
	CandidatePrivacyRequest,
	CandidatePrivacyResponse,
	CandidateProfileExtraction,
	CandidateSyncRequest,
	CandidateSyncResponse,
	AiUsageMetrics,
	HealthResponse,
	JobIngestRequest,
	JobIngestResponse,
	JobDeleteRequest,
	JobDeleteResponse,
	JobProfileExtraction,
	MatchCandidateResponse,
	MatchResponse,
)
from services.candidate_privacy import CandidatePrivacyService
from services.candidate_extraction import extract_candidate_profile
from services.candidate_identity import (
	CandidateIdentityError,
	DuplicateCandidateError,
	ensure_birth_date,
	normalize_birth_date,
	without_identity_fields,
)
from services.candidate_persistence import create_candidate
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
from plugins.billing.service import BillingService
from plugins.registry import build_plugins
from prompts_api import create_prompts_router
from services.jwt_auth import verify_hs256_jwt
pdf_service = PDFService()
postgres_store = PostgresStore(settings.database_url)
candidate_privacy_service = CandidatePrivacyService(postgres_store)
prompt_service = PromptService(postgres_store)
billing_service = BillingService(postgres_store)
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


def _fast_cv_response_to_candidate_profile(parsed: CVResponse, filename: str) -> CandidateProfileExtraction:
	personal = parsed.personal_data
	work_history = [
		{
			"employer": item.employer,
			"position": item.job_title,
			"from_date": item.start_date,
			"to_date": item.end_date,
			"is_current": (item.end_date or "").casefold() in {"present", "current", "today", "heute", "aktuell"},
			"description": "\n".join(item.tasks_summary) or None,
		}
		for item in parsed.work_experience
	]
	education_history = [
		{
			"institution": item.institution,
			"degree": item.degree_or_title,
			"field_of_study": item.degree_or_title,
			"from_date": item.start_date,
			"to_date": item.end_date,
		}
		for item in parsed.education
	]
	skill_groups = (
		(parsed.skills.soft_skills, "SoftSkill"),
		(parsed.skills.it_skills, "HardSkill"),
		(parsed.skills.method_skills, "HardSkill"),
		(parsed.skills.tool_skills, "HardSkill"),
	)
	skills = [
		{"name": name, "category": category}
		for values, category in skill_groups
		for name in values
	]
	work_summaries = [
		" - ".join(part for part in (item.job_title, item.employer, "; ".join(item.tasks_summary)) if part)
		for item in parsed.work_experience
	]
	education_summaries = [
		" - ".join(part for part in (item.degree_or_title, item.institution) if part)
		for item in parsed.education
	]
	first_work = next((item for item in parsed.work_experience if item.employer or item.job_title), None)
	return CandidateProfileExtraction(
		name=personal.full_name or Path(filename).stem or "Unknown candidate",
		email=personal.email,
		phone=personal.phone,
		location=personal.location or personal.address,
		current_employer=first_work.employer if first_work else None,
		current_position=first_work.job_title if first_work else None,
		parsing_method="fast_gliner",
		skills=skills,
		languages=[{"name": name} for name in parsed.skills.language_skills],
		work_history=work_history,
		education_history=education_history,
		experience="\n".join(work_summaries) or None,
		education="\n".join(education_summaries) or None,
	)


def _merge_fast_cv_profiles(profiles: list[CandidateProfileExtraction]) -> CandidateProfileExtraction:
	if len(profiles) == 1:
		return profiles[0]

	merged = profiles[0].model_dump(mode="json")
	list_fields = {
		"skills", "languages", "educations", "industries", "work_history", "education_history", "preferred_roles",
	}
	joined_fields = {"experience", "education", "tags", "notes"}
	for field_name in merged:
		values = [getattr(profile, field_name) for profile in profiles]
		if field_name in list_fields:
			unique_values = []
			seen = set()
			for value in values:
				for item in value:
					key = json.dumps(item.model_dump(mode="json") if hasattr(item, "model_dump") else item, sort_keys=True)
					if key not in seen:
						seen.add(key)
						unique_values.append(item.model_dump(mode="json") if hasattr(item, "model_dump") else item)
			merged[field_name] = unique_values
		elif field_name in joined_fields:
			merged[field_name] = "\n".join(dict.fromkeys(value for value in values if value)) or None
		else:
			merged[field_name] = next((value for value in values if value not in (None, "")), None)
	return CandidateProfileExtraction.model_validate(merged)


def _has_valid_user_jwt(request: Request) -> bool:
	authorization = request.headers.get("authorization", "").strip()
	if not authorization.lower().startswith("bearer "):
		return False
	secret = (os.environ.get("JWT_SECRET") or "").strip()
	if not secret:
		return False
	token = authorization.split(" ", 1)[1].strip()
	if not token:
		return False
	try:
		verify_hs256_jwt(token, secret)
		return True
	except Exception:
		return False


@asynccontextmanager
async def lifespan(app: FastAPI):
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
	await postgres_store.ensure_setting_if_blank("plugin.billing.enabled", "1")
	await postgres_store.ensure_setting_if_blank("plugin.linkedin.enabled", "1" if settings.linkedin_plugin_enabled else "0")
	await postgres_store.ensure_setting_if_blank("plugin.jobs_ch.enabled", "1" if settings.jobs_ch_plugin_enabled else "0")
	from fast_cvjob_parsing.app.parser import ResumeJobParser

	app.state.cv_job_parser = await asyncio.to_thread(ResumeJobParser.load)
	yield
	app.state.cv_job_parser = None
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
app.include_router(create_cv_job_parser_router())
for plugin in plugins:
	plugin.register(app)


# Bis hierher war kein einziger Endpunkt geschuetzt, waehrend nginx den Dienst
# unter /graphrag-api/ nach aussen durchreicht. /candidates/deanon hebt die
# Anonymisierung von Bewerbern auf, /ingest und /match verarbeiten
# Personendaten - nichts davon ruft der Browser je auf, das macht
# ausschliesslich das Node-Backend.
#
# OPEN_PATHS: Statuspruefungen, die ohne Schluessel erreichbar bleiben muessen.
# BROWSER_PATHS: Der CV-Importer wird direkt vom Browser aufgerufen; LinkedIn
# wird ueber den Node-Proxy abgewickelt.
OPEN_PATHS = {"/health", "/health/live", "/docs", "/openapi.json", "/redoc"}
BROWSER_PATHS = {"/cv-parser/parse", "/cv-fast-importer/import", "/api/v1/parse/job"}


@app.middleware("http")
async def require_api_key(request: Request, call_next):
	api_key = (settings.graphrag_api_key or "").strip()
	path = request.url.path.rstrip("/") or "/"
	if not api_key or path in OPEN_PATHS or path in BROWSER_PATHS or _has_valid_user_jwt(request):
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


def _identity_http_error(exc: Exception) -> HTTPException:
	"""Eine Person gibt es nur einmal: 409 bei vorhandener Person, 422 wenn
	Name oder Geburtsdatum fehlen."""
	if isinstance(exc, DuplicateCandidateError):
		return HTTPException(status_code=409, detail=exc.to_detail())
	return HTTPException(status_code=422, detail={"error": str(exc), "field": getattr(exc, "field", None)})


async def _existing_identity(profile: CandidateProfileExtraction) -> dict[str, Any] | None:
	"""Vorhandene Person mit gleichem Namen und Geburtsdatum (nur Hinweis
	beim reinen Auslesen)."""
	birth_date = normalize_birth_date(profile.birth_date)
	name = str(profile.name or "").strip()
	if not name or not birth_date:
		return None
	try:
		return await postgres_store.find_candidate_by_identity(name, birth_date)
	except Exception:
		logger.warning("identity lookup failed", exc_info=True)
		return None


async def _create_candidate(profile: CandidateProfileExtraction, candidate_text: str, source: str, text_hash: str | None = None, profile_hash: str | None = None) -> dict[str, Any]:
	try:
		return await create_candidate(
			postgres_store=postgres_store,
			candidate_privacy_service=candidate_privacy_service,
			db_service=db_service,
			llm_service=llm_service,
			build_skill_embeddings=_build_skill_embeddings,
			profile=profile,
			candidate_text=candidate_text,
			source=source,
			source_hash=text_hash,
			profile_hash=profile_hash,
		)
	except (CandidateIdentityError, DuplicateCandidateError) as exc:
		raise _identity_http_error(exc) from exc
	except HTTPException:
		raise
	except Exception as exc:
		logger.exception("Candidate persistence failed")
		raise HTTPException(status_code=503, detail=f"Candidate persistence failed: {exc}") from exc


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
	summary="Veraltet: CV parsen und optional speichern",
	description="Verwenden Sie stattdessen POST /cv-fast-importer/import.",
deprecated=True,
	responses={
		400: {"description": "Keine Datei oder ungültiges Format"},
		422: {"description": "Kein lesbarer Text gefunden"},
		502: {"description": "CV-Parsing fehlgeschlagen"},
		503: {"description": "Neo4j-Speicherung fehlgeschlagen"},
	},
)
async def parse_cv(
	request: Request,
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

	await billing_service.charge(request, "-1.00", "CV_PARSE", note="CV ingest")

	try:
		profile = await extract_candidate_profile(llm_service, combined_text)
	except HTTPException:
		raise
	except Exception as exc:
		logger.exception("Candidate parsing failed")
		raise HTTPException(status_code=502, detail=f"Candidate parsing failed: {exc}") from exc

	ensure_birth_date(profile, combined_text)
	text_hash = _normalized_text_hash(combined_text)
	profile_hash = _normalized_profile_hash(profile)
	# Dieselbe Person = gleicher Name + gleiches Geburtsdatum.
	duplicate_candidate = await _existing_identity(profile)

	graph_candidate_id: str | None = None
	postgres_candidate_id: int | None = None
	if persist:
		candidate_text = combined_text or render_candidate_fulltext(
			profile.model_dump(mode="json"),
			work_history=[item.model_dump(mode="json") for item in profile.work_history],
			education_history=[item.model_dump(mode="json") for item in profile.education_history],
		)
		stored = await _create_candidate(profile, candidate_text, "CV-Import", text_hash, profile_hash)
		graph_candidate_id = stored["uuid"]
		postgres_candidate_id = stored["id"]

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
		"duplicate": duplicate_candidate is not None,
		"duplicateCandidate": duplicate_candidate,
		"graphRag": graph_rag,
		"storage": {"postgres": postgres_candidate_id is not None, "neo4j": graph_candidate_id is not None},
		"textLength": len(combined_text),
		"persisted": persist,
		"parsingMethod": profile.parsing_method,
	}


@app.post(
	"/cv-fast-importer/import",
	tags=["Fast CV Importer"],
	summary="CV mit dem Fast-Parser parsen und optional speichern",
	responses={
		400: {"description": "Keine Datei oder ungültiges PDF"},
		413: {"description": "Datei überschreitet 20 MB"},
		503: {"description": "Parser nicht bereit oder Speicherung fehlgeschlagen"},
	},
)
async def import_fast_cv(
	request: Request,
	file: list[UploadFile] | None = File(default=None),
	persist: bool = Query(default=False),
) -> dict[str, Any]:
	files = file or []
	if not files:
		raise HTTPException(status_code=400, detail="Keine Datei hochgeladen")
	if len(files) > 10:
		raise HTTPException(status_code=400, detail="Maximal 10 Dateien erlaubt")

	parser = getattr(request.app.state, "cv_job_parser", None)
	if parser is None:
		raise HTTPException(status_code=503, detail="Fast CV parser is not ready.")

	uploads: list[tuple[str, bytes]] = []
	for uploaded_file in files:
		filename = uploaded_file.filename or "unbenannt.pdf"
		content_type = (uploaded_file.content_type or "application/octet-stream").lower()
		try:
			if content_type not in {"application/pdf", "application/octet-stream"}:
				raise HTTPException(status_code=400, detail="Fast CV importer accepts PDF files only.")
			data = await uploaded_file.read(20 * 1024 * 1024 + 1)
			if len(data) > 20 * 1024 * 1024:
				raise HTTPException(status_code=413, detail="Datei zu groß (max. 20 MB)")
			if not data:
				raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
			uploads.append((filename, data))
		finally:
			await uploaded_file.close()

	profiles: list[CandidateProfileExtraction] = []
	text_parts: list[str] = []
	for filename, data in uploads:
		try:
			parsed = await parse_cv_bytes(parser, data)
		except InvalidPDFError as exc:
			raise HTTPException(status_code=400, detail=str(exc)) from exc
		except Exception as exc:
			logger.exception("Fast CV parsing failed")
			raise HTTPException(status_code=502, detail="Fast CV parsing failed.") from exc

		profiles.append(_fast_cv_response_to_candidate_profile(parsed, filename))
		try:
			text = await asyncio.to_thread(pdf_service.extract_text, data)
		except ValueError:
			text = ""
		if text.strip():
			text_parts.append(text.strip())

	profile = _merge_fast_cv_profiles(profiles)
	combined_text = "\n\n".join(text_parts)
	await billing_service.charge(request, "-1.00", "CV_PARSE", note="Fast CV import")

	ensure_birth_date(profile, combined_text)
	text_hash = _normalized_text_hash(combined_text)
	profile_hash = _normalized_profile_hash(profile)
	# Dieselbe Person = gleicher Name + gleiches Geburtsdatum.
	duplicate_candidate = await _existing_identity(profile)

	graph_candidate_id: str | None = None
	postgres_candidate_id: int | None = None
	if persist:
		candidate_text = combined_text or render_candidate_fulltext(
			profile.model_dump(mode="json"),
			work_history=[item.model_dump(mode="json") for item in profile.work_history],
			education_history=[item.model_dump(mode="json") for item in profile.education_history],
		)
		stored = await _create_candidate(profile, candidate_text, "CV-Fast-Import", text_hash, profile_hash)
		graph_candidate_id = stored["uuid"]
		postgres_candidate_id = stored["id"]

	profile_payload = profile.model_dump(mode="json")
	candidate_payload = {**profile_payload, **({"id": postgres_candidate_id} if postgres_candidate_id else {})}
	graph_rag = {
		"id": graph_candidate_id,
		"message": "Candidate ingested successfully" if persist else "Candidate parsed successfully",
		"profile": profile_payload,
		"persisted": persist,
	}
	filenames = [filename for filename, _ in uploads]
	return {
		"success": True,
		"filenames": filenames,
		"filename": filenames[0],
		"candidate": candidate_payload,
		"profile": profile_payload,
		"localCandidate": candidate_payload if postgres_candidate_id else None,
		"duplicate": duplicate_candidate is not None,
		"duplicateCandidate": duplicate_candidate,
		"graphRag": graph_rag,
		"storage": {"postgres": postgres_candidate_id is not None, "neo4j": graph_candidate_id is not None},
		"textLength": len(combined_text),
		"persisted": persist,
		"parsingMethod": profile.parsing_method,
	}


@app.post("/ingest/candidate", response_model=CandidateIngestResponse)
async def ingest_candidate(
	request: Request,
	persist: str = Query(default="true"),
) -> CandidateIngestResponse:
	"""Liest einen CV aus und legt den Bewerber an (persist=1, Standard).
	persist=0 liest nur aus - das Backend speichert dann selbst mit
	Dublettenpruefung und uebertraegt den Bewerber per /sync/candidates."""
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

	await billing_service.charge(request, "-1.00", "CV_PARSE", note="CV ingest")
	ensure_birth_date(profile, text)

	if str(persist or "").strip().lower() in {"0", "false", "no", "none", "off"}:
		return CandidateIngestResponse(id="", message="Candidate parsed successfully", profile=profile, persisted=False)

	candidate_text = text or render_candidate_fulltext(
		profile.model_dump(mode="json"),
		work_history=[item.model_dump(mode="json") for item in profile.work_history],
		education_history=[item.model_dump(mode="json") for item in profile.education_history],
	)
	stored = await _create_candidate(
		profile,
		candidate_text,
		"Candidate-Ingest",
		_normalized_text_hash(text),
		_normalized_profile_hash(profile),
	)
	return CandidateIngestResponse(
		id=stored["uuid"],
		message="Candidate ingested successfully",
		profile=profile,
		persisted=True,
		postgres_id=stored["id"],
	)


def _profile_for_sync(row: dict[str, Any], text_payload: dict[str, Any] | None) -> CandidateProfileExtraction:
	"""Profil fuer den Neo4j-Knoten: PostgreSQL ist fuehrend, das beim
	CV-Import gespeicherte Strukturprofil liefert Skills mit Kategorien."""
	data: dict[str, Any] = {}
	profile_json = (text_payload or {}).get("profile_json")
	if isinstance(profile_json, str):
		try:
			profile_json = json.loads(profile_json)
		except ValueError:
			profile_json = None
	if isinstance(profile_json, dict):
		data.update(without_identity_fields(profile_json))
	for key in (
		"name", "email", "phone", "location", "experience", "education", "certificates", "drivers_license",
		"mobility", "desired_salary", "availability", "notice_period", "linkedin_url", "xing_url", "github_url",
		"portfolio_url", "tags", "notes", "current_employer", "current_position", "nationality", "gender",
	):
		if row.get(key) not in (None, ""):
			data[key] = row[key]
	if not data.get("skills") and row.get("skills"):
		data["skills"] = row["skills"]
	if not data.get("languages") and row.get("languages"):
		data["languages"] = row["languages"]
	if row.get("work_history"):
		data["work_history"] = [
			{**entry, "is_current": bool(entry.get("is_current"))} for entry in row["work_history"]
		]
	if row.get("education_history"):
		data["education_history"] = row["education_history"]
	data.pop("birth_date", None)
	return CandidateProfileExtraction.model_validate(data)


@app.post("/sync/candidates", response_model=CandidateSyncResponse)
async def sync_candidates(payload: CandidateSyncRequest) -> CandidateSyncResponse:
	"""Uebertraegt Bewerber aus PostgreSQL nach Neo4j. Der Knoten traegt die
	UUID des Bewerbers; aeltere Knoten derselben Person (andere IDs in
	graph_candidate_ids) werden entfernt, damit es die Person auch in Neo4j
	nur einmal gibt. Kostet keine Credits (es wird nichts geparst)."""
	if not payload.candidate_ids:
		return CandidateSyncResponse()
	rows = await postgres_store.list_candidates_for_backfill(payload.candidate_ids)
	result = CandidateSyncResponse()
	for row in rows:
		candidate_id = int(row["candidate_id"])
		try:
			text_payload = await postgres_store.get_candidate_text(str(candidate_id))
			profile = _profile_for_sync(row, text_payload)
			embedding = await llm_service.create_embedding(without_identity_fields(profile.model_dump()), allow_fallback=False)
			skill_embeddings = await _build_skill_embeddings([item.name for item in profile.skills])
			await db_service.upsert_candidate(
				candidate_id=row["uuid"],
				profile=profile,
				embedding=embedding,
				skill_embeddings=skill_embeddings,
			)
			stale_ids = {
				str(value).strip()
				for value in [row.get("graph_candidate_id"), *(row.get("graph_candidate_ids") or [])]
				if value and str(value).strip() and str(value).strip() != row["uuid"]
			}
			for stale_id in stale_ids:
				if await postgres_store.graph_candidate_id_in_use(stale_id, exclude_candidate_id=candidate_id):
					continue
				result.removed_stale_nodes += await db_service.delete_candidate(stale_id)
			await postgres_store.reset_candidate_graph_ids(candidate_id, row["uuid"])
			if text_payload and not text_payload.get("anonymized_text"):
				await candidate_privacy_service.anonymize_candidate(str(candidate_id))
			result.synced += 1
		except Exception as exc:
			logger.warning("Neo4j-Abgleich fuer Bewerber %s fehlgeschlagen", candidate_id, exc_info=True)
			result.failed += 1
			result.errors.append({"candidate_id": candidate_id, "error": str(exc)})
	return result


@app.delete("/ingest/candidate", response_model=CandidateDeleteResponse)
async def delete_candidate(payload: CandidateDeleteRequest) -> CandidateDeleteResponse:
	if not any(
		str(value or "").strip()
		for value in (payload.candidate_id, payload.email, payload.phone)
	) and not (payload.name and payload.location):
		raise HTTPException(status_code=400, detail="Provide candidate_id or a unique candidate identity.")

	try:
		neo4j_deleted = await db_service.delete_candidate(
			payload.candidate_id,
			email=payload.email,
			phone=payload.phone,
			name=payload.name,
			location=payload.location,
		)
	except Exception as exc:
		logger.exception("Candidate deletion failed")
		raise HTTPException(status_code=503, detail=f"Candidate deletion failed: {exc}") from exc

	return CandidateDeleteResponse(deleted=neo4j_deleted > 0, neo4j_deleted=neo4j_deleted)


@app.post("/add/job/", response_model=JobIngestResponse, status_code=201)
@app.post("/ingest/job", response_model=JobIngestResponse)
async def ingest_job(
	request: Request,
	persist: str = Query(default="true"),
	job_id: str | None = Query(default=None, description="UUID der Stelle aus PostgreSQL; der Neo4j-Knoten erhaelt genau diese ID"),
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
	except HTTPException:
		raise
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

	requested_job_id = str(job_id or "").strip() or None
	graph_job_id = requested_job_id or (duplicate_job["id"] if duplicate_job else str(uuid4()))
	if not persist_postgres and not persist_neo4j:
		return JobIngestResponse(id=graph_job_id, message="Job ingested successfully", profile=profile, persisted=False)

	if persist_postgres:
		# Eine Stelle gibt es nur einmal: vorhandene Stelle blockiert das Anlegen.
		existing_job = await postgres_store._find_existing_job(requested_job_id, profile)
		if existing_job is not None:
			raise HTTPException(status_code=409, detail={
				"error": f"Diese Stelle ist bereits im Tool angelegt: {existing_job.get('title') or 'Stelle'} (ID {existing_job.get('id')})",
				"code": "DUPLICATE_JOB",
				"existing": existing_job,
			})

	await billing_service.charge(request, "-1.00", "JOB_PARSE", note=profile.title or "Job ingest")

	try:
		embedding = await llm_service.create_embedding(profile.model_dump(), allow_fallback=False)
		skill_embeddings = await _build_skill_embeddings([item.name for item in profile.required_skills])
	except HTTPException:
		raise
	except Exception as exc:
		logger.exception("Job embedding creation failed")
		raise HTTPException(status_code=502, detail=f"Job embedding creation failed: {exc}") from exc

	if persist_postgres:
		try:
			stored_job = await persist_job_profile(
				postgres_store=postgres_store,
				job_id=None,
				raw_text=text or "",
				profile=profile,
				source_hash=text_hash,
				profile_hash=profile_hash,
			)
		except Exception as exc:
			logger.exception("Job PostgreSQL persistence failed")
			raise HTTPException(status_code=503, detail=f"Job PostgreSQL persistence failed: {exc}") from exc
		if stored_job.get("duplicate"):
			raise HTTPException(status_code=409, detail={"error": "Diese Stelle ist bereits im Tool angelegt", "code": "DUPLICATE_JOB", "existing": stored_job})
		# Neo4j-Knoten und PostgreSQL-Zeile teilen sich die UUID.
		graph_job_id = stored_job["uuid"]

	if persist_neo4j:
		try:
			await db_service.upsert_job(
				job_id=graph_job_id,
				profile=profile,
				embedding=embedding,
				skill_embeddings=skill_embeddings,
				source_hash=text_hash,
				profile_hash=profile_hash,
			)
		except Exception as exc:
			logger.exception("Job persistence failed")
			raise HTTPException(status_code=503, detail=f"Job persistence failed: {exc}") from exc

	return JobIngestResponse(id=graph_job_id, message="Job ingested successfully", profile=profile, persisted=True)


@app.delete("/ingest/job", response_model=JobDeleteResponse)
async def delete_job(payload: JobDeleteRequest) -> JobDeleteResponse:
	if not any(
		str(value).strip()
		for value in (
			payload.job_id,
			payload.title,
			payload.description,
			payload.requirements,
			payload.about_us,
			payload.benefits,
			payload.location,
			payload.type,
			payload.url,
		)
	):
		raise HTTPException(status_code=400, detail="Provide job_id or job metadata to delete.")

	neo4j_deleted = await db_service.delete_job(
		payload.job_id,
		title=payload.title,
		location=payload.location,
		employment_type=payload.type,
	)
	# scope "neo4j": das Backend loescht seine PostgreSQL-Zeile selbst. Sonst
	# wuerden alle Stellen mit derselben (Alt-)ID mitgeloescht.
	postgres_deleted = 0 if payload.scope == "neo4j" else await postgres_store.delete_job(
		payload.job_id,
		title=payload.title,
		description=payload.description,
		requirements=payload.requirements,
		about_us=payload.about_us,
		benefits=payload.benefits,
		location=payload.location,
		job_type=payload.type,
		url=payload.url,
	)
	return JobDeleteResponse(
		deleted=bool(neo4j_deleted or postgres_deleted),
		neo4j_deleted=neo4j_deleted,
		postgres_deleted=postgres_deleted,
	)


@app.post("/match/{job_id}", response_model=MatchResponse)
async def match_candidates(job_id: str, request: Request) -> MatchResponse:
	job_profile = await db_service.get_job_profile(job_id)
	if not job_profile:
		raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

	stage1 = await db_service.stage1_filter_candidates(job_id=job_id, limit=100)
	if not stage1:
		return MatchResponse(job_id=job_id, stage1_count=0, stage2_count=0, matches=[])

	await billing_service.charge(request, "-1.00", "AI_MATCH", note=f"match:{job_id}")

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
		strengths = item.strengths if item.strengths else ["Sehr guter Fit"]
		weaknesses = item.weaknesses if item.weaknesses else ["Keine wesentlichen Schwächen erkannt"]
		matches.append(
			MatchCandidateResponse(
				candidate_id=item.candidate_id,
				score=item.score,
				explanation=item.explanation,
				strengths=strengths,
				weaknesses=weaknesses,
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
