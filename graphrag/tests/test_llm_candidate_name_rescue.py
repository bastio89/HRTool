from __future__ import annotations

from services.llm import LLMService


def test_candidate_name_unreliable_detection() -> None:
    assert LLMService._is_unreliable_candidate_name("Unknown Candidate") is True
    assert LLMService._is_unreliable_candidate_name("CV Profile") is True
    assert LLMService._is_unreliable_candidate_name("Senior .NET Core Developer") is True
    assert LLMService._is_unreliable_candidate_name("Anna Mueller") is False


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
