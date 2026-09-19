const express = require('express');
const fs = require('fs');
const { logAudit } = require('./audit');
const {
  readServerLogEntries,
  getServerLogDownloadName,
  logFilePath,
} = require('../serverLogger');

const router = express.Router();

const canViewLogs = (req) => ['admin', 'revisor'].includes(req.user?.role);

router.get('/', (req, res) => {
  try {
    if (!canViewLogs(req)) {
      return res.status(403).json({ error: 'Kein Zugriff auf Server-Logs' });
    }

    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 250));
    const level = typeof req.query.level === 'string' ? req.query.level : '';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const { entries, total } = readServerLogEntries({ limit, level, search });

    res.json({
      data: entries,
      pagination: { limit, total, totalPages: 1, page: 1 },
      source: logFilePath,
    });
  } catch (error) {
    console.error('Error fetching server logs:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Server-Logs' });
  }
});

router.get('/download', (req, res) => {
  try {
    if (!canViewLogs(req)) {
      return res.status(403).json({ error: 'Kein Zugriff auf Server-Logs' });
    }

    const filename = getServerLogDownloadName();
    const content = fs.existsSync(logFilePath) ? fs.readFileSync(logFilePath, 'utf8') : '';

    logAudit(req, 'server-logs-exportiert', 'System', null, 'Server-Logs', {
      bytes: Buffer.byteLength(content, 'utf8'),
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content || '');
  } catch (error) {
    console.error('Error downloading server logs:', error);
    res.status(500).json({ error: 'Fehler beim Herunterladen der Server-Logs' });
  }
});

module.exports = router;