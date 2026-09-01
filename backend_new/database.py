from __future__ import annotations

from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from .config import settings


def get_connection() -> psycopg.Connection:
    return psycopg.connect(settings.DATABASE_URL)


def init_db() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    company TEXT,
                    location TEXT,
                    employment_type TEXT,
                    status TEXT DEFAULT 'open',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS candidates (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT,
                    phone TEXT,
                    location TEXT,
                    status TEXT DEFAULT 'new',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
                """
            )
        connection.commit()


def fetch_all(table: str, order_by: str = "id DESC") -> list[dict]:
    with get_connection() as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            query = f"SELECT * FROM {table} ORDER BY {order_by}"
            cursor.execute(query)
            return cursor.fetchall()


def insert_job(title: str, company: str | None = None, location: str | None = None, employment_type: str | None = None) -> int:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO jobs (title, company, location, employment_type)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (title, company, location, employment_type),
            )
            row = cursor.fetchone()
            connection.commit()
            return int(row[0])


def insert_candidate(name: str, email: str | None = None, phone: str | None = None, location: str | None = None) -> int:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO candidates (name, email, phone, location)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (name, email, phone, location),
            )
            row = cursor.fetchone()
            connection.commit()
            return int(row[0])
