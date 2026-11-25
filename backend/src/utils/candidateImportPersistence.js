const db = require('../database');

function normalizeHistoryEntries(value, kind) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (kind === 'work') return Boolean(item.employer || item.position);
    return Boolean(item.institution || item.degree || item.field_of_study);
  });
}

function normalizeWorkHistory(profile) {
  const entries = normalizeHistoryEntries(profile.work_history, 'work');
  const hasCurrentRole = entries.some((item) => {
    const employer = String(item.employer || '').trim().toLowerCase();
    const position = String(item.position || '').trim().toLowerCase();
    return employer === String(profile.current_employer || '').trim().toLowerCase()
      && position === String(profile.current_position || '').trim().toLowerCase();
  });
  if (!hasCurrentRole && (profile.current_employer || profile.current_position)) {
    entries.unshift({
      employer: profile.current_employer || null, position: profile.current_position || null,
      from_date: null, to_date: null, is_current: true,
      description: profile.experience || null, location: profile.location || null,
    });
  }
  return entries;
}

async function writeCandidateHistory(candidateId, profile, { replace = false, database = db } = {}) {
  const workHistory = normalizeWorkHistory(profile).filter(item => Boolean(item.employer && item.position));
  const educationHistory = normalizeHistoryEntries(profile.education_history, 'education').filter(item => Boolean(item.institution));
  const currentRole = profile.current_employer && profile.current_position
    ? {
      employer: profile.current_employer, position: profile.current_position,
      from_date: null, to_date: null, is_current: true,
      description: profile.experience || null, location: profile.location || null,
    } : null;
  if (currentRole && !workHistory.some(item => item.is_current && item.employer === currentRole.employer && item.position === currentRole.position)) {
    workHistory.unshift(currentRole);
  }
  await database.transactionAsync(async (tx) => {
    const workInsert = tx.prepare(`
      INSERT INTO candidate_work_history (candidate_id, employer, position, from_date, to_date, is_current, description, location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const educationInsert = tx.prepare(`
      INSERT INTO candidate_education (candidate_id, institution, degree, field_of_study, from_date, to_date, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    if (replace) {
      await tx.prepare('DELETE FROM candidate_work_history WHERE candidate_id = ?').run(candidateId);
      await tx.prepare('DELETE FROM candidate_education WHERE candidate_id = ?').run(candidateId);
    }
    for (const item of workHistory) {
      await workInsert.run(
        candidateId, item.employer || null, item.position || null, item.from_date || null, item.to_date || null,
        item.is_current ? 1 : 0, item.description || null, item.location || null,
      );
    }
    for (const item of educationHistory) {
      await educationInsert.run(
        candidateId, item.institution || null, item.degree || null, item.field_of_study || null,
        item.from_date || null, item.to_date || null, item.description || null,
      );
    }
  });
}

async function writeCandidateText(candidateId, name, cvText, profile, source = 'CV-Import', database = db) {
  const { birth_date: _birthDate, ...matchingProfile } = profile;
  await database.prepare(`
    INSERT INTO candidate_texts (candidate_id, candidate_name, source, original_text, profile_json)
    VALUES (CAST(? AS TEXT), ?, ?, ?, ?)
    ON CONFLICT (candidate_id) DO UPDATE SET
      anonymized_text = CASE WHEN candidate_texts.candidate_name IS DISTINCT FROM EXCLUDED.candidate_name
        OR candidate_texts.original_text IS DISTINCT FROM EXCLUDED.original_text
        OR candidate_texts.profile_json IS DISTINCT FROM EXCLUDED.profile_json
        THEN NULL ELSE candidate_texts.anonymized_text END,
      anonymization_map = CASE WHEN candidate_texts.candidate_name IS DISTINCT FROM EXCLUDED.candidate_name
        OR candidate_texts.original_text IS DISTINCT FROM EXCLUDED.original_text
        OR candidate_texts.profile_json IS DISTINCT FROM EXCLUDED.profile_json
        THEN NULL ELSE candidate_texts.anonymization_map END,
      candidate_name = EXCLUDED.candidate_name, source = EXCLUDED.source,
      original_text = EXCLUDED.original_text, profile_json = EXCLUDED.profile_json,
      updated_at = CURRENT_TIMESTAMP
    RETURNING candidate_id
  `).run(
    candidateId, name, source,
    String(cvText || '').trim() || JSON.stringify(matchingProfile, null, 2),
    JSON.stringify(matchingProfile),
  );
}

module.exports = { normalizeHistoryEntries, normalizeWorkHistory, writeCandidateHistory, writeCandidateText };
