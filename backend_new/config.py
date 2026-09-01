from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings:
    APP_NAME: str = "HRTool Backend New"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = os.getenv("BACKEND_NEW_DEBUG", "false").lower() == "true"
    HOST: str = os.getenv("BACKEND_NEW_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("BACKEND_NEW_PORT", "8000"))

    DATABASE_PATH: str = os.getenv(
        "BACKEND_NEW_DB_PATH",
        str(BASE_DIR / "data" / "backend_new.db"),
    )
    DATABASE_URL: str = os.getenv(
        "BACKEND_NEW_DATABASE_URL",
        os.getenv(
            "DATABASE_URL",
            "postgresql://hrtool:hrtoolpass@localhost:5432/hrtool",
        ),
    )

    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("BACKEND_NEW_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ]

    JWT_SECRET: str = os.getenv("BACKEND_NEW_JWT_SECRET", "dev-secret-change-me")
    API_PREFIX: str = "/api"


settings = Settings()
