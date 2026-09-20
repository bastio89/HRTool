from __future__ import annotations

from config import Settings
from fastapi import FastAPI

from services.postgres_store import PostgresStore

from ..base import BasePlugin, PluginManifest, PluginRoute
from .router import build_billing_router
from .settings import PLUGIN_SETTING_KEY


class BillingPlugin(BasePlugin):
	def __init__(self, *, settings: Settings, postgres_store: PostgresStore) -> None:
		self.settings = settings
		self.postgres_store = postgres_store
		self._router = build_billing_router(settings, postgres_store=postgres_store)

	@property
	def manifest(self) -> PluginManifest:
		return PluginManifest(
			id='billing',
			name='Billing',
			enabled=True,
			ui_slots=('routes',),
			routes=(
				PluginRoute(path='/credits/me', methods=('GET',)),
				PluginRoute(path='/credits/admin/overview', methods=('GET',)),
				PluginRoute(path='/credits/admin/users', methods=('GET',)),
				PluginRoute(path='/credits/admin/users/{user_id}/transactions', methods=('GET',)),
				PluginRoute(path='/credits/admin/top-up', methods=('POST',)),
			),
		)

	def is_enabled(self) -> bool:
		raw = self.settings.database_url
		return bool(raw)

	def register(self, app: FastAPI) -> None:
		app.include_router(self._router)
