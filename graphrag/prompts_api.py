from __future__ import annotations

from fastapi import APIRouter, HTTPException

from models import PromptDetail, PromptListItem, PromptUpdateRequest
from services.prompt_service import PromptService


def create_prompts_router(prompt_service: PromptService) -> APIRouter:
    router = APIRouter(prefix="/prompts", tags=["Prompts"])

    @router.get("", response_model=list[PromptListItem])
    async def list_prompts() -> list[dict[str, object]]:
        return await prompt_service.list_prompts()

    @router.get("/{prompt_id}", response_model=PromptDetail)
    async def get_prompt(prompt_id: int) -> dict[str, object]:
        try:
            return await prompt_service.get_prompt_by_id(prompt_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.put("/{prompt_id}", response_model=PromptDetail)
    async def update_prompt(prompt_id: int, payload: PromptUpdateRequest) -> dict[str, object]:
        try:
            return await prompt_service.update_prompt(
                prompt_id,
                template=payload.template,
                description=payload.description,
                model_parameters=payload.model_parameters,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return router