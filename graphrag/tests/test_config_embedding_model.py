from __future__ import annotations

import importlib
import os


def _reload_config_module():
    import config

    return importlib.reload(config)


def test_resolved_embedding_model_prefers_database_setting(monkeypatch):
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")

    config = _reload_config_module()
    monkeypatch.setattr(
        config.Settings,
        "_backend_setting",
        lambda self, key: "db-embedding-model" if key == "ai_embedding_model" else None,
    )

    assert config.settings.resolved_embedding_model == "db-embedding-model"


def test_resolved_embedding_model_returns_default_without_database_value(monkeypatch):
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")

    config = _reload_config_module()
    monkeypatch.setattr(
        config.Settings,
        "_backend_setting",
        lambda self, key: None,
    )

    assert config.settings.resolved_embedding_model == ""


def test_initial_embedding_model_reads_environment(monkeypatch):
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")
    monkeypatch.setenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")

    config = _reload_config_module()

    assert config.settings.initial_embedding_model == "nomic-embed-text"