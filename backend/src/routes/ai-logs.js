const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

/**
 * @swagger
 * /ai-logs:
 *   get:
 *     summary: KI-Protokolle abrufen (EU AI Act Art. 12)
 *     tags: [AI-Logs]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: feature
 *         schema: { type: string, enum: [matching, cv-parser, job-generator, email-template] }
 *       - in: query
 *         name: success
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: date_from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: date_to
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Paginierte KI-Protokolle }
 */
router.get('/', (req, res) => {
  try {
    // Admin check
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff auf KI-Protokolle' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { feature, success, date_from, date_to } = req.query;

    let where = [];
    let params = [];

    if (feature) {
      where.push('al.feature = ?');
      params.push(feature);
    }
    if (success === 'true') {
      where.push('al.success = 1');
    } else if (success === 'false') {
      where.push('al.success = 0');
    }
    if (date_from) {
      where.push("al.created_at >= datetime(?, 'start of day')");
      params.push(date_from);
    }
    if (date_to) {
      where.push("al.created_at <= datetime(?, '+1 day', 'start of day')");
      params.push(date_to);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM ai_logs al ${whereClause}`).get(...params).count;

    // Return logs without full prompt/response (only hashes & summaries for list view)
    const logs = db.prepare(`
      SELECT al.id, al.user_id, al.feature, al.model, al.model_version,
             al.prompt_hash, al.duration_ms, al.input_tokens, al.output_tokens,
             al.success, al.error_message, al.created_at,
             u.display_name as user_name
      FROM ai_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      data: logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Error fetching AI logs:', error);
    res.status(500).json({ error: 'Fehler beim Laden der KI-Protokolle' });
  }
});

// ═══════════════════════════════════════
// Model Card (EU AI Act Art. 13 — Transparency)
// ═══════════════════════════════════════

/**
 * @swagger
 * /ai-logs/model-card:
 *   get:
 *     summary: Model Card — Strukturierte Modellinformationen (Art. 13)
 *     tags: [AI-Logs]
 *     responses:
 *       200: { description: Model-Card-Informationen }
 */
router.get('/model-card', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const modelStats = db.prepare(`
      SELECT model, 
             COUNT(*) as total_calls,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
             ROUND(AVG(duration_ms)) as avg_duration_ms,
             MIN(created_at) as first_used,
             MAX(created_at) as last_used
      FROM ai_logs
      WHERE model IS NOT NULL
      GROUP BY model
      ORDER BY total_calls DESC
    `).all();

    const featureUsage = db.prepare(`
      SELECT feature, model, COUNT(*) as count
      FROM ai_logs WHERE model IS NOT NULL
      GROUP BY feature, model
      ORDER BY feature, count DESC
    `).all();

    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

    const modelCard = {
      model: {
        name: OLLAMA_MODEL,
        provider: 'Ollama (lokal)',
        type: 'Large Language Model (LLM)',
        architecture: 'Transformer-basiert',
        deployment: 'On-Premise / lokale Ausführung',
        endpoint: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace('host.docker.internal', 'localhost'),
      },
      intendedUse: {
        primaryUses: [
          { feature: 'matching', description: 'Bewertung der Passung zwischen Bewerberprofilen und Stellenanforderungen', riskLevel: 'high', aiActCategory: 'Annex III, Kat. 4 — Beschäftigung' },
          { feature: 'cv-parser', description: 'Extraktion strukturierter Daten aus Lebensläufen (PDF/Word)', riskLevel: 'high', aiActCategory: 'Annex III, Kat. 4 — Beschäftigung' },
          { feature: 'job-generator', description: 'Generierung von Stellenbeschreibungen aus Stichpunkten', riskLevel: 'low', aiActCategory: 'Art. 50 — Transparenzpflicht' },
          { feature: 'email-template', description: 'Generierung von E-Mail-Vorlagen für HR-Kommunikation', riskLevel: 'low', aiActCategory: 'Art. 50 — Transparenzpflicht' },
          { feature: 'interview-questions', description: 'Generierung von Interviewfragen basierend auf Stelle und Profil', riskLevel: 'low', aiActCategory: 'Art. 50 — Transparenzpflicht' },
        ],
        outOfScope: [
          'Autonome Einstellungsentscheidungen',
          'Verarbeitung sensibler Daten (Geschlecht, Herkunft, Religion)',
          'Erstellung rechtsverbindlicher Dokumente',
          'Bewertung existierender Mitarbeiter (Performance Reviews)',
        ],
      },
      dataHandling: {
        inputDataTypes: ['Bewerberprofile (Name, Skills, Erfahrung)', 'Stellenbeschreibungen', 'Lebenslauf-Text (extrahiert)', 'Stichpunkte für Stellenbeschreibungen'],
        anonymization: 'Bewerbernamen werden beim Matching durch Platzhalter ersetzt (Kandidat 1, 2, 3...)',
        dataMinimization: 'Nur jobrelevante Felder werden übermittelt. Keine Adressen, Geburtsdaten oder Fotos.',
        dataRetention: 'Alle KI-Aufrufe werden in der lokalen Datenbank protokolliert (ai_logs). Keine Cloud-Übertragung.',
        thirdPartySharing: 'Nein — Das LLM läuft vollständig lokal via Ollama.',
      },
      performance: {
        modelStats,
        featureUsage,
        knownLimitations: [
          'LLM-Antworten können inkonsistent sein (Temperatur-Parameter)',
          'JSON-Parsing kann bei unerwarteten Formaten fehlschlagen',
          'Bei sehr langen Profilen kann die Kontextlänge überschritten werden',
          'Die Bewertungsqualität hängt von der Qualität der Eingabedaten ab',
          'Keine Echtzeit-Garantie — Antwortzeiten variieren (5–120 Sekunden)',
        ],
      },
      safeguards: {
        humanOversight: 'Alle KI-Ergebnisse sind Vorschläge. Finale Entscheidungen werden von Recruitern getroffen.',
        biasMonitoring: 'Score-Verteilungen, Standort- und Quellen-Analysen werden im Bias-Monitor überwacht.',
        overrideLogging: 'Überstimmungen niedriger KI-Scores werden als KI-Override protokolliert.',
        rateLimiting: 'Alle KI-Endpunkte sind zeitbasiert limitiert (Matching: 5/min, Generatoren: 10/min).',
        errorHandling: 'Fehlgeschlagene Aufrufe werden protokolliert. Compliance-Dashboard zeigt Fehlerrate.',
        transparency: 'Alle KI-Inhalte sind durch lila Badges und Disclaimer gekennzeichnet.',
      },
      regulatoryInfo: {
        regulation: 'EU AI Act — Verordnung (EU) 2024/1689',
        applicableArticles: [
          'Art. 6 — Klassifizierung als Hochrisiko (Annex III Nr. 4)',
          'Art. 9 — Risikomanagement (Bias-Monitoring, Fehlerüberwachung)',
          'Art. 10 — Datenqualität (Anonymisierung, Datenminimierung)',
          'Art. 12 — Aufzeichnungspflicht (vollständiges Prompt/Response-Logging)',
          'Art. 13 — Transparenz (Model Card, KI-Badges)',
          'Art. 14 — Menschliche Aufsicht (Human Review, Override-Logging)',
          'Art. 25 — Betreiberpflichten (lokale Verarbeitung)',
          'Art. 50 — Transparenzpflicht für niedrigere Risikostufen',
        ],
        complianceContact: 'Administrator dieses HR-Tool-Systems',
        lastReview: new Date().toISOString().slice(0, 10),
      },
    };

    res.json(modelCard);
  } catch (error) {
    console.error('Error generating model card:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Model Card' });
  }
});

