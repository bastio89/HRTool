from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

import services.postgres_store as postgres_store_module
from models import JobProfileExtraction, JobSkillExtraction
from jobs_ch_to_pdf import JobPosting, description_to_text
from plugins.jobs_ch.service import JobsChImportService
from services.postgres_store import PostgresStore


def test_jobs_ch_llm_input_matches_exported_pdf_text_structure() -> None:
    job = JobPosting(
        title="Fachkundiger Projektleiter Elektroplanung",
        company="Dottikon Exclusive Synthesis AG",
        location="Dottikon",
        employment_type="Festanstellung",
        date_posted="2026-09-25T14:06:31+02:00",
        source_url="https://www.jobs.ch/de/stellenangebote/detail/example/",
        description=(
            "<h2>Ihre Verantwortung</h2>"
            "<ul><li>Projektleitung in der Elektro- und MSR-Technik</li>"
            "<li>Erstellen von Konzeptstudien und Ausschreibungen</li></ul>"
            "<h2>Ihr Profil</h2>"
            "<ul><li>Abgeschlossene Ausbildung als Elektroplaner</li>"
            "<li>Teamfähig, zuverlässig und flexibel</li></ul>"
        ),
    )

    parsed_description = description_to_text(job.description)
    llm_text = JobsChImportService._build_raw_text(job)

    assert "<h2>" not in llm_text
    assert "Ihre Verantwortung" in llm_text
    assert "Projektleitung in der Elektro- und MSR-Technik" in llm_text
    assert "Ihr Profil" in llm_text
    assert "Abgeschlossene Ausbildung als Elektroplaner" in llm_text
    assert llm_text.index("Dottikon Exclusive Synthesis AG") < llm_text.index("Ihre Verantwortung")
    assert llm_text.index("Quelle:") > llm_text.index("Teamfähig, zuverlässig und flexibel")
    assert parsed_description == (
        "Ihre Verantwortung\n"
        "- Projektleitung in der Elektro- und MSR-Technik\n"
        "- Erstellen von Konzeptstudien und Ausschreibungen\n"
        "Ihr Profil\n"
        "- Abgeschlossene Ausbildung als Elektroplaner\n"
        "- Teamfähig, zuverlässig und flexibel"
    )


@pytest.mark.anyio
async def test_existing_job_with_empty_skills_is_backfilled() -> None:
    class FakeConnection:
        executed: tuple[str, tuple[object, ...]] | None = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, query: str, params: tuple[object, ...]) -> None:
            self.executed = (query, params)

    connection = FakeConnection()
    store = PostgresStore("postgresql://example")
    store._find_existing_job = AsyncMock(return_value={"id": 19})
    connect = AsyncMock(return_value=connection)
    original_connect = postgres_store_module.psycopg.AsyncConnection.connect
    postgres_store_module.psycopg.AsyncConnection.connect = connect
    try:
        result = await store._upsert_job_once(
            job_id="graph-job-19",
            raw_text="Fachkundiger Projektleiter Elektroplanung",
            profile=JobProfileExtraction(
                title="Fachkundiger Projektleiter Elektroplanung",
                required_skills=[
                    JobSkillExtraction(name="Elektroplanung", priority="Mandatory"),
                    JobSkillExtraction(name="MSR-Technik", priority="Mandatory"),
                ],
            ),
            source="Jobs.ch-import",
        )
    finally:
        postgres_store_module.psycopg.AsyncConnection.connect = original_connect

    assert result == 19
    assert connection.executed is not None
    query, params = connection.executed
    assert "SET skills = %s" in query
    assert "COALESCE(BTRIM(skills), '') = ''" in query
    assert params == ("Elektroplanung, MSR-Technik", 19)


@pytest.mark.anyio
async def test_new_job_stores_extracted_skills() -> None:
    class FakeCursor:
        executed: tuple[str, tuple[object, ...]] | None = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, query: str, params: tuple[object, ...]) -> None:
            self.executed = (query, params)

        async def fetchone(self) -> dict[str, int]:
            return {"id": 23}

    class FakeConnection:
        def __init__(self, cursor: FakeCursor):
            self._cursor = cursor

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def cursor(self, **_kwargs) -> FakeCursor:
            return self._cursor

    cursor = FakeCursor()
    connection = FakeConnection(cursor)
    store = PostgresStore("postgresql://example")
    store._find_existing_job = AsyncMock(return_value=None)
    connect = AsyncMock(return_value=connection)
    original_connect = postgres_store_module.psycopg.AsyncConnection.connect
    postgres_store_module.psycopg.AsyncConnection.connect = connect
    try:
        result = await store._upsert_job_once(
            job_id="graph-job-23",
            raw_text="Projektleitung Elektroplanung",
            profile=JobProfileExtraction(
                title="Projektleitung Elektroplanung",
                required_skills=[
                    JobSkillExtraction(name="Elektroplanung", priority="Mandatory"),
                    JobSkillExtraction(name="MSR-Technik", priority="Mandatory"),
                ],
            ),
            source="Jobs.ch-import",
        )
    finally:
        postgres_store_module.psycopg.AsyncConnection.connect = original_connect

    assert result == 23
    assert cursor.executed is not None
    query, params = cursor.executed
    assert "requirements, skills, about_us" in query
    assert params[7] == "Elektroplanung, MSR-Technik"