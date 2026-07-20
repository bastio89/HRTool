from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader


class PDFService:
    def extract_text(self, data: bytes) -> str:
        if not data:
            raise ValueError("Uploaded PDF file is empty.")

        try:
            reader = PdfReader(BytesIO(data))
        except Exception as exc:  # pragma: no cover - parser-specific failure path
            raise ValueError("Could not parse uploaded PDF file.") from exc

        text_parts: list[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(page_text.strip())

        extracted = "\n".join(text_parts).strip()
        if not extracted:
            raise ValueError("Uploaded PDF does not contain extractable text.")
        return extracted
