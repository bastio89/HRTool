from __future__ import annotations

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


def create_matching_router(_llm_service=None) -> APIRouter:
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
		return build_results(request.job, request.candidates, request.weights)

	@router.post('/match/external/matrix', response_model=MatchingMatrixPayload)
	async def external_matrix(request: MatchingMatrixRequest) -> MatchingMatrixPayload:
		if not request.jobs:
			raise HTTPException(status_code=400, detail='Mindestens eine Stelle ist erforderlich')
		if not request.candidates:
			raise HTTPException(status_code=400, detail='Mindestens ein Kandidat ist erforderlich')
		return build_matrix(request.jobs, request.candidates, request.mode, request.weights)

	return router
