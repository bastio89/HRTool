const express = require('express');
const request = require('supertest');

describe('server logs route', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('lists and downloads server logs for admins', async () => {
    jest.doMock('../database', () => ({
      prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }),
    }));
    jest.doMock('../routes/audit', () => ({ logAudit: jest.fn() }));
    jest.doMock('../serverLogger', () => ({
      readServerLogEntries: jest.fn(() => ({
        entries: [
          { timestamp: '2026-09-19T12:00:00.000Z', level: 'ERROR', message: 'Boom', raw: '2026-09-19T12:00:00.000Z [ERROR] Boom' },
          { timestamp: '2026-09-19T11:59:00.000Z', level: 'INFO', message: 'Started', raw: '2026-09-19T11:59:00.000Z [INFO] Started' },
        ],
        total: 2,
        logFilePath: '/tmp/server.log',
      })),
      getServerLogDownloadName: () => 'server-logs_2026-09-19.log',
      logFilePath: '/tmp/server.log',
    }));
    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => '2026-09-19T11:59:00.000Z [INFO] Started\n2026-09-19T12:00:00.000Z [ERROR] Boom\n'),
    }));

    const serverLogsRouter = require('../routes/server-logs');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { role: 'admin' };
      next();
    });
    app.use('/api/server-logs', serverLogsRouter);

    const listResponse = await request(app).get('/api/server-logs?limit=10&level=ERROR');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(2);
    expect(listResponse.body.pagination.total).toBe(2);
    expect(listResponse.body.data[0]).toEqual(expect.objectContaining({ level: 'ERROR', message: 'Boom' }));

    const downloadResponse = await request(app).get('/api/server-logs/download');
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers['content-disposition']).toContain('server-logs_2026-09-19.log');
    expect(downloadResponse.text).toContain('[INFO] Started');
    expect(downloadResponse.text).toContain('[ERROR] Boom');
  });
});