from __future__ import annotations

import pytest

from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    EducationExtraction,
    IndustryExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
    LanguageExtraction,
)
from services.db import Neo4jService


class _FakeResult:
    async def consume(self) -> None:
        return None


class _FakeSession:
    def __init__(self) -> None:
        self.last_query: str | None = None
        self.last_params: dict | None = None

    async def __aenter__(self) -> _FakeSession:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def run(self, query: str, **params):
        self.last_query = query
        self.last_params = params
        return _FakeResult()


class _FakeDriver:
    def __init__(self, session: _FakeSession) -> None:
        self._session = session

    def session(self) -> _FakeSession:
        return self._session


@pytest.mark.anyio
async def test_upsert_job_writes_company_and_bridge_nodes() -> None:
    fake_session = _FakeSession()
    service = Neo4jService(uri="bolt://unused", user="neo4j", password="unused")
    service.driver = _FakeDriver(fake_session)

    profile = JobProfileExtraction(
        title="Senior Data Engineer",
        company="Sopra Steria",
        recruiter_company="Sopra Steria Recruiting",
        employer_company="Sopra Steria AG",
        location="Berlin",
        employment_type="Vollzeit",
        required_skills=[
            JobSkillExtraction(name="python", category="HardSkill", priority="Mandatory"),
            JobSkillExtraction(name="communication", category="SoftSkill", priority="NiceToHave"),
        ],
        required_languages=[LanguageExtraction(name="Deutsch", level="C1")],
        required_degrees=[EducationExtraction(level="Master", field_of_study="Informatik")],
        industries=[IndustryExtraction(name="IT-Consulting")],
    )

    await service.upsert_job(job_id="job-1", profile=profile, embedding=[0.1, 0.2])

    assert fake_session.last_query is not None
    assert "j.company = $company" in fake_session.last_query
    assert "j.recruiterCompany = $recruiter_company" in fake_session.last_query
    assert "j.employerCompany = $employer_company" in fake_session.last_query
    assert "j.employmentType = $employment_type" in fake_session.last_query
    assert "ON CREATE SET s.embedding = $skill_embeddings[toLower(req.name)]" in fake_session.last_query
    assert "NEED_SKILL" in fake_session.last_query
    assert "rs.jobDescriptionEmbedding = $embedding" in fake_session.last_query
    assert "ns.jobDescriptionEmbedding = $embedding" in fake_session.last_query
    assert "HAS_LANGUAGE" in fake_session.last_query
    assert "REQUIRES_LANGUAGE" in fake_session.last_query
    assert "HAS_EDUCATION" in fake_session.last_query
    assert "REQUIRES_DEGREE" in fake_session.last_query
    assert "IN_INDUSTRY" in fake_session.last_query
    assert "SET rs.priority = req.priority" in fake_session.last_query
    assert "Recruiter" in fake_session.last_query
    assert "Employer" in fake_session.last_query
    assert "POSTED_BY" in fake_session.last_query
    assert "FOR_EMPLOYER" in fake_session.last_query

    assert fake_session.last_params is not None
    assert fake_session.last_params["company"] == "Sopra Steria"
    assert fake_session.last_params["recruiter_company"] == "Sopra Steria Recruiting"
    assert fake_session.last_params["employer_company"] == "Sopra Steria AG"
    assert fake_session.last_params["employment_type"] == "Vollzeit"
    assert fake_session.last_params["required_languages"][0]["name"] == "Deutsch"
    assert fake_session.last_params["required_degrees"][0]["field_of_study"] == "Informatik"
    assert fake_session.last_params["industries"][0]["name"] == "IT-Consulting"


