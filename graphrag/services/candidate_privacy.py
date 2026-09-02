from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any

from services.postgres_store import PostgresStore


class CandidatePrivacyService:
    def __init__(self, postgres_store: PostgresStore) -> None:
        self.postgres_store = postgres_store

    async def anonymize_candidate(self, candidate_id: str) -> dict[str, Any]:
        record = await self._load_candidate_text(candidate_id)
        mapping = record.get("mapping") or {}
        anonymized_text = record.get("anonymized_text")

        if not anonymized_text or not mapping:
            anonymized_text, mapping = self._anonymize_text(
                record["original_text"],
                candidate_name=record.get("candidate_name"),
            )
            await self.postgres_store.store_candidate_anonymization(candidate_id, anonymized_text, mapping)

        return {
            "candidate_id": candidate_id,
            "mode": "anon",
            "text": anonymized_text,
            "original_text": record["original_text"],
            "anonymized_text": anonymized_text,
            "mapping": mapping,
        }

    async def deanonymize_candidate(self, candidate_id: str) -> dict[str, Any]:
        record = await self._load_candidate_text(candidate_id)
        mapping = record.get("mapping") or {}
        anonymized_text = record.get("anonymized_text") or record["original_text"]
        return {
            "candidate_id": candidate_id,
            "mode": "deanon",
            "text": record["original_text"],
            "original_text": record["original_text"],
            "anonymized_text": anonymized_text,
            "mapping": mapping,
        }

    async def _load_candidate_text(self, candidate_id: str) -> dict[str, Any]:
        record = await self.postgres_store.get_candidate_text(candidate_id)
        if record is None or not str(record.get("original_text") or "").strip():
            raise LookupError(f"No stored CV text found for candidate_id={candidate_id}")
        return record

    def _anonymize_text(self, text: str, *, candidate_name: str | None = None) -> tuple[str, dict[str, str]]:
        mapping: "OrderedDict[str, str]" = OrderedDict()
        counters = {
            "Vorname": 1,
            "Name": 1,
            "Adresse": 1,
            "Tel": 1,
            "Email": 1,
            "URL": 1,
        }

        def register(original: str, prefix: str) -> str:
            cleaned = original.strip()
            if not cleaned:
                return original
            placeholder = mapping.get(cleaned)
            if placeholder is None:
                placeholder = f"{prefix}{counters[prefix]}"
                counters[prefix] += 1
                mapping[cleaned] = placeholder
            return placeholder

        def replace_pattern(source: str, pattern: re.Pattern[str], prefix: str) -> str:
            def _replace(match: re.Match[str]) -> str:
                return register(match.group(0), prefix)

            return pattern.sub(_replace, source)

        result = text
        result = replace_pattern(result, re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "Email")
        result = replace_pattern(result, re.compile(r"(?i)\b(?:https?://|www\.)\S+\b"), "URL")
        result = replace_pattern(result, re.compile(r"(?<!\w)(?:\+?\d[\d\s()./-]{6,}\d)(?!\w)"), "Tel")
        result = replace_pattern(
            result,
            re.compile(r"(?i)\b(?:adresse|anschrift|wohnort|address)\s*[:\-]\s*[^\n]+"),
            "Adresse",
        )
        result = replace_pattern(
            result,
            re.compile(
                r"(?i)\b(?:[A-Za-zÄÖÜäöüß0-9.-]+(?:strasse|straße|weg|platz|allee|gasse|ring|pfad|damm|ufer|steig)\s+\d+[a-zA-Z]?(?:\s*,\s*\d{4,5}\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\- ]+)?)\b",
            ),
            "Adresse",
        )
        result = replace_pattern(
            result,
            re.compile(r"\b\d{4,5}\s+[A-ZÄÖÜ][\wÄÖÜäöüß'\-. ]+\b"),
            "Adresse",
        )

        inferred_name = candidate_name or self._infer_name_from_text(text)
        if inferred_name:
            first_names, last_names = self._split_name(inferred_name)
            for token in first_names:
                result = self._replace_word(result, token, register(token, "Vorname"))
            for token in last_names:
                result = self._replace_word(result, token, register(token, "Name"))

        return result, dict(mapping)

    def _replace_word(self, text: str, word: str, replacement: str) -> str:
        if not word.strip():
            return text
        pattern = re.compile(rf"(?<!\w){re.escape(word)}(?!\w)")
        return pattern.sub(replacement, text)

    def _split_name(self, candidate_name: str) -> tuple[list[str], list[str]]:
        cleaned = re.sub(r"\s+", " ", candidate_name).strip(" ,;:\t\n\r")
        tokens = [token.strip(".,;:") for token in cleaned.split() if token.strip(".,;:")]
        filtered: list[str] = []
        for token in tokens:
            lower = token.casefold().rstrip(".")
            if lower in {"dr", "prof", "herr", "frau", "mr", "mrs", "ms"}:
                continue
            filtered.append(token)
        if len(filtered) <= 1:
            return filtered, []
        return filtered[:-1], filtered[-1:]

    def _infer_name_from_text(self, text: str) -> str | None:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for line in lines[:12]:
            lowered = line.casefold()
            if any(marker in lowered for marker in ("@", "http://", "https://", "www.")):
                continue
            match = re.match(r"^(?:name|vorname|nachname)\s*[:\-]\s*(.+)$", line, flags=re.IGNORECASE)
            if match:
                candidate = match.group(1).strip()
                if candidate:
                    return candidate
            if re.fullmatch(r"[A-ZÄÖÜ][A-Za-zÀ-ÖØ-öø-ÿ'\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÀ-ÖØ-öø-ÿ'\-]+){1,3}", line):
                return line
        return None