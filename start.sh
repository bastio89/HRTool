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

missing_vars=()
for variable in JWT_SECRET POSTGRES_PASSWORD DATABASE_URL NEO4J_PASSWORD PGADMIN_DEFAULT_PASSWORD; do
  if ! grep -Eq "^[[:space:]]*${variable}=[^[:space:]]+" .env; then
    missing_vars+=("$variable")
  fi
done
if [ "${#missing_vars[@]}" -gt 0 ]; then
  echo "Fehler: Folgende Pflichtvariablen fehlen in .env: ${missing_vars[*]}" >&2
  echo "Erzeuge .env erneut aus .env.docker.example oder ergänze die Werte manuell." >&2
  exit 1
fi

docker compose config --quiet
docker compose up -d --build

frontend_url="$(docker compose port frontend 80 | sed 's/^[^:]*:/http:\/\/localhost:/')"
backend_url="$(docker compose port backend 3001 | sed 's/^[^:]*:/http:\/\/localhost:/')"
graphrag_url="$(docker compose port graphrag 8000 | sed 's/^[^:]*:/http:\/\/localhost:/')"

echo
echo "HRTool läuft:"
echo "  Frontend:    ${frontend_url}/"
echo "  Backend API: ${backend_url}/api"
echo "  Swagger:     ${backend_url}/api/docs"
echo "  GraphRAG:    ${graphrag_url}/"
echo
docker compose ps
