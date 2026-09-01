from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import re
from typing import Any

from fastapi import APIRouter, HTTPException

from models import (
	MatchingCandidateInput,
	MatchingJobInput,
	MatchingMatrixPayload,
	MatchingMatrixRequest,
	MatchingResultItem,
	MatchingResultsPayload,
	MatchingRunRequest,
)


def create_matching_router(llm_service=None) -> APIRouter:
	router = APIRouter()

	field_profiles = [
		('skills', 'skills', 'Fachliche Qualifikation / Skills', 34),
		('experience', 'experience', 'Berufserfahrung', 14),
		('education', 'education', 'Ausbildung / Hochschulabschluss', 10),
		('languages', 'languages', 'Sprachkenntnisse', 8),
		('location', 'location', 'Wohnortnähe / Standort', 12),
		('certificates', 'certificates', 'Zertifikate / Weiterbildungen', 5),
		('mobility', 'mobility', 'Mobilität / Führerschein', 4),
		('availability', 'availability', 'Verfügbarkeit / Startdatum', 3),
		('salary', 'desired_salary', 'Gehaltsvorstellung', 2),
		('cultural_fit', None, 'Kulturelle Passung / Soft Skills', 8),
	]

	def normalize_text(value: Any) -> str:
		if value is None:
			return ''
		if isinstance(value, str):
			return value.strip()
		if isinstance(value, (int, float, bool)):
			return str(value).strip()
		if isinstance(value, dict):
			parts = []
			for key in ('name', 'label', 'title', 'value', 'skill', 'degree', 'field_of_study', 'institution'):
				item = value.get(key)
				if item is not None:
					parts.append(normalize_text(item))
			return ' '.join(part for part in parts if part)
		if isinstance(value, list):
			parts = [normalize_text(item) for item in value]
			return ' '.join(part for part in parts if part)
		return str(value).strip()

	def extract_terms(value: Any) -> set[str]:
		text = normalize_text(value).lower()
		if not text:
			return set()
		terms = set(re.split(r'[^\w#+.-]+', text))
		return {term for term in terms if term}

	def build_job_terms(job: MatchingJobInput) -> set[str]:
		terms = set()
		for value in (job.title, job.description, job.requirements, job.location, job.type):
			terms |= extract_terms(value)
		return terms

	def build_candidate_terms(candidate: MatchingCandidateInput) -> set[str]:
		terms = set()
		for value in (
			candidate.name,
			candidate.location,
			candidate.experience,
			candidate.skills,
			candidate.education,
			candidate.desired_salary,
			candidate.availability,
			candidate.languages,
			candidate.certificates,
			candidate.mobility,
		):
			terms |= extract_terms(value)
		return terms

	def build_candidate_general_terms(candidate: MatchingCandidateInput) -> set[str]:
		terms = build_candidate_terms(candidate)
		terms -= extract_terms(candidate.location)
		return terms

	def weight_factor(base_weight: int, weight_override: int | None) -> float:
		adjustment = (weight_override or 0) / 12.0
		return max(0.25, 1.0 + adjustment) * base_weight

	def overlap_score(job_value: Any, candidate_value: Any) -> tuple[float, list[str]]:
		job_terms = extract_terms(job_value)
		candidate_terms = extract_terms(candidate_value)
		if not job_terms or not candidate_terms:
			return 0.0, []
		shared = sorted(job_terms & candidate_terms)
		if not shared:
			return 0.0, []
		coverage = len(shared) / max(1, min(len(candidate_terms), 5))
		return min(1.0, coverage), shared

	def location_score(job: MatchingJobInput, candidate: MatchingCandidateInput) -> tuple[float, list[str]]:
		job_location = normalize_text(job.location).lower()
		candidate_location = normalize_text(candidate.location).lower()
		if not job_location or not candidate_location:
			return 0.0, []
		if job_location == candidate_location:
			return 1.0, [job_location]
		job_terms = extract_terms(job.location)
		candidate_terms = extract_terms(candidate.location)
		shared = sorted(job_terms & candidate_terms)
		if shared:
			return 0.7, shared
		if job_location in candidate_location or candidate_location in job_location:
			return 0.6, [job_location, candidate_location]
		return 0.0, []

	def general_fit_score(job_terms: set[str], candidate_terms: set[str]) -> tuple[float, list[str]]:
		shared = sorted(job_terms & candidate_terms)
		if not shared:
			return 0.0, []
		coverage = len(shared) / max(1, min(len(candidate_terms), 6))
		return min(1.0, coverage), shared

	def build_job_text_terms(job: MatchingJobInput) -> set[str]:
		terms = set()
		for value in (job.title, job.description, job.requirements, job.location, job.type):
			terms |= extract_terms(value)
		return terms

	def job_terms_for(field_key: str, job: MatchingJobInput) -> set[str]:
		base_terms = set()
		for value in (job.title, job.description, job.requirements):
			base_terms |= extract_terms(value)
		if field_key == 'location':
			return extract_terms(job.location)
		if field_key in {'availability', 'salary'}:
			return base_terms | extract_terms(job.type)
		return base_terms

	def normalize_skill_entries(value: Any, default_priority: str = 'Mandatory') -> list[dict[str, Any]]:
		if value is None:
			return []

		items: list[Any]
		if isinstance(value, dict):
			items = [value]
		elif isinstance(value, str):
			items = [part.strip() for part in re.split(r'[,;\n|]+', value) if part.strip()]
		elif isinstance(value, list):
			items = value
		else:
			items = [value]

		normalized: list[dict[str, Any]] = []
		seen: set[str] = set()
		for item in items:
			if isinstance(item, dict):
				name = normalize_text(item.get('name') or item.get('label') or item.get('title') or item.get('skill') or item.get('value'))
				priority = normalize_text(item.get('priority') or item.get('importance') or default_priority) or default_priority
			else:
				name = normalize_text(item)
				priority = default_priority
			if not name:
				continue
			key = name.lower()
			if key in seen:
				continue
			seen.add(key)
			normalized.append({'name': name, 'priority': priority})
		return normalized

	def get_required_skills(job: MatchingJobInput) -> list[dict[str, Any]]:
		required = normalize_skill_entries(getattr(job, 'required_skills', None))
		if required:
			return required
		fallback_source = job.requirements or job.description or job.title
		return normalize_skill_entries(fallback_source)

	def get_candidate_skills(candidate: MatchingCandidateInput) -> list[dict[str, Any]]:
		has_skill = normalize_skill_entries(getattr(candidate, 'has_skill', None), default_priority='Neutral')
		if has_skill:
			return has_skill
		fallback_source = candidate.skills
		if fallback_source is None:
			return []
		return normalize_skill_entries(fallback_source, default_priority='Neutral')

	async def build_skill_embedding_cache(jobs: list[MatchingJobInput], candidates: list[MatchingCandidateInput]) -> dict[str, list[float]]:
		if llm_service is None or not hasattr(llm_service, 'create_embedding'):
			raise HTTPException(status_code=503, detail='Embedding service is not available')

		skill_names = {
			entry['name'].strip().lower()
			for job in jobs
			for entry in get_required_skills(job)
			if entry.get('name')
		}
		skill_names.update(
			entry['name'].strip().lower()
			for candidate in candidates
			for entry in get_candidate_skills(candidate)
			if entry.get('name')
		)

		ordered_names = sorted(skill_names)
		if not ordered_names:
			return {}

		vectors = await asyncio.gather(
			*(llm_service.create_embedding({'entity': 'skill', 'name': skill_name}) for skill_name in ordered_names)
		)
		return {name: vector for name, vector in zip(ordered_names, vectors)}

	def cosine_similarity(left: list[float] | tuple[float, ...], right: list[float] | tuple[float, ...]) -> float:
		if not left or not right:
			return 0.0
		length = min(len(left), len(right))
		if length == 0:
			return 0.0
		dot_product = sum(float(left[index]) * float(right[index]) for index in range(length))
		left_norm = sum(float(left[index]) ** 2 for index in range(length)) ** 0.5
		right_norm = sum(float(right[index]) ** 2 for index in range(length)) ** 0.5
		if left_norm == 0 or right_norm == 0:
			return 0.0
		return max(0.0, min(1.0, dot_product / (left_norm * right_norm)))

	def skill_weight(priority: Any) -> float:
		priority_text = normalize_text(priority).lower().replace('-', '_').replace(' ', '_')
		if priority_text == 'mandatory':
			return 2.0
		if priority_text in {'nicetohave', 'nice_to_have'}:
			return 1.0
		return 1.0

	def summarize_skill_name(name: str) -> str:
		return normalize_text(name) or 'Unbekannter Skill'

	def score_skill_pair(job: MatchingJobInput, candidate: MatchingCandidateInput, skill_embeddings: dict[str, list[float]]) -> dict[str, Any]:
		job_skills = get_required_skills(job)
		candidate_skills = get_candidate_skills(candidate)
		job_title = job.title or 'Unbenannte Stelle'
		candidate_name = candidate.name or f'Kandidat {candidate.id}'

		if not job_skills or not candidate_skills:
			return {
				'jobId': str(job.id) if job.id is not None else '',
				'jobTitle': job_title,
				'candidateId': str(candidate.id),
				'candidateName': candidate_name,
				'score': 0,
				'strengths': [],
				'weaknesses': [skill['name'] for skill in job_skills[:3]] or ['Keine Skills vorhanden'],
				'summary': f"{candidate_name} deckt 0/{max(1, len(job_skills))} erforderliche Skills für {job_title} ab.",
				'matchedSkills': [],
			}

		candidate_vectors = {
			entry['name'].strip().lower(): skill_embeddings.get(entry['name'].strip().lower())
			for entry in candidate_skills
			if entry.get('name')
		}
		job_vectors = {
			entry['name'].strip().lower(): skill_embeddings.get(entry['name'].strip().lower())
			for entry in job_skills
			if entry.get('name')
		}

		matched_skills: list[dict[str, Any]] = []
		missing_skills: list[str] = []
		weighted_sum = 0.0
		total_weight = 0.0

		for job_skill in job_skills:
			job_name = job_skill['name'].strip().lower()
			job_vector = job_vectors.get(job_name)
			if job_vector is None:
				continue
			best_similarity = 0.0
			best_candidate_name = ''
			for candidate_skill in candidate_skills:
				candidate_name = candidate_skill['name'].strip().lower()
				candidate_vector = candidate_vectors.get(candidate_name)
				if candidate_vector is None:
					continue
				similarity = cosine_similarity(job_vector, candidate_vector)
				if similarity > best_similarity:
					best_similarity = similarity
					best_candidate_name = candidate_skill['name']

			weight = skill_weight(job_skill.get('priority'))
			total_weight += weight
			weighted_sum += weight * best_similarity
			matched_skills.append({
				'jobSkill': job_skill['name'],
				'candidateSkill': best_candidate_name,
				'similarity': round(best_similarity, 4),
				'priority': job_skill.get('priority') or 'Mandatory',
			})
			if best_similarity < 0.65:
				missing_skills.append(job_skill['name'])

		score = round((weighted_sum / total_weight) * 100) if total_weight > 0 else 0
		score = max(0, min(100, score))
		matched_skills.sort(key=lambda item: item['similarity'], reverse=True)

		strengths: list[str] = []
		for match in matched_skills:
			if match['similarity'] < 0.75:
				continue
			if match['candidateSkill']:
				strengths.append(f"{summarize_skill_name(match['jobSkill'])} ↔ {summarize_skill_name(match['candidateSkill'])}")
			else:
				strengths.append(summarize_skill_name(match['jobSkill']))
			if len(strengths) >= 3:
				break
		if score >= 80:
			strengths.append('Sehr starker Skill-Fit')

		weaknesses: list[str] = []
		for skill_name in missing_skills:
			if len(weaknesses) >= 3:
				break
			weaknesses.append(f"{skill_name} nur schwach oder gar nicht abgedeckt")
		if score < 40:
			weaknesses.append('Gesamtfit eher schwach')

		required_count = max(1, len(job_skills))
		covered_count = sum(1 for match in matched_skills if match['similarity'] >= 0.65)
		summary = (
			f"{candidate_name} deckt {covered_count}/{required_count} erforderliche Skills für "
			f"{job_title} ab."
		)

		return {
			'jobId': str(job.id) if job.id is not None else '',
			'jobTitle': job_title,
			'candidateId': str(candidate.id),
			'candidateName': candidate_name,
			'score': score,
			'strengths': strengths[:4],
			'weaknesses': weaknesses[:3],
			'summary': summary,
			'matchedSkills': matched_skills,
		}

	async def build_vector_matrix(jobs: list[MatchingJobInput], candidates: list[MatchingCandidateInput], mode: str) -> MatchingMatrixPayload:
		skill_embeddings = await build_skill_embedding_cache(jobs, candidates)
		rows = []
		for job in jobs:
			for candidate in candidates:
				rows.append(score_skill_pair(job, candidate, skill_embeddings))
		rows.sort(key=lambda item: item['score'], reverse=True)
		jobs_ranked = [
			{
				'jobId': str(job.id) if job.id is not None else '',
				'jobTitle': job.title,
				'results': sorted(
					[pair for pair in rows if pair['jobId'] == (str(job.id) if job.id is not None else '')],
					key=lambda item: item['score'],
					reverse=True,
				),
			}
			for job in jobs
		]
		candidates_ranked = [
			{
				'candidateId': str(candidate.id),
				'candidateName': candidate.name,
				'results': sorted(
					[pair for pair in rows if pair['candidateId'] == str(candidate.id)],
					key=lambda item: item['score'],
					reverse=True,
				),
			}
			for candidate in candidates
		]
		return MatchingMatrixPayload(
			type='matrix',
			mode=mode,
			model='graph-rag-skill-vector-matching',
			matchedAt=datetime.now(timezone.utc).isoformat(),
			jobs=[{'id': job.id, 'title': job.title} for job in jobs],
			candidates=[{'id': candidate.id, 'name': candidate.name} for candidate in candidates],
			matrix=rows,
			jobsRanked=jobs_ranked,
			candidatesRanked=candidates_ranked,
		)

	def build_single_result(job: MatchingJobInput, candidate: MatchingCandidateInput, skill_embeddings: dict[str, list[float]]) -> dict[str, Any]:
		pair = score_skill_pair(job, candidate, skill_embeddings)
		strengths = [
			f"{summarize_skill_name(item['jobSkill'])} ↔ {summarize_skill_name(item['candidateSkill'])}"
			for item in pair['matchedSkills']
			if item['similarity'] >= 0.75 and item.get('candidateSkill')
		][:3]
		if pair['score'] >= 80:
			strengths.append('Sehr starker Skill-Fit')

		weaknesses = list(pair['weaknesses'])
		if not weaknesses and pair['score'] < 60:
			weaknesses.append('Skill-Fit nur teilweise')

		summary = pair['summary']
		if pair['matchedSkills']:
			best_match = max(pair['matchedSkills'], key=lambda item: item['similarity'])
			if best_match.get('candidateSkill'):
				summary = (
					f"{candidate.name or 'Kandidat'} matcht am besten auf {summarize_skill_name(best_match['candidateSkill'])} "
					f"für {job.title or 'die Stelle'} ({pair['score']}%)."
				)

		return {
			'jobId': pair['jobId'],
			'jobTitle': pair['jobTitle'],
			'candidateId': pair['candidateId'],
			'candidateName': pair['candidateName'],
			'score': pair['score'],
			'strengths': strengths[:4],
			'weaknesses': weaknesses[:3],
			'summary': summary,
		}

	def _score_pair(job: MatchingJobInput, candidate: MatchingCandidateInput, weights: dict[str, int] | None = None) -> dict[str, Any]:
		job_terms = build_job_text_terms(job)
		candidate_terms = build_candidate_terms(candidate)
		candidate_general_terms = build_candidate_general_terms(candidate)
		field_scores: list[dict[str, Any]] = []
		total_weight = 0.0
		total_score = 0.0

		for field_key, candidate_attr, label, base_weight in field_profiles:
			weight_override = (weights or {}).get(field_key, 0)

			field_weight = weight_factor(base_weight, weight_override)
			if field_key == 'location':
				coverage, shared_terms = location_score(job, candidate)
			elif field_key == 'cultural_fit':
				coverage, shared_terms = general_fit_score(job_terms_for('cultural_fit', job), candidate_general_terms)
			else:
				job_terms_for_field = job_terms_for(field_key, job)
				candidate_value = getattr(candidate, candidate_attr) if candidate_attr else None
				coverage, shared_terms = overlap_score(job_terms_for_field, candidate_value)

			contribution = field_weight * coverage
			total_weight += field_weight
			total_score += contribution
			field_scores.append({
				'key': field_key,
				'label': label,
				'weight': field_weight,
				'coverage': coverage,
				'shared_terms': shared_terms,
				'contribution': contribution,
			})

		if total_weight > 0:
			score = round((total_score / total_weight) * 100)
		else:
			score = 0
		score = max(0, min(100, score))
		field_scores.sort(key=lambda item: item['contribution'], reverse=True)
		return {
			'jobId': str(job.id) if job.id is not None else '',
			'jobTitle': job.title or 'Unbenannte Stelle',
			'candidateId': str(candidate.id),
			'candidateName': candidate.name or f'Kandidat {candidate.id}',
			'score': score,
			'fieldScores': field_scores,
		}

	def build_strengths(job: MatchingJobInput, candidate: MatchingCandidateInput, pair: dict[str, Any]) -> list[str]:
		strengths: list[str] = []
		field_scores = pair['fieldScores']
		for item in field_scores[:3]:
			if item['contribution'] <= 0:
				continue
			shared_terms = item['shared_terms'][:4]
			if item['key'] == 'location' and item['coverage'] >= 0.7:
				strengths.append('Standort passt')
			elif shared_terms:
				strengths.append(f"{item['label']}: {', '.join(shared_terms)}")
			else:
				strengths.append(item['label'])
		if pair['score'] >= 80:
			strengths.append('Sehr starker Gesamtfit')
		return strengths[:4]

	def build_weaknesses(job: MatchingJobInput, candidate: MatchingCandidateInput, pair: dict[str, Any]) -> list[str]:
		weaknesses: list[str] = []
		field_scores = pair['fieldScores']
		low_fields = [item for item in field_scores if item['coverage'] <= 0.15]
		for item in low_fields[:2]:
			if item['key'] == 'location' and normalize_text(candidate.location) and normalize_text(job.location) and normalize_text(candidate.location).lower() != normalize_text(job.location).lower():
				weaknesses.append('Standort weicht ab')
			elif item['key'] == 'skills':
				weaknesses.append('Wenig direkte Skill-Überschneidung')
			elif item['key'] == 'education':
				weaknesses.append('Ausbildungsprofil passt nur teilweise')
			elif item['key'] == 'languages':
				weaknesses.append('Sprachprofil passt nur teilweise')
			else:
				weaknesses.append(f"{item['label']} schwach")
		if pair['score'] < 40:
			weaknesses.append('Gesamtfit eher schwach')
		return weaknesses[:3]

	def score_pair(job: MatchingJobInput, candidate: MatchingCandidateInput, weights: dict[str, int] | None = None) -> dict[str, Any]:
		pair = _score_pair(job, candidate, weights)
		strengths = build_strengths(job, candidate, pair)
		weaknesses = build_weaknesses(job, candidate, pair)
		summary = f"{candidate.name or 'Kandidat'} erzielt {pair['score']}% für {job.title or 'die Stelle'}."

		return {
			'jobId': pair['jobId'],
			'jobTitle': pair['jobTitle'],
			'candidateId': pair['candidateId'],
			'candidateName': pair['candidateName'],
			'score': pair['score'],
			'strengths': strengths,
			'weaknesses': weaknesses,
			'summary': summary,
		}

	def build_results(job: MatchingJobInput, candidates: list[MatchingCandidateInput], weights: dict[str, int] | None = None) -> MatchingResultsPayload:
		items = []
		for candidate in candidates:
			pair = score_pair(job, candidate, weights)
			items.append(
				MatchingResultItem(
					candidateId=pair['candidateId'],
					candidateName=pair['candidateName'],
					score=pair['score'],
					strengths=pair['strengths'],
					weaknesses=pair['weaknesses'],
					summary=pair['summary'],
				)
			)
		items.sort(key=lambda item: item.score, reverse=True)
		return MatchingResultsPayload(results=items)

	def build_matrix(jobs: list[MatchingJobInput], candidates: list[MatchingCandidateInput], mode: str, weights: dict[str, int] | None = None) -> MatchingMatrixPayload:
		rows = []
		for job in jobs:
			for candidate in candidates:
				rows.append(score_pair(job, candidate, weights))
		rows.sort(key=lambda item: item['score'], reverse=True)
		jobs_ranked = [
			{
				'jobId': str(job.id) if job.id is not None else '',
				'jobTitle': job.title,
				'results': sorted(
					[pair for pair in rows if pair['jobId'] == (str(job.id) if job.id is not None else '')],
					key=lambda item: item['score'],
					reverse=True,
				),
			}
			for job in jobs
		]
		candidates_ranked = [
			{
				'candidateId': str(candidate.id),
				'candidateName': candidate.name,
				'results': sorted(
					[pair for pair in rows if pair['candidateId'] == str(candidate.id)],
					key=lambda item: item['score'],
					reverse=True,
				),
			}
			for candidate in candidates
		]
		return MatchingMatrixPayload(
			type='matrix',
			mode=mode,
			model='graph-rag-deterministic-matching',
			matchedAt=datetime.now(timezone.utc).isoformat(),
			jobs=[{'id': job.id, 'title': job.title} for job in jobs],
			candidates=[{'id': candidate.id, 'name': candidate.name} for candidate in candidates],
			matrix=rows,
			jobsRanked=jobs_ranked,
			candidatesRanked=candidates_ranked,
		)

	@router.post('/match/external/run', response_model=MatchingResultsPayload)
	async def external_run(request: MatchingRunRequest) -> MatchingResultsPayload:
		if not request.candidates:
			raise HTTPException(status_code=400, detail='Mindestens ein Kandidat ist erforderlich')
		if not request.job.title and not request.job.description and not request.job.requirements:
			raise HTTPException(status_code=400, detail='Stellentitel, Beschreibung oder Anforderungen sind erforderlich')
		skill_embeddings = await build_skill_embedding_cache([request.job], request.candidates)
		items = [
			MatchingResultItem(
				candidateId=pair['candidateId'],
				candidateName=pair['candidateName'],
				score=pair['score'],
				strengths=pair['strengths'],
				weaknesses=pair['weaknesses'],
				summary=pair['summary'],
			)
			for pair in (
				build_single_result(request.job, candidate, skill_embeddings)
				for candidate in request.candidates
			)
		]
		items.sort(key=lambda item: item.score, reverse=True)
		return MatchingResultsPayload(results=items)

	@router.post('/match/external/matrix', response_model=MatchingMatrixPayload)
	async def external_matrix(request: MatchingMatrixRequest) -> MatchingMatrixPayload:
		if not request.jobs:
			raise HTTPException(status_code=400, detail='Mindestens eine Stelle ist erforderlich')
		if not request.candidates:
			raise HTTPException(status_code=400, detail='Mindestens ein Kandidat ist erforderlich')
		return await build_vector_matrix(request.jobs, request.candidates, request.mode)

	return router
