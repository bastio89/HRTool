from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from batch_tools import import_cvs_from_pdfs as importer
from models import JobCandidateMatch, JobProfileExtraction, JobSkillExtraction, LanguageExtraction, EducationExtraction, IndustryExtraction


class FakePdfService:
    def extract_text(self, data: bytes) -> str:
        return "Senior Data Engineer with Python, SQL and German B2 requirements."


class FakeDbService:
    def __init__(self) -> None:
        self.upsert_kwargs = None

    async def find_job_by_source_hash(self, source_hash: str):
        return None

    async def find_job_by_profile_hash(self, profile_hash: str):
        return None

    async def upsert_job(self, **kwargs):
        self.upsert_kwargs = kwargs

    async def get_top_candidate_matches_for_job(self, job_id: str, limit: int = 10):
        return [
            JobCandidateMatch(
                candidate_id="cand-1",
                name="Max Mustermann",
                location="Berlin",
                experience_years=7,
                skill_similarity=0.91,
                shared_skills=["python"],
                similar_skills=[],
                candidate_skills=["python", "sql"],
                job_skills=["python", "sql"],
            )
        ]

    async def close(self) -> None:
        return None


def test_resolve_input_dir_uses_job_input_for_job_mode():
    args = type("Args", (), {"mode": "job", "input_dir": None})()

    assert importer._resolve_input_dir(args).name == "job_input"


@pytest.mark.anyio
async def test_process_job_file_parses_profile_and_persists_skills(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")
    done_dir = tmp_path / "done"

    fake_profile = JobProfileExtraction(
        title="Senior Data Engineer",
        department="Analytics",
        company="Beyond Gravity",
        recruiter_company="Beyond Gravity Recruiting",
        employer_company="Beyond Gravity AG",
        location="Zurich",
        employment_type="Vollzeit",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="mandatory"),
        ],
        required_languages=[LanguageExtraction(name="Deutsch", level="B2")],
        required_degrees=[EducationExtraction(level="Master", field_of_study="Informatik")],
        industries=[IndustryExtraction(name="Aerospace")],
    )

    fake_db = FakeDbService()
    fake_llm = AsyncMock()
    fake_llm.parse_job_description = AsyncMock(return_value=fake_profile)
    fake_llm.create_embedding = AsyncMock(side_effect=[[0.1, 0.2, 0.3], [0.4], [0.5]])

    monkeypatch.setattr(importer, "uuid4", lambda: "job-123")

    ok, message = await importer.process_job_file(
        pdf_path=pdf_path,
        done_dir=done_dir,
        dry_run=False,
        pdf_service=FakePdfService(),
        db_service=fake_db,
        llm_service=fake_llm,
        match_limit=5,
    )

    assert ok is True
    assert "imported as job id=job-123" in message
    assert "top candidate matches:" in message
    assert pdf_path.exists() is False
    assert (done_dir / "job.pdf").exists() is True
    assert fake_llm.parse_job_description.await_count == 1
    assert fake_llm.create_embedding.await_count == 3
    assert fake_db.upsert_kwargs is not None
    assert fake_db.upsert_kwargs["job_id"] == "job-123"
    assert fake_db.upsert_kwargs["profile"].title == "Senior Data Engineer"
    assert fake_db.upsert_kwargs["skill_embeddings"]["python"] == [0.4]
    assert fake_db.upsert_kwargs["skill_embeddings"]["sql"] == [0.5]
    assert fake_db.upsert_kwargs["source_hash"]
    assert fake_db.upsert_kwargs["profile_hash"]
