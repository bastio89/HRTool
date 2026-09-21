#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: ./run_import_cvs_jobs_from_pdfs.sh [--help|-h] [-- <python-args>]

Runs CvBatchImport.py on the host and sends PDF files to the already running GraphRAG service.

Examples:
  cd /Users/pak/HRTool-testdep/HRTool
  ./graphrag/batch_tools/run_import_cvs_jobs_from_pdfs.sh -- --mode cv --input-dir ./cv_input
  ./graphrag/batch_tools/run_import_cvs_jobs_from_pdfs.sh -- --mode job --input-dir ./job_input
  ./graphrag/batch_tools/run_import_cvs_jobs_from_pdfs.sh -- --mode job --job-persist true --input-dir ./job_input
  ./run_import_cvs_jobs_from_pdfs.sh -- --dry-run
  docker exec -i hrtool-graphrag python graphrag/batch_tools/CvBatchImport.py --mode job --input-dir ./job_input

Required on the host:
  - Python 3
  - an already running GraphRAG HTTP service, typically at http://127.0.0.1:8000 or http://127.0.0.1:8002

The script does not start GraphRAG, Neo4j, or Postgres itself. It only uploads PDFs
to the GraphRAG HTTP service. Job imports persist to PostgreSQL and Neo4j by default.
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

if [ -x "/Users/pak/HRTool-testdep/.venv/bin/python" ]; then
  python_bin="/Users/pak/HRTool-testdep/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  python_bin="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  python_bin="$(command -v python)"
else
  echo "Fehler: Weder /.venv/bin/python noch python3/python im PATH gefunden." >&2
  exit 1
fi

python_args=()
if [ "${1:-}" = "--" ]; then
  shift
fi
python_args=("$@")

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../.."
exec "$python_bin" graphrag/batch_tools/CvBatchImport.py "${python_args[@]}"