/**
 * Fachbereich darf nur die ihm zugewiesenen Stellen sehen. Gegen die echte
 * Testdatenbank (DATABASE_URL), wie in CI.
 */
const express = require('express');
const request = require('supertest');
const db = require('../database');
const jobsRouter = require('../routes/jobs');

const marker = `access-${Date.now()}`;
const jobIds = [];
let fbUserId;

function appAs(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/jobs', jobsRouter);
  return app;
}

beforeAll(() => {
  for (const title of [`Zugewiesen ${marker}`, `Fremd ${marker}`]) {
    jobIds.push(db.prepare('INSERT INTO jobs (title) VALUES (?)').run(title).lastInsertRowid);
  }
  fbUserId = db.prepare(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?, 'x', 'FB', 'fachbereich')`)
    .run(`fb-${marker}`).lastInsertRowid;
  db.prepare('INSERT INTO user_job_access (user_id, job_id) VALUES (?, ?)').run(fbUserId, jobIds[0]);
});

afterAll(() => {
  db.prepare('DELETE FROM user_job_access WHERE user_id = ?').run(fbUserId);
  db.prepare('DELETE FROM users WHERE id = ?').run(fbUserId);
  for (const id of jobIds) db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
});

describe('job access for fachbereich', () => {
  const fb = () => ({ id: fbUserId, role: 'fachbereich', username: `fb-${marker}` });

  test('list contains only assigned jobs', async () => {
    const res = await request(appAs(fb())).get('/api/jobs?limit=500');
    expect(res.status).toBe(200);
    const titles = res.body.data.map(j => j.title);
    expect(titles).toContain(`Zugewiesen ${marker}`);
    expect(titles).not.toContain(`Fremd ${marker}`);
  });

  test('a foreign job looks like a missing one', async () => {
    const own = await request(appAs(fb())).get(`/api/jobs/${jobIds[0]}`);
    expect(own.status).toBe(200);
    const foreign = await request(appAs(fb())).get(`/api/jobs/${jobIds[1]}`);
    expect(foreign.status).toBe(404);
  });

  test('recruiters still see every job', async () => {
    const res = await request(appAs({ id: 1, role: 'recruiter' })).get(`/api/jobs/${jobIds[1]}`);
    expect(res.status).toBe(200);
  });
});
