#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Fehler: Docker ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Fehler: Docker Compose v2 ist nicht verfügbar." >&2
  exit 1
fi

if [ ! -f .env ]; then
  if [ ! -f .env.docker.example ]; then
    echo "Fehler: .env.docker.example fehlt." >&2
    exit 1
  fi
  cp .env.docker.example .env
  echo "Eine .env wurde aus .env.docker.example angelegt. Bitte Secrets prüfen."
fi

if grep -Eq 'bitte-durch|your_.*_password|change-me' .env; then
  echo "Fehler: Bitte zuerst die Platzhalter in .env durch sichere Werte ersetzen." >&2
  exit 1
fi

docker compose config --quiet
docker compose up -d --build

published_url() {
  local service="$1"
  local container_port="$2"
  local fallback_port="$3"
  local published
  published="$(docker compose port "$service" "$container_port" 2>/dev/null || true)"
  if [ -n "$published" ]; then
    printf '%s\n' "$published" | sed 's/^[^:]*:/http:\/\/localhost:/'
  else
    printf 'http://localhost:%s\n' "$fallback_port"
  fi
}

frontend_url="$(published_url frontend 80 "${FRONTEND_PORT:-5173}")"
backend_url="$(published_url backend 3001 "${BACKEND_PORT:-3001}")"
graphrag_url="$(published_url graphrag 8000 "${GRAPHRAG_PORT:-8002}")"

echo
echo "HRTool läuft:"
echo "  Frontend:    ${frontend_url}/"
echo "  Backend API: ${backend_url}/api"
echo "  Swagger:     ${backend_url}/api/docs"
echo "  GraphRAG:    ${graphrag_url}/"
echo
docker compose ps
