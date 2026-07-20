from __future__ import annotations

import importlib
import os
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient


os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USER", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "test-password")
os.environ.setdefault("OLLAMA_BASE_URL", "http://localhost:11434")
os.environ.setdefault("OLLAMA_CHAT_MODEL", "qwen3.6:35b")
os.environ.setdefault("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")


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
