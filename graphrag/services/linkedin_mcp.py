from __future__ import annotations

import asyncio
import json
import os
import shlex
import ssl
import time
from dataclasses import dataclass
from collections.abc import Mapping
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import settings
from models import CandidateProfileExtraction


class LinkedInMCPError(RuntimeError):
    pass


@dataclass(frozen=True)
class LinkedInMCPSettings:
    command: str | None = None
    search_tool_name: str = "search_profiles"


class _MCPStdioClient:
    def __init__(self, command: list[str]) -> None:
        self._command = command
        self._process: asyncio.subprocess.Process | None = None
        self._stdout: asyncio.StreamReader | None = None
        self._stdin: asyncio.StreamWriter | None = None
        self._next_id = 0

    async def __aenter__(self) -> "_MCPStdioClient":
        self._process = await asyncio.create_subprocess_exec(
            *self._command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        if self._process.stdin is None or self._process.stdout is None:
            raise LinkedInMCPError("MCP process could not be started with stdio pipes.")
        self._stdin = self._process.stdin
        self._stdout = self._process.stdout
        await self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "HRTool", "version": "1.0.0"},
                "capabilities": {"tools": {}},
            },
        )
        await self._notify("initialized", {})
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self._stdin is not None:
            self._stdin.close()
            await self._stdin.wait_closed()
        if self._process is not None and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except TimeoutError:
                self._process.kill()
                await self._process.wait()

    async def _notify(self, method: str, params: Mapping[str, Any]) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": dict(params)})

    async def _request(self, method: str, params: Mapping[str, Any]) -> Any:
        self._next_id += 1
        request_id = self._next_id
        await self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)})
        response = await self._read_message()
        if response.get("id") != request_id:
            raise LinkedInMCPError(f"Unexpected MCP response id: {response.get('id')!r}")
        if "error" in response:
            error = response["error"]
            raise LinkedInMCPError(error.get("message") or str(error))
        return response.get("result")

    async def _send(self, message: Mapping[str, Any]) -> None:
        if self._stdin is None:
            raise LinkedInMCPError("MCP client is not connected.")
        payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
        self._stdin.write(payload + b"\n")
        await self._stdin.drain()

    async def _read_message(self) -> dict[str, Any]:
        if self._stdout is None:
            raise LinkedInMCPError("MCP client is not connected.")
        while True:
            line = await self._stdout.readline()
            if not line:
                raise LinkedInMCPError("MCP process ended before a response was received.")
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue

            if isinstance(message, dict) and message.get("method") == "notifications/message":
                params = message.get("params")
                if isinstance(params, dict):
                    data = params.get("data")
                    if isinstance(data, dict) and data.get("level") == "error":
                        raise LinkedInMCPError(_as_text(data.get("text")) or json.dumps(data, ensure_ascii=False))
                continue

            if isinstance(message, dict):
                return message

    async def call_tool(self, tool_name: str, arguments: Mapping[str, Any]) -> Any:
        return await self._request("tools/call", {"name": tool_name, "arguments": dict(arguments)})


def _ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def _resolve_apify_token() -> str | None:
    token = os.environ.get("APIFY_TOKEN")
    if token:
        return token
    return settings.resolved_apify_token


def _load_apify_items(input_data: dict[str, object]) -> list[dict[str, object]]:
    token = _resolve_apify_token()
    if not token:
        raise LinkedInMCPError("APIFY_TOKEN is not configured.")

    request = Request(
        f"https://api.apify.com/v2/acts/harvestapi~linkedin-profile-scraper/run-sync-get-dataset-items?token={token}",
        data=json.dumps(input_data).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=120, context=_ssl_context()) as response:
            raw = response.read().decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise LinkedInMCPError(f"Apify actor request failed: {exc}") from exc

    data = json.loads(raw)
    if not isinstance(data, list):
        raise LinkedInMCPError("Unexpected Apify response format.")
    return [item for item in data if isinstance(item, dict)]


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _first_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return {}


def _extract_text_content(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        if isinstance(result.get("profile"), dict):
            return result["profile"]
        if isinstance(result.get("data"), dict):
            return result["data"]
        if isinstance(result.get("result"), dict):
            return result["result"]
        content = result.get("content")
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                if isinstance(item.get("json"), dict):
                    return item["json"]
                if isinstance(item.get("text"), str):
                    try:
                        parsed = json.loads(item["text"])
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed, dict):
                        return parsed
    return _first_mapping(result)


