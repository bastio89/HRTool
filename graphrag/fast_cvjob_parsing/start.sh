#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

BASE_URL="${PARSER_BASE_URL:-http://localhost:8000}"
VENV_DIR="$PROJECT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker is not installed or not available on PATH." >&2
    exit 1
fi
if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker is not running. Start Docker Desktop and run this script again." >&2
    exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is required to prepare the validation environment." >&2
    exit 1
fi

if [[ ! -x "$VENV_PYTHON" ]]; then
    python3 -m venv "$VENV_DIR"
fi

if ! "$VENV_PYTHON" -c 'import pydantic; assert int(pydantic.__version__.split(".")[0]) >= 2' >/dev/null 2>&1; then
    "$VENV_PYTHON" -m pip install 'pydantic>=2.7,<3'
fi

echo "Building and starting the parser service..."
docker compose up --build -d

echo "Waiting for the GLiNER model to become ready..."
ready=0
for attempt in $(seq 1 300); do
    if "$VENV_PYTHON" -c '
import json
import sys
from urllib.request import urlopen

try:
    with urlopen(sys.argv[1].rstrip("/") + "/healthz", timeout=3) as response:
        health = json.load(response)
    if health.get("model_loaded") is True:
        raise SystemExit(0)
except Exception:
    pass
raise SystemExit(1)
' "$BASE_URL" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 2
done

if [[ "$ready" != 1 ]]; then
    echo "ERROR: Parser did not become ready within 10 minutes. Recent service logs:" >&2
    docker compose logs --tail=100 >&2
    exit 1
fi

echo "Parser is ready. Running CV and job-description validations..."
exec "$VENV_PYTHON" "$PROJECT_DIR/validate_service.py" --base-url "$BASE_URL" "$@"