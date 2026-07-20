from __future__ import annotations

import pytest

from services.pdf import PDFService


class _FakePage:
    def __init__(self, text: str | None) -> None:
        self._text = text

    def extract_text(self) -> str | None:
        return self._text


class _FakeReader:
    def __init__(self, pages: list[_FakePage]) -> None:
        self.pages = pages


def test_pdf_service_raises_for_empty_upload() -> None:
    service = PDFService()

    with pytest.raises(ValueError, match="Uploaded PDF file is empty"):
        service.extract_text(b"")


def test_pdf_service_raises_for_parse_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise_reader(_: object) -> object:
        raise RuntimeError("parser failed")

    monkeypatch.setattr("services.pdf.PdfReader", _raise_reader)
    service = PDFService()

    with pytest.raises(ValueError, match="Could not parse uploaded PDF file"):
        service.extract_text(b"%PDF-1.4")


def test_pdf_service_raises_if_no_extractable_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.pdf.PdfReader", lambda _: _FakeReader([_FakePage("  "), _FakePage(None)]))
    service = PDFService()

    with pytest.raises(ValueError, match="does not contain extractable text"):
        service.extract_text(b"%PDF-1.4")


def test_pdf_service_extracts_and_joins_page_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "services.pdf.PdfReader",
        lambda _: _FakeReader([_FakePage("  Alice CV  "), _FakePage("Python, FastAPI"), _FakePage("")]),
    )
    service = PDFService()

    extracted = service.extract_text(b"%PDF-1.4")

    assert extracted == "Alice CV\nPython, FastAPI"
