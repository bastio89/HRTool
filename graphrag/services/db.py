from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from neo4j import AsyncGraphDatabase

from models import (
    CandidateJobMatch,
    CandidateProfileExtraction,
    JobProfileExtraction,
    JobCandidateMatch,
    Stage1Candidate,
    Stage2Candidate,
)


class Neo4jService:
    def __init__(self, uri: str, user: str, password: str) -> None:
        self.driver = AsyncGraphDatabase.driver(
            uri,
            auth=(user, password),
            notifications_min_severity="OFF",
            warn_notification_severity="OFF",
        )

    async def close(self) -> None:
        await self.driver.close()

    async def upsert_candidate(
        self,
        candidate_id: str,
        profile: CandidateProfileExtraction,
        embedding: list[float],
        skill_embeddings: dict[str, list[float]] | None = None,
        source_hash: str | None = None,
        profile_hash: str | None = None,
    ) -> None:
        query = """
        MERGE (c:Candidate {id: $candidate_id})
        SET c.name = $name,
            c.location = $location,
            c.experience_years = $experience_years,
            c.yearsOfExperience = $experience_years,
            c.salaryExpectation = $salary_expectation,
            c.embedding = $embedding
        WITH c
        FOREACH (_ IN CASE WHEN $source_hash IS NULL THEN [] ELSE [1] END |
            SET c.sourceHash = $source_hash
        )
        WITH c
        FOREACH (_ IN CASE WHEN $profile_hash IS NULL THEN [] ELSE [1] END |
            SET c.profileHash = $profile_hash
        )
        WITH c
        UNWIND $skills AS skill
            MERGE (s:Skill {name: toLower(skill.name)})
            ON CREATE SET s.embedding = $skill_embeddings[toLower(skill.name)]
            SET s.category = skill.category
            MERGE (c)-[hs:HAS_SKILL]->(s)
            SET hs.yearsOfExperience = skill.experience_years,
                hs.level = skill.level
        WITH c
        UNWIND $languages AS lang
            MERGE (l:Language {name: toLower(lang.name)})
            MERGE (c)-[hl:HAS_LANGUAGE]->(l)
            SET hl.level = lang.level
            MERGE (c)-[sp:SPEAKS]->(l)
            SET sp.level = lang.level
        WITH c
        UNWIND $educations AS edu
            MERGE (e:Education {level: edu.level, fieldOfStudy: toLower(edu.field_of_study)})
            MERGE (c)-[:HAS_EDUCATION]->(e)
            MERGE (c)-[:HAS_DEGREE]->(e)
        WITH c
        UNWIND $industries AS industry
            MERGE (i:Industry {name: toLower(industry.name)})
            MERGE (c)-[:HAS_INDUSTRY]->(i)
        WITH c
        UNWIND $preferred_roles AS role_name
            MERGE (r:Role {name: toLower(role_name)})
            MERGE (c)-[:PREFERS_ROLE]->(r)
        WITH c
        OPTIONAL MATCH (c)-[:HAS_SKILL]->(s:Skill)
        OPTIONAL MATCH (c)-[:PREFERS_ROLE]->(r:Role)
        FOREACH (_ IN CASE WHEN s IS NULL OR r IS NULL THEN [] ELSE [1] END |
            MERGE (s)-[:BELONGS_TO]->(r)
        )
        """
        async with self.driver.session() as session:
            result = await session.run(
                query,
                candidate_id=candidate_id,
                name=profile.name,
                location=profile.location,
                experience_years=profile.experience_years,
                salary_expectation=profile.salary_expectation,
                embedding=embedding,
                skill_embeddings=skill_embeddings or {},
                source_hash=source_hash,
                profile_hash=profile_hash,
                skills=[item.model_dump() for item in profile.skills],
                languages=[item.model_dump() for item in profile.languages],
                educations=[item.model_dump() for item in profile.educations],
                industries=[item.model_dump() for item in profile.industries],
                preferred_roles=profile.preferred_roles,
            )
            await result.consume()

    async def find_candidate_by_source_hash(self, source_hash: str) -> dict[str, Any] | None:
        query = """
        MATCH (c:Candidate {sourceHash: $source_hash})
        RETURN c.id AS id,
               c.name AS name
        LIMIT 1
        """
        async with self.driver.session() as session:
            result = await session.run(query, source_hash=source_hash)
            record = await result.single()
            if not record:
                return None
            return {"id": record["id"], "name": record["name"]}

    async def find_candidate_by_profile_hash(self, profile_hash: str) -> dict[str, Any] | None:
        query = """
        MATCH (c:Candidate {profileHash: $profile_hash})
        RETURN c.id AS id,
               c.name AS name
        LIMIT 1
        """
        async with self.driver.session() as session:
            result = await session.run(query, profile_hash=profile_hash)
            record = await result.single()
            if not record:
                return None
            return {"id": record["id"], "name": record["name"]}

    async def find_candidate_by_name(self, candidate_name: str) -> dict[str, Any] | None:
        query = """
        MATCH (c:Candidate)
        WHERE toLower(coalesce(c.name, '')) = toLower($candidate_name)
        RETURN c.id AS id,
               c.name AS name,
               c.location AS location,
               c.experience_years AS experience_years
        LIMIT 1
        """
        async with self.driver.session() as session:
            result = await session.run(query, candidate_name=candidate_name)
            record = await result.single()
            if not record:
                return None
            return {
                "id": record["id"],
                "name": record["name"],
                "location": record["location"],
                "experience_years": record["experience_years"],
            }

    async def find_job_by_name(self, job_name: str) -> dict[str, Any] | None:
        query = """
        MATCH (j:Job)
        WHERE toLower(coalesce(j.title, '')) = toLower($job_name)
        RETURN j.id AS id,
               j.title AS title,
               j.department AS department,
               j.company AS company,
               j.location AS location,
               j.employmentType AS employment_type
        LIMIT 1
        """
        async with self.driver.session() as session:
            result = await session.run(query, job_name=job_name)
            record = await result.single()
            if not record:
                return None
            return {
                "id": record["id"],
                "title": record["title"],
                "department": record["department"],
                "company": record["company"],
                "location": record["location"],
                "employment_type": record["employment_type"],
            }

    async def get_top_job_matches_for_candidate(
        self,
        candidate_id: str,
        limit: int = 10,
    ) -> list[CandidateJobMatch]:
        query = """
        MATCH (c:Candidate {id: $candidate_id})
        OPTIONAL MATCH (c)-[:HAS_SKILL]->(cs:Skill)
        WITH c,
             collect(DISTINCT toLower(cs.name)) AS candidate_skills,
             [skill IN collect(DISTINCT {name: toLower(cs.name), embedding: cs.embedding})
              WHERE skill.embedding IS NOT NULL] AS candidate_skill_rows
        UNWIND candidate_skill_rows AS candidate_skill
        CALL {
            WITH candidate_skill
            CALL db.index.vector.queryNodes('skill_embeddings_index', $skill_limit, candidate_skill.embedding)
            YIELD node, score
            WHERE node:Skill AND node.name <> candidate_skill.name AND score >= $skill_similarity_threshold
            RETURN collect(DISTINCT toLower(node.name)) AS similar_skill_names
        }
        WITH c,
             candidate_skills,
             collect(DISTINCT similar_skill_names) AS similar_skill_groups
        WITH c,
             candidate_skills,
             reduce(similar_names = [], group IN similar_skill_groups |
                 similar_names + group
             ) AS similar_skill_names
        MATCH (j:Job)
        OPTIONAL MATCH (j)-[:REQUIRES_SKILL]->(js:Skill)
        WITH c,
             candidate_skills,
             similar_skill_names,
             j,
             collect(DISTINCT toLower(js.name)) AS job_skills
        WITH c,
             candidate_skills,
             similar_skill_names,
             j,
             job_skills,
             [skill IN candidate_skills WHERE skill IN job_skills] AS shared_skills,
             [skill IN similar_skill_names WHERE skill IN job_skills] AS similar_skills
        WITH j,
             candidate_skills,
             job_skills,
             shared_skills,
             similar_skills,
             size(shared_skills) AS shared_count,
             size(similar_skills) AS similar_count,
             size(candidate_skills) + size(job_skills) - size(shared_skills) AS union_size
        WHERE size(job_skills) > 0 AND (shared_count > 0 OR similar_count > 0)
        RETURN j.id AS job_id,
               j.title AS title,
               j.department AS department,
               j.company AS company,
               j.location AS location,
               shared_skills AS shared_skills,
               similar_skills AS similar_skills,
               candidate_skills AS candidate_skills,
               job_skills AS job_skills,
               CASE
                   WHEN union_size = 0 THEN 0.0
                   ELSE toFloat(shared_count + (0.6 * similar_count)) / toFloat(union_size)
               END AS skill_similarity
        ORDER BY skill_similarity DESC, shared_count DESC, similar_count DESC, title ASC, job_id ASC
        LIMIT $limit
        """
        async with self.driver.session() as session:
            result = await session.run(
                query,
                candidate_id=candidate_id,
                limit=limit,
                skill_limit=5,
                skill_similarity_threshold=0.80,
            )
            rows = await result.data()

        return [CandidateJobMatch(**row) for row in rows]

    async def get_top_candidate_matches_for_job(
        self,
        job_id: str,
        limit: int = 10,
    ) -> list[JobCandidateMatch]:
        query = """
        MATCH (j:Job {id: $job_id})
        OPTIONAL MATCH (j)-[:REQUIRES_SKILL]->(js:Skill)
        WITH j,
             collect(DISTINCT toLower(js.name)) AS job_skills,
             [skill IN collect(DISTINCT {name: toLower(js.name), embedding: js.embedding})
              WHERE skill.embedding IS NOT NULL] AS job_skill_rows
        UNWIND job_skill_rows AS job_skill
        CALL {
            WITH job_skill
            CALL db.index.vector.queryNodes('skill_embeddings_index', $skill_limit, job_skill.embedding)
            YIELD node, score
            WHERE node:Skill AND node.name <> job_skill.name AND score >= $skill_similarity_threshold
            RETURN collect(DISTINCT toLower(node.name)) AS similar_skill_names
        }
        WITH j,
             job_skills,
             collect(DISTINCT similar_skill_names) AS similar_skill_groups
        WITH j,
             job_skills,
             reduce(similar_names = [], group IN similar_skill_groups |
                 similar_names + group
             ) AS similar_skill_names
        MATCH (c:Candidate)
        OPTIONAL MATCH (c)-[:HAS_SKILL]->(cs:Skill)
        WITH j,
             job_skills,
             similar_skill_names,
             c,
             collect(DISTINCT toLower(cs.name)) AS candidate_skills
        WITH j,
             job_skills,
             similar_skill_names,
             c,
             candidate_skills,
             [skill IN job_skills WHERE skill IN candidate_skills] AS shared_skills,
             [skill IN similar_skill_names WHERE skill IN candidate_skills] AS similar_skills
        WITH c,
             candidate_skills,
             job_skills,
             shared_skills,
             similar_skills,
             size(shared_skills) AS shared_count,
             size(similar_skills) AS similar_count,
             size(candidate_skills) + size(job_skills) - size(shared_skills) AS union_size
        WHERE size(candidate_skills) > 0 AND (shared_count > 0 OR similar_count > 0)
        RETURN c.id AS candidate_id,
               c.name AS name,
               c.location AS location,
               c.experience_years AS experience_years,
               shared_skills AS shared_skills,
               similar_skills AS similar_skills,
               candidate_skills AS candidate_skills,
               job_skills AS job_skills,
               CASE
                   WHEN union_size = 0 THEN 0.0
                   ELSE toFloat(shared_count + (0.6 * similar_count)) / toFloat(union_size)
               END AS skill_similarity
        ORDER BY skill_similarity DESC, shared_count DESC, similar_count DESC, experience_years DESC, name ASC, candidate_id ASC
        LIMIT $limit
        """
        async with self.driver.session() as session:
            result = await session.run(
                query,
                job_id=job_id,
                limit=limit,
                skill_limit=5,
                skill_similarity_threshold=0.80,
            )
            rows = await result.data()

        return [JobCandidateMatch(**row) for row in rows]

    async def upsert_job(
        self,
        job_id: str,
        profile: JobProfileExtraction,
        embedding: list[float],
        skill_embeddings: dict[str, list[float]] | None = None,
    ) -> None:
        recruiter_company = profile.recruiter_company or None
        employer_company = profile.employer_company or profile.company or None
        query = """
        MERGE (j:Job {id: $job_id})
        SET j.title = $title,
            j.department = $department,
            j.company = $company,
            j.recruiterCompany = $recruiter_company,
            j.employerCompany = $employer_company,
            j.location = $location,
            j.employmentType = $employment_type,
            j.embedding = $embedding
        WITH j
        FOREACH (_ IN CASE WHEN $recruiter_company IS NULL THEN [] ELSE [1] END |
            MERGE (recruiter:Recruiter {name: toLower($recruiter_company)})
            SET recruiter.displayName = $recruiter_company
            MERGE (j)-[:POSTED_BY]->(recruiter)
        )
        WITH j
        FOREACH (_ IN CASE WHEN $employer_company IS NULL THEN [] ELSE [1] END |
            MERGE (employer:Employer {name: toLower($employer_company)})
            SET employer.displayName = $employer_company
            MERGE (j)-[:FOR_EMPLOYER]->(employer)
        )
        WITH j
        UNWIND $required_skills AS req
            MERGE (s:Skill {name: toLower(req.name)})
            ON CREATE SET s.embedding = $skill_embeddings[toLower(req.name)]
            SET s.category = req.category
            MERGE (j)-[rs:REQUIRES_SKILL]->(s)
            SET rs.priority = req.priority,
                rs.jobDescriptionEmbedding = $embedding
        WITH j
        UNWIND $required_languages AS lang
            MERGE (l:Language {name: toLower(lang.name)})
            MERGE (j)-[hl:HAS_LANGUAGE]->(l)
            SET hl.level = lang.level
            MERGE (j)-[rl:REQUIRES_LANGUAGE]->(l)
            SET rl.level = lang.level
        WITH j
        UNWIND $required_degrees AS degree
            MERGE (e:Education {level: degree.level, fieldOfStudy: toLower(degree.field_of_study)})
            MERGE (j)-[:HAS_EDUCATION]->(e)
            MERGE (j)-[:REQUIRES_DEGREE]->(e)
        WITH j
        UNWIND $industries AS industry
            MERGE (i:Industry {name: toLower(industry.name)})
            MERGE (j)-[:IN_INDUSTRY]->(i)
        """
        async with self.driver.session() as session:
            result = await session.run(
                query,
                job_id=job_id,
                title=profile.title,
                department=profile.department,
                company=profile.company,
                recruiter_company=recruiter_company,
                employer_company=employer_company,
                location=profile.location,
                employment_type=profile.employment_type,
                embedding=embedding,
                skill_embeddings=skill_embeddings or {},
                required_skills=[item.model_dump() for item in profile.required_skills],
                required_languages=[item.model_dump() for item in profile.required_languages],
                required_degrees=[item.model_dump() for item in profile.required_degrees],
                industries=[item.model_dump() for item in profile.industries],
            )
            await result.consume()

    async def get_job_profile(self, job_id: str) -> dict[str, Any] | None:
        query = """
        MATCH (j:Job {id: $job_id})
        OPTIONAL MATCH (j)-[req:REQUIRES_SKILL]->(s:Skill)
         OPTIONAL MATCH (j)-[rql:REQUIRES_LANGUAGE|HAS_LANGUAGE]->(l:Language)
         OPTIONAL MATCH (j)-[:REQUIRES_DEGREE|HAS_EDUCATION]->(d:Education)
         OPTIONAL MATCH (j)-[:IN_INDUSTRY]->(i:Industry)
        RETURN j.id AS id,
               j.title AS title,
               j.department AS department,
             j.company AS company,
               j.location AS location,
             j.employmentType AS employment_type,
               j.embedding AS embedding,
             collect(DISTINCT {name: s.name, category: s.category, priority: req.priority}) AS required_skills,
             collect(DISTINCT {name: l.name, level: rql.level}) AS required_languages,
             collect(DISTINCT {level: d.level, field_of_study: d.fieldOfStudy}) AS required_degrees,
             collect(DISTINCT {name: i.name}) AS industries
        """
        async with self.driver.session() as session:
            result = await session.run(query, job_id=job_id)
            record = await result.single()
            if not record:
                return None
            return {
                "id": record["id"],
                "title": record["title"],
                "department": record["department"],
                "company": record["company"],
                "location": record["location"],
                "employment_type": record["employment_type"],
                "embedding": record["embedding"],
                "required_skills": [
                    skill
                    for skill in record["required_skills"]
                    if skill.get("name") is not None
                ],
                "required_languages": [
                    lang
                    for lang in record["required_languages"]
                    if lang.get("name") is not None
                ],
                "required_degrees": [
                    degree
                    for degree in record["required_degrees"]
                    if degree.get("field_of_study") is not None
                ],
                "industries": [
                    industry
                    for industry in record["industries"]
                    if industry.get("name") is not None
                ],
            }

    async def stage1_filter_candidates(
        self,
        job_id: str,
        limit: int = 100,
    ) -> list[Stage1Candidate]:
        query = """
        MATCH (j:Job {id: $job_id})
        OPTIONAL MATCH (j)-[req:REQUIRES_SKILL]->(ms:Skill)
        WHERE toLower(coalesce(req.priority, '')) = 'mandatory'
        WITH j, collect(DISTINCT toLower(ms.name)) AS mandatory_skills
        MATCH (c:Candidate)
        OPTIONAL MATCH (c)-[:HAS_SKILL]->(cs:Skill)
        WITH j, mandatory_skills, c, collect(DISTINCT toLower(cs.name)) AS candidate_skills
        OPTIONAL MATCH (c)-[:PREFERS_ROLE]->(pr:Role)<-[:BELONGS_TO]-(:Skill)<-[:REQUIRES_SKILL]-(j)
        WITH j, mandatory_skills, c, candidate_skills, count(DISTINCT pr) AS role_overlap
        WITH c,
             role_overlap,
             mandatory_skills,
             size([s IN candidate_skills WHERE s IN mandatory_skills]) AS mandatory_overlap,
             toLower(coalesce(c.location, '')) = toLower(coalesce(j.location, '')) AS location_match
        WHERE mandatory_overlap > 0 OR role_overlap > 0 OR location_match
        RETURN c.id AS id,
               mandatory_overlap AS mandatory_overlap,
               role_overlap AS role_overlap,
               location_match AS location_match
        ORDER BY mandatory_overlap DESC, role_overlap DESC, location_match DESC, coalesce(c.experience_years, 0) DESC
        LIMIT $limit
        """
        async with self.driver.session() as session:
            result = await session.run(query, job_id=job_id, limit=limit)
            rows = await result.data()
        return [Stage1Candidate(**row) for row in rows]

    async def stage2_rank_candidates(
        self,
        job_profile: dict[str, Any],
        candidate_ids: Iterable[str],
        limit: int = 10,
    ) -> list[Stage2Candidate]:
        candidate_ids = list(candidate_ids)
        if not candidate_ids:
            return []

        job_skills = sorted({skill["name"].lower() for skill in job_profile["required_skills"]})
        job_embedding = job_profile["embedding"]

        vector_query = """
        CALL db.index.vector.queryNodes('candidate_embedding_index', $k, $job_embedding)
        YIELD node, score
        WHERE node:Candidate AND node.id IN $candidate_ids
        RETURN node.id AS id, score
        ORDER BY score DESC
        """

        detail_query = """
        MATCH (c:Candidate)
        WHERE c.id IN $candidate_ids
        OPTIONAL MATCH (c)-[:HAS_SKILL]->(s:Skill)
        OPTIONAL MATCH (c)-[:PREFERS_ROLE]->(r:Role)
        RETURN c.id AS id,
               c.name AS name,
               c.location AS location,
               c.experience_years AS experience_years,
               collect(DISTINCT toLower(s.name)) AS skills,
               collect(DISTINCT r.name) AS preferred_roles
        """

        async with self.driver.session() as session:
            vector_results = await session.run(
                vector_query,
                k=max(limit * 10, 100),
                job_embedding=job_embedding,
                candidate_ids=candidate_ids,
            )
            vector_rows = await vector_results.data()
            ordered_ids = [row["id"] for row in vector_rows]
            scores_by_id = {row["id"]: float(row["score"]) for row in vector_rows}

            if not ordered_ids:
                return []

            detail_results = await session.run(detail_query, candidate_ids=ordered_ids)
            detail_rows = await detail_results.data()

        details_by_id = {row["id"]: row for row in detail_rows}
        ranked: list[Stage2Candidate] = []

        for candidate_id in ordered_ids:
            detail = details_by_id.get(candidate_id)
            if not detail:
                continue
            skills = [skill for skill in detail["skills"] if skill]
            jaccard = self._jaccard_similarity(job_skills, skills)
            vector_score = scores_by_id[candidate_id]
            combined_score = 0.7 * vector_score + 0.3 * jaccard
            ranked.append(
                Stage2Candidate(
                    id=candidate_id,
                    name=detail.get("name"),
                    location=detail.get("location"),
                    experience_years=detail.get("experience_years"),
                    skills=skills,
                    preferred_roles=[role for role in detail.get("preferred_roles", []) if role],
                    vector_score=vector_score,
                    jaccard_score=jaccard,
                    combined_score=combined_score,
                )
            )

        ranked.sort(key=lambda item: item.combined_score, reverse=True)
        return ranked[:limit]

    @staticmethod
    def _jaccard_similarity(a: list[str], b: list[str]) -> float:
        left = set(a)
        right = set(b)
        union = left | right
        if not union:
            return 0.0
        return float(len(left & right) / len(union))
