from __future__ import annotations

from collections import defaultdict, deque
import hashlib
import json
import logging
import math
import re
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
        enable_reasoning: bool = True,
        enable_parse_latency_aggregation: bool = False,
        parse_latency_window_size: int = 200,
        parse_latency_log_every: int = 20,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.chat_model = chat_model
        self.embedding_model = embedding_model
        self.embedding_dimensions = embedding_dimensions
        self.enable_reasoning = enable_reasoning
        self.enable_parse_latency_aggregation = enable_parse_latency_aggregation
        self.parse_latency_window_size = max(1, parse_latency_window_size)
        self.parse_latency_log_every = max(1, parse_latency_log_every)
        self._latency_samples: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self.parse_latency_window_size)
        )
        self._latency_counts: dict[str, int] = defaultdict(int)
        self.client = httpx.AsyncClient(timeout=120.0)

    async def close(self) -> None:
        await self.client.aclose()

    async def _ollama_generate_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
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

        response = await self.client.post(
            f"{self.base_url}/api/chat",
            json={
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
            },
        )
        response.raise_for_status()

        payload = response.json()
        message = payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        response_text = payload.get("response")
        thinking = message.get("thinking") if isinstance(message, dict) else None

        non_reasoning_objects: list[dict[str, Any]] = []
        for raw in (content, response_text):
            non_reasoning_objects.extend(_extract_json_objects(raw))

        best_non_reasoning = _best_match(non_reasoning_objects)
        if best_non_reasoning is not None:
            return best_non_reasoning

        # Fallback: some models only emit final JSON inside thinking.
        thinking_objects = _extract_json_objects(thinking)
        best_thinking = _best_match(thinking_objects)
        if best_thinking is not None:
            logger.warning("ollama_json_from_thinking_fallback")
            return best_thinking

        if not isinstance(content, str) and not isinstance(response_text, str) and not isinstance(thinking, str):
            err = payload.get("error")
            if isinstance(err, str) and err.strip():
                raise ValueError(f"Ollama error: {err}")
        raise ValueError("Ollama returned no JSON response content")

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
        parsed = await self._ollama_generate_json(
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

    async def parse_candidate_cv(self, raw_text: str) -> CandidateProfileExtraction:
        start = perf_counter()
        try:
            parsed = await self._ollama_generate_json(
                system_prompt=(
                    "Extract a candidate profile from CV/resume text. "
                    "The field name must be the candidate's full personal name from the CV header/title, "
                    "not a role title, company name, or generic label. "
                    "Return JSON with keys: name (string), location (string|null), "
                    "experience_years (number|null), salary_expectation (number|null), "
                    "skills (array of objects with name, category=HardSkill|SoftSkill|null, "
                    "level|null, experience_years|null), "
                    "languages (array of objects with name, level|null), "
                    "educations (array of objects with level, field_of_study), "
                    "industries (array of objects with name), "
                    "preferred_roles (array of strings). "
                    "Normalize names to concise terms and use null for unknown values."
                ),
                user_content=raw_text,
                num_predict=1200,
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
                ),
                min_preferred_key_matches=0,
                use_reasoning=False,
            )
        except Exception as exc:
            logger.warning("parse_candidate_cv: full parse failed, trying lightweight fallback: %s", exc)
            try:
                parsed = await self._ollama_generate_json(
                    system_prompt=(
                        "Extract core candidate data from CV text. "
                        "Return JSON with keys: name, location, experience_years, skills, preferred_roles. "
                        "Name must be the person's full name, not a role or generic label."
                    ),
                    user_content=raw_text,
                    num_predict=500,
                    required_keys=("name",),
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
            parsed = await self._ollama_generate_json(
                system_prompt=(
                    "Extract a job profile from a job description. "
                    "Return JSON with keys: title (string), company (string|null), recruiter_company (string|null), employer_company (string|null), "
                    "location (string|null), employment_type (string|null), department (string|null), "
                    "required_skills (array of objects with name, category=HardSkill|SoftSkill|null, "
                    "priority where priority is exactly Mandatory or NiceToHave), "
                    "required_languages (array of objects with name, level), "
                    "required_degrees (array of objects with level, field_of_study), "
                    "industries (array of objects with name)."
                ),
                user_content=raw_text,
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
                parsed = await self._ollama_generate_json(
                    system_prompt=(
                        "Extract core job data from a job description. "
                        "Return JSON with keys: title, company, recruiter_company, employer_company, location, required_skills, required_languages. "
                        "For required_skills include priority exactly as Mandatory or NiceToHave."
                    ),
                    user_content=raw_text,
                    num_predict=700,
                    required_keys=("title",),
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
            response = await self.client.post(
                f"{self.base_url}/api/embeddings",
                json={
                    "model": self.embedding_model,
                    "prompt": payload_text,
                },
            )
            response.raise_for_status()
            data = response.json()
            embedding = data.get("embedding")
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
        parsed = await self._ollama_generate_json(
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
        )
        validated = LLMRerankResponse.model_validate(parsed)
        validated.ranked_candidates.sort(key=lambda item: item.score, reverse=True)
        return validated
