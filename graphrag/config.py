import psycopg
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    neo4j_uri: str
    neo4j_user: str = "neo4j"
    neo4j_password: str
    ai_provider: str | None = None
    ai_base_url: str | None = None
    openrouter_api_key: str | None = None
    database_url: str = "postgresql://hrtool:hrtoolpass@localhost:5432/hrtool"
    ai_chat_model: str | None = None
    ai_embedding_model: str | None = None
    ollama_base_url: str = "http://localhost:11434"
    ollama_chat_model: str = "qwen3.6:35b"
    ollama_embedding_model: str = "qwen3-embedding:4b"
    ollama_enable_reasoning: bool = True
    enable_parse_latency_aggregation: bool = False
    parse_latency_window_size: int = 200
    parse_latency_log_every: int = 20

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
        provider = self.resolved_provider
        if provider == "openrouter":
            default_base_url = "https://openrouter.ai/api/v1"
        else:
            default_base_url = self.ollama_base_url
        return (self.ai_base_url or self._backend_setting("ai_base_url") or default_base_url).rstrip("/")

    def _backend_setting(self, key: str) -> str | None:
        try:
            with psycopg.connect(self.database_url) as connection:
                row = connection.execute("SELECT value FROM settings WHERE key = %s", (key,)).fetchone()
            return row[0].strip() if row and isinstance(row[0], str) and row[0].strip() else None
        except psycopg.Error:
            return None

    @property
    def resolved_provider(self) -> str:
        provider = self.ai_provider or self._backend_setting("ai_provider") or "ollama"
        return "openrouter" if provider.strip().lower() == "openai" else provider.strip().lower()

    @property
    def resolved_api_key(self) -> str | None:
        return self.openrouter_api_key or self._backend_setting("ai_api_key")

    @property
    def resolved_chat_model(self) -> str:
        return self.ai_chat_model or self._backend_setting("ai_model") or self.ollama_chat_model

    @property
    def resolved_embedding_model(self) -> str:
        if self.ai_embedding_model:
            return self.ai_embedding_model
        if self.resolved_provider == "openrouter":
            return "qwen3-embedding:4b"
        return self.ollama_embedding_model


settings = Settings()
