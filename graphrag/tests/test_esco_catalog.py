from __future__ import annotations

import csv

import pytest

from services.esco_catalog import build_alias_index, load_esco_concepts, resolve_alias


def _write_csv(path, headers: list[str], rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(headers)
        writer.writerows(rows)


def test_load_esco_concepts_merges_languages_and_imports_dictionary_terms(tmp_path) -> None:
    _write_csv(
        tmp_path / "skills_en.csv",
        ["Concept URI", "Concept type", "Concept PT", "Definition"],
        [
            ["https://example.test/skill/python", "SK", "Python programming", "Use the Python language."],
            ["https://example.test/skill/group", "SG", "Programming languages", "A skill group."],
        ],
    )
    _write_csv(
        tmp_path / "skills_de.csv",
        ["Concept URI", "Concept type", "Concept PT", "Definition"],
        [["https://example.test/skill/python", "SK", "Python-Programmierung", "Python verwenden."]],
    )
    _write_csv(
        tmp_path / "dictionary_en.csv",
        ["Concept URI", "Term", "Term type", "Language"],
        [
            ["https://example.test/skill/python", "Coding in Python", "NPT", "en"],
            ["https://example.test/skill/python", "Python programming", "PT", "en"],
        ],
    )
    _write_csv(
        tmp_path / "dictionary_de.csv",
        ["Concept URI", "Term", "Term type", "Language"],
        [["https://example.test/skill/python", "Mit Python programmieren", "NPT", "de"]],
    )

    concepts = load_esco_concepts(tmp_path, release="1.2.1", languages=("en", "de"))

    assert len(concepts) == 1
    concept = concepts[0]
    assert concept == {
        "uri": "https://example.test/skill/python",
        "preferred_label": "Python programming",
        "aliases": [
            "Python-Programmierung",
            "Coding in Python",
            "Mit Python programmieren",
        ],
        "description": "Use the Python language.",
        "release": "1.2.1",
    }


def test_alias_resolution_distinguishes_unique_ambiguous_and_unknown_labels(tmp_path) -> None:
    _write_csv(
        tmp_path / "skills_en.csv",
        ["Concept URI", "Concept type", "Concept PT", "Definition"],
        [
            ["https://example.test/skill/one", "SK", "Alpha skill", "First."],
            ["https://example.test/skill/two", "SK", "Beta skill", "Second."],
        ],
    )
    _write_csv(
        tmp_path / "dictionary_en.csv",
        ["Concept URI", "Term", "Term type"],
        [
            ["https://example.test/skill/one", "Shared term", "NPT"],
            ["https://example.test/skill/two", "Shared term", "NPT"],
        ],
    )

    concepts = load_esco_concepts(tmp_path, release="1.2.1", languages=("en",))
    alias_index = build_alias_index(concepts)

    assert resolve_alias(" alpha SKILL ", alias_index).uri == "https://example.test/skill/one"
    assert resolve_alias("shared term", alias_index).status == "ambiguous"
    assert resolve_alias("shared term", alias_index).candidates == (
        "https://example.test/skill/one",
        "https://example.test/skill/two",
    )
    assert resolve_alias("not in ESCO", alias_index).status == "unknown"


def test_import_rejects_missing_required_columns_and_dictionary(tmp_path) -> None:
    _write_csv(tmp_path / "skills_en.csv", ["Concept URI", "Definition"], [["u", "text"]])

    with pytest.raises(ValueError, match="Concept PT"):
        load_esco_concepts(tmp_path, release="1.2.1", languages=("en",))

    _write_csv(
        tmp_path / "skills_en.csv",
        ["Concept URI", "Concept type", "Concept PT", "Definition"],
        [["https://example.test/skill/one", "SK", "One", "Text."]],
    )
    with pytest.raises(FileNotFoundError, match="Synonyme fehlen"):
        load_esco_concepts(tmp_path, release="1.2.1", languages=("en",))
