from __future__ import annotations

import importlib
import os
from collections.abc import AsyncIterator
from uuid import uuid4
from unittest.mock import AsyncMock

import psycopg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from services.postgres_store import PostgresStore

os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USER", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "test-password")
os.environ.setdefault("OLLAMA_BASE_URL", "http://localhost:11434")


@pytest_asyncio.fixture
async def app_module(monkeypatch):
    import main

    module = importlib.reload(main)
    yield module


@pytest_asyncio.fixture
async def api_client(app_module) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app_module.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def stored_matching_pair() -> AsyncIterator[tuple[PostgresStore, int, int]]:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL fuer isolierte PostgreSQL-Tests fehlt")
    store = PostgresStore(database_url)
    await store.ensure_schema()
    await store.ensure_matching_pair_schema()
    marker = f"matching-cache-{uuid4().hex}"
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        candidate = await (await connection.execute(
            "INSERT INTO candidates (name) VALUES (%s) RETURNING id", (marker,),
        )).fetchone()
        job = await (await connection.execute(
            "INSERT INTO jobs (title) VALUES (%s) RETURNING id", (marker,),
        )).fetchone()
    assert candidate is not None and job is not None
    try:
        yield store, int(candidate[0]), int(job[0])
    finally:
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            await connection.execute(
                """DELETE FROM matching_runs
                   WHERE (entity_type = 'candidate' AND entity_id = %s)
                      OR (entity_type = 'job' AND entity_id = %s)""",
                (candidate[0], job[0]),
            )
            await connection.execute("DELETE FROM candidate_texts WHERE candidate_id = %s", (str(candidate[0]),))
            await connection.execute("DELETE FROM candidates WHERE id = %s", (candidate[0],))
            await connection.execute("DELETE FROM jobs WHERE id = %s", (job[0],))


@pytest_asyncio.fixture
async def matching_actor(stored_matching_pair) -> AsyncIterator[int]:
    store, _, _ = stored_matching_pair
    async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
        row = await (await connection.execute(
            """INSERT INTO users (username, password_hash, display_name, role)
               VALUES (%s, 'test-only', 'Matching Test', 'recruiter') RETURNING id""",
            (f"matching-actor-{uuid4().hex}",),
        )).fetchone()
    assert row is not None
    try:
        yield int(row[0])
    finally:
        async with await psycopg.AsyncConnection.connect(store.database_url) as connection:
            await connection.execute("DELETE FROM matching_runs WHERE actor_user_id = %s", (row[0],))
            await connection.execute("DELETE FROM users WHERE id = %s", (row[0],))


@pytest_asyncio.fixture
async def import_expansion():
    from types import SimpleNamespace
    from services.matching_pipeline import MatchingImportWorker

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        pytest.skip("DATABASE_URL fuer isolierte PostgreSQL-Tests fehlt")
    schema = f"matching_expansion_{uuid4().hex}"
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute(psycopg.sql.SQL("CREATE SCHEMA {}").format(psycopg.sql.Identifier(schema)))
    scoped_url = psycopg.conninfo.make_conninfo(database_url, options=f"-csearch_path={schema}")
    store = PostgresStore(scoped_url)
    try:
        async with await psycopg.AsyncConnection.connect(scoped_url) as connection:
            for table in ("candidates", "candidate_work_history", "candidate_education", "matching_results"):
                await connection.execute(psycopg.sql.SQL("CREATE TABLE {} (LIKE public.{} INCLUDING ALL)").format(
                    psycopg.sql.Identifier(table), psycopg.sql.Identifier(table),
                ))
        await store.ensure_schema()
        await store.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(scoped_url) as connection:
            await connection.execute("INSERT INTO users (id, username, role) VALUES (1, 'import-test', 'recruiter')")

        async def add(kind, count=1):
            table, column = ("candidates", "name") if kind == "candidate" else ("jobs", "title")
            async with await psycopg.AsyncConnection.connect(scoped_url) as connection:
                return [row[0] for row in await (await connection.execute(
                    f"""INSERT INTO {table} ({column}, status)
                        SELECT %s || n::text, 'closed' FROM generate_series(1, %s) AS n RETURNING id""",
                    (f"unrelated-{uuid4()}-", count),
                )).fetchall()]

        async def enqueue(kind, entity_id):
            return await store.enqueue_matching_import(
                kind, entity_id, actor_user_id=1, source="expansion-test", event_key=str(uuid4()),
            )

        yield SimpleNamespace(store=store, worker=MatchingImportWorker(store), add=add, enqueue=enqueue)
    finally:
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            await connection.execute(
                psycopg.sql.SQL("DROP SCHEMA {} CASCADE").format(psycopg.sql.Identifier(schema)),
            )


