from __future__ import annotations

from services.llm import LLMService


import pytest


def test_candidate_name_unreliable_detection() -> None:
    assert LLMService._is_unreliable_candidate_name("Unknown Candidate") is True
    assert LLMService._is_unreliable_candidate_name("CV Profile") is True
    assert LLMService._is_unreliable_candidate_name("Senior .NET Core Developer") is True
    assert LLMService._is_unreliable_candidate_name("Anna Mueller") is False


@pytest.mark.parametrize(
    "value",
    [
        "Senior .NET Core Developer",
        "Junior Software Engineer",
        "Projektleiter Digitalisierung",
        "Werkstudent Data Science",
        "Principal Consultant",
        "Unknown Candidate",
        "n/a",
        "anna@example.com",
        "Bewerber 42",
    ],
)
def test_job_titles_and_placeholders_are_rejected(value: str) -> None:
    assert LLMService._is_unreliable_candidate_name(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "Anna Mueller",
        # Diese Nachnamen sind zugleich Berufsbezeichnungen und im deutschen
        # Sprachraum sehr haeufig - sie duerfen keinesfalls anschlagen.
        "Thomas Koch",
        "Anna Schneider",
        "Peter Bauer",
        "Maria Weber",
        "Stefan Fischer",
        "Julia Richter",
        "Michael Schaefer",
        "Sabine Jaeger",
        "Klaus Wagner",
        "Jean-Luc Picard",
        "Maria del Carmen Garcia Lopez",
    ],
)
def test_real_names_are_accepted(value: str) -> None:
    assert LLMService._is_unreliable_candidate_name(value) is False


def test_infer_candidate_name_from_text() -> None:
    raw_text = """
    Anna Mueller
    Senior Data Engineer
    Berlin, Germany
    anna.mueller@example.com
    """
    assert LLMService._infer_candidate_name_from_text(raw_text) == "Anna Mueller"


def test_normalize_candidate_skills_accepts_string_and_string_items() -> None:
    skills = LLMService._normalize_candidate_skills("Python, SQL; Docker")
    assert [skill["name"] for skill in skills] == ["Python", "SQL", "Docker"]

    skills = LLMService._normalize_candidate_skills(["Python", {"skill_name": "SQL"}, "python"])
    assert [skill["name"] for skill in skills] == ["Python", "SQL"]
