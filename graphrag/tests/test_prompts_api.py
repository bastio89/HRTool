from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from prompts_api import create_prompts_router


class DummyPromptService:
    def __init__(self) -> None:
        self.prompts = [
            {
                "id": 1,
                "key": "welcome",
                "template": "Hello {{name}}",
                "description": "Greeting",
                "model_parameters": {"temperature": 0.2},
                "version": 1,
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
        ]

    async def list_prompts(self):
        return [dict(prompt) for prompt in self.prompts]

    async def get_prompt_by_id(self, prompt_id):
        for prompt in self.prompts:
            if prompt["id"] == prompt_id:
                return dict(prompt)
        raise KeyError(prompt_id)

    async def update_prompt(self, prompt_id, *, template, description, model_parameters):
        prompt = await self.get_prompt_by_id(prompt_id)
        prompt.update({
            "template": template,
            "description": description,
            "model_parameters": model_parameters,
            "version": prompt["version"] + 1,
            "updated_at": "2026-01-02T00:00:00Z",
        })
        self.prompts = [prompt if item["id"] == prompt_id else item for item in self.prompts]
        return prompt


def test_prompts_router_lists_reads_and_updates_prompts():
    app = FastAPI()
    service = DummyPromptService()
    app.include_router(create_prompts_router(service))
    client = TestClient(app)

    response = client.get("/prompts")
    assert response.status_code == 200
    assert response.json()[0]["key"] == "welcome"

    detail = client.get("/prompts/1")
    assert detail.status_code == 200
    assert detail.json()["template"] == "Hello {{name}}"

    updated = client.put("/prompts/1", json={"template": "Hi {{name}}", "description": "Greeting", "model_parameters": {"temperature": 0.5}})
    assert updated.status_code == 200
    assert updated.json()["template"] == "Hi {{name}}"
    assert updated.json()["version"] == 2