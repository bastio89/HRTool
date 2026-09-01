from __future__ import annotations

import asyncio
import logging
import sqlite3
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile

from config import settings
from models import (
	CandidateIngestRequest,
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
from services.db import Neo4jService
from services.llm import LLMService
from services.pdf import PDFService
from services.sqlite_store import SQLiteJobStore


db_service = Neo4jService(
	uri=settings.neo4j_uri,
	user=settings.neo4j_user,
	password=settings.neo4j_password,
)
llm_service = LLMService(
	provider=settings.resolved_provider,
	base_url=settings.resolved_ai_base_url,
	api_key=settings.resolved_api_key,
	chat_model=settings.resolved_chat_model,
	embedding_model=settings.resolved_embedding_model,
	embedding_dimensions=settings.embedding_dimensions,
	enable_reasoning=settings.ollama_enable_reasoning,
	enable_parse_latency_aggregation=settings.enable_parse_latency_aggregation,
	parse_latency_window_size=settings.parse_latency_window_size,
	parse_latency_log_every=settings.parse_latency_log_every,
	enable_call_logging=True,
	backend_db_path=settings.resolved_backend_db_path,
)
pdf_service = PDFService()
sqlite_job_store = SQLiteJobStore(settings.resolved_backend_db_path)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
	yield
	await db_service.close()
	await llm_service.close()


app = FastAPI(
	title="HR Graph Matching API",
	description="High-efficiency 3-stage candidate-job matching service",
	version="1.0.0",
	lifespan=lifespan,
)


def _read_ai_usage(db_path: str) -> AiUsageMetrics:
	try:
		with sqlite3.connect(db_path) as connection:
			row = connection.execute(
				"""
				SELECT
					COUNT(*) AS calls,
					COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS input_tokens,
					COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS output_tokens
				FROM ai_logs
				"""
			).fetchone()
		if not row:
			return AiUsageMetrics()
		input_tokens = int(row[1] or 0)
		output_tokens = int(row[2] or 0)
		return AiUsageMetrics(calls=int(row[0] or 0), input_tokens=input_tokens, output_tokens=output_tokens, total_tokens=input_tokens + output_tokens)
	except sqlite3.Error:
		return AiUsageMetrics()


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


async def _extract_ingest_text_from_request(request: Request, is_candidate: bool) -> str:
	content_type = request.headers.get("content-type", "").lower()

	raw_text: str | None = None
	file: UploadFile | None = None

	if "application/json" in content_type:
		payload_data = await request.json()
		if is_candidate:
			payload = CandidateIngestRequest.model_validate(payload_data)
			raw_text = payload.raw_text
		else:
			payload = JobIngestRequest.model_validate(payload_data)
			raw_text = payload.raw_text
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

	return await _extract_raw_text(raw_text=raw_text, file=file, is_candidate=is_candidate)


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
				}
			)
			for skill_name in unique_names
		)
	)
	return {name.lower(): vector for name, vector in zip(unique_names, vectors)}


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
	return HealthResponse(ai_usage=_read_ai_usage(settings.resolved_backend_db_path))


@app.post("/ingest/candidate", response_model=IngestResponse)
async def ingest_candidate(
	request: Request,
) -> IngestResponse:
	text, provided_profile = await _extract_candidate_payload_from_request(request=request)
	try:
		if provided_profile is None:
			if text is None:
				raise HTTPException(status_code=400, detail="Provide either raw_text or profile.")
			profile = await llm_service.parse_candidate_cv(text)
		else:
			profile = provided_profile
	except Exception as exc:
		logger.exception("Candidate parsing failed")
		raise HTTPException(status_code=502, detail=f"Candidate parsing failed: {exc}") from exc

	candidate_id = str(uuid4())
	try:
		embedding = await llm_service.create_embedding(profile.model_dump())
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
		)
	except Exception as exc:
		logger.exception("Candidate persistence failed")
		raise HTTPException(status_code=503, detail=f"Candidate persistence failed: {exc}") from exc

	return IngestResponse(id=candidate_id, message="Candidate ingested successfully")


@app.post("/add/job/", response_model=JobIngestResponse, status_code=201)
@app.post("/ingest/job", response_model=JobIngestResponse)
async def ingest_job(
	request: Request,
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

	job_id = str(uuid4())
	try:
		embedding = await llm_service.create_embedding(profile.model_dump())
		skill_embeddings = await _build_skill_embeddings([item.name for item in profile.required_skills])
	except Exception as exc:
		logger.exception("Job embedding creation failed")
		raise HTTPException(status_code=502, detail=f"Job embedding creation failed: {exc}") from exc

	try:
		await sqlite_job_store.upsert_job(job_id=job_id, raw_text=text or "", profile=profile)
	except Exception as exc:
		logger.exception("Job SQLite persistence failed")
		raise HTTPException(status_code=503, detail=f"Job SQLite persistence failed: {exc}") from exc

	try:
		await db_service.upsert_job(
			job_id=job_id,
			profile=profile,
			embedding=embedding,
			skill_embeddings=skill_embeddings,
		)
	except Exception as exc:
		logger.exception("Job persistence failed")
		raise HTTPException(status_code=503, detail=f"Job persistence failed: {exc}") from exc

	return JobIngestResponse(id=job_id, message="Job ingested successfully", profile=profile)


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
