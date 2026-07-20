from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class CandidateIngestRequest(BaseModel):
    raw_text: str = Field(..., min_length=20, description="Raw CV or resume text")


class JobIngestRequest(BaseModel):
    raw_text: str = Field(..., min_length=20, description="Raw job description text")


class CandidateSkillExtraction(BaseModel):
    name: str = Field(..., min_length=1)
    category: Literal["HardSkill", "SoftSkill"] | None = None
    level: str | None = None
    experience_years: float | None = Field(default=None, ge=0)


class LanguageExtraction(BaseModel):
    name: str = Field(..., min_length=1)
    level: str | None = None


class EducationExtraction(BaseModel):
    level: str = Field(..., min_length=1)
    field_of_study: str = Field(..., min_length=1)


class IndustryExtraction(BaseModel):
    name: str = Field(..., min_length=1)


class CandidateProfileExtraction(BaseModel):
    name: str
    location: str | None = None
    experience_years: float | None = Field(default=None, ge=0)
    salary_expectation: float | None = Field(default=None, ge=0)
    skills: list[CandidateSkillExtraction] = Field(default_factory=list)
    languages: list[LanguageExtraction] = Field(default_factory=list)
    educations: list[EducationExtraction] = Field(default_factory=list)
    industries: list[IndustryExtraction] = Field(default_factory=list)
    preferred_roles: list[str] = Field(default_factory=list)


class JobSkillExtraction(BaseModel):
    name: str = Field(..., min_length=1)
    category: Literal["HardSkill", "SoftSkill"] | None = None
    priority: str = Field(
        ...,
        validation_alias=AliasChoices("priority", "importance"),
        serialization_alias="priority",
    )

    @field_validator("priority")
    @classmethod
    def normalize_priority(cls, value: str) -> str:
        normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
        if normalized == "mandatory":
            return "Mandatory"
        if normalized in {"nice_to_have", "nicetohave"}:
            return "NiceToHave"
        raise ValueError("priority must be Mandatory or NiceToHave")


class JobProfileExtraction(BaseModel):
    title: str
    department: str | None = None
    company: str | None = None
    recruiter_company: str | None = None
    employer_company: str | None = None
    location: str | None = None
    employment_type: str | None = None
    required_skills: list[JobSkillExtraction] = Field(default_factory=list)
    required_languages: list[LanguageExtraction] = Field(default_factory=list)
    required_degrees: list[EducationExtraction] = Field(default_factory=list)
    industries: list[IndustryExtraction] = Field(default_factory=list)


class IngestResponse(BaseModel):
    id: str
    message: str


class JobIngestResponse(IngestResponse):
    profile: JobProfileExtraction


class Stage1Candidate(BaseModel):
    id: str
    mandatory_overlap: int = 0
    role_overlap: int = 0
    location_match: bool = False


class Stage2Candidate(BaseModel):
    id: str
    name: str | None = None
    location: str | None = None
    experience_years: float | None = None
    skills: list[str] = Field(default_factory=list)
    preferred_roles: list[str] = Field(default_factory=list)
    vector_score: float
    jaccard_score: float
    combined_score: float

class CandidateJobMatch(BaseModel):
    job_id: str
    title: str | None = None
    department: str | None = None
    company: str | None = None
    location: str | None = None
    skill_similarity: float
    shared_skills: list[str] = Field(default_factory=list)
    similar_skills: list[str] = Field(default_factory=list)
    candidate_skills: list[str] = Field(default_factory=list)
    job_skills: list[str] = Field(default_factory=list)


class JobCandidateMatch(BaseModel):
    candidate_id: str
    name: str | None = None
    location: str | None = None
    experience_years: float | None = None
    skill_similarity: float
    shared_skills: list[str] = Field(default_factory=list)
    similar_skills: list[str] = Field(default_factory=list)
    candidate_skills: list[str] = Field(default_factory=list)
    job_skills: list[str] = Field(default_factory=list)


class LLMRerankItem(BaseModel):
    candidate_id: str
    score: int = Field(..., ge=1, le=100)
    explanation: str = Field(..., min_length=10)


class LLMRerankResponse(BaseModel):
    ranked_candidates: list[LLMRerankItem] = Field(default_factory=list)


class MatchCandidateResponse(BaseModel):
    candidate_id: str
    score: int = Field(..., ge=1, le=100)
    explanation: str
    vector_score: float
    jaccard_score: float
    combined_score: float
    profile: dict[str, Any]


class MatchResponse(BaseModel):
    job_id: str
    stage1_count: int
    stage2_count: int
    matches: list[MatchCandidateResponse] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class FileTextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_text: str | None = None