@pytest.mark.anyio
async def test_upsert_candidate_writes_salary_and_bridge_nodes() -> None:
    fake_session = _FakeSession()
    service = Neo4jService(uri="bolt://unused", user="neo4j", password="unused")
    service.driver = _FakeDriver(fake_session)

    profile = CandidateProfileExtraction(
        name="Max Mustermann",
        email="max@example.com",
        phone="+41 79 555 01 02",
        location="Munich",
        experience_years=7,
        salary_expectation=95000,
        experience="Senior .NET Core Developer",
        education="Master of Science in Computer Science, ETH Zürich",
        desired_salary="95000 CHF",
        availability="Immediate",
        notice_period="1 month",
        linkedin_url="https://linkedin.com/in/max",
        nationality="Swiss",
        gender="Herr",
        current_employer="ACME GmbH",
        current_position="Senior Engineer",
        certificates="AWS, Azure",
        drivers_license="B",
        mobility="Reisebereit",
        tags="Senior, Remote",
        notes="Imported from CV",
        skills=[
            CandidateSkillExtraction(name="python", category="HardSkill", level="Expert", experience_years=7),
        ],
        languages=[LanguageExtraction(name="Deutsch", level="C2")],
        educations=[EducationExtraction(level="Bachelor", field_of_study="Informatik")],
        industries=[IndustryExtraction(name="Aerospace")],
        work_history=[
            {
                "employer": "ACME GmbH",
                "position": "Senior Engineer",
                "from_date": "2022-01",
                "to_date": None,
                "is_current": True,
                "description": "Built data platforms",
                "location": "Berlin",
            }
        ],
        education_history=[
            {
                "institution": "FHNW",
                "degree": "Bachelor of Science",
                "field_of_study": "Wirtschaftsinformatik",
                "from_date": "2018-09",
                "to_date": "2021-06",
                "description": "BSc thesis in data engineering",
            }
        ],
        preferred_roles=["data engineer"],
    )

    await service.upsert_candidate(candidate_id="cand-1", profile=profile, embedding=[0.3, 0.4])

    assert fake_session.last_query is not None
    assert "c.email = $email" in fake_session.last_query
    assert "c.phone = $phone" in fake_session.last_query
    assert "c.salaryExpectation = $salary_expectation" in fake_session.last_query
    assert "c.experience = $experience" in fake_session.last_query
    assert "c.education = $education" in fake_session.last_query
    assert "c.desiredSalary = $desired_salary" in fake_session.last_query
    assert "c.availability = $availability" in fake_session.last_query
    assert "c.noticePeriod = $notice_period" in fake_session.last_query
    assert "c.linkedinUrl = $linkedin_url" in fake_session.last_query
    assert "c.nationality = $nationality" in fake_session.last_query
    assert "c.gender = $gender" in fake_session.last_query
    assert "c.currentEmployer = $current_employer" in fake_session.last_query
    assert "c.currentPosition = $current_position" in fake_session.last_query
    assert "c.certificates = $certificates" in fake_session.last_query
    assert "c.driversLicense = $drivers_license" in fake_session.last_query
    assert "c.mobility = $mobility" in fake_session.last_query
    assert "c.tags = $tags" in fake_session.last_query
    assert "c.notes = $notes" in fake_session.last_query
    assert "c.yearsOfExperience = $experience_years" in fake_session.last_query
    assert "ON CREATE SET s.embedding = $skill_embeddings[toLower(skill.name)]" in fake_session.last_query
    assert "HAS_LANGUAGE" in fake_session.last_query
    assert "SPEAKS" in fake_session.last_query
    assert "HAS_EDUCATION" in fake_session.last_query
    assert "HAS_DEGREE" in fake_session.last_query
    assert "HAS_INDUSTRY" in fake_session.last_query
    assert "HAS_WORK_HISTORY" in fake_session.last_query
    assert "HAS_EDUCATION_HISTORY" in fake_session.last_query
    assert "WorkExperience" in fake_session.last_query
    assert "EducationHistory" in fake_session.last_query

    assert fake_session.last_params is not None
    assert fake_session.last_params["email"] == "max@example.com"
    assert fake_session.last_params["phone"] == "+41 79 555 01 02"
    assert fake_session.last_params["salary_expectation"] == 95000
    assert fake_session.last_params["experience"] == "Senior .NET Core Developer"
    assert fake_session.last_params["education"] == "Master of Science in Computer Science, ETH Zürich"
    assert fake_session.last_params["desired_salary"] == "95000 CHF"
    assert fake_session.last_params["availability"] == "Immediate"
    assert fake_session.last_params["notice_period"] == "1 month"
    assert fake_session.last_params["linkedin_url"] == "https://linkedin.com/in/max"
    assert fake_session.last_params["nationality"] == "Swiss"
    assert fake_session.last_params["gender"] == "Herr"
    assert fake_session.last_params["current_employer"] == "ACME GmbH"
    assert fake_session.last_params["current_position"] == "Senior Engineer"
    assert fake_session.last_params["certificates"] == "AWS, Azure"
    assert fake_session.last_params["drivers_license"] == "B"
    assert fake_session.last_params["mobility"] == "Reisebereit"
    assert fake_session.last_params["tags"] == "Senior, Remote"
    assert fake_session.last_params["notes"] == "Imported from CV"
    assert fake_session.last_params["work_history"][0]["employer"] == "ACME GmbH"
    assert fake_session.last_params["work_history"][0]["position"] == "Senior Engineer"
    assert fake_session.last_params["education_history"][0]["institution"] == "FHNW"
    assert fake_session.last_params["education_history"][0]["degree"] == "Bachelor of Science"
    assert fake_session.last_params["languages"][0]["name"] == "Deutsch"
    assert fake_session.last_params["educations"][0]["field_of_study"] == "Informatik"
    assert fake_session.last_params["industries"][0]["name"] == "Aerospace"


def test_job_skill_priority_accepts_legacy_importance_alias() -> None:
    skill = JobSkillExtraction(name="sql", importance="nice_to_have")

    assert skill.priority == "NiceToHave"
    assert skill.model_dump()["priority"] == "NiceToHave"
