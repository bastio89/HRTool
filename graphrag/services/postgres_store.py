from __future__ import annotations

import json
import logging
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from psycopg.rows import dict_row

from models import AiUsageMetrics, CandidateProfileExtraction, JobProfileExtraction

logger = logging.getLogger(__name__)


class PostgresStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    async def has_candidate_texts(self) -> bool:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT to_regclass('public.candidate_texts')")
                row = await cursor.fetchone()
        return bool(row and row[0])

    async def has_matching_results(self) -> bool:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute("SELECT to_regclass('public.matching_results')")
                row = await cursor.fetchone()
        return bool(row and row[0])

    @staticmethod
    def _normalize_prompt_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
        if row is None:
            return None
        normalized = dict(row)
        model_parameters = normalized.get("model_parameters")
        if isinstance(model_parameters, str):
            try:
                normalized["model_parameters"] = json.loads(model_parameters)
            except json.JSONDecodeError:
                normalized["model_parameters"] = {}
        elif model_parameters is None:
            normalized["model_parameters"] = {}
        return normalized

    @staticmethod
    def _split_search_terms(search: str) -> list[str]:
        return [term.strip().lower() for term in re.split(r"[\s,]+", str(search)) if term.strip()]

    @staticmethod
    def _build_search_clause(fields: list[str], search: str) -> tuple[str, list[str]]:
        terms = PostgresStore._split_search_terms(search)
        if not terms:
            return "", []

        conditions: list[str] = []
        params: list[str] = []
        for term in terms:
            term_conditions = " OR ".join([f"LOWER(COALESCE({field}, '')) LIKE %s" for field in fields])
            conditions.append(f"({term_conditions})")
            params.extend([f"%{term}%"] * len(fields))
        return " AND ".join(conditions), params

    @staticmethod
    def _candidate_search_fields(include_candidate_texts: bool = True) -> list[str]:
        fields = [
            "c.name",
            "c.email",
            "c.phone",
            "c.location",
            "c.experience",
            "c.skills",
            "c.education",
            "c.desired_salary",
            "c.availability",
            "c.languages",
            "c.certificates",
            "c.drivers_license",
            "c.mobility",
            "c.notes",
            "c.status",
            "c.tags",
            "c.source",
            "c.linkedin_url",
            "c.xing_url",
            "c.github_url",
            "c.portfolio_url",
            "c.current_employer",
            "c.current_position",
            "c.gender",
        ]
        if include_candidate_texts:
            fields.extend(["ct.candidate_name", "ct.original_text", "ct.anonymized_text", "ct.profile_json::text"])
        return fields

    @staticmethod
    def _job_search_fields() -> list[str]:
        return [
            "title",
            "company",
            "recruiter_company",
            "employer_company",
            "description",
            "requirements",
            "about_us",
            "benefits",
            "location",
            "type",
            "status",
            "url",
            "raw_text",
            "parsed_profile_json::text",
        ]

    @staticmethod
    def _matching_search_fields() -> list[str]:
        return [
            "m.job_title",
            "m.job_description",
            "m.results",
            "m.review_notes",
            "m.reviewed_by",
        ]

    @staticmethod
    def _candidate_text_select(has_candidate_texts: bool) -> str:
        return "COALESCE(ct.original_text, ct.anonymized_text, '') AS full_text" if has_candidate_texts else "'' AS full_text"

    async def ensure_setting(self, key: str, value: str) -> bool:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            result = await connection.execute(
                """
                INSERT INTO settings (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO NOTHING
                """,
                (key, value),
            )
        return getattr(result, "rowcount", 0) == 1

    async def ensure_setting_if_blank(self, key: str, value: str) -> bool:
        if not isinstance(value, str) or not value.strip():
            return False
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            result = await connection.execute(
                """
                INSERT INTO settings (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                WHERE settings.value IS NULL OR btrim(settings.value) = ''
                """,
                (key, value.strip()),
            )
        return getattr(result, "rowcount", 0) == 1

    async def list_prompts(self) -> list[dict[str, Any]]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, key, template, description, model_parameters, version, created_at, updated_at
                    FROM prompts
                    ORDER BY key ASC
                    """
                )
                rows = await cursor.fetchall()
        return [self._normalize_prompt_row(dict(row)) for row in rows if row is not None]

    async def get_prompt_by_id(self, prompt_id: int) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, key, template, description, model_parameters, version, created_at, updated_at
                    FROM prompts
                    WHERE id = %s
                    LIMIT 1
                    """,
                    (prompt_id,),
                )
                row = await cursor.fetchone()
        return self._normalize_prompt_row(dict(row)) if row else None

    async def get_prompt_by_key(self, prompt_key: str) -> dict[str, Any] | None:
        key = str(prompt_key or "").strip()
        if not key:
            return None
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, key, template, description, model_parameters, version, created_at, updated_at
                    FROM prompts
                    WHERE key = %s
                    LIMIT 1
                    """,
                    (key,),
                )
                row = await cursor.fetchone()
        return self._normalize_prompt_row(dict(row)) if row else None

    async def update_prompt(
        self,
        prompt_id: int,
        *,
        template: str,
        description: str | None,
        model_parameters: dict[str, Any],
    ) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    UPDATE prompts
                    SET template = %s,
                        description = %s,
                        model_parameters = %s,
                        version = version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                    RETURNING id, key, template, description, model_parameters, version, created_at, updated_at
                    """,
                    (template, description, Jsonb(model_parameters or {}), prompt_id),
                )
                row = await cursor.fetchone()
        return self._normalize_prompt_row(dict(row)) if row else None

    async def get_settings(self, keys: list[str]) -> dict[str, str]:
        filtered_keys = [key for key in keys if isinstance(key, str) and key.strip()]
        if not filtered_keys:
            return {}

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT key, value FROM settings WHERE key = ANY(%s)",
                    (filtered_keys,),
                )
                rows = await cursor.fetchall()

        return {
            str(key): str(value).strip()
            for key, value in rows
            if isinstance(key, str) and isinstance(value, str) and value.strip()
        }

    async def ensure_schema(self) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS ai_logs (
                        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        user_id BIGINT,
                        feature TEXT NOT NULL,
                        model TEXT,
                        model_version TEXT,
                        prompt_hash TEXT,
                        prompt TEXT,
                        response TEXT,
                        parsed_result TEXT,
                        skills TEXT,
                        duration_ms BIGINT,
                        input_tokens BIGINT,
                        output_tokens BIGINT,
                        success BIGINT DEFAULT 1,
                        error_message TEXT,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS jobs (
                        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        graph_job_id TEXT,
                        title TEXT NOT NULL,
                        company TEXT,
                        recruiter_company TEXT,
                        employer_company TEXT,
                        description TEXT,
                        requirements TEXT,
                        about_us TEXT,
                        benefits TEXT,
                        location TEXT,
                        type TEXT DEFAULT 'Vollzeit',
                        status TEXT DEFAULT 'Offen',
                        url TEXT,
                        raw_text TEXT,
                        source TEXT,
                        parsed_profile_json TEXT,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS candidate_texts (
                        candidate_id TEXT PRIMARY KEY,
                        candidate_name TEXT,
                        source TEXT,
                        original_text TEXT NOT NULL,
                        anonymized_text TEXT,
                        anonymization_map TEXT,
                        profile_json TEXT,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS candidates (
                        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT,
                        phone TEXT,
                        location TEXT,
                        status TEXT DEFAULT 'new',
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS prompts (
                        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        key TEXT NOT NULL UNIQUE,
                        template TEXT NOT NULL,
                        description TEXT,
                        model_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
                        version INTEGER NOT NULL DEFAULT 1,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS users (
                        id BIGINT PRIMARY KEY,
                        username TEXT,
                        email TEXT,
                        display_name TEXT,
                        role TEXT,
                        current_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
                        total_credits_used NUMERIC(10,2) NOT NULL DEFAULT 0,
                        total_credits_purchased NUMERIC(10,2) NOT NULL DEFAULT 0,
                        last_activity_at TIMESTAMPTZ,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS credit_transactions (
                        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        amount NUMERIC(10,2) NOT NULL,
                        action_type TEXT NOT NULL,
                        note TEXT,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        balance_after NUMERIC(10,2) NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
                for column_sql in (
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS graph_job_id TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recruiter_company TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employer_company TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS about_us TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS benefits TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'Vollzeit'",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Offen'",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS url TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_text TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT",
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parsed_profile_json TEXT",
                ):
                    await cursor.execute(column_sql)
                await cursor.execute(
                    """
                    ALTER TABLE prompts
                    ALTER COLUMN model_parameters SET DEFAULT '{}'::jsonb
                    """
                )
                for table in ("ai_logs", "jobs"):
                    await cursor.execute(
                        """
                        SELECT is_identity
                        FROM information_schema.columns
                        WHERE table_schema = current_schema()
                          AND table_name = %s
                          AND column_name = 'id'
                        """,
                        (table,),
                    )
                    identity_row = await cursor.fetchone()
                    if identity_row and identity_row[0] == "YES":
                        continue
                    await cursor.execute(f"CREATE SEQUENCE IF NOT EXISTS {table}_id_seq")
                    await cursor.execute(f"ALTER TABLE {table} ALTER COLUMN id SET DEFAULT nextval('{table}_id_seq')")
                    await cursor.execute(f"ALTER SEQUENCE {table}_id_seq OWNED BY {table}.id")
                    await cursor.execute(
                        f"SELECT setval('{table}_id_seq', COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)"
                    )
                await cursor.execute("ALTER TABLE candidates ADD COLUMN IF NOT EXISTS parsing_method TEXT")
                for column_sql in (
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_balance NUMERIC(10,2) NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS total_credits_used NUMERIC(10,2) NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS total_credits_purchased NUMERIC(10,2) NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
                ):
                    await cursor.execute(column_sql)
                await cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_users_credit_balance ON users(current_balance)
                    """
                )
                await cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_users_credit_activity ON users(last_activity_at)
                    """
                )
                await cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
                    ON credit_transactions(user_id, created_at DESC, id DESC)
                    """
                )

    async def seed_default_prompts(self) -> None:
        seed_path = Path(__file__).resolve().parents[1] / "seeds" / "prompts.sql"
        seed_sql = seed_path.read_text(encoding="utf-8")
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(seed_sql)

    @staticmethod
    def _to_decimal(value: Any) -> Decimal:
        decimal_value = Decimal(str(value or 0))
        return decimal_value.quantize(Decimal('0.01'))

    @staticmethod
    def _serialize_credit_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            'current_balance': float(row.get('current_balance') or 0),
            'total_credits_used': float(row.get('total_credits_used') or 0),
            'total_credits_purchased': float(row.get('total_credits_purchased') or 0),
            'amount': float(row['amount']) if 'amount' in row and row.get('amount') is not None else row.get('amount'),
            'balance_after': float(row['balance_after']) if 'balance_after' in row and row.get('balance_after') is not None else row.get('balance_after'),
        }

    async def ensure_credit_user(
        self,
        user_id: int,
        *,
        username: str | None = None,
        email: str | None = None,
        display_name: str | None = None,
        role: str | None = None,
    ) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO users (
                        id, username, email, display_name, role, password_hash,
                        current_balance, total_credits_used, total_credits_purchased,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        COALESCE((SELECT password_hash FROM users WHERE id = %s), 'billing-placeholder'),
                        0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
                        email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
                        display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
                        role = COALESCE(NULLIF(EXCLUDED.role, ''), users.role),
                        password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id, username, email, display_name, role, current_balance, total_credits_used, total_credits_purchased, last_activity_at, created_at, updated_at
                    """,
                    (int(user_id), username, email, display_name, role, int(user_id)),
                )
                row = await cursor.fetchone()
        return self._serialize_credit_row(dict(row)) if row else {}

    async def get_credit_user_summary(self, user_id: int) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, username, email, display_name, role, current_balance,
                           total_credits_used, total_credits_purchased, last_activity_at,
                           created_at, updated_at
                    FROM users
                    WHERE id = %s
                    LIMIT 1
                    """,
                    (int(user_id),),
                )
                row = await cursor.fetchone()
        return self._serialize_credit_row(dict(row)) if row else {
            'id': int(user_id),
            'username': None,
            'email': None,
            'display_name': None,
            'role': None,
            'current_balance': 0.0,
            'total_credits_used': 0.0,
            'total_credits_purchased': 0.0,
            'last_activity_at': None,
        }

    async def list_credit_users(self, search: str | None = None) -> list[dict[str, Any]]:
        search_value = str(search or '').strip()
        clause = ''
        params: list[Any] = []
        if search_value:
            clause, search_params = self._build_search_clause(['u.username', 'u.email', 'u.display_name'], search_value)
            if clause:
                clause = f'WHERE {clause}'
                params.extend(search_params)

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    f"""
                    SELECT u.id, u.username, u.email, u.display_name, u.role, u.current_balance,
                           u.total_credits_used, u.total_credits_purchased, u.last_activity_at,
                           u.created_at, u.updated_at,
                           COALESCE(tx.last_action_type, '') AS last_action_type,
                           tx.last_transaction_at
                    FROM users u
                    LEFT JOIN LATERAL (
                        SELECT ct.action_type AS last_action_type, ct.created_at AS last_transaction_at
                        FROM credit_transactions ct
                        WHERE ct.user_id = u.id
                        ORDER BY ct.created_at DESC, ct.id DESC
                        LIMIT 1
                    ) tx ON TRUE
                    {clause}
                    ORDER BY COALESCE(u.last_activity_at, tx.last_transaction_at, u.created_at) DESC, u.id DESC
                    """,
                    params,
                )
                rows = await cursor.fetchall()
        return [self._serialize_credit_row(dict(row)) for row in rows]

    async def get_credit_transactions(self, user_id: int, *, limit: int = 200) -> list[dict[str, Any]]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, user_id, amount, action_type, note, metadata, balance_after, created_at
                    FROM credit_transactions
                    WHERE user_id = %s
                    ORDER BY created_at DESC, id DESC
                    LIMIT %s
                    """,
                    (int(user_id), int(limit)),
                )
                rows = await cursor.fetchall()
        return [self._serialize_credit_row(dict(row)) for row in rows]

    async def get_credit_overview(self) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT
                        COALESCE(SUM(total_credits_used), 0) AS total_consumed,
                        COALESCE(SUM(current_balance), 0) AS total_outstanding,
                        COALESCE(SUM(total_credits_purchased), 0) AS total_purchased,
                        COUNT(*) AS user_count
                    FROM users
                    """
                )
                row = await cursor.fetchone()
        if not row:
            return {'total_consumed': 0.0, 'total_outstanding': 0.0, 'total_purchased': 0.0, 'user_count': 0}
        return {
            'total_consumed': float(row['total_consumed'] or 0),
            'total_outstanding': float(row['total_outstanding'] or 0),
            'total_purchased': float(row['total_purchased'] or 0),
            'user_count': int(row['user_count'] or 0),
        }

    async def apply_credit_transaction(
        self,
        user_id: int,
        amount: Decimal | str | float,
        action_type: str,
        *,
        note: str | None = None,
        metadata: dict[str, Any] | None = None,
        user_snapshot: dict[str, Any] | None = None,
        allow_negative_balance: bool = False,
    ) -> dict[str, Any]:
        transaction_amount = self._to_decimal(amount)
        if transaction_amount == 0:
            raise ValueError('Credit transaction amount must not be zero')

        user_data = user_snapshot or {}
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.transaction():
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        """
                        SELECT id, username, email, display_name, role, current_balance,
                               total_credits_used, total_credits_purchased, last_activity_at,
                               created_at, updated_at
                        FROM users
                        WHERE id = %s
                        FOR UPDATE
                        """,
                        (int(user_id),),
                    )
                    row = await cursor.fetchone()
                    if not row:
                        username = str(user_data.get('username') or f'user-{int(user_id)}')
                        email = str(user_data.get('email') or '') or None
                        display_name = str(user_data.get('display_name') or username)
                        role = str(user_data.get('role') or 'recruiter')
                        await cursor.execute(
                            """
                            INSERT INTO users (
                                id, username, email, display_name, role, password_hash,
                                current_balance, total_credits_used, total_credits_purchased,
                                created_at, updated_at
                            ) VALUES (
                                %s, %s, %s, %s, %s, 'billing-placeholder',
                                0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                            )
                            """,
                            (int(user_id), username, email, display_name, role),
                        )
                        await cursor.execute(
                            """
                            SELECT id, username, email, display_name, role, current_balance,
                                   total_credits_used, total_credits_purchased, last_activity_at,
                                   created_at, updated_at
                            FROM users
                            WHERE id = %s
                            FOR UPDATE
                            """,
                            (int(user_id),),
                        )
                        row = await cursor.fetchone()
                    if not row:
                        raise RuntimeError('Credit user record could not be created')

                    if any(user_data.get(field) for field in ('username', 'email', 'display_name', 'role')):
                        await cursor.execute(
                            """
                            UPDATE users
                            SET username = COALESCE(users.username, %s),
                                email = COALESCE(users.email, %s),
                                display_name = COALESCE(users.display_name, %s),
                                role = COALESCE(users.role, %s),
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = %s
                            """,
                            (
                                user_data.get('username'),
                                user_data.get('email'),
                                user_data.get('display_name'),
                                user_data.get('role'),
                                int(user_id),
                            ),
                        )
                        await cursor.execute(
                            """
                            SELECT id, username, email, display_name, role, current_balance,
                                   total_credits_used, total_credits_purchased, last_activity_at,
                                   created_at, updated_at
                            FROM users
                            WHERE id = %s
                            FOR UPDATE
                            """,
                            (int(user_id),),
                        )
                        row = await cursor.fetchone()

                    current_balance = self._to_decimal(row['current_balance'])
                    if transaction_amount < 0 and not allow_negative_balance and current_balance + transaction_amount < 0:
                        raise ValueError('Insufficient credits')

                    new_balance = current_balance + transaction_amount
                    used_delta = -transaction_amount if transaction_amount < 0 else Decimal('0.00')
                    purchased_delta = transaction_amount if transaction_amount > 0 else Decimal('0.00')
                    total_credits_used = self._to_decimal(row['total_credits_used']) + used_delta
                    total_credits_purchased = self._to_decimal(row['total_credits_purchased']) + purchased_delta

                    await cursor.execute(
                        """
                        UPDATE users
                        SET current_balance = %s,
                            total_credits_used = %s,
                            total_credits_purchased = %s,
                            last_activity_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                        RETURNING id, username, email, display_name, role, current_balance,
                                  total_credits_used, total_credits_purchased, last_activity_at,
                                  created_at, updated_at
                        """,
                        (
                            new_balance,
                            total_credits_used,
                            total_credits_purchased,
                            int(user_id),
                        ),
                    )
                    updated_row = await cursor.fetchone()
                    if not updated_row:
                        raise RuntimeError('Credit user update failed')

                    await cursor.execute(
                        """
                        INSERT INTO credit_transactions (
                            user_id, amount, action_type, note, metadata, balance_after
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING id, user_id, amount, action_type, note, metadata, balance_after, created_at
                        """,
                        (
                            int(user_id),
                            transaction_amount,
                            action_type,
                            note,
                            Jsonb(metadata or {}),
                            new_balance,
                        ),
                    )
                    transaction_row = await cursor.fetchone()

        result = self._serialize_credit_row(dict(updated_row))
        if transaction_row:
            result['transaction'] = self._serialize_credit_row(dict(transaction_row))
        return result

    async def read_ai_usage(self) -> AiUsageMetrics:
        # ai_logs legt das Node-Backend an, nicht dieser Dienst. Fehlt die
        # Tabelle - frische Datenbank, Backend noch nicht gestartet -, darf der
        # Health-Endpunkt daran nicht scheitern: er wuerde mit 500 antworten und
        # die Statusanzeige meldete den Dienst als tot, obwohl nur eine
        # Statistik fehlt. In dem Fall wird ein Verbrauch von null berichtet.
        try:
            async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        """
                        SELECT COUNT(*),
                               COALESCE(SUM(COALESCE(input_tokens, 0)), 0),
                               COALESCE(SUM(COALESCE(output_tokens, 0)), 0)
                        FROM ai_logs
                        """
                    )
                    row = await cursor.fetchone()
        except psycopg.Error:
            logger.warning("read_ai_usage: ai_logs nicht lesbar, melde Verbrauch 0", exc_info=True)
            return AiUsageMetrics()
        if not row:
            return AiUsageMetrics()
        input_tokens = int(row[1] or 0)
        output_tokens = int(row[2] or 0)
        return AiUsageMetrics(
            calls=int(row[0] or 0),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
        )

    async def write_ai_log(self, values: tuple[Any, ...]) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                """
                INSERT INTO ai_logs (
                    user_id, feature, model, model_version, prompt_hash, prompt, response, parsed_result,
                    skills, duration_ms, input_tokens, output_tokens, success, error_message
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                values,
            )

    async def store_candidate_text(
        self,
        candidate_id: str,
        raw_text: str,
        *,
        candidate_name: str | None = None,
        source: str | None = None,
        profile_json: dict[str, Any] | None = None,
    ) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                """
                INSERT INTO candidate_texts (
                    candidate_id, candidate_name, source, original_text, anonymized_text,
                    anonymization_map, profile_json
                ) VALUES (%s, %s, %s, %s, NULL, NULL, %s)
                ON CONFLICT (candidate_id) DO UPDATE SET
                    candidate_name = EXCLUDED.candidate_name,
                    source = COALESCE(EXCLUDED.source, candidate_texts.source),
                    original_text = EXCLUDED.original_text,
                    anonymized_text = NULL,
                    anonymization_map = NULL,
                    profile_json = EXCLUDED.profile_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    candidate_id,
                    candidate_name,
                    source,
                    raw_text,
                    json.dumps(profile_json, ensure_ascii=False) if profile_json is not None else None,
                ),
            )

    async def get_candidate_text(self, candidate_id: str) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT candidate_id, candidate_name, source, original_text, anonymized_text,
                           anonymization_map, profile_json
                    FROM candidate_texts
                    WHERE candidate_id = %s
                    """,
                    (candidate_id,),
                )
                row = await cursor.fetchone()
        if row is None:
            return None
        mapping = row.get("anonymization_map")
        profile_json = row.get("profile_json")
        return {
            **row,
            "mapping": json.loads(mapping) if isinstance(mapping, str) and mapping.strip() else {},
            "profile_json": json.loads(profile_json) if isinstance(profile_json, str) and profile_json.strip() else None,
        }

    async def store_candidate_anonymization(
        self,
        candidate_id: str,
        anonymized_text: str,
        mapping: dict[str, str],
    ) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                """
                UPDATE candidate_texts
                SET anonymized_text = %s,
                    anonymization_map = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE candidate_id = %s
                """,
                (anonymized_text, json.dumps(mapping, ensure_ascii=False), candidate_id),
            )

    async def _find_existing_candidate(self, profile: CandidateProfileExtraction) -> dict[str, Any] | None:
        checks: list[tuple[str, tuple[Any, ...]]] = []
        if profile.email and str(profile.email).strip():
            checks.append((
                "SELECT id, name FROM candidates WHERE LOWER(COALESCE(email, '')) = LOWER(%s) ORDER BY id LIMIT 1",
                (str(profile.email).strip(),),
            ))
        phone = str(profile.phone or "").strip()
        if phone:
            checks.append((
                "SELECT id, name FROM candidates WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]+', '', 'g') = regexp_replace(%s, '[^0-9]+', '', 'g') ORDER BY id LIMIT 1",
                (phone,),
            ))
        name = str(profile.name or "").strip()
        if name:
            checks.append((
                "SELECT id, name FROM candidates WHERE LOWER(name) = LOWER(%s) ORDER BY id LIMIT 1",
                (name,),
            ))

        for query, params in checks:
            async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(query, params)
                    row = await cursor.fetchone()
            if row:
                return dict(row)
        return None

    async def list_candidates_for_backfill(self) -> list[dict[str, Any]]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT
                        c.id::text AS candidate_id,
                        c.name,
                        c.email,
                        c.phone,
                        c.location,
                        c.experience,
                        c.skills,
                        c.education,
                        c.desired_salary,
                        c.availability,
                        c.languages,
                        c.certificates,
                        c.drivers_license,
                        c.mobility,
                        c.notes,
                        c.tags,
                        c.source,
                        c.linkedin_url,
                        c.xing_url,
                        c.github_url,
                        c.portfolio_url,
                        c.notice_period,
                        c.nationality,
                        c.current_employer,
                        c.current_position,
                        c.gender,
                        c.parsing_method,
                        COALESCE((
                            SELECT json_agg(
                                json_build_object(
                                    'employer', h.employer,
                                    'position', h.position,
                                    'from_date', h.from_date,
                                    'to_date', h.to_date,
                                    'is_current', h.is_current,
                                    'description', h.description,
                                    'location', h.location
                                )
                                ORDER BY h.id
                            )
                            FROM candidate_work_history h
                            WHERE h.candidate_id = c.id
                        ), '[]'::json) AS work_history,
                        COALESCE((
                            SELECT json_agg(
                                json_build_object(
                                    'institution', e.institution,
                                    'degree', e.degree,
                                    'field_of_study', e.field_of_study,
                                    'from_date', e.from_date,
                                    'to_date', e.to_date,
                                    'description', e.description
                                )
                                ORDER BY e.id
                            )
                            FROM candidate_education e
                            WHERE e.candidate_id = c.id
                        ), '[]'::json) AS education_history
                    FROM candidates c
                    ORDER BY c.id
                    """
                )
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def insert_candidate(self, profile: CandidateProfileExtraction, source: str | None = None) -> int:
        existing = await self._find_existing_candidate(profile)
        if existing is not None:
            return int(existing["id"])

        skills = ", ".join(item.name for item in profile.skills) or None
        languages = ", ".join(
            f"{item.name} ({item.level})" if item.level else item.name
            for item in profile.languages
        ) or None
        education = ", ".join(
            f"{item.level} {item.field_of_study}" for item in profile.educations
        ) or profile.education

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO candidates (
                        name, email, phone, location, experience, skills, education,
                        desired_salary, availability, languages, certificates,
                        drivers_license, mobility, notes, status, tags, source, linkedin_url,
                        xing_url, github_url, portfolio_url, notice_period, nationality,
                        current_employer, current_position, gender, parsing_method
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, 'Aktiv', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    ) RETURNING id
                    """,
                    (
                        profile.name,
                        profile.email,
                        profile.phone,
                        profile.location,
                        profile.experience,
                        skills,
                        education,
                        profile.desired_salary,
                        profile.availability,
                        languages,
                        profile.certificates,
                        profile.drivers_license,
                        profile.mobility,
                        profile.notes,
                        profile.tags,
                        source,
                        profile.linkedin_url,
                        profile.xing_url,
                        profile.github_url,
                        profile.portfolio_url,
                        profile.notice_period,
                        profile.nationality,
                        profile.current_employer,
                        profile.current_position,
                        profile.gender,
                        profile.parsing_method,
                    ),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise RuntimeError("PostgreSQL did not return a candidate id")
                candidate_id = int(row["id"])

                for item in profile.work_history:
                    if not item.employer or not item.position:
                        continue
                    await cursor.execute(
                        """
                        INSERT INTO candidate_work_history (
                            candidate_id, employer, position, from_date, to_date,
                            is_current, description, location
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            candidate_id, item.employer, item.position, item.from_date,
                            item.to_date, 1 if item.is_current else 0, item.description, item.location,
                        ),
                    )

                for item in profile.education_history:
                    if not item.institution:
                        continue
                    await cursor.execute(
                        """
                        INSERT INTO candidate_education (
                            candidate_id, institution, degree, field_of_study,
                            from_date, to_date, description
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            candidate_id, item.institution, item.degree, item.field_of_study,
                            item.from_date, item.to_date, item.description,
                        ),
                    )

        return candidate_id

    async def _find_existing_job(self, job_id: str, profile: JobProfileExtraction, source: str | None = None) -> dict[str, Any] | None:
        job_key = str(job_id or "").strip()
        if job_key:
            async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        """
                        SELECT id, graph_job_id, title
                        FROM jobs
                        WHERE graph_job_id = %s OR id::text = %s
                        LIMIT 1
                        """,
                        (job_key, job_key),
                    )
                    row = await cursor.fetchone()
            if row:
                return dict(row)

        title = str(profile.title or "").strip()
        if not title:
            return None

        company = str(profile.company or profile.employer_company or profile.recruiter_company or "").strip()
        location = str(profile.location or "").strip()
        source_value = str(source or "").strip()

        query = [
            "SELECT id, graph_job_id, title FROM jobs",
            "WHERE LOWER(title) = LOWER(%s)",
        ]
        params: list[Any] = [title]
        query.append("AND COALESCE(LOWER(company), '') = COALESCE(LOWER(%s), '')")
        params.append(company)
        query.append("AND COALESCE(LOWER(location), '') = COALESCE(LOWER(%s), '')")
        params.append(location)
        if source_value:
            query.append("AND COALESCE(LOWER(source), '') = LOWER(%s)")
            params.append(source_value)
        query.append("LIMIT 1")

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute("\n".join(query), params)
                row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_compat_jobs(self) -> list[dict[str, Any]]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id,
                           title,
                           company,
                           location,
                           type AS employment_type,
                           status
                    FROM jobs
                    ORDER BY id DESC
                    """
                )
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def create_compat_job(
        self,
        title: str,
        company: str | None = None,
        location: str | None = None,
        employment_type: str | None = None,
        status: str = "open",
    ) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO jobs (title, company, location, type, status)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id,
                              title,
                              company,
                              location,
                              type AS employment_type,
                              status
                    """,
                    (title, company, location, employment_type, status),
                )
                row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("PostgreSQL did not return a job id")
        return dict(row)

    async def list_compat_candidates(self) -> list[dict[str, Any]]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id,
                           name,
                           email,
                           phone,
                           location,
                           status
                    FROM candidates
                    ORDER BY id DESC
                    """
                )
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def search_compat_jobs(self, search: str, *, limit: int | None = None) -> list[dict[str, Any]]:
        terms = self._split_search_terms(search)
        if not terms:
            return []

        searchable_fields = self._job_search_fields()
        where_clause, params = self._build_search_clause(searchable_fields, search)

        query = f"""
            SELECT id, title, company, location, type, status, description, requirements, about_us, benefits, url, raw_text, updated_at
            FROM jobs
            WHERE {where_clause}
            ORDER BY updated_at DESC, id DESC
        """
        if limit is not None and limit > 0:
            query += " LIMIT %s"
            params.append(limit)

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def get_job_text(self, job_id: str) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, graph_job_id, title, company, location, type, status, description, requirements,
                           about_us, benefits, url, raw_text, parsed_profile_json
                    FROM jobs
                    WHERE graph_job_id = %s OR id::text = %s
                    LIMIT 1
                    """,
                    (job_id, job_id),
                )
                row = await cursor.fetchone()
        if row is None:
            return None
        parsed_profile_json = row.get("parsed_profile_json")
        return {
            **row,
            "parsed_profile_json": json.loads(parsed_profile_json) if isinstance(parsed_profile_json, str) and parsed_profile_json.strip() else None,
        }

    async def search_compat_matchings(self, search: str, *, limit: int | None = None) -> list[dict[str, Any]]:
        terms = self._split_search_terms(search)
        if not terms:
            return []

        fields = self._matching_search_fields()
        where_clause, params = self._build_search_clause(fields, search)
        has_table = await self.has_matching_results()
        if not has_table:
            return []

        query = f"""
            SELECT id, job_title, job_description, results, review_notes, reviewed_by, human_reviewed, created_at
            FROM matching_results m
            WHERE {where_clause}
            ORDER BY created_at DESC, id DESC
        """
        if limit is not None and limit > 0:
            query += " LIMIT %s"
            params.append(limit)

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def search_compat_candidates(
        self,
        search: str,
        *,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        has_candidate_texts = await self.has_candidate_texts()
        where_clause, params = self._build_search_clause(self._candidate_search_fields(include_candidate_texts=has_candidate_texts), search)
        if not where_clause:
            return await self.list_compat_candidates()

        candidate_text_join = " LEFT JOIN candidate_texts ct ON ct.candidate_id = c.id::text" if has_candidate_texts else ""

        query = f"""
            SELECT id,
                   name,
                   email,
                   phone,
                   location,
                   status
            FROM candidates c
            {candidate_text_join}
            WHERE {where_clause}
            ORDER BY c.updated_at DESC, c.id DESC
        """
        if limit is not None and limit > 0:
            query += " LIMIT %s"
            params.append(limit)

        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(query, params)
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def search_compat_global(self, search: str, *, limit: int | None = None) -> dict[str, list[dict[str, Any]] | int | str]:
        jobs = await self.search_compat_jobs(search, limit=limit)
        candidates = await self.search_compat_candidates(search, limit=limit)
        matchings = await self.search_compat_matchings(search, limit=limit)
        return {
            "query": search,
            "jobs": jobs,
            "candidates": candidates,
            "matchings": matchings,
            "total_jobs": len(jobs),
            "total_candidates": len(candidates),
            "total_matchings": len(matchings),
        }

    async def create_compat_candidate(
        self,
        name: str,
        email: str | None = None,
        phone: str | None = None,
        location: str | None = None,
        status: str = "new",
    ) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO candidates (name, email, phone, location, status)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id,
                              name,
                              email,
                              phone,
                              location,
                              status
                    """,
                    (name, email, phone, location, status),
                )
                row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("PostgreSQL did not return a candidate id")
        return dict(row)

    async def _upsert_job_once(
        self,
        job_id: str,
        raw_text: str,
        profile: JobProfileExtraction,
        source: str | None = None,
        source_hash: str | None = None,
        profile_hash: str | None = None,
    ) -> int:
        existing = await self._find_existing_job(job_id, profile, source=source)
        if existing is not None:
            return int(existing["id"])

        description = raw_text.strip() if raw_text and raw_text.strip() else self._render_plain_text(profile)
        requirements = self._summarize_requirements(profile)
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO jobs (
                        graph_job_id, title, company, recruiter_company, employer_company, description,
                        requirements, about_us, benefits, location, type, status, url, raw_text, source,
                        parsed_profile_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, NULL, %s, %s, 'Offen', NULL, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        job_id,
                        profile.title,
                        profile.company,
                        profile.recruiter_company,
                        profile.employer_company,
                        description,
                        requirements,
                        profile.location,
                        profile.employment_type or "Vollzeit",
                        raw_text,
                        source,
                        json.dumps(profile.model_dump(), ensure_ascii=False),
                    ),
                )
                row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("PostgreSQL did not return a job id")
        return int(row["id"])

    async def upsert_job(
        self,
        job_id: str,
        raw_text: str,
        profile: JobProfileExtraction,
        source: str | None = None,
        source_hash: str | None = None,
        profile_hash: str | None = None,
    ) -> int:
        try:
            return await self._upsert_job_once(
                job_id=job_id,
                raw_text=raw_text,
                profile=profile,
                source=source,
                source_hash=source_hash,
                profile_hash=profile_hash,
            )
        except pg_errors.UndefinedColumn as exc:
            if "graph_job_id" not in str(exc) and "source" not in str(exc):
                raise
            await self.ensure_schema()
            return await self._upsert_job_once(
                job_id=job_id,
                raw_text=raw_text,
                profile=profile,
                source=source,
                source_hash=source_hash,
                profile_hash=profile_hash,
            )

    @staticmethod
    def _summarize_requirements(profile: JobProfileExtraction) -> str | None:
        parts: list[str] = []
        mandatory = [item.name for item in profile.required_skills if item.priority == "Mandatory"]
        optional = [item.name for item in profile.required_skills if item.priority == "NiceToHave"]
        if mandatory:
            parts.append(f"Mandatory skills: {', '.join(mandatory)}")
        if optional:
            parts.append(f"Nice-to-have skills: {', '.join(optional)}")
        if profile.required_languages:
            parts.append("Languages: " + ", ".join(item.name for item in profile.required_languages))
        if profile.required_degrees:
            parts.append(
                "Degrees: " + ", ".join(f"{item.level} {item.field_of_study}" for item in profile.required_degrees)
            )
        if profile.industries:
            parts.append("Industries: " + ", ".join(item.name for item in profile.industries))
        return " | ".join(parts) if parts else None

    @staticmethod
    def _render_plain_text(profile: JobProfileExtraction) -> str:
        parts = [profile.title]
        if profile.company:
            parts.append(f"Company: {profile.company}")
        if profile.location:
            parts.append(f"Location: {profile.location}")
        if profile.employment_type:
            parts.append(f"Employment type: {profile.employment_type}")
        return "\n".join(parts)
