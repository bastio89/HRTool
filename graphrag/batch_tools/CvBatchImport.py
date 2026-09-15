#!/usr/bin/env python3
"""Import all PDF files in a directory through the GraphRAG CV parser service."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from io import BytesIO
from pathlib import Path
from urllib import error, request

from pypdf import PdfReader


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read all PDF files from a directory and send them to the GraphRAG CV or job parser service."
        )
    )
    parser.add_argument(
        "--mode",
        choices=("cv", "job"),
        default="cv",
        help="Import mode: cv -> /cv-parser/parse, job -> /ingest/job (default: cv)",
    )
    parser.add_argument(
        "--job-persist",
        choices=("postgres", "neo4j", "true", "false", "1", "0"),
        default=os.environ.get("GRAPHRAG_JOB_PERSISTENCE", "true").strip().lower(),
        help=(
            "Persistence mode for job imports sent to /ingest/job (default: true, which writes to PostgreSQL and Neo4j; "
            "set to postgres or neo4j to restrict persistence to one database)"
        ),
    )
    parser.add_argument(
        "--input-dir",
        default=None,
        help="Directory that contains the PDF files (default: cv_input for cv mode, job_input for job mode)",
    )
    parser.add_argument(
        "--done-dir",
        default=None,
        help="Directory where successfully imported PDFs are moved (default: <input-dir>/done)",
    )
    parser.add_argument(
        "--api-base",
        default=None,
        help=(
            "GraphRAG service base URL (default: GRAPHRAG_API_BASE_URL, "
            "GRAPHRAG_HOST_BASE_URL, or a host-safe fallback to http://127.0.0.1:8002)"
        ),
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=180,
        help="HTTP timeout in seconds for GraphRAG API calls",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not call the API and do not move files",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Process PDFs recursively below the input directory",
    )
    return parser.parse_args()


def resolve_api_base() -> str:
    explicit = os.environ.get("GRAPHRAG_API_BASE_URL") or os.environ.get("GRAPHRAG_HOST_BASE_URL")
    if explicit:
        return explicit.rstrip("/")

    env_base = (os.environ.get("GRAPHRAG_BASE_URL") or "").strip()
    if env_base and any(token in env_base for token in ("localhost", "127.0.0.1", "host.docker.internal")):
        return env_base.rstrip("/")

    return "http://127.0.0.1:8002"


def probe_api_base(api_base: str) -> bool:
    probe_url = f"{api_base.rstrip('/')}/health/live"
    req = request.Request(probe_url, method="GET")
    try:
        with request.urlopen(req, timeout=5) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except Exception:
        return False


def resolve_reachable_api_base(preferred_api_base: str | None) -> str:
    candidates: list[str] = []
    if preferred_api_base:
        candidates.append(preferred_api_base.rstrip("/"))
    else:
        candidates.append(resolve_api_base())

    for fallback in ("http://127.0.0.1:8002", "http://127.0.0.1:8000"):
        if fallback not in candidates:
            candidates.append(fallback)

    for candidate in candidates:
        if probe_api_base(candidate):
            return candidate

    raise RuntimeError(
        "GraphRAG service is not reachable on any of these bases: "
        + ", ".join(candidates)
    )


def ensure_unique_destination(done_dir: Path, file_name: str) -> Path:
    destination = done_dir / file_name
    if not destination.exists():
        return destination

    stem = destination.stem
    suffix = destination.suffix
    counter = 1
    while True:
        candidate = done_dir / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def post_multipart_file(url: str, file_path: Path, timeout_seconds: int) -> dict:
    boundary = f"----graphrag-{os.urandom(8).hex()}"
    file_bytes = file_path.read_bytes()

    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"{file_path.name}\"\r\n"
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


def post_json(url: str, payload: dict, timeout_seconds: int) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


def extract_pdf_text(file_path: Path) -> str:
    data = file_path.read_bytes()
    if not data:
        raise ValueError(f"PDF file is empty: {file_path}")

    try:
        reader = PdfReader(BytesIO(data))
    except Exception as exc:
        raise ValueError(f"Could not parse PDF file: {file_path}") from exc

    text_parts: list[str] = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            text_parts.append(page_text.strip())

    extracted = "\n".join(text_parts).strip()
    if not extracted:
        raise ValueError(f"PDF file does not contain extractable text: {file_path}")
    return extracted


def iter_pdf_files(input_dir: Path, recursive: bool, done_dir: Path) -> list[Path]:
    if recursive:
        done_dir_resolved = done_dir.resolve()
        files = [
            path
            for path in input_dir.rglob("*")
            if path.is_file()
            and path.suffix.lower() == ".pdf"
            and done_dir_resolved not in path.resolve().parents
            and path.resolve() != done_dir_resolved
        ]
    else:
        files = [path for path in input_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pdf"]
    return sorted(files)


def main() -> int:
    _load_env_file(Path(__file__).resolve().parents[2] / ".env")

    args = parse_args()
    default_input_dir = Path("job_input" if args.mode == "job" else "cv_input")
    input_dir = Path(args.input_dir) if args.input_dir else default_input_dir
    if not input_dir.exists():
        raise SystemExit(f"Input directory does not exist: {input_dir}")
    if not input_dir.is_dir():
        raise SystemExit(f"Input path is not a directory: {input_dir}")

    done_dir = Path(args.done_dir) if args.done_dir else input_dir / "done"
    files = iter_pdf_files(input_dir, args.recursive, done_dir)
    if not files:
        print(f"No PDF files found in {input_dir}")
        return 0

    if args.dry_run:
        api_base = (args.api_base or resolve_api_base()).rstrip("/")
    else:
        api_base = resolve_reachable_api_base(args.api_base)
    job_persist = args.job_persist
    endpoint = (
        f"{api_base}/cv-parser/parse?persist=true"
        if args.mode == "cv"
        else f"{api_base}/ingest/job?persist={job_persist}"
    )
    print(f"Using GraphRAG service at {api_base}")
    print(f"Import mode: {args.mode}")

    processed = 0
    for pdf_path in files:
        print(f"Processing {pdf_path}")
        if args.dry_run:
            if args.mode == "cv":
                print(f"  dry-run: would upload PDF to {endpoint}")
            else:
                print(f"  dry-run: would extract text locally and POST JSON to {endpoint}")
            continue

        if args.mode == "cv":
            response = post_multipart_file(endpoint, pdf_path, args.timeout_seconds)
        else:
            extracted_text = extract_pdf_text(pdf_path)
            response = post_json(endpoint, {"raw_text": extracted_text}, args.timeout_seconds)
        if not response:
            raise RuntimeError(f"GraphRAG returned an empty response for {pdf_path.name}")

        if args.mode == "cv":
            success = bool(response.get("success"))
            if not success:
                raise RuntimeError(f"GraphRAG returned no success flag for {pdf_path.name}: {response}")
        else:
            if not response.get("id"):
                raise RuntimeError(f"GraphRAG job import returned no job id for {pdf_path.name}: {response}")

        done_dir.mkdir(parents=True, exist_ok=True)
        destination = ensure_unique_destination(done_dir, pdf_path.name)
        shutil.move(str(pdf_path), str(destination))

        if args.mode == "cv":
            graph_rag = response.get("graphRag") or {}
            candidate = response.get("candidate") or {}
            candidate_id = graph_rag.get("id") or candidate.get("id")
            message = graph_rag.get("message") or "imported"
            if candidate_id:
                print(f"  ok: candidate_id={candidate_id} message={message}")
            else:
                print(f"  ok: message={message}")
        else:
            job_id = response.get("id")
            message = response.get("message") or "imported"
            print(f"  ok: job_id={job_id} message={message}")
        print(f"  moved to {destination}")
        processed += 1

    print(f"Done: processed {processed} PDF file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())