from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from backend_new.database import fetch_all, get_connection, insert_job
from backend_new.models import JobCreate, JobRead

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=list[JobRead])
def list_jobs() -> list[JobRead]:
    rows = fetch_all("jobs")
    return [
        JobRead(
            id=row["id"],
            title=row["title"],
            company=row["company"],
            location=row["location"],
            employment_type=row["employment_type"],
            status=row["status"],
        )
        for row in rows
    ]


@router.post("", response_model=JobRead, status_code=status.HTTP_201_CREATED)
def create_job(payload: JobCreate) -> JobRead:
    job_id = insert_job(
        title=payload.title,
        company=payload.company,
        location=payload.location,
        employment_type=payload.employment_type,
    )
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Job could not be created")
    return JobRead(
        id=row["id"],
        title=row["title"],
        company=row["company"],
        location=row["location"],
        employment_type=row["employment_type"],
        status=row["status"],
    )
