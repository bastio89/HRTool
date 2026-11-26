from __future__ import annotations

import json
import hashlib
import logging
import re
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import psycopg
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from services.matching_cache import MatchingInputSnapshot, MatchingLeaseLostError, MatchingPairPlan, MatchingPendingError, normalize_matching_data
from psycopg.rows import dict_row
from psycopg.pq import TransactionStatus

from models import AiUsageMetrics, CandidateProfileExtraction, JobProfileExtraction
from services.candidate_identity import DuplicateCandidateError, require_identity

logger = logging.getLogger(__name__)


class MatchingActorUnavailableError(ValueError):
    pass


class InsufficientCreditsError(ValueError):
    pass


class MatchingPreparationChangedError(RuntimeError):
    pass


# Gleiche Normalisierung wie backend/src/identity.js (Indizes und Abfragen).
def _text_key(column: str) -> str:
    return rf"lower(regexp_replace(btrim(COALESCE({column}, '')), '\s+', ' ', 'g'))"


def _url_key(column: str) -> str:
    return rf"regexp_replace(lower(btrim({column})), '^https?://(www\.)?|/+$', '', 'g')"


_UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
_MATCHING_PAIR_UPSERT = """
    INSERT INTO matching_pair_results (
        method, candidate_id, job_id, score, hard_skill_score, soft_skill_score,
        summary, strengths, weaknesses, model, engine, matched_at, qualified, evaluation_id
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (method, candidate_id, job_id) DO UPDATE SET
        score = EXCLUDED.score, hard_skill_score = EXCLUDED.hard_skill_score,
        soft_skill_score = EXCLUDED.soft_skill_score, summary = EXCLUDED.summary,
        strengths = EXCLUDED.strengths, weaknesses = EXCLUDED.weaknesses,
        model = EXCLUDED.model, engine = EXCLUDED.engine, matched_at = EXCLUDED.matched_at,
        qualified = EXCLUDED.qualified, matching_result_id = NULL, evaluation_id = EXCLUDED.evaluation_id
"""
_MATCHING_RUN_TARGET_STATES = """
    WITH raw AS (
        SELECT p.id, p.run_id, p.method, p.candidate_id, p.job_id,
            CASE WHEN sub.pair_id IS NOT NULL THEN sub.evaluation_id ELSE p.evaluation_id END AS evaluation_id,
            COALESCE(sub.disposition, CASE WHEN sub.stage IN ('failed', 'completed_with_errors', 'blocked_credits')
                THEN 'failed' WHEN sub.stage = 'needs_review' THEN 'needs_review' ELSE p.disposition END) AS saved_disposition,
            COALESCE(sub.error_code, p.error_code) AS saved_error_code,
            e.status, e.result_payload, e.owner_run_id, owner.parent_run_id,
            sub.child_run_id, sub.pair_id AS child_pair_id,
            GREATEST(p.updated_at, sub.updated_at, e.completed_at, e.created_at) AS updated_at,
            e.error_code AS evaluation_error_code, sub.stage AS child_stage
        FROM matching_run_pairs p
        LEFT JOIN LATERAL (
            SELECT child.id AS child_run_id, cp.id AS pair_id, cp.evaluation_id, cp.disposition, child.stage,
                COALESCE(cp.error_code, child.error_code) AS error_code,
                GREATEST(cp.updated_at, child.updated_at) AS updated_at
            FROM matching_runs child
            LEFT JOIN matching_run_pairs cp ON cp.run_id = child.id AND cp.method = p.method
                AND cp.candidate_id = p.candidate_id AND cp.job_id = p.job_id
            WHERE child.parent_run_id = p.run_id AND (cp.id IS NOT NULL OR child.child_key = p.job_id::text)
            ORDER BY (cp.id IS NOT NULL) DESC, child.created_at DESC LIMIT 1
        ) sub ON TRUE
        LEFT JOIN matching_pair_evaluations e ON e.id = CASE
            WHEN sub.pair_id IS NOT NULL THEN sub.evaluation_id ELSE p.evaluation_id END
        LEFT JOIN matching_runs owner ON owner.id = e.owner_run_id
        WHERE p.run_id = %s
    )
    SELECT raw.*, CASE
        WHEN saved_disposition = 'skipped' THEN 'skipped'
        WHEN status = 'succeeded' THEN CASE
            WHEN owner_run_id = run_id OR parent_run_id = run_id THEN 'computed'
            WHEN saved_disposition = 'cached' THEN 'cached' ELSE 'shared' END
        WHEN status = 'needs_review' THEN 'needs_review'
        WHEN saved_disposition = 'preparation_required' THEN 'preparation_required'
        WHEN status IN ('failed', 'superseded') THEN 'failed'
        WHEN child_stage IN ('failed', 'completed_with_errors')
            AND (status IS NULL OR status IN ('queued', 'running')) THEN 'failed'
        WHEN saved_disposition IN ('failed', 'needs_review') THEN saved_disposition
        WHEN status = 'running' THEN 'running' ELSE 'pending' END AS disposition,
        CASE WHEN saved_disposition IN ('skipped', 'preparation_required')
            THEN saved_error_code ELSE COALESCE(evaluation_error_code, saved_error_code) END AS error_code
    FROM raw
"""
_MATCHING_BATCH_RUN_SELECT = """
    SELECT r.id AS "runId", r.source, r.request_kind AS "requestKind", r.method, r.stage,
        r.entity_type AS "entityType", r.entity_id AS "entityId",
        r.actor_user_id AS "actorUserId", u.username AS "actorUsername",
        u.display_name AS "actorDisplayName", r.parent_run_id AS "parentRunId",
        r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.error_code AS "errorCode",
        r.tariff_amount::text AS "tariffAmount", r.tariff_action AS "tariffAction",
        COALESCE(t.amount, 0)::text AS "chargedAmount",
        CASE WHEN t.id IS NOT NULL THEN 'charged' WHEN r.stage = 'blocked_credits' THEN 'blocked'
            WHEN r.stage IN ('completed', 'completed_with_errors', 'failed', 'needs_review')
            THEN 'free' ELSE 'pending' END AS "creditStatus"
    FROM matching_runs r LEFT JOIN users u ON u.id = r.actor_user_id
    LEFT JOIN credit_transactions t ON t.matching_run_id = r.id
"""

# Eindeutige Identitaet von Bewerbern und Stellen. Das Backend legt dieselben
# Spalten und Indizes an; wer zuerst startet, richtet sie ein.
_IDENTITY_SCHEMA = [
    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS birth_date DATE",
    *(
        statement
        for table, graph_column in (("candidates", "graph_candidate_id"), ("jobs", "graph_job_id"))
        for statement in (
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS uuid UUID",
            f"""
            WITH graph AS (
                SELECT id, CASE WHEN {graph_column} ~ '{_UUID_PATTERN}' THEN {graph_column}::uuid END AS graph_uuid
                FROM {table}
            ), single AS (
                SELECT graph_uuid FROM graph WHERE graph_uuid IS NOT NULL GROUP BY graph_uuid HAVING COUNT(*) = 1
            )
            UPDATE {table} t SET uuid = g.graph_uuid
            FROM graph g JOIN single s ON s.graph_uuid = g.graph_uuid
            WHERE t.id = g.id AND t.uuid IS NULL
              AND NOT EXISTS (SELECT 1 FROM {table} o WHERE o.uuid = g.graph_uuid)
            """,
            f"UPDATE {table} SET uuid = gen_random_uuid() WHERE uuid IS NULL",
            f"ALTER TABLE {table} ALTER COLUMN uuid SET DEFAULT gen_random_uuid()",
            f"ALTER TABLE {table} ALTER COLUMN uuid SET NOT NULL",
        )
    ),
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_uuid ON candidates (uuid)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_uuid ON jobs (uuid)",
    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_identity ON candidates (({_text_key('name')}), birth_date) WHERE birth_date IS NOT NULL",
    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_url ON jobs (({_url_key('url')})) WHERE url IS NOT NULL AND btrim(url) <> ''",
    f"CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_identity ON jobs (({_text_key('title')}), ({_text_key('company')}), ({_text_key('location')}))",
]


