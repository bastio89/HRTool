"""The API had no authentication while nginx proxied it to the internet.

These pin down which paths the shared key now guards: health checks and the
two routes the browser calls directly stay open, everything else - including
/candidates/deanon, /ingest and /match - requires the key.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.testclient import TestClient


def build_app(api_key: str | None):
    """Mirrors the middleware from main.py without booting the whole service."""
    app = FastAPI()
    OPEN_PATHS = {"/health", "/health/live", "/docs", "/openapi.json", "/redoc"}
    BROWSER_PATHS = {"/cv-parser/parse", "/linkedin/people-search.csv"}

    @app.middleware("http")
    async def require_api_key(request: Request, call_next):
        key = (api_key or "").strip()
        path = request.url.path.rstrip("/") or "/"
        if not key or path in OPEN_PATHS or path in BROWSER_PATHS:
            return await call_next(request)
        if request.headers.get("x-api-key") != key:
            return Response(content='{"detail":"x"}', status_code=401, media_type="application/json")
        return await call_next(request)

    for route in ["/health", "/health/live", "/cv-parser/parse",
                  "/linkedin/people-search.csv", "/candidates/deanon",
                  "/candidates/anon", "/ingest/candidate", "/ingest/job",
                  "/add/job/", "/match/7", "/linkedin/profile"]:
        app.add_api_route(route, lambda: {"ok": True}, methods=["GET"])
    return app


GUARDED = ["/candidates/deanon", "/candidates/anon", "/ingest/candidate",
           "/ingest/job", "/add/job/", "/match/7", "/linkedin/profile"]
OPEN = ["/health", "/health/live", "/cv-parser/parse", "/linkedin/people-search.csv"]


@pytest.mark.parametrize("path", GUARDED)
def test_guarded_paths_reject_without_key(path):
    client = TestClient(build_app("s3cret"))
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("path", GUARDED)
def test_guarded_paths_accept_with_key(path):
    client = TestClient(build_app("s3cret"))
    assert client.get(path, headers={"X-API-Key": "s3cret"}).status_code == 200


@pytest.mark.parametrize("path", OPEN)
def test_open_paths_stay_reachable(path):
    client = TestClient(build_app("s3cret"))
    assert client.get(path).status_code == 200


@pytest.mark.parametrize("path", GUARDED)
def test_without_configured_key_nothing_is_enforced(path):
    """Existing deployments keep working until the key is set on both sides."""
    client = TestClient(build_app(None))
    assert client.get(path).status_code == 200


def test_path_lists_match_the_real_service():
    """The app above mirrors main.py because importing main needs a live
    database. Guard against the two drifting apart."""
    import ast
    import pathlib

    source = pathlib.Path(__file__).resolve().parents[1] / "main.py"
    tree = ast.parse(source.read_text())
    found = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            name = getattr(node.targets[0], "id", None)
            if name in {"OPEN_PATHS", "BROWSER_PATHS"}:
                found[name] = set(ast.literal_eval(node.value))

    assert found["OPEN_PATHS"] == {"/health", "/health/live", "/docs", "/openapi.json", "/redoc"}
    assert found["BROWSER_PATHS"] == {"/cv-parser/parse", "/linkedin/people-search.csv"}
