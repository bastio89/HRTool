from __future__ import annotations

import pytest

from services.prompt_service import PromptService


class DummyStore:
    def __init__(self) -> None:
        self.prompts = [
            {
                "id": 1,
                "key": "welcome",
                "template": "Hello {{name}} from {{company}}",
                "description": "Greeting",
                "model_parameters": {"temperature": 0.2},
                "version": 1,
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
        ]
        self.list_calls = 0
        self.update_calls = 0

    async def list_prompts(self):
        self.list_calls += 1
        return [dict(item) for item in self.prompts]

    async def get_prompt_by_id(self, prompt_id):
        for prompt in self.prompts:
            if prompt["id"] == prompt_id:
                return dict(prompt)
        return None

    async def update_prompt(self, prompt_id, *, template, description, model_parameters):
        self.update_calls += 1
        for prompt in self.prompts:
            if prompt["id"] == prompt_id:
                prompt.update({
                    "template": template,
                    "description": description,
                    "model_parameters": model_parameters,
                    "version": prompt["version"] + 1,
                    "updated_at": "2026-01-02T00:00:00Z",
                })
                return dict(prompt)
        return None


@pytest.mark.anyio
async def test_prompt_service_renders_and_caches_prompts() -> None:
    store = DummyStore()
    service = PromptService(store, ttl_seconds=60)

    rendered = await service.get_prompt("welcome", {"name": "Ada", "company": "HRTool"})

    assert rendered == "Hello Ada from HRTool"
    assert store.list_calls == 1

    rendered_again = await service.get_prompt("welcome", {"name": "Bea", "company": "HRTool"})

    assert rendered_again == "Hello Bea from HRTool"
    assert store.list_calls == 1


@pytest.mark.anyio
async def test_prompt_service_update_invalidates_cache() -> None:
    store = DummyStore()
    service = PromptService(store, ttl_seconds=60)

    await service.get_prompt("welcome", {"name": "Ada", "company": "HRTool"})
    updated = await service.update_prompt(
        1,
        template="Welcome {{name}}",
        description="Greeting",
        model_parameters={"temperature": 0.5},
    )

    assert updated["version"] == 2
    assert store.update_calls == 1

    rendered = await service.get_prompt("welcome", {"name": "Ada"})

    assert rendered == "Welcome Ada"
    assert store.list_calls == 2