from __future__ import annotations

import argparse
import html
import json
import os
import re
import ssl
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
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


LINKEDIN_HOSTS = {"linkedin.com", "www.linkedin.com"}
APIFY_ACTOR_ID = "harvestapi/linkedin-profile-search"
APIFY_API_URL = f"https://api.apify.com/v2/acts/{APIFY_ACTOR_ID.replace('/', '~')}/run-sync-get-dataset-items"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


def _ssl_context() -> ssl.SSLContext:
    if certifi is not None:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


@dataclass(frozen=True)
class LinkedInProfile:
    name: str
    headline: str | None = None
    summary: str | None = None
    skills: list[str] | None = None
    experience: list[str] | None = None
    education: list[str] | None = None
    location: str | None = None
    source_url: str | None = None
    current_employer: str | None = None


def _as_text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _filename_component(value: str | None, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", value or "").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def _shorten_component(value: str, limit: int = 40) -> str:
    if len(value) <= limit:
        return value
    trimmed = value[:limit].rstrip("_-. ")
    return trimmed or value[:limit]


def _date_component() -> str:
    return datetime.now().strftime("%d-%m-%y")


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def _resolve_apify_token() -> str | None:
    token = os.environ.get("APIFY_TOKEN")
    if token:
        return token

    candidate_files = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[2] / ".env",
    ]
    for candidate in candidate_files:
        values = _read_env_file(candidate)
        token = values.get("APIFY_TOKEN")
        if token:
            os.environ.setdefault("APIFY_TOKEN", token)
            return token
    return None


def normalize_linkedin_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in LINKEDIN_HOSTS:
        raise ValueError("Es sind nur http(s)-Links von linkedin.com erlaubt.")
    if not parsed.path.startswith("/in/"):
        raise ValueError("Es werden LinkedIn-Profil-URLs im Format https://www.linkedin.com/in/... erwartet.")
    return url


def _search_query_variants(url: str) -> list[str]:
    parsed = urlparse(url)
    slug = parsed.path.rstrip("/").split("/")[-1]
    slug = re.sub(r"-\d+$", "", slug)
    slug = re.sub(r"[-_]+", " ", slug)
    slug = re.sub(r"\s+", " ", slug).strip().title()
    variants = [slug]
    if slug:
        parts = slug.split()
        if len(parts) >= 2:
            variants.append(f"{parts[0]} {parts[-1]}")
            if len(parts[0]) == 1:
                variants.append(parts[-1])
        if len(parts) >= 3:
            variants.append(" ".join(parts[:2]))
    cleaned: list[str] = []
    for variant in variants:
        normalized = re.sub(r"\s+", " ", variant).strip()
        if normalized and normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned


def _load_apify_items(input_data: dict[str, object]) -> list[dict[str, object]]:
    token = _resolve_apify_token()
    if not token:
        raise RuntimeError("APIFY_TOKEN ist nicht gesetzt. Lege ihn in der Shell oder in der lokalen .env-Datei ab.")

    payload = dict(input_data)
    request = Request(
        f"{APIFY_API_URL}?token={token}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=120, context=_ssl_context()) as response:
            raw = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"Apify Actor konnte nicht ausgeführt werden: {exc}") from exc

    data = json.loads(raw)
    if not isinstance(data, list):
        raise RuntimeError("Unerwartetes Apify-Ergebnisformat.")
    return [item for item in data if isinstance(item, dict)]


def _build_search_query_from_links(links: list[str]) -> str:
    queries: list[str] = []
    for link in links:
        for query in _search_query_variants(link):
            if query and query not in queries:
                queries.append(query)
    if not queries:
        raise ValueError("Keine gültigen Suchbegriffe aus den LinkedIn-Links ableitbar.")
    if len(queries) == 1:
        return f'"{queries[0]}"'
    return "(" + " OR ".join(f'"{query}"' for query in queries) + ")"


