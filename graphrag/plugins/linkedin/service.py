from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
import shutil
from dataclasses import dataclass
from pathlib import Path
from functools import partial

from .schemas import LinkedInExportRequest


@dataclass(frozen=True)
class LinkedInExportResult:
    filename: str
    warning: str | None
    payload: bytes


class LinkedInExportService:
    def __init__(self, apify_token: str | None = None) -> None:
        self.apify_token = (apify_token or "").strip() or None

    @staticmethod
    def _normalize_profiles(payload: LinkedInExportRequest) -> list[dict[str, object]]:
        if payload.profiles:
            return [profile for profile in payload.profiles if isinstance(profile, dict)]
        return [{"linkedinUrl": link} for link in payload.links if isinstance(link, str) and link.strip()]

    async def export(self, payload: LinkedInExportRequest) -> LinkedInExportResult:
        profiles = self._normalize_profiles(payload)
        if not profiles:
            raise ValueError("Mindestens ein LinkedIn-Profil ist erforderlich.")

        temp_dir = Path(tempfile.mkdtemp(prefix="hrtool-linkedin-"))
        profiles_file = temp_dir / "linkedin-profiles.json"
        profiles_file.write_text(f"{json.dumps(profiles, ensure_ascii=False, indent=2)}\n", encoding="utf-8")

        try:
            script = Path(__file__).resolve().parents[2] / "batch_tools" / "linkedin_profile_to_pdf.py"
            env = os.environ.copy()
            if self.apify_token:
                env["APIFY_TOKEN"] = self.apify_token

            result = await asyncio.to_thread(
                partial(
                    subprocess.run,
                    [sys.executable, str(script), "--profiles-json", str(profiles_file)],
                    cwd=str(temp_dir),
                    encoding="utf8",
                    env=env,
                    capture_output=True,
                    check=False,
                ),
            )
        except TypeError:
            result = subprocess.run(
                [sys.executable, str(script), "--profiles-json", str(profiles_file)],
                cwd=str(temp_dir),
                encoding="utf8",
                env=env,
                capture_output=True,
                check=False,
            )

        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()

        if result.returncode != 0:
            raise RuntimeError(stderr or stdout or f"Exit code {result.returncode}")

        files = [Path(match.strip()) for match in re.findall(r"^PDF erstellt:\s*(.+)$", stdout, flags=re.MULTILINE)]
        if not files:
            raise RuntimeError(stdout or "Keine PDF-Dateien wurden erstellt.")

        zip_name = f"linkedin-profiles-{int(temp_dir.stat().st_mtime)}.zip"
        zip_path = temp_dir / zip_name
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file_path in files:
                archive.write(file_path, arcname=file_path.name)

        warning = re.search(r"Warnung:\s*LinkedIn-Anreicherung nicht verfügbar:\s*(.+)", stderr, flags=re.IGNORECASE)
        try:
            return LinkedInExportResult(
                filename=zip_name,
                warning=warning.group(1).strip() if warning else None,
                payload=zip_path.read_bytes(),
            )
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
