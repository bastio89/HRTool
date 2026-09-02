from __future__ import annotations

from services.candidate_text_renderer import render_candidate_fulltext


def test_render_candidate_fulltext_includes_core_sections() -> None:
    candidate = {
        "name": "Max Mustermann",
        "email": "max@example.com",
        "phone": "+41 79 123 45 67",
        "location": "Zürich",
        "experience": "Senior Data Engineer",
        "education": "MSc Computer Science",
        "skills": "Python, SQL",
        "languages": "Deutsch, Englisch",
        "certificates": "AWS",
        "notes": "Imported from CV",
    }
    work_history = [
        {
            "position": "Data Engineer",
            "employer": "ACME AG",
            "from_date": "2022-01",
            "to_date": None,
            "description": "Built pipelines",
            "location": "Zürich",
        }
    ]
    education_history = [
        {
            "degree": "Master",
            "institution": "ETH Zürich",
            "field_of_study": "Informatik",
            "from_date": "2018-09",
            "to_date": "2021-06",
        }
    ]

    text = render_candidate_fulltext(candidate, work_history=work_history, education_history=education_history)

    assert "Max Mustermann" in text
    assert "E-Mail: max@example.com" in text
    assert "Telefon: +41 79 123 45 67" in text
    assert "Beruflicher Werdegang" in text
    assert "Data Engineer; ACME AG; 2022-01 - heute; Zürich; Built pipelines" in text
    assert "Ausbildungshistorie" in text
    assert "Master; ETH Zürich; Informatik; 2018-09 - 2021-06" in text