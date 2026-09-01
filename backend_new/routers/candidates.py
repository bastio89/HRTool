from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from backend_new.database import fetch_all, get_connection, insert_candidate
from backend_new.models import CandidateCreate, CandidateRead

router = APIRouter(prefix="/candidates", tags=["candidates"])


@router.get("", response_model=list[CandidateRead])
def list_candidates() -> list[CandidateRead]:
    rows = fetch_all("candidates")
    return [
        CandidateRead(
            id=row["id"],
            name=row["name"],
            email=row["email"],
            phone=row["phone"],
            location=row["location"],
            status=row["status"],
        )
        for row in rows
    ]


@router.post("", response_model=CandidateRead, status_code=status.HTTP_201_CREATED)
def create_candidate(payload: CandidateCreate) -> CandidateRead:
    candidate_id = insert_candidate(
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        location=payload.location,
    )
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM candidates WHERE id = %s", (candidate_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Candidate could not be created")
    return CandidateRead(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        phone=row["phone"],
        location=row["location"],
        status=row["status"],
    )
