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
const authMiddleware = require('./src/middleware/auth');

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    n8nUrl: process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/hr-matching'
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
