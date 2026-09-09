#!/usr/bin/env python3
"""Import job PDFs from a folder via API and move processed files to done/."""

from __future__ import annotations

import argparse
import tempfile
import json
import os
import shutil
import sys
import uuid
import zipfile
from pathlib import Path
from urllib import error, request


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend_new import jobs_ch_to_pdf


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read all PDF job descriptions from job_input, generate structured "
            "job text via API, create jobs via API, then move successful files to done/."
        )
    )
    parser.add_argument(
        "--jobs-ch-links-file",
        type=Path,
        default=None,
        help="Text file with jobs.ch links, one link per line (exports PDFs to a ZIP)",
    )
    parser.add_argument(
        "--jobs-ch-zip-output",
        type=Path,
        default=None,
        help="Target ZIP file for jobs.ch PDF export",
    )
    parser.add_argument(
        "--api-base",
        default="http://localhost:3001/api",
        help="Base API URL (default: http://localhost:3001/api)",
    )
    parser.add_argument(
        "--input-dir",
        default="job_input",
        help="Directory that contains .pdf files (default: job_input)",
    )
    parser.add_argument(
        "--done-dir",
        default=None,
        help="Directory where successfully imported PDFs are moved (default: <input-dir>/done)",
    )
    parser.add_argument(
        "--location",
        default="Remote",
        help="Default job location used for job creation",
    )
    parser.add_argument(
        "--employment-type",
        default="Vollzeit",
        help="Default employment type used for generation + job creation",
    )
    parser.add_argument(
        "--status",
        default="Offen",
        help="Default status used for job creation",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=180,
        help="HTTP timeout in seconds for API calls",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run generation only, skip DB create and file move",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="JWT token for authenticated API calls",
    )
    parser.add_argument(
        "--username",
        default=None,
        help="Username for /auth/login (used if no token is provided)",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="Password for /auth/login (used if no token is provided)",
    )
    return parser.parse_args()


def title_from_filename(pdf_path: Path) -> str:
    stem = pdf_path.stem
    stem = stem.replace("_", " ").replace("-", " ")
    stem = " ".join(stem.split())
    return stem or "Unbenannte Stelle"


def _jobs_ch_filename_component(value: str | None, fallback: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "_" for char in (value or "")).strip("_")
    return cleaned or fallback


def _jobs_ch_date_component(value: str | None) -> str:
    if not value:
        return "unknown-date"
    normalized = value.strip()
    for parser in (jobs_ch_to_pdf.date.fromisoformat, jobs_ch_to_pdf.datetime.fromisoformat):
        try:
            parsed = parser(normalized)
            return parsed.strftime("%d-%m-%Y")
        except ValueError:
            continue
    return _jobs_ch_filename_component(normalized, "unknown-date")


