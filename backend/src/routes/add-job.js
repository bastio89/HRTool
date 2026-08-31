const express = require('express');

const router = express.Router();

router.post('/', express.text({ type: ['text/plain', 'text/*'], limit: '2mb' }), async (req, res) => {
  const rawText = typeof req.body === 'string' ? req.body.trim() : '';
  if (!rawText) {
    return res.status(400).json({ error: 'Stellentext ist erforderlich' });
  }

  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/add/job/`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: rawText,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload.detail || payload.error || `GraphRAG HTTP ${response.status}`,
      });
    }

    return res.status(201).json(payload);
  } catch (err) {
    console.error('GraphRAG add/job proxy failed:', err);
    return res.status(503).json({ error: `GraphRAG nicht erreichbar: ${err.message}` });
  }
});

module.exports = router;