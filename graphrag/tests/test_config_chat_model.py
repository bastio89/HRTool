from __future__ import annotations

import importlib


def _reload_config_module():
    import config

    return importlib.reload(config)


def test_resolved_chat_model_prefers_database_setting(monkeypatch):
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")

    config = _reload_config_module()
    monkeypatch.setattr(
        config.Settings,
        "_backend_setting",
        lambda self, key: "db-chat-model" if key == "ai_model" else None,
    )

    assert config.settings.resolved_chat_model == "db-chat-model"


def test_resolved_chat_model_returns_empty_string_without_database_value(monkeypatch):
    monkeypatch.setenv("NEO4J_URI", "bolt://localhost:7687")
    monkeypatch.setenv("NEO4J_USER", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "test-password")

    config = _reload_config_module()
    monkeypatch.setattr(
        config.Settings,
        "_backend_setting",
        lambda self, key: None,
    )

    assert config.settings.resolved_chat_model == ""