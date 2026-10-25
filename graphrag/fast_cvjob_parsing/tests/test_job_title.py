from pathlib import Path

from fast_cvjob_parsing.app.parser import ResumeJobParser


class ProductOwnerMentionModel:
    def predict_entities(self, text, labels, threshold):
        if "Product Ownern" in text:
            return [{"text": "Product Ownern", "label": "job title", "score": 0.99}]
        return []


def test_job_title_prefers_prominent_first_page_headline_over_body_mention():
    fixture = (
        Path(__file__).parents[1]
        / "testdaten"
        / "Java Developer Sopra Steria.pdf"
    )
    parser = ResumeJobParser(ProductOwnerMentionModel())

    profile, raw_text = parser.parse_job_with_text(fixture.read_bytes())

    assert "Product Ownern" in raw_text
    assert profile.job_title == "Java Developer"


def test_job_title_skips_section_heading_and_removes_trailing_workload():
    fixture = (
        Path(__file__).parents[1]
        / "testdaten"
        / "Senior Cloud Data Platform Specialist (Inventx AG).pdf"
    )
    parser = ResumeJobParser(ProductOwnerMentionModel())

    profile, _ = parser.parse_job_with_text(fixture.read_bytes())

    assert profile.job_title == "Senior Cloud Data Platform Specialist (Databricks)"