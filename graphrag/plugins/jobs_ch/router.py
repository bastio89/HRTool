from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from config import Settings
from services.db import Neo4jService
from services.llm import LLMService
from services.postgres_store import PostgresStore

from .schemas import JobsChExportRequest, JobsChImportRequest
from .service import JobsChExportService, JobsChImportService
from .settings import is_enabled


def build_jobs_ch_router(settings: Settings, *, llm_service: LLMService, postgres_store: PostgresStore, db_service: Neo4jService) -> APIRouter:
    router = APIRouter(prefix="/plugins/jobs_ch", tags=["Jobs.ch"])
    export_service = JobsChExportService()
    import_service = JobsChImportService(llm_service=llm_service, postgres_store=postgres_store, db_service=db_service)

    async def ensure_enabled() -> None:
        if not await is_enabled(settings.database_url):
            raise HTTPException(status_code=404, detail="Jobs.ch plugin is disabled")

    @router.get("/")
    async def manifest() -> dict[str, object]:
        return {
            "id": "jobs_ch",
            "name": "Jobs.ch",
            "enabled": await is_enabled(settings.database_url),
            "uiSlots": ["sidebar", "tools", "routes"],
            "routes": ["/tools/jobs-ch", "/plugins/jobs_ch/export-pdf"],
        }

    @router.post("/export-pdf")
    async def export_pdfs(request: JobsChExportRequest):
        await ensure_enabled()
        try:
            result = export_service.export(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"jobs.ch-Export fehlgeschlagen: {exc}") from exc

        headers = {"Content-Disposition": f'attachment; filename="{result.filename}"'}
        if result.warning:
            headers["X-HRTool-JobsCh-Warning"] = result.warning
        return Response(content=result.payload, media_type="application/zip", headers=headers)

    @router.post("/import-db")
    async def import_to_database(request: JobsChImportRequest):
        await ensure_enabled()
        try:
            result = await import_service.import_links(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"jobs.ch-Import fehlgeschlagen: {exc}") from exc

        response = {
            "imported": result.imported,
            "failed": result.failed,
            "warning": result.warning,
            "items": [item.model_dump() if hasattr(item, "model_dump") else item.__dict__ for item in result.items],
        }
        return response

    return router