@pytest_asyncio.fixture
async def import_worker(import_expansion, monkeypatch):
    import json
    import httpx
    from services.db import Neo4jService
    from services.llm import LLMService
    from services.matching_orchestrator import MatchingOrchestrator
    from services.model_config import ModelConfigService, ModelRuntimeConfig
    from services.skill_matching import SkillMatchingService

    env = import_expansion
    config = ModelConfigService(env.store)
    monkeypatch.setattr(config, "snapshot", AsyncMock(return_value=ModelRuntimeConfig(
        task="embedding", provider="openrouter", base_url="http://test/v1", model="worker-embedding", api_key="test-only",
    )))
    llm = LLMService("http://test/v1", "chat", "worker-embedding", 3, model_config_service=config)
    calls = []

    def respond(request):
        assert request.url.path.endswith("/embeddings"), "Automatic imports must never request AI matching"
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"embedding": [1.0, 0.0, 0.0]}]})

    await llm.client.aclose()
    llm.client = AsyncClient(transport=httpx.MockTransport(respond))
    db = object.__new__(Neo4jService)
    graphs = {"candidate": {}, "job": {}}
    monkeypatch.setattr(db, "get_esco_concepts_for_aliases", AsyncMock(return_value=[]))
    monkeypatch.setattr(db, "get_jobs_for_vectormatch", AsyncMock(
        side_effect=lambda ids: [graphs["job"][key] for key in ids if key in graphs["job"]],
    ))
    monkeypatch.setattr(db, "get_candidates_for_vectormatch", AsyncMock(
        side_effect=lambda ids: [graphs["candidate"][key] for key in ids if key in graphs["candidate"]],
    ))
    orchestrator = MatchingOrchestrator(SkillMatchingService(llm, db), postgres_store=env.store, llm_service=llm)

    async def create(kind, skills="Python"):
        entity_id, = await env.add(kind)
        table = "candidates" if kind == "candidate" else "jobs"
        async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
            await connection.execute(f"UPDATE {table} SET skills = %s WHERE id = %s", (skills, entity_id))
        return entity_id

    async def prepare(kind, entity_id):
        snapshot = await env.store.matching_source_snapshot(kind, entity_id)
        row = snapshot["row"]
        skills = [{"name": name.strip()} for name in (row["skills"] or "").split(",") if name.strip()]
        graphs[kind][row["uuid"]] = {
            "id": row["uuid"], **({"name": row["name"], "has_skill": skills} if kind == "candidate" else {
                "title": row["title"], "required_skills": skills,
            }),
        }
        return await env.store.confirm_matching_preparation(snapshot), 0

    env.prepare = AsyncMock(side_effect=prepare)

    async def process(run_id):
        return await env.worker.process(
            run_id, db_service=db, orchestrator=orchestrator,
            prepare_candidate=lambda entity_id: env.prepare("candidate", entity_id),
            prepare_job=lambda entity_id: env.prepare("job", entity_id),
        )

    async def start():
        await env.worker.start(
            db_service=db, orchestrator=orchestrator,
            prepare_candidate=lambda entity_id: env.prepare("candidate", entity_id),
            prepare_job=lambda entity_id: env.prepare("job", entity_id),
        )

    async with await psycopg.AsyncConnection.connect(env.store.database_url) as connection:
        await connection.execute("UPDATE users SET current_balance = 1.00 WHERE id = 1")
    env.create, env.process, env.db, env.llm, env.orchestrator = create, process, db, llm, orchestrator
    env.calls, env.graphs = calls, graphs
    env.start = start
    try:
        yield env
    finally:
        await env.worker.shutdown(timeout=0)
        await llm.close()