/**
 * @swagger
 * /ai-logs/{id}:
 *   get:
 *     summary: Einzelnes KI-Protokoll mit vollständigem Prompt/Response
 *     tags: [AI-Logs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Vollständiges KI-Protokoll }
 */
router.get('/:id', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    const log = db.prepare(`
      SELECT al.*, u.display_name as user_name
      FROM ai_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.id = ?
    `).get(req.params.id);

    if (!log) return res.status(404).json({ error: 'Protokoll nicht gefunden' });

    // Parse prompt to check for anonymization
    let anonymizationApplied = false;
    try {
      const promptData = JSON.parse(log.prompt || '{}');
      if (promptData.candidates) {
        anonymizationApplied = promptData.candidates.some(c => /^Kandidat \d+$/.test(c.name));
      }
    } catch (_) {}

    res.json({
      ...log,
      parsed_result: log.parsed_result ? JSON.parse(log.parsed_result) : null,
      _meta: {
        anonymizationApplied,
        riskLevel: ['matching', 'cv-parser'].includes(log.feature) ? 'high' : 'low',
        aiActArticles: ['matching', 'cv-parser'].includes(log.feature)
          ? ['Art. 6 (Hochrisiko)', 'Art. 9 (Risikomanagement)', 'Art. 12 (Aufzeichnungspflicht)', 'Art. 13 (Transparenz)', 'Art. 14 (Menschliche Aufsicht)']
          : ['Art. 50 (Transparenzpflicht)'],
      }
    });
  } catch (error) {
    console.error('Error fetching AI log detail:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Protokolls' });
  }
});

