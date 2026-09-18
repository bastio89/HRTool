const express = require('express');
const db = require('../database');

const router = express.Router();

const JOB_SEARCH_FIELDS = [
  'j.title',
  'j.description',
  'j.requirements',
  'j.about_us',
  'j.benefits',
  'j.skills',
  'j.location',
  'j.type',
  'j.status',
  'j.url',
];

const CANDIDATE_BASE_FIELDS = [
  'c.name',
  'c.email',
  'c.phone',
  'c.location',
  'c.experience',
  'c.skills',
  'c.education',
  'c.desired_salary',
  'c.availability',
  'c.languages',
  'c.certificates',
  'c.drivers_license',
  'c.mobility',
  'c.notes',
  'c.status',
  'c.tags',
  'c.source',
  'c.linkedin_url',
  'c.xing_url',
  'c.github_url',
  'c.portfolio_url',
  'c.current_employer',
  'c.current_position',
  'c.gender',
];

const CANDIDATE_TEXT_FIELDS = [
  'ct.candidate_name',
  'ct.original_text',
  'ct.anonymized_text',
  'ct.profile_json::text',
];

function splitSearchTerms(search) {
  return String(search)
    .toLowerCase()
    .split(/[\s,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function buildSearchClause(fields, terms) {
  const conditions = [];
  const params = [];

  for (const term of terms) {
    conditions.push(`(${fields.map((field) => `LOWER(COALESCE(${field}, '')) LIKE ?`).join(' OR ')})`);
    params.push(...fields.map(() => `%${term}%`));
  }

  return { where: conditions.join(' AND '), params };
}

function selectLimit(value, fallback = 10, max = 25) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function hasCandidateTextsTable() {
  try {
    const row = db.prepare("SELECT to_regclass('public.candidate_texts') AS exists").get();
    return Boolean(row?.exists);
  } catch {
    return false;
  }
}

function normalizeRows(rows, type) {
  return rows.map((row) => ({ ...row, type }));
}

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Globale Jobs- und Bewerbersuche
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Freitextsuche über Jobs und CVs
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 25 }
 *         description: Maximaler Treffer pro Gruppe
 *     responses:
 *       200: { description: Treffer für Jobs und Bewerber }
 */
router.get('/', (req, res) => {
  try {
    const query = String(req.query.q || req.query.search || '').trim();
    if (!query) {
      return res.json({ query: '', jobs: [], candidates: [], totalJobs: 0, totalCandidates: 0 });
    }

    const terms = splitSearchTerms(query);
    if (terms.length === 0) {
      return res.json({ query, jobs: [], candidates: [], totalJobs: 0, totalCandidates: 0 });
    }

    const limit = selectLimit(req.query.limit, 10, 25);
    const candidateTextsAvailable = hasCandidateTextsTable();
    const candidateTextJoin = candidateTextsAvailable
      ? ' LEFT JOIN candidate_texts ct ON ct.candidate_id = CAST(c.id AS TEXT)'
      : '';
    const candidateSearchFields = candidateTextsAvailable
      ? [...CANDIDATE_BASE_FIELDS, ...CANDIDATE_TEXT_FIELDS]
      : CANDIDATE_BASE_FIELDS;

    const jobClause = buildSearchClause(JOB_SEARCH_FIELDS, terms);
    const candidateClause = buildSearchClause(candidateSearchFields, terms);

    const jobWhere = ` WHERE ${jobClause.where}`;
    const candidateWhere = ` WHERE ${candidateClause.where}`;

    const jobs = db.prepare(`
      SELECT j.id, j.title, j.location, j.status, j.type, j.skills, j.company, j.description, j.requirements, j.about_us, j.benefits, j.url, j.updated_at
      FROM jobs j
      ${jobWhere}
      ORDER BY j.updated_at DESC, j.id DESC
      LIMIT ?
    `).all(...jobClause.params, limit);

    const candidates = db.prepare(`
      SELECT c.id, c.name, c.location, c.status, c.tags, c.skills, c.experience, c.current_employer, c.current_position, c.updated_at,
            ${candidateTextsAvailable ? "COALESCE(ct.original_text, ct.anonymized_text, '') AS full_text" : "'' AS full_text"}
      FROM candidates c
      ${candidateTextJoin}
      ${candidateWhere}
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ?
    `).all(...candidateClause.params, limit);

    const totalJobs = db.prepare(`SELECT COUNT(*) as count FROM jobs j ${jobWhere}`).get(...jobClause.params).count;
    const totalCandidates = db.prepare(`SELECT COUNT(*) as count FROM candidates c${candidateTextJoin} ${candidateWhere}`).get(...candidateClause.params).count;

    res.json({
      query,
      jobs: normalizeRows(jobs, 'job'),
      candidates: normalizeRows(candidates, 'candidate'),
      totalJobs,
      totalCandidates,
    });
  } catch (error) {
    console.error('Error performing global search:', error);
    res.status(500).json({ error: 'Fehler bei der Suche' });
  }
});

module.exports = router;