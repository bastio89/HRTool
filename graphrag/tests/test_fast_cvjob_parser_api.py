from fast_cvjob_parsing.app.schemas import CVResponse, JobResponse

import pytest


class FakeResumeJobParser:
    def parse_cv(self, pdf_bytes: bytes) -> CVResponse:
        return CVResponse(
            personal_data={"full_name": "Ada Lovelace"},
            work_experience=[],
            education=[],
            skills={},
        )

    def parse_job(self, pdf_bytes: bytes) -> JobResponse:
        return JobResponse(job_title="Software Engineer", required_skills={})


@pytest.mark.anyio
async def test_graph_rag_exposes_cv_and_job_parser_routes(app_module, api_client):
    app_module.app.state.cv_job_parser = FakeResumeJobParser()
    headers = {"x-api-key": app_module.settings.graphrag_api_key or ""}

    cv_response = await api_client.post(
        "/api/v1/fast-parse/cv",
        files={"file": ("cv.pdf", b"cv bytes", "application/pdf")},
        headers=headers,
    )
    job_response = await api_client.post(
        "/api/v1/fast-parse/job",
        files={"file": ("job.pdf", b"job bytes", "application/pdf")},
        headers=headers,
    )

    assert cv_response.status_code == 200
    assert cv_response.json()["personal_data"]["full_name"] == "Ada Lovelace"
    assert job_response.status_code == 200
    assert job_response.json()["job_title"] == "Software Engineer"