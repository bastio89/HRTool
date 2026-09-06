from __future__ import annotations

import csv
import io
import json
import os
import ssl
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import certifi
except ImportError:  # pragma: no cover - fallback for minimal environments
    certifi = None


APIFY_ACTOR_URL = "https://api.apify.com/v2/acts/memo23~linkedin-people-search/run-sync-get-dataset-items"


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
        return token.strip() if isinstance(token, str) and token.strip() else None

    @property
    def is_configured(self) -> bool:
        return self._resolve_token() is not None

    def fetch_items(self, payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        token = self._resolve_token()
        if not token:
            raise RuntimeError("APIFY_TOKEN is not configured.")

        request = Request(
            f"{self.actor_url}?token={token}",
            data=json.dumps(dict(payload)).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urlopen(request, timeout=120, context=_ssl_context()) as response:
                raw = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RuntimeError(f"Apify actor request failed: {exc}") from exc

        data = json.loads(raw)
        if not isinstance(data, list):
            raise RuntimeError("Unexpected Apify response format.")
        return [item for item in data if isinstance(item, dict)]

    def export_csv(self, payload: Mapping[str, Any]) -> tuple[str, str]:
        rows = self.fetch_items(payload)
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