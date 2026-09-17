/**
 * Guards the auth hardening: the login must not accept unlimited password
 * attempts, and a token in the URL query must only work for the few read-only
 * file routes that cannot send an Authorization header.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

describe('auth hardening', () => {
  test('login stops accepting attempts after the limit', async () => {
    jest.isolateModules(() => {});
    const authRouter = require('../routes/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);

    const attempt = (username) => request(app)
      .post('/api/auth/login')
      .send({ username, password: 'wrong' });

    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await attempt('nobody');
      if (res.status === 429) { limited = true; break; }
      expect(res.status).toBe(401);
    }
    expect(limited).toBe(true);

    // The limiter keys on the username, not the IP - hammering one account
    // must not lock everyone else out. Without this the shared proxy IP would
    // have taken the whole instance down after ten wrong passwords.
    const other = await attempt('someone-else');
    expect(other.status).toBe(401);
  });

  test('a token in the query is rejected on a normal API route', async () => {
    const authMiddleware = require('../middleware/auth');
    const { JWT_SECRET } = require('../routes/auth');
    const token = jwt.sign({ id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '5m' });

    const app = express();
    app.use(authMiddleware);
    app.get('/api/candidates', (req, res) => res.json({ ok: true }));

    const res = await request(app).get(`/api/candidates?token=${token}`);
    expect(res.status).toBe(401);
  });

  test('a token in the query still works for file downloads and photos', async () => {
    const authMiddleware = require('../middleware/auth');
    const { JWT_SECRET } = require('../routes/auth');
    const token = jwt.sign({ id: 1, role: 'admin' }, JWT_SECRET, { expiresIn: '5m' });

    const app = express();
    app.use(authMiddleware);
    app.get('/api/uploads/download/:id', (req, res) => res.json({ ok: true }));
    app.get('/api/candidate-details/:id/photo', (req, res) => res.json({ ok: true }));

    for (const url of ['/api/uploads/download/42', '/api/candidate-details/7/photo']) {
      const res = await request(app).get(`${url}?token=${token}`);
      expect(res.status).toBe(200);
    }
  });
});
