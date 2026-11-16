from __future__ import annotations

import csv
import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


_FIELD_NAMES = {
    "uri": ("concepturi", "uri"),
    "preferred_label": ("conceptpt", "preferredlabel", "preferredterm"),
    "description": ("definition", "description"),
    "concept_type": ("concepttype",),
    "aliases": ("altlabels", "aliases", "synonyms", "nonpreferredterms"),
    "term": ("term", "label", "preferredlabel", "preferredterm", "conceptpt"),
    "term_type": ("termtype", "labeltype"),
    "language": ("language", "languagecode"),
}
_GROUP_TYPES = {"sg", "skillgroup", "skillcompetencegroup"}
_PREFERRED_TERM_TYPES = {"pt", "preferred", "preferredlabel", "preferredterm"}
_LANGUAGE_NAMES = {
    "de": {"de", "deu", "ger", "german", "deutsch"},
    "en": {"en", "eng", "english"},
}


@dataclass(frozen=True)
class AliasResolution:
    status: Literal["resolved", "ambiguous", "unknown"]
    uri: str | None = None
    candidates: tuple[str, ...] = ()


def normalize_alias(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.casefold().split())


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _field(headers: Mapping[str, str], field: str) -> str | None:
    for candidate in _FIELD_NAMES[field]:
        if candidate in headers:
            return headers[candidate]
    return None


def _read_rows(path: Path) -> tuple[list[dict[str, str]], dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as source:
        sample = source.read(8192)
        source.seek(0)
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t").delimiter
        except csv.Error:
            delimiter = ";" if sample.count(";") > sample.count(",") else ","

        reader = csv.DictReader(source, delimiter=delimiter)
        if not reader.fieldnames:
            raise ValueError(f"{path}: CSV-Datei enthält keine Kopfzeile.")
        headers = {_normalize_header(name): name for name in reader.fieldnames if name}
        return ([{key: value or "" for key, value in row.items() if key} for row in reader], headers)


def _split_terms(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"[|\r\n]+", value) if part.strip()]


def _append_alias(concept: dict[str, object], alias: str) -> None:
    normalized = normalize_alias(alias)
    preferred = normalize_alias(str(concept["preferred_label"]))
    aliases = concept["aliases"]
    if normalized and normalized != preferred and isinstance(aliases, list):
        if normalized not in {normalize_alias(existing) for existing in aliases}:
            aliases.append(alias.strip())


def _find_dictionary_files(input_dir: Path, languages: Sequence[str]) -> list[tuple[str | None, Path]]:
    files: list[tuple[str | None, Path]] = []
    seen: set[Path] = set()
    for language in languages:
        candidates = (
            (language, input_dir / f"dictionary_{language}.csv"),
            (language, input_dir / f"dictionary-{language}.csv"),
            (None, input_dir / "dictionary.csv"),
        )
        for file_language, path in candidates:
            if path.is_file() and path not in seen:
                files.append((file_language, path))
                seen.add(path)
                break
    return files


def _language_matches(value: str, language: str) -> bool:
    normalized = value.strip().casefold()
    return not normalized or normalized in _LANGUAGE_NAMES.get(language, {language})


