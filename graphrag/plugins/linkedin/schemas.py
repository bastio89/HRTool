from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from models import CandidateProfileExtraction


class LinkedInProfileRequest(BaseModel):
    url: str = Field(..., min_length=1)


class LinkedInProfileResponse(BaseModel):
    source_url: str
    tool_name: str
    profile: CandidateProfileExtraction


class LinkedInPeopleSearchRequest(BaseModel):
    enrichEmails: bool = Field(default=True)
    keywords: str = Field(..., min_length=1)
    location: str = Field(..., min_length=1)
    maxResults: int = Field(default=5, ge=1, le=100)
    mode: str = Field(default="public")

    model_config = ConfigDict(populate_by_name=True)


class LinkedInExportRequest(BaseModel):
    links: list[str] = Field(default_factory=list)
    profiles: list[dict[str, Any]] = Field(default_factory=list)
