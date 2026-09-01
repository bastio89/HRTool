from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers import health, jobs, candidates


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="Python replacement backend for the HRTool platform.",
        debug=settings.DEBUG,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=settings.API_PREFIX)
    app.include_router(jobs.router, prefix=settings.API_PREFIX)
    app.include_router(candidates.router, prefix=settings.API_PREFIX)

    @app.on_event("startup")
    def startup() -> None:
        init_db()

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend_new.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
