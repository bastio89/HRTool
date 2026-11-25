function ensureMatchingImportSchema(db) {
  db.transaction(() => {
    db.prepare('SELECT pg_advisory_xact_lock(6845271901)').get();
    db.exec(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parsed_profile_json TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recruiter_company TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employer_company TEXT
    `);
    db.exec(`
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
    `);
  })();
}

// Uses the caller's import transaction; never enqueue after the source commit.
async function enqueueMatchingImport(db, { entityType, entityId, req, source, eventKey }) {
  if (!['candidate', 'job'].includes(entityType) || !Number.isSafeInteger(entityId) || entityId <= 0) {
    throw new Error('Ungueltige Matching-Importquelle');
  }
  const rawActor = req?.user?.id;
  const requestedActor = ['number', 'string'].includes(typeof rawActor) ? Number(rawActor) : NaN;
  const actor = Number.isSafeInteger(requestedActor) && requestedActor > 0
    ? await db.prepare('SELECT id FROM users WHERE id = ? FOR KEY SHARE').get(requestedActor)
    : null;
  const actorId = actor?.id || null;
  const stage = actorId ? 'queued' : 'blocked_credits';
  if (!actorId) console.warn('Matching-Importauftrag blockiert: missing_actor', entityType, entityId);
  const key = eventKey || `${entityType}:${entityId}:created`;
  await db.prepare(`
    INSERT INTO matching_runs (import_event_key, source, entity_type, entity_id, actor_user_id, stage, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (import_event_key) DO NOTHING
  `).run(key, source, entityType, entityId, actorId, stage, actorId ? null : 'missing_actor');
  const run = await db.prepare(`
    SELECT id, entity_type, entity_id, actor_user_id, source, stage
    FROM matching_runs WHERE import_event_key = ? FOR UPDATE
  `).get(key);
  if (!run || run.entity_type !== entityType || Number(run.entity_id) !== entityId
    || (run.actor_user_id === null ? null : Number(run.actor_user_id)) !== actorId || run.source !== source) {
    throw new Error('Matching-Importereignis hat einen abweichenden Kontext');
  }
  return {
    matchingRunId: run.id,
    matchingStatus: run.stage,
    matchingStatusUrl: `/api/matching/runs/${run.id}`,
    preparationStatus: 'required',
  };
}

module.exports = { ensureMatchingImportSchema, enqueueMatchingImport };
