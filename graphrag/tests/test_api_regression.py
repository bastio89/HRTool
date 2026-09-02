from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from models import (
    CandidateProfileExtraction,
    CandidateSkillExtraction,
    JobProfileExtraction,
    JobSkillExtraction,
    VectorMatchRequest,
    LLMRerankItem,
    LLMRerankResponse,
    Stage1Candidate,
    Stage2Candidate,
)


@pytest.mark.anyio
async def test_health_ok(api_client):
    response = await api_client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert set(payload["ai_usage"].keys()) == {"calls", "input_tokens", "output_tokens", "total_tokens"}
    assert payload["ai_usage"]["total_tokens"] >= payload["ai_usage"]["input_tokens"]
    assert payload["ai_usage"]["total_tokens"] >= payload["ai_usage"]["output_tokens"]


@pytest.mark.anyio
async def test_ingest_candidate_accepts_json(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Max Mustermann",
        location="Berlin",
        experience_years=6,
        skills=[CandidateSkillExtraction(name="python", experience_years=6)],
        preferred_roles=["data engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-123")
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "raw_text": (
                "Max Mustermann aus Berlin mit 6 Jahren Erfahrung in Python, FastAPI, SQL und Neo4j "
                "sucht eine Data-Engineer-Rolle."
            )
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "cand-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert embedding_mock.await_args_list[1].args == ({"entity": "skill", "name": "python"},)
    upsert_mock.assert_awaited_once()
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("cand-123")


@pytest.mark.anyio
async def test_ingest_candidate_uses_structured_profile_payload(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Max Mustermann",
        location="Berlin",
        experience_years=6,
        salary_expectation=90000,
        current_employer="ACME GmbH",
        current_position="Senior Data Engineer",
        certificates="AWS, Azure",
        drivers_license="B",
        mobility="Reisebereit",
        tags="Senior, Remote",
        notes="Structured import payload",
        skills=[CandidateSkillExtraction(name="python", experience_years=6)],
        languages=[],
        educations=[],
        industries=[],
        preferred_roles=["data engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-structured-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": fake_profile.model_dump(),
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "cand-structured-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert upsert_mock.await_count == 1
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("cand-structured-123")


@pytest.mark.anyio
async def test_ingest_candidate_accepts_backend_style_string_profile_fields(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-string-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": {
                "name": "Max Mustermann",
                "location": "Berlin",
                "experience_years": 6,
                "salary_expectation": 90000,
                "skills": "Python, Neo4j, FastAPI",
                "languages": "Deutsch (C2), Englisch (B2)",
                "educations": "Bachelor of Science, FHNW, Wirtschaftsinformatik",
                "industries": "IT, Consulting",
                "preferred_roles": "Data Engineer, Backend Engineer",
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "cand-string-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 4
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert [skill["name"] for skill in profile_payload["skills"]] == ["Python", "Neo4j", "FastAPI"]
    assert [language["name"] for language in profile_payload["languages"]] == ["Deutsch (C2)", "Englisch (B2)"]
    assert profile_payload["preferred_roles"] == ["Data Engineer", "Backend Engineer"]
    upsert_mock.assert_awaited_once()
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("cand-string-123")


@pytest.mark.anyio
async def test_ingest_candidate_forwards_work_history(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-history-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": {
                "name": "Max Mustermann",
                "skills": ["Python"],
                "work_history": [
                    {
                        "employer": "ACME GmbH",
                        "position": "Senior Engineer",
                        "from_date": "2022-01",
                        "to_date": None,
                        "is_current": True,
                        "description": "Built data platforms",
                        "location": "Berlin",
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert profile_payload["work_history"][0]["employer"] == "ACME GmbH"
    assert profile_payload["work_history"][0]["position"] == "Senior Engineer"
    upsert_mock.assert_awaited_once()
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("cand-history-123")


@pytest.mark.anyio
async def test_ingest_candidate_forwards_education_history(app_module, api_client, monkeypatch):
    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-education-123")
    parse_mock = AsyncMock()
    embedding_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        json={
            "profile": {
                "name": "Max Mustermann",
                "skills": ["Python"],
                "education_history": [
                    {
                        "institution": "FHNW",
                        "degree": "Bachelor of Science",
                        "field_of_study": "Wirtschaftsinformatik",
                        "from_date": "2018-09",
                        "to_date": "2021-06",
                        "description": "BSc thesis in data engineering",
                    }
                ],
            },
        },
    )

    assert response.status_code == 200
    parse_mock.assert_not_awaited()
    assert embedding_mock.await_count == 2
    profile_payload = embedding_mock.await_args_list[0].args[0]
    assert profile_payload["education_history"][0]["institution"] == "FHNW"
    assert profile_payload["education_history"][0]["degree"] == "Bachelor of Science"
    upsert_mock.assert_awaited_once()
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("cand-education-123")


@pytest.mark.anyio
async def test_ingest_job_accepts_file_upload(app_module, api_client, monkeypatch):
    fake_profile = JobProfileExtraction(
        title="Senior Data Engineer",
        department="Analytics",
        location="Berlin",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="mandatory"),
            JobSkillExtraction(name="fastapi", importance="nice_to_have"),
        ],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "job-123")
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.9, 0.8, 0.7])
    postgres_mock = AsyncMock(return_value=42)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.postgres_store, "upsert_job", postgres_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_job", upsert_mock)

    response = await api_client.post(
        "/ingest/job",
        files={"file": ("job.txt", "Senior Data Engineer in Berlin with Python and SQL", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "job-123"
    assert payload["message"] == "Job ingested successfully"
    assert payload["profile"]["title"] == "Senior Data Engineer"
    assert payload["profile"]["company"] is None
    assert payload["profile"].get("recruiter_company") is None
    assert payload["profile"].get("employer_company") is None
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 4
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    skill_payloads = [call.args[0] for call in embedding_mock.await_args_list[1:]]
    assert {payload["name"] for payload in skill_payloads} == {"python", "sql", "fastapi"}
    assert all(payload["entity"] == "skill" for payload in skill_payloads)
    postgres_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()


@pytest.mark.anyio
async def test_vectormatch_uses_neo4j_skill_embeddings(app_module, api_client, monkeypatch):
    monkeypatch.setattr(
        app_module.llm_service,
        "create_embedding",
        AsyncMock(side_effect=lambda payload: [1.0, 0.0] if payload["name"] == "python" else [0.0, 1.0]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_jobs_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "job-1",
                "title": "Backend Engineer",
                "location": "Berlin",
                "required_skills": [
                    {"name": "python", "category": "HardSkill", "priority": "Mandatory", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "priority": "NiceToHave", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_candidates_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "cv-1",
                "name": "Max Mustermann",
                "location": "Berlin",
                "has_skill": [
                    {"name": "python", "category": "HardSkill", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )

    response = await api_client.post(
        "/match/vectormatch",
        json={"jobIds": ["job-1"], "cvIds": ["cv-1"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["type"] == "vectormatch"
    assert payload["matrix"][0]["jobId"] == "job-1"
    assert payload["matrix"][0]["candidateId"] == "cv-1"
    assert payload["matrix"][0]["score"] > 0
    assert payload["matrix"][0]["hardSkillScore"] == 1.0
    assert payload["matrix"][0]["softSkillScore"] == 1.0
    assert payload["matrix"][0]["matchedSkills"]
    assert payload["matrix"][0]["matchedSkills"][0]["jobSkillCategory"] in {"HardSkill", "SoftSkill"}
    assert payload["matrix"][0]["matchedSkills"][0]["candidateSkillCategory"] in {"HardSkill", "SoftSkill"}


@pytest.mark.anyio
async def test_vectormatch_neo4j_uses_neo4j_cosine_similarity(app_module, api_client, monkeypatch):
    monkeypatch.setattr(
        app_module.db_service,
        "get_jobs_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "job-neo4j-1",
                "title": "Backend Engineer",
                "required_skills": [
                    {"name": "python", "category": "HardSkill", "priority": "Mandatory", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "priority": "NiceToHave", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_candidates_for_vectormatch",
        AsyncMock(return_value=[
            {
                "id": "cv-neo4j-1",
                "name": "Max Mustermann",
                "has_skill": [
                    {"name": "python", "category": "HardSkill", "embedding": [1.0, 0.0]},
                    {"name": "communication", "category": "SoftSkill", "embedding": [0.0, 1.0]},
                ],
            }
        ]),
    )
    monkeypatch.setattr(
        app_module.db_service,
        "get_vectormatch_neo4j_rows",
        AsyncMock(return_value=[
            {
                "jobId": "job-neo4j-1",
                "jobTitle": "Backend Engineer",
                "candidateId": "cv-neo4j-1",
                "candidateName": "Max Mustermann",
                "score": 92,
                "vectorScore": 0.92,
                "hardSkillScore": 0.97,
                "softSkillScore": 0.84,
                "matchedSkills": [
                    {"jobSkill": "python", "jobSkillCategory": "HardSkill", "candidateSkill": "python", "candidateSkillCategory": "HardSkill", "similarity": 0.97, "priority": "Mandatory"},
                    {"jobSkill": "communication", "jobSkillCategory": "SoftSkill", "candidateSkill": "communication", "candidateSkillCategory": "SoftSkill", "similarity": 0.84, "priority": "NiceToHave"},
                ],
            }
        ]),
    )

    response = await api_client.post(
        "/match/vectormatch_neo4j",
        json={"jobIds": ["job-neo4j-1"], "cvIds": ["cv-neo4j-1"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["type"] == "vectormatch_neo4j"
    assert payload["matrix"][0]["jobId"] == "job-neo4j-1"
    assert payload["matrix"][0]["candidateId"] == "cv-neo4j-1"
    assert payload["matrix"][0]["score"] == 92
    assert payload["matrix"][0]["vectorScore"] == 0.92
    assert payload["matrix"][0]["hardSkillScore"] == 0.97
    assert payload["matrix"][0]["softSkillScore"] == 0.84
    assert payload["matrix"][0]["matchedSkills"][0]["similarity"] == 0.97


@pytest.mark.anyio
async def test_ingest_job_profile_overrides_parsed_title(app_module, api_client, monkeypatch):
    provided_profile = JobProfileExtraction(
        title="Senior Backend Engineer",
        location="Berlin",
        employment_type="Vollzeit",
    )
    parsed_profile = JobProfileExtraction(
        title="Wrong Parsed Title",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="mandatory"),
        ],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "job-profile-override-123")
    parse_mock = AsyncMock(return_value=parsed_profile)
    embedding_mock = AsyncMock(return_value=[0.9, 0.8, 0.7])
    postgres_mock = AsyncMock(return_value=43)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.postgres_store, "upsert_job", postgres_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_job", upsert_mock)

    response = await api_client.post(
        "/ingest/job",
        json={
            "raw_text": "Senior Backend Engineer needs Python and SQL",
            "profile": provided_profile.model_dump(),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["profile"]["title"] == "Senior Backend Engineer"
    assert payload["profile"]["location"] == "Berlin"
    assert payload["profile"]["required_skills"]
    assert any(skill["name"] == "python" for skill in payload["profile"]["required_skills"])
    parse_mock.assert_awaited_once()
    postgres_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()


@pytest.mark.anyio
async def test_add_job_accepts_plaintext_and_persists_to_postgres_and_neo4j(app_module, api_client, monkeypatch):
    fake_profile = JobProfileExtraction(
        title="Principal Data Engineer",
        company="ACME AG",
        location="Zürich",
        employment_type="Vollzeit",
        required_skills=[
            JobSkillExtraction(name="python", importance="mandatory"),
            JobSkillExtraction(name="sql", importance="nice_to_have"),
        ],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "job-add-123")
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.9, 0.8, 0.7])
    postgres_mock = AsyncMock(return_value=99)
    upsert_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_job_description", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.postgres_store, "upsert_job", postgres_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_job", upsert_mock)

    response = await api_client.post(
        "/add/job/",
        content=b"Principal Data Engineer at ACME AG in Zurich requires Python and SQL skills.",
        headers={"content-type": "text/plain"},
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["id"] == "job-add-123"
    assert payload["profile"]["title"] == "Principal Data Engineer"
    parse_mock.assert_awaited_once()
    postgres_mock.assert_awaited_once()
    upsert_mock.assert_awaited_once()


@pytest.mark.anyio
async def test_ingest_candidate_accepts_pdf_upload(app_module, api_client, monkeypatch):
    fake_profile = CandidateProfileExtraction(
        name="Lisa Beispiel",
        location="Munich",
        experience_years=8,
        skills=[CandidateSkillExtraction(name="python", experience_years=8)],
        preferred_roles=["ml engineer"],
    )

    monkeypatch.setattr(app_module, "uuid4", lambda: "cand-pdf-123")
    monkeypatch.setattr(
        app_module.pdf_service,
        "extract_text",
        lambda _: "Lisa Beispiel, 8 years experience in Python and ML engineering.",
    )
    parse_mock = AsyncMock(return_value=fake_profile)
    embedding_mock = AsyncMock(return_value=[0.4, 0.5, 0.6])
    upsert_mock = AsyncMock()
    anonymize_mock = AsyncMock()
    store_text_mock = AsyncMock()

    monkeypatch.setattr(app_module.llm_service, "parse_candidate_cv", parse_mock)
    monkeypatch.setattr(app_module.llm_service, "create_embedding", embedding_mock)
    monkeypatch.setattr(app_module.db_service, "upsert_candidate", upsert_mock)
    monkeypatch.setattr(app_module.postgres_store, "store_candidate_text", store_text_mock)
    monkeypatch.setattr(app_module.candidate_privacy_service, "anonymize_candidate", anonymize_mock)

    response = await api_client.post(
        "/ingest/candidate",
        files={"file": ("cv.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": "cand-pdf-123",
        "message": "Candidate ingested successfully",
    }
    parse_mock.assert_awaited_once()
    assert embedding_mock.await_count == 2
    assert embedding_mock.await_args_list[0].args == (fake_profile.model_dump(),)
    assert embedding_mock.await_args_list[1].args == ({"entity": "skill", "name": "python"},)
    upsert_mock.assert_awaited_once()
    store_text_mock.assert_awaited_once()
    anonymize_mock.assert_awaited_once_with("cand-pdf-123")


@pytest.mark.anyio
async def test_ingest_candidate_pdf_parse_error_returns_400(app_module, api_client, monkeypatch):
    monkeypatch.setattr(
        app_module.pdf_service,
        "extract_text",
        lambda _: (_ for _ in ()).throw(ValueError("Could not parse uploaded PDF file.")),
    )

    response = await api_client.post(
        "/ingest/candidate",
        files={"file": ("broken.pdf", b"not-a-real-pdf", "application/pdf")},
    )

    assert response.status_code == 400
    assert "Could not parse uploaded PDF file." in response.text


@pytest.mark.anyio
async def test_ingest_job_rejects_pdf_upload(api_client):
    response = await api_client.post(
        "/ingest/job",
        files={"file": ("job.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )

    assert response.status_code == 400
    assert "PDF upload is only supported for candidate CV ingestion." in response.text


@pytest.mark.anyio
async def test_ingest_candidate_returns_400_for_missing_input(api_client):
    response = await api_client.post("/ingest/candidate")

    assert response.status_code == 400
    assert "Provide either raw_text or a non-empty file" in response.text


@pytest.mark.anyio
async def test_match_returns_404_when_job_not_found(app_module, api_client, monkeypatch):
    get_job_profile_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(app_module.db_service, "get_job_profile", get_job_profile_mock)

    response = await api_client.post("/match/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.text


@pytest.mark.anyio
async def test_match_returns_empty_when_stage1_has_no_candidates(app_module, api_client, monkeypatch):
    get_job_profile_mock = AsyncMock(
        return_value={
            "id": "job-1",
            "title": "Data Engineer",
            "department": "Analytics",
            "location": "Berlin",
            "embedding": [0.1, 0.2],
            "required_skills": [{"name": "python", "importance": "mandatory"}],
        }
    )
    stage1_mock = AsyncMock(return_value=[])

    monkeypatch.setattr(app_module.db_service, "get_job_profile", get_job_profile_mock)
    monkeypatch.setattr(app_module.db_service, "stage1_filter_candidates", stage1_mock)

    response = await api_client.post("/match/job-1")

    assert response.status_code == 200
    assert response.json() == {
        "job_id": "job-1",
        "stage1_count": 0,
        "stage2_count": 0,
        "matches": [],
    }


@pytest.mark.anyio
async def test_match_successful_rerank_and_sorting(app_module, api_client, monkeypatch):
    get_job_profile_mock = AsyncMock(
        return_value={
            "id": "job-1",
            "title": "Data Engineer",
            "department": "Analytics",
            "location": "Berlin",
            "embedding": [0.1, 0.2],
            "required_skills": [
                {"name": "python", "importance": "mandatory"},
                {"name": "sql", "importance": "mandatory"},
            ],
        }
    )
    stage1_mock = AsyncMock(
        return_value=[
            Stage1Candidate(id="cand-a", mandatory_overlap=2, role_overlap=1, location_match=True),
            Stage1Candidate(id="cand-b", mandatory_overlap=1, role_overlap=0, location_match=False),
        ]
    )
    stage2_mock = AsyncMock(
        return_value=[
            Stage2Candidate(
                id="cand-a",
                name="Alice",
                location="Berlin",
                experience_years=7,
                skills=["python", "sql"],
                preferred_roles=["data engineer"],
                vector_score=0.91,
                jaccard_score=1.0,
                combined_score=0.937,
            ),
            Stage2Candidate(
                id="cand-b",
                name="Bob",
                location="Hamburg",
                experience_years=5,
                skills=["python"],
                preferred_roles=["backend engineer"],
                vector_score=0.82,
                jaccard_score=0.5,
                combined_score=0.724,
            ),
        ]
    )
    rerank_mock = AsyncMock(
        return_value=LLMRerankResponse(
            ranked_candidates=[
                LLMRerankItem(
                    candidate_id="cand-b",
                    score=82,
                    explanation="Strong Python background and relevant backend work. Needs ramp-up on SQL depth.",
                ),
                LLMRerankItem(
                    candidate_id="cand-a",
                    score=94,
                    explanation="Excellent overlap with required skills and domain context. Location and role fit are strong.",
                ),
            ]
        )
    )

    monkeypatch.setattr(app_module.db_service, "get_job_profile", get_job_profile_mock)
    monkeypatch.setattr(app_module.db_service, "stage1_filter_candidates", stage1_mock)
    monkeypatch.setattr(app_module.db_service, "stage2_rank_candidates", stage2_mock)
    monkeypatch.setattr(app_module.llm_service, "rerank_candidates", rerank_mock)

    response = await api_client.post("/match/job-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["job_id"] == "job-1"
    assert payload["stage1_count"] == 2
    assert payload["stage2_count"] == 2
    assert [item["candidate_id"] for item in payload["matches"]] == ["cand-a", "cand-b"]
    assert payload["matches"][0]["score"] == 94
    assert payload["matches"][1]["score"] == 82
    rerank_mock.assert_awaited_once()
