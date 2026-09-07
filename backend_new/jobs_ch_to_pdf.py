from __future__ import annotations

import argparse
import html
import json
import re
import ssl
import sys
from datetime import date, datetime
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

try:
    import certifi
except ImportError:  # pragma: no cover - fallback for minimal environments
    certifi = None


JOBS_CH_HOSTS = {"jobs.ch", "www.jobs.ch"}
USER_AGENT = "HRTool jobs.ch PDF exporter/1.0"


def _ssl_context() -> ssl.SSLContext:
    if certifi is not None:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


@dataclass(frozen=True)
class JobPosting:
    title: str
    description: str
    job_id: str | None = None
    company: str | None = None
    location: str | None = None
    employment_type: str | None = None
    date_posted: str | None = None
    source_url: str | None = None


class JsonLdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._in_json_ld = False
        self._chunks: list[str] = []
        self.documents: list[object] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        attributes = {key.lower(): value or "" for key, value in attrs}
        self._in_json_ld = attributes.get("type", "").lower() == "application/ld+json"
        if self._in_json_ld:
            self._chunks = []

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "script" or not self._in_json_ld:
            return
        raw = html.unescape("".join(self._chunks)).strip()
        self._in_json_ld = False
        self._chunks = []
        if not raw:
            return
        try:
            self.documents.append(json.loads(raw))
        except json.JSONDecodeError:
            return


class DescriptionParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[tuple[str, str | list[str]]] = []
        self._current: list[str] = []
        self._list_items: list[str] | None = None
        self._list_type = "bullet"
        self._heading_level: int | None = None

    def _flush_text(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._current)).strip()
        self._current = []
        if text:
            if self._list_items is not None:
                self._list_items.append(text)
            else:
                self.blocks.append(("heading" if self._heading_level else "paragraph", text))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"h2", "h3", "h4"}:
            self._flush_text()
            self._heading_level = int(tag[1:])
        elif tag in {"p", "br"}:
            self._flush_text()
        elif tag in {"ul", "ol"}:
            self._flush_text()
            self._list_items = []
            self._list_type = "1" if tag == "ol" else "bullet"
        elif tag == "li":
            self._flush_text()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"h2", "h3", "h4"}:
            self._flush_text()
            self._heading_level = None
        elif tag in {"p", "li", "br"}:
            self._flush_text()
        elif tag in {"ul", "ol"} and self._list_items is not None:
            self._flush_text()
            if self._list_items:
                self.blocks.append((f"list:{self._list_type}", self._list_items))
            self._list_items = None

    def handle_data(self, data: str) -> None:
        self._current.append(data)


def _walk_json(value: object):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_json(child)


def _job_posting_from_documents(documents: list[object]) -> dict[str, object]:
    for document in documents:
        for candidate in _walk_json(document):
            types = candidate.get("@type")
            if types == "JobPosting" or isinstance(types, list) and "JobPosting" in types:
                return candidate
    raise ValueError("Auf der jobs.ch-Seite wurde keine JobPosting-Beschreibung gefunden.")


def _as_text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _nested_name(value: object) -> str | None:
    if isinstance(value, dict):
        return _as_text(value.get("name"))
    return _as_text(value)


def _filename_component(value: str | None, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "").strip("_")
    return cleaned or fallback


def _date_for_filename(value: str | None) -> str:
    if not value:
        return "unknown-date"
    normalized = value.strip()
    for parser in (date.fromisoformat, datetime.fromisoformat):
        try:
            parsed = parser(normalized)
            return parsed.strftime("%d-%m-%Y")
        except ValueError:
            continue
    return _filename_component(normalized, "unknown-date")


def normalize_jobs_ch_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in JOBS_CH_HOSTS:
        raise ValueError("Es sind nur http(s)-Links von jobs.ch erlaubt.")
    job_id = parse_qs(parsed.query).get("jobid", [None])[0]
    if job_id:
        return f"https://www.jobs.ch/de/stellenangebote/detail/{job_id}/"
    if "/stellenangebote/detail/" in parsed.path:
        return url
    raise ValueError("Der jobs.ch-Link enthält keine jobid und ist keine Detailseite.")


def fetch_job(url: str, timeout: int = 30) -> JobPosting:
    detail_url = normalize_jobs_ch_url(url)
    request = Request(detail_url, headers={"User-Agent": USER_AGENT, "Accept-Language": "de-CH,de;q=0.9"})
    try:
        with urlopen(request, timeout=timeout, context=_ssl_context()) as response:
            page = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"jobs.ch konnte nicht geladen werden: {exc}") from exc

    parser = JsonLdParser()
    parser.feed(page)
    posting = _job_posting_from_documents(parser.documents)
    title = _as_text(posting.get("title"))
    description = _as_text(posting.get("description"))
    if not title or not description:
        raise ValueError("Die JobPosting-Daten enthalten keinen Titel oder keine Beschreibung.")
    location = None
    job_location = posting.get("jobLocation")
    if isinstance(job_location, list):
        location = ", ".join(filter(None, (_nested_name(item) for item in job_location))) or None
    else:
        location = _nested_name(job_location)
    identifier = posting.get("identifier")
    job_id = _as_text(identifier.get("value")) if isinstance(identifier, dict) else _as_text(identifier)
    return JobPosting(
        title=title,
        description=description,
        job_id=job_id,
        company=_nested_name(posting.get("hiringOrganization")),
        location=location,
        employment_type=_as_text(posting.get("employmentType")),
        date_posted=_as_text(posting.get("datePosted")),
        source_url=detail_url,
    )


