import logging
import os

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from starlette.concurrency import run_in_threadpool

from .errors import InvalidPDFError
from .schemas import CVResponse, JobResponse

logger = logging.getLogger(__name__)
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


def _get_parser(request: Request):
    parser = getattr(request.app.state, "cv_job_parser", None)
    if parser is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Parser model is not ready.")
    return parser


async def _read_pdf(upload: UploadFile) -> bytes:
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


async def parse_cv_bytes(parser, pdf_bytes: bytes) -> CVResponse:
    return await run_in_threadpool(parser.parse_cv, pdf_bytes)


def create_cv_job_parser_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/parse", tags=["CV and Job Parser"])

    @router.post("/cv", response_model=CVResponse)
    async def parse_cv(request: Request, file: UploadFile = File(...)) -> CVResponse:
        pdf_bytes = await _read_pdf(file)
        parser = _get_parser(request)
        try:
            return await parse_cv_bytes(parser, pdf_bytes)
        except InvalidPDFError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("CV parsing failed")
            raise HTTPException(status_code=500, detail="CV parsing failed.") from exc

    @router.post("/job", response_model=JobResponse)
    async def parse_job(request: Request, file: UploadFile = File(...)) -> JobResponse:
        pdf_bytes = await _read_pdf(file)
        parser = _get_parser(request)
        try:
            return await run_in_threadpool(parser.parse_job, pdf_bytes)
        except InvalidPDFError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Job parsing failed")
            raise HTTPException(status_code=500, detail="Job parsing failed.") from exc

    return router