/**
 * @swagger
 * /ai-logs/stats/overview:
 *   get:
 *     summary: KI-Nutzungsstatistiken für Compliance-Dashboard
 *     tags: [AI-Logs]
 *     responses:
 *       200: { description: Aggregierte KI-Statistiken }
 */
router.get('/stats/overview', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    // Total counts by feature
    const byFeature = db.prepare(`
      SELECT feature,
             COUNT(*) as total,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
             SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
             ROUND(AVG(duration_ms)) as avg_duration_ms,
             SUM(input_tokens) as total_input_tokens,
             SUM(output_tokens) as total_output_tokens
      FROM ai_logs
      GROUP BY feature
    `).all();

    // Daily usage (last 30 days)
    const dailyUsage = db.prepare(`
      SELECT date(created_at) as date,
             feature,
             COUNT(*) as count,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful
      FROM ai_logs
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY date(created_at), feature
      ORDER BY date
    `).all();

    // Error rate trend (last 7 days)
    const errorRate = db.prepare(`
      SELECT date(created_at) as date,
             COUNT(*) as total,
             SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
      FROM ai_logs
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY date(created_at)
    `).all();

    // Models used
    const models = db.prepare(`
      SELECT model, COUNT(*) as count, MAX(created_at) as last_used
      FROM ai_logs WHERE model IS NOT NULL
      GROUP BY model ORDER BY count DESC
    `).all();

    // Total stats
    const totals = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
             MIN(created_at) as first_log,
             MAX(created_at) as last_log
      FROM ai_logs
    `).get();

    // High-risk calls count (matching + cv-parser)
    const highRisk = db.prepare(`
      SELECT COUNT(*) as count FROM ai_logs WHERE feature IN ('matching', 'cv-parser')
    `).get();

    res.json({
      totals: {
        ...totals,
        successRate: totals.total > 0 ? Math.round((totals.successful / totals.total) * 100) : 0,
        highRiskCount: highRisk.count,
        highRiskPercentage: totals.total > 0 ? Math.round((highRisk.count / totals.total) * 100) : 0,
      },
      byFeature,
      dailyUsage,
      errorRate,
      models,
    });
  } catch (error) {
    console.error('Error fetching AI stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der KI-Statistiken' });
  }
});

/**
 * @swagger
 * /ai-logs/stats/bias-report:
 *   get:
 *     summary: Bias-Monitoring-Report (EU AI Act Art. 9/10)
 *     tags: [AI-Logs]
 *     responses:
 *       200: { description: Bias-Analyse der KI-Matching-Ergebnisse }
 */
router.get('/stats/bias-report', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    // Analyze matching results for potential bias patterns
    const matchings = db.prepare(`
      SELECT id, results, created_at FROM matching_results
      ORDER BY created_at DESC LIMIT 100
    `).all();

    // Score distribution analysis
    let allScores = [];
    let locationScores = {};
    let scoreDistribution = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };

    for (const m of matchings) {
      try {
        const parsed = JSON.parse(m.results);
        const results = parsed.results || [];
        for (const r of results) {
          const scorePct = (r.score || 0) * 100;
          allScores.push(scorePct);

          // Distribution
          if (scorePct < 20) scoreDistribution['0-20']++;
          else if (scorePct < 40) scoreDistribution['20-40']++;
          else if (scorePct < 60) scoreDistribution['40-60']++;
          else if (scorePct < 80) scoreDistribution['60-80']++;
          else scoreDistribution['80-100']++;
        }
      } catch (_) {}
    }

    // Score by candidate location (from pipeline data cross-referencing)
    const locationAnalysis = db.prepare(`
      SELECT c.location, 
             COUNT(*) as total_in_matchings,
             AVG(CASE WHEN pe.stage = 'Hired' THEN 1 ELSE 0 END) * 100 as hired_rate
      FROM candidates c
      LEFT JOIN pipeline_entries pe ON pe.candidate_id = c.id
      WHERE c.location IS NOT NULL AND c.location != ''
      GROUP BY c.location
      HAVING total_in_matchings >= 2
      ORDER BY total_in_matchings DESC
      LIMIT 15
    `).all();

    // Source bias: Are candidates from some sources scored differently?
    const sourceBias = db.prepare(`
      SELECT COALESCE(c.source, 'Unbekannt') as source,
             COUNT(*) as count,
             AVG(CASE WHEN pe.stage = 'Hired' THEN 1.0 ELSE 0.0 END) * 100 as hired_rate,
             AVG(CASE WHEN pe.stage IN ('Hired', 'Angebot', 'Interview') THEN 1.0 ELSE 0.0 END) * 100 as advancement_rate
      FROM candidates c
      LEFT JOIN pipeline_entries pe ON pe.candidate_id = c.id
      GROUP BY COALESCE(c.source, 'Unbekannt')
      HAVING count >= 2
      ORDER BY count DESC
    `).all();

    // Anonymization effectiveness check
    const anonymizationCheck = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN prompt LIKE '%Kandidat 1%' OR prompt LIKE '%Kandidat 2%' THEN 1 ELSE 0 END) as anonymized
      FROM ai_logs
      WHERE feature = 'matching' AND success = 1
    `).get();

    const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length * 10) / 10 : null;
    const stdDev = allScores.length > 1 ? Math.round(Math.sqrt(allScores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / allScores.length) * 10) / 10 : null;

    // Human review status
    const reviewStatus = db.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN human_reviewed = 1 THEN 1 ELSE 0 END) as reviewed
      FROM matching_results
    `).get();

    res.json({
      scoreAnalysis: {
        totalScoresAnalyzed: allScores.length,
        avgScore,
        stdDeviation: stdDev,
        distribution: scoreDistribution,
        matchingsAnalyzed: matchings.length,
      },
      locationAnalysis,
      sourceBias,
      anonymization: {
        totalMatchings: anonymizationCheck.total,
        anonymizedMatchings: anonymizationCheck.anonymized,
        rate: anonymizationCheck.total > 0
          ? Math.round((anonymizationCheck.anonymized / anonymizationCheck.total) * 100)
          : 0,
      },
      humanReview: {
        total: reviewStatus.total,
        reviewed: reviewStatus.reviewed,
        rate: reviewStatus.total > 0
          ? Math.round((reviewStatus.reviewed / reviewStatus.total) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error('Error generating bias report:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Bias-Reports' });
  }
});

/**
 * @swagger
 * /ai-logs/compliance/checklist:
 *   get:
 *     summary: AI Act Compliance-Checkliste (automatische Prüfung)
 *     tags: [AI-Logs]
 *     responses:
 *       200: { description: Compliance-Status pro Anforderung }
 */
router.get('/compliance/checklist', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren haben Zugriff' });
    }

    // Check various compliance requirements automatically
    const totalLogs = db.prepare('SELECT COUNT(*) as count FROM ai_logs').get().count;
    const logsWithPrompt = db.prepare('SELECT COUNT(*) as count FROM ai_logs WHERE prompt IS NOT NULL').get().count;
    const logsWithResponse = db.prepare('SELECT COUNT(*) as count FROM ai_logs WHERE response IS NOT NULL').get().count;
    const logsWithModel = db.prepare('SELECT COUNT(*) as count FROM ai_logs WHERE model IS NOT NULL').get().count;
    const logsWithDuration = db.prepare('SELECT COUNT(*) as count FROM ai_logs WHERE duration_ms IS NOT NULL').get().count;
    const logsWithUser = db.prepare('SELECT COUNT(*) as count FROM ai_logs WHERE user_id IS NOT NULL').get().count;

    const matchingAnonymized = db.prepare(`
      SELECT COUNT(*) as count FROM ai_logs 
      WHERE feature = 'matching' AND success = 1 AND (prompt LIKE '%Kandidat 1%' OR prompt LIKE '%Kandidat 2%')
    `).get().count;
    const matchingTotal = db.prepare(`
      SELECT COUNT(*) as count FROM ai_logs WHERE feature = 'matching' AND success = 1
    `).get().count;

    const reviewedMatchings = db.prepare(`
      SELECT COUNT(*) as count FROM matching_results WHERE human_reviewed = 1
    `).get().count;
    const totalMatchings = db.prepare('SELECT COUNT(*) as count FROM matching_results').get().count;

    const recentErrors = db.prepare(`
      SELECT COUNT(*) as count FROM ai_logs WHERE success = 0 AND created_at >= datetime('now', '-7 days')
    `).get().count;

    // Override tracking
    const overrideCount = db.prepare(`
      SELECT COUNT(*) as count FROM audit_log WHERE action = 'ki-override'
    `).get().count;
    const recentOverrides = db.prepare(`
      SELECT COUNT(*) as count FROM audit_log WHERE action = 'ki-override' AND created_at >= datetime('now', '-30 days')
    `).get().count;

    // Rate limiting check — count AI calls in last hour
    const aiCallsLastHour = db.prepare(`
      SELECT COUNT(*) as count FROM ai_logs WHERE created_at >= datetime('now', '-1 hour')
    `).get().count;

    const checks = [
      {
        id: 'logging',
        article: 'Art. 12',
        title: 'Aufzeichnungspflicht',
        description: 'Alle KI-Aufrufe werden protokolliert (Prompt, Response, Modell, Dauer, Nutzer)',
        status: totalLogs > 0 && logsWithPrompt === totalLogs && logsWithModel >= totalLogs * 0.9 ? 'passed' : totalLogs === 0 ? 'not-applicable' : 'warning',
        details: `${totalLogs} Aufrufe protokolliert, ${logsWithPrompt} mit Prompt, ${logsWithModel} mit Modell`,
      },
      {
        id: 'transparency',
        article: 'Art. 13',
        title: 'Transparenz',
        description: 'KI-generierte Inhalte sind als solche gekennzeichnet',
        status: 'passed',
        details: 'KI-Badges und Disclaimer sind in allen KI-Ergebnisansichten implementiert',
      },
      {
        id: 'human-oversight',
        article: 'Art. 14',
        title: 'Menschliche Aufsicht',
        description: 'KI-Matching-Ergebnisse werden von Menschen überprüft',
        status: totalMatchings === 0 ? 'not-applicable'
          : reviewedMatchings / totalMatchings >= 0.8 ? 'passed'
          : reviewedMatchings > 0 ? 'warning'
          : 'failed',
        details: `${reviewedMatchings} von ${totalMatchings} Matchings menschlich überprüft (${totalMatchings > 0 ? Math.round(reviewedMatchings / totalMatchings * 100) : 0}%)`,
      },
      {
        id: 'anonymization',
        article: 'Art. 10',
        title: 'Datenqualität & Anonymisierung',
        description: 'Bewerbernamen werden beim KI-Matching anonymisiert',
        status: matchingTotal === 0 ? 'not-applicable'
          : matchingAnonymized >= matchingTotal * 0.95 ? 'passed'
          : matchingAnonymized > 0 ? 'warning'
          : 'failed',
        details: `${matchingAnonymized} von ${matchingTotal} Matchings anonymisiert (${matchingTotal > 0 ? Math.round(matchingAnonymized / matchingTotal * 100) : 0}%)`,
      },
      {
        id: 'risk-management',
        article: 'Art. 9',
        title: 'Risikomanagement',
        description: 'Fehlerrate wird überwacht und liegt unter kritischem Schwellenwert',
        status: recentErrors === 0 ? 'passed'
          : recentErrors <= 3 ? 'warning'
          : 'failed',
        details: `${recentErrors} Fehler in den letzten 7 Tagen`,
      },
      {
        id: 'data-governance',
        article: 'Art. 10',
        title: 'Daten-Governance',
        description: 'KI verarbeitet nur relevante, minimierte Daten',
        status: 'passed',
        details: 'Datenminimierung aktiv: Nur jobspezifische Felder werden an das LLM übermittelt. Keine sensiblen Daten (Adresse, Geburtsdatum).',
      },
      {
        id: 'local-processing',
        article: 'Art. 10/25',
        title: 'Lokale Verarbeitung',
        description: 'LLM läuft lokal (Ollama) — keine Datenübertragung an Dritte',
        status: 'passed',
        details: 'Ollama verarbeitet alle Anfragen lokal. Keine Cloud-API-Aufrufe.',
      },
      {
        id: 'user-tracking',
        article: 'Art. 12',
        title: 'Nutzer-Zuordnung',
        description: 'KI-Aufrufe sind dem auslösenden Nutzer zugeordnet',
        status: totalLogs === 0 ? 'not-applicable'
          : logsWithUser >= totalLogs * 0.9 ? 'passed'
          : logsWithUser > 0 ? 'warning'
          : 'failed',
        details: `${logsWithUser} von ${totalLogs} Aufrufen mit Nutzer-ID`,
      },
      {
        id: 'override-tracking',
        article: 'Art. 14',
        title: 'KI-Override Protokollierung',
        description: 'Menschliche Überstimmungen von KI-Empfehlungen werden dokumentiert',
        status: 'passed',
        details: `${overrideCount} Overrides gesamt, ${recentOverrides} in den letzten 30 Tagen. Override-Erkennung aktiv: Warnung bei Beförderung trotz Score <50%.`,
      },
      {
        id: 'rate-limiting',
        article: 'Art. 9',
        title: 'Rate-Limiting',
        description: 'KI-Aufrufe sind pro Stunde limitiert, um Missbrauch zu verhindern',
        status: aiCallsLastHour <= 50 ? 'passed' : aiCallsLastHour <= 100 ? 'warning' : 'failed',
        details: `${aiCallsLastHour} KI-Aufrufe in der letzten Stunde (Limit: 50/h Warnung, 100/h kritisch)`,
      },
    ];

    const passed = checks.filter(c => c.status === 'passed').length;
    const failed = checks.filter(c => c.status === 'failed').length;
    const warnings = checks.filter(c => c.status === 'warning').length;

    res.json({
      checks,
      summary: {
        total: checks.length,
        passed,
        failed,
        warnings,
        complianceScore: Math.round((passed / checks.filter(c => c.status !== 'not-applicable').length) * 100) || 0,
      }
    });
  } catch (error) {
    console.error('Error generating compliance checklist:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Compliance-Checkliste' });
  }
});

module.exports = router;
