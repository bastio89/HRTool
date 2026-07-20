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