def _load_profiles_for_links(links: list[str]) -> list[dict[str, object]]:
    search_query = _build_search_query_from_links(links)
    max_items = max(25, len(links) * 10)
    take_pages = max(1, min(5, (len(links) + 24) // 25 or 1))
    return _load_apify_items(
        {
            "profileScraperMode": "Full",
            "searchQuery": search_query,
            "maxItems": max_items,
            "takePages": take_pages,
        }
    )


def _normalize_profile_slug(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    slug = parsed.path.rstrip("/").split("/")[-1]
    slug = re.sub(r"-\d+$", "", slug)
    return slug.lower() or None


def _candidate_matches_link(item: dict[str, object], link: str) -> bool:
    source_slug = _normalize_profile_slug(link)
    if not source_slug:
        return False

    candidate_slug = _normalize_profile_slug(_as_text(item.get("linkedinUrl")))
    candidate_identifier = _as_text(item.get("publicIdentifier"))
    if candidate_slug == source_slug or (candidate_identifier and candidate_identifier.lower() == source_slug):
        return True

    source_parts = [part for part in source_slug.split("-") if part]
    if len(source_parts) >= 2 and len(source_parts[0]) == 1:
        candidate_last = _as_text(item.get("lastName"))
        if candidate_last and candidate_last.lower() == source_parts[-1]:
            return True
    return False


def _format_position(entry: object) -> str | None:
    if not isinstance(entry, dict):
        return None
    title = _as_text(entry.get("position")) or _as_text(entry.get("title"))
    company = _as_text(entry.get("companyName")) or _as_text(entry.get("company"))
    location = _as_text(entry.get("location"))
    duration = _as_text(entry.get("duration"))
    description = _as_text(entry.get("description"))
    pieces = [piece for piece in [title, company, location, duration] if piece]
    if not pieces:
        return None
    line = " · ".join(pieces)
    if description:
        line = f"{line}\n{description}"
    return line


def _dedupe_text_items(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = re.sub(r"\s+", " ", item).strip()
        lowered = normalized.lower()
        if normalized and lowered not in seen:
            seen.add(lowered)
            result.append(normalized)
    return result


def _extract_profile(item: dict[str, object], source_url: str) -> LinkedInProfile:
    first_name = _as_text(item.get("firstName"))
    last_name = _as_text(item.get("lastName"))
    name = " ".join(part for part in [first_name, last_name] if part).strip()
    if not name:
        name = _as_text(item.get("name")) or _search_query_variants(source_url)[0]

    raw_location = item.get("location")
    location: str | None = None
    if isinstance(raw_location, dict):
        parsed_location = raw_location.get("parsed")
        if isinstance(parsed_location, dict):
            location = _as_text(parsed_location.get("text"))
        location = location or _as_text(raw_location.get("linkedinText"))
    else:
        location = _as_text(raw_location)

    current_employer: str | None = None
    current_positions = item.get("currentPosition")
    if isinstance(current_positions, list) and current_positions:
        first_position = current_positions[0]
        if isinstance(first_position, dict):
            current_employer = _as_text(first_position.get("companyName"))

    headline = _as_text(item.get("headline"))
    summary = _as_text(item.get("about"))

    skills: list[str] = []
    top_skills = item.get("topSkills")
    if isinstance(top_skills, list):
        for skill in top_skills:
            skill_name = _as_text(skill)
            if skill_name:
                skills.append(skill_name)
    if isinstance(item.get("skills"), list):
        for skill in item.get("skills", []):
            if isinstance(skill, dict):
                skill_name = _as_text(skill.get("name"))
            else:
                skill_name = _as_text(skill)
            if skill_name:
                skills.append(skill_name)

    experience: list[str] = []
    for collection_name in ["currentPosition", "experience", "positions", "workExperience"]:
        collection = item.get(collection_name)
        if isinstance(collection, list):
            for entry in collection:
                formatted = _format_position(entry)
                if formatted:
                    experience.append(formatted)

    education: list[str] = []
    for collection_name in ["profileTopEducation", "education"]:
        collection = item.get(collection_name)
        if isinstance(collection, list):
            for entry in collection:
                if isinstance(entry, dict):
                    school = _as_text(entry.get("schoolName")) or _as_text(entry.get("name"))
                    degree = _as_text(entry.get("degree"))
                    field = _as_text(entry.get("fieldOfStudy"))
                    parts = [part for part in [school, degree, field] if part]
                    if parts:
                        education.append(" · ".join(parts))

    return LinkedInProfile(
        name=name,
        headline=headline,
        summary=summary,
        skills=_dedupe_text_items(skills) or None,
        experience=_dedupe_text_items(experience) or None,
        education=_dedupe_text_items(education) or None,
        location=location,
        source_url=_as_text(item.get("linkedinUrl")) or source_url,
        current_employer=current_employer,
    )


def fetch_profile(url: str) -> LinkedInProfile:
    profile_url = normalize_linkedin_url(url)
    last_error: Exception | None = None
    for search_query in _search_query_variants(profile_url):
        try:
            items = _load_apify_items(
                {
                    "profileScraperMode": "Full",
                    "searchQuery": search_query,
                    "maxItems": 25,
                    "takePages": 1,
                }
            )
        except Exception as exc:
            last_error = exc
            continue
        if not items:
            continue

        source_slug = _normalize_profile_slug(profile_url)
        selected = items[0]
        for item in items:
            candidate_slug = _normalize_profile_slug(_as_text(item.get("linkedinUrl")))
            candidate_identifier = _as_text(item.get("publicIdentifier"))
            if source_slug and (candidate_slug == source_slug or candidate_identifier == source_slug):
                selected = item
                break

        return _extract_profile(selected, profile_url)

    if last_error is not None:
        raise RuntimeError(f"Apify konnte kein Profil liefern: {last_error}") from last_error
    raise RuntimeError("Apify konnte kein Profil liefern.")


def _paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    safe = html.escape(text).replace("\n", "<br/>")
    return Paragraph(safe, style)


def _split_bullet_entry(entry: str) -> tuple[str, str | None]:
    parts = entry.split("\n", 1)
    title = parts[0].strip()
    description = parts[1].strip() if len(parts) > 1 else None
    return title, description


def write_pdf(profile: LinkedInProfile, output: Path) -> None:
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ProfileTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        alignment=TA_LEFT,
        spaceAfter=8,
    )
    meta_style = ParagraphStyle(
        "ProfileMeta",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor="#555555",
        spaceAfter=2,
    )
    heading_style = ParagraphStyle(
        "ProfileHeading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        spaceBefore=10,
        spaceAfter=5,
    )
    body_style = ParagraphStyle("ProfileBody", parent=styles["BodyText"], fontSize=10.5, leading=15, spaceAfter=6)
    list_style = ParagraphStyle("ProfileList", parent=body_style, leftIndent=8, firstLineIndent=0, spaceAfter=2)
    entry_title_style = ParagraphStyle(
        "ProfileEntryTitle",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        textColor="#1f2937",
        spaceAfter=2,
    )
    entry_meta_style = ParagraphStyle(
        "ProfileEntryMeta",
        parent=styles["BodyText"],
        fontSize=9.2,
        leading=11.5,
        textColor="#555555",
        leftIndent=2,
        spaceAfter=3,
    )
    entry_body_style = ParagraphStyle(
        "ProfileEntryBody",
        parent=styles["BodyText"],
        fontSize=10,
        leading=14,
        leftIndent=2,
        spaceAfter=8,
    )
    document = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=profile.name,
        author="HRTool",
    )

    story: list[object] = [_paragraph(profile.name, title_style)]
    metadata = [item for item in [profile.headline, profile.location] if item]
    story.extend(_paragraph(item, meta_style) for item in metadata)
    story.append(Spacer(1, 8))

    if profile.summary:
        story.append(_paragraph("Profil", heading_style))
        story.append(_paragraph(profile.summary, body_style))

    if profile.skills:
        story.append(_paragraph("Skills", heading_style))
        items = [ListItem(_paragraph(skill, list_style)) for skill in profile.skills]
        story.append(ListFlowable(items, bulletType="bullet", leftIndent=12))

    if profile.experience:
        story.append(_paragraph("Beruflicher Werdegang", heading_style))
        for entry in profile.experience:
            title_line, description = _split_bullet_entry(entry)
            story.append(_paragraph(title_line, entry_title_style))
            if description:
                story.append(_paragraph(description, entry_body_style))

    if profile.education:
        story.append(_paragraph("Ausbildung", heading_style))
        for entry in profile.education:
            story.append(_paragraph(entry, entry_meta_style))

    story.extend([Spacer(1, 12), _paragraph(f"Quelle: {profile.source_url}", meta_style)])
    output.parent.mkdir(parents=True, exist_ok=True)
    document.build(story)


def _load_links_file(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"LinkedIn-Link-Datei nicht gefunden: {path}")
    links = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.lstrip().startswith("#")]
    if not links:
        raise ValueError(f"LinkedIn-Link-Datei ist leer: {path}")
    return links


def _default_links_file() -> Path | None:
    candidates = [Path("linkedin-links.txt"), Path("../linkedin-links.txt")]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _output_for_profile(profile: LinkedInProfile) -> Path:
    first_name, last_name = (profile.name.split(" ", 1) + [None])[:2]
    first_name = first_name.title() if first_name else "profile"
    last_name = last_name.title() if last_name else "profile"
    employer = profile.current_employer or "unbekannt"
    filename = " - ".join(
        [
            f"{_shorten_component(_filename_component(first_name, 'profile'))}.{_shorten_component(_filename_component(last_name, 'profile'))}",
            _shorten_component(_filename_component(employer, 'unbekannt')),
            _date_component(),
        ]
    )
    return Path.cwd() / f"{filename}.pdf"


def _run_batch(links_file: Path) -> int:
    links = _load_links_file(links_file)
    try:
        items = _load_profiles_for_links(links)
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1

    indexed_items: dict[str, dict[str, object]] = {}
    for item in items:
        candidate_slug = _normalize_profile_slug(_as_text(item.get("linkedinUrl")))
        candidate_identifier = _as_text(item.get("publicIdentifier"))
        if candidate_slug:
            indexed_items[candidate_slug] = item
        if candidate_identifier:
            indexed_items[candidate_identifier.lower()] = item

    failures = 0
    for index, link in enumerate(links, start=1):
        print(f"[{index}/{len(links)}] {link}")
        try:
            selected_item = None
            source_slug = _normalize_profile_slug(link)
            if source_slug:
                selected_item = indexed_items.get(source_slug)
            if selected_item is None:
                for candidate in items:
                    if _candidate_matches_link(candidate, link):
                        selected_item = candidate
                        break
            if selected_item is None:
                profile = fetch_profile(link)
                output = _output_for_profile(profile)
                write_pdf(profile, output)
                print(f"PDF erstellt: {output}")
                print(f"Name: {profile.name}")
                continue

            profile = _extract_profile(selected_item, link)
            output = _output_for_profile(profile)
            write_pdf(profile, output)
            print(f"PDF erstellt: {output}")
            print(f"Name: {profile.name}")
        except (ValueError, RuntimeError, OSError) as exc:
            failures += 1
            print(f"Fehler bei Link {index}: {exc}", file=sys.stderr)
    if failures:
        print(f"Fertig mit {failures} Fehler(n).", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    argument_parser = argparse.ArgumentParser(description="Extrahiert LinkedIn-Profile via Apify und speichert sie als PDF.")
    argument_parser.add_argument("url", nargs="?", help="LinkedIn-Profil-URL")
    argument_parser.add_argument("-i", "--links-file", type=Path, help="Textdatei mit LinkedIn-Links, ein Link pro Zeile")
    argument_parser.add_argument("-o", "--output", type=Path, help="Zielpfad der PDF-Datei")
    args = argument_parser.parse_args()

    try:
        default_links_file = _default_links_file()
        if args.links_file or (args.url is None and default_links_file is not None):
            links_file = args.links_file or default_links_file
            if links_file is None:
                raise FileNotFoundError("Keine linkedin-links.txt gefunden.")
            if args.output:
                raise ValueError("--output kann im Batch-Modus nicht verwendet werden.")
            return _run_batch(links_file)

        if not args.url:
            raise ValueError("Bitte eine LinkedIn-URL angeben oder --links-file verwenden.")

        profile = fetch_profile(args.url)
        output = args.output or _output_for_profile(profile)
        write_pdf(profile, output)
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1

    print(f"PDF erstellt: {output}")
    print(f"Name: {profile.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())