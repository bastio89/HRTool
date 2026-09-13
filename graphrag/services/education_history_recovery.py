from __future__ import annotations

import re

_HEADING_KEYWORDS = (
	"ausbildung",
	"studium",
	"education",
	"academic background",
	"education and training",
	"higher education",
	"schulausbildung",
	"berufsausbildung",
)

_SECTION_BREAK_KEYWORDS = (
	"beruflicher werdegang",
	"berufserfahrung",
	"work experience",
	"professional experience",
	"erfahrung",
	"kompetenzen",
	"skills",
	"sprachkompetenzen",
	"languages",
	"projekte",
	"projects",
)

_DATE_RANGE_PATTERN = re.compile(
	r"(?P<from>\d{4}(?:-\d{2})?)\s*(?:-|–|to|bis)\s*(?P<to>\d{4}(?:-\d{2})?|present|current|heute|now|ongoing)?",
	re.IGNORECASE,
)


def _clean(value: str | None) -> str | None:
	if value is None:
		return None
	cleaned = re.sub(r"\s+", " ", str(value)).strip(" ,;:\t\n\r")
	return cleaned or None


def _infer_field_of_study(degree: str | None, fallback: str | None = None) -> str | None:
	degree_text = _clean(degree)
	if not degree_text:
		return _clean(fallback)

	match = re.search(r"\bin\s+(.+)$", degree_text, flags=re.IGNORECASE)
	if match:
		field = _clean(match.group(1))
		if field:
			return field

	match = re.search(r"\b(study|studies|studium|major|subject)\s*[:\-]\s*(.+)$", degree_text, flags=re.IGNORECASE)
	if match:
		field = _clean(match.group(2))
		if field:
			return field

	return _clean(fallback or degree_text)


def recover_education_history_from_text(raw_text: str | None) -> list[dict]:
	"""Heuristically recover education entries when LLM parsing misses them."""
	if not isinstance(raw_text, str) or not raw_text.strip():
		return []

	lines = [re.sub(r"^\s*[•\-*]\s*", "", line).strip() for line in raw_text.splitlines()]
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
		if current_entry and (current_entry.get("degree") or current_entry.get("institution") or current_entry.get("field_of_study")):
			current_entry["field_of_study"] = _infer_field_of_study(
				current_entry.get("degree"),
				current_entry.get("field_of_study") or current_entry.get("institution"),
			)
			entries.append(current_entry)
		current_entry = None

	for line in lines[start_index + 1:]:
		lowered = line.lower()
		if any(keyword in lowered for keyword in _SECTION_BREAK_KEYWORDS):
			break

		if len(line) > 220:
			if current_entry is not None:
				current_entry["description"] = (
					f"{current_entry['description']}\n{line}" if current_entry.get("description") else line
				)
			continue

		date_match = _DATE_RANGE_PATTERN.search(line)
		parts = [part.strip() for part in re.split(r"\s*,\s*", line) if part.strip()]
		if len(parts) >= 2:
			flush_current_entry()
			degree = parts[0]
			institution = parts[1]
			description = ", ".join(parts[2:]) if len(parts) > 2 else None
			current_entry = {
				"institution": _clean(institution),
				"degree": _clean(degree),
				"field_of_study": _infer_field_of_study(degree, institution),
				"from_date": _clean(date_match.group("from")) if date_match else None,
				"to_date": _clean(date_match.group("to")) if date_match else None,
				"description": _clean(description),
			}
			continue

		if date_match and current_entry is not None:
			current_entry["from_date"] = _clean(date_match.group("from"))
			current_entry["to_date"] = _clean(date_match.group("to"))
			continue

		if current_entry is not None:
			if not current_entry.get("degree"):
				current_entry["degree"] = line
				current_entry["field_of_study"] = _infer_field_of_study(line, current_entry.get("field_of_study"))
			elif not current_entry.get("institution"):
				current_entry["institution"] = line
			else:
				current_entry["description"] = (
					f"{current_entry['description']}\n{line}" if current_entry.get("description") else line
				)

	flush_current_entry()
	return [entry for entry in entries if entry.get("institution") or entry.get("degree")]