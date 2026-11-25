const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const db = require('../database');
const authMiddleware = require('../middleware/auth');
const { JWT_SECRET } = require('../routes/auth');
const batchesRouter = require('../routes/batches');
const matchingRouter = require('../routes/matching');
const { ensureMatchingImportSchema } = require('../matchingImports');

const app = express();
app.use(express.json(), authMiddleware);
app.use('/api/batches', batchesRouter);
app.use('/api/matching', matchingRouter);
const originalFetch = global.fetch;
const runId = randomUUID();
const users = [];
let adminId;
let ownerId;
let adminToken;
let ownerToken;
const token = (id, role) => jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '5m' });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

beforeAll(() => {
  ensureMatchingImportSchema(db);
  db.exec('ALTER TABLE matching_runs ADD COLUMN IF NOT EXISTS client_context JSONB');
  db.exec('ALTER TABLE matching_runs ADD COLUMN IF NOT EXISTS result_payload JSONB');
  for (const role of ['admin', 'recruiter']) {
    users.push(db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'test', 'Batch Test', ?)").run(
      `batch-${role}-${randomUUID()}`, role,
    ).lastInsertRowid);
  }
  [adminId, ownerId] = users;
  adminToken = token(adminId, 'recruiter');
  ownerToken = token(ownerId, 'admin');
  db.prepare("INSERT INTO matching_runs (id, source, actor_user_id, stage) VALUES (?, 'CV-Import', ?, 'queued')")
    .run(runId, ownerId);
});

beforeEach(() => {
  global.fetch = jest.fn(async () => response(200, { items: [], nextCursor: null }));
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

afterAll(() => {
  db.prepare('DELETE FROM matching_runs WHERE id = ?').run(runId);
  for (const id of users) db.prepare('DELETE FROM users WHERE id = ?').run(id);
});

test('batch APIs require a bearer and the current stored administrator role', async () => {
  for (const path of ['/api/batches', `/api/batches/${runId}`]) {
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set('X-API-Key', 'not-admin')).status).toBe(401);
    expect((await request(app).get(path).auth(ownerToken, { type: 'bearer' })).status).toBe(403);
  }
  expect((await request(app).post(`/api/batches/${runId}/retry`)
    .auth(ownerToken, { type: 'bearer' }).send({ pairIds: [1] })).status).toBe(403);
  expect((await request(app).get('/api/batches').auth(token(2147483647, 'admin'), { type: 'bearer' })).status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
  const allowed = await request(app).get('/api/batches').auth(adminToken, { type: 'bearer' });
  expect(allowed.status).toBe(200);
});

test('queue filters and pair cursors are forwarded without dropping pagination metadata', async () => {
  const list = { items: [{ run: { runId }, counters: { progressPercent: 75 } }], nextCursor: randomUUID() };
  const detail = { run: { runId }, counters: { progressPercent: 75 }, pairs: [{ pairId: 37 }], nextCursor: 37 };
  global.fetch.mockImplementation(async url => response(200, new URL(url).pathname.endsWith(runId) ? detail : list));
  const page = await request(app).get('/api/batches').query({ status: 'matching', source: 'CV Import', limit: 3 })
    .auth(adminToken, { type: 'bearer' });
  expect(page.body).toEqual(list);
  const listUrl = new URL(global.fetch.mock.calls[0][0]);
  expect(Object.fromEntries(listUrl.searchParams)).toEqual({ status: 'matching', source: 'CV Import', limit: '3' });
  const pairs = await request(app).get(`/api/batches/${runId}`).query({ pairStatus: 'failed', cursor: 15, limit: 2 })
    .auth(adminToken, { type: 'bearer' });
  expect(pairs.body).toEqual(detail);
  expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${adminToken}`);
  expect(Object.fromEntries(new URL(global.fetch.mock.calls[1][0]).searchParams)).toEqual({
    pairStatus: 'failed', cursor: '15', limit: '2',
  });
});

test.each([401, 403, 404, 409, 422, 503])('preserves GraphRAG status %i rather than returning an empty success', async status => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch.mockResolvedValue(response(status, { detail: 'Gezielter Fehler' }));
  const result = await request(app).get('/api/batches').auth(adminToken, { type: 'bearer' });
  expect(result.status).toBe(status);
  expect(result.body.details).toBe('Gezielter Fehler');
  expect(result.body.items).toBeUndefined();
});

test('retry forwards only the explicit request body and preserves its acknowledgement', async () => {
  const body = { pairIds: [42], confirmUncertain: true };
  global.fetch.mockResolvedValue(response(200, { runId, stage: 'queued' }));
  const result = await request(app).post(`/api/batches/${runId}/retry`).auth(adminToken, { type: 'bearer' }).send(body);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ runId, stage: 'queued' });
  expect(global.fetch.mock.calls[0][0]).toMatch(`/admin/batches/${runId}/retry`);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(body);
});

test('own imported runs do not require a Node matching context and foreign access stays private', async () => {
  const status = {
    runId, stage: 'completed', counters: { targetCount: 8, processedCount: 8, progressPercent: 100 },
    availableResults: [{ score: 0.8, matchedAt: '2025-01-01T00:00:00Z' }],
    resultPayload: { original: 'Python result' },
  };
  global.fetch.mockResolvedValue(response(200, status));
  const own = await request(app).get(`/api/matching/runs/${runId}`).auth(ownerToken, { type: 'bearer' });
  expect(own.status).toBe(200);
  expect(own.body).toEqual({ ...status, statusUrl: `/api/matching/runs/${runId}` });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const foreignId = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'test', 'Other Test', 'recruiter')")
    .run(`batch-foreign-${randomUUID()}`).lastInsertRowid;
  users.push(foreignId);
  expect((await request(app).get(`/api/matching/runs/${runId}`)
    .auth(token(foreignId, 'admin'), { type: 'bearer' })).status).toBe(404);
});

test('invalid upstream JSON, malformed success and connection errors stay explicit', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  for (const upstream of [
    { json: async () => { throw new SyntaxError('HTML response'); } },
    response(200, {}),
  ]) {
    global.fetch.mockResolvedValue(upstream);
    expect((await request(app).get('/api/batches').auth(adminToken, { type: 'bearer' })).status).toBe(502);
  }
  global.fetch.mockRejectedValue(new TypeError('Connection refused'));
  expect((await request(app).get('/api/batches').auth(adminToken, { type: 'bearer' })).status).toBe(503);
});