class PostgresStore:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self._matching_schema_ready = False

    @asynccontextmanager
    async def _connection(
        self, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> AsyncGenerator[psycopg.AsyncConnection[Any]]:
        if connection is None:
            async with await psycopg.AsyncConnection.connect(self.database_url) as own_connection, own_connection.transaction():
                yield own_connection
        else:
            if connection.info.transaction_status == TransactionStatus.IDLE:
                raise ValueError("Eine geteilte Importverbindung benoetigt eine aktive Transaktion.")
            async with connection.transaction():
                yield connection

    async def matching_ids_for(self, table: str, ids: list[str]) -> dict[str, int]:
        if table not in {"candidates", "jobs"}:
            raise ValueError(f"Unbekannte Tabelle {table}")
        values = list(dict.fromkeys(str(value).strip() for value in ids))
        if any(not value for value in values):
            raise ValueError("Gespeicherte Matching-IDs duerfen nicht leer sein.")
        if not values:
            return {}
        graph_column = "graph_candidate_id" if table == "candidates" else "graph_job_id"
        graph_ids_select = ", graph_candidate_ids" if table == "candidates" else ""
        graph_ids_where = " OR graph_candidate_ids && %s::text[]" if table == "candidates" else ""
        params = (values, values, values, values) if table == "candidates" else (values, values, values)
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    f"""SELECT id, uuid::text AS uuid, {graph_column}{graph_ids_select}
                        FROM {table}
                        WHERE id::text = ANY(%s) OR uuid::text = ANY(%s)
                           OR {graph_column} = ANY(%s){graph_ids_where}""",
                    params,
                )
                rows = await cursor.fetchall()
        possible: dict[str, set[int]] = {value: set() for value in values}
        for row in rows:
            primary_id = int(row["id"])
            keys = {str(primary_id), str(row.get("uuid") or ""), str(row.get(graph_column) or "")}
            keys.update(row.get("graph_candidate_ids") or [])
            for key in keys:
                if key in possible and (not key.isdigit() or key == str(primary_id)):
                    possible[key].add(primary_id)
        invalid = [value for value, matches in possible.items() if len(matches) != 1]
        if invalid:
            raise ValueError(f"Gespeicherte {table}-IDs fehlen oder sind nicht eindeutig: {', '.join(invalid)}")
        return {value: next(iter(matches)) for value, matches in possible.items()}

    async def ensure_matching_pair_schema(self) -> None:
        if self._matching_schema_ready:
            return
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute("SELECT pg_advisory_xact_lock(6845271901)")
            await connection.execute("""
                CREATE TABLE IF NOT EXISTS matching_pair_results (
                    id BIGSERIAL PRIMARY KEY,
                    method TEXT NOT NULL,
                    candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
                    job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    score DOUBLE PRECISION NOT NULL,
                    hard_skill_score DOUBLE PRECISION,
                    soft_skill_score DOUBLE PRECISION,
                    summary TEXT,
                    strengths TEXT,
                    weaknesses TEXT,
                    model TEXT,
                    engine TEXT,
                    matching_result_id BIGINT REFERENCES matching_results(id) ON DELETE CASCADE,
                    matched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    qualified BOOLEAN,
                    UNIQUE (method, candidate_id, job_id)
                )
            """)
            await connection.execute("ALTER TABLE matching_pair_results ADD COLUMN IF NOT EXISTS qualified BOOLEAN")
            await connection.execute("""
                CREATE TABLE IF NOT EXISTS matching_pair_evaluations (
                    id BIGSERIAL PRIMARY KEY,
                    method TEXT NOT NULL CHECK (method IN ('vector', 'ai')),
                    candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
                    job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
                    input_fingerprint TEXT NOT NULL,
                    owner_run_id UUID,
                    status TEXT NOT NULL DEFAULT 'queued' CHECK (
                        status IN ('queued', 'running', 'succeeded', 'failed', 'needs_review', 'superseded')
                    ),
                    result_payload JSONB,
                    model_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                    lease_owner UUID,
                    lease_until TIMESTAMPTZ,
                    fence BIGINT NOT NULL DEFAULT 0,
                    call_started_at TIMESTAMPTZ,
                    error_code TEXT,
                    attempt INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMPTZ,
                    UNIQUE (method, candidate_id, job_id, input_fingerprint),
                    CHECK (status <> 'succeeded' OR (
                        result_payload IS NOT NULL AND jsonb_typeof(result_payload) = 'object'
                        AND completed_at IS NOT NULL
                    ))
                )
            """)
            await connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_matching_evaluations_candidate
                ON matching_pair_evaluations (candidate_id)
            """)
            await connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_matching_evaluations_job
                ON matching_pair_evaluations (job_id)
            """)
            await connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_matching_evaluations_lease
                ON matching_pair_evaluations (status, lease_until)
            """)
            await connection.execute("ALTER TABLE matching_pair_results ADD COLUMN IF NOT EXISTS evaluation_id BIGINT")
            await connection.execute("""
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_matching_pair_evaluation'
                        AND conrelid = 'matching_pair_results'::regclass
                    ) THEN
                        ALTER TABLE matching_pair_results ADD CONSTRAINT fk_matching_pair_evaluation
                        FOREIGN KEY (evaluation_id) REFERENCES matching_pair_evaluations(id) ON DELETE SET NULL;
                    END IF;
                END $$
            """)
            await connection.execute("""
                CREATE TABLE IF NOT EXISTS matching_runs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    import_event_key TEXT UNIQUE,
                    source TEXT NOT NULL,
                    request_kind TEXT NOT NULL DEFAULT 'import',
                    method TEXT NOT NULL DEFAULT 'vector' CHECK (method IN ('vector', 'ai')),
                    entity_type TEXT CHECK (entity_type IN ('candidate', 'job')),
                    entity_id BIGINT,
                    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    stage TEXT NOT NULL DEFAULT 'queued' CHECK (stage IN (
                        'queued', 'preparing', 'matching', 'blocked_credits', 'completed',
                        'completed_with_errors', 'needs_review', 'failed'
                    )),
                    target_count BIGINT,
                    expansion_cursor BIGINT,
                    lease_owner UUID,
                    lease_until TIMESTAMPTZ,
                    error_code TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await connection.execute("""
                CREATE TABLE IF NOT EXISTS matching_run_pairs (
                    id BIGSERIAL PRIMARY KEY,
                    run_id UUID NOT NULL REFERENCES matching_runs(id) ON DELETE CASCADE,
                    method TEXT NOT NULL CHECK (method IN ('vector', 'ai')),
                    candidate_id BIGINT NOT NULL,
                    job_id BIGINT NOT NULL,
                    evaluation_id BIGINT REFERENCES matching_pair_evaluations(id) ON DELETE SET NULL,
                    disposition TEXT NOT NULL DEFAULT 'pending' CHECK (disposition IN (
                        'pending', 'computed', 'cached', 'shared', 'failed',
                        'skipped', 'needs_review', 'preparation_required'
                    )),
                    error_code TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (run_id, method, candidate_id, job_id)
                )
            """)
            await connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_matching_runs_queue ON matching_runs (stage, created_at, id)
            """)
            await connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_matching_run_pairs_evaluation ON matching_run_pairs (evaluation_id)
            """)
            for definition in (
                "request_payload JSONB", "result_payload JSONB", "client_context JSONB",
                "tariff_amount NUMERIC(18, 2)", "tariff_action TEXT",
                "parent_run_id UUID REFERENCES matching_runs(id) ON DELETE SET NULL", "child_key TEXT",
                "retry_pair_ids BIGINT[]",
            ):
                await connection.execute(f"ALTER TABLE matching_runs ADD COLUMN IF NOT EXISTS {definition}")
            await connection.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_matching_child_run ON matching_runs (parent_run_id, child_key)
            """)
            await connection.execute("""
                CREATE TABLE IF NOT EXISTS matching_retry_audit (
                    id BIGSERIAL PRIMARY KEY,
                    run_id UUID NOT NULL REFERENCES matching_runs(id) ON DELETE CASCADE,
                    pair_id BIGINT NOT NULL REFERENCES matching_run_pairs(id) ON DELETE CASCADE,
                    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    evaluation_id BIGINT REFERENCES matching_pair_evaluations(id) ON DELETE SET NULL,
                    previous_disposition TEXT NOT NULL,
                    decision TEXT NOT NULL CHECK (decision IN ('retry', 'confirmed_uncertain_retry')),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
                )
            """)
            for table in ("candidates", "jobs"):
                await connection.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS matching_prepared_revision TEXT")
            await connection.execute("""
                CREATE OR REPLACE FUNCTION scrub_deleted_matching_source() RETURNS trigger AS $$
                DECLARE
                    ref_key TEXT;
                    source_refs TEXT[];
                    affected_runs UUID[];
                BEGIN
                    ref_key := CASE WHEN TG_TABLE_NAME = 'candidates' THEN 'candidate_refs' ELSE 'job_refs' END;
                    source_refs := ARRAY[
                        OLD.id::text, to_jsonb(OLD)->>'uuid',
                        to_jsonb(OLD)->>'graph_candidate_id', to_jsonb(OLD)->>'graph_job_id'
                    ];
                    IF TG_TABLE_NAME = 'candidates' THEN
                        source_refs := source_refs || ARRAY(
                            SELECT jsonb_array_elements_text(CASE
                                WHEN jsonb_typeof(to_jsonb(OLD)->'graph_candidate_ids') = 'array'
                                THEN to_jsonb(OLD)->'graph_candidate_ids' ELSE '[]'::jsonb END)
                        );
                    END IF;
                    SELECT array_agg(r.id) INTO affected_runs FROM matching_runs r
                    WHERE (r.request_kind = 'import' AND r.entity_id = OLD.id
                            AND r.entity_type = CASE WHEN TG_TABLE_NAME = 'candidates' THEN 'candidate' ELSE 'job' END)
                        OR (r.request_payload->ref_key) ?| source_refs
                        OR (r.client_context->ref_key) ?| source_refs OR EXISTS (
                        SELECT 1 FROM matching_run_pairs p WHERE p.run_id = r.id AND
                            CASE WHEN TG_TABLE_NAME = 'candidates'
                                THEN p.candidate_id = OLD.id ELSE p.job_id = OLD.id END
                    );
                    UPDATE matching_runs r SET request_payload = NULL, result_payload = NULL, client_context = NULL,
                        error_code = CASE WHEN affected.keep_running THEN r.error_code ELSE 'source_deleted' END,
                        lease_owner = CASE WHEN affected.keep_running THEN r.lease_owner ELSE NULL END,
                        lease_until = CASE WHEN affected.keep_running THEN r.lease_until ELSE NULL END,
                        stage = CASE WHEN affected.keep_running OR r.stage IN ('completed', 'completed_with_errors')
                            THEN r.stage ELSE 'failed' END,
                        updated_at = clock_timestamp()
                    FROM (
                        SELECT id, request_kind = 'import' AND NOT (
                            entity_id = OLD.id AND entity_type =
                                CASE WHEN TG_TABLE_NAME = 'candidates' THEN 'candidate' ELSE 'job' END
                        ) AS keep_running
                        FROM matching_runs WHERE id = ANY(affected_runs)
                    ) affected
                    WHERE r.id = affected.id;
                    UPDATE matching_results SET results = '{}', results_summary = NULL,
                        job_description = '', job_title = 'Geloeschtes Matching'
                    WHERE matching_run_id = ANY(affected_runs);
                    UPDATE matching_run_pairs SET disposition = 'skipped', error_code = 'source_deleted',
                        updated_at = clock_timestamp()
                    WHERE CASE WHEN TG_TABLE_NAME = 'candidates'
                        THEN candidate_id = OLD.id ELSE job_id = OLD.id END;
                    RETURN OLD;
                END;
                $$ LANGUAGE plpgsql
            """)
            for table in ("candidates", "jobs"):
                await connection.execute(f"""
                    CREATE OR REPLACE TRIGGER scrub_matching_on_delete
                    BEFORE DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION scrub_deleted_matching_source()
                """)
            await connection.execute("""
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'fk_matching_evaluation_owner_run'
                        AND conrelid = 'matching_pair_evaluations'::regclass
                    ) THEN
                        ALTER TABLE matching_pair_evaluations ADD CONSTRAINT fk_matching_evaluation_owner_run
                        FOREIGN KEY (owner_run_id) REFERENCES matching_runs(id) ON DELETE SET NULL;
                    END IF;
                END $$
            """)
            for table in ("credit_transactions", "matching_results"):
                await connection.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS matching_run_id UUID")
                await connection.execute(f"""
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_matching_run ON {table} (matching_run_id)
                    WHERE matching_run_id IS NOT NULL
                """)
                await connection.execute(f"""
                    DO $$ BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'fk_{table}_matching_run'
                            AND conrelid = '{table}'::regclass
                        ) THEN
                            ALTER TABLE {table} ADD CONSTRAINT fk_{table}_matching_run
                            FOREIGN KEY (matching_run_id) REFERENCES matching_runs(id) ON DELETE SET NULL;
                        END IF;
                    END $$
                """)
        self._matching_schema_ready = True

    @asynccontextmanager
    async def matching_preparation_lock(self, entity_type: Literal["candidate", "job"], entity_id: int):
        if entity_type not in {"candidate", "job"}:
            raise ValueError("Unbekannte Matching-Quelle.")
        async with await psycopg.AsyncConnection.connect(self.database_url, autocommit=True) as connection:
            await connection.execute(
                "SELECT pg_advisory_lock(hashtextextended(%s, 0))",
                (f"matching-preparation:{entity_type}:{entity_id}",),
            )
            yield

    async def matching_source_snapshot(
        self, entity_type: Literal["candidate", "job"], entity_id: int, *,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any]:
        if entity_type not in {"candidate", "job"}:
            raise ValueError("Unbekannte Matching-Quelle.")
        if connection is None:
            async with await psycopg.AsyncConnection.connect(self.database_url) as own, own.transaction():
                await own.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
                return await self.matching_source_snapshot(entity_type, entity_id, connection=own)
        if entity_type == "candidate":
            rows = await self.list_candidates_for_backfill([entity_id], connection=connection)
            text = await self.get_candidate_text(str(entity_id), connection=connection)
        else:
            rows = await self.list_jobs_for_sync([entity_id], connection=connection)
            text = None
        if not rows:
            raise ValueError("Matching-Quelle wurde geloescht.")
        row = rows[0]
        content = {
            key: value for key, value in row.items()
            if key not in {"id", "candidate_id", "graph_candidate_id", "graph_candidate_ids", "graph_job_id", "source"}
        }
        if text is not None:
            content["text"] = {key: text.get(key) for key in ("original_text", "profile_json")}
        serialized = json.dumps(normalize_matching_data(content), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        table = "candidates" if entity_type == "candidate" else "jobs"
        async with connection.cursor(row_factory=dict_row) as cursor:
            await cursor.execute(f"SELECT matching_prepared_revision FROM {table} WHERE id = %s", (entity_id,))
            prepared = await cursor.fetchone()
        return {
            "entity_type": entity_type, "entity_id": entity_id, "row": row, "text": text,
            "revision": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
            "prepared_revision": prepared["matching_prepared_revision"] if prepared else None,
        }

    async def confirm_matching_preparation(self, snapshot: dict[str, Any]) -> str:
        entity_type, entity_id = snapshot["entity_type"], snapshot["entity_id"]
        if entity_type not in {"candidate", "job"}:
            raise ValueError("Unbekannte Matching-Quelle.")
        table = "candidates" if entity_type == "candidate" else "jobs"
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection, connection.transaction():
            row = await (await connection.execute(
                f"SELECT id FROM {table} WHERE id = %s FOR UPDATE", (entity_id,),
            )).fetchone()
            if row is None:
                raise MatchingPreparationChangedError("Matching-Quelle wurde waehrend der Aufbereitung geloescht.")
            current = await self.matching_source_snapshot(entity_type, entity_id, connection=connection)
            valid = current["revision"] == snapshot["revision"]
            await connection.execute(
                f"UPDATE {table} SET matching_prepared_revision = %s WHERE id = %s",
                (snapshot["revision"] if valid else None, entity_id),
            )
        if not valid:
            raise MatchingPreparationChangedError("Matching-Quelle wurde waehrend der Aufbereitung geaendert.")
        return snapshot["revision"]

    async def invalidate_matching_preparation(self, entity_type: Literal["candidate", "job"], entity_id: int) -> None:
        if entity_type not in {"candidate", "job"}:
            raise ValueError("Unbekannte Matching-Quelle.")
        table = "candidates" if entity_type == "candidate" else "jobs"
        async with self._connection() as connection:
            await connection.execute(f"UPDATE {table} SET matching_prepared_revision = NULL WHERE id = %s", (entity_id,))

    async def enqueue_matching_import(
        self,
        entity_type: Literal["candidate", "job"],
        entity_id: int,
        *,
        actor_user_id: int | None,
        source: str,
        event_key: str,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> str:
        if entity_type not in {"candidate", "job"} or not source.strip() or not event_key.strip():
            raise ValueError("Importauftrag benoetigt Entitaet, Quelle und Ereignisschluessel.")
        if connection is None:
            await self.ensure_matching_pair_schema()
            async with await psycopg.AsyncConnection.connect(self.database_url) as own_connection:
                return await self.enqueue_matching_import(
                    entity_type, entity_id, actor_user_id=actor_user_id,
                    source=source, event_key=event_key, connection=own_connection,
                )
        table = "candidates" if entity_type == "candidate" else "jobs"
        exists = await (await connection.execute(
            f"SELECT id FROM {table} WHERE id = %s", (entity_id,),
        )).fetchone()
        if exists is None:
            raise ValueError("Importauftrag benoetigt einen gespeicherten Datensatz.")
        row = await (await connection.execute(
            """
            INSERT INTO matching_runs (import_event_key, source, entity_type, entity_id, actor_user_id, stage, error_code)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (import_event_key) DO UPDATE SET import_event_key = EXCLUDED.import_event_key
            WHERE matching_runs.entity_type = EXCLUDED.entity_type
              AND matching_runs.entity_id = EXCLUDED.entity_id
              AND matching_runs.actor_user_id IS NOT DISTINCT FROM EXCLUDED.actor_user_id
            RETURNING id::text
            """,
            (event_key, source, entity_type, entity_id, actor_user_id,
             "queued" if actor_user_id is not None else "blocked_credits",
             None if actor_user_id is not None else "missing_actor"),
        )).fetchone()
        if row is None:
            raise ValueError("Importereignis ist bereits einem anderen Auftrag zugeordnet.")
        return str(row[0])

    async def get_matching_run(self, run_id: str) -> dict[str, Any] | None:
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            return await (await connection.execute("SELECT * FROM matching_runs WHERE id = %s", (run_id,))).fetchone()

    async def get_matching_batch_run(self, run_id: str) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            return await (await connection.execute(
                _MATCHING_BATCH_RUN_SELECT + " WHERE r.id = %s", (run_id,),
            )).fetchone()

    async def list_matching_batches(
        self, *, status: str | None = None, source: str | None = None,
        cursor: str | None = None, limit: int = 25,
    ) -> dict[str, Any]:
        if not 1 <= limit <= 100:
            raise ValueError("Seitengroesse muss zwischen 1 und 100 liegen.")
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            boundary = None
            if cursor is not None:
                boundary = await (await connection.execute(
                    "SELECT created_at, id FROM matching_runs WHERE id = %s", (cursor,),
                )).fetchone()
                if boundary is None:
                    raise ValueError("Unbekannter Lauf-Cursor.")
            query = _MATCHING_BATCH_RUN_SELECT + """
                WHERE (%s::text IS NULL OR r.stage = %s) AND (%s::text IS NULL OR r.source = %s)"""
            parameters: list[Any] = [status, status, source, source]
            if boundary is not None:
                query += " AND (r.created_at, r.id) < (%s, %s)"
                parameters.extend([boundary["created_at"], boundary["id"]])
            rows = await (await connection.execute(
                query + " ORDER BY r.created_at DESC, r.id DESC LIMIT %s", [*parameters, limit + 1],
            )).fetchall()
        return {
            "items": rows[:limit],
            "nextCursor": str(rows[limit - 1]["runId"]) if len(rows) > limit else None,
        }

    async def get_matching_batch_summary(self) -> dict[str, int]:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            row = await (await connection.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE stage = 'queued') AS "queuedCount",
                    COUNT(*) FILTER (WHERE stage IN ('preparing', 'matching')) AS "runningCount",
                    COUNT(*) FILTER (WHERE stage = 'blocked_credits') AS "blockedCreditsCount",
                    COUNT(*) FILTER (WHERE stage = 'needs_review') AS "needsReviewCount",
                    COUNT(*) FILTER (WHERE stage = 'failed') AS "failedCount",
                    COUNT(*) FILTER (WHERE stage = 'completed_with_errors') AS "completedWithErrorsCount"
                FROM matching_runs
                WHERE stage IN (
                    'queued', 'preparing', 'matching', 'blocked_credits',
                    'needs_review', 'failed', 'completed_with_errors'
                )
            """)).fetchone()
        return {key: int(value) for key, value in row.items()}

    async def list_matching_batch_pairs(
        self, run_id: str, *, status: str | None = None, cursor: int | None = None, limit: int = 25,
    ) -> dict[str, Any]:
        if not 1 <= limit <= 100:
            raise ValueError("Seitengroesse muss zwischen 1 und 100 liegen.")
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            if cursor is not None and await (await connection.execute(
                "SELECT id FROM matching_run_pairs WHERE run_id = %s AND id = %s", (run_id, cursor),
            )).fetchone() is None:
                raise ValueError("Unbekannter Paar-Cursor fuer diesen Lauf.")
            rows = await (await connection.execute(
                f"""WITH states AS ({_MATCHING_RUN_TARGET_STATES})
                    SELECT * FROM states WHERE (%s::text IS NULL OR disposition = %s) AND id > %s
                    ORDER BY id LIMIT %s""",
                (run_id, status, status, cursor or 0, limit + 1),
            )).fetchall()
        return {
            "items": rows[:limit],
            "nextCursor": rows[limit - 1]["id"] if len(rows) > limit else None,
        }

    async def get_matching_retry_scope(self, run_id: str) -> dict[tuple[str, int, int], dict[str, Any]] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            run = await (await connection.execute(
                "SELECT retry_pair_ids FROM matching_runs WHERE id = %s", (run_id,),
            )).fetchone()
            if run is None or run["retry_pair_ids"] is None:
                return None
            rows = await (await connection.execute(_MATCHING_RUN_TARGET_STATES, (run_id,))).fetchall()
        return {
            (row["method"], row["candidate_id"], row["job_id"]): {
                **row, "retry_selected": row["id"] in run["retry_pair_ids"],
            } for row in rows
        }

    async def retry_matching_pairs(
        self, run_id: str, pair_ids: list[int], *, actor_user_id: int, confirm_uncertain: bool,
    ) -> dict[str, Any] | None:
        if not pair_ids or len(pair_ids) > 100 or len(set(pair_ids)) != len(pair_ids):
            raise ValueError("Eine eindeutige Auswahl von 1 bis 100 Paarziel-IDs ist erforderlich.")
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            admin = await (await connection.execute(
                "SELECT id FROM users WHERE id = %s AND role = 'admin' FOR SHARE", (actor_user_id,),
            )).fetchone()
            if admin is None:
                raise PermissionError("Nur aktuelle Administratoren duerfen Paare wiederaufnehmen.")
            root = await (await connection.execute("SELECT * FROM matching_runs WHERE id = %s", (run_id,))).fetchone()
            if root is None:
                return None
            states_query = f"WITH states AS ({_MATCHING_RUN_TARGET_STATES}) SELECT * FROM states WHERE id = ANY(%s)"
            selected = await (await connection.execute(states_query, (run_id, pair_ids))).fetchall()
            if len(selected) != len(pair_ids):
                raise ValueError("Paarziel-IDs gehoeren nicht vollstaendig zu diesem Lauf.")
            run_ids = {run_id}
            for row in selected:
                run_ids.update(str(value) for value in (row["child_run_id"], row["owner_run_id"]) if value is not None)
            parents = await (await connection.execute(
                "SELECT parent_run_id FROM matching_runs WHERE id = ANY(%s::uuid[])", (list(run_ids),),
            )).fetchall()
            run_ids.update(str(row["parent_run_id"]) for row in parents if row["parent_run_id"] is not None)
            runs = await (await connection.execute(
                """SELECT *, lease_owner IS NOT NULL AND lease_until > clock_timestamp() AS active
                   FROM matching_runs WHERE id = ANY(%s::uuid[]) ORDER BY id FOR NO KEY UPDATE""",
                (list(run_ids),),
            )).fetchall()
            by_id = {str(row["id"]): row for row in runs}
            if len(by_id) != len(run_ids):
                raise ValueError("Der urspruengliche Lauf ist nicht mehr verfuegbar.")
            if any(row["active"] for row in runs):
                raise ValueError("Retry ist erst ohne aktiven Worker moeglich.")
            if any(row["error_code"] == "source_deleted" or row["actor_user_id"] is None for row in runs):
                raise ValueError("Geloeschte Quellen oder fehlende ausfuehrende Benutzer verhindern den Retry.")
            selected = await (await connection.execute(states_query, (run_id, pair_ids))).fetchall()
            evaluation_ids = sorted({row["evaluation_id"] for row in selected if row["evaluation_id"] is not None})
            evaluations = await (await connection.execute(
                "SELECT * FROM matching_pair_evaluations WHERE id = ANY(%s::bigint[]) ORDER BY id FOR UPDATE",
                (evaluation_ids,),
            )).fetchall()
            evaluations_by_id = {row["id"]: row for row in evaluations}
            for row in selected:
                if row["child_run_id"] is not None and str(row["child_run_id"]) not in by_id:
                    raise ValueError("Der Teillauf hat sich geaendert; bitte Status neu laden.")
                evaluation = evaluations_by_id.get(row["evaluation_id"])
                if row["disposition"] not in {"failed", "needs_review", "preparation_required"} and not (
                    row["disposition"] == "pending" and by_id[run_id]["stage"] == "blocked_credits"
                ):
                    raise ValueError("Nur fehlgeschlagene, blockierte oder pruefbeduerftige Paarziele sind wiederholbar.")
                if evaluation is not None:
                    if evaluation["status"] in {"running", "succeeded"}:
                        raise ValueError("Laufende oder gueltige Paarungen duerfen nicht wiederholt werden.")
                    if evaluation["owner_run_id"] is not None and str(evaluation["owner_run_id"]) not in by_id:
                        raise ValueError("Der Paar-Eigentuemer hat sich geaendert; bitte Status neu laden.")
                uncertain = row["disposition"] == "needs_review" or (
                    evaluation is not None and evaluation["call_started_at"] is not None
                )
                if uncertain and not confirm_uncertain:
                    raise ValueError(
                        "Ein Provideraufruf kann bereits ausgefuehrt worden sein. "
                        "Zusaetzliche Providerkosten mit confirmUncertain=true ausdruecklich bestaetigen."
                    )

            targets: dict[str, set[int]] = {}

            async def add_target(target_run: str, pair_id: int) -> None:
                targets.setdefault(target_run, set()).add(pair_id)
                parent_id = by_id[target_run]["parent_run_id"]
                if parent_id is not None:
                    parent_target = await (await connection.execute(
                        """INSERT INTO matching_run_pairs (run_id, method, candidate_id, job_id, evaluation_id, disposition)
                           SELECT %s, method, candidate_id, job_id, evaluation_id, 'pending'
                           FROM matching_run_pairs WHERE id = %s
                           ON CONFLICT (run_id, method, candidate_id, job_id) DO UPDATE SET
                               disposition = 'pending', error_code = NULL, updated_at = clock_timestamp()
                           RETURNING id""", (parent_id, pair_id),
                    )).fetchone()
                    assert parent_target is not None
                    targets.setdefault(str(parent_id), set()).add(parent_target["id"])

            reset_evaluations: set[int] = set()
            for row in selected:
                await add_target(run_id, row["id"])
                actual_run = str(row["child_run_id"] or run_id)
                if row["child_run_id"] is not None:
                    child_target = await (await connection.execute(
                        """INSERT INTO matching_run_pairs (run_id, method, candidate_id, job_id, evaluation_id)
                           VALUES (%s, %s, %s, %s, %s)
                           ON CONFLICT (run_id, method, candidate_id, job_id) DO UPDATE SET
                               disposition = 'pending', error_code = NULL, updated_at = clock_timestamp()
                           RETURNING id""",
                        (actual_run, row["method"], row["candidate_id"], row["job_id"], row["evaluation_id"]),
                    )).fetchone()
                    assert child_target is not None
                    await add_target(actual_run, child_target["id"])
                evaluation = evaluations_by_id.get(row["evaluation_id"])
                if evaluation is not None and evaluation["id"] not in reset_evaluations:
                    owner_run = str(evaluation["owner_run_id"] or actual_run)
                    owner_target = await (await connection.execute(
                        "SELECT id FROM matching_run_pairs WHERE run_id = %s AND evaluation_id = %s",
                        (owner_run, evaluation["id"]),
                    )).fetchone()
                    if owner_target is None:
                        raise ValueError("Das urspruengliche Paarziel ist nicht mehr verfuegbar.")
                    await add_target(owner_run, owner_target["id"])
                    await connection.execute(
                        """UPDATE matching_pair_evaluations SET status = 'queued', error_code = NULL,
                           lease_owner = NULL, lease_until = NULL, call_started_at = NULL,
                           result_payload = NULL, completed_at = NULL, fence = fence + 1,
                           owner_run_id = COALESCE(owner_run_id, %s) WHERE id = %s""",
                        (owner_run, evaluation["id"]),
                    )
                    reset_evaluations.add(evaluation["id"])
                await connection.execute(
                    """INSERT INTO matching_retry_audit
                       (run_id, pair_id, actor_user_id, evaluation_id, previous_disposition, decision)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (run_id, row["id"], actor_user_id, row["evaluation_id"], row["disposition"],
                     "confirmed_uncertain_retry" if row["disposition"] == "needs_review" or (
                         evaluation is not None and evaluation["call_started_at"] is not None
                     ) else "retry"),
                )
            for target_run, ids in targets.items():
                await connection.execute(
                    """UPDATE matching_pair_evaluations SET
                       status = CASE WHEN call_started_at IS NULL THEN 'failed' ELSE 'needs_review' END,
                       error_code = CASE WHEN call_started_at IS NULL THEN 'retry_not_selected'
                           ELSE 'uncertain_provider_result' END,
                       lease_owner = NULL, lease_until = NULL, fence = fence + 1
                       WHERE owner_run_id = %s AND status IN ('queued', 'running')
                           AND id <> ALL(%s::bigint[])""",
                    (target_run, list(reset_evaluations)),
                )
                await connection.execute(
                    f"""WITH states AS ({_MATCHING_RUN_TARGET_STATES})
                        UPDATE matching_run_pairs p SET disposition = 'failed', error_code = 'retry_not_selected',
                            updated_at = clock_timestamp()
                        FROM states s WHERE p.id = s.id AND p.id <> ALL(%s::bigint[])
                            AND (s.disposition = 'pending' OR (s.disposition = 'failed' AND p.disposition = 'pending'))""",
                    (target_run, list(ids)),
                )
                await connection.execute(
                    """UPDATE matching_run_pairs SET disposition = 'pending', error_code = NULL,
                       updated_at = clock_timestamp() WHERE run_id = %s AND id = ANY(%s)""",
                    (target_run, list(ids)),
                )
                await connection.execute(
                    """UPDATE matching_runs SET stage = 'queued', error_code = NULL, retry_pair_ids = %s,
                       lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp() WHERE id = %s""",
                    (list(ids), target_run),
                )
        return {"runId": run_id, "stage": "queued"}

    async def create_matching_run(
        self, *, actor_user_id: int, source: str, method: Literal["vector", "ai"],
        request_payload: dict[str, Any] | None = None,
        tariff_amount: Decimal | str | None = None, tariff_action: str | None = None,
        request_kind: Literal["interactive", "interactive_selection"] = "interactive",
    ) -> str:
        if method not in {"vector", "ai"} or not source.strip():
            raise ValueError("Matchingauftrag benoetigt Methode und Quelle.")
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            row = await (await connection.execute(
                """INSERT INTO matching_runs (
                       actor_user_id, source, method, request_kind, stage, request_payload, tariff_amount, tariff_action
                   ) VALUES (%s, %s, %s, %s, 'preparing', %s, %s, %s) RETURNING id::text""",
                (actor_user_id, source, method, request_kind,
                 Jsonb(normalize_matching_data(request_payload)) if request_payload is not None else None,
                 tariff_amount, tariff_action),
            )).fetchone()
            assert row is not None
            return row[0]

    async def claim_matching_request(self, run_id: str, owner: str) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            return await (await connection.execute(
                """UPDATE matching_runs SET lease_owner = %s,
                       lease_until = clock_timestamp() + INTERVAL '60 seconds', updated_at = clock_timestamp()
                   WHERE id = %s AND request_kind IN ('interactive', 'interactive_selection')
                     AND stage IN ('queued', 'preparing', 'matching')
                     AND request_payload->>'handler' IS NOT NULL
                     AND (lease_until IS NULL OR lease_until <= clock_timestamp())
                   RETURNING *""", (owner, run_id),
            )).fetchone()

    async def claim_matching_import(self, run_id: str, owner: str) -> dict[str, Any] | None:
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            return await (await connection.execute(
                """UPDATE matching_runs SET lease_owner = %s,
                       lease_until = clock_timestamp() + INTERVAL '60 seconds',
                       tariff_amount = -0.10, tariff_action = '3D_MATCH',
                       stage = CASE WHEN target_count IS NULL THEN 'preparing' ELSE 'matching' END,
                       updated_at = clock_timestamp()
                   WHERE id = %s AND request_kind = 'import' AND method = 'vector'
                     AND stage IN ('queued', 'preparing', 'matching')
                     AND error_code IS DISTINCT FROM 'source_deleted'
                     AND (lease_until IS NULL OR lease_until <= clock_timestamp())
                   RETURNING *""", (owner, run_id),
            )).fetchone()

    async def expand_matching_import(self, run_id: str, owner: str) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            run = await (await connection.execute(
                """SELECT * FROM matching_runs WHERE id = %s AND request_kind = 'import' AND method = 'vector'
                   AND lease_owner = %s AND lease_until > clock_timestamp()
                   AND error_code IS DISTINCT FROM 'source_deleted' FOR NO KEY UPDATE""", (run_id, owner),
            )).fetchone()
            if run is None:
                raise MatchingLeaseLostError(f"Matching-Import {run_id} hat seine Lease verloren.")
            if run["target_count"] is not None:
                return run
            if run["entity_type"] not in {"candidate", "job"}:
                raise ValueError("Matching-Import benoetigt eine gespeicherte Quelle.")
            source_table, counterpart_table = (
                ("candidates", "jobs") if run["entity_type"] == "candidate" else ("jobs", "candidates")
            )
            source = await (await connection.execute(
                f"SELECT id FROM {source_table} WHERE id = %s", (run["entity_id"],),
            )).fetchone()
            if source is None:
                missing = await (await connection.execute(
                    """UPDATE matching_runs SET stage = 'failed', error_code = 'source_deleted',
                           lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
                       WHERE id = %s AND lease_owner = %s AND lease_until > clock_timestamp() RETURNING *""",
                    (run_id, owner),
                )).fetchone()
                if missing is None:
                    raise MatchingLeaseLostError(f"Matching-Import {run_id} hat seine Lease verloren.")
                return missing
            candidate_sql, job_sql = ("%s", "id") if run["entity_type"] == "candidate" else ("id", "%s")
            await connection.execute(
                f"""INSERT INTO matching_run_pairs (run_id, method, candidate_id, job_id)
                    SELECT %s, 'vector', {candidate_sql}, {job_sql} FROM {counterpart_table} ORDER BY id
                    ON CONFLICT (run_id, method, candidate_id, job_id) DO NOTHING""",
                (run_id, run["entity_id"]),
            )
            expanded = await (await connection.execute(
                """WITH targets AS (SELECT COUNT(*) AS total FROM matching_run_pairs WHERE run_id = %s)
                   UPDATE matching_runs r SET
                       target_count = targets.total,
                       stage = CASE WHEN targets.total = 0 THEN 'completed' ELSE 'matching' END,
                       lease_owner = CASE WHEN targets.total = 0 THEN NULL ELSE r.lease_owner END,
                       lease_until = CASE WHEN targets.total = 0 THEN NULL ELSE r.lease_until END,
                       updated_at = clock_timestamp()
                   FROM targets WHERE r.id = %s AND r.lease_owner = %s
                       AND r.lease_until > clock_timestamp() RETURNING r.*""",
                (run_id, run_id, owner),
            )).fetchone()
            if expanded is None:
                raise MatchingLeaseLostError(f"Matching-Import {run_id} hat seine Lease bei der Expansion verloren.")
            return expanded

    async def heartbeat_matching_request(self, run_id: str, owner: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            result = await connection.execute(
                """UPDATE matching_runs SET lease_until = clock_timestamp() + INTERVAL '60 seconds'
                   WHERE id = %s AND lease_owner = %s AND lease_until > clock_timestamp()""", (run_id, owner),
            )
            if result.rowcount != 1:
                raise MatchingLeaseLostError(f"Matching-Lauflease {run_id} verloren.")

    async def list_matching_import_targets(
        self, run_id: str, owner: str, *, after_id: int = 0, limit: int = 25,
    ) -> list[dict[str, Any]]:
        if not 1 <= limit <= 100:
            raise ValueError("Matching-Paarblock muss zwischen 1 und 100 Eintraegen enthalten.")
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            locked = await (await connection.execute(
                """SELECT id, retry_pair_ids FROM matching_runs WHERE id = %s AND request_kind = 'import'
                   AND lease_owner = %s AND lease_until > clock_timestamp()
                   AND error_code IS DISTINCT FROM 'source_deleted' FOR NO KEY UPDATE""", (run_id, owner),
            )).fetchone()
            if locked is None:
                raise MatchingLeaseLostError(f"Matching-Import {run_id} hat seine Lease verloren.")
            return await (await connection.execute(
                """SELECT * FROM matching_run_pairs WHERE run_id = %s AND id > %s
                   AND disposition = 'pending' AND (%s::bigint[] IS NULL OR id = ANY(%s::bigint[]))
                   ORDER BY id LIMIT %s""",
                (run_id, after_id, locked["retry_pair_ids"], locked["retry_pair_ids"], limit),
            )).fetchall()

    async def set_matching_import_stage(
        self, run_id: str, owner: str, stage: Literal["preparing", "matching"],
    ) -> None:
        if stage not in {"preparing", "matching"}:
            raise ValueError("Unbekannte aktive Matching-Importphase.")
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            updated = await connection.execute(
                """UPDATE matching_runs SET stage = %s, updated_at = clock_timestamp()
                   WHERE id = %s AND request_kind = 'import' AND lease_owner = %s
                       AND lease_until > clock_timestamp() AND error_code IS DISTINCT FROM 'source_deleted'""",
                (stage, run_id, owner),
            )
            if updated.rowcount != 1:
                raise MatchingLeaseLostError(f"Matching-Import {run_id} hat seine Lease verloren.")

    async def mark_matching_import_pair_error(
        self, run_id: str, owner: str, pair_id: int, *,
        disposition: Literal["preparation_required", "failed"], error_code: str,
    ) -> None:
        if disposition not in {"preparation_required", "failed"} or not error_code:
            raise ValueError("Matching-Paarfehler benoetigt Status und Fehlercode.")
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            locked = await (await connection.execute(
                """SELECT id FROM matching_runs WHERE id = %s AND request_kind = 'import'
                   AND lease_owner = %s AND lease_until > clock_timestamp()
                   AND error_code IS DISTINCT FROM 'source_deleted' FOR NO KEY UPDATE""", (run_id, owner),
            )).fetchone()
            if locked is None:
                raise MatchingLeaseLostError(f"Matching-Import {run_id} hat seine Lease verloren.")
            await connection.execute(
                """UPDATE matching_run_pairs SET disposition = %s, error_code = %s, updated_at = clock_timestamp()
                   WHERE id = %s AND run_id = %s AND disposition IN ('pending', 'failed', 'preparation_required')""",
                (disposition, error_code, pair_id, run_id),
            )

    async def release_matching_request(self, run_id: str, owner: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                """UPDATE matching_runs SET lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
                   WHERE id = %s AND lease_owner = %s""", (run_id, owner),
            )

    async def complete_matching_request(
        self, run_id: str, owner: str, payload: dict[str, Any], *, has_errors: bool = False,
    ) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            locked = await (await connection.execute(
                """SELECT request_kind FROM matching_runs WHERE id = %s AND lease_owner = %s
                   AND lease_until > clock_timestamp() AND error_code IS DISTINCT FROM 'source_deleted'
                   FOR NO KEY UPDATE""", (run_id, owner),
            )).fetchone()
            if locked is None:
                raise MatchingLeaseLostError(f"Matching-Lauf {run_id} kann nicht abgeschlossen werden.")
            unfinished = await (await connection.execute(
                f"""WITH states AS ({_MATCHING_RUN_TARGET_STATES})
                    SELECT evaluation_id FROM states WHERE disposition IN ('pending', 'running')
                        AND (%s = 'import' OR evaluation_id IS NOT NULL)""", (run_id, locked[0]),
            )).fetchall()
            if unfinished:
                raise MatchingPendingError([row[0] for row in unfinished if row[0] is not None])
            await connection.execute(
                """UPDATE matching_run_pairs SET disposition = 'failed', error_code = 'preparation_failed',
                       updated_at = clock_timestamp()
                   WHERE run_id = %s AND evaluation_id IS NULL AND disposition = 'pending'""", (run_id,),
            )
            await connection.execute(
                f"""WITH states AS ({_MATCHING_RUN_TARGET_STATES})
                    UPDATE matching_run_pairs p SET
                        disposition = CASE WHEN states.disposition = 'running' THEN 'pending' ELSE states.disposition END,
                        error_code = states.error_code, updated_at = clock_timestamp()
                    FROM states WHERE p.id = states.id""", (run_id,),
            )
            result = await connection.execute(
                """UPDATE matching_runs SET result_payload = %s, stage = CASE
                       WHEN EXISTS (SELECT 1 FROM matching_run_pairs WHERE run_id = %s AND disposition = 'needs_review')
                           THEN 'needs_review'
                       WHEN %s OR EXISTS (SELECT 1 FROM matching_run_pairs WHERE run_id = %s
                           AND disposition IN ('failed', 'preparation_required'))
                           THEN 'completed_with_errors' ELSE 'completed' END,
                       target_count = (SELECT COUNT(*) FROM matching_run_pairs WHERE run_id = %s),
                       error_code = NULL, lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
                   WHERE id = %s AND lease_owner = %s AND lease_until > clock_timestamp()
                     AND error_code IS DISTINCT FROM 'source_deleted'""",
                (Jsonb(normalize_matching_data(payload)), run_id, has_errors, run_id, run_id, run_id, owner),
            )
            if result.rowcount != 1:
                raise MatchingLeaseLostError(f"Matching-Lauf {run_id} konnte nicht abgeschlossen werden.")

    async def fail_matching_request(self, run_id: str, owner: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            locked = await (await connection.execute(
                "SELECT id FROM matching_runs WHERE id = %s AND lease_owner = %s FOR NO KEY UPDATE",
                (run_id, owner),
            )).fetchone()
            if locked is None:
                logger.info("Ignoring failure from stale matching run owner: %s", run_id)
                return
            await connection.execute(
                """UPDATE matching_pair_evaluations SET
                       status = CASE WHEN call_started_at IS NULL THEN 'queued' ELSE 'needs_review' END,
                       error_code = CASE WHEN call_started_at IS NULL
                           THEN NULL ELSE 'uncertain_provider_result' END,
                       owner_run_id = CASE WHEN call_started_at IS NULL THEN NULL ELSE owner_run_id END,
                       lease_owner = NULL, lease_until = NULL, fence = fence + 1
                   WHERE owner_run_id = %s AND status = 'running'""",
                (run_id,),
            )
            await connection.execute(
                """UPDATE matching_run_pairs SET disposition = 'failed', error_code = 'preparation_failed',
                       updated_at = clock_timestamp()
                   WHERE run_id = %s AND evaluation_id IS NULL AND disposition = 'pending'
                       AND NOT EXISTS (SELECT 1 FROM matching_runs WHERE id = %s AND stage = 'blocked_credits')""",
                (run_id, run_id),
            )
            await connection.execute(
                """UPDATE matching_runs SET stage = CASE WHEN stage = 'blocked_credits' THEN stage
                       WHEN EXISTS (SELECT 1 FROM matching_run_pairs p JOIN matching_pair_evaluations e
                           ON e.id = p.evaluation_id WHERE p.run_id = %s AND e.status = 'needs_review')
                           THEN 'needs_review' ELSE 'failed' END,
                       request_payload = CASE WHEN EXISTS (
                           SELECT 1 FROM matching_run_pairs WHERE run_id = %s
                       ) THEN request_payload ELSE NULL END,
                       error_code = COALESCE(error_code, 'request_failed'),
                       lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
                   WHERE id = %s AND lease_owner = %s""", (run_id, run_id, run_id, owner),
            )

    async def interrupt_matching_request(self, run_id: str, owner: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            locked = await (await connection.execute(
                "SELECT id FROM matching_runs WHERE id = %s AND lease_owner = %s FOR NO KEY UPDATE",
                (run_id, owner),
            )).fetchone()
            if locked is None:
                return
            await connection.execute(
                """UPDATE matching_pair_evaluations SET status = CASE
                       WHEN call_started_at IS NULL THEN 'queued' ELSE 'needs_review' END,
                       error_code = CASE WHEN call_started_at IS NULL THEN NULL ELSE 'uncertain_provider_result' END,
                       owner_run_id = CASE WHEN call_started_at IS NULL THEN NULL ELSE owner_run_id END,
                       lease_owner = NULL, lease_until = NULL, fence = fence + 1
                   WHERE owner_run_id = %s AND status IN ('running', 'failed')""", (run_id,),
            )
            await connection.execute(
                """UPDATE matching_runs SET stage = CASE WHEN EXISTS (
                       SELECT 1 FROM matching_pair_evaluations WHERE owner_run_id = %s AND status = 'needs_review'
                   ) THEN 'needs_review' ELSE 'queued' END,
                       lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
                   WHERE id = %s AND lease_owner = %s""", (run_id, run_id, owner),
            )

    async def list_recoverable_matching_requests(self) -> list[str]:
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            rows = await (await connection.execute(
                """SELECT id::text FROM matching_runs WHERE request_kind IN ('interactive', 'interactive_selection')
                   AND stage IN ('queued', 'preparing', 'matching') AND request_payload->>'handler' IS NOT NULL
                   AND (lease_until IS NULL OR lease_until <= clock_timestamp())
                   ORDER BY created_at, id LIMIT 5""",
            )).fetchall()
            return [row[0] for row in rows]

    async def list_recoverable_matching_imports(self) -> list[str]:
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            rows = await (await connection.execute(
                """SELECT id::text FROM matching_runs WHERE request_kind = 'import' AND method = 'vector'
                   AND stage IN ('queued', 'preparing', 'matching') AND error_code IS DISTINCT FROM 'source_deleted'
                   AND (lease_until IS NULL OR lease_until <= clock_timestamp())
                   ORDER BY updated_at, created_at, id LIMIT 5""",
            )).fetchall()
            return [row[0] for row in rows]

    async def get_matching_pending_response(self, run_id: str) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            rows = await (await connection.execute(
                _MATCHING_RUN_TARGET_STATES + " ORDER BY id", (run_id,),
            )).fetchall()
        return {
            "runId": run_id, "statusUrl": f"/matching/runs/{run_id}",
            "pendingPairs": [
                {"method": row["method"], "candidateId": str(row["candidate_id"]), "jobId": str(row["job_id"]),
                 "evaluationId": row["evaluation_id"], "status": "running" if row["status"] == "running" else "queued"}
                for row in rows if row["disposition"] in {"pending", "running"}
            ],
            "availableResults": [
                {**row["result_payload"], "evaluationId": row["evaluation_id"],
                 "cacheStatus": "computed" if run_id in {str(row["owner_run_id"]), str(row["parent_run_id"])} else "hit"}
                for row in rows if row["disposition"] in {"computed", "cached", "shared"}
            ],
        }

    async def get_matching_run_progress(self, run_id: str) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            row = await (await connection.execute(
                f"""WITH states AS ({_MATCHING_RUN_TARGET_STATES})
                    SELECT r.target_count AS "targetCount",
                        COUNT(s.id) FILTER (WHERE disposition NOT IN ('pending', 'running')) AS "processedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'computed') AS "computedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'cached') AS "cachedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'shared') AS "sharedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'failed') AS "failedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'skipped') AS "skippedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'needs_review') AS "needsReviewCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'preparation_required') AS "preparationRequiredCount",
                        COUNT(s.id) FILTER (WHERE disposition IN ('pending', 'running')) AS "pendingCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'pending') AS "queuedCount",
                        COUNT(s.id) FILTER (WHERE disposition = 'running') AS "runningCount",
                        GREATEST(r.updated_at, MAX(s.updated_at)) AS "updatedAt"
                    FROM matching_runs r LEFT JOIN states s ON s.run_id = r.id WHERE r.id = %s GROUP BY r.id""",
                (run_id, run_id),
            )).fetchone()
        if row is None:
            raise ValueError("Matching-Lauf wurde nicht gefunden.")
        row["progressPercent"] = (
            None if row["targetCount"] is None else
            100.0 if row["targetCount"] == 0 else
            100.0 * row["processedCount"] / row["targetCount"]
        )
        return row

    async def attach_matching_run_pairs(
        self, run_id: str, plans: list[MatchingPairPlan], *, run_owner: str | None = None,
    ) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            locked = await (await connection.execute(
                """SELECT id FROM matching_runs WHERE id = %s AND error_code IS DISTINCT FROM 'source_deleted'
                   AND (%s::uuid IS NULL OR (lease_owner = %s AND lease_until > clock_timestamp()))
                   FOR NO KEY UPDATE""", (run_id, run_owner, run_owner),
            )).fetchone()
            if locked is None:
                raise MatchingLeaseLostError(f"Matching-Lauf {run_id} kann keine Paarziele mehr annehmen.")
            async with connection.cursor() as cursor:
                await cursor.executemany(
                    """INSERT INTO matching_run_pairs
                           (run_id, method, candidate_id, job_id, evaluation_id, disposition, error_code)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (run_id, method, candidate_id, job_id) DO UPDATE SET
                           evaluation_id = EXCLUDED.evaluation_id,
                           disposition = CASE
                               WHEN EXCLUDED.disposition = 'cached' AND EXISTS (
                                   SELECT 1 FROM matching_pair_evaluations e
                                   LEFT JOIN matching_runs owner ON owner.id = e.owner_run_id
                                   WHERE e.id = EXCLUDED.evaluation_id AND (
                                       e.owner_run_id = EXCLUDED.run_id OR owner.parent_run_id = EXCLUDED.run_id
                                   )
                               ) THEN 'computed'
                               WHEN matching_run_pairs.evaluation_id = EXCLUDED.evaluation_id
                                   AND matching_run_pairs.disposition IN ('computed', 'cached', 'shared')
                                   THEN matching_run_pairs.disposition
                               WHEN matching_run_pairs.evaluation_id = EXCLUDED.evaluation_id
                                   AND EXCLUDED.disposition = 'cached' THEN 'shared'
                               ELSE EXCLUDED.disposition END,
                           error_code = EXCLUDED.error_code, updated_at = clock_timestamp()""",
                    [
                        (
                            run_id, plan.snapshot.method, plan.snapshot.candidate_id, plan.snapshot.job_id,
                            plan.evaluation["id"],
                            "cached" if plan.evaluation["disposition"] == "cached" else (
                                plan.evaluation["disposition"]
                                if plan.evaluation["disposition"] in {"failed", "needs_review"} else (
                                    "failed" if plan.evaluation["disposition"] == "superseded" else "pending"
                                )
                            ),
                            plan.evaluation.get("error_code"),
                        )
                        for plan in plans
                    ],
                )
            await connection.execute(
                """UPDATE matching_runs SET
                       target_count = (SELECT COUNT(*) FROM matching_run_pairs WHERE run_id = %s),
                       stage = 'matching', error_code = NULL, updated_at = clock_timestamp()
                   WHERE id = %s AND stage NOT IN ('completed', 'completed_with_errors')""",
                (run_id, run_id),
            )

    async def prepare_matching_selection_targets(
        self, run_id: str, pairs: list[tuple[str, str]], *, run_owner: str, method: Literal["vector", "ai"],
    ) -> None:
        if method not in {"vector", "ai"}:
            raise ValueError("Unbekannte Matching-Methode.")
        targets = set()
        for job_ref, candidate_ref in pairs:
            try:
                job_ids = await self.matching_ids_for("jobs", [job_ref])
                candidate_ids = await self.matching_ids_for("candidates", [candidate_ref])
            except ValueError:
                logger.warning("Matching run %s contains an unresolved selection; handler will report it", run_id)
                continue
            targets.add((candidate_ids[candidate_ref], job_ids[job_ref]))
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            locked = await (await connection.execute(
                """SELECT id FROM matching_runs WHERE id = %s AND lease_owner = %s
                   AND lease_until > clock_timestamp() FOR NO KEY UPDATE""", (run_id, run_owner),
            )).fetchone()
            if locked is None:
                raise MatchingLeaseLostError(f"Matching-Lauf {run_id} hat seine Lease verloren.")
            async with connection.cursor() as cursor:
                await cursor.executemany(
                    """INSERT INTO matching_run_pairs (run_id, method, candidate_id, job_id)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (run_id, method, candidate_id, job_id) DO NOTHING""",
                    [(run_id, method, candidate_id, job_id) for candidate_id, job_id in sorted(targets)],
                )
            await connection.execute(
                """UPDATE matching_runs SET target_count = (
                       SELECT COUNT(*) FROM matching_run_pairs WHERE run_id = %s
                   ), stage = 'matching', updated_at = clock_timestamp() WHERE id = %s""", (run_id, run_id),
            )

    async def ensure_matching_child(
        self, parent_run_id: str, owner: str, child_key: str, request_payload: dict[str, Any],
    ) -> str:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            parent = await (await connection.execute(
                   "SELECT actor_user_id, retry_pair_ids FROM matching_runs WHERE id = %s", (parent_run_id,),
            )).fetchone()
            if parent is None or parent["actor_user_id"] is None:
                   raise MatchingActorUnavailableError("Matching actor no longer exists")
            actor = await (await connection.execute(
                   "SELECT id FROM users WHERE id = %s FOR KEY SHARE", (parent["actor_user_id"],),
            )).fetchone()
            if actor is None:
                   raise MatchingActorUnavailableError("Matching actor no longer exists")
            locked = await (await connection.execute(
                   """SELECT id FROM matching_runs WHERE id = %s AND lease_owner = %s
                      AND lease_until > clock_timestamp() AND request_kind = 'interactive_selection'
                      AND actor_user_id = %s FOR NO KEY UPDATE""",
                   (parent_run_id, owner, parent["actor_user_id"]),
            )).fetchone()
            if locked is None:
                   raise MatchingLeaseLostError(f"Matching-Sammellauf {parent_run_id} hat seine Lease verloren.")
            await connection.execute(
                   """INSERT INTO matching_runs (
                          actor_user_id, source, method, request_kind, parent_run_id, child_key,
                          request_payload, tariff_amount, tariff_action
                      ) VALUES (%s, '/match/vectormatch', 'vector', 'interactive', %s, %s, %s, -0.10, '3D_MATCH')
                      ON CONFLICT (parent_run_id, child_key) DO NOTHING""",
                   (parent["actor_user_id"], parent_run_id, child_key, Jsonb(normalize_matching_data(request_payload))),
            )
            row = await (await connection.execute(
                   "SELECT id::text FROM matching_runs WHERE parent_run_id = %s AND child_key = %s",
                   (parent_run_id, child_key),
            )).fetchone()
            assert row is not None
            if parent["retry_pair_ids"] is not None:
                await connection.execute(
                    """INSERT INTO matching_run_pairs
                       (run_id, method, candidate_id, job_id, evaluation_id, disposition, error_code)
                       SELECT %s, method, candidate_id, job_id, evaluation_id, disposition, error_code
                       FROM matching_run_pairs WHERE run_id = %s AND job_id::text = %s
                       ON CONFLICT (run_id, method, candidate_id, job_id) DO NOTHING""",
                    (row["id"], parent_run_id, child_key),
                )
                await connection.execute(
                    """UPDATE matching_runs SET retry_pair_ids = ARRAY(
                       SELECT cp.id FROM matching_run_pairs cp JOIN matching_run_pairs pp
                           ON cp.method = pp.method AND cp.candidate_id = pp.candidate_id AND cp.job_id = pp.job_id
                       WHERE cp.run_id = %s AND pp.run_id = %s AND pp.id = ANY(%s)
                       ) WHERE id = %s""",
                    (row["id"], parent_run_id, parent["retry_pair_ids"], row["id"]),
                )
            return row["id"]

    async def sync_matching_children(self, parent_run_id: str, owner: str) -> list[dict[str, Any]]:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            locked = await (await connection.execute(
                   """SELECT id FROM matching_runs WHERE id = %s AND lease_owner = %s
                      AND lease_until > clock_timestamp() FOR NO KEY UPDATE""", (parent_run_id, owner),
            )).fetchone()
            if locked is None:
                   raise MatchingLeaseLostError(f"Matching-Sammellauf {parent_run_id} hat seine Lease verloren.")
            await connection.execute(
                   """INSERT INTO matching_run_pairs
                          (run_id, method, candidate_id, job_id, evaluation_id, disposition, error_code)
                      SELECT %s, p.method, p.candidate_id, p.job_id, p.evaluation_id, p.disposition, p.error_code
                      FROM matching_run_pairs p JOIN matching_runs child ON child.id = p.run_id
                      WHERE child.parent_run_id = %s
                      ON CONFLICT (run_id, method, candidate_id, job_id) DO UPDATE SET
                          evaluation_id = EXCLUDED.evaluation_id, disposition = EXCLUDED.disposition,
                          error_code = EXCLUDED.error_code, updated_at = clock_timestamp()""",
                   (parent_run_id, parent_run_id),
            )
            return await (await connection.execute(
                   "SELECT * FROM matching_runs WHERE parent_run_id = %s ORDER BY child_key", (parent_run_id,),
            )).fetchall()

    async def release_unbilled_matching_claims(self, run_id: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                """UPDATE matching_pair_evaluations SET status = 'queued',
                       owner_run_id = NULL, lease_owner = NULL, lease_until = NULL, fence = fence + 1
                   WHERE owner_run_id = %s AND status IN ('queued', 'running') AND call_started_at IS NULL
                     AND NOT EXISTS (SELECT 1 FROM credit_transactions WHERE matching_run_id = %s)""",
                (run_id, run_id),
            )

    async def get_matching_actor(self, user_id: int) -> dict[str, Any] | None:
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            return await (await connection.execute(
                "SELECT id, username, email, display_name, role FROM users WHERE id = %s", (user_id,),
            )).fetchone()

    async def block_matching_run(self, run_id: str, error_code: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            result = await connection.execute(
                """UPDATE matching_runs SET stage = 'blocked_credits', error_code = %s, updated_at = clock_timestamp()
                   WHERE id = %s AND stage NOT IN ('completed', 'completed_with_errors')""",
                (error_code, run_id),
            )
            if result.rowcount == 0:
                logger.info("Matching run %s already terminal or removed while blocking: %s", run_id, error_code)

    async def record_matching_pairs(
        self,
        method: Literal["vector", "ai"],
        rows: list[dict[str, Any]],
        *,
        model: str,
        matched_at: datetime,
        engine: str | None = None,
    ) -> None:
        if method not in {"vector", "ai"}:
            raise ValueError(f"Unbekannte Matching-Methode {method}")
        candidate_ids = await self.matching_ids_for("candidates", [str(row["candidateId"]) for row in rows])
        job_ids = await self.matching_ids_for("jobs", [str(row["jobId"]) for row in rows])
        for row in rows:
            score = row["score"]
            if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 100:
                raise ValueError("Matching-Score muss zwischen 0 und 100 liegen.")
            if row.get("method", method) != method:
                raise ValueError("Matching-Methode und Paarergebnis widersprechen sich.")
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.executemany(
                    _MATCHING_PAIR_UPSERT + " WHERE matching_pair_results.matched_at <= EXCLUDED.matched_at",
                    [
                        (
                            method, candidate_ids[str(row["candidateId"])], job_ids[str(row["jobId"])],
                            row["score"],
                            row["hardSkillScore"] * 100 if row.get("hardSkillScore") is not None else None,
                            row["softSkillScore"] * 100 if row.get("softSkillScore") is not None else None,
                            row.get("summary"), json.dumps(row.get("strengths", []), ensure_ascii=False),
                            json.dumps(row.get("weaknesses", []), ensure_ascii=False),
                            model, engine if method == "vector" else None, matched_at,
                            row.get("qualified") if method == "vector" else None, None,
                        )
                        for row in rows
                    ],
                )

    async def get_cached_matching_evaluation(
        self, snapshot: MatchingInputSnapshot,
    ) -> dict[str, Any] | None:
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            return await (await connection.execute(
                """
                SELECT id, method, result_payload, model_snapshot, completed_at
                FROM matching_pair_evaluations
                WHERE method = %s AND candidate_id = %s AND job_id = %s
                  AND input_fingerprint = %s AND status = 'succeeded'
                  AND result_payload IS NOT NULL AND completed_at IS NOT NULL
                """,
                (snapshot.method, snapshot.candidate_id, snapshot.job_id, snapshot.fingerprint),
            )).fetchone()

    async def claim_matching_evaluation(
        self,
        snapshot: MatchingInputSnapshot,
        lease_owner: str,
        *,
        owner_run_id: str | None = None,
        lease_seconds: int = 60,
    ) -> dict[str, Any]:
        if not 1 <= lease_seconds <= 3600:
            raise ValueError("Matching-Lease muss zwischen 1 und 3600 Sekunden liegen.")
        await self.ensure_matching_pair_schema()
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            await connection.execute(
                """
                INSERT INTO matching_pair_evaluations
                    (method, candidate_id, job_id, input_fingerprint, model_snapshot, owner_run_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (method, candidate_id, job_id, input_fingerprint) DO NOTHING
                """,
                (snapshot.method, snapshot.candidate_id, snapshot.job_id, snapshot.fingerprint,
                 Jsonb(snapshot.model_snapshot), owner_run_id),
            )
            row = await (await connection.execute(
                """
                SELECT *, lease_until > clock_timestamp() AS lease_valid
                FROM matching_pair_evaluations
                WHERE method = %s AND candidate_id = %s AND job_id = %s AND input_fingerprint = %s
                FOR UPDATE
                """,
                (snapshot.method, snapshot.candidate_id, snapshot.job_id, snapshot.fingerprint),
            )).fetchone()
            if row is None:
                raise RuntimeError("Matching-Evaluation wurde waehrend der Claim-Planung entfernt.")
            if row["status"] == "succeeded":
                return {**row, "disposition": "cached"}
            reclaim_expired_unstarted = False
            if row["status"] == "running":
                if row["lease_valid"]:
                    return {**row, "disposition": "pending"}
                if row["call_started_at"] is not None:
                    uncertain = await (await connection.execute(
                        """
                        UPDATE matching_pair_evaluations SET status = 'needs_review',
                            error_code = 'uncertain_provider_result', fence = fence + 1,
                            lease_owner = NULL, lease_until = NULL
                        WHERE id = %s RETURNING *
                        """, (row["id"],),
                    )).fetchone()
                    assert uncertain is not None
                    return {**uncertain, "disposition": "needs_review"}
                reclaim_expired_unstarted = True
            elif row["status"] != "queued":
                return {**row, "disposition": row["status"]}
            if (
                not reclaim_expired_unstarted
                and row["owner_run_id"] is not None
                and str(row["owner_run_id"]) != owner_run_id
            ):
                return {**row, "disposition": "pending"}
            claimed = await (await connection.execute(
                """
                UPDATE matching_pair_evaluations SET status = 'running', lease_owner = %s,
                    lease_until = clock_timestamp() + %s * INTERVAL '1 second',
                    owner_run_id = CASE WHEN %s THEN %s ELSE COALESCE(owner_run_id, %s) END,
                    fence = fence + 1,
                    attempt = attempt + 1, call_started_at = NULL, error_code = NULL,
                    result_payload = NULL, completed_at = NULL
                WHERE id = %s RETURNING *
                """, (
                    lease_owner, lease_seconds, reclaim_expired_unstarted, owner_run_id,
                    owner_run_id, row["id"],
                ),
            )).fetchone()
            assert claimed is not None
            return {**claimed, "disposition": "owned"}

    async def heartbeat_matching_evaluation(
        self, evaluation_id: int, lease_owner: str, fence: int, *, lease_seconds: int = 60,
    ) -> None:
        if not 1 <= lease_seconds <= 3600:
            raise ValueError("Matching-Lease muss zwischen 1 und 3600 Sekunden liegen.")
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            row = await (await connection.execute(
                """
                UPDATE matching_pair_evaluations
                SET lease_until = clock_timestamp() + %s * INTERVAL '1 second'
                WHERE id = %s AND lease_owner = %s AND fence = %s AND status = 'running'
                  AND lease_until > clock_timestamp() RETURNING id
                """, (lease_seconds, evaluation_id, lease_owner, fence),
            )).fetchone()
            if row is None:
                raise MatchingLeaseLostError(f"Matching-Lease fuer Evaluation {evaluation_id} verloren.")

    async def mark_matching_model_started(self, evaluation_id: int, lease_owner: str, fence: int) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            row = await (await connection.execute(
                """
                UPDATE matching_pair_evaluations SET call_started_at = COALESCE(call_started_at, clock_timestamp())
                WHERE id = %s AND lease_owner = %s AND fence = %s AND status = 'running'
                  AND lease_until > clock_timestamp() RETURNING id
                """, (evaluation_id, lease_owner, fence),
            )).fetchone()
            if row is None:
                raise MatchingLeaseLostError(f"Matching-Lease fuer Evaluation {evaluation_id} verloren.")

    async def fail_matching_evaluation(self, evaluation_id: int, lease_owner: str, fence: int) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                """
                UPDATE matching_pair_evaluations
                SET status = CASE WHEN call_started_at IS NULL THEN 'failed' ELSE 'needs_review' END,
                    error_code = CASE WHEN call_started_at IS NULL
                        THEN 'evaluation_failed' ELSE 'uncertain_provider_result' END,
                    lease_owner = NULL, lease_until = NULL
                WHERE id = %s AND lease_owner = %s AND fence = %s AND status = 'running'
                """, (evaluation_id, lease_owner, fence),
            )

    async def get_matching_pair_content(
        self, candidate_id: int, job_id: int, *,
        connection: psycopg.AsyncConnection[Any] | None = None, lock: bool = False,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if connection is None:
            async with await psycopg.AsyncConnection.connect(self.database_url) as own_connection:
                return await self.get_matching_pair_content(candidate_id, job_id, connection=own_connection)
        async with connection.cursor(row_factory=dict_row) as cursor:
            await cursor.execute(
                """SELECT to_jsonb(c) AS candidate, to_jsonb(j) AS job
                   FROM candidates c CROSS JOIN jobs j WHERE c.id = %s AND j.id = %s"""
                + (" FOR SHARE OF c, j" if lock else ""),
                (candidate_id, job_id),
            )
            row = await cursor.fetchone()
            if row is None:
                raise ValueError("Matching-Paar wurde geloescht.")
            candidate, job = row["candidate"], row["job"]
            aliases = list(dict.fromkeys(str(value) for value in [
                candidate_id, candidate.get("uuid"), candidate.get("graph_candidate_id"),
                *(candidate.get("graph_candidate_ids") or []),
            ] if value is not None))
            await cursor.execute(
                """SELECT original_text, anonymized_text, profile_json FROM candidate_texts
                   WHERE candidate_id = ANY(%s) ORDER BY array_position(%s, candidate_id) LIMIT 1"""
                + (" FOR SHARE" if lock else ""), (aliases, aliases),
            )
            text = await cursor.fetchone()
        candidate_fields = (
            "name", "birth_date", "location", "experience", "skills", "education", "languages",
            "certificates", "drivers_license", "mobility", "availability", "desired_salary", "notes",
        )
        job_fields = (
            "title", "company", "location", "description", "requirements", "skills", "type",
            "about_us", "benefits", "raw_text", "parsed_profile_json",
        )
        candidate_content = {key: candidate.get(key) for key in candidate_fields}
        candidate_content["text"] = {
            "original_text": text["original_text"] or text["anonymized_text"] or "",
            "profile_json": json.loads(text["profile_json"]) if text["profile_json"] else None,
        } if text else None
        job_content = {key: job.get(key) for key in job_fields}
        profile = job_content["parsed_profile_json"]
        if isinstance(profile, str):
            job_content["parsed_profile_json"] = json.loads(profile) if profile.strip() else None
        return normalize_matching_data(candidate_content), normalize_matching_data(job_content)

    async def complete_matching_evaluation(
        self, snapshot: MatchingInputSnapshot, evaluation_id: int, lease_owner: str, fence: int,
        payload: dict[str, Any], *,
        refresh_snapshot: Callable[
            [psycopg.AsyncConnection[Any], dict[str, Any], dict[str, Any]], Awaitable[MatchingInputSnapshot]
        ],
        engine: str = "python",
    ) -> dict[str, Any]:
        score = payload.get("score")
        if (isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 100
                or payload.get("method") != snapshot.method
                or str(payload.get("candidateId")) != str(snapshot.candidate_id)
                or str(payload.get("jobId")) != str(snapshot.job_id)):
            raise ValueError("Vollresultat benoetigt gueltige Methode, Paar-IDs und Score.")
        matched_at = datetime.fromisoformat(payload["matchedAt"])
        if matched_at.tzinfo is None or not isinstance(payload.get("model"), str) or not payload["model"]:
            raise ValueError("Vollresultat benoetigt Modell und urspruenglichen Zeitpunkt mit Zeitzone.")
        original = json.loads(snapshot.canonical_json)
        async with await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row) as connection:
            await connection.execute(
                """SELECT c.id FROM candidates c CROSS JOIN jobs j WHERE c.id = %s AND j.id = %s
                   FOR SHARE OF c, j""", (snapshot.candidate_id, snapshot.job_id),
            )
            await connection.execute("LOCK TABLE settings, prompts, candidate_texts IN SHARE MODE")
            candidate, job = await self.get_matching_pair_content(
                snapshot.candidate_id, snapshot.job_id, connection=connection, lock=True,
            )
            current_snapshot = await refresh_snapshot(connection, candidate, job)
            stale = (
                current_snapshot.fingerprint != snapshot.fingerprint
                or candidate != original["candidate"] or job != original["job"]
            )
            row = await (await connection.execute(
                """
                UPDATE matching_pair_evaluations
                SET status = %s, result_payload = %s, completed_at = clock_timestamp(),
                    lease_owner = NULL, lease_until = NULL
                WHERE id = %s AND method = %s AND candidate_id = %s AND job_id = %s
                  AND input_fingerprint = %s AND lease_owner = %s AND fence = %s
                  AND status = 'running' AND lease_until > clock_timestamp()
                RETURNING id, status, result_payload, model_snapshot, completed_at
                """,
                ("superseded" if stale else "succeeded", Jsonb(payload), evaluation_id,
                 snapshot.method, snapshot.candidate_id, snapshot.job_id, snapshot.fingerprint, lease_owner, fence),
            )).fetchone()
            if row is None:
                raise MatchingLeaseLostError(f"Matching-Lease fuer Evaluation {evaluation_id} verloren.")
            if not stale:
                await connection.execute(_MATCHING_PAIR_UPSERT, (
                    snapshot.method, snapshot.candidate_id, snapshot.job_id, score,
                    payload["hardSkillScore"] * 100 if payload.get("hardSkillScore") is not None else None,
                    payload["softSkillScore"] * 100 if payload.get("softSkillScore") is not None else None,
                    payload.get("summary"), json.dumps(payload.get("strengths", []), ensure_ascii=False),
                    json.dumps(payload.get("weaknesses", []), ensure_ascii=False),
                    payload["model"], engine if snapshot.method == "vector" else None,
                    matched_at, payload.get("qualified") if snapshot.method == "vector" else None, evaluation_id,
                ))
            return row

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

    async def list_prompts(
        self, *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> list[dict[str, Any]]:
        if connection is None:
            async with await psycopg.AsyncConnection.connect(self.database_url) as own_connection:
                return await self.list_prompts(connection=own_connection)
        async with connection.cursor(row_factory=dict_row) as cursor:
            await cursor.execute(
                """SELECT id, key, template, description, model_parameters, version, created_at, updated_at
                   FROM prompts ORDER BY key ASC"""
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

    async def get_settings(
        self, keys: list[str], *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, str]:
        filtered_keys = [key for key in keys if isinstance(key, str) and key.strip()]
        if not filtered_keys:
            return {}

        if connection is None:
            async with await psycopg.AsyncConnection.connect(self.database_url) as own_connection:
                return await self.get_settings(keys, connection=own_connection)
        async with connection.cursor(row_factory=dict_row) as cursor:
            await cursor.execute("SELECT key, value FROM settings WHERE key = ANY(%s)", (filtered_keys,))
            rows = await cursor.fetchall()

        return {
            row["key"]: row["value"].strip() for row in rows
            if isinstance(row["key"], str) and isinstance(row["value"], str) and row["value"].strip()
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
                        graph_candidate_id TEXT,
                        graph_candidate_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
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
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills TEXT",
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
                await cursor.execute("ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graph_candidate_id TEXT")
                await cursor.execute(
                    "ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graph_candidate_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]"
                )
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
        await self.ensure_identity_schema()

    async def ensure_identity_schema(self) -> None:
        # Jede Anweisung einzeln: Ein Eindeutigkeitsindex scheitert, solange es
        # im Bestand noch Dubletten gibt - die Pruefung im Code greift trotzdem.
        async with await psycopg.AsyncConnection.connect(self.database_url, autocommit=True) as connection:
            for statement in _IDENTITY_SCHEMA:
                try:
                    await connection.execute(statement)
                except psycopg.Error as exc:
                    logger.warning("Identitaets-Schema: %s (%s)", exc, " ".join(statement.split())[:80])

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
        matching_run_id: str | None = None,
    ) -> dict[str, Any]:
        transaction_amount = self._to_decimal(amount)
        if transaction_amount == 0:
            raise ValueError('Credit transaction amount must not be zero')
        if matching_run_id is not None:
            await self.ensure_matching_pair_schema()

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
                    if matching_run_id is not None:
                        if row is None:
                            raise MatchingActorUnavailableError('Matching actor does not exist')
                        await cursor.execute(
                            "SELECT actor_user_id FROM matching_runs WHERE id = %s FOR UPDATE",
                            (matching_run_id,),
                        )
                        run = await cursor.fetchone()
                        if run is None or run["actor_user_id"] != int(user_id):
                            raise MatchingActorUnavailableError('Matching run has no matching persistent actor')
                        await cursor.execute(
                            """SELECT id, user_id, amount, action_type, note, metadata, balance_after,
                                      created_at, matching_run_id
                               FROM credit_transactions WHERE matching_run_id = %s""",
                            (matching_run_id,),
                        )
                        previous = await cursor.fetchone()
                        if previous is not None:
                            if previous["amount"] != transaction_amount or previous["action_type"] != action_type:
                                raise ValueError('Matching run already billed with different terms')
                            return {
                                **self._serialize_credit_row(dict(row)),
                                "transaction": self._serialize_credit_row(dict(previous)),
                            }
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
                        raise InsufficientCreditsError('Insufficient credits')

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

                    matching_column = ", matching_run_id" if matching_run_id is not None else ""
                    matching_value = ", %s" if matching_run_id is not None else ""
                    transaction_values: list[Any] = [
                        int(user_id), transaction_amount, action_type, note, Jsonb(metadata or {}), new_balance,
                    ]
                    if matching_run_id is not None:
                        transaction_values.append(matching_run_id)
                    await cursor.execute(
                        f"""
                        INSERT INTO credit_transactions (
                            user_id, amount, action_type, note, metadata, balance_after{matching_column}
                        ) VALUES (%s, %s, %s, %s, %s, %s{matching_value})
                        RETURNING id, user_id, amount, action_type, note, metadata, balance_after, created_at
                                  {matching_column}
                        """,
                        transaction_values,
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
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> None:
        async with self._connection(connection) as connection:
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

    async def get_candidate_text(
        self, candidate_id: str, *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any] | None:
        async with self._connection(connection) as connection:
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
        *,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> None:
        async with self._connection(connection) as connection:
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

    async def list_candidates_for_backfill(
        self, candidate_ids: list[int] | None = None, *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> list[dict[str, Any]]:
        async with self._connection(connection) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT
                        c.id::text AS candidate_id,
                        c.uuid::text AS uuid,
                        c.graph_candidate_id,
                        c.graph_candidate_ids,
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
                    WHERE (%(ids)s::bigint[] IS NULL OR c.id = ANY(%(ids)s::bigint[]))
                    ORDER BY c.id
                    """,
                    {"ids": candidate_ids},
                )
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def find_candidate_by_identity(
        self, name: str, birth_date: str | None, *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any] | None:
        # Ohne Geburtsdatum gibt es keine sichere Dublette (Namensvettern).
        if not name or not birth_date:
            return None
        async with self._connection(connection) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    f"""
                    SELECT id, uuid::text AS uuid, name, birth_date::text AS birth_date, email
                    FROM candidates
                    WHERE {_text_key('name')} = {_text_key('%s::text')} AND birth_date = %s::date
                    ORDER BY id LIMIT 1
                    """,
                    (name, birth_date),
                )
                row = await cursor.fetchone()
        return dict(row) if row else None

    async def delete_candidate_row(self, candidate_id: int) -> None:
        """Rueckbau, wenn nach dem Anlegen in PostgreSQL Neo4j scheitert."""
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute("DELETE FROM candidate_texts WHERE candidate_id = %s", (str(candidate_id),))
            await connection.execute("DELETE FROM candidates WHERE id = %s", (candidate_id,))

    async def insert_candidate(
        self, profile: CandidateProfileExtraction, source: str | None = None, *,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any]:
        """Legt den Bewerber an und liefert {"id", "uuid"}. Pflicht ist nur der
        Name; mit Geburtsdatum ergibt eine vorhandene Person (gleicher Name +
        gleiches Geburtsdatum) DuplicateCandidateError statt eines zweiten
        Datensatzes."""
        name, birth_date = require_identity(profile)
        existing = await self.find_candidate_by_identity(name, birth_date, connection=connection)
        if existing is not None:
            raise DuplicateCandidateError(existing)

        skills = ", ".join(item.name for item in profile.skills) or None
        languages = ", ".join(
            f"{item.name} ({item.level})" if item.level else item.name
            for item in profile.languages
        ) or None
        education = ", ".join(
            f"{item.level} {item.field_of_study}" for item in profile.educations
        ) or profile.education

        try:
            async with self._connection(connection) as active_connection:
                async with active_connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        """
                        INSERT INTO candidates (
                            name, email, phone, location, experience, skills, education,
                            desired_salary, availability, languages, certificates,
                            drivers_license, mobility, notes, status, tags, source, linkedin_url,
                            xing_url, github_url, portfolio_url, notice_period, nationality,
                            current_employer, current_position, gender, parsing_method, birth_date
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, 'Aktiv', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::date
                        ) RETURNING id, uuid::text AS uuid
                        """,
                        (
                            name,
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
                            birth_date,
                        ),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise RuntimeError("PostgreSQL did not return a candidate id")
                    candidate_id = int(row["id"])
                    candidate_uuid = str(row["uuid"])

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

        except pg_errors.UniqueViolation as exc:
            # Gleichzeitig angelegte Person: der Index uq_candidates_identity greift.
            existing = await self.find_candidate_by_identity(name, birth_date, connection=connection)
            if existing is None:
                raise
            raise DuplicateCandidateError(existing) from exc

        return {"id": candidate_id, "uuid": candidate_uuid}

    async def _find_existing_job(
        self, job_id: str | None, profile: JobProfileExtraction, source: str | None = None,
        url: str | None = None, *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any] | None:
        """Eine Stelle gibt es genau einmal: gleiche ID, gleiche URL oder gleicher
        Titel bei gleicher Firma und gleichem Ort (wie backend/src/identity.js)."""
        job_key = str(job_id or "").strip()
        if job_key:
            async with self._connection(connection) as active_connection:
                async with active_connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        """
                        SELECT id, uuid::text AS uuid, graph_job_id, title
                        FROM jobs
                        WHERE uuid::text = %s OR graph_job_id = %s OR id::text = %s
                        LIMIT 1
                        """,
                        (job_key, job_key, job_key),
                    )
                    row = await cursor.fetchone()
            if row:
                return dict(row)

        url_value = str(url or getattr(profile, "url", None) or "").strip()
        if url_value:
            async with self._connection(connection) as active_connection:
                async with active_connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        f"""
                        SELECT id, uuid::text AS uuid, graph_job_id, title FROM jobs
                        WHERE url IS NOT NULL AND btrim(url) <> '' AND {_url_key('url')} = {_url_key('%s::text')}
                        ORDER BY id LIMIT 1
                        """,
                        (url_value,),
                    )
                    row = await cursor.fetchone()
            if row:
                return dict(row)

        title = str(profile.title or "").strip()
        if not title:
            return None

        company = str(profile.company or profile.employer_company or profile.recruiter_company or "").strip()
        location = str(profile.location or "").strip()
        async with self._connection(connection) as active_connection:
            async with active_connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    f"""
                    SELECT id, uuid::text AS uuid, graph_job_id, title FROM jobs
                    WHERE {_text_key('title')} = {_text_key('%s::text')}
                      AND {_text_key('company')} = {_text_key('%s::text')}
                      AND {_text_key('location')} = {_text_key('%s::text')}
                    ORDER BY id LIMIT 1
                    """,
                    (title, company, location),
                )
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
                    WHERE uuid::text = %s OR graph_job_id = %s OR id::text = %s
                    ORDER BY id
                    LIMIT 1
                    """,
                    (job_id, job_id, job_id),
                )
                row = await cursor.fetchone()
        if row is None:
            return None
        parsed_profile_json = row.get("parsed_profile_json")
        return {
            **row,
            "parsed_profile_json": json.loads(parsed_profile_json) if isinstance(parsed_profile_json, str) and parsed_profile_json.strip() else None,
        }

    async def delete_job(
        self,
        job_id: str | None = None,
        *,
        title: str | None = None,
        description: str | None = None,
        requirements: str | None = None,
        about_us: str | None = None,
        benefits: str | None = None,
        location: str | None = None,
        job_type: str | None = None,
        url: str | None = None,
    ) -> int:
        if job_id:
            async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
                async with connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        """
                        DELETE FROM jobs
                        WHERE graph_job_id = %s OR id::text = %s
                        """,
                        (job_id, job_id),
                    )
                    return cursor.rowcount or 0

        conditions: list[str] = []
        params: list[Any] = []

        def add_condition(column: str, value: str | None) -> None:
            if value is None or not str(value).strip():
                return
            conditions.append(f"COALESCE(LOWER({column}), '') = LOWER(%s)")
            params.append(str(value).strip())

        add_condition("title", title)
        add_condition("description", description)
        add_condition("requirements", requirements)
        add_condition("about_us", about_us)
        add_condition("benefits", benefits)
        add_condition("location", location)
        add_condition("type", job_type)
        add_condition("url", url)

        if not conditions:
            return 0

        query = f"DELETE FROM jobs WHERE {' AND '.join(conditions)}"
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(query, params)
                return cursor.rowcount or 0

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
        birth_date: str | None = None,
    ) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    INSERT INTO candidates (name, email, phone, location, status, birth_date)
                    VALUES (%s, %s, %s, %s, %s, %s::date)
                    RETURNING id,
                              name,
                              email,
                              phone,
                              location,
                              status,
                              birth_date
                    """,
                    (name, email, phone, location, status, birth_date),
                )
                row = await cursor.fetchone()
        if row is None:
            raise RuntimeError("PostgreSQL did not return a candidate id")
        return dict(row)

    async def _upsert_job_once(
        self,
        job_id: str | None,
        raw_text: str,
        profile: JobProfileExtraction,
        source: str | None = None,
        source_hash: str | None = None,
        profile_hash: str | None = None,
        url: str | None = None,
        *,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any]:
        """Aktualisiert importierte Inhalte, ohne Identitaet, Status oder CRM-Zuordnungen zu ersetzen."""
        url_value = str(url or "").strip() or None
        existing = await self._find_existing_job(job_id, profile, source=source, url=url_value, connection=connection)
        skills = self._job_skills_text(profile)
        description = raw_text.strip() if raw_text and raw_text.strip() else self._render_plain_text(profile)
        requirements = self._summarize_requirements(profile)
        if existing is not None:
            updates = {
                "title": profile.title, "company": profile.company, "recruiter_company": profile.recruiter_company,
                "employer_company": profile.employer_company, "description": description,
                "requirements": requirements, "skills": skills or None, "location": profile.location,
                "type": profile.employment_type or "Vollzeit", "raw_text": raw_text,
                "parsed_profile_json": profile.model_dump(mode="json"),
            }
            if url_value:
                updates["url"] = url_value
            async with self._connection(connection) as active_connection:
                async with active_connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute("SELECT * FROM jobs WHERE id = %s FOR UPDATE", (int(existing["id"]),))
                    previous_values = await cursor.fetchone()
                if previous_values is None:
                    raise ValueError("Die zu aktualisierende Stelle wurde geloescht.")
                old_profile = previous_values.get("parsed_profile_json")
                previous_values["parsed_profile_json"] = json.loads(old_profile) if isinstance(old_profile, str) and old_profile else old_profile
                changed = any(normalize_matching_data(previous_values.get(key)) != normalize_matching_data(value)
                              for key, value in updates.items())
                if changed:
                    if source is not None:
                        updates["source"] = source
                    await active_connection.execute(
                        f"UPDATE jobs SET {', '.join(f'{key} = %s' for key in updates)}, updated_at = clock_timestamp() WHERE id = %s",
                        tuple(json.dumps(value, ensure_ascii=False) if key == "parsed_profile_json" else value
                              for key, value in updates.items()) + (int(existing["id"]),),
                    )
            return {"id": int(existing["id"]), "uuid": str(existing["uuid"]), "duplicate": True, "changed": changed}
        # Die UUID der Stelle ist zugleich die ID des Neo4j-Knotens.
        new_uuid = str(uuid4())
        try:
            async with self._connection(connection) as active_connection:
                async with active_connection.cursor(row_factory=dict_row) as cursor:
                    await cursor.execute(
                        """
                        INSERT INTO jobs (
                            uuid, graph_job_id, title, company, recruiter_company, employer_company, description,
                            requirements, skills, about_us, benefits, location, type, status, url, raw_text, source,
                            parsed_profile_json
                        ) VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, %s, %s, NULL, NULL, %s, %s, 'Offen', %s, %s, %s, %s)
                        RETURNING id, uuid::text AS uuid
                        """,
                        (
                            new_uuid,
                            new_uuid,
                            profile.title,
                            profile.company,
                            profile.recruiter_company,
                            profile.employer_company,
                            description,
                            requirements,
                            skills or None,
                            profile.location,
                            profile.employment_type or "Vollzeit",
                            url_value,
                            raw_text,
                            source,
                            json.dumps(profile.model_dump(), ensure_ascii=False),
                        ),
                    )
                    row = await cursor.fetchone()
        except pg_errors.UniqueViolation:
            # Gleichzeitig angelegte Stelle: die Eindeutigkeitsindizes greifen.
            existing = await self._find_existing_job(None, profile, source=source, url=url_value, connection=connection)
            if existing is None:
                raise
            return await self._upsert_job_once(
                str(existing["id"]), raw_text, profile, source, source_hash, profile_hash, url,
                connection=connection,
            )
        if row is None:
            raise RuntimeError("PostgreSQL did not return a job id")
        return {"id": int(row["id"]), "uuid": str(row["uuid"]), "duplicate": False, "changed": True}

    async def graph_ids_for(self, table: str, ids: list[str]) -> dict[str, str]:
        """PostgreSQL-ID (als Text) -> UUID, die auch der Neo4j-Knoten traegt."""
        if table not in {"candidates", "jobs"}:
            raise ValueError(f"Unbekannte Tabelle {table}")
        numeric = sorted({int(value) for value in ids if str(value).strip().isdigit()})
        if not numeric:
            return {}
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(f"SELECT id, uuid::text FROM {table} WHERE id = ANY(%s::bigint[])", (numeric,))
                return {str(row[0]): str(row[1]) for row in await cursor.fetchall()}

    async def list_jobs_for_sync(
        self, job_ids: list[int], *, connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> list[dict[str, Any]]:
        async with self._connection(connection) as connection:
            async with connection.cursor(row_factory=dict_row) as cursor:
                await cursor.execute(
                    """
                    SELECT id, uuid::text AS uuid, graph_job_id, title, company, recruiter_company, employer_company,
                           location, type, description, requirements, about_us, benefits, skills, raw_text, parsed_profile_json
                    FROM jobs WHERE id = ANY(%s::bigint[]) ORDER BY id
                    """,
                    (list(job_ids),),
                )
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    async def graph_job_id_in_use(self, graph_id: str, *, exclude_job_id: int) -> bool:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    "SELECT 1 FROM jobs WHERE id <> %s AND (uuid::text = %s OR graph_job_id = %s) LIMIT 1",
                    (exclude_job_id, graph_id, graph_id),
                )
                return await cursor.fetchone() is not None

    async def reset_job_graph_id(self, job_id: int, graph_id: str) -> None:
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute("UPDATE jobs SET graph_job_id = %s WHERE id = %s", (graph_id, job_id))

    async def graph_candidate_id_in_use(self, graph_id: str, *, exclude_candidate_id: int) -> bool:
        """Gehoert die Neo4j-ID noch zu einem anderen Bewerber?"""
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    SELECT 1 FROM candidates
                    WHERE id <> %s AND (uuid::text = %s OR graph_candidate_id = %s OR %s = ANY(COALESCE(graph_candidate_ids, ARRAY[]::TEXT[])))
                    LIMIT 1
                    """,
                    (exclude_candidate_id, graph_id, graph_id, graph_id),
                )
                return await cursor.fetchone() is not None

    async def reset_candidate_graph_ids(self, candidate_id: int, graph_id: str) -> None:
        """Nach dem Abgleich gibt es genau einen Neo4j-Knoten: den mit der UUID."""
        async with await psycopg.AsyncConnection.connect(self.database_url) as connection:
            await connection.execute(
                "UPDATE candidates SET graph_candidate_id = %s, graph_candidate_ids = ARRAY[%s]::TEXT[] WHERE id = %s",
                (graph_id, graph_id, candidate_id),
            )

    async def set_candidate_graph_id(
        self, candidate_id: int, graph_candidate_id: str, *,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> None:
        async with self._connection(connection) as connection:
            await connection.execute(
                """
                UPDATE candidates
                SET graph_candidate_id = %s,
                    graph_candidate_ids = CASE
                        WHEN %s = ANY(COALESCE(graph_candidate_ids, ARRAY[]::TEXT[]))
                        THEN COALESCE(graph_candidate_ids, ARRAY[]::TEXT[])
                        ELSE array_append(COALESCE(graph_candidate_ids, ARRAY[]::TEXT[]), %s)
                    END
                WHERE id = %s
                """,
                (graph_candidate_id, graph_candidate_id, graph_candidate_id, candidate_id),
            )

    async def upsert_job(
        self,
        job_id: str | None,
        raw_text: str,
        profile: JobProfileExtraction,
        source: str | None = None,
        source_hash: str | None = None,
        profile_hash: str | None = None,
        url: str | None = None,
        *,
        connection: psycopg.AsyncConnection[Any] | None = None,
    ) -> dict[str, Any]:
        try:
            async with self._connection(connection) as active_connection:
                return await self._upsert_job_once(
                    job_id=job_id, raw_text=raw_text, profile=profile, source=source,
                    source_hash=source_hash, profile_hash=profile_hash, url=url, connection=active_connection,
                )
        except pg_errors.UndefinedColumn as exc:
            if connection is not None:
                raise
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
                url=url,
                connection=connection,
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
    def _job_skills_text(profile: JobProfileExtraction) -> str:
        names: list[str] = []
        seen: set[str] = set()
        for item in profile.required_skills:
            name = item.name.strip()
            key = name.casefold()
            if name and key not in seen:
                seen.add(key)
                names.append(name)
        return ", ".join(names)

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
