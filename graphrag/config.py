import os
from urllib.parse import urlsplit, urlunsplit

import psycopg
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_AI_BASE_URL = "http://host.docker.internal:11434"
DEFAULT_AI_PROVIDER = "ollama"
DEFAULT_AI_MODEL = "qwen3.8:27b-mlx"
DEFAULT_AI_EMBEDDING_MODEL = "qwen3-embedding:4b"
DEFAULT_AI_REASONING_LEVEL = "none"


class Settings(BaseSettings):
    neo4j_uri: str
    neo4j_user: str = "neo4j"
    neo4j_password: str
    database_url: str = "postgresql://hrtool:hrtoolpass@localhost:5432/hrtool"
    enable_parse_latency_aggregation: bool = False
    parse_latency_window_size: int = 200
    parse_latency_log_every: int = 20

    apify_linkedin_mcp_command: str | None = None
    apify_linkedin_mcp_search_tool_name: str = "search_profiles"

    # Embedding dimensions persisted in Neo4j vector index.
    embedding_dimensions: int = 1536

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def resolved_ai_base_url(self) -> str:
        return (self._backend_setting("ai_base_url") or DEFAULT_AI_BASE_URL).rstrip("/")

    def _backend_database_url(self) -> str:
        parsed = urlsplit(self.database_url)
        in_docker = os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv") or os.environ.get("DOCKER_CONTAINER") == "true"
        if parsed.hostname == "postgres" and not in_docker:
            return urlunsplit((parsed.scheme, parsed.netloc.replace("postgres", "localhost", 1), parsed.path, parsed.query, parsed.fragment))
        return self.database_url

    def _backend_setting(self, key: str) -> str | None:
        try:
            with psycopg.connect(self._backend_database_url()) as connection:
                row = connection.execute("SELECT value FROM settings WHERE key = %s", (key,)).fetchone()
            return row[0].strip() if row and isinstance(row[0], str) and row[0].strip() else None
        except psycopg.Error:
            return None

    @property
    def resolved_provider(self) -> str:
        provider = self._backend_setting("ai_provider") or DEFAULT_AI_PROVIDER
        return "openrouter" if provider.strip().lower() == "openai" else provider.strip().lower()

    @property
    def resolved_api_key(self) -> str | None:
        return self._backend_setting("ai_api_key")

    @property
    def resolved_apify_token(self) -> str | None:
        return os.environ.get("APIFY_TOKEN") or self._backend_setting("apify_token")

    @property
    def resolved_chat_model(self) -> str:
        return self._backend_setting("ai_model") or DEFAULT_AI_MODEL

    @property
    def resolved_embedding_model(self) -> str:
        return self._backend_setting("ai_embedding_model") or DEFAULT_AI_EMBEDDING_MODEL

    @property
    def resolved_reasoning_level(self) -> str:
        try:
            with psycopg.connect(self._backend_database_url()) as connection:
                row = connection.execute("SELECT value FROM settings WHERE key = %s", ("ai_reasoning_level",)).fetchone()
            level = row[0].strip().lower() if row and isinstance(row[0], str) else None
        except psycopg.Error:
            level = None
        level = level or DEFAULT_AI_REASONING_LEVEL
        if level in {"none", "low", "medium", "high"}:
            return level
        return DEFAULT_AI_REASONING_LEVEL


def _seed_default_ai_settings(database_url: str) -> None:
    try:
        parsed = urlsplit(database_url)
        if parsed.hostname == "postgres":
            database_url = urlunsplit((parsed.scheme, parsed.netloc.replace("postgres", "localhost", 1), parsed.path, parsed.query, parsed.fragment))
        with psycopg.connect(database_url) as connection:
            for key, value in (
                ("ai_base_url", DEFAULT_AI_BASE_URL),
                ("ai_provider", DEFAULT_AI_PROVIDER),
                ("ai_model", DEFAULT_AI_MODEL),
                ("ai_reasoning_level", DEFAULT_AI_REASONING_LEVEL),
            ):
                connection.execute(
                    "INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                    (key, value),
                )
            connection.execute(
                """
                UPDATE settings
                SET value = %s
                WHERE key = %s
                  AND value IN (%s, %s, %s)
                """,
                (
                    DEFAULT_AI_BASE_URL,
                    "ai_base_url",
                    "http://localhost:11434",
                    "http://127.0.0.1:11434",
                    "http://localhost:8000",
                ),
            )
            connection.execute(
                """
                INSERT INTO settings (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                WHERE settings.value = %s
                """,
                ("ai_embedding_model", DEFAULT_AI_EMBEDDING_MODEL, "nomic-embed-text"),
            )
    except psycopg.Error:
        return


settings = Settings()
_seed_default_ai_settings(settings.database_url)
