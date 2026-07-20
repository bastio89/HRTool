from __future__ import annotations

from pathlib import Path

from services.pdf import PDFService


PDF_PATH = Path(__file__).parent / "CV 24 - Julien Fournier Lausanne, Suisse - Google Docs.pdf"


def test_pdf_service_extracts_text_from_real_pdf_file() -> None:
    assert PDF_PATH.exists(), f"Expected PDF test fixture at {PDF_PATH}"

    data = PDF_PATH.read_bytes()
    extracted = PDFService().extract_text(data)

    assert len(extracted) > 100
    assert "julien" in extracted.lower()
    assert "lausanne" in extracted.lower()
