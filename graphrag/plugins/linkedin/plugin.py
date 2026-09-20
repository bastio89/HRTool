from __future__ import annotations

import os

from fastapi import FastAPI

from config import Settings
from services.postgres_store import PostgresStore

from ..base import BasePlugin, PluginManifest
from .manifest import build_linkedin_manifest
from .router import build_linkedin_router
from .settings import default_enabled


class LinkedInPlugin(BasePlugin):
    def __init__(self, settings: Settings, postgres_store: PostgresStore) -> None:
        self.settings = settings
        self.postgres_store = postgres_store
        self._router = build_linkedin_router(settings, postgres_store)

    @property
    def manifest(self) -> PluginManifest:
        return build_linkedin_manifest(self.is_enabled())

    def is_enabled(self) -> bool:
        raw = os.environ.get("LINKEDIN_PLUGIN_ENABLED")
        if raw is None:
            return default_enabled()
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    def register(self, app: FastAPI) -> None:
        app.include_router(self._router)
