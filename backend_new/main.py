from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers import candidates, health, jobs


@asynccontextmanager
async def lifespan(_: FastAPI):
	init_db()
	yield


def create_app() -> FastAPI:
	app = FastAPI(
		title=settings.APP_NAME,
		version=settings.APP_VERSION,
		description="Python replacement backend for the HRTool platform.",
		debug=settings.DEBUG,
		lifespan=lifespan,
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
	return app


app = create_app()
