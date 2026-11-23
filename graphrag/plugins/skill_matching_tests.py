from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import psycopg
from fastapi import APIRouter, HTTPException, Path as PathParam

from models import SkillMatchingTestCaseInput
from services.skill_matching_test_cases import SkillMatchingTestCaseStore


_test_lock = asyncio.Lock()
_TEST_TIMEOUT_SECONDS = 300
_MAX_OUTPUT_CHARACTERS = 30_000
_MATRIX_OUTPUT_PREFIX = "SKILL_MATCHING_MATRIX_JSON:"
_EMBEDDING_OUTPUT_PREFIX = "SKILL_MATCHING_EMBEDDING_JSON:"
_SERVICE_OUTPUT_PREFIX = "SKILL_MATCHING_SERVICE_JSON:"


def _separate_test_metadata(
    output: bytes,
) -> tuple[
    str,
    dict[str, str] | None,
    dict[str, str] | None,
    list[dict[str, object]],
]:
    visible_lines = []
    embedding_model = None
    matching_service = None
    matrix = []
    for line in output.decode(errors="replace").splitlines():
        if line.startswith(_EMBEDDING_OUTPUT_PREFIX):
            try:
                details = json.loads(line[len(_EMBEDDING_OUTPUT_PREFIX):])
            except json.JSONDecodeError as error:
                raise ValueError("Ungültige Embedding-Modell-Ausgabe des CSV-Tests.") from error
            if (
                not isinstance(details, dict)
                or not isinstance(details.get("model"), str)
                or not isinstance(details.get("provider"), str)
            ):
                raise ValueError("Embedding-Modell-Ausgabe muss Modell und Provider enthalten.")
            embedding_model = {
                "model": details["model"],
                "provider": details["provider"],
            }
            continue
        if line.startswith(_SERVICE_OUTPUT_PREFIX):
            try:
                details = json.loads(line[len(_SERVICE_OUTPUT_PREFIX):])
            except json.JSONDecodeError as error:
                raise ValueError("Ungültige Matching-Service-Ausgabe des CSV-Tests.") from error
            service_fields = (
                "implementation",
                "method",
                "api_method",
                "api_path",
                "invocation",
            )
            if not isinstance(details, dict) or any(
                not isinstance(details.get(field), str) for field in service_fields
            ):
                raise ValueError("Matching-Service-Ausgabe enthält ungültige Angaben.")
            matching_service = {field: details[field] for field in service_fields}
            continue
        if not line.startswith(_MATRIX_OUTPUT_PREFIX):
            visible_lines.append(line)
            continue
        try:
            row = json.loads(line[len(_MATRIX_OUTPUT_PREFIX):])
        except json.JSONDecodeError as error:
            raise ValueError("Ungültige Matching-Matrix-Ausgabe des CSV-Tests.") from error
        if not isinstance(row, dict):
            raise ValueError("Matching-Matrix-Zeile muss ein JSON-Objekt sein.")
        matrix.append(row)
    return "\n".join(visible_lines), embedding_model, matching_service, matrix


def build_skill_matching_tests_router(test_case_store: SkillMatchingTestCaseStore) -> APIRouter:
    router = APIRouter(prefix="/plugins/skill_matching_tests", tags=["Skill matching tests"])

    @router.get("/cases")
    async def list_cases() -> dict[str, object]:
        return {"cases": await test_case_store.list_cases()}

    @router.post("/cases", status_code=201)
    async def create_case(case: SkillMatchingTestCaseInput) -> dict[str, object]:
        try:
            return await test_case_store.create_case(case)
        except psycopg.errors.UniqueViolation as error:
            raise HTTPException(status_code=409, detail="Die Test-ID existiert bereits.") from error

    @router.put("/cases/{case_id}")
    async def update_case(
        case: SkillMatchingTestCaseInput,
        case_id: int = PathParam(..., gt=0),
    ) -> dict[str, object]:
        try:
            saved_case = await test_case_store.update_case(case_id, case)
        except psycopg.errors.UniqueViolation as error:
            raise HTTPException(status_code=409, detail="Die Test-ID existiert bereits.") from error
        if saved_case is None:
            raise HTTPException(status_code=404, detail="Testfall nicht gefunden.")
        return saved_case

    @router.delete("/cases/{case_id}")
    async def delete_case(case_id: int = PathParam(..., gt=0)) -> dict[str, bool]:
        if not await test_case_store.delete_case(case_id):
            raise HTTPException(status_code=404, detail="Testfall nicht gefunden.")
        return {"deleted": True}

    @router.post("/run")
    async def run_csv_test() -> dict[str, object]:
        if _test_lock.locked():
            raise HTTPException(status_code=409, detail="Der CSV-Test läuft bereits.")

        async with _test_lock:
            environment = os.environ.copy()
            environment["RUN_SKILL_MATCHING_CSV_TESTS"] = "1"
            project_root = Path(__file__).resolve().parents[1]
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "-s",
                "tests/test_skill_matching_csv.py",
                cwd=project_root,
                env=environment,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            try:
                output, _ = await asyncio.wait_for(
                    process.communicate(),
                    timeout=_TEST_TIMEOUT_SECONDS,
                )
            except TimeoutError as error:
                process.kill()
                output, _ = await process.communicate()
                visible_output, embedding_model, matching_service, matrix = _separate_test_metadata(output)
                raise HTTPException(
                    status_code=504,
                    detail={
                        "message": "Der CSV-Test hat das Zeitlimit von 5 Minuten überschritten.",
                        "output": visible_output[-_MAX_OUTPUT_CHARACTERS:],
                        "embedding_model": embedding_model,
                        "matching_service": matching_service,
                        "matrix": matrix,
                    },
                ) from error

            visible_output, embedding_model, matching_service, matrix = _separate_test_metadata(output)
            return {
                "passed": process.returncode == 0,
                "return_code": process.returncode,
                "output": visible_output[-_MAX_OUTPUT_CHARACTERS:],
                "embedding_model": embedding_model,
                "matching_service": matching_service,
                "matrix": matrix,
            }

    return router
