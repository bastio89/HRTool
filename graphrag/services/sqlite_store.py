from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path
from typing import Any

from models import JobProfileExtraction


class SQLiteJobStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    async def upsert_job(
        self,
        job_id: str,
        raw_text: str,
        profile: JobProfileExtraction,
    ) -> int:
        return await asyncio.to_thread(self._upsert_job_sync, job_id, raw_text, profile)

    def _ensure_column(self, connection: sqlite3.Connection, table: str, column: str, column_type: str) -> None:
        existing_columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in existing_columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")

    def _ensure_schema(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                graph_job_id TEXT,
                title TEXT NOT NULL,
                company TEXT,
                recruiter_company TEXT,
                employer_company TEXT,
                description TEXT,
                requirements TEXT,
                about_us TEXT,
                benefits TEXT,
                location TEXT,
                type TEXT DEFAULT 'Vollzeit',
                status TEXT DEFAULT 'Offen',
                url TEXT,
                raw_text TEXT,
                parsed_profile_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        self._ensure_column(connection, "jobs", "graph_job_id", "TEXT")
        self._ensure_column(connection, "jobs", "company", "TEXT")
        self._ensure_column(connection, "jobs", "recruiter_company", "TEXT")
        self._ensure_column(connection, "jobs", "employer_company", "TEXT")
        self._ensure_column(connection, "jobs", "about_us", "TEXT")
        self._ensure_column(connection, "jobs", "benefits", "TEXT")
        self._ensure_column(connection, "jobs", "url", "TEXT")
        self._ensure_column(connection, "jobs", "raw_text", "TEXT")
        self._ensure_column(connection, "jobs", "parsed_profile_json", "TEXT")

    @staticmethod
    def _summarize_requirements(profile: JobProfileExtraction) -> str | None:
        parts: list[str] = []

        mandatory_skills = [item.name for item in profile.required_skills if item.priority == "Mandatory"]
        nice_to_have_skills = [item.name for item in profile.required_skills if item.priority == "NiceToHave"]
        if mandatory_skills:
            parts.append(f"Mandatory skills: {', '.join(mandatory_skills)}")
        if nice_to_have_skills:
            parts.append(f"Nice-to-have skills: {', '.join(nice_to_have_skills)}")

        if profile.required_languages:
            languages = ", ".join(
                f"{language.name}{f' ({language.level})' if language.level else ''}"
                for language in profile.required_languages
            )
            parts.append(f"Languages: {languages}")

        if profile.required_degrees:
            degrees = ", ".join(f"{degree.level} {degree.field_of_study}" for degree in profile.required_degrees)
            parts.append(f"Degrees: {degrees}")

        if profile.industries:
            parts.append("Industries: " + ", ".join(industry.name for industry in profile.industries))

        return " | ".join(parts) if parts else None

    @staticmethod
    def _render_plain_text(profile: JobProfileExtraction) -> str:
        parts = [profile.title]
        if profile.company:
            parts.append(f"Company: {profile.company}")
        if profile.location:
            parts.append(f"Location: {profile.location}")
        if profile.employment_type:
            parts.append(f"Employment type: {profile.employment_type}")

        requirements: list[str] = []
        if profile.required_skills:
            requirements.append(
                "Skills: "
                + ", ".join(
                    f"{item.name} ({item.priority})" if item.priority else item.name
                    for item in profile.required_skills
                )
            )
        if profile.required_languages:
            requirements.append("Languages: " + ", ".join(language.name for language in profile.required_languages))
        if profile.required_degrees:
            requirements.append(
                "Degrees: "
                + ", ".join(f"{degree.level} {degree.field_of_study}" for degree in profile.required_degrees)
            )
        if profile.industries:
            requirements.append("Industries: " + ", ".join(industry.name for industry in profile.industries))

        if requirements:
            parts.append("Requirements: " + " | ".join(requirements))

        return "\n".join(part for part in parts if part).strip()

    def _upsert_job_sync(self, job_id: str, raw_text: str, profile: JobProfileExtraction) -> int:
        description_text = raw_text.strip() if raw_text and raw_text.strip() else self._render_plain_text(profile)
        record: dict[str, Any] = {
            "graph_job_id": job_id,
            "title": profile.title,
            "company": profile.company,
            "recruiter_company": profile.recruiter_company,
            "employer_company": profile.employer_company,
            "description": description_text,
            "requirements": self._summarize_requirements(profile),
            "about_us": None,
            "benefits": None,
            "location": profile.location,
            "type": profile.employment_type or "Vollzeit",
            "status": "Offen",
            "url": None,
            "raw_text": raw_text,
            "parsed_profile_json": json.dumps(profile.model_dump(), ensure_ascii=False),
        }

        with sqlite3.connect(self.db_path) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            self._ensure_schema(connection)
            cursor = connection.execute(
                """
                INSERT INTO jobs (
                    graph_job_id,
                    title,
                    company,
                    recruiter_company,
                    employer_company,
                    description,
                    requirements,
                    about_us,
                    benefits,
                    location,
                    type,
                    status,
                    url,
                    raw_text,
                    parsed_profile_json
                ) VALUES (
                    :graph_job_id,
                    :title,
                    :company,
                    :recruiter_company,
                    :employer_company,
                    :description,
                    :requirements,
                    :about_us,
                    :benefits,
                    :location,
                    :type,
                    :status,
                    :url,
                    :raw_text,
                    :parsed_profile_json
                )
                """,
                record,
            )
            connection.commit()
            return int(cursor.lastrowid)