from __future__ import annotations

import csv
import io
import json
import logging
import os
import ssl
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

import httpx

from config import settings

try:
    import certifi
except ImportError:  # pragma: no cover - fallback for minimal environments
    certifi = None


APIFY_ACTOR_URL = "https://api.apify.com/v2/acts/memo23~linkedin-people-search/run-sync-get-dataset-items"
logger = logging.getLogger(__name__)


def _ssl_context() -> ssl.SSLContext:
    if certifi is not None:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


def _csv_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def _build_filename() -> str:
    return f"linkedin_search-{datetime.now().strftime('%d%m%y_%S')}.csv"


@dataclass(frozen=True)
class LinkedInPeopleSearchService:
    actor_url: str = APIFY_ACTOR_URL

    @staticmethod
    def _resolve_token() -> str | None:
        token = os.environ.get("APIFY_TOKEN")
        if isinstance(token, str) and token.strip():
            return token.strip()
        resolved = settings.resolved_apify_token
        return resolved.strip() if isinstance(resolved, str) and resolved.strip() else None

    @property
    def is_configured(self) -> bool:
        return self._resolve_token() is not None

    async def fetch_items(self, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        token = self._resolve_token()
        if not token:
            raise RuntimeError("APIFY_TOKEN is not configured.")

        started_at = time.perf_counter()
        try:
            timeout = httpx.Timeout(120.0, connect=10.0)
            async with httpx.AsyncClient(timeout=timeout, verify=_ssl_context()) as client:
                response = await client.post(
                    self.actor_url,
                    json=dict(payload),
                    headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
                )
                response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            elapsed = time.perf_counter() - started_at
            logger.warning("LinkedIn people search failed after %.2fs: %s", elapsed, exc)
            raise RuntimeError(f"Apify actor request failed: {exc}") from exc

        if not isinstance(data, list):
            raise RuntimeError("Unexpected Apify response format.")
        items = [item for item in data if isinstance(item, dict)]
        logger.info("LinkedIn people search completed in %.2fs (items=%d)", time.perf_counter() - started_at, len(items))
        return items

    async def export_csv(self, payload: Mapping[str, Any]) -> tuple[str, str]:
        rows = await self.fetch_items(payload)
        if not rows:
            raise RuntimeError("Apify returned no rows to export.")

        fieldnames: list[str] = []
        for row in rows:
            for key in row.keys():
                if key not in fieldnames:
                    fieldnames.append(key)

        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _csv_value(row.get(key)) for key in fieldnames})
        return _build_filename(), buffer.getvalue()