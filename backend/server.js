require('dotenv').config();
const express = require('express');
const cors = require('cors');
const candidatesRouter = require('./src/routes/candidates');
const matchingRouter = require('./src/routes/matching');
const jobsRouter = require('./src/routes/jobs');
const pipelineRouter = require('./src/routes/pipeline');
const activitiesRouter = require('./src/routes/activities');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'] }));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/candidates', candidatesRouter);
app.use('/api/matching', matchingRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/activities', activitiesRouter);

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
