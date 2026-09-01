from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


class HealthResponse(BaseModel):
    status: str = "ok"
    app: str = "HRTool Backend New"
    version: str = "0.1.0"


class JobCreate(BaseModel):
    title: str = Field(..., min_length=2)
    company: Optional[str] = None
    location: Optional[str] = None
    employment_type: Optional[str] = None
    status: Optional[str] = "open"


class JobRead(JobCreate):
    id: int


class CandidateCreate(BaseModel):
    name: str = Field(..., min_length=2)
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = "new"


class CandidateRead(CandidateCreate):
    id: int