def _normalize_text_list(values: Any, *, key: str = "name") -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({key: text})
            continue
        if isinstance(item, dict):
            payload = dict(item)
            candidate = (
                item.get(key)
                or item.get("title")
                or item.get("label")
                or item.get("role")
                or item.get("company")
                or item.get("institution")
                or item.get("field_of_study")
            )
            if candidate is not None:
                payload[key] = str(candidate).strip()
            normalized.append(payload)
    return normalized


def _normalize_education_entries(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({"level": text, "field_of_study": text})
            continue
        if isinstance(item, dict):
            level = item.get("level") or item.get("degree") or item.get("title") or item.get("qualification")
            field_of_study = item.get("field_of_study") or item.get("major") or item.get("subject") or item.get("program")
            level_text = _as_text(level) or _as_text(item.get("institution")) or "Unknown"
            field_text = _as_text(field_of_study) or _as_text(item.get("institution")) or level_text
            normalized.append({**item, "level": level_text, "field_of_study": field_text})
    return normalized


def _normalize_work_history(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({"employer": text, "position": text, "is_current": False})
            continue
        if isinstance(item, dict):
            normalized.append(
                {
                    **item,
                    "employer": _as_text(item.get("employer") or item.get("company") or item.get("organization") or item.get("organization_name")),
                    "position": _as_text(item.get("position") or item.get("role") or item.get("title") or item.get("job_title")),
                    "from_date": _as_text(item.get("from_date") or item.get("start_date") or item.get("from") or item.get("start")),
                    "to_date": _as_text(item.get("to_date") or item.get("end_date") or item.get("to") or item.get("end")),
                    "description": _as_text(item.get("description") or item.get("summary") or item.get("duties")),
                    "location": _as_text(item.get("location") or item.get("city") or item.get("place")),
                    "is_current": bool(item.get("is_current") if item.get("is_current") is not None else item.get("current") or item.get("present")),
                }
            )
    return normalized


def _normalize_education_history(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, str):
            text = item.strip()
            if text:
                normalized.append({"institution": text, "degree": text, "field_of_study": text})
            continue
        if isinstance(item, dict):
            normalized.append(
                {
                    **item,
                    "institution": _as_text(item.get("institution") or item.get("school") or item.get("university") or item.get("academy") or item.get("college")),
                    "degree": _as_text(item.get("degree") or item.get("level") or item.get("qualification") or item.get("title")),
                    "field_of_study": _as_text(item.get("field_of_study") or item.get("study_field") or item.get("subject") or item.get("major") or item.get("program")),
                    "from_date": _as_text(item.get("from_date") or item.get("start_date") or item.get("from") or item.get("start")),
                    "to_date": _as_text(item.get("to_date") or item.get("end_date") or item.get("to") or item.get("end")),
                    "description": _as_text(item.get("description") or item.get("summary") or item.get("notes")),
                }
            )
    return normalized


def normalize_linkedin_profile(payload: Mapping[str, Any], *, source_url: str | None = None) -> CandidateProfileExtraction:
    profile_data = _first_mapping(payload.get("profile")) if isinstance(payload.get("profile"), (dict, list)) else {}
    if not profile_data:
        profile_data = _first_mapping(payload.get("data")) if isinstance(payload.get("data"), (dict, list)) else {}
    if not profile_data:
        profile_data = dict(payload)

    name = _as_text(
        profile_data.get("name")
        or profile_data.get("full_name")
        or profile_data.get("displayName")
        or profile_data.get("headline")
        or "Unknown LinkedIn Profile"
    ) or "Unknown LinkedIn Profile"

    current_employer = _as_text(profile_data.get("current_employer") or profile_data.get("currentEmployer") or profile_data.get("company"))
    current_position = _as_text(profile_data.get("current_position") or profile_data.get("currentPosition") or profile_data.get("title"))
    location = _as_text(profile_data.get("location") or profile_data.get("geo") or profile_data.get("city"))

    candidate_payload = {
        "name": name,
        "location": location,
        "experience_years": profile_data.get("experience_years") or profile_data.get("yearsOfExperience"),
        "salary_expectation": profile_data.get("salary_expectation"),
        "experience": profile_data.get("experience") or profile_data.get("summary") or profile_data.get("headline"),
        "education": profile_data.get("education") or profile_data.get("education_summary"),
        "certificates": profile_data.get("certificates") or profile_data.get("certifications"),
        "drivers_license": profile_data.get("drivers_license"),
        "mobility": profile_data.get("mobility"),
        "desired_salary": profile_data.get("desired_salary"),
        "availability": profile_data.get("availability"),
        "notice_period": profile_data.get("notice_period"),
        "linkedin_url": source_url or profile_data.get("linkedin_url") or profile_data.get("url"),
        "xing_url": profile_data.get("xing_url"),
        "github_url": profile_data.get("github_url"),
        "portfolio_url": profile_data.get("portfolio_url"),
        "tags": profile_data.get("tags"),
        "notes": profile_data.get("notes") or profile_data.get("about"),
        "current_employer": current_employer,
        "current_position": current_position,
        "nationality": profile_data.get("nationality"),
        "gender": profile_data.get("gender"),
        "skills": _normalize_text_list(profile_data.get("skills")),
        "languages": _normalize_text_list(profile_data.get("languages")),
        "educations": _normalize_education_entries(profile_data.get("educations") or profile_data.get("education_levels")),
        "industries": _normalize_text_list(profile_data.get("industries")),
        "work_history": _normalize_work_history(profile_data.get("work_history") or profile_data.get("experience_items") or profile_data.get("positions")),
        "education_history": _normalize_education_history(profile_data.get("education_history") or profile_data.get("schools")),
        "preferred_roles": profile_data.get("preferred_roles") if isinstance(profile_data.get("preferred_roles"), list) else [],
        "parsing_method": "linkedin_mcp",
    }
    return CandidateProfileExtraction.model_validate(candidate_payload)


class LinkedInMCPService:
    def __init__(
        self,
        settings: LinkedInMCPSettings,
        *,
        search_tool_name: str | None = None,
    ) -> None:
        self._settings = settings
        self._search_tool_name = search_tool_name or settings.search_tool_name

    @classmethod
    def from_settings(cls, settings: Any) -> "LinkedInMCPService":
        return cls(
            LinkedInMCPSettings(
                command=getattr(settings, "apify_linkedin_mcp_command", None),
                search_tool_name=getattr(settings, "apify_linkedin_mcp_search_tool_name", "search_profiles"),
            )
        )

    @property
    def is_configured(self) -> bool:
        return bool(_resolve_apify_token() or (self._settings.command and self._settings.command.strip()))

    def _split_command(self) -> list[str]:
        if not self._settings.command:
            raise LinkedInMCPError("APIFY LinkedIn MCP command is not configured.")
        command_parts = shlex.split(self._settings.command)
        if not command_parts:
            raise LinkedInMCPError("APIFY LinkedIn MCP command is empty.")
        return command_parts

    async def extract_profile(self, url: str) -> CandidateProfileExtraction:
        if not self.is_configured:
            raise LinkedInMCPError("APIFY_TOKEN is not configured.")
        items = _load_apify_items(
            {
                "queries": [url],
                "profileScraperMode": "Profile details no email ($4 per 1k)",
            }
        )
        if not items:
            raise LinkedInMCPError("Apify actor returned no profile items.")
        return normalize_linkedin_profile(items[0], source_url=url)

    async def search_profiles(self, query: str) -> list[CandidateProfileExtraction]:
        if not self.is_configured:
            raise LinkedInMCPError("APIFY LinkedIn MCP command is not configured.")
        async with _MCPStdioClient(self._split_command()) as client:
            result = await client.call_tool(self._search_tool_name, {"query": query})
            payload = _extract_text_content(result)
            if isinstance(payload.get("profiles"), list):
                return [normalize_linkedin_profile(item) for item in payload["profiles"] if isinstance(item, Mapping)]
            if isinstance(payload.get("items"), list):
                return [normalize_linkedin_profile(item) for item in payload["items"] if isinstance(item, Mapping)]
            if payload:
                return [normalize_linkedin_profile(payload)]
            return []
