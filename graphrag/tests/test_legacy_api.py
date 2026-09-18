from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


@pytest.mark.anyio
async def test_legacy_health_endpoint(api_client):
	response = await api_client.get("/api/health")

	assert response.status_code == 200
	payload = response.json()
	assert payload["status"] == "ok"
	assert payload["app"] == "HR Graph Matching API"
	assert payload["version"] == "1.0.0"


@pytest.mark.anyio
async def test_legacy_job_routes_delegate_to_postgres_store(app_module, api_client, monkeypatch):
	list_mock = AsyncMock(
		return_value=[
			{
				"id": 1,
				"title": "Data Engineer",
				"company": "ACME",
				"location": "Zurich",
				"employment_type": "Vollzeit",
				"status": "open",
			}
		]
	)
	create_mock = AsyncMock(
		return_value={
			"id": 2,
			"title": "Platform Engineer",
			"company": "Example AG",
			"location": "Basel",
			"employment_type": "Teilzeit",
			"status": "open",
		}
	)

	monkeypatch.setattr(app_module.postgres_store, "list_compat_jobs", list_mock)
	monkeypatch.setattr(app_module.postgres_store, "create_compat_job", create_mock)

	response = await api_client.get("/api/jobs")

	assert response.status_code == 200
	assert response.json() == [
		{
			"id": 1,
			"title": "Data Engineer",
			"company": "ACME",
			"location": "Zurich",
			"employment_type": "Vollzeit",
			"status": "open",
		}
	]

	create_response = await api_client.post(
		"/api/jobs",
		json={"title": "Platform Engineer", "company": "Example AG", "location": "Basel"},
	)

	assert create_response.status_code == 201
	assert create_response.json() == {
		"id": 2,
		"title": "Platform Engineer",
		"company": "Example AG",
		"location": "Basel",
		"employment_type": "Teilzeit",
		"status": "open",
	}


@pytest.mark.anyio
async def test_legacy_candidate_routes_delegate_to_postgres_store(app_module, api_client, monkeypatch):
	list_mock = AsyncMock(
		return_value=[
			{
				"id": 1,
				"name": "Lina Beispiel",
				"email": "lina@example.com",
				"phone": "+41 79 000 00 00",
				"location": "Bern",
				"status": "new",
			}
		]
	)
	create_mock = AsyncMock(
		return_value={
			"id": 2,
			"name": "Max Beispiel",
			"email": "max@example.com",
			"phone": None,
			"location": "Zug",
			"status": "new",
		}
	)

	monkeypatch.setattr(app_module.postgres_store, "list_compat_candidates", list_mock)
	monkeypatch.setattr(app_module.postgres_store, "create_compat_candidate", create_mock)

	response = await api_client.get("/api/candidates")

	assert response.status_code == 200
	assert response.json() == [
		{
			"id": 1,
			"name": "Lina Beispiel",
			"email": "lina@example.com",
			"phone": "+41 79 000 00 00",
			"location": "Bern",
			"status": "new",
		}
	]

	create_response = await api_client.post(
		"/api/candidates",
		json={"name": "Max Beispiel", "email": "max@example.com", "location": "Zug"},
	)

	assert create_response.status_code == 201
	assert create_response.json() == {
		"id": 2,
		"name": "Max Beispiel",
		"email": "max@example.com",
		"phone": None,
		"location": "Zug",
		"status": "new",
	}


@pytest.mark.anyio
async def test_legacy_candidate_search_route_delegates_to_postgres_store(app_module, api_client, monkeypatch):
	search_mock = AsyncMock(
		return_value=[
			{
				"id": 7,
				"name": "Anna Müller",
				"email": "anna@example.com",
				"phone": None,
				"location": "Zürich",
				"status": "new",
			}
		]
	)

	monkeypatch.setattr(app_module.postgres_store, "search_compat_candidates", search_mock)

	response = await api_client.get("/api/candidates/search?search=graphQL&limit=10")

	assert response.status_code == 200
	assert response.json() == [
		{
			"id": 7,
			"name": "Anna Müller",
			"email": "anna@example.com",
			"phone": None,
			"location": "Zürich",
			"status": "new",
		}
	]


@pytest.mark.anyio
async def test_legacy_global_search_route_delegates_to_postgres_store(app_module, api_client, monkeypatch):
	search_mock = AsyncMock(
		return_value={
			"query": "react zürich",
			"jobs": [{"id": 1, "title": "Senior Frontend Engineer"}],
			"candidates": [{"id": 7, "name": "Anna Müller"}],
			"matchings": [{"id": 9, "job_title": "Senior Frontend Engineer"}],
			"total_jobs": 1,
			"total_candidates": 1,
			"total_matchings": 1,
		}
	)

	monkeypatch.setattr(app_module.postgres_store, "search_compat_global", search_mock)

	response = await api_client.get("/api/search?q=react zürich&limit=10")

	assert response.status_code == 200
	assert response.json() == {
		"query": "react zürich",
		"jobs": [{"id": 1, "title": "Senior Frontend Engineer"}],
		"candidates": [{"id": 7, "name": "Anna Müller"}],
		"matchings": [{"id": 9, "job_title": "Senior Frontend Engineer"}],
		"total_jobs": 1,
		"total_candidates": 1,
		"total_matchings": 1,
	}