def _paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    safe = html.escape(text).replace("\n", "<br/>")
    return Paragraph(safe, style)


def write_pdf(job: JobPosting, output: Path) -> None:
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("JobTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, leading=24, alignment=TA_LEFT, spaceAfter=8)
    meta_style = ParagraphStyle("Meta", parent=styles["Normal"], fontSize=9, leading=12, textColor="#555555", spaceAfter=2)
    heading_style = ParagraphStyle("JobHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, spaceBefore=10, spaceAfter=5)
    body_style = ParagraphStyle("JobBody", parent=styles["BodyText"], fontSize=10.5, leading=15, spaceAfter=6)
    list_style = ParagraphStyle("JobList", parent=body_style, leftIndent=8, firstLineIndent=0, spaceAfter=2)
    document = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm, title=job.title, author="HRTool")
    story: list[object] = [_paragraph(job.title, title_style)]
    metadata = [item for item in [job.company, job.location, job.employment_type, f"Veröffentlicht: {job.date_posted}" if job.date_posted else None] if item]
    story.extend(_paragraph(item, meta_style) for item in metadata)
    story.append(Spacer(1, 8))
    description_parser = DescriptionParser()
    description_parser.feed(job.description)
    for kind, content in description_parser.blocks:
        if kind == "heading":
            story.append(_paragraph(str(content), heading_style))
        elif kind.startswith("list:"):
            items = [ListItem(_paragraph(item, list_style)) for item in content]  # type: ignore[union-attr]
            story.append(ListFlowable(items, bulletType=kind.split(":", 1)[1], start="1" if kind.endswith(":1") else None, leftIndent=12))
        else:
            story.append(_paragraph(str(content), body_style))
    story.extend([Spacer(1, 12), _paragraph(f"Quelle: {job.source_url}", meta_style)])
    output.parent.mkdir(parents=True, exist_ok=True)
    document.build(story)


def _load_job_links(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Job-Link-Datei nicht gefunden: {path}")
    links: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        link = raw_line.strip()
        if link:
            links.append(link)
    if not links:
        raise ValueError(f"Job-Link-Datei ist leer: {path}")
    return links


def _run_batch(links_file: Path) -> int:
    links = _load_job_links(links_file)
    failures = 0
    for index, link in enumerate(links, start=1):
        print(f"[{index}/{len(links)}] {link}")
        try:
            job = fetch_job(link)
            filename = "_".join(
                [
                    _filename_component(job.title, "job"),
                    _filename_component(job.company, "company"),
                    _date_for_filename(job.date_posted),
                ]
            )
            output = Path.cwd() / f"{filename}.pdf"
            write_pdf(job, output)
            print(f"PDF erstellt: {output}")
            print(f"Titel: {job.title}")
        except (ValueError, RuntimeError, OSError) as exc:
            failures += 1
            print(f"Fehler bei Link {index}: {exc}", file=sys.stderr)
    if failures:
        print(f"Fertig mit {failures} Fehler(n).", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    argument_parser = argparse.ArgumentParser(description="Extrahiert eine jobs.ch-Stellenbeschreibung und speichert sie als PDF.")
    argument_parser.add_argument("url", nargs="?", help="jobs.ch-Suchlink mit jobid oder direkte Detailseite")
    argument_parser.add_argument("-i", "--links-file", type=Path, help="Textdatei mit jobs.ch-Links, ein Link pro Zeile")
    argument_parser.add_argument("-o", "--output", type=Path, help="Zielpfad der PDF-Datei")
    args = argument_parser.parse_args()
    try:
        if args.links_file or (args.url is None and Path("job-links.txt").exists()):
            links_file = args.links_file or Path("job-links.txt")
            if args.output:
                raise ValueError("--output kann im Batch-Modus nicht verwendet werden; jede Stelle bekommt ihren eigenen Dateinamen.")
            return _run_batch(links_file)
        if not args.url:
            raise ValueError("Bitte eine jobs.ch-URL angeben oder --links-file verwenden.")
        job = fetch_job(args.url)
        if args.output:
            output = args.output
        else:
            filename = "_".join(
                [
                    _filename_component(job.title, "job"),
                    _filename_component(job.company, "company"),
                    _date_for_filename(job.date_posted),
                ]
            )
            output = Path.cwd() / f"{filename}.pdf"
        write_pdf(job, output)
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    print(f"PDF erstellt: {output}")
    print(f"Titel: {job.title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())