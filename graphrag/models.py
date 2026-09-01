from __future__ import annotations

import re

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


def _split_text_values(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[,;|\n]+", value) if item.strip()]


def _coerce_text_field(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, list):
        parts = [str(item).strip() for item in value if str(item).strip()]
        return "\n".join(parts) or None
    if isinstance(value, dict):
        return str(value).strip() or None
    return str(value).strip() or None


class CandidateIngestRequest(BaseModel):
    raw_text: str | None = Field(default=None, min_length=20, description="Raw CV or resume text")
    profile: CandidateProfileExtraction | None = None

    @model_validator(mode="after")
    def ensure_input(self) -> "CandidateIngestRequest":
        if not self.raw_text and self.profile is None:
            raise ValueError("Provide either raw_text or profile.")
        return self


class JobIngestRequest(BaseModel):
    raw_text: str | None = Field(default=None, min_length=20, description="Raw job description text")
    profile: JobProfileExtraction | None = None

    @model_validator(mode="after")
    def ensure_input(self) -> "JobIngestRequest":
        if not self.raw_text and self.profile is None:
            raise ValueError("Provide either raw_text or profile.")
        return self


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


class EducationHistoryExtraction(BaseModel):
    institution: str | None = None
    degree: str | None = None
    field_of_study: str | None = None
    from_date: str | None = None
    to_date: str | None = None
    description: str | None = None


class IndustryExtraction(BaseModel):
    name: str = Field(..., min_length=1)


class WorkHistoryExtraction(BaseModel):
    employer: str | None = None
    position: str | None = None
    from_date: str | None = None
    to_date: str | None = None
    is_current: bool = False
    description: str | None = None
    location: str | None = None


class CandidateProfileExtraction(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    experience_years: float | None = Field(default=None, ge=0)
    salary_expectation: float | None = Field(default=None, ge=0)
    experience: str | None = None
    education: str | None = None
    certificates: str | None = None
    drivers_license: str | None = None
    mobility: str | None = None
    desired_salary: str | None = None
    availability: str | None = None
    notice_period: str | None = None
    linkedin_url: str | None = None
    xing_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    tags: str | None = None
    notes: str | None = None
    current_employer: str | None = None
    current_position: str | None = None
    nationality: str | None = None
    gender: str | None = None
    # How the profile was extracted: "llm" (model succeeded) or "text_heuristik" (regex fallback).
    parsing_method: str | None = None
    skills: list[CandidateSkillExtraction] = Field(default_factory=list)
    languages: list[LanguageExtraction] = Field(default_factory=list)
    educations: list[EducationExtraction] = Field(default_factory=list)
    industries: list[IndustryExtraction] = Field(default_factory=list)
    work_history: list[WorkHistoryExtraction] = Field(default_factory=list)
    education_history: list[EducationHistoryExtraction] = Field(default_factory=list)
    preferred_roles: list[str] = Field(default_factory=list)

    @field_validator(
        "email",
        "phone",
        "location",
        "experience",
        "education",
        "certificates",
        "drivers_license",
        "mobility",
        "desired_salary",
        "availability",
        "notice_period",
        "linkedin_url",
        "xing_url",
        "github_url",
        "portfolio_url",
        "tags",
        "notes",
        "current_employer",
        "current_position",
        "nationality",
        "gender",
        mode="before",
    )
    @classmethod
    def normalize_text_fields(cls, value):
        return _coerce_text_field(value)

    @field_validator("skills", mode="before")
    @classmethod
    def normalize_skills(cls, value):
        if isinstance(value, str):
            return [{"name": skill} for skill in _split_text_values(value)]
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            return [{"name": skill.strip()} for skill in value if skill and skill.strip()]
        return value

    @field_validator("languages", mode="before")
    @classmethod
    def normalize_languages(cls, value):
        if isinstance(value, str):
            return [{"name": language} for language in _split_text_values(value)]
        if isinstance(value, list):
            normalized = []
            for item in value:
                if isinstance(item, str):
                    name = item.strip()
                    if name:
                        normalized.append({"name": name})
                    continue
                if isinstance(item, dict):
                    name = (
                        item.get("name")
                        or item.get("language")
                        or item.get("lang")
                        or item.get("title")
                        or ""
                    )
                    level = item.get("level") or item.get("proficiency") or item.get("fluency") or item.get("skill_level")
                    normalized.append({**item, "name": str(name).strip(), "level": _coerce_text_field(level)})
                    continue
                normalized.append(item)
            return normalized
        return value

    @field_validator("educations", mode="before")
    @classmethod
    def normalize_educations(cls, value):
        if isinstance(value, str):
            entries = _split_text_values(value)
            if not entries:
                return []
            if len(entries) >= 2:
                return [{"level": entries[0], "field_of_study": " ".join(entries[1:])}]
            return [{"level": "Unknown", "field_of_study": entries[0]}]
        if isinstance(value, list):
            normalized = []
            for item in value:
                if isinstance(item, str):
                    text = item.strip()
                    if text:
                        normalized.append({"level": text, "field_of_study": text})
                    continue
                if isinstance(item, dict):
                    level = (
                        item.get("level")
                        or item.get("degree")
                        or item.get("qualification")
                        or item.get("title")
                        or item.get("institution")
                        or item.get("school")
                        or "Unknown"
                    )
                    field_of_study = (
                        item.get("field_of_study")
                        or item.get("study_field")
                        or item.get("subject")
                        or item.get("major")
                        or item.get("program")
                        or item.get("institution")
                        or item.get("school")
                        or "Unknown"
                    )
                    normalized.append({
                        **item,
                        "level": str(level).strip() or "Unknown",
                        "field_of_study": str(field_of_study).strip() or "Unknown",
                    })
                    continue
                normalized.append(item)
            return normalized
        return value

    @field_validator("industries", mode="before")
    @classmethod
    def normalize_industries(cls, value):
        if isinstance(value, str):
            return [{"name": industry} for industry in _split_text_values(value)]
        if isinstance(value, list):
            normalized = []
            for item in value:
                if isinstance(item, str):
                    name = item.strip()
                    if name:
                        normalized.append({"name": name})
                    continue
                if isinstance(item, dict):
                    name = item.get("name") or item.get("industry") or item.get("sector") or item.get("label") or ""
                    normalized.append({**item, "name": str(name).strip()})
                    continue
                normalized.append(item)
            return normalized
        return value

    @field_validator("work_history", mode="before")
    @classmethod
    def normalize_work_history(cls, value):
        if isinstance(value, dict):
            return [value]
        if isinstance(value, str):
            return []
        if isinstance(value, list):
            normalized = []
            for item in value:
                if isinstance(item, dict):
                    normalized.append({
                        **item,
                        "employer": item.get("employer") or item.get("company") or item.get("organization") or item.get("organization_name"),
                        "position": item.get("position") or item.get("role") or item.get("title") or item.get("job_title"),
                        "from_date": item.get("from_date") or item.get("start_date") or item.get("from") or item.get("start"),
                        "to_date": item.get("to_date") or item.get("end_date") or item.get("to") or item.get("end"),
                        "description": item.get("description") or item.get("duties") or item.get("summary"),
                        "location": item.get("location") or item.get("city") or item.get("place"),
                        "is_current": bool(item.get("is_current") if item.get("is_current") is not None else item.get("current") or item.get("present")),
                    })
                    continue
                normalized.append(item)
            return normalized
        return value

    @field_validator("education_history", mode="before")
    @classmethod
    def normalize_education_history(cls, value):
        if isinstance(value, dict):
            return [value]
        if isinstance(value, str):
            return []
        if isinstance(value, list):
            normalized = []
            for item in value:
                if isinstance(item, dict):
                    normalized.append({
                        **item,
                        "institution": item.get("institution") or item.get("school") or item.get("university") or item.get("academy") or item.get("college"),
                        "degree": item.get("degree") or item.get("level") or item.get("qualification") or item.get("title"),
                        "field_of_study": item.get("field_of_study") or item.get("study_field") or item.get("subject") or item.get("major") or item.get("program"),
                        "from_date": item.get("from_date") or item.get("start_date") or item.get("from") or item.get("start"),
                        "to_date": item.get("to_date") or item.get("end_date") or item.get("to") or item.get("end"),
                        "description": item.get("description") or item.get("summary") or item.get("notes"),
                    })
                    continue
                normalized.append(item)
            return normalized
        return value

    @field_validator("preferred_roles", mode="before")
    @classmethod
    def normalize_preferred_roles(cls, value):
        if isinstance(value, str):
            return _split_text_values(value)
        return value


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
    about_us: str | None = None
    description: str | None = None
    requirements: str | None = None
    benefits: str | None = None
    required_skills: list[JobSkillExtraction] = Field(default_factory=list)
    required_languages: list[LanguageExtraction] = Field(default_factory=list)
    required_degrees: list[EducationExtraction] = Field(default_factory=list)
    industries: list[IndustryExtraction] = Field(default_factory=list)

    @field_validator("about_us", "description", "requirements", "benefits", mode="before")
    @classmethod
    def normalize_text_fields(cls, value):
        return _coerce_text_field(value)


class IngestResponse(BaseModel):
    id: str
    message: str


class CandidateIngestResponse(IngestResponse):
    profile: CandidateProfileExtraction
    persisted: bool = True


class JobIngestResponse(IngestResponse):
    profile: JobProfileExtraction
    persisted: bool = True


class MatchingCandidateInput(BaseModel):
    id: str | int
    name: str | None = None
    location: Any | None = None
    experience: Any | None = None
    skills: Any | None = None
    has_skill: Any | None = None
    education: Any | None = None
    desired_salary: Any | None = None
    availability: Any | None = None
    languages: Any | None = None
    certificates: Any | None = None
    mobility: Any | None = None


class MatchingJobInput(BaseModel):
    id: str | int | None = None
    title: str | None = None
    description: str | None = None
    requirements: str | None = None
    required_skills: Any | None = None
    location: str | None = None
    type: str | None = None


class MatchingRunRequest(BaseModel):
    job: MatchingJobInput
    candidates: list[MatchingCandidateInput] = Field(default_factory=list)
    weights: dict[str, int] | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class MatchingMatrixRequest(BaseModel):
    mode: str = "all_jobs_all_candidates"
    jobs: list[MatchingJobInput] = Field(default_factory=list)
    candidates: list[MatchingCandidateInput] = Field(default_factory=list)
    weights: dict[str, int] | None = None
    options: dict[str, Any] = Field(default_factory=dict)


class MatchingResultItem(BaseModel):
    candidateId: str
    candidateName: str | None = None
    score: int = Field(..., ge=0, le=100)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    summary: str = ""


class MatchingResultsPayload(BaseModel):
    results: list[MatchingResultItem] = Field(default_factory=list)


class MatchingMatrixRow(BaseModel):
    jobId: str
    jobTitle: str | None = None
    candidateId: str
    candidateName: str | None = None
    score: int = Field(..., ge=0, le=100)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    summary: str = ""


class MatchingMatrixPayload(BaseModel):
    type: Literal["matrix"] = "matrix"
    mode: str
    model: str | None = None
    matchedAt: str
    jobs: list[dict[str, Any]] = Field(default_factory=list)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    matrix: list[MatchingMatrixRow] = Field(default_factory=list)
    jobsRanked: list[dict[str, Any]] = Field(default_factory=list)
    candidatesRanked: list[dict[str, Any]] = Field(default_factory=list)


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


class AiUsageMetrics(BaseModel):
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    ai_usage: AiUsageMetrics = Field(default_factory=AiUsageMetrics)


class FileTextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_text: str | None = None
