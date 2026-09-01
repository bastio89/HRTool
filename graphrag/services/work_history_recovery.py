from __future__ import annotations

import re

_HEADING_KEYWORDS = (
    "beruflicher werdegang",
    "berufliche tätigkeiten",
    "berufserfahrung",
    "praktische industrie",
    "professional experience",
    "work experience",
)

_SECTION_BREAK_KEYWORDS = (
    "kompetenzmatrix",
    "sprachkompetenzen",
    "projektportfolio",
    "referenzen",
)

_ROLE_LINE_PATTERN = re.compile(
    r"\b(engineer|developer|specialist|architect|manager|consultant|lead|"
    r"administrator|designer|scientist|analyst|director|head|chief|it specialist)\b",
    re.IGNORECASE,
)


def _looks_like_role_line(value: str) -> bool:
    return bool(_ROLE_LINE_PATTERN.search(value))


def recover_work_history_from_text(raw_text: str | None) -> list[dict]:
    """Heuristically recover work history entries when LLM parsing misses them."""
    if not isinstance(raw_text, str) or not raw_text.strip():
        return []

    lines = [
        re.sub(r"^\s*[•\-*]\s*", "", line).strip()
        for line in raw_text.splitlines()
    ]
    lines = [line for line in lines if line]

    start_index = next(
        (
            index
            for index, line in enumerate(lines)
            if any(keyword in line.lower() for keyword in _HEADING_KEYWORDS)
        ),
        None,
    )
    if start_index is None:
        return []

    entries: list[dict] = []
    current_entry: dict | None = None

    def flush_current_entry() -> None:
        nonlocal current_entry
        if current_entry and (current_entry.get("employer") or current_entry.get("position") or current_entry.get("description")):
            entries.append(current_entry)
        current_entry = None

    for line in lines[start_index + 1:]:
        lowered = line.lower()
        if (
            lowered.startswith("4.")
            or lowered.startswith("5.")
            or lowered.startswith("6.")
            or any(keyword in lowered for keyword in _SECTION_BREAK_KEYWORDS)
        ):
            break

        if len(line) > 220:
            if current_entry is not None:
                current_entry["description"] = (
                    f"{current_entry['description']}\n{line}" if current_entry.get("description") else line
                )
            continue

        parts = [part.strip() for part in line.split(",") if part.strip()]
        if len(parts) >= 2 and _looks_like_role_line(parts[0]) and re.search(r"[A-Za-zÄÖÜäöüß]", parts[1]):
            flush_current_entry()
            current_entry = {
                "position": parts[0],
                "employer": parts[1],
                "from_date": None,
                "to_date": None,
                "is_current": len(entries) == 0,
                "description": ", ".join(parts[2:]) if len(parts) > 2 else None,
                "location": parts[-1] if len(parts) > 2 else None,
            }
            continue

        if current_entry is not None:
            current_entry["description"] = (
                f"{current_entry['description']}\n{line}" if current_entry.get("description") else line
            )

    flush_current_entry()
    return [entry for entry in entries if entry.get("employer") or entry.get("position")]
