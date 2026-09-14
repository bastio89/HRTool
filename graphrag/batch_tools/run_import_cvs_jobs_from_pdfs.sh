.#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
PYTHON_SCRIPT="$REPO_ROOT/graphrag/batch_tools/import_cvs_jobs_from_pdfs.py"
VENV_PYTHON="$REPO_ROOT/.venv/bin/python"

usage() {
  cat <<'EOF'
Usage: ./run_import_cvs_jobs_from_pdfs.sh [--help|-h] [-- <python-args>]

Runs graphrag/batch_tools/import_cvs_jobs_from_pdfs.py from the repository root.

Examples:
  ./run_import_cvs_jobs_from_pdfs.sh
  ./run_import_cvs_jobs_from_pdfs.sh -- --mode job --input-dir ./job_input
  HRTOOL_API_TOKEN=... ./run_import_cvs_jobs_from_pdfs.sh -- --dry-run

Behavior:
  - uses .venv/bin/python if it exists
  - falls back to python3 on PATH
  - creates a local .venv and installs graphrag requirements if no virtualenv exists
  - forwards all arguments after -- to the Python import script
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

shift_args=()
if [ "${1:-}" = "--" ]; then
  shift_args=("${@:2}")
else
  shift_args=("$@")
fi

if [ ! -f "$PYTHON_SCRIPT" ]; then
  echo "Fehler: Python-Skript nicht gefunden: $PYTHON_SCRIPT" >&2
  exit 1
fi

if [ -x "$VENV_PYTHON" ]; then
  PYTHON_BIN="$VENV_PYTHON"
else
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python)"
  else
    echo "Fehler: Weder .venv/bin/python noch python3/python im PATH gefunden." >&2
    exit 1
  fi

  if [ ! -d "$REPO_ROOT/.venv" ]; then
    echo "Hinweis: Erstelle lokale .venv und installiere Python-Abhängigkeiten..."
    "$PYTHON_BIN" -m venv "$REPO_ROOT/.venv"
    "$VENV_PYTHON" -m pip install --upgrade pip
    "$VENV_PYTHON" -m pip install -r "$REPO_ROOT/graphrag/requirements.txt"
  fi

  if [ -x "$VENV_PYTHON" ]; then
    PYTHON_BIN="$VENV_PYTHON"
  fi
fi

cd "$REPO_ROOT"
exec "$PYTHON_BIN" "$PYTHON_SCRIPT" "${shift_args[@]}"