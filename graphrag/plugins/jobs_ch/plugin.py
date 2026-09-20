from __future__ import annotations

import os

from fastapi import FastAPI

from config import Settings
from services.db import Neo4jService
from services.llm import LLMService
from services.postgres_store import PostgresStore

from ..base import BasePlugin, PluginManifest
from .manifest import build_jobs_ch_manifest
from .router import build_jobs_ch_router
from .settings import default_enabled


class JobsChPlugin(BasePlugin):
    def __init__(self, settings: Settings, postgres_store: PostgresStore, llm_service: LLMService, db_service: Neo4jService) -> None:
        self.settings = settings
        self.postgres_store = postgres_store
        self.llm_service = llm_service
        self.db_service = db_service
        self._router = build_jobs_ch_router(
            settings,
            llm_service=self.llm_service,
            postgres_store=self.postgres_store,
            db_service=self.db_service,
        )

    @property
    def manifest(self) -> PluginManifest:
        return build_jobs_ch_manifest(self.is_enabled())

    def is_enabled(self) -> bool:
        raw = os.environ.get("JOBS_CH_PLUGIN_ENABLED")
        if raw is None:
            return default_enabled()
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    def register(self, app: FastAPI) -> None:
        app.include_router(self._router)
