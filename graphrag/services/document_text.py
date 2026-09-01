from __future__ import annotations

import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

import pytesseract
from docx import Document
from pdf2image import convert_from_bytes
from PIL import Image

from services.pdf import PDFService


ALLOWED_DOCUMENT_TYPES = {
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"image/png",
	"image/jpeg",
	"image/jpg",
	"image/webp",
}


def _extract_pdf(data: bytes) -> str:
	try:
		return PDFService().extract_text(data)
	except ValueError:
		try:
			pages = convert_from_bytes(data, dpi=300)
		except Exception as exc:
			raise ValueError("PDF konnte nicht gelesen werden") from exc
		text = "\n".join(pytesseract.image_to_string(page, lang="deu+eng") for page in pages).strip()
		if not text:
			raise ValueError("PDF enthält keinen lesbaren Text")
		return text


def _extract_doc(data: bytes) -> str:
	with tempfile.TemporaryDirectory() as directory:
		path = Path(directory) / "document.doc"
		path.write_bytes(data)
		try:
			result = subprocess.run(
				["antiword", str(path)],
				check=True,
				capture_output=True,
				text=True,
				timeout=30,
			)
		except (OSError, subprocess.SubprocessError) as exc:
			raise ValueError("Word-Dokument konnte nicht gelesen werden") from exc
		return result.stdout.strip()


def extract_document_text(data: bytes, content_type: str) -> str:
	if not data:
		raise ValueError("Datei ist leer")
	if content_type == "application/pdf":
		return _extract_pdf(data)
	if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		document = Document(BytesIO(data))
		return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()
	if content_type == "application/msword":
		return _extract_doc(data)
	if content_type.startswith("image/"):
		try:
			image = Image.open(BytesIO(data))
		except Exception as exc:
			raise ValueError("Bild konnte nicht gelesen werden") from exc
		return pytesseract.image_to_string(image, lang="deu+eng").strip()
	raise ValueError("Nur PDF, Word und Bilddateien erlaubt")