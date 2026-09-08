from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


GRAPHRAG_ENDPOINT = os.environ.get("GRAPHRAG_BASE_URL", "http://127.0.0.1:8002").rstrip("/") + "/linkedin/people-search.csv"
DEFAULT_INPUT = {
    "enrichEmails": True,
    "keywords": "treasury",
    "location": "Zürich",
    "maxResults": 5,
    "mode": "public",
}


def _timestamp_component() -> str:
    return datetime.now().strftime("%d%m%y_%S")


def _default_output_filename() -> Path:
    return Path.cwd() / f"linkedin_search-{_timestamp_component()}.csv"


def _filename_from_content_disposition(content_disposition: str | None) -> str | None:
    if not content_disposition:
        return None
    match = re.search(r'filename="?([^";]+)"?', content_disposition)
    return match.group(1) if match else None


def run_service(input_data: dict[str, object] | None = None) -> tuple[str, str]:
    request = Request(
        GRAPHRAG_ENDPOINT,
        data=json.dumps(input_data or DEFAULT_INPUT).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/csv"},
    )
    try:
        with urlopen(request, timeout=120) as response:
            payload = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
            filename = _filename_from_content_disposition(response.headers.get("Content-Disposition"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"Graphrag service konnte nicht ausgeführt werden: {exc}") from exc

    if not payload.strip():
        raise RuntimeError("Graphrag service returned an empty CSV payload.")
    return payload, filename or _default_output_filename().name


def main() -> int:
    try:
        csv_text, filename = run_service()
        output = Path.cwd() / filename
        output.write_text(csv_text, encoding="utf-8")
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1

    print(f"CSV erstellt: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())