from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from uuid import uuid4

import jobs_ch_to_pdf

from models import JobProfileExtraction
from services.job_persistence import persist_job_profile
from services.llm import LLMService
from services.postgres_store import PostgresStore
from services.db import Neo4jService

from .schemas import JobsChExportRequest
from .schemas import JobsChImportRequest
from .schemas import JobsChSearchItem


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobsChExportResult:
    filename: str
    warning: str | None
    payload: bytes


@dataclass(frozen=True)
class JobsChImportItemResult:
    link: str
    job_id: str | None
    title: str | None
    imported: bool
    error: str | None = None


@dataclass(frozen=True)
class JobsChImportResult:
    imported: int
    failed: int
    warning: str | None
    items: list[JobsChImportItemResult]


class JobsChExportService:
    @staticmethod
    def _normalize_links(payload: JobsChExportRequest) -> list[str]:
        links: list[str] = []
        for link in payload.links:
            if isinstance(link, str):
                normalized = link.strip()
                if normalized and normalized not in links:
                    links.append(normalized)
        return links

    @staticmethod
    def _filename_component(value: str | None, fallback: str) -> str:
        cleaned = "".join(char if char.isalnum() or char in "._-" else "_" for char in (value or "")).strip("_")
        return cleaned or fallback

    @staticmethod
    def _date_component(value: str | None) -> str:
        if not value:
            return "unknown-date"
        normalized = value.strip()
        for parser in (date.fromisoformat, datetime.fromisoformat):
            try:
                parsed = parser(normalized)
                return parsed.strftime("%d-%m-%Y")
            except ValueError:
                continue
        return JobsChExportService._filename_component(normalized, "unknown-date")

    def export(self, payload: JobsChExportRequest) -> JobsChExportResult:
        links = self._normalize_links(payload)
        if not links:
            raise ValueError("Mindestens ein jobs.ch-Link ist erforderlich.")

        temp_dir = Path(tempfile.mkdtemp(prefix="hrtool-jobs-ch-"))
        pdf_outputs: list[Path] = []
        skipped_count = 0

        try:
            for link in links:
                try:
                    job = jobs_ch_to_pdf.fetch_job(link)
                    filename = "_".join([
                        self._filename_component(job.title, "job"),
                        self._filename_component(job.company, "company"),
                        self._date_component(job.date_posted),
                    ])
                    output = temp_dir / f"{filename}.pdf"
                    jobs_ch_to_pdf.write_pdf(job, output)
                    pdf_outputs.append(output)
                except (ValueError, RuntimeError, OSError):
                    skipped_count += 1

            if not pdf_outputs:
                raise RuntimeError("Kein jobs.ch-Link konnte erfolgreich in ein PDF umgewandelt werden.")

            zip_name = f"jobs-ch-pdfs-{int(temp_dir.stat().st_mtime)}.zip"
            zip_path = temp_dir / zip_name
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for pdf_path in pdf_outputs:
                    archive.write(pdf_path, arcname=pdf_path.name)

            warning = None
            if skipped_count:
                warning = f"{skipped_count} jobs.ch-Link{'s' if skipped_count != 1 else ''} wurden übersprungen."

            return JobsChExportResult(
                filename=zip_name,
                warning=warning,
                payload=zip_path.read_bytes(),
            )
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class JobsChImportService:
    SOURCE_LABEL = "Jobs.ch-import"

    def __init__(self, *, llm_service: LLMService, postgres_store: PostgresStore, db_service: Neo4jService) -> None:
        self.llm_service = llm_service
        self.postgres_store = postgres_store
        self.db_service = db_service

    @staticmethod
    def _normalize_links(payload: JobsChImportRequest) -> list[str]:
        links: list[str] = []
        for link in payload.links:
            if isinstance(link, str):
                normalized = link.strip()
                if normalized and normalized not in links:
                    links.append(normalized)
        return links

    @staticmethod
    def _build_raw_text(job: jobs_ch_to_pdf.JobPosting) -> str:
        sections = [
            f"Jobtitel: {job.title}",
            f"Unternehmen: {job.company}" if job.company else "",
            f"Standort: {job.location}" if job.location else "",
            f"Anstellungsart: {job.employment_type}" if job.employment_type else "",
            f"Veröffentlicht: {job.date_posted}" if job.date_posted else "",
            f"Quelle: {job.source_url}" if job.source_url else "",
            "",
            job.description,
        ]
        return "\n".join(section for section in sections if section is not None).strip()

    @staticmethod
    def _normalized_text_hash(text: str | None) -> str | None:
        if not isinstance(text, str):
            return None
        normalized = " ".join(text.split()).strip()
        if not normalized:
            return None
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalized_profile_hash(profile: JobProfileExtraction) -> str | None:
        try:
            payload = profile.model_dump(mode="json")
            serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            return hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        except Exception:
            return None

    async def _build_skill_embeddings(self, skill_names: list[str]) -> dict[str, list[float]]:
        unique_names = sorted({name.strip() for name in skill_names if isinstance(name, str) and name.strip()})
        if not unique_names:
            return {}

        skill_embeddings: dict[str, list[float]] = {}
        for skill_name in unique_names:
            skill_embeddings[skill_name.lower()] = await self.llm_service.create_embedding(
                {
                    "entity": "skill",
                    "name": skill_name,
                },
                allow_fallback=False,
            )
        return skill_embeddings

    async def search(self, query: str, *, limit: int = 20) -> list[JobsChSearchItem]:
        results = await asyncio.to_thread(jobs_ch_to_pdf.search_jobs, query, 30, limit)
        return [
            JobsChSearchItem(
                title=item.title,
                link=item.link,
                job_id=item.job_id,
                company=item.company,
                location=item.location,
            )
            for item in results
        ]

    async def import_links(self, payload: JobsChImportRequest) -> JobsChImportResult:
        links = self._normalize_links(payload)
        if not links:
            raise ValueError("Mindestens ein jobs.ch-Link ist erforderlich.")

        items: list[JobsChImportItemResult] = []
        imported_count = 0
        failed_count = 0

        for link in links:
            try:
                job = jobs_ch_to_pdf.fetch_job(link)
                raw_text = self._build_raw_text(job)
                if not raw_text.strip():
                    raise RuntimeError("jobs.ch-Seite liefert keinen verwertbaren Text.")

                parsed_profile = await self.llm_service.parse_job_description(raw_text)
                profile_data = parsed_profile.model_dump()
                profile_data["title"] = job.title or profile_data.get("title") or "Unknown Job"
                if job.company:
                    profile_data["company"] = job.company
                if job.location:
                    profile_data["location"] = job.location
                if job.employment_type:
                    profile_data["employment_type"] = job.employment_type
                profile = JobProfileExtraction.model_validate(profile_data)

                source_hash = self._normalized_text_hash(raw_text)
                profile_hash = self._normalized_profile_hash(profile)
                existing_job = None
                try:
                    if source_hash:
                        existing_job = await self.db_service.find_job_by_source_hash(source_hash)
                    if existing_job is None and profile_hash:
                        existing_job = await self.db_service.find_job_by_profile_hash(profile_hash)
                except Exception:
                    logger.warning("jobs.ch duplicate lookup failed for %s", link, exc_info=True)
                    existing_job = None

                job_id = existing_job["id"] if existing_job else (job.job_id or str(uuid4()))
                embedding = await self.llm_service.create_embedding(profile.model_dump(), allow_fallback=False)
                skill_embeddings = await self._build_skill_embeddings([item.name for item in profile.required_skills])

                await persist_job_profile(
                    postgres_store=self.postgres_store,
                    job_id=job_id,
                    raw_text=raw_text,
                    profile=profile,
                    source=self.SOURCE_LABEL,
                    source_hash=source_hash,
                    profile_hash=profile_hash,
                )
                await self.db_service.upsert_job(
                    job_id=job_id,
                    profile=profile,
                    embedding=embedding,
                    skill_embeddings=skill_embeddings,
                    source_hash=source_hash,
                    profile_hash=profile_hash,
                )

                imported_count += 1
                items.append(
                    JobsChImportItemResult(
                        link=link,
                        job_id=job_id,
                        title=profile.title,
                        imported=True,
                    )
                )
            except Exception as exc:
                failed_count += 1
                logger.exception("jobs.ch import failed for %s", link)
                items.append(
                    JobsChImportItemResult(
                        link=link,
                        job_id=None,
                        title=None,
                        imported=False,
                        error=str(exc),
                    )
                )

        if imported_count == 0:
            first_error = next((item.error for item in items if item.error), None)
            if first_error:
                raise RuntimeError(f"Kein jobs.ch-Link konnte in die Datenbank geladen werden. Erster Fehler: {first_error}")
            raise RuntimeError("Kein jobs.ch-Link konnte in die Datenbank geladen werden.")

        warning = None
        if failed_count:
            warning = f"{failed_count} jobs.ch-Link{'s' if failed_count != 1 else ''} wurden übersprungen."

        return JobsChImportResult(
            imported=imported_count,
            failed=failed_count,
            warning=warning,
            items=items,
        )