def load_esco_concepts(
    input_dir: Path,
    *,
    release: str,
    languages: Sequence[str] = ("en", "de"),
) -> list[dict[str, object]]:
    if not release.strip():
        raise ValueError("ESCO-Release darf nicht leer sein.")
    if not languages or any(not language.strip() for language in languages):
        raise ValueError("Mindestens eine gültige ESCO-Sprache ist erforderlich.")

    concepts: dict[str, dict[str, object]] = {}
    inline_aliases_found = False

    for language in languages:
        skills_path = input_dir / f"skills_{language}.csv"
        if not skills_path.is_file():
            raise FileNotFoundError(f"ESCO-Skill-Datei für Sprache {language!r} fehlt: {skills_path}")

        rows, headers = _read_rows(skills_path)
        uri_column = _field(headers, "uri")
        label_column = _field(headers, "preferred_label")
        if uri_column is None or label_column is None:
            raise ValueError(
                f"{skills_path}: Erwartete Spalten Concept URI/URI und Concept PT/preferredLabel fehlen."
            )
        description_column = _field(headers, "description")
        type_column = _field(headers, "concept_type")
        alias_column = _field(headers, "aliases")
        inline_aliases_found |= alias_column is not None

        for row_number, row in enumerate(rows, start=2):
            uri = row.get(uri_column, "").strip()
            preferred_label = row.get(label_column, "").strip()
            if not uri or not preferred_label:
                raise ValueError(f"{skills_path}:{row_number}: Konzept-URI und Concept PT müssen gesetzt sein.")

            concept_type = row.get(type_column, "").strip().casefold() if type_column else ""
            if concept_type in _GROUP_TYPES:
                continue

            concept = concepts.get(uri)
            if concept is None:
                concept = {
                    "uri": uri,
                    "preferred_label": preferred_label,
                    "aliases": [],
                    "description": "",
                    "release": release.strip(),
                }
                concepts[uri] = concept
            elif normalize_alias(preferred_label) != normalize_alias(str(concept["preferred_label"])):
                _append_alias(concept, preferred_label)

            description = row.get(description_column, "").strip() if description_column else ""
            if description and not concept["description"]:
                concept["description"] = description
            if alias_column:
                for alias in _split_terms(row.get(alias_column, "")):
                    _append_alias(concept, alias)

    dictionary_files = _find_dictionary_files(input_dir, languages)
    if not dictionary_files and not inline_aliases_found:
        raise FileNotFoundError(
            "ESCO-Synonyme fehlen: dictionary_<sprache>.csv/dictionary.csv oder eine Alias-Spalte wird benötigt."
        )

    for file_language, path in dictionary_files:
        rows, headers = _read_rows(path)
        uri_column = _field(headers, "uri")
        term_column = _field(headers, "term")
        type_column = _field(headers, "term_type")
        language_column = _field(headers, "language")
        if uri_column is None or term_column is None:
            raise ValueError(f"{path}: Erwartete Spalten Concept URI/URI und Term/Label fehlen.")

        for row_number, row in enumerate(rows, start=2):
            uri = row.get(uri_column, "").strip()
            term = row.get(term_column, "").strip()
            if not uri or not term:
                raise ValueError(f"{path}:{row_number}: Konzept-URI und Term müssen gesetzt sein.")
            if uri not in concepts:
                continue

            language = row.get(language_column, "").strip() if language_column else ""
            if language:
                if file_language and not _language_matches(language, file_language):
                    continue
                if not file_language and not any(_language_matches(language, candidate) for candidate in languages):
                    continue
            if type_column and row.get(type_column, "").strip().casefold() in _PREFERRED_TERM_TYPES:
                continue
            _append_alias(concepts[uri], term)

    return list(concepts.values())


def build_alias_index(concepts: Iterable[Mapping[str, object]]) -> dict[str, tuple[str, ...]]:
    aliases: dict[str, set[str]] = defaultdict(set)
    for concept in concepts:
        uri = str(concept.get("uri", "")).strip()
        if not uri:
            continue
        labels = [concept.get("preferred_label", ""), *(
            concept.get("aliases", []) if isinstance(concept.get("aliases", []), list) else []
        )]
        for label in labels:
            if isinstance(label, str):
                normalized = normalize_alias(label)
                if normalized:
                    aliases[normalized].add(uri)
    return {label: tuple(sorted(uris)) for label, uris in aliases.items()}


def resolve_alias(label: str, alias_index: Mapping[str, tuple[str, ...]]) -> AliasResolution:
    candidates = alias_index.get(normalize_alias(label), ())
    if not candidates:
        return AliasResolution(status="unknown")
    if len(candidates) > 1:
        return AliasResolution(status="ambiguous", candidates=candidates)
    return AliasResolution(status="resolved", uri=candidates[0], candidates=candidates)
