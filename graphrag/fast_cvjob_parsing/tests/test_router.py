from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest

from fast_cvjob_parsing.app.errors import InvalidPDFError
from fast_cvjob_parsing.app.router import create_cv_job_parser_router
from fast_cvjob_parsing.app.schemas import CVResponse, JobResponse


class FakeParser:
    def parse_cv(self, pdf_bytes: bytes) -> CVResponse:
        if pdf_bytes == b"invalid":
            raise InvalidPDFError("The uploaded file is not a valid PDF.")
        return CVResponse(personal_data={"full_name": "Ada Lovelace"}, work_experience=[], education=[], skills={})

    def parse_job(self, pdf_bytes: bytes) -> JobResponse:
        return JobResponse(required_skills={})


def create_test_app(parser: FakeParser | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(create_cv_job_parser_router())
    if parser is not None:
        app.state.cv_job_parser = parser
    return app


@pytest.mark.anyio
async def test_cv_and_job_routes_use_the_injected_parser():
    async with AsyncClient(transport=ASGITransport(app=create_test_app(FakeParser())), base_url="http://test") as client:
        cv_response = await client.post(
            "/api/v1/fast-parse/cv",
            files={"file": ("cv.pdf", b"cv bytes", "application/pdf")},
        )
        job_response = await client.post(
            "/api/v1/fast-parse/job",
            files={"file": ("job.pdf", b"job bytes", "application/pdf")},
        )

    assert cv_response.status_code == 200
    assert cv_response.json()["personal_data"]["full_name"] == "Ada Lovelace"
    assert job_response.status_code == 200
    assert job_response.json()["job_title"] is None


@pytest.mark.anyio
async def test_routes_report_not_ready_without_a_parser():
    async with AsyncClient(transport=ASGITransport(app=create_test_app()), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/fast-parse/cv",
            files={"file": ("cv.pdf", b"cv bytes", "application/pdf")},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "Parser model is not ready."


@pytest.mark.anyio
async def test_routes_reject_invalid_pdf_and_non_pdf_uploads():
    async with AsyncClient(transport=ASGITransport(app=create_test_app(FakeParser())), base_url="http://test") as client:
        invalid_pdf = await client.post(
            "/api/v1/fast-parse/cv",
            files={"file": ("cv.pdf", b"invalid", "application/pdf")},
        )
        wrong_type = await client.post(
            "/api/v1/fast-parse/job",
            files={"file": ("job.txt", b"text", "text/plain")},
        )

    assert invalid_pdf.status_code == 400
    assert invalid_pdf.json()["detail"] == "The uploaded file is not a valid PDF."
    assert wrong_type.status_code == 400
    assert wrong_type.json()["detail"] == "Upload must be a PDF file."