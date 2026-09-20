from __future__ import annotations

import os

import psycopg


PLUGIN_SETTING_KEY = "plugin.linkedin.enabled"


def default_enabled() -> bool:
    raw = os.environ.get("LINKEDIN_PLUGIN_ENABLED")
    if raw is None:
        return True
    return raw.strip().lower() in {"1", "true", "yes", "on"}


async def is_enabled(database_url: str) -> bool:
    try:
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT value FROM settings WHERE key = %s", (PLUGIN_SETTING_KEY,))
                row = await cursor.fetchone()
    except psycopg.Error:
        return default_enabled()

    if not row or not isinstance(row[0], str) or not row[0].strip():
        return default_enabled()
    return row[0].strip().lower() in {"1", "true", "yes", "on"}
