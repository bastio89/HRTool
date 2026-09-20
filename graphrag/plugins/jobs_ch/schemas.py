from __future__ import annotations

from pydantic import BaseModel, Field


class JobsChExportRequest(BaseModel):
    links: list[str] = Field(default_factory=list)


class JobsChImportRequest(BaseModel):
    links: list[str] = Field(default_factory=list)


class JobsChImportItem(BaseModel):
    link: str
    job_id: str | None = None
    title: str | None = None
    imported: bool = False
    duplicate: bool = False
    error: str | None = None


class JobsChImportResponse(BaseModel):
    imported: int
    failed: int
    duplicates: int = 0
    warning: str | None = None
    items: list[JobsChImportItem] = Field(default_factory=list)


class JobsChSearchItem(BaseModel):
    title: str
    link: str
    job_id: str | None = None
    company: str | None = None
    location: str | None = None


class JobsChSearchResponse(BaseModel):
    query: str
    count: int
    items: list[JobsChSearchItem] = Field(default_factory=list)
