from __future__ import annotations

import importlib
import os


def _reload_config_module():
    import config

    return importlib.reload(config)


def test_resolved_embedding_model_defaults_to_openai_when_provider_is_openrouter(monkeypatch):
    monkeypatch.delenv("AI_EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("BACKEND_DB_PATH", raising=False)
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")

    config = _reload_config_module()
    assert config.settings.resolved_embedding_model == "openai/text-embedding-3-small"


def test_resolved_embedding_model_uses_ollama_default_for_ollama_provider(monkeypatch):
    monkeypatch.delenv("AI_EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("BACKEND_DB_PATH", raising=False)
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")

    config = _reload_config_module()
    assert config.settings.resolved_embedding_model == config.settings.ollama_embedding_model