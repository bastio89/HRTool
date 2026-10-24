import logging
import os
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.parser import InvalidPDFError, ResumeJobParser
from app.schemas import CVResponse, JobResponse

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("resume_parser.api")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    model_name = os.getenv("GLINER_MODEL", "urchade/gliner_multi-v2.1")
    logger.info("Loading GLiNER model %s", model_name)
    try:
        app.state.parser = ResumeJobParser.load()
    except Exception:
        logger.exception("Unable to load GLiNER model")
        raise
    yield
    app.state.parser = None


app = FastAPI(title="CV and Job Description Parser", version="1.0.0", lifespan=lifespan)

cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials="*" not in cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_request_latency(request: Request, call_next):
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Request failed method=%s path=%s", request.method, request.url.path)
        raise
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    logger.info(
        "Request completed method=%s path=%s status=%s latency_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
    return response


def _get_parser(request: Request) -> ResumeJobParser:
    parser = getattr(request.app.state, "parser", None)
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


@app.post("/api/v1/parse/cv", response_model=CVResponse)
async def parse_cv(request: Request, file: UploadFile = File(...)) -> CVResponse:
    pdf_bytes = await _read_pdf(file)
    parser = _get_parser(request)
    try:
        return await run_in_threadpool(parser.parse_cv, pdf_bytes)
    except InvalidPDFError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("CV parsing failed")
        raise HTTPException(status_code=500, detail="CV parsing failed.") from exc


@app.post("/api/v1/parse/job", response_model=JobResponse)
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


@app.get("/healthz")
async def healthz(request: Request) -> dict:
    loaded = getattr(request.app.state, "parser", None) is not None
    return {"status": "ok" if loaded else "not_ready", "model_loaded": loaded}