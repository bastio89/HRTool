/**
 * N:N-Export der Matching-Ergebnisse (KI- und 3D-Matching): Speicherung je
 * Paarung, Zuordnung der GraphRAG-IDs auf PostgreSQL-IDs, Schwellwert
 * "Matchingwert groesser X %", CSV-Abzug und Uebernahme der Historie.
 * Laeuft gegen die echte Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');

const db = require('../database');
const exportsRouter = require('../routes/exports');
const matchingRouter = require('../routes/matching');
const {
  backfillMatchingPairs,
  classifyStoredRun,
  recordMatchingPairs,
  toPercent,
} = require('../matchingPairs');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/exports', exportsRouter);
  app.use('/api/matching', matchingRouter);
  return app;
}

const admin = { id: 1, username: 'admin', display_name: 'Export Admin', role: 'admin' };
const marker = `mx-${Date.now()}`;
const graphUuid = `0f6c2b1e-${Date.now().toString(16).padStart(4, '0').slice(-4)}-4a1b-9c2d-${marker.slice(-12).padStart(12, '0')}`;

let carla;
let dario;
let emil;
let backend;
let backendUuid;
let data;
const historyIds = [];

function insertCandidate(name) {
  return db.prepare('INSERT INTO candidates (name, email, status, tags) VALUES (?, ?, ?, ?)')
    .run(name, `${name.split(' ')[0].toLowerCase()}.${marker}@example.com`, 'Aktiv', marker).lastInsertRowid;
}

function pairs(method) {
  return db.prepare(
    'SELECT * FROM matching_pair_results WHERE method = ? AND candidate_id IN (?, ?, ?) ORDER BY candidate_id, job_id'
  ).all(method, carla, dario, emil);
}

function exportCsv(entity, filters = {}, fields) {
  return request(buildApp(admin)).post('/api/exports/run').send({
    entity,
    format: 'csv',
    format_options: { delimiter: 'semicolon', bom: false },
    fields,
    filters: { candidate_ids: [carla, dario, emil], ...filters },
  });
}

beforeAll(() => {
  // Vorhandene Altlaeufe der Testdatenbank nicht in diese Tests ziehen.
  backfillMatchingPairs(db);
  carla = insertCandidate(`Carla Code ${marker}`);
  dario = insertCandidate(`Dario Data ${marker}`);
  emil = insertCandidate(`Emil Engel ${marker}`);
  backend = db.prepare('INSERT INTO jobs (title, location, status) VALUES (?, ?, ?)')
    .run(`Backend Engineer ${marker}`, 'Zuerich', 'Offen').lastInsertRowid;
  // Neo4j-Knoten und PostgreSQL teilen sich die UUID der Stelle.
  data = db.prepare('INSERT INTO jobs (title, uuid, graph_job_id, location, status) VALUES (?, ?, ?, ?, ?)')
    .run(`Data Scientist ${marker}`, graphUuid, graphUuid, 'Bern', 'Offen').lastInsertRowid;
  backendUuid = db.prepare('SELECT uuid FROM jobs WHERE id = ?').get(backend).uuid;
});

afterAll(() => {
  db.prepare('DELETE FROM candidates WHERE id IN (?, ?, ?)').run(carla, dario, emil);
  db.prepare('DELETE FROM jobs WHERE id IN (?, ?)').run(backend, data);
  for (const id of historyIds) db.prepare('DELETE FROM matching_results WHERE id = ?').run(id);
});

describe('score normalisation', () => {
  test('keeps percentages and converts fractions', () => {
    expect(toPercent(73)).toBe(73);
    expect(toPercent('42')).toBe(42);
    expect(toPercent(0.815)).toBe(81.5);
    expect(toPercent(140)).toBe(100);
    expect(toPercent('abc')).toBeNull();
  });
});

describe('recording matching pairs', () => {
  test('stores a 3D N:N run and resolves Neo4j job UUIDs and names', () => {
    const result = recordMatchingPairs(db, 'vector', [
      { candidateId: String(carla), jobId: String(backend), score: 82, hardSkillScore: 0.9, softSkillScore: 0.4, summary: 'passt' },
      { candidateId: String(carla), jobId: graphUuid, score: 50, strengths: ['Python ↔ Python'] },
      // Neo4j-Kandidaten-UUID ohne Gegenstueck in PostgreSQL: Zuordnung ueber den eindeutigen Namen.
      { candidateId: 'a5d1c9e4-neo4j-only', candidateName: `Dario Data ${marker}`, jobId: String(backend), score: 50.4 },
      { candidateId: String(dario), jobId: graphUuid, score: 12 },
      // Nicht zuordenbar: wird verworfen, nicht geraten.
      { candidateId: 'unknown', candidateName: 'Niemand', jobId: String(backend), score: 99 },
    ], { engine: 'python', model: 'graph-rag-vector-matrix', allowNameLookup: true });

    expect(result).toEqual({ stored: 4, skipped: 1 });
    const rows = pairs('vector');
    expect(rows).toHaveLength(4);
    const carlaBackend = rows.find(row => row.candidate_id === carla && row.job_id === backend);
    expect(carlaBackend).toMatchObject({ score: 82, hard_skill_score: 90, soft_skill_score: 40, engine: 'python', summary: 'passt' });
    expect(rows.find(row => row.candidate_id === carla && row.job_id === data).score).toBe(50);
    expect(rows.find(row => row.candidate_id === dario && row.job_id === backend).score).toBe(50.4);
  });

  test('keeps only the latest result per pair and ignores older history', () => {
    recordMatchingPairs(db, 'vector', [{ candidateId: carla, jobId: backend, score: 64 }], { engine: 'neo4j' });
    expect(pairs('vector').find(row => row.candidate_id === carla && row.job_id === backend)).toMatchObject({ score: 64, engine: 'neo4j' });

    recordMatchingPairs(db, 'vector', [{ candidateId: carla, jobId: backend, score: 5 }], { matchedAt: '2020-01-01T00:00:00Z' });
    expect(pairs('vector').find(row => row.candidate_id === carla && row.job_id === backend).score).toBe(64);
    expect(pairs('vector')).toHaveLength(4);
  });

  test('resolves Neo4j candidate UUIDs via graph_candidate_id(s) and skips ambiguous ones', async () => {
    const frida = insertCandidate(`Frida Fuchs ${marker}`);
    const gustav = insertCandidate(`Gustav Graf ${marker}`);
    try {
      // Frida hat in Neo4j zwei Knoten (Dublette); "shared" haengt an zwei Bewerbern.
      db.prepare('UPDATE candidates SET graph_candidate_id = ?, graph_candidate_ids = ARRAY[?, ?, ?]::TEXT[] WHERE id = ?')
        .run(`${marker}-frida-new`, `${marker}-frida-old`, `${marker}-frida-new`, `${marker}-shared`, frida);
      db.prepare('UPDATE candidates SET graph_candidate_ids = ARRAY[?]::TEXT[] WHERE id = ?').run(`${marker}-shared`, gustav);

      const result = recordMatchingPairs(db, 'vector', [
        { candidateId: `${marker}-frida-old`, candidateName: 'egal', jobId: String(backend), score: 61 },
        { candidateId: `${marker}-shared`, jobId: String(backend), score: 70 },
      ], { engine: 'neo4j' });
      expect(result).toEqual({ stored: 1, skipped: 1 });

      const res = await request(buildApp(admin)).post('/api/exports/run').send({
        entity: 'matching_vector',
        format: 'csv',
        format_options: { delimiter: 'semicolon', bom: false },
        fields: ['candidate_id', 'candidate_uuid', 'job_id', 'score'],
        filters: { candidate_ids: [frida, gustav] },
      });
      const fridaUuid = db.prepare('SELECT uuid FROM candidates WHERE id = ?').get(frida).uuid;
      expect(res.text.split('\r\n')).toEqual([
        'candidate_id;candidate_uuid;job_id;score',
        `${frida};${fridaUuid};${backend};61`,
      ]);
    } finally {
      db.prepare('DELETE FROM candidates WHERE id IN (?, ?)').run(frida, gustav);
    }
  });

  test('restricts a run to its participants and keeps KI and 3D apart', () => {
    const result = recordMatchingPairs(db, 'ai', [
      { candidateId: carla, score: 91, summary: 'Sehr gute Passung', strengths: ['Java', 'SQL'], weaknesses: ['Englisch'] },
      { candidateId: dario, score: 70 },
      // Vom LLM erfundene ID, die nicht Teil des Laufs war.
      { candidateId: emil, score: 99 },
    ], { jobId: backend, candidateIds: [carla, dario], model: 'llama3' });

    expect(result).toEqual({ stored: 2, skipped: 1 });
    const rows = pairs('ai');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ candidate_id: carla, job_id: backend, score: 91, model: 'llama3' });
    expect(JSON.parse(rows[0].strengths)).toEqual(['Java', 'SQL']);
    expect(pairs('vector')).toHaveLength(4);
  });
});

describe('N:N export', () => {
  test('lists both matching entities with the threshold filter', async () => {
    const res = await request(buildApp(admin)).get('/api/exports/schema');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.entities.map(entity => [entity.key, entity]));
    expect(byKey.matching_ai.defaultFormat).toBe('csv');
    expect(byKey.matching_vector.fields.map(f => f.key)).toEqual(expect.arrayContaining(['candidate_id', 'candidate_uuid', 'job_id', 'job_uuid', 'score', 'hard_skill_score']));
    expect(byKey.matching_ai.fields.map(f => f.key)).not.toContain('hard_skill_score');
    expect(byKey.matching_vector.filters.find(f => f.key === 'score_above')).toMatchObject({ type: 'number', primary: true });
  });

  test('exports only pairs with a score strictly greater than the threshold', async () => {
    const res = await exportCsv('matching_vector', { score_above: 50 }, ['candidate_id', 'job_id', 'job_uuid', 'job_title', 'score', 'hard_skill_score']);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/matching_vector-export_\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.headers['x-export-count']).toBe('2');
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('candidate_id;job_id;job_uuid;job_title;score;hard_skill_score');
    // Sortiert nach Matchingwert; 50 ist nicht "groesser als 50".
    expect(lines.slice(1)).toEqual([
      `${carla};${backend};${backendUuid};Backend Engineer ${marker};64;`,
      `${dario};${backend};${backendUuid};Backend Engineer ${marker};50.4;`,
    ]);
  });

  test('without threshold exports the full N:N list including the job UUID', async () => {
    const res = await exportCsv('matching_vector', {}, ['candidate_id', 'job_id', 'job_uuid', 'score']);
    expect(res.status).toBe(200);
    expect(res.headers['x-export-count']).toBe('4');
    expect(res.text).toContain(`${carla};${data};${graphUuid};50`);
  });

  test('exports KI results with strengths and weaknesses', async () => {
    const res = await exportCsv('matching_ai', { score_above: 75 }, ['candidate_name', 'job_title', 'score', 'strengths', 'weaknesses']);
    expect(res.status).toBe(200);
    expect(res.text.split('\r\n')).toEqual([
      'candidate_name;job_title;score;strengths;weaknesses',
      `Carla Code ${marker};Backend Engineer ${marker};91;"Java; SQL";Englisch`,
    ]);
  });

  test('rejects an invalid threshold', async () => {
    for (const value of [-1, 101, 'viel']) {
      const res = await exportCsv('matching_ai', { score_above: value });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/zwischen 0 und 100/);
    }
  });

  test('filters by job and logs the export', async () => {
    const res = await exportCsv('matching_vector', { job_ids: [data] }, ['candidate_id', 'job_id']);
    expect(res.headers['x-export-count']).toBe('2');
    const audit = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'Export' AND entity_label = ? ORDER BY id DESC LIMIT 1")
      .get('Ad-hoc-Export matching_vector');
    expect(audit).toBeTruthy();
    expect(JSON.parse(audit.details)).toMatchObject({ entity: 'matching_vector', count: 2 });
  });
});

describe('matching routes record every pair', () => {
  const nativeFetch = global.fetch;
  const runCandidates = [];
  const runJobs = [];

  beforeAll(() => {
    for (let i = 0; i < 15; i += 1) runCandidates.push(insertCandidate(`Run Kandidat${i} ${marker}`));
    const insertJob = db.prepare('INSERT INTO jobs (title, graph_job_id, status) VALUES (?, ?, ?)');
    for (let i = 0; i < 8; i += 1) runJobs.push(insertJob.run(`Run Stelle ${i} ${marker}`, `${marker}-job-uuid-${i}`, 'Offen').lastInsertRowid);
  });

  afterEach(() => {
    global.fetch = nativeFetch;
  });

  afterAll(() => {
    db.prepare(`DELETE FROM candidates WHERE id IN (${runCandidates.map(() => '?').join(',')})`).run(...runCandidates);
    db.prepare(`DELETE FROM jobs WHERE id IN (${runJobs.map(() => '?').join(',')})`).run(...runJobs);
  });

  const runPairs = (method) => db.prepare(
    `SELECT * FROM matching_pair_results WHERE method = ? AND job_id IN (${runJobs.map(() => '?').join(',')})`
  ).all(method, ...runJobs);

  test('an N:N 3D run stores all pairs although the history keeps only the top 100', async () => {
    global.fetch = jest.fn(async (url, options) => {
      expect(String(url)).toMatch(/\/match\/external\/matrix$/);
      const body = JSON.parse(options.body);
      // Wie GraphRAG: IDs als Text, Score 0-100.
      const matrix = body.jobs.flatMap((job, j) => body.candidates.map((candidate, c) => ({
        jobId: String(job.id),
        jobTitle: job.title,
        candidateId: String(candidate.id),
        candidateName: candidate.name,
        score: (j * 15 + c) % 101,
        strengths: [],
        weaknesses: [],
        summary: 'x',
        matchedSkills: [{ jobSkill: 'java', candidateSkill: 'java', similarity: 1 }],
      })));
      return { ok: true, json: async () => ({ type: 'matrix', mode: body.mode, model: 'graph-rag-vector-matrix', matrix }) };
    });

    const res = await request(buildApp(admin)).post('/api/matching/run-matrix').send({
      jobIds: runJobs,
      candidateIds: runCandidates,
      engine: 'python',
    });
    expect(res.status).toBe(200);
    expect(res.body.pairCount).toBe(120);
    historyIds.push(res.body.id);

    const stored = JSON.parse(db.prepare('SELECT results FROM matching_results WHERE id = ?').get(res.body.id).results);
    expect(stored.matrix).toHaveLength(100);
    expect(stored.truncated).toBe(true);

    const rows = runPairs('vector');
    expect(rows).toHaveLength(120);
    expect(rows.every(row => row.matching_result_id === res.body.id && row.engine === 'python')).toBe(true);

    const expected = rows.filter(row => row.score > 80).length;
    const exported = await request(buildApp(admin)).post('/api/exports/run').send({
      entity: 'matching_vector',
      format: 'csv',
      fields: ['candidate_id', 'job_id', 'score'],
      filters: { job_ids: runJobs, score_above: 80 },
    });
    expect(exported.status).toBe(200);
    expect(Number(exported.headers['x-export-count'])).toBe(expected);
    expect(exported.text.trim().split('\r\n')).toHaveLength(expected + 1);
  });

  test('a KI batch on selected pairs is stored with the PostgreSQL job id', async () => {
    const [firstJob] = runJobs;
    const [firstCandidate, secondCandidate] = runCandidates;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          // GraphRAG antwortet mit der Neo4j-UUID der Stelle.
          { jobId: `${marker}-job-uuid-0`, jobTitle: 'Run Stelle 0', candidateId: String(firstCandidate), candidateName: 'x', score: 88, summary: 'KI', strengths: ['A'], weaknesses: [] },
          { jobId: String(firstJob), candidateId: String(secondCandidate), score: 35 },
        ],
        failures: [],
        model: 'qwen3',
      }),
    }));

    const res = await request(buildApp(admin)).post('/api/matching/run-selected').send({
      pairs: [
        { jobId: firstJob, sourceJobId: `${marker}-job-uuid-0`, candidateId: firstCandidate, jobTitle: 'Run Stelle 0' },
        { jobId: firstJob, candidateId: secondCandidate, jobTitle: 'Run Stelle 0' },
      ],
    });
    expect(res.status).toBe(200);

    const rows = runPairs('ai').sort((a, b) => b.score - a.score);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ job_id: firstJob, candidate_id: firstCandidate, score: 88, model: 'qwen3', matching_result_id: null });
    expect(rows[1]).toMatchObject({ job_id: firstJob, candidate_id: secondCandidate, score: 35 });
  });
});

describe('history backfill', () => {
  test('classifies stored runs by method', () => {
    expect(classifyStoredRun({}, { type: 'matrix', model: 'graph-rag-vector-matrix', matrix: [] }).method).toBe('vector');
    expect(classifyStoredRun({}, { direction: 'job_to_candidates', engine: 'neo4j', matrix: [] })).toMatchObject({ method: 'vector', engine: 'neo4j' });
    expect(classifyStoredRun({ job_description: 'Senior Java Entwickler' }, { results: [{ score: 80 }] })).toMatchObject({ method: 'ai', rows: [{ score: 80 }] });
    expect(classifyStoredRun({ job_description: 'Vector-Matching (python) für X' }, { matrix: [] }).method).toBe('vector');
  });

  test('takes over runs from matching_results that were never recorded', () => {
    const insert = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results, job_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const aiRun = insert.run('Data Scientist mit Python', `Data Scientist ${marker}`, JSON.stringify({
      results: [{ candidateId: emil, candidateName: `Emil Engel ${marker}`, score: 77, summary: 'Alt' }],
    }), data, new Date().toISOString()).lastInsertRowid;
    // KI-Matching gegen eine frei eingegebene Beschreibung: keine Stelle im Tool.
    const adHocRun = insert.run('Freitext', `Backend Engineer ${marker}`, JSON.stringify({
      results: [{ candidateId: emil, score: 88 }],
    }), null, new Date().toISOString()).lastInsertRowid;
    historyIds.push(aiRun, adHocRun);

    const result = backfillMatchingPairs(db);
    expect(result.runs).toBeGreaterThanOrEqual(2);
    const emilAi = pairs('ai').filter(row => row.candidate_id === emil);
    expect(emilAi).toHaveLength(1);
    expect(emilAi[0]).toMatchObject({ job_id: data, score: 77, matching_result_id: aiRun });
    expect(db.prepare('SELECT pairs_recorded FROM matching_results WHERE id = ?').get(adHocRun).pairs_recorded).toBe(1);
    expect(backfillMatchingPairs(db)).toEqual({ runs: 0, stored: 0 });
  });

  test('removes pairs when the run, the candidate or the job is deleted', () => {
    const emilRun = pairs('ai').find(row => row.candidate_id === emil).matching_result_id;
    db.prepare('DELETE FROM matching_results WHERE id = ?').run(emilRun);
    expect(pairs('ai').filter(row => row.candidate_id === emil)).toHaveLength(0);

    db.prepare('DELETE FROM jobs WHERE id = ?').run(data);
    expect(pairs('vector').filter(row => row.job_id === data)).toHaveLength(0);
    db.prepare('DELETE FROM candidates WHERE id = ?').run(dario);
    expect(pairs('vector').filter(row => row.candidate_id === dario)).toHaveLength(0);
    expect(pairs('vector')).toHaveLength(1);
  });
});
