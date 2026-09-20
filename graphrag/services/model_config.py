from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Literal

from services.postgres_store import PostgresStore

TaskName = Literal["chat", "embedding"]


@dataclass(frozen=True)
class ModelRuntimeConfig:
    task: TaskName
    provider: str
    base_url: str
    model: str
    api_key: str | None
    reasoning_level: str = "none"


class ModelConfigService:
    def __init__(
        self,
        postgres_store: PostgresStore,
        *,
        default_chat_base_url: str = "",
        default_chat_model: str = "",
        default_embedding_model: str = "",
        default_provider: str = "ollama",
        default_api_key: str | None = None,
        default_reasoning_level: str = "none",
        ttl_seconds: float = 30.0,
    ) -> None:
        self._postgres_store = postgres_store
        self._default_chat_base_url = default_chat_base_url.strip().rstrip("/")
        self._default_chat_model = default_chat_model.strip()
        self._default_embedding_model = default_embedding_model.strip()
        self._default_provider = default_provider.strip().lower() or "ollama"
        self._default_api_key = default_api_key
        self._default_reasoning_level = default_reasoning_level.strip().lower() or "none"
        self._ttl_seconds = max(1.0, float(ttl_seconds))
        self._cache: dict[TaskName, tuple[ModelRuntimeConfig, float]] = {}
        self._lock = asyncio.Lock()

    def invalidate(self, task: TaskName | None = None) -> None:
        if task is None:
            self._cache.clear()
            return
        self._cache.pop(task, None)

    async def get_chat_model(self) -> ModelRuntimeConfig:
        return await self._get_config("chat")

    async def get_embedding_model(self) -> ModelRuntimeConfig:
        return await self._get_config("embedding")

    async def _get_config(self, task: TaskName) -> ModelRuntimeConfig:
        now = time.monotonic()
        cached = self._cache.get(task)
        if cached and cached[1] > now:
            return cached[0]

        async with self._lock:
            now = time.monotonic()
            cached = self._cache.get(task)
            if cached and cached[1] > now:
                return cached[0]

            config = await self._load_config(task)
            self._cache[task] = (config, now + self._ttl_seconds)
            return config

    async def _load_config(self, task: TaskName) -> ModelRuntimeConfig:
        settings = await self._postgres_store.get_settings(
            [
                "ai_base_url",
                "ai_model",
                "ai_embedding_model",
                "ai_provider",
                "ai_api_key",
                "ai_reasoning_level",
            ]
        )
        base_url = self._normalize_base_url(settings.get("ai_base_url") or self._default_chat_base_url)
        provider = self._normalize_provider(settings.get("ai_provider") or self._default_provider, base_url)
        model_key = "ai_model" if task == "chat" else "ai_embedding_model"
        default_model = self._default_chat_model if task == "chat" else self._default_embedding_model
        model = (settings.get(model_key) or default_model).strip()
        api_key = (settings.get("ai_api_key") or self._default_api_key or None)
        reasoning_level = self._normalize_reasoning_level(settings.get("ai_reasoning_level") or self._default_reasoning_level)
        return ModelRuntimeConfig(
            task=task,
            provider=provider,
            base_url=base_url,
            model=model,
            api_key=api_key,
            reasoning_level=reasoning_level,
        )

    @staticmethod
    def _normalize_base_url(value: str) -> str:
        return str(value or "").strip().rstrip("/")

    @staticmethod
    def _normalize_reasoning_level(value: str) -> str:
        normalized = str(value or "").strip().lower()
        return normalized if normalized in {"none", "low", "medium", "high"} else "none"

    @staticmethod
    def _normalize_provider(value: str, base_url: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized in {"openai", "openrouter"}:
            return "openrouter"
        if normalized == "ollama":
            return "ollama"
        if "openrouter.ai" in base_url.lower():
            return "openrouter"
        return "ollama"
