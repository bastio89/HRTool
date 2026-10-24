import re
from typing import Dict, Iterable, List


SKILL_HEADING_RE = re.compile(
    r"^(?:(?:deine|deiner|your|our|key|required)\s+)*(?:fähigkeiten|kompetenzen|kenntnisse|skills|"
    r"qualifikationen|qualifications|requirements|competencies)\s*:?$",
    re.IGNORECASE,
)
SECTION_END_RE = re.compile(
    r"^(?:unser angebot|was wir bieten|our offer|what we offer|benefits|über das unternehmen|about us|"
    r"about the company|deine mission|your mission|responsibilities|verantwortlichkeiten|deine aufgaben|"
    r"ihre aufgaben|stellenbeschreibung|job description|zusätzliche informationen|additional information|"
    r"jetzt bewerben|bewerbung|apply now)\s*:?$",
    re.IGNORECASE,
)
BULLET_RE = re.compile(r"^[\s\u200b]*(?:[\u2022\u25cf\u25aa\u25e6\u25a0\u25cb*]|[-–—])\s*")
SOFT_SKILL_RE = re.compile(
    r"\b(verantwort\w*|analyt\w*|kommunikat\w*|kundenorient\w*|customer\w*|motivat\w*|"
    r"organis\w*|team\w*|auftreten|sympath\w*|flexib\w*|selbständig\w*|selbstständig\w*|"
    r"communication|interpersonal|leadership|responsib\w*|open-minded)\b",
    re.IGNORECASE,
)
TECHNICAL_SKILL_RE = re.compile(
    r"\b(microsoft|office|power[- ]?user|xml|html|javascript|programmi\w*|software|"
    r"sql|python|java|cloud|database|devops|scrum|react|angular|typescript|terraform|"
    r"databricks|kafka|api|schnittstellen?\w*)\b",
    re.IGNORECASE,
)
LANGUAGE_PATTERNS = (
    (re.compile(r"\bdeutsch(?:e[nmrs]?|kenntnisse)?\b", re.IGNORECASE), "German"),
    (re.compile(r"\bgerman\b", re.IGNORECASE), "German"),
    (re.compile(r"\benglisch(?:e[nmrs]?)?\b", re.IGNORECASE), "English"),
    (re.compile(r"\benglish\b", re.IGNORECASE), "English"),
    (re.compile(r"\bfranzösisch(?:e[nmrs]?)?\b", re.IGNORECASE), "French"),
    (re.compile(r"\bfrench\b", re.IGNORECASE), "French"),
    (re.compile(r"\bitalienisch(?:e[nmrs]?)?\b", re.IGNORECASE), "Italian"),
    (re.compile(r"\bitalian\b", re.IGNORECASE), "Italian"),
    (re.compile(r"\bspanisch(?:e[nmrs]?)?\b", re.IGNORECASE), "Spanish"),
    (re.compile(r"\bspanish\b", re.IGNORECASE), "Spanish"),
)


def _language_skills(text: str) -> List[str]:
    skills = []
    for pattern, language in LANGUAGE_PATTERNS:
        for match in pattern.finditer(text):
            nearby_text = text[match.end():match.end() + 32]
            level_match = re.search(r"\b([ABC][12])\b", nearby_text, re.IGNORECASE)
            skill = f"{language} ({level_match.group(1).upper()})" if level_match else language
            if skill not in skills:
                skills.append(skill)
    return skills


def _category_for(text: str) -> tuple[str, List[str]]:
    languages = _language_skills(text)
    if languages:
        return "language_skills", languages
    if SOFT_SKILL_RE.search(text):
        return "soft_skills", [text]
    if TECHNICAL_SKILL_RE.search(text):
        return "it_skills", [text]
    return "method_skills", [text]


def extract_required_skill_sections(blocks: Iterable[str]) -> Dict[str, List[str]]:
    categorized = {
        "soft_skills": [],
        "it_skills": [],
        "method_skills": [],
        "tool_skills": [],
        "language_skills": [],
    }
    in_skill_section = False
    current_item: List[str] = []

    def flush_item() -> None:
        if not current_item:
            return
        text = " ".join(part.strip() for part in current_item if part.strip())
        current_item.clear()
        if text:
            category, skills = _category_for(text)
            categorized[category].extend(skills)

    for raw_text in blocks:
        text = raw_text.replace("\u200b", "").strip()
        if not text:
            continue
        if SKILL_HEADING_RE.fullmatch(text):
            flush_item()
            in_skill_section = True
            continue
        if not in_skill_section:
            continue
        if SECTION_END_RE.fullmatch(text):
            flush_item()
            in_skill_section = False
            continue

        bullet_match = BULLET_RE.match(text)
        if bullet_match:
            flush_item()
            item = text[bullet_match.end():].strip()
            if item:
                current_item.append(item)
        elif current_item:
            current_item.append(text)

    flush_item()
    return categorized