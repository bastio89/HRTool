from __future__ import annotations

import os


class Settings:
	APP_NAME = "HRTool Backend New"
	APP_VERSION = "0.1.0"
	DEBUG = os.getenv("BACKEND_NEW_DEBUG", "false").lower() == "true"
	HOST = os.getenv("BACKEND_NEW_HOST", "0.0.0.0")
	PORT = int(os.getenv("BACKEND_NEW_PORT", "8001"))
	DATABASE_URL = os.getenv(
		"DATABASE_URL",
		"postgresql://hrtool:hrtoolpass@localhost:5432/hrtool",
	)
	CORS_ORIGINS = [
		origin.strip()
		for origin in os.getenv(
			"BACKEND_NEW_CORS_ORIGINS",
			"http://localhost:5173,http://127.0.0.1:5173",
		).split(",")
		if origin.strip()
	]
	JWT_SECRET = os.getenv("BACKEND_NEW_JWT_SECRET", "dev-secret-change-me")
	API_PREFIX = "/api"


settings = Settings()
