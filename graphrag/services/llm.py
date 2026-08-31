from __future__ import annotations

from collections import defaultdict, deque
import hashlib
import json
import logging
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx

from models import (
    CandidateProfileExtraction,
    JobProfileExtraction,
    LLMRerankResponse,
)


logger = logging.getLogger(__name__)


class LLMService:
    def __init__(
        self,
        base_url: str,
        chat_model: str,
        embedding_model: str,
        embedding_dimensions: int,
        provider: str = "ollama",
        api_key: str | None = None,
        enable_reasoning: bool = True,
        enable_call_logging: bool = False,
        call_log_path: str | None = None,
        enable_parse_latency_aggregation: bool = False,
        parse_latency_window_size: int = 200,
        parse_latency_log_every: int = 20,
    ) -> None:
        self.provider = provider.strip().lower()
        if self.provider == "openai":
            self.provider = "openrouter"
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.chat_model = chat_model
        self.embedding_model = embedding_model
        self.embedding_dimensions = embedding_dimensions
        self.enable_reasoning = enable_reasoning
        self.enable_call_logging = enable_call_logging
        self.call_log_path = Path(call_log_path).expanduser() if call_log_path else Path(__file__).resolve().parents[1] / "data" / "llm-calls.jsonl"
        self.enable_parse_latency_aggregation = enable_parse_latency_aggregation
        self.parse_latency_window_size = max(1, parse_latency_window_size)
        self.parse_latency_log_every = max(1, parse_latency_log_every)
        self._latency_samples: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self.parse_latency_window_size)
        )
        self._latency_counts: dict[str, int] = defaultdict(int)
        self._ai_call_count = 0
        self._input_tokens_total = 0
        self._output_tokens_total = 0
        self.client = httpx.AsyncClient(timeout=120.0)

    async def close(self) -> None:
        await self.client.aclose()

    def get_usage_metrics(self) -> dict[str, int]:
        return {
            "calls": self._ai_call_count,
            "input_tokens": self._input_tokens_total,
            "output_tokens": self._output_tokens_total,
            "total_tokens": self._input_tokens_total + self._output_tokens_total,
        }

    def _record_ai_usage(self, input_tokens: int | None = None, output_tokens: int | None = None) -> None:
        self._ai_call_count += 1
        if input_tokens is not None:
            self._input_tokens_total += max(0, int(input_tokens))
        if output_tokens is not None:
            self._output_tokens_total += max(0, int(output_tokens))

    def _append_call_log(self, entry: dict[str, Any]) -> None:
        if not self.enable_call_logging:
            return

        try:
            self.call_log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.call_log_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False, default=str))
                handle.write("\n")
        except Exception as exc:
            logger.warning("ai_call_log_write_failed path=%s error=%s", self.call_log_path, exc)

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _estimate_tokens(text: str | None) -> int:
        if not text:
            return 0
        return max(1, math.ceil(len(text) / 4))

    def _usage_from_payload(
        self,
        payload: dict[str, Any],
        *,
        input_fallback_text: str | None = None,
        output_fallback_text: str | None = None,
    ) -> tuple[int | None, int | None]:
        usage = payload.get("usage") if isinstance(payload, dict) else None
        input_tokens: int | None = None
        output_tokens: int | None = None

        if isinstance(usage, dict):
            input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens") or usage.get("prompt_eval_count")
            output_tokens = usage.get("completion_tokens") or usage.get("output_tokens") or usage.get("eval_count")

        if input_tokens is None:
            input_tokens = payload.get("prompt_eval_count") if isinstance(payload.get("prompt_eval_count"), int) else None
        if output_tokens is None:
            output_tokens = payload.get("eval_count") if isinstance(payload.get("eval_count"), int) else None

        if input_tokens is None:
            input_tokens = self._estimate_tokens(input_fallback_text)
        if output_tokens is None:
            output_tokens = self._estimate_tokens(output_fallback_text)

        return int(input_tokens or 0), int(output_tokens or 0)

    async def _generate_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        call_context: str = "llm-json",
        num_predict: int = 1200,
        required_keys: tuple[str, ...] = (),
        preferred_keys: tuple[str, ...] = (),
        min_preferred_key_matches: int = 0,
        use_reasoning: bool | None = None,
    ) -> dict[str, Any]:
        def _matches_required_keys(payload_obj: dict[str, Any]) -> bool:
            if not required_keys:
                return True
            return all(key in payload_obj for key in required_keys)

        def _extract_json_objects(raw: str | None) -> list[dict[str, Any]]:
            objects: list[dict[str, Any]] = []
            if not isinstance(raw, str):
                return objects
            text = raw.strip()
            if not text:
                return objects
            try:
                parsed_text = json.loads(text)
                if isinstance(parsed_text, dict):
                    objects.append(parsed_text)
            except json.JSONDecodeError:
                pass

            start = text.find("{")
            while start != -1:
                depth = 0
                for idx in range(start, len(text)):
                    char = text[idx]
                    if char == "{":
                        depth += 1
                    elif char == "}":
                        depth -= 1
                        if depth == 0:
                            fragment = text[start : idx + 1]
                            try:
                                parsed_fragment = json.loads(fragment)
                                if isinstance(parsed_fragment, dict):
                                    objects.append(parsed_fragment)
                            except json.JSONDecodeError:
                                break
                start = text.find("{", start + 1)

            # Deduplicate by serialized representation while preserving order.
            deduped: list[dict[str, Any]] = []
            seen: set[str] = set()
            for item in objects:
                marker = json.dumps(item, sort_keys=True, ensure_ascii=True)
                if marker in seen:
                    continue
                seen.add(marker)
                deduped.append(item)
            return deduped

        def _best_match(objects: list[dict[str, Any]]) -> dict[str, Any] | None:
            if not objects:
                return None
            matching = [obj for obj in objects if _matches_required_keys(obj)]
            if not matching:
                return None

            def _score(obj: dict[str, Any]) -> tuple[int, int]:
                preferred_match_count = sum(1 for key in preferred_keys if key in obj)
                return preferred_match_count, len(obj)

            if preferred_keys and min_preferred_key_matches > 0:
                matching = [
                    obj for obj in matching if sum(1 for key in preferred_keys if key in obj) >= min_preferred_key_matches
                ]
                if not matching:
                    return None

            return max(matching, key=_score)

        if self.provider == "openrouter":
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            request_url = f"{self.base_url}/chat/completions"
            request_body = {
                "model": self.chat_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Respond ONLY with valid JSON and no surrounding markdown.\n\nInput:\n{user_content}"},
                ],
                "temperature": 0,
                "max_tokens": num_predict,
                "reasoning": {"exclude": True},
            }
        else:
            headers = {}
            request_url = f"{self.base_url}/api/chat"
            request_body = {
                "model": self.chat_model,
                "think": self.enable_reasoning if use_reasoning is None else use_reasoning,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": (
                            "Respond ONLY with valid JSON and no surrounding markdown.\n\n"
                            f"Input:\n{user_content}"
                        ),
                    },
                ],
                "format": "json",
                "stream": False,
                "options": {
                    "temperature": 0,
                    "num_predict": num_predict,
                },
            }
        log_entry = {
            "ts": None,
            "context": call_context,
            "provider": self.provider,
            "model": self.chat_model,
            "request_url": request_url,
            "request_body": request_body,
        }
        started = perf_counter()
        try:
            response = await self.client.post(request_url, headers=headers, json=request_body)
            response.raise_for_status()
        except Exception as exc:
            self._append_call_log({
                **log_entry,
                "ts": self._utc_now_iso(),
                "duration_ms": (perf_counter() - started) * 1000,
                "success": False,
                "response_body": None,
                "parsed_result": None,
                "input_tokens": None,
                "output_tokens": None,
                "error_message": str(exc),
            })
            raise

        response_body = response.text
        try:
            payload = response.json()
        except Exception as exc:
            self._append_call_log({
                **log_entry,
                "ts": self._utc_now_iso(),
                "duration_ms": (perf_counter() - started) * 1000,
                "success": False,
                "response_body": response_body,
                "parsed_result": None,
                "input_tokens": None,
                "output_tokens": None,
                "error_message": f"invalid JSON response: {exc}",
            })
            raise ValueError(f"{self.provider} returned invalid JSON") from exc

        input_tokens, output_tokens = self._usage_from_payload(
            payload,
            input_fallback_text=user_content,
        )
        self._record_ai_usage(input_tokens, output_tokens)
        message = payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        response_text = payload.get("response")
        thinking = message.get("thinking") if isinstance(message, dict) else None
        if self.provider == "openrouter":
            choice = (payload.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            content = message.get("content")
            if isinstance(content, list):
                content = "\n".join(
                    part.get("text", "") if isinstance(part, dict) else str(part)
                    for part in content
                )
            reasoning_details = message.get("reasoning_details") or choice.get("reasoning_details") or []
            reasoning_parts = [
                part.get("text", "")
                for part in reasoning_details
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            thinking = message.get("reasoning") or choice.get("reasoning") or "\n".join(reasoning_parts)
            response_text = None

        non_reasoning_objects: list[dict[str, Any]] = []
        for raw in (content, response_text):
            non_reasoning_objects.extend(_extract_json_objects(raw))

        best_non_reasoning = _best_match(non_reasoning_objects)
        if best_non_reasoning is not None:
            self._append_call_log({
                **log_entry,
                "ts": self._utc_now_iso(),
                "duration_ms": (perf_counter() - started) * 1000,
                "success": True,
                "response_body": payload,
                "parsed_result": best_non_reasoning,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "error_message": None,
            })
            return best_non_reasoning

        # Fallback: some models only emit final JSON inside thinking.
        thinking_objects = _extract_json_objects(thinking)
        best_thinking = _best_match(thinking_objects)
        if best_thinking is not None:
            self._append_call_log({
                **log_entry,
                "ts": self._utc_now_iso(),
                "duration_ms": (perf_counter() - started) * 1000,
                "success": True,
                "response_body": payload,
                "parsed_result": best_thinking,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "error_message": None,
            })
            logger.warning("ai_json_from_thinking_fallback provider=%s", self.provider)
            return best_thinking

        if not isinstance(content, str) and not isinstance(response_text, str) and not isinstance(thinking, str):
            err = payload.get("error")
            if isinstance(err, str) and err.strip():
                self._append_call_log({
                    **log_entry,
                    "ts": self._utc_now_iso(),
                    "duration_ms": (perf_counter() - started) * 1000,
                    "success": False,
                    "response_body": payload,
                    "parsed_result": None,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "error_message": f"{self.provider} error: {err}",
                })
                raise ValueError(f"{self.provider} error: {err}")
            self._append_call_log({
                **log_entry,
                "ts": self._utc_now_iso(),
                "duration_ms": (perf_counter() - started) * 1000,
                "success": False,
                "response_body": payload,
                "parsed_result": None,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "error_message": f"{self.provider} returned no JSON response content",
            })
            raise ValueError(f"{self.provider} returned no JSON response content")

        self._append_call_log({
            **log_entry,
            "ts": self._utc_now_iso(),
            "duration_ms": (perf_counter() - started) * 1000,
            "success": False,
            "response_body": payload,
            "parsed_result": None,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "error_message": f"{self.provider} returned JSON response content that could not be parsed",
        })
        raise ValueError(f"{self.provider} returned JSON response content that could not be parsed")

    def _normalize_embedding(self, embedding: list[float]) -> list[float]:
        if len(embedding) >= self.embedding_dimensions:
            return embedding[: self.embedding_dimensions]
        return embedding + [0.0] * (self.embedding_dimensions - len(embedding))

    def _deterministic_fallback_embedding(self, payload_text: str) -> list[float]:
        values: list[float] = []
        seed = hashlib.sha256(payload_text.encode("utf-8")).digest()
        counter = 0
        while len(values) < self.embedding_dimensions:
            block = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
            for idx in range(0, len(block), 4):
                chunk = block[idx : idx + 4]
                as_int = int.from_bytes(chunk, "big", signed=False)
                values.append((as_int / 4294967295.0) * 2.0 - 1.0)
                if len(values) >= self.embedding_dimensions:
                    break
            counter += 1
        return values

    @staticmethod
    def _p95(values: list[float]) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = max(0, min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1))
        return ordered[index]

    def _record_parse_latency(self, parse_type: str, elapsed_ms: float) -> None:
        if not self.enable_parse_latency_aggregation:
            return
        samples = self._latency_samples[parse_type]
        samples.append(elapsed_ms)
        self._latency_counts[parse_type] += 1
        count = self._latency_counts[parse_type]
        if count % self.parse_latency_log_every != 0:
            return

        sample_list = list(samples)
        avg = sum(sample_list) / len(sample_list)
        p95 = self._p95(sample_list)
        logger.warning(
            "parse_latency_agg type=%s count=%d window=%d avg_ms=%.1f p95_ms=%.1f",
            parse_type,
            count,
            len(sample_list),
            avg,
            p95,
        )

    @staticmethod
    def _is_unreliable_candidate_name(value: str | None) -> bool:
        if value is None:
            return True
        name = value.strip()
        if len(name) < 3:
            return True
        if len(name.split()) > 4:
            return True

        lowered = name.lower()
        blocked = {
            "unknown",
            "candidate",
            "cv",
            "curriculum vitae",
            "lebenslauf",
            "resume",
            "profile",
            "profil",
            "n/a",
        }
        if any(token in lowered for token in blocked):
            return True
        job_title_tokens = {
            "developer",
            "engineer",
            "architect",
            "consultant",
            "specialist",
            "manager",
            "lead",
            "senior",
            "junior",
            "principal",
            "expert",
            "intern",
            "freelancer",
            "full stack",
            "fullstack",
            "backend",
            "frontend",
            "devops",
            "data engineer",
            ".net",
            "dotnet",
            "software",
            "it ",
        }
        if any(token in lowered for token in job_title_tokens):
            return True
        if any(ch.isdigit() for ch in name):
            return True
        if "@" in name:
            return True
        return False

    @staticmethod
    def _infer_candidate_name_from_text(raw_text: str) -> str | None:
        # Common CV pattern: "Name: Firstname Lastname"
        name_label_match = re.search(
            r"(?im)\bname\s*:\s*([A-Za-zÀ-ÖØ-öø-ÿ'\-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ'\-]+){1,3})\b",
            raw_text,
        )
        if name_label_match:
            return name_label_match.group(1).strip()

        # Common heading pattern with separators, e.g. "... — Stefan Baumgartner"
        dashed_match = re.search(
            r"(?m)[—\-]\s*([A-Za-zÀ-ÖØ-öø-ÿ'\-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ'\-]+){1,3})\s*$",
            raw_text,
        )
        if dashed_match:
            return dashed_match.group(1).strip()

        skip_tokens = {
            "curriculum vitae",
            "lebenslauf",
            "resume",
            "profile",
            "profil",
            "summary",
            "experience",
            "education",
            "skills",
            "contact",
            "kontakt",
        }
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        for line in lines[:20]:
            candidate = re.sub(r"\s+", " ", line)
            lowered = candidate.lower()
            if lowered in skip_tokens or any(token in lowered for token in skip_tokens):
                continue
            if len(candidate) < 3 or len(candidate) > 80:
                continue
            if re.search(r"\d|@|https?://|www\.", candidate, flags=re.IGNORECASE):
                continue
            if not re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ'\- ]+", candidate):
                continue

            parts = [part for part in candidate.split(" ") if part]
            if 2 <= len(parts) <= 4:
                return " ".join(parts)
        return None

    async def _extract_candidate_name(self, raw_text: str) -> str | None:
        parsed = await self._generate_json(
            system_prompt=(
                "Extract only the candidate's full personal name from this CV text. "
                "Return JSON exactly with key: name. "
                "Do not return role titles, department names, labels, or placeholders."
            ),
            user_content=raw_text,
            num_predict=120,
            required_keys=("name",),
            use_reasoning=False,
        )
        value = parsed.get("name")
        if isinstance(value, str):
            stripped = value.strip()
            return stripped if stripped else None
        return None

    @staticmethod
    def _normalize_candidate_skills(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, str):
            values: list[Any] = re.split(r"[,;|\n]+", value)
        elif isinstance(value, list):
            values = value
        else:
            return []

        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in values:
            if isinstance(item, str):
                name = item.strip()
                skill: dict[str, Any] = {"name": name}
            elif isinstance(item, dict):
                name = str(item.get("name") or item.get("skill") or item.get("skill_name") or "").strip()
                skill = {**item, "name": name}
            else:
                continue
            marker = name.casefold()
            if not name or marker in seen:
                continue
            seen.add(marker)
            category = skill.get("category")
            skill["category"] = category if category in {"HardSkill", "SoftSkill"} else None
            normalized.append(skill)
        return normalized

    @classmethod
    def _extract_candidate_skills_from_text(cls, raw_text: str) -> list[dict[str, Any]]:
        known_skills = (
            "Python", "Java", "JavaScript", "TypeScript", "C#", ".NET", "C++", "Go", "Rust",
            "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "AWS", "Azure", "GCP", "Docker",
            "Kubernetes", "Terraform", "Linux", "Git", "React", "Angular", "Vue", "Node.js",
            "FastAPI", "Django", "Spring", "SAP", "Salesforce", "Power BI", "Excel", "Jira",
        )
        lowered_text = raw_text.casefold()
        return [{"name": skill} for skill in known_skills if re.search(rf"(?<!\w){re.escape(skill.casefold())}(?!\w)", lowered_text)]

    @staticmethod
    def _normalize_date_string(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            return None

        lowered = normalized.casefold()
        if lowered in {"heute", "aktuell", "present", "current", "now"}:
            return None

        lowered = lowered.replace("bis ", "").strip()

        year_month_match = re.fullmatch(r"(?P<year>\d{4})[./-](?P<month>\d{1,2})", lowered)
        if year_month_match:
            return f"{int(year_month_match.group('year')):04d}-{int(year_month_match.group('month')):02d}"

        month_year_match = re.fullmatch(r"(?P<month>\d{1,2})[./-](?P<year>\d{4})", lowered)
        if month_year_match:
            return f"{int(month_year_match.group('year')):04d}-{int(month_year_match.group('month')):02d}"

        year_match = re.fullmatch(r"(?P<year>\d{4})", lowered)
        if year_match:
            return f"{int(year_match.group('year')):04d}-01"

        return normalized

    @classmethod
    def _parse_work_history_line(cls, line: str) -> dict[str, Any] | None:
        candidate = line.strip(" •●○\t")
        if not candidate:
            return None

        since_match = re.match(
            r"^(?:seit\s+)?(?P<from>\d{4}(?:[./-]\d{1,2})?|\d{1,2}[./-]\d{4})\s*(?:[-–—]|bis)\s*(?P<to>heute|aktuell|present|current|now|\d{4}(?:[./-]\d{1,2})?|\d{1,2}[./-]\d{4})\s*[:;\-–—]?\s*(?P<rest>.*)$",
            candidate,
            flags=re.IGNORECASE,
        )
        if since_match:
            from_date = cls._normalize_date_string(since_match.group("from"))
            to_raw = since_match.group("to")
            is_current = str(to_raw).strip().casefold() in {"heute", "aktuell", "present", "current", "now"}
            to_date = None if is_current else cls._normalize_date_string(to_raw)
            rest = since_match.group("rest").strip()
            parts = [part.strip(" ,;\t") for part in re.split(r"\s*,\s*", rest) if part.strip(" ,;\t")]
            position = parts[0] if parts else None
            employer = parts[1] if len(parts) > 1 else None
            location = ", ".join(parts[2:]) if len(parts) > 2 else None
            return {
                "position": position,
                "employer": employer,
                "from_date": from_date,
                "to_date": to_date,
                "is_current": is_current,
                "description": None,
                "location": location,
            }

        range_match = re.match(
            r"^(?P<from>\d{4}(?:[./-]\d{1,2})?|\d{1,2}[./-]\d{4})\s*(?:[-–—]|bis)\s*(?P<to>heute|aktuell|present|current|now|\d{4}(?:[./-]\d{1,2})?|\d{1,2}[./-]\d{4})\s*[:;\-–—]?\s*(?P<rest>.*)$",
            candidate,
            flags=re.IGNORECASE,
        )
        if not range_match:
            return None

        from_date = cls._normalize_date_string(range_match.group("from"))
        to_raw = range_match.group("to")
        is_current = str(to_raw).strip().casefold() in {"heute", "aktuell", "present", "current", "now"}
        to_date = None if is_current else cls._normalize_date_string(to_raw)
        rest = range_match.group("rest").strip()
        parts = [part.strip(" ,;\t") for part in re.split(r"\s*,\s*", rest) if part.strip(" ,;\t")]
        position = parts[0] if parts else None
        employer = parts[1] if len(parts) > 1 else None
        location = ", ".join(parts[2:]) if len(parts) > 2 else None

        return {
            "position": position,
            "employer": employer,
            "from_date": from_date,
            "to_date": to_date,
            "is_current": is_current,
            "description": None,
            "location": location,
        }

    @classmethod
    def _merge_work_history_dates(
        cls,
        existing_entries: list[dict[str, Any]],
        recovered_entries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not existing_entries or not recovered_entries:
            return existing_entries

        merged_entries: list[dict[str, Any]] = []
        used_recovered_indexes: set[int] = set()

        def _key(value: Any) -> str:
            return str(value or "").strip().casefold()

        for index, entry in enumerate(existing_entries):
            if not isinstance(entry, dict):
                merged_entries.append(entry)
                continue

            candidate_index: int | None = None
            entry_employer = _key(entry.get("employer"))
            entry_position = _key(entry.get("position"))

            for recovered_index, recovered in enumerate(recovered_entries):
                if recovered_index in used_recovered_indexes:
                    continue
                if not isinstance(recovered, dict):
                    continue

                recovered_employer = _key(recovered.get("employer"))
                recovered_position = _key(recovered.get("position"))

                if entry_employer and recovered_employer and entry_employer == recovered_employer:
                    candidate_index = recovered_index
                    break
                if entry_position and recovered_position and entry_position == recovered_position:
                    candidate_index = recovered_index
                    break

            if candidate_index is None and index < len(recovered_entries) and index not in used_recovered_indexes:
                candidate_index = index

            recovered = recovered_entries[candidate_index] if candidate_index is not None else None
            if candidate_index is not None:
                used_recovered_indexes.add(candidate_index)

            if isinstance(recovered, dict):
                merged_entry = dict(entry)
                for field in ("employer", "position", "from_date", "to_date", "is_current", "description", "location"):
                    current_value = merged_entry.get(field)
                    recovered_value = recovered.get(field)
                    if field == "is_current":
                        if recovered_value is True:
                            merged_entry[field] = True
                        continue
                    if current_value in (None, "") and recovered_value not in (None, ""):
                        merged_entry[field] = recovered_value
                if merged_entry.get("from_date"):
                    merged_entry["from_date"] = cls._normalize_date_string(merged_entry["from_date"])
                if merged_entry.get("to_date"):
                    merged_entry["to_date"] = cls._normalize_date_string(merged_entry["to_date"])
                if merged_entry.get("is_current") is None:
                    merged_entry["is_current"] = bool(recovered.get("is_current"))
                merged_entries.append(merged_entry)
            else:
                merged_entries.append(entry)

        return merged_entries

    @classmethod
    def _parse_education_history_line(cls, line: str) -> dict[str, Any] | None:
        candidate = line.strip(" •●○\t")
        if not candidate:
            return None

        match = re.match(
            r"^(?P<from>\d{4}(?:[./-]\d{1,2})?|\d{1,2}[./-]\d{4})\s*(?:[-–—]|bis)\s*(?P<to>\d{4}(?:[./-]\d{1,2})?|\d{1,2}[./-]\d{4}|heute|aktuell|present|current|now)\s*[:;\-–—]?\s*(?P<rest>.*)$",
            candidate,
            flags=re.IGNORECASE,
        )
        if not match:
            return None

        from_date = cls._normalize_date_string(match.group("from"))
        to_raw = match.group("to")
        is_current = str(to_raw).strip().casefold() in {"heute", "aktuell", "present", "current", "now"}
        to_date = None if is_current else cls._normalize_date_string(to_raw)
        rest = match.group("rest").strip()
        parts = [part.strip(" ,;\t") for part in re.split(r"\s*,\s*", rest) if part.strip(" ,;\t")]

        degree = parts[0] if parts else None
        institution = parts[-1] if parts else None
        field_of_study = None
        if len(parts) >= 3:
            field_of_study = " ".join(parts[1:-1]).strip() or None
        elif len(parts) == 2:
            field_of_study = parts[1] or None

        return {
            "institution": institution,
            "degree": degree,
            "field_of_study": field_of_study,
            "from_date": from_date,
            "to_date": to_date,
            "description": None,
        }

    @classmethod
    def _merge_education_history_dates(
        cls,
        existing_entries: list[dict[str, Any]],
        recovered_entries: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not existing_entries or not recovered_entries:
            return existing_entries

        merged_entries: list[dict[str, Any]] = []
        used_recovered_indexes: set[int] = set()

        def _key(value: Any) -> str:
            return str(value or "").strip().casefold()

        for index, entry in enumerate(existing_entries):
            if not isinstance(entry, dict):
                merged_entries.append(entry)
                continue

            candidate_index: int | None = None
            entry_institution = _key(entry.get("institution"))
            entry_degree = _key(entry.get("degree"))
            entry_field = _key(entry.get("field_of_study"))

            for recovered_index, recovered in enumerate(recovered_entries):
                if recovered_index in used_recovered_indexes or not isinstance(recovered, dict):
                    continue

                recovered_institution = _key(recovered.get("institution"))
                recovered_degree = _key(recovered.get("degree"))
                recovered_field = _key(recovered.get("field_of_study"))

                if entry_institution and recovered_institution and entry_institution == recovered_institution:
                    candidate_index = recovered_index
                    break
                if entry_degree and recovered_degree and entry_degree == recovered_degree:
                    candidate_index = recovered_index
                    break
                if entry_field and recovered_field and entry_field == recovered_field:
                    candidate_index = recovered_index
                    break

            if candidate_index is None and index < len(recovered_entries) and index not in used_recovered_indexes:
                candidate_index = index

            recovered = recovered_entries[candidate_index] if candidate_index is not None else None
            if candidate_index is not None:
                used_recovered_indexes.add(candidate_index)

            if isinstance(recovered, dict):
                merged_entry = dict(entry)
                for field in ("institution", "degree", "field_of_study", "from_date", "to_date", "description"):
                    current_value = merged_entry.get(field)
                    recovered_value = recovered.get(field)
                    if current_value in (None, "") and recovered_value not in (None, ""):
                        merged_entry[field] = recovered_value
                if merged_entry.get("from_date"):
                    merged_entry["from_date"] = cls._normalize_date_string(merged_entry["from_date"])
                if merged_entry.get("to_date"):
                    merged_entry["to_date"] = cls._normalize_date_string(merged_entry["to_date"])
                merged_entries.append(merged_entry)
            else:
                merged_entries.append(entry)

        return merged_entries

    @staticmethod
    def _extract_work_history_from_text(raw_text: str) -> list[dict[str, Any]]:
        lines = [line.strip(" •\t") for line in raw_text.splitlines()]
        normalized_lines = [line for line in lines if line]
        if not normalized_lines:
            return []

        section_markers = (
            "praktische industrie",
            "berufliche tätigkeiten",
            "beruflicher werdegang",
            "berufserfahrung",
            "professional experience",
            "work experience",
            "experience",
        )
        start_index: int | None = None
        for idx, line in enumerate(normalized_lines):
            lowered = line.casefold()
            if any(marker in lowered for marker in section_markers):
                start_index = idx
                break

        if start_index is None:
            return []

        heading_pattern = re.compile(r"^(\d+[\.)]?\s+)?[A-ZÄÖÜ].{2,80}$")
        entries: list[dict[str, Any]] = []
        current_entry: dict[str, Any] | None = None

        def flush_current() -> None:
            nonlocal current_entry
            if current_entry and (current_entry.get("employer") or current_entry.get("position") or current_entry.get("description")):
                entries.append(current_entry)
            current_entry = None

        for line in normalized_lines[start_index + 1 :]:
            lowered = line.casefold()
            if lowered.startswith(("4.", "5.", "6.", "7.", "8.", "9.", "10.", "11.", "12.")):
                break
            if "kompetenzmatrix" in lowered or "sprachkompetenzen" in lowered or "projektportfolio" in lowered or "referenzen" in lowered:
                break

            if not line or len(line) > 180:
                continue

            parsed_entry = LLMService._parse_work_history_line(line)
            if parsed_entry is not None:
                flush_current()
                current_entry = parsed_entry
                continue

            if line.startswith("-") or line.startswith("•"):
                if current_entry and line.strip():
                    description = current_entry.get("description")
                    current_entry["description"] = f"{description}\n{line.lstrip('-• ').strip()}".strip() if description else line.lstrip('-• ').strip()
                continue

            if "," in line and not any(ch in line for ch in (":", "?", "!")) and heading_pattern.match(line):
                parts = [part.strip() for part in line.split(",") if part.strip()]
                if len(parts) >= 2:
                    flush_current()
                    position = parts[0]
                    employer = parts[1]
                    location = ", ".join(parts[2:]) if len(parts) > 2 else None
                    current_entry = {
                        "position": position,
                        "employer": employer,
                        "from_date": None,
                        "to_date": None,
                        "is_current": len(entries) == 0,
                        "description": None,
                        "location": location,
                    }
                    continue

            if current_entry:
                description = current_entry.get("description")
                current_entry["description"] = f"{description}\n{line}".strip() if description else line

        flush_current()
        return [entry for entry in entries if entry.get("employer") or entry.get("position")]

    @staticmethod
    def _extract_education_history_from_text(raw_text: str) -> list[dict[str, Any]]:
        lines = [line.strip(" •\t") for line in raw_text.splitlines()]
        normalized_lines = [line for line in lines if line]
        if not normalized_lines:
            return []

        section_markers = (
            "ausbildung & weiterbildung",
            "ausbildung",
            "studium",
            "education",
            "education & training",
        )
        start_index: int | None = None
        for idx, line in enumerate(normalized_lines):
            lowered = line.casefold()
            if any(marker in lowered for marker in section_markers):
                start_index = idx
                break

        if start_index is None:
            return []

        entries: list[dict[str, Any]] = []
        current_entry: dict[str, Any] | None = None

        def flush_current() -> None:
            nonlocal current_entry
            if current_entry and (current_entry.get("institution") or current_entry.get("degree") or current_entry.get("field_of_study") or current_entry.get("description")):
                entries.append(current_entry)
            current_entry = None

        for line in normalized_lines[start_index + 1 :]:
            lowered = line.casefold()
            if lowered.startswith(("4.", "5.", "6.", "7.", "8.", "9.", "10.", "11.", "12.")):
                break
            if "berufliche tätigkeiten" in lowered or "beruflicher werdegang" in lowered or "berufserfahrung" in lowered or "kompetenzmatrix" in lowered or "sprachkompetenzen" in lowered or "projektportfolio" in lowered or "referenzen" in lowered:
                break

            if not line or len(line) > 180:
                continue

            parsed_entry = LLMService._parse_education_history_line(line)
            if parsed_entry is not None:
                flush_current()
                current_entry = parsed_entry
                continue

            if line.startswith("-") or line.startswith("•"):
                if current_entry and line.strip():
                    description = current_entry.get("description")
                    current_entry["description"] = f"{description}\n{line.lstrip('-• ').strip()}".strip() if description else line.lstrip('-• ').strip()
                continue

            if current_entry:
                description = current_entry.get("description")
                current_entry["description"] = f"{description}\n{line}".strip() if description else line

        flush_current()
        return [entry for entry in entries if entry.get("institution") or entry.get("degree") or entry.get("field_of_study")]

    async def parse_candidate_cv(self, raw_text: str) -> CandidateProfileExtraction:
        start = perf_counter()
        try:
            parsed = await self._generate_json(
                system_prompt=(
                    "Extract a candidate profile from CV/resume text. "
                    "The field name must be the candidate's full personal name from the CV header/title, "
                    "not a role title, company name, or generic label. "
                    "Work history is the most important part of this extraction. "
                    "Return JSON with keys: name, email, phone, location, experience, education, certificates, drivers_license, mobility, desired_salary, availability, notice_period, linkedin_url, xing_url, github_url, portfolio_url, tags, notes, experience_years, salary_expectation, skills, languages, educations, industries, work_history, education_history, current_employer, current_position, preferred_roles. "
                    "Always extract work_history as a list of one object per job station from the professional experience section. "
                    "Split free-text career sections into separate stations when the CV lists multiple employers or roles. "
                    "For each station, include employer, position, from_date, to_date, is_current, description, and location when available. "
                    "If exact dates are missing, keep the station and use null for unknown dates. "
                    "Use current_employer and current_position from the newest station. "
                    "Do not collapse the career section into the experience summary. experience should be only a short 2-3 sentence summary. "
                    "Normalize names to concise terms and use null for unknown values."
                ),
                user_content=raw_text,
                call_context="cv-parser:full",
                num_predict=1200,
                required_keys=("name",),
                preferred_keys=(
                    "name",
                    "email",
                    "phone",
                    "location",
                    "experience",
                    "education",
                    "certificates",
                    "drivers_license",
                    "mobility",
                    "desired_salary",
                    "availability",
                    "notice_period",
                    "linkedin_url",
                    "xing_url",
                    "github_url",
                    "portfolio_url",
                    "tags",
                    "notes",
                    "experience_years",
                    "salary_expectation",
                    "skills",
                    "languages",
                    "educations",
                    "industries",
                        "work_history",
                        "education_history",
                        "current_employer",
                        "current_position",
                    "preferred_roles",
                ),
                min_preferred_key_matches=0,
                use_reasoning=False,
            )
        except Exception as exc:
            logger.warning("parse_candidate_cv: full parse failed, trying lightweight fallback: %s", exc)
            try:
                parsed = await self._generate_json(
                    system_prompt=(
                        "Extract core candidate data from CV text. "
                        "Return JSON with keys: name, location, experience_years, skills, preferred_roles. "
                        "Name must be the person's full name, not a role or generic label."
                    ),
                    user_content=raw_text,
                    call_context="cv-parser:fallback",
                    num_predict=500,
                    required_keys=("name",),
                    preferred_keys=("name", "location", "experience_years", "skills", "preferred_roles"),
                    min_preferred_key_matches=0,
                    use_reasoning=False,
                )

                parsed = {
                    "name": parsed.get("name"),
                    "email": parsed.get("email"),
                    "phone": parsed.get("phone"),
                    "location": parsed.get("location"),
                    "experience": parsed.get("experience"),
                    "education": parsed.get("education"),
                    "certificates": parsed.get("certificates"),
                    "drivers_license": parsed.get("drivers_license"),
                    "mobility": parsed.get("mobility"),
                    "desired_salary": parsed.get("desired_salary"),
                    "availability": parsed.get("availability"),
                    "notice_period": parsed.get("notice_period"),
                    "linkedin_url": parsed.get("linkedin_url"),
                    "xing_url": parsed.get("xing_url"),
                    "github_url": parsed.get("github_url"),
                    "portfolio_url": parsed.get("portfolio_url"),
                    "tags": parsed.get("tags"),
                    "notes": parsed.get("notes"),
                    "experience_years": parsed.get("experience_years"),
                    "salary_expectation": None,
                    "skills": parsed.get("skills") if isinstance(parsed.get("skills"), list) else [],
                    "languages": [],
                    "educations": [],
                    "industries": [],
                    "preferred_roles": (
                        parsed.get("preferred_roles") if isinstance(parsed.get("preferred_roles"), list) else []
                    ),
                }
            except Exception as fallback_exc:
                logger.warning(
                    "parse_candidate_cv: lightweight fallback also failed, using text-derived minimal profile: %s",
                    fallback_exc,
                )
                parsed = {
                    "name": self._infer_candidate_name_from_text(raw_text) or "Unknown Candidate",
                    "email": None,
                    "phone": None,
                    "location": None,
                    "experience": None,
                    "education": None,
                    "certificates": None,
                    "drivers_license": None,
                    "mobility": None,
                    "desired_salary": None,
                    "availability": None,
                    "notice_period": None,
                    "linkedin_url": None,
                    "xing_url": None,
                    "github_url": None,
                    "portfolio_url": None,
                    "tags": None,
                    "notes": None,
                    "experience_years": None,
                    "salary_expectation": None,
                    "skills": [],
                    "languages": [],
                    "educations": [],
                    "industries": [],
                    "preferred_roles": [],
                }

        if not isinstance(parsed, dict):
            parsed = {"name": self._infer_candidate_name_from_text(raw_text) or "Unknown Candidate"}
        elif not parsed.get("name"):
            parsed["name"] = self._infer_candidate_name_from_text(raw_text) or "Unknown Candidate"
        parsed["skills"] = self._normalize_candidate_skills(parsed.get("skills"))
        if not parsed["skills"]:
            parsed["skills"] = self._extract_candidate_skills_from_text(raw_text)
            if parsed["skills"]:
                logger.warning("parse_candidate_cv: recovered skills from raw CV text count=%d", len(parsed["skills"]))

        recovered_work_history = self._extract_work_history_from_text(raw_text)
        if not parsed.get("work_history"):
            parsed["work_history"] = recovered_work_history
            if parsed["work_history"]:
                logger.warning(
                    "parse_candidate_cv: recovered work history from raw CV text count=%d",
                    len(parsed["work_history"]),
                )
        elif recovered_work_history:
            merged_work_history = self._merge_work_history_dates(parsed.get("work_history") or [], recovered_work_history)
            if merged_work_history != parsed.get("work_history"):
                parsed["work_history"] = merged_work_history
                logger.warning(
                    "parse_candidate_cv: recovered work history dates from raw CV text count=%d",
                    len(merged_work_history),
                )

        recovered_education_history = self._extract_education_history_from_text(raw_text)
        if not parsed.get("education_history"):
            parsed["education_history"] = recovered_education_history
            if parsed["education_history"]:
                logger.warning(
                    "parse_candidate_cv: recovered education history from raw CV text count=%d",
                    len(parsed["education_history"]),
                )
        elif recovered_education_history:
            merged_education_history = self._merge_education_history_dates(parsed.get("education_history") or [], recovered_education_history)
            if merged_education_history != parsed.get("education_history"):
                parsed["education_history"] = merged_education_history
                logger.warning(
                    "parse_candidate_cv: recovered education history dates from raw CV text count=%d",
                    len(merged_education_history),
                )

        if parsed.get("work_history") and not parsed.get("current_employer") and not parsed.get("current_position"):
            first_entry = parsed["work_history"][0]
            parsed["current_employer"] = first_entry.get("employer")
            parsed["current_position"] = first_entry.get("position")
        result = CandidateProfileExtraction.model_validate(parsed)
        if self._is_unreliable_candidate_name(result.name):
            recovered_name: str | None = None
            try:
                recovered_name = await self._extract_candidate_name(raw_text)
            except Exception:
                recovered_name = None

            if self._is_unreliable_candidate_name(recovered_name):
                recovered_name = self._infer_candidate_name_from_text(raw_text)

            if not self._is_unreliable_candidate_name(recovered_name):
                logger.warning(
                    "parse_candidate_cv: replaced unreliable name %r with recovered name %r",
                    result.name,
                    recovered_name,
                )
                result.name = recovered_name or result.name

        elapsed_ms = (perf_counter() - start) * 1000
        logger.warning(
            "parse_candidate_cv completed in %.1f ms (input_chars=%d, skills=%d, languages=%d, educations=%d, industries=%d)",
            elapsed_ms,
            len(raw_text),
            len(result.skills),
            len(result.languages),
            len(result.educations),
            len(result.industries),
        )
        self._record_parse_latency("candidate", elapsed_ms)
        return result

    async def parse_job_description(self, raw_text: str) -> JobProfileExtraction:
        start = perf_counter()
        try:
            parsed = await self._generate_json(
                system_prompt=(
                    "Extract a job profile from a job description. "
                    "Return JSON with keys: title (string), company (string|null), recruiter_company (string|null), employer_company (string|null), "
                    "location (string|null), employment_type (string|null), department (string|null), about_us (string|null), description (string|null), requirements (string|null), benefits (string|null), "
                    "required_skills (array of objects with name, category=HardSkill|SoftSkill|null, "
                    "priority where priority is exactly Mandatory or NiceToHave), "
                    "required_languages (array of objects with name, level), "
                    "required_degrees (array of objects with level, field_of_study), "
                    "industries (array of objects with name)."
                ),
                user_content=raw_text,
                call_context="job-parser:full",
                num_predict=1200,
                required_keys=(
                    "title",
                ),
                preferred_keys=(
                    "title",
                    "company",
                    "location",
                    "employment_type",
                    "department",
                    "about_us",
                    "description",
                    "requirements",
                    "benefits",
                    "required_skills",
                    "required_languages",
                    "required_degrees",
                    "industries",
                ),
                min_preferred_key_matches=0,
                use_reasoning=False,
            )
            if not isinstance(parsed, dict):
                raise ValueError("job parser returned no structured JSON")
        except Exception as exc:
            logger.warning("parse_job_description: full parse failed, trying lightweight fallback: %s", exc)
            try:
                parsed = await self._generate_json(
                    system_prompt=(
                        "Extract core job data from a job description. "
                        "Return JSON with keys: title, company, recruiter_company, employer_company, location, required_skills, required_languages. "
                        "For required_skills include priority exactly as Mandatory or NiceToHave."
                    ),
                    user_content=raw_text,
                    call_context="job-parser:fallback",
                    num_predict=700,
                    required_keys=("title",),
                    preferred_keys=("title", "company", "location", "required_skills", "required_languages"),
                    min_preferred_key_matches=0,
                    use_reasoning=False,
                )
                if not isinstance(parsed, dict):
                    raise ValueError("job parser fallback returned no structured JSON")

                parsed = {
                    "title": parsed.get("title") or "Unknown Job",
                    "company": parsed.get("company"),
                    "recruiter_company": parsed.get("recruiter_company"),
                    "employer_company": parsed.get("employer_company"),
                    "location": parsed.get("location"),
                    "employment_type": parsed.get("employment_type"),
                    "department": parsed.get("department"),
                    "about_us": parsed.get("about_us"),
                    "description": parsed.get("description"),
                    "requirements": parsed.get("requirements"),
                    "benefits": parsed.get("benefits"),
                    "required_skills": (
                        parsed.get("required_skills") if isinstance(parsed.get("required_skills"), list) else []
                    ),
                    "required_languages": (
                        parsed.get("required_languages") if isinstance(parsed.get("required_languages"), list) else []
                    ),
                    "required_degrees": (
                        parsed.get("required_degrees") if isinstance(parsed.get("required_degrees"), list) else []
                    ),
                    "industries": parsed.get("industries") if isinstance(parsed.get("industries"), list) else [],
                }
            except Exception as fallback_exc:
                logger.warning(
                    "parse_job_description: lightweight fallback also failed, using text-derived minimal profile: %s",
                    fallback_exc,
                )
                parsed = {
                    "title": "Unknown Job",
                    "company": None,
                    "recruiter_company": None,
                    "employer_company": None,
                    "location": None,
                    "employment_type": None,
                    "department": None,
                    "about_us": None,
                    "description": None,
                    "requirements": None,
                    "benefits": None,
                    "required_skills": [],
                    "required_languages": [],
                    "required_degrees": [],
                    "industries": [],
                }
        result = JobProfileExtraction.model_validate(parsed)
        elapsed_ms = (perf_counter() - start) * 1000
        logger.warning(
            "parse_job_description completed in %.1f ms (input_chars=%d, required_skills=%d, required_languages=%d, required_degrees=%d, industries=%d)",
            elapsed_ms,
            len(raw_text),
            len(result.required_skills),
            len(result.required_languages),
            len(result.required_degrees),
            len(result.industries),
        )
        self._record_parse_latency("job", elapsed_ms)
        return result

    async def create_embedding(self, payload: dict[str, Any]) -> list[float]:
        payload_text = json.dumps(payload, sort_keys=True, ensure_ascii=True)
        try:
            if self.provider == "openrouter":
                response = await self.client.post(
                    f"{self.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                    json={"model": self.embedding_model, "input": payload_text},
                )
            else:
                response = await self.client.post(
                    f"{self.base_url}/api/embeddings",
                    json={"model": self.embedding_model, "prompt": payload_text},
                )
            response.raise_for_status()
            data = response.json()
            input_tokens, output_tokens = self._usage_from_payload(
                data,
                input_fallback_text=payload_text,
            )
            self._record_ai_usage(input_tokens, output_tokens)
            embedding = data.get("embedding")
            if self.provider == "openrouter":
                embedding = (data.get("data") or [{}])[0].get("embedding")
            if isinstance(embedding, list) and embedding:
                return self._normalize_embedding([float(item) for item in embedding])
        except Exception:
            pass
        return self._deterministic_fallback_embedding(payload_text)

    async def rerank_candidates(
        self,
        job_profile: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> LLMRerankResponse:
        parsed = await self._generate_json(
            system_prompt=(
                "You are an HR matching assistant. Score candidates from 1-100 based on fit. "
                "Return JSON with key ranked_candidates containing objects with candidate_id, "
                "score, and explanation. Keep explanations concise and factual."
            ),
            user_content=json.dumps(
                {
                    "job_profile": job_profile,
                    "candidates": candidates,
                },
                ensure_ascii=True,
            ),
            call_context="matching:rerank",
            num_predict=900,
            required_keys=("ranked_candidates",),
        )
        validated = LLMRerankResponse.model_validate(parsed)
        validated.ranked_candidates.sort(key=lambda item: item.score, reverse=True)
        return validated
