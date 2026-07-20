#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import csv
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
	sys.path.insert(0, str(PROJECT_ROOT))

from config import settings
from services.db import Neo4jService


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Create a CSV matrix with a score for every candidate-job pair."
	)
	return parser.parse_args()


async def _fetch_records(
	db_service: Neo4jService,
	query: str,
	parameters: dict[str, object] | None = None,
) -> list[dict[str, object]]:
	async with db_service.driver.session() as session:
		result = await session.run(query, **(parameters or {}))
		return await result.data()


async def _fetch_candidates(db_service: Neo4jService) -> list[dict[str, object]]:
	query = """
	MATCH (c:Candidate)
	OPTIONAL MATCH (c)-[:HAS_SKILL]->(s:Skill)
	RETURN c.id AS id,
		   c.name AS name,
		   collect(DISTINCT toLower(s.name)) AS skills
	ORDER BY toLower(coalesce(c.name, '')), c.id
	"""
	return await _fetch_records(db_service, query)


async def _fetch_jobs(db_service: Neo4jService) -> list[dict[str, object]]:
	query = """
	MATCH (j:Job)
	OPTIONAL MATCH (j)-[:REQUIRES_SKILL]->(s:Skill)
	RETURN j.id AS id,
		   j.title AS title,
		   collect(DISTINCT toLower(s.name)) AS skills
	ORDER BY toLower(coalesce(j.title, '')), j.id
	"""
	return await _fetch_records(db_service, query)


async def _fetch_skill_embeddings(db_service: Neo4jService) -> list[dict[str, object]]:
	query = """
	MATCH (s:Skill)
	WHERE s.embedding IS NOT NULL
	RETURN toLower(s.name) AS name,
		   s.embedding AS embedding
	ORDER BY name
	"""
	return await _fetch_records(db_service, query)


async def _find_similar_skills(
	db_service: Neo4jService,
	embedding: list[float],
	skill_name: str,
	*,
	limit: int = 5,
	threshold: float = 0.80,
) -> set[str]:
	query = """
	CALL db.index.vector.queryNodes('skill_embeddings_index', $limit, $embedding)
	YIELD node, score
	WHERE node:Skill AND node.name <> $skill_name AND score >= $threshold
	RETURN collect(DISTINCT toLower(node.name)) AS similar_skill_names
	"""
	records = await _fetch_records(
		db_service,
		query,
		{
			"limit": limit,
			"embedding": embedding,
			"skill_name": skill_name,
			"threshold": threshold,
		},
	)
	if not records:
		return set()
	return {str(name) for name in records[0]["similar_skill_names"] if name}


def _normalize_skill_names(values: list[object]) -> set[str]:
	return {str(value).lower() for value in values if value}


def _score_pair(
	candidate_skills: set[str],
	candidate_similar_skills: set[str],
	job_skills: set[str],
) -> float:
	shared_skills = candidate_skills & job_skills
	similar_skills = candidate_similar_skills & job_skills
	union_size = len(candidate_skills | job_skills)

	if union_size == 0:
		return 0.0

	return float(len(shared_skills) + (0.6 * len(similar_skills))) / float(union_size)


async def _build_matrix(db_service: Neo4jService) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, set[str]]]:
	candidates = await _fetch_candidates(db_service)
	jobs = await _fetch_jobs(db_service)
	skill_embeddings = await _fetch_skill_embeddings(db_service)

	skill_embedding_map = {
		str(row["name"]): row["embedding"]
		for row in skill_embeddings
		if row.get("name") and row.get("embedding") is not None
	}

	similar_skill_cache: dict[str, set[str]] = {}
	for skill_name, embedding in skill_embedding_map.items():
		similar_skill_cache[skill_name] = await _find_similar_skills(
			db_service,
			embedding,
			skill_name,
		)

	candidate_skill_sets: dict[str, set[str]] = {}
	candidate_similar_skill_sets: dict[str, set[str]] = {}
	for candidate in candidates:
		candidate_id = str(candidate["id"])
		skills = _normalize_skill_names(candidate.get("skills", []))
		candidate_skill_sets[candidate_id] = skills

		similar_skills: set[str] = set()
		for skill_name in skills:
			similar_skills.update(similar_skill_cache.get(skill_name, set()))
		candidate_similar_skill_sets[candidate_id] = similar_skills

	job_skill_sets: dict[str, set[str]] = {
		str(job["id"]): _normalize_skill_names(job.get("skills", [])) for job in jobs
	}

	return candidates, jobs, {
		"candidate_skill_sets": candidate_skill_sets,
		"candidate_similar_skill_sets": candidate_similar_skill_sets,
		"job_skill_sets": job_skill_sets,
	}


async def run() -> Path:
	db_service = Neo4jService(
		uri=settings.neo4j_uri,
		user=settings.neo4j_user,
		password=settings.neo4j_password,
	)

	try:
		candidates, jobs, cache = await _build_matrix(db_service)
	finally:
		await db_service.close()

	timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
	output_path = Path.cwd() / f"match_{timestamp}.csv"

	candidate_skill_sets = cache["candidate_skill_sets"]
	candidate_similar_skill_sets = cache["candidate_similar_skill_sets"]
	job_skill_sets = cache["job_skill_sets"]

	with output_path.open("w", newline="", encoding="utf-8") as csv_file:
		writer = csv.writer(csv_file)

		header = ["job_id", "job_title"]
		header.extend([f"{candidate['name']} [{candidate['id']}]" for candidate in candidates])
		writer.writerow(header)

		for job in jobs:
			job_id = str(job["id"])
			job_title = str(job.get("title") or "")
			row = [job_id, job_title]

			for candidate in candidates:
				candidate_id = str(candidate["id"])
				score = _score_pair(
					candidate_skill_sets.get(candidate_id, set()),
					candidate_similar_skill_sets.get(candidate_id, set()),
					job_skill_sets.get(job_id, set()),
				)
				row.append(f"{score:.3f}")

			writer.writerow(row)

	return output_path


def main() -> int:
	output_path = asyncio.run(run())
	print(f"Wrote matrix to {output_path.name}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
