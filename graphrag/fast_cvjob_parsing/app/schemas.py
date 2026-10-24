from typing import List, Optional

from pydantic import BaseModel, Field


class PersonalData(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    location: Optional[str] = None


class WorkExperience(BaseModel):
    employer: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    job_title: Optional[str] = None
    tasks_summary: List[str] = Field(default_factory=list)


class Education(BaseModel):
    degree_or_title: Optional[str] = None
    institution: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class CategorizedSkills(BaseModel):
    soft_skills: List[str] = Field(default_factory=list)
    it_skills: List[str] = Field(default_factory=list)
    method_skills: List[str] = Field(default_factory=list)
    tool_skills: List[str] = Field(default_factory=list)
    language_skills: List[str] = Field(default_factory=list)


class CVResponse(BaseModel):
    personal_data: PersonalData
    work_experience: List[WorkExperience]
    education: List[Education]
    skills: CategorizedSkills


class JobResponse(BaseModel):
    company_name: Optional[str] = None
    location: Optional[str] = None
    job_title: Optional[str] = None
    required_skills: CategorizedSkills
    remote_work: Optional[str] = None
    workload_pensum: Optional[str] = None


class JobParseResponse(BaseModel):
    profile: JobResponse
    raw_text: str