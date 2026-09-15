#!/usr/bin/env python3
"""Import all PDF files in a directory through the GraphRAG CV parser service."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from urllib import error, request


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
            "Read all PDF files from a directory and send them to the GraphRAG CV parser service."
        )
    )
    parser.add_argument(
        "--input-dir",
        default=None,
        help="Directory that contains the PDF files (default: cv_input)",
    )
    parser.add_argument(
        "--done-dir",
        default=None,
        help="Directory where successfully imported PDFs are moved (default: <input-dir>/done)",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("GRAPHRAG_BASE_URL", "http://127.0.0.1:8000"),
        help="GraphRAG service base URL (default: GRAPHRAG_BASE_URL or http://127.0.0.1:8000)",
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
    input_dir = Path(args.input_dir) if args.input_dir else Path("cv_input")
    if not input_dir.exists():
        raise SystemExit(f"Input directory does not exist: {input_dir}")
    if not input_dir.is_dir():
        raise SystemExit(f"Input path is not a directory: {input_dir}")

    done_dir = Path(args.done_dir) if args.done_dir else input_dir / "done"
    files = iter_pdf_files(input_dir, args.recursive, done_dir)
    if not files:
        print(f"No PDF files found in {input_dir}")
        return 0

    api_base = args.api_base.rstrip("/")
    endpoint = f"{api_base}/cv-parser/parse?persist=true"

    processed = 0
    for pdf_path in files:
        print(f"Processing {pdf_path}")
        if args.dry_run:
            print(f"  dry-run: would call {endpoint}")
            continue

        response = post_multipart_file(endpoint, pdf_path, args.timeout_seconds)
        if not response.get("success"):
            raise RuntimeError(f"GraphRAG returned no success flag for {pdf_path.name}: {response}")

        done_dir.mkdir(parents=True, exist_ok=True)
        destination = ensure_unique_destination(done_dir, pdf_path.name)
        shutil.move(str(pdf_path), str(destination))

        graph_rag = response.get("graphRag") or {}
        candidate = response.get("candidate") or {}
        candidate_id = graph_rag.get("id") or candidate.get("id")
        message = graph_rag.get("message") or "imported"
        if candidate_id:
            print(f"  ok: candidate_id={candidate_id} message={message}")
        else:
            print(f"  ok: message={message}")
        print(f"  moved to {destination}")
        processed += 1

    print(f"Done: processed {processed} PDF file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())