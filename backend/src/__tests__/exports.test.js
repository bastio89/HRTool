/**
 * Generische Export-Schnittstelle: Feldauswahl, Zielfeld-Mapping, Formate,
 * Filter, Profile, Rollen und der Abruf durch Fremdsysteme per API-Key.
 * Laeuft gegen die echte Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');

const db = require('../database');
const exportsRouter = require('../routes/exports');
const { flattenValue } = require('../exports/formats');

const API_KEY = 'test-export-key';

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (user && !req.path.startsWith('/api/exports/external')) req.user = user;
    next();
  });
  app.use('/api/exports', exportsRouter);
  return app;
}

const admin = { id: 1, username: 'admin', display_name: 'Export Admin', role: 'admin' };
const recruiter = { id: 2, username: 'rec', display_name: 'Recruiter', role: 'recruiter' };
const fachbereich = { id: 3, username: 'fb', display_name: 'Fachbereich', role: 'fachbereich' };

const marker = `exp-${Date.now()}`;
let anna;
let ben;
let customFieldId;
const profileIds = [];

beforeAll(() => {
  const insert = db.prepare(`
    INSERT INTO candidates (name, email, phone, location, skills, status, source, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  anna = insert.run('Anna Maria Muster', `anna.${marker}@example.com`, '+41 79 000 00 01', 'Zuerich', 'Java, SQL', 'Aktiv', 'LinkedIn', `${marker}, Senior`).lastInsertRowid;
  ben = insert.run('Ben Beispiel', `ben.${marker}@example.com`, '=1+1', 'Bern', 'Python', 'Passiv', 'Xing', marker).lastInsertRowid;
  db.prepare(`
    INSERT INTO candidate_work_history (candidate_id, employer, position, from_date, is_current)
    VALUES (?, ?, ?, ?, 1)
  `).run(anna, 'ACME AG', 'Entwicklerin', '2020-01');
  customFieldId = db.prepare(`INSERT INTO custom_field_definitions (name, field_type) VALUES (?, 'text')`).run(`Personalnummer ${marker}`).lastInsertRowid;
  db.prepare('INSERT INTO candidate_custom_values (candidate_id, field_id, value) VALUES (?, ?, ?)').run(anna, customFieldId, 'P-4711');
});

afterAll(() => {
  db.prepare('DELETE FROM candidates WHERE id IN (?, ?)').run(anna, ben);
  db.prepare('DELETE FROM custom_field_definitions WHERE id = ?').run(customFieldId);
  for (const id of profileIds) db.prepare('DELETE FROM export_profiles WHERE id = ?').run(id);
  delete process.env.EXTERNAL_API_KEY;
});

const onlyOurs = { tags: [marker] };

describe('export schema', () => {
  test('lists candidate fields including custom fields, and formats', async () => {
    const res = await request(buildApp(recruiter)).get('/api/exports/schema');
    expect(res.status).toBe(200);
    const candidates = res.body.entities.find(entity => entity.key === 'candidates');
    const keys = candidates.fields.map(field => field.key);
    expect(keys).toEqual(expect.arrayContaining(['email', 'first_name', 'work_history', `custom.${customFieldId}`]));
    expect(res.body.formats.map(format => format.key)).toEqual(expect.arrayContaining(['json', 'csv', 'xml', 'ndjson']));
  });

  test('is closed to roles without export permission', async () => {
    const res = await request(buildApp(fachbereich)).get('/api/exports/schema');
    expect(res.status).toBe(403);
  });
});

describe('ad-hoc export', () => {
  test('maps fields to target names and nests them in JSON', async () => {
    const res = await request(buildApp(recruiter)).post('/api/exports/run').send({
      format: 'json',
      fields: [
        { key: 'id', as: 'externalId' },
        { key: 'first_name', as: 'person.firstName' },
        { key: 'last_name', as: 'person.lastName' },
        { key: 'email', as: 'contact.email' },
        { key: 'work_history', as: 'career' },
        { key: `custom.${customFieldId}`, as: 'personnelNumber' },
      ],
      filters: { ...onlyOurs, status: ['Aktiv'] },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-total-count']).toBe('1');
    const payload = JSON.parse(res.text);
    expect(payload.meta).toMatchObject({ entity: 'candidates', count: 1, total: 1 });
    expect(payload.data[0]).toEqual({
      externalId: anna,
      person: { firstName: 'Anna Maria', lastName: 'Muster' },
      contact: { email: `anna.${marker}@example.com` },
      career: [expect.objectContaining({ employer: 'ACME AG', position: 'Entwicklerin', current: true })],
      personnelNumber: 'P-4711',
    });
  });

  test('renders CSV with chosen delimiter and neutralises spreadsheet formulas', async () => {
    const res = await request(buildApp(recruiter)).post('/api/exports/run').send({
      format: 'csv',
      format_options: { delimiter: 'semicolon', bom: false },
      fields: ['name', { key: 'phone', as: 'Telefon' }, { key: 'skills_list', as: 'Skills' }],
      filters: onlyOurs,
    });
    expect(res.status).toBe(200);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('name;Telefon;Skills');
    expect(lines).toContain('Anna Maria Muster;+41 79 000 00 01;"Java; SQL"');
    expect(lines).toContain("Ben Beispiel;'=1+1;Python");
  });

  test('renders XML', async () => {
    const res = await request(buildApp(recruiter)).post('/api/exports/run').send({
      format: 'xml',
      format_options: { root: 'Bewerber', item: 'Person' },
      fields: [{ key: 'email', as: 'kontakt.email' }],
      filters: { ids: [ben] },
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('<Bewerber>');
    expect(res.text).toContain(`<kontakt>\n      <email>ben.${marker}@example.com</email>`);
  });

  test('rejects unknown fields, duplicate targets and unknown filters', async () => {
    const app = buildApp(recruiter);
    const unknownField = await request(app).post('/api/exports/run').send({ fields: ['password_hash'] });
    expect(unknownField.status).toBe(400);
    const duplicate = await request(app).post('/api/exports/run').send({ fields: [{ key: 'name', as: 'x' }, { key: 'email', as: 'x' }] });
    expect(duplicate.status).toBe(400);
    const badFilter = await request(app).post('/api/exports/run').send({ filters: { evil: 1 } });
    expect(badFilter.status).toBe(400);
  });

  test('writes an audit entry for every export', async () => {
    await request(buildApp(recruiter)).post('/api/exports/run').send({ fields: ['email'], filters: { ids: [anna] } });
    const entry = db.prepare(`SELECT * FROM audit_log WHERE action = 'export' ORDER BY id DESC LIMIT 1`).get();
    const details = JSON.parse(entry.details);
    expect(details).toMatchObject({ channel: 'ui', entity: 'candidates', count: 1, fields: ['email'] });
  });

  test('an id selection without valid ids exports nothing instead of everyone', async () => {
    const res = await request(buildApp(recruiter)).post('/api/exports/preview').send({ fields: ['id'], filters: { ids: ['abc'] } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  test('filters by pipeline of a job and stage', async () => {
    const jobId = db.prepare('INSERT INTO jobs (title) VALUES (?)').run(`Job ${marker}`).lastInsertRowid;
    try {
      db.prepare('INSERT INTO pipeline_entries (job_id, candidate_id, stage) VALUES (?, ?, ?)').run(jobId, anna, 'Hired');
      db.prepare('INSERT INTO pipeline_entries (job_id, candidate_id, stage) VALUES (?, ?, ?)').run(jobId, ben, 'Interview');
      const res = await request(buildApp(recruiter)).post('/api/exports/preview').send({
        fields: ['id', 'pipeline'],
        filters: { job_id: jobId, stage: ['Hired'] },
      });
      expect(res.status).toBe(200);
      expect(res.body.records).toEqual([
        { id: anna, pipeline: [expect.objectContaining({ job_id: jobId, job_title: `Job ${marker}`, stage: 'Hired' })] },
      ]);
    } finally {
      db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    }
  });

  test('preview returns the first mapped records as JSON', async () => {
    const res = await request(buildApp(recruiter)).post('/api/exports/preview').send({
      fields: [{ key: 'last_name', as: 'nachname' }],
      filters: onlyOurs,
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.records.map(record => record.nachname)).toEqual(['Muster', 'Beispiel']);
  });
});

describe('export profiles', () => {
  test('only admins manage profiles; recruiters may run them with extra filters', async () => {
    const spec = {
      name: `Lohnbuchhaltung ${marker}`,
      format: 'csv',
      fields: [{ key: 'email', as: 'Mail' }],
      filters: onlyOurs,
    };
    const forbidden = await request(buildApp(recruiter)).post('/api/exports/profiles').send(spec);
    expect(forbidden.status).toBe(403);

    const created = await request(buildApp(admin)).post('/api/exports/profiles').send(spec);
    expect(created.status).toBe(201);
    profileIds.push(created.body.id);
    expect(created.body.fields).toEqual([{ key: 'email', as: 'Mail' }]);

    const run = await request(buildApp(recruiter))
      .post(`/api/exports/profiles/${created.body.id}/run`)
      .send({ filters: { ids: [ben] } });
    expect(run.status).toBe(200);
    expect(run.headers['content-disposition']).toMatch(/Lohnbuchhaltung_exp-\d+_\d{4}-\d{2}-\d{2}\.csv/);
    expect(run.text.replace(/^﻿/, '').split('\r\n')).toEqual(['Mail', `ben.${marker}@example.com`]);

    const updated = await request(buildApp(admin)).put(`/api/exports/profiles/${created.body.id}`).send({ format: 'json' });
    expect(updated.status).toBe(200);
    expect(updated.body.format).toBe('json');
    expect(updated.body.fields).toEqual([{ key: 'email', as: 'Mail' }]);
  });
});

describe('external pull API', () => {
  let profileId;

  beforeAll(() => {
    profileId = db.prepare(`
      INSERT INTO export_profiles (name, entity, format, format_options, fields, filters, external_enabled)
      VALUES (?, 'candidates', 'json', '{}', ?, ?, 0)
    `).run(`Extern ${marker}`, JSON.stringify([{ key: 'id', as: 'id' }, { key: 'email', as: 'email' }]), JSON.stringify(onlyOurs)).lastInsertRowid;
    profileIds.push(profileId);
  });

  test('requires a configured and matching API key', async () => {
    delete process.env.EXTERNAL_API_KEY;
    const unconfigured = await request(buildApp()).get(`/api/exports/external/profiles/${profileId}`);
    expect(unconfigured.status).toBe(503);

    process.env.EXTERNAL_API_KEY = API_KEY;
    const wrong = await request(buildApp()).get(`/api/exports/external/profiles/${profileId}`).set('X-API-Key', 'nope');
    expect(wrong.status).toBe(401);
  });

  test('only serves profiles released for external access, paged', async () => {
    process.env.EXTERNAL_API_KEY = API_KEY;
    const hidden = await request(buildApp()).get(`/api/exports/external/profiles/${profileId}`).set('X-API-Key', API_KEY);
    expect(hidden.status).toBe(404);

    db.prepare('UPDATE export_profiles SET external_enabled = 1 WHERE id = ?').run(profileId);
    const list = await request(buildApp()).get('/api/exports/external/profiles').set('X-API-Key', API_KEY);
    expect(list.body.map(profile => profile.id)).toContain(profileId);

    const page = await request(buildApp())
      .get(`/api/exports/external/profiles/${profileId}?limit=1&offset=1`)
      .set('X-API-Key', API_KEY);
    expect(page.status).toBe(200);
    expect(page.headers['x-total-count']).toBe('2');
    const payload = JSON.parse(page.text);
    expect(payload.data).toEqual([{ id: ben, email: `ben.${marker}@example.com` }]);

    const future = await request(buildApp())
      .get(`/api/exports/external/profiles/${profileId}?updated_since=2999-01-01T00:00:00Z`)
      .set('X-API-Key', API_KEY);
    expect(JSON.parse(future.text).data).toEqual([]);

    const entry = db.prepare(`SELECT details FROM audit_log WHERE action = 'export' ORDER BY id DESC LIMIT 1`).get();
    expect(JSON.parse(entry.details).channel).toBe('external-api');
  });
});

describe('flattenValue', () => {
  test('joins lists and serialises objects for flat formats', () => {
    expect(flattenValue(['a', 'b'])).toBe('a; b');
    expect(flattenValue([{ x: 1 }])).toBe('{"x":1}');
    expect(flattenValue(null)).toBe('');
  });
});
