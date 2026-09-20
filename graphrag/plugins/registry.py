from __future__ import annotations

from config import Settings

from .billing import BillingPlugin
from .jobs_ch import JobsChPlugin
from .linkedin import LinkedInPlugin
from .base import BasePlugin
from services.db import Neo4jService
from services.postgres_store import PostgresStore
from services.llm import LLMService


def build_plugins(settings: Settings, postgres_store: PostgresStore, llm_service: LLMService, db_service: Neo4jService) -> list[BasePlugin]:
    return [
        BillingPlugin(settings=settings, postgres_store=postgres_store),
        JobsChPlugin(settings=settings, postgres_store=postgres_store, llm_service=llm_service, db_service=db_service),
        LinkedInPlugin(settings=settings, postgres_store=postgres_store),
    ]
