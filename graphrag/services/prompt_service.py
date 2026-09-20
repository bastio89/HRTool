from __future__ import annotations

import json
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from services.postgres_store import PostgresStore


@dataclass(frozen=True)
class PromptCache:
    items: list[dict[str, Any]]
    expires_at: float


class PromptService:
    def __init__(self, postgres_store: PostgresStore, ttl_seconds: float = 30.0) -> None:
        self._postgres_store = postgres_store
        self._ttl_seconds = max(1.0, float(ttl_seconds))
        self._cache: PromptCache | None = None

    def invalidate(self) -> None:
        self._cache = None

    @staticmethod
    def _stringify_value(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    @classmethod
    def render_template(cls, template: str, variables: Mapping[str, Any] | None = None) -> str:
        values = dict(variables or {})

        def replace(match: re.Match[str]) -> str:
            key = match.group(1).strip()
            return cls._stringify_value(values.get(key))

        return re.sub(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", replace, template)

    async def _load_prompts(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        if self._cache and self._cache.expires_at > now:
            return self._cache.items

        prompts = await self._postgres_store.list_prompts()
        self._cache = PromptCache(items=prompts, expires_at=now + self._ttl_seconds)
        return prompts

    async def list_prompts(self) -> list[dict[str, Any]]:
        return list(await self._load_prompts())

    async def get_prompt_record(self, prompt_key: str) -> dict[str, Any]:
        key = str(prompt_key or "").strip()
        if not key:
            raise KeyError("Prompt key is required")
        prompts = await self._load_prompts()
        for prompt in prompts:
            if str(prompt.get("key") or "").strip() == key:
                return dict(prompt)
        raise KeyError(f"Prompt not found: {key}")

    async def get_prompt(self, prompt_key: str, variables: Mapping[str, Any] | None = None) -> str:
        prompt = await self.get_prompt_record(prompt_key)
        template = str(prompt.get("template") or "")
        return self.render_template(template, variables)

    async def get_prompt_by_id(self, prompt_id: int) -> dict[str, Any]:
        prompt = await self._postgres_store.get_prompt_by_id(prompt_id)
        if not prompt:
            raise KeyError(f"Prompt not found: {prompt_id}")
        return prompt

    async def update_prompt(
        self,
        prompt_id: int,
        *,
        template: str,
        description: str | None,
        model_parameters: dict[str, Any],
    ) -> dict[str, Any]:
        updated = await self._postgres_store.update_prompt(
            prompt_id,
            template=template,
            description=description,
            model_parameters=model_parameters,
        )
        if not updated:
            raise KeyError(f"Prompt not found: {prompt_id}")
        self.invalidate()
        return updated