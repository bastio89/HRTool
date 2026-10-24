import logging
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import fitz
import torch
from gliner import GLiNER

from .errors import InvalidPDFError
from .schemas import (
    CVResponse,
    CategorizedSkills,
    Education,
    JobResponse,
    PersonalData,
    WorkExperience,
)

logger = logging.getLogger(__name__)

MODEL_NAME = "urchade/gliner_multi-v2.1"
EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
PHONE_RE = re.compile(r"(?:\+(?:41|49)|00(?:41|49)|0)[\s-]?[1-9][0-9\s\-/]{6,}")
PENSUM_RE = re.compile(r"\b\d{2,3}(?:\s*-\s*\d{2,3})?\s*%(?!\w)")
DATE_RE = re.compile(
    r"\b(?:19|20)\d{2}\b|\b\d{1,2}[./-](?:19|20)?\d{2}\b|"
    r"\b(?:present|current|today|heute|aktuell)\b",
    re.IGNORECASE,
)

CV_LABELS = [
    "person name",
    "address",
    "city",
    "employer company",
    "job title",
    "date period",
    "educational institution",
    "degree certification",
    "soft skill",
    "IT technical skill",
    "methodology framework skill",
    "software tool",
    "language skill",
]
JOB_LABELS = [
    "hiring company",
    "work location",
    "job title",
    "workload pensum",
    "remote policy",
    "soft skill",
    "IT technical skill",
    "methodology framework skill",
    "software tool",
    "language skill",
]

SKILL_LABELS = {
    "soft skill": "soft_skills",
    "IT technical skill": "it_skills",
    "methodology framework skill": "method_skills",
    "software tool": "tool_skills",
    "language skill": "language_skills",
}
SKILL_THRESHOLD = 0.35
ENTITY_THRESHOLD = 0.45


@dataclass
class TextBlock:
    page: int
    bbox: Tuple[float, float, float, float]
    text: str
    entities: List[Dict[str, Any]] = field(default_factory=list)


