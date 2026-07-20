from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    neo4j_uri: str
    neo4j_user: str = "neo4j"
    neo4j_password: str
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


settings = Settings()
