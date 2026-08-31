from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, UploadFile

from config import settings
from models import (
	CandidateIngestRequest,
	CandidateIngestResponse,
	CandidateProfileExtraction,
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
	enable_call_logging=settings.enable_ai_call_logging,
	enable_parse_latency_aggregation=settings.enable_parse_latency_aggregation,
	parse_latency_window_size=settings.parse_latency_window_size,
	parse_latency_log_every=settings.parse_latency_log_every,
)
pdf_service = PDFService()
job_store = SQLiteJobStore(settings.resolved_job_sqlite_path)
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


def _job_profile_to_payload(profile: JobProfileExtraction) -> dict:
	return {
		"title": profile.title,
		"about_us": profile.about_us or "",
		"description": profile.description or "",
		"requirements": profile.requirements or "",
		"benefits": profile.benefits or "",
		"location": profile.location or "",
		"employment_type": profile.employment_type or "",
		"department": profile.department or "",
		"company": profile.company or "",
		"recruiter_company": profile.recruiter_company or "",
		"employer_company": profile.employer_company or "",
		"required_skills": [item.model_dump() for item in profile.required_skills],
		"required_languages": [item.model_dump() for item in profile.required_languages],
		"required_degrees": [item.model_dump() for item in profile.required_degrees],
		"industries": [item.model_dump() for item in profile.industries],
	}


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
	return HealthResponse(ai_usage=llm_service.get_usage_metrics())


@app.post("/ingest/candidate", response_model=CandidateIngestResponse)
async def ingest_candidate(
	request: Request,
) -> CandidateIngestResponse:
	text, provided_profile = await _extract_candidate_payload_from_request(request=request)
	persist = request.query_params.get("persist", "1").strip().lower() not in {"0", "false", "no", "off"}
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
	if not persist:
		return CandidateIngestResponse(
			id=candidate_id,
			message="Candidate parsed successfully",
			profile=profile,
			persisted=False,
		)

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

	return CandidateIngestResponse(id=candidate_id, message="Candidate ingested successfully", profile=profile, persisted=True)


@app.post("/ingest/job", response_model=JobIngestResponse)
async def ingest_job(
	request: Request,
) -> JobIngestResponse:
	text, provided_profile = await _extract_job_payload_from_request(request=request)
	persist = request.query_params.get("persist", "1").strip().lower() not in {"0", "false", "no", "off"}
	try:
		if provided_profile is None:
			if text is None:
				raise HTTPException(status_code=400, detail="Provide either raw_text or profile.")
			logger.warning("ingest_job: calling parse_job_description once (chars=%d)", len(text))
			profile = await llm_service.parse_job_description(text)
		else:
			profile = provided_profile
	except Exception as exc:
		logger.exception("Job parsing failed")
		raise HTTPException(status_code=502, detail=f"Job parsing failed: {exc}") from exc

	job_id = str(uuid4())
	logger.warning(
		"ingest_job: parse_job_description returned title=%r required_skills=%d persist=%s",
		profile.title,
		len(profile.required_skills),
		persist,
	)

	if not persist:
		return JobIngestResponse(
			id=job_id,
			message="Job parsed successfully",
			profile=profile,
			persisted=False,
			sqlite_id=None,
		)

	try:
		embedding = await llm_service.create_embedding(profile.model_dump())
		skill_embeddings = await _build_skill_embeddings([item.name for item in profile.required_skills])
	except Exception as exc:
		logger.exception("Job embedding creation failed")
		raise HTTPException(status_code=502, detail=f"Job embedding creation failed: {exc}") from exc

	sqlite_id: int | None = None
	try:
		if persist:
			sqlite_id = await job_store.upsert_job(job_id=job_id, raw_text=text or "", profile=profile)
			await db_service.upsert_job(
				job_id=job_id,
				profile=profile,
				embedding=embedding,
				skill_embeddings=skill_embeddings,
			)
	except Exception as exc:
		logger.exception("Job persistence failed")
		raise HTTPException(status_code=503, detail=f"Job persistence failed: {exc}") from exc

	return JobIngestResponse(
		id=job_id,
		message="Job ingested successfully" if persist else "Job parsed successfully",
		profile=profile,
		persisted=persist,
		sqlite_id=sqlite_id,
	)


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
