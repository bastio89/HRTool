"""Tests fuer den Batch-Import von Stellen-PDFs.

Der Importer orchestrierte frueher LLM, Neo4j und Postgres selbst. Inzwischen
schickt er die Datei an /jobs/parse-description im Backend und verschiebt sie
danach. Der alte Test prueft Verhalten, das es nicht mehr gibt - er liess sich
nicht reparieren, nur ersetzen.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from batch_tools import import_cvs_jobs_from_pdfs as importer


class FakePdfService:
    def extract_text(self, data: bytes) -> str:
        return "Senior Data Engineer with Python, SQL and German B2 requirements."


class ExplodingPdfService:
    def extract_text(self, data: bytes) -> str:
        raise ValueError("kaputtes PDF")


def test_resolve_input_dir_uses_job_input_for_job_mode():
    args = type("Args", (), {"mode": "job", "input_dir": None})()

    assert importer._resolve_input_dir(args).name == "job_input"


async def _run(pdf_path, done_dir, **overrides):
    kwargs = dict(
        pdf_path=pdf_path,
        done_dir=done_dir,
        dry_run=False,
        api_base="http://backend:3001/api",
        timeout_seconds=30,
        token="t0ken",
        pdf_service=FakePdfService(),
    )
    kwargs.update(overrides)
    return await importer.process_job_file(**kwargs)


@pytest.mark.anyio
async def test_process_job_file_posts_to_the_backend_and_files_the_pdf(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")
    done_dir = tmp_path / "done"

    calls = {}

    def fake_post(url, file_path, timeout_seconds, token, field_name="file"):
        calls.update(url=url, file_path=file_path, timeout_seconds=timeout_seconds, token=token)
        return {"success": True, "job": {"id": "job-123", "title": "Senior Data Engineer"}}

    monkeypatch.setattr(importer, "post_multipart_file", fake_post)

    ok, message = await _run(pdf_path, done_dir)

    assert ok is True
    assert "imported as job id=job-123" in message
    assert "title=Senior Data Engineer" in message
    assert calls["url"] == "http://backend:3001/api/jobs/parse-description?persist=1"
    assert calls["token"] == "t0ken"
    # Die Datei wandert nach dem Import in den Done-Ordner.
    assert pdf_path.exists() is False
    assert (done_dir / "job.pdf").exists() is True


@pytest.mark.anyio
async def test_process_job_file_keeps_the_pdf_when_the_backend_fails(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")
    done_dir = tmp_path / "done"

    def fake_post(*args, **kwargs):
        raise RuntimeError("backend nicht erreichbar")

    monkeypatch.setattr(importer, "post_multipart_file", fake_post)

    ok, message = await _run(pdf_path, done_dir)

    assert ok is False
    assert "backend job parsing failed" in message
    # Wichtig: nichts verschieben, sonst waere die Datei nach einem Ausfall weg.
    assert pdf_path.exists() is True
    assert done_dir.exists() is False


@pytest.mark.anyio
async def test_process_job_file_reports_a_missing_job_id(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")

    monkeypatch.setattr(importer, "post_multipart_file", lambda *a, **k: {"success": True, "job": {}})

    ok, message = await _run(pdf_path, tmp_path / "done")

    assert ok is False
    assert "no job id" in message
    assert pdf_path.exists() is True


@pytest.mark.anyio
async def test_dry_run_touches_neither_backend_nor_filesystem(tmp_path, monkeypatch):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"fake pdf bytes")

    def explode(*args, **kwargs):
        raise AssertionError("dry-run darf das Backend nicht aufrufen")

    monkeypatch.setattr(importer, "post_multipart_file", explode)

    ok, message = await _run(pdf_path, tmp_path / "done", dry_run=True)

    assert ok is True
    assert "dry-run ok" in message
    assert pdf_path.exists() is True


@pytest.mark.anyio
async def test_unreadable_pdf_is_reported_and_left_in_place(tmp_path):
    pdf_path = tmp_path / "job.pdf"
    pdf_path.write_bytes(b"not really a pdf")

    ok, message = await _run(pdf_path, tmp_path / "done", pdf_service=ExplodingPdfService())

    assert ok is False
    assert "PDF extraction failed" in message
    assert pdf_path.exists() is True
