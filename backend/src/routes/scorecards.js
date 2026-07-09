const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');
const { generatorRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');
const { getAiConfig, stripReasoningTags, resolveAiProvider, buildAiRequest, extractAiText, pingAiService } = require('../aiConfig');

const router = express.Router();

// Helper for AI logging (same pattern as jobs.js)
function logAiCall(data) {
  try {
    db.prepare(`INSERT INTO ai_logs (user_id, feature, model, prompt, response, parsed_result, duration_ms, input_tokens, output_tokens, success, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      data.userId || null, data.feature || 'scorecards', data.model || null,
      data.prompt || null, data.response || null,
      data.parsedResult ? JSON.stringify(data.parsedResult) : null,
      data.durationMs || null, data.inputTokens || null, data.outputTokens || null,
      data.success ? 1 : 0, data.errorMessage || null
    );
  } catch (err) { console.error('AI log error:', err.message); }
}

/**
 * @swagger
 * /scorecards/templates:
 *   get:
 *     summary: Alle Scorecard-Templates (optional gefiltert nach Job)
 *     tags: [Scorecards]
 *     parameters:
 *       - in: query
 *         name: job_id
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Liste der Templates }
 */
router.get('/templates', (req, res) => {
  try {
    const { job_id } = req.query;
    let templates;
    if (job_id) {
      templates = db.prepare(`
        SELECT st.*, j.title as job_title 
        FROM scorecard_templates st 
        LEFT JOIN jobs j ON j.id = st.job_id
        WHERE st.job_id = ? OR st.job_id IS NULL
        ORDER BY st.created_at DESC
      `).all(job_id);
    } else {
      templates = db.prepare(`
        SELECT st.*, j.title as job_title 
        FROM scorecard_templates st 
        LEFT JOIN jobs j ON j.id = st.job_id
        ORDER BY st.created_at DESC
      `).all();
    }
    // Parse questions JSON
    templates = templates.map(t => ({ ...t, questions: JSON.parse(t.questions || '[]') }));
    res.json({ data: templates });
  } catch (err) {
    console.error('Error fetching templates:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Templates' });
  }
});

/**
 * @swagger
 * /scorecards/templates/{id}:
 *   get:
 *     summary: Einzelnes Template laden
 *     tags: [Scorecards]
 */
router.get('/templates/:id', (req, res) => {
  try {
    const template = db.prepare(`
      SELECT st.*, j.title as job_title 
      FROM scorecard_templates st 
      LEFT JOIN jobs j ON j.id = st.job_id
      WHERE st.id = ?
    `).get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template nicht gefunden' });
    template.questions = JSON.parse(template.questions || '[]');
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden des Templates' });
  }
});

/**
 * @swagger
 * /scorecards/templates:
 *   post:
 *     summary: Neues Scorecard-Template erstellen
 *     tags: [Scorecards]
 */
router.post('/templates', (req, res) => {
  try {
    const { job_id, title, questions, ai_generated } = req.body;
    if (!title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    
    const result = db.prepare(
      'INSERT INTO scorecard_templates (job_id, title, questions, ai_generated, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(job_id || null, title, JSON.stringify(questions || []), ai_generated ? 1 : 0, req.user?.id || null);
    
    logAudit(req, 'scorecard-template-erstellt', 'ScorecardTemplate', result.lastInsertRowid, title, { job_id, questionCount: (questions || []).length });
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) {
    console.error('Error creating template:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Templates' });
  }
});

/**
 * @swagger
 * /scorecards/templates/{id}:
 *   put:
 *     summary: Template aktualisieren
 *     tags: [Scorecards]
 */
router.put('/templates/:id', (req, res) => {
  try {
    const { title, questions } = req.body;
    db.prepare('UPDATE scorecard_templates SET title = ?, questions = ? WHERE id = ?')
      .run(title, JSON.stringify(questions || []), req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Templates' });
  }
});

/**
 * @swagger
 * /scorecards/templates/{id}:
 *   delete:
 *     summary: Template löschen
 *     tags: [Scorecards]
 */
router.delete('/templates/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM scorecard_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen des Templates' });
  }
});

/**
 * @swagger
 * /scorecards/responses:
 *   get:
 *     summary: Bewertungen laden (nach Kandidat oder Interview)
 *     tags: [Scorecards]
 *     parameters:
 *       - { in: query, name: candidate_id, schema: { type: integer } }
 *       - { in: query, name: interview_id, schema: { type: integer } }
 *       - { in: query, name: template_id, schema: { type: integer } }
 */
router.get('/responses', (req, res) => {
  try {
    const { candidate_id, interview_id, template_id } = req.query;
    const conditions = [];
    const params = [];
    
    if (candidate_id) { conditions.push('sr.candidate_id = ?'); params.push(candidate_id); }
    if (interview_id) { conditions.push('sr.interview_id = ?'); params.push(interview_id); }
    if (template_id) { conditions.push('sr.template_id = ?'); params.push(template_id); }
    
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    let responses = db.prepare(`
      SELECT sr.*, st.title as template_title, st.questions as template_questions,
        c.name as candidate_name
      FROM scorecard_responses sr
      JOIN scorecard_templates st ON st.id = sr.template_id
      JOIN candidates c ON c.id = sr.candidate_id
      ${where}
      ORDER BY sr.created_at DESC
    `).all(...params);
    
    responses = responses.map(r => ({
      ...r,
      answers: JSON.parse(r.answers || '[]'),
      template_questions: JSON.parse(r.template_questions || '[]'),
    }));
    
    res.json({ data: responses });
  } catch (err) {
    console.error('Error fetching responses:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Bewertungen' });
  }
});

/**
 * @swagger
 * /scorecards/responses:
 *   post:
 *     summary: Neue Scorecard-Bewertung abgeben
 *     tags: [Scorecards]
 */
router.post('/responses', (req, res) => {
  try {
    const { template_id, interview_id, pipeline_entry_id, candidate_id, evaluator_name, answers, notes } = req.body;
    if (!template_id || !candidate_id || !evaluator_name) {
      return res.status(400).json({ error: 'Template, Kandidat und Bewerter-Name sind erforderlich' });
    }

    // Fachbereich: only submit scorecards for candidates in their assigned jobs
    if (req.user?.role === 'fachbereich') {
      const inPipeline = db.prepare(`
        SELECT 1 FROM pipeline_entries pe
        JOIN user_job_access uja ON uja.job_id = pe.job_id
        WHERE pe.candidate_id = ? AND uja.user_id = ?
      `).get(candidate_id, req.user.id);
      if (!inPipeline) return res.status(403).json({ error: 'Kein Zugriff auf diesen Bewerber' });
    }
    
    // Calculate total score (average of all answer scores)
    const answerList = answers || [];
    const scores = answerList.map(a => a.score).filter(s => typeof s === 'number');
    const total_score = scores.length > 0 ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100 : null;
    
    const result = db.prepare(
      'INSERT INTO scorecard_responses (template_id, interview_id, pipeline_entry_id, candidate_id, evaluator_name, answers, total_score, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(template_id, interview_id || null, pipeline_entry_id || null, candidate_id, evaluator_name, JSON.stringify(answerList), total_score, notes || null);
    
    logAudit(req, 'scorecard-bewertet', 'ScorecardResponse', result.lastInsertRowid, evaluator_name, {
      template_id, candidate_id, total_score,
    });
    
    res.json({ id: result.lastInsertRowid, total_score, success: true });
  } catch (err) {
    console.error('Error creating response:', err);
    res.status(500).json({ error: 'Fehler beim Speichern der Bewertung' });
  }
});

/**
 * @swagger
 * /scorecards/responses/{id}:
 *   delete:
 *     summary: Bewertung löschen
 *     tags: [Scorecards]
 */
router.delete('/responses/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM scorecard_responses WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen der Bewertung' });
  }
});

/**
 * @swagger
 * /scorecards/responses/compare:
 *   get:
 *     summary: Bewertungsvergleich pro Kandidat (alle Interviewer)
 *     tags: [Scorecards]
 *     parameters:
 *       - { in: query, name: candidate_id, required: true, schema: { type: integer } }
 */
router.get('/responses/compare', (req, res) => {
  try {
    const { candidate_id } = req.query;
    if (!candidate_id) return res.status(400).json({ error: 'candidate_id ist erforderlich' });
    
    let responses = db.prepare(`
      SELECT sr.*, st.title as template_title, st.questions as template_questions
      FROM scorecard_responses sr
      JOIN scorecard_templates st ON st.id = sr.template_id
      WHERE sr.candidate_id = ?
      ORDER BY sr.created_at ASC
    `).all(candidate_id);
    
    responses = responses.map(r => ({
      ...r,
      answers: JSON.parse(r.answers || '[]'),
      template_questions: JSON.parse(r.template_questions || '[]'),
    }));
    
    // Calculate average per question across all evaluators
    const questionAverages = {};
    for (const resp of responses) {
      for (const ans of resp.answers) {
        const key = ans.question || ans.questionIndex;
        if (!questionAverages[key]) questionAverages[key] = { question: ans.question, scores: [] };
        if (typeof ans.score === 'number') questionAverages[key].scores.push(ans.score);
      }
    }
    const averages = Object.values(questionAverages).map(q => ({
      question: q.question,
      avgScore: q.scores.length > 0 ? Math.round((q.scores.reduce((s, v) => s + v, 0) / q.scores.length) * 100) / 100 : null,
      evaluations: q.scores.length,
    }));
    
    const overallAvg = responses.length > 0
      ? Math.round((responses.reduce((s, r) => s + (r.total_score || 0), 0) / responses.length) * 100) / 100
      : null;
    
    res.json({ responses, averages, overallAverage: overallAvg, evaluatorCount: responses.length });
  } catch (err) {
    console.error('Error comparing responses:', err);
    res.status(500).json({ error: 'Fehler beim Laden des Vergleichs' });
  }
});

/**
 * @swagger
 * /scorecards/generate-questions:
 *   post:
 *     summary: KI-generierte Interviewfragen basierend auf Stelle + Kandidatenprofil
 *     tags: [Scorecards]
 */
router.post('/generate-questions', generatorRateLimiter, promptGuard('interview-questions'), async (req, res) => {
  try {
    const { job_id, candidate_id, question_count } = req.body;
    
    // Load job and candidate data
    const job = job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id) : null;
    const candidate = candidate_id ? db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id) : null;
    
    if (!job && !candidate) {
      return res.status(400).json({ error: 'Mindestens eine Stelle oder ein Kandidat ist erforderlich' });
    }
    
    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: PROVIDER_CFG } = getAiConfig();
    const count = Math.min(Math.max(3, parseInt(question_count) || 8), 15);
    
    const prompt = `Du bist ein erfahrener HR-Experte und Interviewer. Erstelle ${count} strukturierte Interviewfragen.

${job ? `STELLE:
- Titel: ${job.title}
- Beschreibung: ${job.description || 'Nicht angegeben'}
- Anforderungen: ${job.requirements || 'Nicht angegeben'}
- Standort: ${job.location || 'Nicht angegeben'}` : ''}

${candidate ? `KANDIDAT:
- Name: ${candidate.name}
- Skills: ${candidate.skills || 'Nicht angegeben'}
- Erfahrung: ${candidate.experience || 'Nicht angegeben'}
- Ausbildung: ${candidate.education || 'Nicht angegeben'}` : ''}

Erstelle Fragen in diesen Kategorien:
- Fachkompetenz (technische Fragen passend zu den Anforderungen)
- Soft Skills (Teamarbeit, Kommunikation, Problemlösung)
- Motivation & Kulturfit (Warum diese Stelle/Firma)
- Erfahrungsbezogen (Situation-Task-Action-Result Format)

Antworte NUR mit diesem exakten JSON-Format (ohne Markdown):
{"questions": [{"text": "Frage hier", "category": "Fachkompetenz|Soft Skills|Motivation|Erfahrung", "hint": "Worauf bei der Antwort achten"}]}`;

    // Check AI host reachability
    const aiProvider = await resolveAiProvider(OLLAMA_URL, PROVIDER_CFG);
    const { url: aiUrl, body: aiBody } = buildAiRequest({
      baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, provider: aiProvider,
      prompt, format: 'json', options: { temperature: 0.7, num_predict: 6144 },
    });
    try {
      await pingAiService(OLLAMA_URL, aiProvider, 5000);
    } catch (pingErr) {
      return res.status(502).json({ error: 'KI-Host ist nicht erreichbar. Bitte sicherstellen, dass der KI-Server läuft.' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    const startTime = Date.now();

    let response;
    try {
      response = await fetch(aiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiBody),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      logAiCall({
        userId: req.user?.id, feature: 'interview-questions', model: OLLAMA_MODEL,
        prompt, durationMs: Date.now() - startTime, success: false,
        errorMessage: fetchErr.name === 'AbortError' ? 'Timeout >180s' : fetchErr.message,
      });
      if (fetchErr.name === 'AbortError') {
        return res.status(504).json({ error: 'Timeout: Die Generierung hat zu lange gedauert.' });
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      logAiCall({
        userId: req.user?.id, feature: 'interview-questions', model: OLLAMA_MODEL,
        prompt, response: errText, durationMs: Date.now() - startTime, success: false,
        errorMessage: `KI-Status ${response.status}`,
      });
      return res.status(502).json({ error: 'KI-Fehler: ' + errText });
    }

    const data = await response.json();
    const { text: responseText, promptTokens: inputTokens, evalTokens: outputTokens } = extractAiText(data, aiProvider);
    const duration = Date.now() - startTime;

    // Parse JSON from response
    let questions = [];
    try {
      const cleanText = stripReasoningTags(responseText);
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        questions = Array.isArray(parsed.questions) ? parsed.questions : 
          Array.isArray(parsed.fragen) ? parsed.fragen : [];
      }
    } catch (parseErr) {
      console.warn('JSON parse error:', parseErr.message);
      // Fallback: try to extract questions from raw text
      const lines = responseText.split('\n').filter(l => l.trim().match(/^\d+[\.\)]/));
      questions = lines.map(l => ({ text: l.replace(/^\d+[\.\)]\s*/, '').trim(), category: 'Allgemein', hint: '' }));
    }

    // Ensure each question has required fields
    questions = questions.map((q, i) => ({
      text: q.text || q.frage || q.question || `Frage ${i + 1}`,
      category: q.category || q.kategorie || 'Allgemein',
      hint: q.hint || q.hinweis || '',
    }));

    logAiCall({
      userId: req.user?.id, feature: 'interview-questions', model: OLLAMA_MODEL,
      prompt, response: responseText,
      parsedResult: { questionCount: questions.length },
      durationMs: duration, inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null, success: true,
    });

    logAudit(req, 'ki-interviewfragen-generiert', 'Scorecard', null, job?.title || 'Allgemein', {
      model: OLLAMA_MODEL, questionCount: questions.length, candidate: candidate?.name,
    });

    res.json({ questions, model: OLLAMA_MODEL });
  } catch (err) {
    console.error('Error generating questions:', err);
    res.status(500).json({ error: 'Fehler bei der KI-Generierung' });
  }
});

module.exports = router;
