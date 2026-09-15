#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: ./run_import_cvs_jobs_from_pdfs.sh [--help|-h] [-- <python-args>]

Runs import_cvs_jobs_from_pdfs.py inside an already running GraphRAG container.

Examples:
  cd /Users/pak/HRTool-testdep/HRTool
  ./graphrag/batch_tools/run_import_cvs_jobs_from_pdfs.sh -- --mode cv --input-dir ./cv_input
  ./run_import_cvs_jobs_from_pdfs.sh -- --mode cv --input-dir ./cv_input
  ./run_import_cvs_jobs_from_pdfs.sh -- --dry-run

Required on the host:
  - Docker
  - an already running GraphRAG container from this repository

The script does not start GraphRAG, Neo4j, or Postgres itself.
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Fehler: Docker ist nicht installiert oder nicht im PATH." >&2
  exit 1
fi

python_args=()
if [ "${1:-}" = "--" ]; then
  shift
fi
python_args=("$@")

container_name="${GRAPHRAG_CONTAINER_NAME:-hrtool-graphrag}"
if [ "$(docker inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null || echo false)" != "true" ]; then
  echo "Fehler: GraphRAG-Container '$container_name' läuft nicht." >&2
  echo "Starte zuerst den vorhandenen GraphRAG-Stack und setze ggf. GRAPHRAG_CONTAINER_NAME." >&2
  exit 1
fi

exec docker exec -i "$container_name" \
  python batch_tools/import_cvs_jobs_from_pdfs.py "${python_args[@]}"