def extract_text_blocks(pdf_bytes: bytes) -> List[TextBlock]:
    if not pdf_bytes:
        raise InvalidPDFError("The uploaded file is empty.")

    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except (fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise InvalidPDFError("The uploaded file is not a valid PDF.") from exc

    blocks: List[TextBlock] = []
    try:
        if document.is_encrypted:
            raise InvalidPDFError("Password-protected PDFs are not supported.")
        for page_number, page in enumerate(document):
            for raw_block in page.get_text("blocks"):
                x0, y0, x1, y1, text = raw_block[:5]
                cleaned_text = " ".join(text.split())
                if cleaned_text:
                    blocks.append(
                        TextBlock(
                            page=page_number,
                            bbox=(x0, y0, x1, y1),
                            text=cleaned_text,
                        )
                    )
    finally:
        document.close()

    if not blocks:
        raise InvalidPDFError("The PDF contains no extractable text.")
    blocks.sort(key=lambda block: (block.page, block.bbox[1], block.bbox[0]))
    return blocks


def _clean(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip(" \t\r\n,;:|•-_")
    return cleaned or None


def _unique(values: Iterable[Optional[str]]) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        cleaned = _clean(value)
        key = cleaned.casefold() if cleaned else ""
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def _first_entity(blocks: Sequence[TextBlock], label: str) -> Optional[str]:
    return next(
        (
            cleaned
            for block in blocks
            for entity in block.entities
            if entity["label"] == label
            for cleaned in [_clean(entity.get("text"))]
            if cleaned
        ),
        None,
    )


def _skill_values(blocks: Sequence[TextBlock]) -> CategorizedSkills:
    categorized: Dict[str, List[str]] = {field_name: [] for field_name in SKILL_LABELS.values()}
    for block in blocks:
        for entity in block.entities:
            field_name = SKILL_LABELS.get(entity["label"])
            if field_name:
                categorized[field_name].append(entity.get("text", ""))
    return CategorizedSkills(**{key: _unique(values) for key, values in categorized.items()})


def _dates(value: str) -> Tuple[Optional[str], Optional[str]]:
    matches = [match.group(0) for match in DATE_RE.finditer(value)]
    if len(matches) >= 2:
        return matches[0], matches[-1]
    if matches:
        return matches[0], None
    return _clean(value), None


def _section_for(text: str, previous: str) -> str:
    normalized = text.casefold()
    if re.search(r"\b(education|educational|studies|academic|ausbildung|bildung|studium)\b", normalized):
        return "education"
    if re.search(
        r"\b(experience|employment|work history|professional background|berufserfahrung)\b",
        normalized,
    ):
        return "work"
    if re.search(r"\b(skills|competencies|kenntnisse|fähigkeiten)\b", normalized):
        return "skills"
    return previous


def _records(blocks: Sequence[TextBlock], *, education: bool) -> List[Any]:
    section = "work"
    records: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    institution_labels = {"educational institution", "degree certification"}
    work_labels = {"employer company", "job title", "date period"}
    labels = institution_labels | {"date period"} if education else work_labels

    for block in blocks:
        section = _section_for(block.text, section)
        block_labels = {entity["label"] for entity in block.entities}
        inferred_education = bool(block_labels & institution_labels)
        inferred_work = bool(block_labels & work_labels)
        if inferred_education:
            section = "education"
        elif {"employer company", "job title"} & block_labels:
            section = "work"
        if section != ("education" if education else "work"):
            continue

        relevant = [entity for entity in block.entities if entity["label"] in labels]
        anchor_labels = {entity["label"] for entity in relevant}
        primary_label = "educational institution" if education else "employer company"
        secondary_label = "degree certification" if education else "job title"
        if current is None and not relevant:
            continue
        starts_new = bool(
            current
            and (
                (primary_label in anchor_labels and current.get("primary"))
                or (secondary_label in anchor_labels and current.get("secondary"))
            )
        )
        if current is None or starts_new:
            current = {"primary": None, "secondary": None, "start_date": None, "end_date": None, "tasks": []}
            records.append(current)

        for entity in relevant:
            value = _clean(entity.get("text"))
            if not value:
                continue
            if entity["label"] == primary_label and not current["primary"]:
                current["primary"] = value
            elif entity["label"] == secondary_label and not current["secondary"]:
                current["secondary"] = value
            elif entity["label"] == "date period":
                start_date, end_date = _dates(value)
                current["start_date"] = current["start_date"] or start_date
                current["end_date"] = current["end_date"] or end_date

        if not education and not relevant and current and block.text:
            summary = _clean(block.text)
            if summary and len(summary) <= 500:
                current["tasks"].append(summary)

    if education:
        return [
            Education(
                institution=record["primary"],
                degree_or_title=record["secondary"],
                start_date=record["start_date"],
                end_date=record["end_date"],
            )
            for record in records
            if record["primary"] or record["secondary"] or record["start_date"]
        ]
    return [
        WorkExperience(
            employer=record["primary"],
            job_title=record["secondary"],
            start_date=record["start_date"],
            end_date=record["end_date"],
            tasks_summary=_unique(record["tasks"]),
        )
        for record in records
        if record["primary"] or record["secondary"] or record["start_date"] or record["tasks"]
    ]


class ResumeJobParser:
    def __init__(self, model: Any) -> None:
        self.model = model
        self._inference_lock = threading.Lock()

    @classmethod
    def load(cls) -> "ResumeJobParser":
        cache_dir = os.getenv("MODEL_CACHE_DIR", "/app/model_cache")
        model_name = os.getenv("GLINER_MODEL", MODEL_NAME)
        torch.set_num_threads(max(1, int(os.getenv("TORCH_NUM_THREADS", "2"))))
        model = GLiNER.from_pretrained(model_name, cache_dir=cache_dir)
        model.to("cpu")
        model.eval()
        return cls(model)

    def _annotate(self, blocks: List[TextBlock], labels: List[str]) -> None:
        with self._inference_lock, torch.inference_mode():
            for block in blocks:
                predictions = self.model.predict_entities(block.text, labels, threshold=SKILL_THRESHOLD)
                for prediction in predictions:
                    label = prediction.get("label")
                    score = float(prediction.get("score", 0.0))
                    required_threshold = SKILL_THRESHOLD if label in SKILL_LABELS else ENTITY_THRESHOLD
                    if label in labels and score >= required_threshold and _clean(prediction.get("text")):
                        block.entities.append(prediction)

    @staticmethod
    def _document_text(blocks: Sequence[TextBlock]) -> str:
        return "\n".join(block.text for block in blocks)

    def parse_cv(self, pdf_bytes: bytes) -> CVResponse:
        blocks = extract_text_blocks(pdf_bytes)
        self._annotate(blocks, CV_LABELS)
        document_text = self._document_text(blocks)
        email_match = EMAIL_RE.search(document_text)
        phone_match = PHONE_RE.search(document_text)
        return CVResponse(
            personal_data=PersonalData(
                full_name=_first_entity(blocks, "person name"),
                email=email_match.group(0) if email_match else None,
                phone=_clean(phone_match.group(0)) if phone_match else None,
                address=_first_entity(blocks, "address"),
                location=_first_entity(blocks, "city"),
            ),
            work_experience=_records(blocks, education=False),
            education=_records(blocks, education=True),
            skills=_skill_values(blocks),
        )

    def parse_job(self, pdf_bytes: bytes) -> JobResponse:
        return self.parse_job_with_text(pdf_bytes)[0]

    def parse_job_with_text(self, pdf_bytes: bytes) -> tuple[JobResponse, str]:
        blocks = extract_text_blocks(pdf_bytes)
        self._annotate(blocks, JOB_LABELS)
        document_text = self._document_text(blocks)
        pensum_match = PENSUM_RE.search(document_text)
        remote = _first_entity(blocks, "remote policy")
        if remote:
            normalized_remote = remote.casefold()
            if "hybrid" in normalized_remote:
                remote = "Hybrid"
            elif "remote" in normalized_remote or "home office" in normalized_remote:
                remote = "Full Remote"
            elif "on-site" in normalized_remote or "onsite" in normalized_remote or "office" in normalized_remote:
                remote = "On-Site"

        return (
            JobResponse(
                company_name=_first_entity(blocks, "hiring company"),
                location=_first_entity(blocks, "work location"),
                job_title=_first_entity(blocks, "job title"),
                required_skills=_skill_values(blocks),
                remote_work=remote,
                workload_pensum=_first_entity(blocks, "workload pensum")
                or (pensum_match.group(0) if pensum_match else None),
            ),
            document_text,
        )