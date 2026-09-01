from __future__ import annotations

from collections import defaultdict, deque
import asyncio
import hashlib
import json
import logging
import math
import re
from time import perf_counter
from typing import Any

import httpx
from services.postgres_store import PostgresStore

from models import (
    CandidateProfileExtraction,
    JobProfileExtraction,
    LLMRerankResponse,
)


logger = logging.getLogger(__name__)

_CURRENT_DATE_TOKENS = {"heute", "present", "today", "now", "aktuell", "current"}
_DATE_RANGE_PATTERN = re.compile(r"(\d{4})\s*[\u2013\u2014-]\s*(heute|present|today|now|aktuell|current|\d{4})", re.IGNORECASE)


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
        enable_parse_latency_aggregation: bool = False,
        parse_latency_window_size: int = 200,
        parse_latency_log_every: int = 20,
        enable_call_logging: bool = False,
        database_url: str | None = None,
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
        self.enable_parse_latency_aggregation = enable_parse_latency_aggregation
        self.parse_latency_window_size = max(1, parse_latency_window_size)
        self.parse_latency_log_every = max(1, parse_latency_log_every)
        self.enable_call_logging = enable_call_logging
        self.postgres_store = PostgresStore(database_url) if database_url else None
        self._latency_samples: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self.parse_latency_window_size)
        )
        self._latency_counts: dict[str, int] = defaultdict(int)
        self.client = httpx.AsyncClient(timeout=120.0)

    async def close(self) -> None:
        await self.client.aclose()

    @staticmethod
    def _extract_skill_names(parsed_result: dict[str, Any] | None) -> str | None:
        if not isinstance(parsed_result, dict):
            return None

        skill_items = parsed_result.get("required_skills") or parsed_result.get("skills")
        if not isinstance(skill_items, list):
            return None

        names: list[str] = []
        for skill in skill_items:
            if isinstance(skill, str):
                name = skill.strip()
            elif isinstance(skill, dict):
                name = str(skill.get("name") or skill.get("label") or skill.get("skill") or "").strip()
            else:
                name = ""
            if name and name not in names:
                names.append(name)
        return ", ".join(names) or None

    async def _write_call_log(
        self,
        *,
        feature: str,
        system_prompt: str,
        user_content: str,
        response_text: str | None,
        parsed_result: dict[str, Any] | None,
        duration_ms: float,
        input_tokens: int | None,
        output_tokens: int | None,
        success: bool,
        error_message: str | None,
    ) -> None:
        if not self.enable_call_logging or self.postgres_store is None:
            return

        prompt_payload = json.dumps(
            {
                "model": self.chat_model,
                "system_prompt": system_prompt,
                "user_content": user_content,
            },
            ensure_ascii=False,
        )
        response_payload = json.dumps({"response": response_text}, ensure_ascii=False) if response_text is not None else None
        parsed_payload = json.dumps(parsed_result, ensure_ascii=False) if parsed_result is not None else None
        skills_payload = self._extract_skill_names(parsed_result)
        prompt_hash = hashlib.sha256(prompt_payload.encode("utf-8")).hexdigest()[:16]

        await self.postgres_store.write_ai_log(
            (
                None,
                feature,
                self.chat_model,
                None,
                prompt_hash,
                prompt_payload,
                response_payload,
                parsed_payload,
                skills_payload,
                int(duration_ms),
                input_tokens,
                output_tokens,
                1 if success else 0,
                error_message,
            )
        )

    async def _generate_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        num_predict: int = 1200,
        required_keys: tuple[str, ...] = (),
        preferred_keys: tuple[str, ...] = (),
        min_preferred_key_matches: int = 0,
        call_context: str | None = None,
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
                # "exclude" only hides reasoning from the response but still burns completion
                # tokens on hidden thinking, which truncated JSON output for longer CVs.
                # "enabled": False actually turns reasoning generation off.
                "reasoning": {"enabled": False},
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
        start = perf_counter()
        feature = call_context or "llm-call"
        response_text_for_log: str | None = None
        input_tokens: int | None = None
        output_tokens: int | None = None

        try:
            response = await self.client.post(request_url, headers=headers, json=request_body)
            response.raise_for_status()

            payload = response.json()
            message = payload.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            response_text = payload.get("response")
            thinking = message.get("thinking") if isinstance(message, dict) else None
            usage = payload.get("usage") if isinstance(payload, dict) else None
            if isinstance(usage, dict):
                input_tokens = usage.get("prompt_tokens")
                output_tokens = usage.get("completion_tokens")

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

            response_text_for_log = (
                response_text
                if isinstance(response_text, str)
                else content
                if isinstance(content, str)
                else thinking
                if isinstance(thinking, str)
                else None
            )

            non_reasoning_objects: list[dict[str, Any]] = []
            for raw in (content, response_text):
                non_reasoning_objects.extend(_extract_json_objects(raw))

            best_non_reasoning = _best_match(non_reasoning_objects)
            if best_non_reasoning is not None:
                await self._write_call_log(
                    feature=feature,
                    system_prompt=system_prompt,
                    user_content=user_content,
                    response_text=response_text_for_log,
                    parsed_result=best_non_reasoning,
                    duration_ms=(perf_counter() - start) * 1000,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    success=True,
                    error_message=None,
                )
                return best_non_reasoning

            thinking_objects = _extract_json_objects(thinking)
            best_thinking = _best_match(thinking_objects)
            if best_thinking is not None:
                logger.warning("ai_json_from_thinking_fallback provider=%s", self.provider)
                await self._write_call_log(
                    feature=feature,
                    system_prompt=system_prompt,
                    user_content=user_content,
                    response_text=response_text_for_log,
                    parsed_result=best_thinking,
                    duration_ms=(perf_counter() - start) * 1000,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    success=True,
                    error_message=None,
                )
                return best_thinking

            if not isinstance(content, str) and not isinstance(response_text, str) and not isinstance(thinking, str):
                err = payload.get("error")
                if isinstance(err, str) and err.strip():
                    raise ValueError(f"{self.provider} error: {err}")
                raise ValueError(f"{self.provider} returned no JSON response content")
            raise ValueError(f"{self.provider} returned no usable JSON response")
        except Exception as exc:
            await self._write_call_log(
                feature=feature,
                system_prompt=system_prompt,
                user_content=user_content,
                response_text=response_text_for_log,
                parsed_result=None,
                duration_ms=(perf_counter() - start) * 1000,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                success=False,
                error_message=str(exc),
            )
            raise

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
            "expérience",
            "formation",
            "compétences",
            "langues",
            "à propos",
            "esperienza",
            "formazione",
            "competenze",
            "profilo",
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
            call_context="candidate-parser",
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
    def _find_date_range_near(raw_text: str, *needles: str | None) -> tuple[str | None, str | None, bool]:
        """Find a 'YYYY-YYYY' or 'YYYY-heute' style date range on a line mentioning one of the needles."""
        candidates = [needle.strip().lower() for needle in needles if isinstance(needle, str) and needle.strip()]
        if not candidates:
            return None, None, False

        for line in raw_text.splitlines():
            lowered_line = line.lower()
            if not any(needle in lowered_line for needle in candidates):
                continue
            match = _DATE_RANGE_PATTERN.search(line)
            if not match:
                continue
            start_year, end_token = match.group(1), match.group(2)
            from_date = f"{start_year}-01"
            if end_token.lower() in _CURRENT_DATE_TOKENS:
                return from_date, None, True
            return from_date, f"{end_token}-01", False
        return None, None, False

    async def parse_candidate_cv(self, raw_text: str) -> CandidateProfileExtraction:
        start = perf_counter()
        parsing_method = "llm"
        try:
            parsed = await self._generate_json(
                system_prompt=(
                    "Extract a candidate profile from CV/resume text (any language, e.g. English, German, "
                    "French, Italian). "
                    "The field name must be the candidate's full personal name from the CV header/title, "
                    "never a section heading (e.g. 'Expérience Professionnelle', 'Berufserfahrung'), role "
                    "title, company name, or generic label. "
                    "Return JSON with keys: name (string), location (string|null), "
                    "experience_years (number|null), salary_expectation (number|null), "
                    "current_employer (string|null), current_position (string|null), "
                    "skills (array of objects with name, category=HardSkill|SoftSkill|null, "
                    "level|null, experience_years|null), "
                    "languages (array of objects with name, level|null), "
                    "educations (array of objects with level, field_of_study), "
                    "industries (array of objects with name), "
                    "preferred_roles (array of strings), "
                    "work_history (array of objects with employer, position, from_date "
                    "(YYYY-MM or null), to_date (YYYY-MM or null, empty if current), "
                    "is_current (boolean), description|null, location|null). "
                    "Create a SEPARATE work_history entry for EVERY employer/period mentioned "
                    "in the CV, sorted with the most recent role first. "
                    "education_history (array of objects with institution, degree, field_of_study, "
                    "from_date (YYYY-MM or null), to_date (YYYY-MM or null), description|null). "
                    "Create a SEPARATE education_history entry for EVERY degree/institution mentioned, "
                    "sorted with the most recent first. "
                    "Keep every description to at most 150 characters, a short summary of the role or "
                    "studies, not a verbatim copy of bullet points. "
                    "Normalize names to concise terms and use null for unknown values."
                ),
                user_content=raw_text,
                num_predict=3200,
                required_keys=("name",),
                preferred_keys=(
                    "name",
                    "location",
                    "experience_years",
                    "salary_expectation",
                    "skills",
                    "languages",
                    "educations",
                    "industries",
                    "preferred_roles",
                    "work_history",
                    "education_history",
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
                    num_predict=500,
                    required_keys=("name",),
                    call_context="candidate-parser",
                    preferred_keys=("name", "location", "experience_years", "skills", "preferred_roles"),
                    min_preferred_key_matches=0,
                    use_reasoning=False,
                )

                parsed = {
                    "name": parsed.get("name"),
                    "location": parsed.get("location"),
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
                parsing_method = "text_heuristik"
                parsed = {
                    "name": self._infer_candidate_name_from_text(raw_text) or "Unknown Candidate",
                    "location": None,
                    "experience_years": None,
                    "salary_expectation": None,
                    "skills": [],
                    "languages": [],
                    "educations": [],
                    "industries": [],
                    "preferred_roles": [],
                }

        if not isinstance(parsed, dict):
            parsing_method = "text_heuristik"
            parsed = {"name": self._infer_candidate_name_from_text(raw_text) or "Unknown Candidate"}
        elif not parsed.get("name"):
            parsed["name"] = self._infer_candidate_name_from_text(raw_text) or "Unknown Candidate"
        parsed["skills"] = self._normalize_candidate_skills(parsed.get("skills"))
        if not parsed["skills"]:
            parsed["skills"] = self._extract_candidate_skills_from_text(raw_text)
            if parsed["skills"]:
                logger.warning("parse_candidate_cv: recovered skills from raw CV text count=%d", len(parsed["skills"]))
        if not isinstance(parsed.get("work_history"), list):
            parsed["work_history"] = []
        if not isinstance(parsed.get("education_history"), list):
            parsed["education_history"] = []
        parsed["parsing_method"] = parsing_method
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

        for entry in result.work_history:
            if entry.from_date is not None:
                continue
            from_date, to_date, is_current = self._find_date_range_near(raw_text, entry.position, entry.employer)
            if from_date:
                entry.from_date = from_date
                if is_current:
                    entry.is_current = True
                elif to_date and entry.to_date is None:
                    entry.to_date = to_date

        for entry in result.education_history:
            if entry.from_date is not None:
                continue
            from_date, to_date, _ = self._find_date_range_near(
                raw_text, entry.degree, entry.institution, entry.field_of_study
            )
            if from_date:
                entry.from_date = from_date
                if to_date and entry.to_date is None:
                    entry.to_date = to_date

        elapsed_ms = (perf_counter() - start) * 1000
        logger.warning(
            "parse_candidate_cv completed in %.1f ms (input_chars=%d, skills=%d, languages=%d, educations=%d, "
            "industries=%d, work_history=%d, education_history=%d, parsing_method=%s)",
            elapsed_ms,
            len(raw_text),
            len(result.skills),
            len(result.languages),
            len(result.educations),
            len(result.industries),
            len(result.work_history),
            len(result.education_history),
            result.parsing_method,
        )
        self._record_parse_latency("candidate", elapsed_ms)
        return result

    async def parse_job_description(self, raw_text: str) -> JobProfileExtraction:
        start = perf_counter()
        def _fallback_job_title(text: str) -> str:
            lines = [line.strip() for line in re.split(r"\r?\n", text) if line.strip()]
            for line in lines:
                normalized = re.sub(r"\s+", " ", line).strip(" -*•\t")
                if not normalized:
                    continue
                if len(normalized) > 120:
                    continue
                lowered = normalized.lower()
                if lowered in {"anforderungen", "requirements", "beschreibung", "description", "über uns", "about us"}:
                    continue
                if re.match(r"^(anforderungen|requirements|beschreibung|description|über uns|about us)\b", lowered):
                    continue
                for separator in (" with ", " for "):
                    if separator in lowered and len(normalized.split()) > 3:
                        normalized = normalized[: lowered.index(separator)].strip()
                        lowered = normalized.lower()
                if len(normalized.split()) >= 2:
                    return normalized
            return "Unknown Job"

        minimal_profile = {
            "title": _fallback_job_title(raw_text),
            "company": None,
            "recruiter_company": None,
            "employer_company": None,
            "location": None,
            "employment_type": None,
            "department": None,
            "about_us": "",
            "description": "",
            "requirements": "",
            "benefits": "",
            "required_skills": [],
            "required_languages": [],
            "required_degrees": [],
            "industries": [],
        }
        try:
            parsed = await self._generate_json(
                system_prompt=(
                    "Extrahiere ein strukturiertes Jobprofil aus einer Stellenbeschreibung. "
                    "Es geht nur um die inhaltliche Extraktion, nicht um Anonymisierung oder Umformulierung. "
                    "Die Ausgabe wird direkt in die PostgreSQL-Spalten jobs.title, jobs.company, jobs.recruiter_company, jobs.employer_company, jobs.location, jobs.type, jobs.about_us, jobs.description, jobs.requirements und jobs.benefits geschrieben. "
                    "Das Feld required_skills ist die primäre Quelle für die Neo4j-Beziehungen REQUIRES_SKILL und NEED_SKILL; jedes Element muss daher ein einzelnes, klar benanntes Skill-Objekt sein. "
                    "Lasse keine explizit genannten Skills weg, fasse unterschiedliche Skills nicht zu Sammelbegriffen zusammen und setze priority exakt auf Mandatory oder NiceToHave. "
                    "Gib ausschließlich JSON mit diesen Schlüsseln zurück: title (string), company (string|null), recruiter_company (string|null), employer_company (string|null), "
                    "location (string|null), employment_type (string|null), department (string|null), "
                    "about_us (string|null), description (string|null), requirements (string|null), benefits (string|null), "
                    "required_skills (array of objects with name, category=HardSkill|SoftSkill|null, "
                    "priority where priority is exactly Mandatory or NiceToHave), "
                    "required_languages (array of objects with name, level), "
                    "required_degrees (array of objects with level, field_of_study), "
                    "industries (array of objects with name)."
                ),
                user_content=raw_text,
                num_predict=3200,
                required_keys=(
                    "title",
                ),
                call_context="job-parser",
                preferred_keys=(
                    "title",
                    "company",
                    "location",
                    "employment_type",
                    "department",
                    "required_skills",
                    "required_languages",
                    "required_degrees",
                    "industries",
                ),
                min_preferred_key_matches=0,
                use_reasoning=False,
            )
        except Exception as exc:
            logger.warning("parse_job_description: full parse failed, trying lightweight fallback: %s", exc)
            try:
                parsed = await self._generate_json(
                    system_prompt=(
                        "Extrahiere die Kerndaten einer Stelle aus einer Stellenbeschreibung. "
                        "Auch hier gilt: nur extrahieren, nicht anonymisieren. "
                        "Gib JSON mit den Schlüsseln title, company, recruiter_company, employer_company, location, about_us, description, requirements, benefits, required_skills, required_languages, required_degrees und industries zurück. "
                        "required_skills ist weiterhin die Quelle für REQUIRES_SKILL und NEED_SKILL; priorisiere vollständige und präzise Skill-Namen. "
                        "For required_skills include priority exactly as Mandatory or NiceToHave."
                    ),
                    user_content=raw_text,
                    num_predict=1500,
                    required_keys=("title",),
                    call_context="job-parser",
                    preferred_keys=("title", "company", "location", "required_skills", "required_languages"),
                    min_preferred_key_matches=0,
                    use_reasoning=False,
                )

                parsed = {
                    "title": parsed.get("title") or "Unknown Job",
                    "company": parsed.get("company"),
                    "recruiter_company": parsed.get("recruiter_company"),
                    "employer_company": parsed.get("employer_company"),
                    "location": parsed.get("location"),
                    "employment_type": parsed.get("employment_type"),
                    "department": parsed.get("department"),
                    "about_us": parsed.get("about_us") or "",
                    "description": parsed.get("description") or "",
                    "requirements": parsed.get("requirements") or "",
                    "benefits": parsed.get("benefits") or "",
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
                parsed = minimal_profile

        if not isinstance(parsed, dict):
            logger.warning(
                "parse_job_description: non-object parser output, using text-derived minimal profile: %s",
                type(parsed).__name__,
            )
            parsed = minimal_profile

        try:
            result = JobProfileExtraction.model_validate(parsed)
        except Exception as exc:
            logger.warning(
                "parse_job_description: validation failed, using text-derived minimal profile: %s",
                exc,
            )
            result = JobProfileExtraction.model_validate(minimal_profile)
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
            num_predict=900,
            required_keys=("ranked_candidates",),
            call_context="matching-rerank",
        )
        validated = LLMRerankResponse.model_validate(parsed)
        validated.ranked_candidates.sort(key=lambda item: item.score, reverse=True)
        return validated
