from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from config import Settings
from models import CandidateProfileExtraction
from services.linkedin_mcp import LinkedInMCPError, LinkedInMCPService
from services.linkedin_people_search import LinkedInPeopleSearchService
from services.postgres_store import PostgresStore
from plugins.billing.service import BillingService

from .schemas import LinkedInExportRequest, LinkedInPeopleSearchRequest, LinkedInProfileRequest, LinkedInProfileResponse
from .service import LinkedInExportService
from .settings import is_enabled


def build_linkedin_router(settings: Settings, postgres_store: PostgresStore) -> APIRouter:
    router = APIRouter(prefix="/plugins/linkedin", tags=["LinkedIn"])
    linkedin_mcp_service = LinkedInMCPService.from_settings(settings)
    linkedin_people_search_service = LinkedInPeopleSearchService()
    export_service = LinkedInExportService(settings.resolved_apify_token)
    billing_service = BillingService(postgres_store)

    async def ensure_enabled() -> None:
        if not await is_enabled(settings.database_url):
            raise HTTPException(status_code=404, detail="LinkedIn plugin is disabled")

    @router.get("/")
    async def manifest() -> dict[str, object]:
        return {
            "id": "linkedin",
            "name": "LinkedIn",
            "enabled": await is_enabled(settings.database_url),
            "uiSlots": ["sidebar", "tools", "routes"],
            "routes": [
                "/tools/linkedin",
                "/plugins/linkedin/profile",
                "/plugins/linkedin/people-search.csv",
                "/plugins/linkedin/export-pdf",
            ],
        }

    @router.post("/profile", response_model=LinkedInProfileResponse)
    async def linkedin_profile(request: LinkedInProfileRequest, http_request: Request) -> LinkedInProfileResponse:
        await ensure_enabled()
        if not linkedin_mcp_service.is_configured:
            raise HTTPException(
                status_code=503,
                detail="APIFY_LINKEDIN_MCP_COMMAND is not configured.",
            )
        try:
            await billing_service.charge(http_request, '-1.00', 'LINKEDIN_CALL', note='linkedin profile')
            profile = await linkedin_mcp_service.extract_profile(request.url)
        except LinkedInMCPError as exc:
            raise HTTPException(status_code=502, detail=f"LinkedIn MCP extraction failed: {exc}") from exc
        return LinkedInProfileResponse(source_url=request.url, tool_name="extract_profile", profile=profile)

    @router.post("/people-search.csv")
    async def linkedin_people_search_csv(request: LinkedInPeopleSearchRequest, http_request: Request):
        await ensure_enabled()
        if not linkedin_people_search_service.is_configured:
            raise HTTPException(status_code=503, detail="APIFY_TOKEN is not configured.")
        try:
            await billing_service.charge(http_request, '-1.00', 'LINKEDIN_CALL', note='linkedin people search')
            filename, csv_text = linkedin_people_search_service.export_csv(request.model_dump(by_alias=True, exclude_none=True))
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"LinkedIn people search failed: {exc}") from exc
        return Response(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @router.post("/export-pdf")
    async def linkedin_export_pdf(request: LinkedInExportRequest, http_request: Request):
        await ensure_enabled()
        try:
            await billing_service.charge(http_request, '-1.00', 'LINKEDIN_CALL', note='linkedin export pdf')
            result = await export_service.export(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"PDF-Export fehlgeschlagen: {exc}") from exc
        headers = {"Content-Disposition": f'attachment; filename="{result.filename}"'}
        if result.warning:
            headers["X-HRTool-LinkedIn-Warning"] = result.warning
        return Response(content=result.payload, media_type="application/zip", headers=headers)

    return router
