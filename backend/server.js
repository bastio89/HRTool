require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/swagger');
const candidatesRouter = require('./src/routes/candidates');
const matchingRouter = require('./src/routes/matching');
const jobsRouter = require('./src/routes/jobs');
const pipelineRouter = require('./src/routes/pipeline');
const activitiesRouter = require('./src/routes/activities');
const uploadsRouter = require('./src/routes/uploads');
const authRouter = require('./src/routes/auth');
const cvParserRouter = require('./src/routes/cv-parser');
const auditRouter = require('./src/routes/audit');
const settingsRouter = require('./src/routes/settings');
const interviewsRouter = require('./src/routes/interviews');
const ratingsRouter = require('./src/routes/ratings');
const aiLogsRouter = require('./src/routes/ai-logs');
const scorecardsRouter = require('./src/routes/scorecards');
const emailsRouter = require('./src/routes/emails');
const collaborationRouter = require('./src/routes/collaboration');
const reportsRouter = require('./src/routes/reports');
const candidateDetailsRouter = require('./src/routes/candidate-details');
const matchingWeightsRouter = require('./src/routes/matching-weights');
const complianceActionsRouter = require('./src/routes/compliance-actions');
const addJobRouter = require('./src/routes/add-job');
const authMiddleware = require('./src/middleware/auth');
const db = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'] }));
app.use(express.json({ limit: '10mb' }));

// Auth middleware (parses token, sets req.user)
app.use(authMiddleware);

// API Documentation (Swagger UI)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'HR-Tool API Docs',
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/matching', matchingRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/activities', activitiesRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/cv-parser', cvParserRouter);
app.use('/api/audit', auditRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/interviews', interviewsRouter);
app.use('/api/ratings', ratingsRouter);
app.use('/api/scorecards', scorecardsRouter);
app.use('/api/ai-logs', aiLogsRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/collaboration', collaborationRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/candidate-details', candidateDetailsRouter);
app.use('/api/matching-weights', matchingWeightsRouter);
app.use('/api/compliance-actions', complianceActionsRouter);
app.use('/api/add/job', addJobRouter);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: System-Status inkl. n8n-Erreichbarkeit
 *     tags: [System]
 *     security: []
 *     responses:
 *       200: { description: Status aller Services }
 */
app.get('/api/health', async (req, res) => {
  const n8nUrl = process.env.N8N_BASE_URL || 'http://localhost:5678';
  const graphRagUrl = process.env.GRAPHRAG_BASE_URL || 'http://graphrag:8000';
  let n8nStatus = 'unreachable';
  let graphRagStatus = 'unreachable';
  let aiUsage = { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`${n8nUrl}/healthz`, { signal: ctrl.signal });
    clearTimeout(timeout);
    n8nStatus = resp.ok ? 'ok' : `error (${resp.status})`;
  } catch (_) {
    n8nStatus = 'unreachable';
  }
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`${graphRagUrl.replace(/\/+$/, '')}/health`, { signal: ctrl.signal });
    clearTimeout(timeout);
    graphRagStatus = resp.ok ? 'ok' : `error (${resp.status})`;
    const payload = await resp.json().catch(() => null);
    if (payload?.ai_usage) {
      aiUsage = {
        calls: Number(payload.ai_usage.calls) || 0,
        input_tokens: Number(payload.ai_usage.input_tokens) || 0,
        output_tokens: Number(payload.ai_usage.output_tokens) || 0,
        total_tokens: Number(payload.ai_usage.total_tokens) || 0,
      };
    }
  } catch (_) {
    graphRagStatus = 'unreachable';
  }
  try {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS input_tokens,
        COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS output_tokens
      FROM ai_logs
    `).get();
    aiUsage = {
      calls: Number(row?.calls) || 0,
      input_tokens: Number(row?.input_tokens) || 0,
      output_tokens: Number(row?.output_tokens) || 0,
      total_tokens: (Number(row?.input_tokens) || 0) + (Number(row?.output_tokens) || 0),
    };
  } catch (_) {}
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    n8nUrl,
    n8nStatus,
    graphRagUrl,
    aiUsage,
    services: {
      backend: 'ok',
      database: 'ok',
      n8n: n8nStatus,
      graphrag: graphRagStatus,
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

app.listen(PORT, () => {
  console.log(`✅ HR-Tool Backend läuft auf http://localhost:${PORT}`);
  console.log(`📋 API: http://localhost:${PORT}/api/candidates`);
  console.log(`🔄 Matching: http://localhost:${PORT}/api/matching`);
});
