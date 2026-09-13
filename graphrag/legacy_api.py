from __future__ import annotations

from fastapi import APIRouter, status

from models import CandidateCreate, CandidateRead, JobCreate, JobRead, LegacyHealthResponse
from services.postgres_store import PostgresStore


def create_legacy_router(postgres_store: PostgresStore) -> APIRouter:
	router = APIRouter(prefix="/api", tags=["legacy"])

	@router.get("/health", response_model=LegacyHealthResponse)
	async def health() -> LegacyHealthResponse:
		return LegacyHealthResponse()

	@router.get("/health/live")
	async def health_live() -> dict[str, str]:
		return {"status": "ok"}

	@router.get("/jobs", response_model=list[JobRead])
	async def list_jobs() -> list[JobRead]:
		rows = await postgres_store.list_compat_jobs()
		return [
			JobRead(
				id=int(row["id"]),
				title=row["title"],
				company=row.get("company"),
				location=row.get("location"),
				employment_type=row.get("employment_type"),
				status=row.get("status"),
			)
			for row in rows
		]

	@router.post("/jobs", response_model=JobRead, status_code=status.HTTP_201_CREATED)
	async def create_job(payload: JobCreate) -> JobRead:
		row = await postgres_store.create_compat_job(
			title=payload.title,
			company=payload.company,
			location=payload.location,
			employment_type=payload.employment_type,
		)
		return JobRead(
			id=int(row["id"]),
			title=row["title"],
			company=row.get("company"),
			location=row.get("location"),
			employment_type=row.get("employment_type"),
			status=row.get("status"),
		)

	@router.get("/candidates", response_model=list[CandidateRead])
	async def list_candidates() -> list[CandidateRead]:
		rows = await postgres_store.list_compat_candidates()
		return [
			CandidateRead(
				id=int(row["id"]),
				name=row["name"],
				email=row.get("email"),
				phone=row.get("phone"),
				location=row.get("location"),
				status=row.get("status"),
			)
			for row in rows
		]

	@router.post("/candidates", response_model=CandidateRead, status_code=status.HTTP_201_CREATED)
	async def create_candidate(payload: CandidateCreate) -> CandidateRead:
		row = await postgres_store.create_compat_candidate(
			name=payload.name,
			email=payload.email,
			phone=payload.phone,
			location=payload.location,
		)
		return CandidateRead(
			id=int(row["id"]),
			name=row["name"],
			email=row.get("email"),
			phone=row.get("phone"),
			location=row.get("location"),
			status=row.get("status"),
		)

	return router