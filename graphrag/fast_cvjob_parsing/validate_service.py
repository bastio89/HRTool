#!/usr/bin/env python3
"""Parse the sample CVs and job descriptions through the running API."""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple, Type
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ValidationError

from app.schemas import CVResponse, JobResponse


def _request_json(
    url: str,
    *,
    body: bytes | None = None,
    headers: Dict[str, str] | None = None,
    timeout: float,
) -> Dict[str, Any]:
    request = Request(url, data=body, headers=headers or {}, method="POST" if body is not None else "GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            raw_response = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Request failed: {exc.reason}") from exc

    try:
        payload = json.loads(raw_response)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Service returned invalid JSON.") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Service response must be a JSON object.")
    return payload


def _multipart_pdf(pdf_path: Path) -> Tuple[bytes, str]:
    boundary = f"----cv-job-parser-{uuid.uuid4().hex}"
    filename = pdf_path.name.replace("\\", "_").replace('"', "_")
    filename = filename.encode("ascii", errors="replace").decode("ascii")
    body = b"\r\n".join(
        [
            f"--{boundary}".encode("ascii"),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"'.encode("ascii"),
            b"Content-Type: application/pdf",
            b"",
            pdf_path.read_bytes(),
            f"--{boundary}--".encode("ascii"),
            b"",
        ]
    )
    return body, f"multipart/form-data; boundary={boundary}"


def _text_values(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        if value.strip():
            yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _text_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from _text_values(child)


def _discover_pdfs(testdaten_dir: Path) -> Tuple[list[Path], list[Path]]:
    if not testdaten_dir.is_dir():
        raise RuntimeError(f"Test data directory does not exist: {testdaten_dir}")

    pdfs = sorted(
        (path for path in testdaten_dir.rglob("*") if path.is_file() and path.suffix.casefold() == ".pdf"),
        key=lambda path: path.name.casefold(),
    )
    cv_files = [path for path in pdfs if path.name.casefold().startswith("cv")]
    job_files = [path for path in pdfs if path not in cv_files]
    if len(cv_files) != 4 or len(job_files) != 4:
        raise RuntimeError(
            f"Expected 4 CV PDFs and 4 job-description PDFs in {testdaten_dir}; "
            f"found {len(cv_files)} CVs and {len(job_files)} jobs."
        )
    return cv_files, job_files


def _validate_file(
    pdf_path: Path,
    *,
    endpoint: str,
    response_model: Type[BaseModel],
    base_url: str,
    timeout: float,
) -> Tuple[int, BaseModel]:
    body, content_type = _multipart_pdf(pdf_path)
    payload = _request_json(
        f"{base_url}{endpoint}",
        body=body,
        headers={"Content-Type": content_type, "Accept": "application/json"},
        timeout=timeout,
    )
    try:
        response = response_model.model_validate(payload)
    except ValidationError as exc:
        raise RuntimeError(f"Response does not match {response_model.__name__}: {exc}") from exc

    extracted_values = list(_text_values(response.model_dump(mode="json")))
    if not extracted_values:
        raise RuntimeError("Response matches the schema but contains no extracted values.")
    return len(extracted_values), response


def _json_record(
    pdf_path: Path,
    document_type: str,
    *,
    response: BaseModel | None = None,
    error: str = "",
) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "document_type": document_type,
        "filename": pdf_path.name,
        "status": "FAIL" if error else "PASS",
        "error": error or None,
        "result": response.model_dump(mode="json") if response is not None else None,
    }
    return record


def main() -> int:
    workspace = Path(__file__).resolve().parent
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the running parser service (default: %(default)s)",
    )
    argument_parser.add_argument(
        "--testdaten",
        type=Path,
        default=workspace / "testdaten",
        help="Directory containing the four CV and four job-description PDFs",
    )
    argument_parser.add_argument("--timeout", type=float, default=300.0, help="Per-request timeout in seconds")
    argument_parser.add_argument(
        "--output",
        type=Path,
        default=workspace / "validation_results.json",
        help="JSON output path (default: %(default)s)",
    )
    args = argument_parser.parse_args()
    base_url = args.base_url.rstrip("/")

    try:
        cv_files, job_files = _discover_pdfs(args.testdaten)
        health = _request_json(f"{base_url}/healthz", timeout=args.timeout)
        if health.get("model_loaded") is not True:
            raise RuntimeError(f"Parser model is not ready: {health}")
    except (OSError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    cases = [
        (path, "/api/v1/parse/cv", CVResponse, "CV")
        for path in cv_files
    ] + [
        (path, "/api/v1/parse/job", JobResponse, "JOB")
        for path in job_files
    ]
    failures = 0
    results: list[Dict[str, Any]] = []
    output_path = args.output if args.output.is_absolute() else workspace / args.output
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        for pdf_path, endpoint, response_model, label in cases:
            started = time.perf_counter()
            try:
                value_count, response = _validate_file(
                    pdf_path,
                    endpoint=endpoint,
                    response_model=response_model,
                    base_url=base_url,
                    timeout=args.timeout,
                )
                results.append(_json_record(pdf_path, label, response=response))
                elapsed = time.perf_counter() - started
                print(f"PASS {label:3} {pdf_path.name} | schema valid | values={value_count} | {elapsed:.1f}s")
            except (OSError, RuntimeError, ValidationError) as exc:
                failures += 1
                results.append(_json_record(pdf_path, label, error=str(exc)))
                print(f"FAIL {label:3} {pdf_path.name} | {exc}", file=sys.stderr)
        with output_path.open("w", encoding="utf-8") as json_file:
            json.dump(results, json_file, ensure_ascii=False, indent=2)
            json_file.write("\n")
    except OSError as exc:
        print(f"ERROR: Could not write JSON to {output_path}: {exc}", file=sys.stderr)
        return 2

    passed = len(cases) - failures
    print(f"\nSummary: {passed}/{len(cases)} passed; {failures} failed.")
    print(f"JSON written to: {output_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())