def post_json(
    url: str,
    payload: dict,
    timeout_seconds: int,
    token: str | None = None,
) -> dict:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(
        url,
        data=body,
        headers=headers,
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


def post_multipart_file(
    url: str,
    file_path: Path,
    timeout_seconds: int,
    token: str | None = None,
    field_name: str = "file",
) -> dict:
    boundary = f"----hrtool-{uuid.uuid4().hex}"
    filename = file_path.name
    file_bytes = file_path.read_bytes()

    preamble = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{filename}\"\r\n"
        "Content-Type: application/pdf\r\n\r\n"
    ).encode("utf-8")
    closing = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = preamble + file_bytes + closing

    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = request.Request(url, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc


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


def load_jobs_ch_links(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Job-Link-Datei nicht gefunden: {path}")

    links: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        link = raw_line.strip()
        if link and link not in links:
            links.append(link)

    if not links:
        raise ValueError(f"Job-Link-Datei ist leer: {path}")
    return links


def export_jobs_ch_pdfs(links_file: Path, zip_output: Path) -> tuple[int, str]:
    links = load_jobs_ch_links(links_file)
    pdf_outputs: list[Path] = []
    failures: list[str] = []

    with tempfile.TemporaryDirectory(prefix="hrtool-jobs-ch-") as temp_dir:
        temp_path = Path(temp_dir)
        for index, link in enumerate(links, start=1):
            print(f"[{index}/{len(links)}] {link}")
            try:
                job = jobs_ch_to_pdf.fetch_job(link)
                filename = "_".join(
                    [
                        _jobs_ch_filename_component(job.title, "job"),
                        _jobs_ch_filename_component(job.company, "company"),
                        _jobs_ch_date_component(job.date_posted),
                    ]
                )
                output = temp_path / f"{filename}.pdf"
                jobs_ch_to_pdf.write_pdf(job, output)
                pdf_outputs.append(output)
                print(f"PDF erstellt: {output}")
                print(f"Titel: {job.title}")
            except (ValueError, RuntimeError, OSError) as exc:
                failure_message = f"{link} -> {exc}"
                failures.append(failure_message)
                print(f"Warnung: jobs.ch-Link übersprungen: {failure_message}", file=sys.stderr)

        if not pdf_outputs:
            raise RuntimeError("Kein jobs.ch-Link konnte erfolgreich in ein PDF umgewandelt werden.")

        zip_output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for pdf_path in pdf_outputs:
                archive.write(pdf_path, arcname=pdf_path.name)

    print(f"ZIP erstellt: {zip_output}")
    if failures:
        print(f"Warnung: {len(failures)} jobs.ch-Link(s) wurden übersprungen.", file=sys.stderr)
    return 0, f"created {len(pdf_outputs)} PDFs"


def resolve_auth_token(args: argparse.Namespace) -> str:
    token = args.token or os.environ.get("HRTOOL_API_TOKEN")
    if token:
        return token

    username = args.username or os.environ.get("HRTOOL_USERNAME")
    password = args.password or os.environ.get("HRTOOL_PASSWORD")
    if username and password:
        login_result = post_json(
            f"{args.api_base.rstrip('/')}/auth/login",
            {"username": username, "password": password},
            args.timeout_seconds,
        )
        login_token = str(login_result.get("token") or "").strip()
        if not login_token:
            raise RuntimeError("Login succeeded but response has no token")
        return login_token

    raise RuntimeError(
        "Authentication required: use --token or provide --username and --password "
        "(or env vars HRTOOL_API_TOKEN / HRTOOL_USERNAME / HRTOOL_PASSWORD)."
    )


def process_file(
    pdf_path: Path,
    api_base: str,
    done_dir: Path,
    location: str,
    employment_type: str,
    status: str,
    timeout_seconds: int,
    token: str,
    dry_run: bool,
) -> tuple[bool, str]:
    parsed = post_multipart_file(
        f"{api_base.rstrip('/')}/jobs/parse-description",
        pdf_path,
        timeout_seconds,
        token,
    )

    imported_filename = str(parsed.get("filename") or pdf_path.name)
    title = str(parsed.get("title") or "").strip() or title_from_filename(Path(imported_filename))
    about_us = str(parsed.get("about_us") or "").strip()
    description = str(parsed.get("description") or "").strip() or str(parsed.get("text") or "").strip()
    requirements = str(parsed.get("requirements") or "").strip()
    benefits = str(parsed.get("benefits") or "").strip()

    if not description:
        return False, "parse-description returned empty description"

    if dry_run:
        return (
            True,
            (
                "dry-run ok: parsed content "
                f"(title='{title}', about_us_chars={len(about_us)}, "
                f"description_chars={len(description)}, requirements_chars={len(requirements)}, "
                f"benefits_chars={len(benefits)})"
            ),
        )

    create_payload = {
        "title": title,
        "about_us": about_us or None,
        "description": description,
        "requirements": requirements or None,
        "benefits": benefits or None,
        "location": location,
        "type": employment_type,
        "status": status,
    }

    created = post_json(
        f"{api_base.rstrip('/')}/jobs",
        create_payload,
        timeout_seconds,
        token,
    )
    if not created.get("id"):
        return False, "jobs creation response has no id"

    done_dir.mkdir(parents=True, exist_ok=True)
    destination = ensure_unique_destination(done_dir, pdf_path.name)
    shutil.move(str(pdf_path), str(destination))

    return True, f"imported as job id={created['id']}"


def main() -> int:
    args = parse_args()

    if args.jobs_ch_links_file:
        zip_output = args.jobs_ch_zip_output or (Path.cwd() / "jobs-ch-pdfs.zip")
        try:
            exit_code, _ = export_jobs_ch_pdfs(args.jobs_ch_links_file, zip_output)
            return exit_code
        except (ValueError, RuntimeError, OSError) as exc:
            print(f"Fehler: {exc}", file=sys.stderr)
            return 1

    token = resolve_auth_token(args)

    input_dir = Path(args.input_dir)
    done_dir = Path(args.done_dir) if args.done_dir else (input_dir / "done")

    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}")
        return 1

    pdf_files = sorted(
        p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"
    )

    if not pdf_files:
        print(f"No PDF files found in {input_dir}")
        return 0

    ok_count = 0
    fail_count = 0

    for pdf in pdf_files:
        print(f"Processing {pdf.name} ...")
        try:
            ok, message = process_file(
                pdf_path=pdf,
                api_base=args.api_base,
                done_dir=done_dir,
                location=args.location,
                employment_type=args.employment_type,
                status=args.status,
                timeout_seconds=args.timeout_seconds,
                token=token,
                dry_run=args.dry_run,
            )
            if ok:
                ok_count += 1
                print(f"  OK: {message}")
            else:
                fail_count += 1
                print(f"  FAIL: {message}")
        except Exception as exc:
            fail_count += 1
            print(f"  FAIL: {exc}")

    print(
        f"Finished. success={ok_count} failed={fail_count} "
        f"done_dir={done_dir}"
    )

    return 0 if fail_count == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
