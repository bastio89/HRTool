from __future__ import annotations

from typing import Any


def build_candidate_profile_json(
    candidate: dict[str, Any],
    *,
    work_history: list[dict[str, Any]] | None = None,
    education_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload = dict(candidate)
    if work_history is not None:
        payload["work_history"] = work_history
    if education_history is not None:
        payload["education_history"] = education_history
    return payload


def render_candidate_fulltext(
    candidate: dict[str, Any],
    *,
    work_history: list[dict[str, Any]] | None = None,
    education_history: list[dict[str, Any]] | None = None,
) -> str:
    lines: list[str] = []

    def add_line(value: Any) -> None:
        text = str(value).strip() if value is not None else ""
        if text:
            lines.append(text)

    def add_label(label: str, value: Any) -> None:
        text = str(value).strip() if value is not None else ""
        if text:
            lines.append(f"{label}: {text}")

    add_line(candidate.get("name"))
    add_label("E-Mail", candidate.get("email"))
    add_label("Telefon", candidate.get("phone"))
    add_label("Ort", candidate.get("location"))
    add_label("Berufserfahrung", candidate.get("experience"))
    add_label("Ausbildung", candidate.get("education"))
    add_label("Gehalt", candidate.get("desired_salary") or candidate.get("salary_expectation"))
    add_label("Verfügbarkeit", candidate.get("availability"))
    add_label("Kündigungsfrist", candidate.get("notice_period"))
    add_label("Sprachen", candidate.get("languages"))
    add_label("Skills", candidate.get("skills"))
    add_label("Zertifikate", candidate.get("certificates"))
    add_label("Führerschein", candidate.get("drivers_license"))
    add_label("Mobilität", candidate.get("mobility"))
    add_label("Nationalität", candidate.get("nationality"))
    add_label("Geschlecht", candidate.get("gender"))
    add_label("Aktueller Arbeitgeber", candidate.get("current_employer"))
    add_label("Aktuelle Position", candidate.get("current_position"))
    add_label("LinkedIn", candidate.get("linkedin_url"))
    add_label("Xing", candidate.get("xing_url"))
    add_label("GitHub", candidate.get("github_url"))
    add_label("Portfolio", candidate.get("portfolio_url"))
    add_label("Tags", candidate.get("tags"))
    add_label("Notizen", candidate.get("notes"))

    if work_history:
        lines.append("Beruflicher Werdegang")
        for item in work_history:
            parts: list[str] = []
            position = str(item.get("position") or "").strip()
            employer = str(item.get("employer") or "").strip()
            if position:
                parts.append(position)
            if employer:
                parts.append(employer)
            from_date = str(item.get("from_date") or "").strip()
            to_date = str(item.get("to_date") or "").strip()
            if from_date or to_date:
                parts.append(" - ".join(part for part in [from_date, to_date or "heute"] if part))
            location = str(item.get("location") or "").strip()
            if location:
                parts.append(location)
            description = str(item.get("description") or "").strip()
            if description:
                parts.append(description)
            if parts:
                lines.append("- " + "; ".join(parts))

    if education_history:
        lines.append("Ausbildungshistorie")
        for item in education_history:
            parts = [
                str(item.get("degree") or "").strip(),
                str(item.get("institution") or "").strip(),
                str(item.get("field_of_study") or "").strip(),
            ]
            parts = [part for part in parts if part]
            from_date = str(item.get("from_date") or "").strip()
            to_date = str(item.get("to_date") or "").strip()
            if from_date or to_date:
                parts.append(" - ".join(part for part in [from_date, to_date or "heute"] if part))
            description = str(item.get("description") or "").strip()
            if description:
                parts.append(description)
            if parts:
                lines.append("- " + "; ".join(parts))

    return "\n".join(lines).strip()