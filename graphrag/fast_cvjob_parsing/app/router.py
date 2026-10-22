import logging
import os
from typing import TYPE_CHECKING

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from starlette.concurrency import run_in_threadpool

from .errors import InvalidPDFError
from .schemas import CVResponse, JobResponse

if TYPE_CHECKING:
    from .parser import ResumeJobParser

logger = logging.getLogger("resume_parser.api")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


def create_cv_job_parser_router() -> APIRouter:
    router = APIRouter(tags=["CV and Job Description Parser"])

    def get_parser(request: Request) -> "ResumeJobParser":
        parser = getattr(request.app.state, "cv_job_parser", None)
        if parser is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Parser model is not ready.",
            )
        return parser

    async def read_pdf(upload: UploadFile) -> bytes:
        try:
            if upload.content_type not in {"application/pdf", "application/octet-stream", None}:
                raise HTTPException(status_code=400, detail="Upload must be a PDF file.")
            content = await upload.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Uploaded PDF exceeds the size limit.")
            if not content:
                raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
            return content
        finally:
            await upload.close()

    @router.post("/api/v1/fast-parse/cv", response_model=CVResponse)
    async def parse_cv(request: Request, file: UploadFile = File(...)) -> CVResponse:
        pdf_bytes = await read_pdf(file)
        parser = get_parser(request)
        try:
            return await run_in_threadpool(parser.parse_cv, pdf_bytes)
        except InvalidPDFError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("CV parsing failed")
            raise HTTPException(status_code=500, detail="CV parsing failed.") from exc

    @router.post("/api/v1/fast-parse/job", response_model=JobResponse)
    async def parse_job(request: Request, file: UploadFile = File(...)) -> JobResponse:
        pdf_bytes = await read_pdf(file)
        parser = get_parser(request)
        try:
            return await run_in_threadpool(parser.parse_job, pdf_bytes)
        except InvalidPDFError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Job parsing failed")
            raise HTTPException(status_code=500, detail="Job parsing failed.") from exc

    @router.get("/healthz")
    async def healthz(request: Request) -> dict[str, object]:
        loaded = getattr(request.app.state, "cv_job_parser", None) is not None
        return {"status": "ok" if loaded else "not_ready", "model_loaded": loaded}

    return router