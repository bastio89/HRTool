from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fast_cvjob_parsing.app.errors import InvalidPDFError
from fast_cvjob_parsing.app.router import create_cv_job_parser_router


def build_client(parser=None):
    app = FastAPI()
    app.state.cv_job_parser = parser
    app.include_router(create_cv_job_parser_router())
    return TestClient(app)


def test_cv_and_job_routes_use_the_injected_parser():
    cv_response = {
        "personal_data": {},
        "work_experience": [],
        "education": [],
        "skills": {},
    }
    job_response = {"required_skills": {}}
    parser = SimpleNamespace(parse_cv=Mock(return_value=cv_response), parse_job=Mock(return_value=job_response))
    client = build_client(parser)

    cv = client.post("/api/v1/parse/cv", files={"file": ("cv.pdf", b"pdf", "application/pdf")})
    job = client.post("/api/v1/parse/job", files={"file": ("job.pdf", b"pdf", "application/pdf")})

    assert cv.status_code == 200
    assert cv.json()["work_experience"] == []
    assert cv.json()["personal_data"]["full_name"] is None
    assert job.status_code == 200
    assert job.json()["required_skills"]["soft_skills"] == []
    assert job.json()["company_name"] is None
    parser.parse_cv.assert_called_once_with(b"pdf")
    parser.parse_job.assert_called_once_with(b"pdf")


@pytest.mark.parametrize(
    ("content_type", "payload", "status_code"),
    [("text/plain", b"pdf", 400), ("application/pdf", b"", 400)],
)
def test_routes_reject_invalid_uploads(content_type, payload, status_code):
    client = build_client(SimpleNamespace(parse_cv=Mock(), parse_job=Mock()))

    response = client.post(
        "/api/v1/parse/cv",
        files={"file": ("upload", payload, content_type)},
    )

    assert response.status_code == status_code


def test_routes_translate_invalid_pdf_errors():
    parser = SimpleNamespace(parse_cv=Mock(side_effect=InvalidPDFError("Not a PDF")))
    response = build_client(parser).post(
        "/api/v1/parse/cv",
        files={"file": ("cv.pdf", b"invalid", "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Not a PDF"}


def test_routes_report_not_ready_without_a_parser():
    response = build_client().post(
        "/api/v1/parse/cv",
        files={"file": ("cv.pdf", b"pdf", "application/pdf")},
    )

    assert response.status_code == 503