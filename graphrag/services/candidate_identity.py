"""Eindeutige Identitaet von Bewerbern (Gegenstueck zu backend/src/identity.js).

Fachliche Regel: Name + Geburtsdatum machen eine Person eindeutig. Das
Geburtsdatum ist beim Anlegen Pflicht; eine vorhandene Person wird nicht
ein zweites Mal angelegt. Das Geburtsdatum dient nur der Identifikation und
geht nie in Embeddings, Neo4j oder an ein Sprachmodell.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any


class CandidateIdentityError(ValueError):
	"""Pflichtangabe fehlt oder ist ungueltig (HTTP 422)."""

	def __init__(self, message: str, field: str) -> None:
		super().__init__(message)
		self.field = field


class DuplicateCandidateError(Exception):
	"""Die Person ist bereits angelegt (HTTP 409)."""

	def __init__(self, existing: dict[str, Any]) -> None:
		name = existing.get("name") or "Bewerber"
		super().__init__(f"Diese Person ist bereits im Tool angelegt: {name} (ID {existing.get('id')})")
		self.existing = existing

	def to_detail(self) -> dict[str, Any]:
		return {
			"error": str(self),
			"code": "DUPLICATE_CANDIDATE",
			"reason": "name_birth_date",
			"existing": {key: (str(value) if key in {"uuid", "birth_date"} and value is not None else value) for key, value in self.existing.items()},
		}


# Felder, die nie in Embeddings, Neo4j oder Prompts landen duerfen.
IDENTITY_ONLY_FIELDS = frozenset({"birth_date"})

_MONTHS = {
	"januar": 1, "jänner": 1, "january": 1, "janvier": 1, "gennaio": 1, "jan": 1,
	"februar": 2, "february": 2, "février": 2, "fevrier": 2, "febbraio": 2, "feb": 2,
	"märz": 3, "maerz": 3, "march": 3, "mars": 3, "marzo": 3, "mär": 3, "mar": 3,
	"april": 4, "avril": 4, "aprile": 4, "apr": 4,
	"mai": 5, "may": 5, "maggio": 5,
	"juni": 6, "june": 6, "juin": 6, "giugno": 6, "jun": 6,
	"juli": 7, "july": 7, "juillet": 7, "luglio": 7, "jul": 7,
	"august": 8, "août": 8, "aout": 8, "agosto": 8, "aug": 8,
	"september": 9, "septembre": 9, "settembre": 9, "sept": 9, "sep": 9,
	"oktober": 10, "october": 10, "octobre": 10, "ottobre": 10, "okt": 10, "oct": 10,
	"november": 11, "novembre": 11, "nov": 11,
	"dezember": 12, "december": 12, "décembre": 12, "decembre": 12, "dicembre": 12, "dez": 12, "dec": 12,
}
_MONTH_PATTERN = "|".join(sorted((re.escape(name) for name in _MONTHS), key=len, reverse=True))

# Nur Daten direkt hinter einer Beschriftung zaehlen - sonst wuerde ein
# beliebiges Datum aus dem Werdegang als Geburtsdatum gelesen.
_LABEL = (
	r"(?:geburtsdatum|geburtstag|geb\.?\s*datum|geb\.|geboren(?:\s+am)?|"
	r"date\s+of\s+birth|birth\s*date|birthday|born(?:\s+on)?|d\.?o\.?b\.?|"
	r"date\s+de\s+naissance|n[ée]e?\s+le|data\s+di\s+nascita|nat[oa]\s+il)"
)
_DATE = (
	r"(?P<numeric>\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{4})"
	r"|(?P<iso>\d{4}-\d{1,2}-\d{1,2})"
	rf"|(?P<dmy>\d{{1,2}}\.?\s+(?:{_MONTH_PATTERN})\.?\s+\d{{4}})"
	rf"|(?P<mdy>(?:{_MONTH_PATTERN})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}})"
)
_LABELLED_DATE = re.compile(rf"{_LABEL}\s*[:\-–]?\s*(?:{_DATE})", re.IGNORECASE)


def _valid(year: int, month: int, day: int) -> str | None:
	try:
		value = date(year, month, day)
	except ValueError:
		return None
	if value.year < 1900 or value > date.today():
		return None
	return value.isoformat()


def normalize_birth_date(value: Any) -> str | None:
	"""JJJJ-MM-TT oder None. Akzeptiert JJJJ-MM-TT, TT.MM.JJJJ, TT/MM/JJJJ
	und ausgeschriebene Monate; unbrauchbare Angaben ergeben None."""
	if value is None:
		return None
	if isinstance(value, date):
		return _valid(value.year, value.month, value.day)
	text = str(value).strip()
	if not text:
		return None
	match = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?", text)
	if match:
		return _valid(int(match.group(1)), int(match.group(2)), int(match.group(3)))
	match = re.fullmatch(r"(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})", text)
	if match:
		return _valid(int(match.group(3)), int(match.group(2)), int(match.group(1)))
	match = re.fullmatch(rf"(\d{{1,2}})\.?\s+({_MONTH_PATTERN})\.?\s+(\d{{4}})", text, re.IGNORECASE)
	if match:
		return _valid(int(match.group(3)), _MONTHS[match.group(2).lower()], int(match.group(1)))
	match = re.fullmatch(rf"({_MONTH_PATTERN})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})", text, re.IGNORECASE)
	if match:
		return _valid(int(match.group(3)), _MONTHS[match.group(1).lower()], int(match.group(2)))
	return None


def extract_birth_date(text: str | None) -> str | None:
	"""Sucht ein beschriftetes Geburtsdatum im CV-Text ("Geburtsdatum: 12.03.1985",
	"Date of birth: March 12, 1985", "geb. 12. März 1985" ...)."""
	if not text:
		return None
	for match in _LABELLED_DATE.finditer(text):
		raw = next(group for group in match.groupdict().values() if group)
		normalized = normalize_birth_date(re.sub(r"\s+", " ", raw))
		if normalized:
			return normalized
	return None


def ensure_birth_date(profile: Any, *texts: str | None) -> Any:
	"""Ergaenzt profile.birth_date aus dem CV-Text, falls das Parsing keins fand."""
	if getattr(profile, "birth_date", None):
		return profile
	for text in texts:
		found = extract_birth_date(text)
		if found:
			profile.birth_date = found
			break
	return profile


def require_identity(profile: Any) -> tuple[str, str]:
	name = re.sub(r"\s+", " ", str(getattr(profile, "name", "") or "")).strip()
	if not name:
		raise CandidateIdentityError("Name ist erforderlich", "name")
	birth_date = normalize_birth_date(getattr(profile, "birth_date", None))
	if not birth_date:
		raise CandidateIdentityError(
			"Im CV wurde kein Geburtsdatum gefunden. Name und Geburtsdatum machen eine Person im Tool eindeutig - "
			"bitte den Bewerber über das Formular anlegen und das Geburtsdatum ergänzen.",
			"birth_date",
		)
	return name, birth_date


def without_identity_fields(payload: dict[str, Any]) -> dict[str, Any]:
	"""Kopie ohne Felder, die nur der Identifikation dienen."""
	return {key: value for key, value in payload.items() if key not in IDENTITY_ONLY_FIELDS}
