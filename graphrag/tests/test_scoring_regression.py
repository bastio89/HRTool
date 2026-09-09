from __future__ import annotations

from services.db import Neo4jService


def test_jaccard_similarity_overlap_regression():
    left = ["python", "sql", "neo4j"]
    right = ["python", "fastapi", "neo4j"]

    score = Neo4jService._jaccard_similarity(left, right)

    assert score == 0.5


def test_jaccard_similarity_empty_union_regression():
    score = Neo4jService._jaccard_similarity([], [])

    assert score == 0.0


def test_score_from_matched_skills_separates_categories_regression():
    matched_skills = [
        {"jobSkillCategory": "HardSkill", "candidateSkillCategory": "HardSkill", "similarity": 0.9},
        {"jobSkillCategory": "SoftSkill", "candidateSkillCategory": "SoftSkill", "similarity": 0.6},
    ]

    overall = Neo4jService._score_from_matched_skills(matched_skills)
    hard = Neo4jService._score_from_matched_skills(matched_skills, "HardSkill")
    soft = Neo4jService._score_from_matched_skills(matched_skills, "SoftSkill")

    assert overall == 75
    assert hard == 90
    assert soft == 60
