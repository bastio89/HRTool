const express = require('express');
const db = require('../database');

const router = express.Router();

// POST trigger matching
router.post('/run', async (req, res) => {
  try {
    const { jobDescription, jobTitle, candidateIds } = req.body;

    if (!jobDescription || jobDescription.trim() === '') {
      return res.status(400).json({ error: 'Stellenbeschreibung ist erforderlich' });
    }

    // Get candidates - either specific ones or all
    let candidates;
    if (candidateIds && candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => '?').join(',');
      candidates = db.prepare(`SELECT * FROM candidates WHERE id IN (${placeholders})`).all(...candidateIds);
    } else {
      candidates = db.prepare('SELECT * FROM candidates').all();
    }

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'Keine Bewerber vorhanden' });
    }

    // Call n8n webhook for matching
    const webhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/hr-matching';
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobDescription,
        jobTitle: jobTitle || 'Unbenannte Stelle',
        candidates: candidates.map(c => ({
          id: c.id,
          name: c.name,
          experience: c.experience,
          skills: c.skills,
          education: c.education,
          languages: c.languages,
          certificates: c.certificates,
          location: c.location,
          desired_salary: c.desired_salary,
          availability: c.availability,
          drivers_license: c.drivers_license,
          mobility: c.mobility
        }))
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('n8n webhook error:', response.status, errText);
      return res.status(502).json({ 
        error: 'n8n Workflow fehlgeschlagen',
        details: `Status ${response.status}: ${errText}`
      });
    }

    const matchingResults = await response.json();

    // Save results
    const saveResult = db.prepare(`
      INSERT INTO matching_results (job_description, job_title, results)
      VALUES (?, ?, ?)
    `).run(jobDescription, jobTitle || 'Unbenannte Stelle', JSON.stringify(matchingResults));

    res.json({
      id: saveResult.lastInsertRowid,
      jobTitle: jobTitle || 'Unbenannte Stelle',
      results: matchingResults,
      candidateCount: candidates.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error running matching:', error);
    res.status(500).json({ 
      error: 'Fehler beim Matching',
      details: error.message
    });
  }
});

// GET matching history
router.get('/history', (req, res) => {
  try {
    const results = db.prepare(
      'SELECT id, job_title, created_at, results FROM matching_results ORDER BY created_at DESC LIMIT 50'
    ).all();
    
    const parsed = results.map(r => ({
      ...r,
      results: JSON.parse(r.results),
    }));
    
    res.json({ data: parsed });
  } catch (error) {
    console.error('Error fetching matching history:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Historie' });
  }
});

// GET single matching result
router.get('/history/:id', (req, res) => {
  try {
    const result = db.prepare('SELECT * FROM matching_results WHERE id = ?').get(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
    }
    res.json({ ...result, results: JSON.parse(result.results) });
  } catch (error) {
    console.error('Error fetching matching result:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Ergebnisses' });
  }
});

// DELETE matching result
router.delete('/history/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM matching_results WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
    }
    db.prepare('DELETE FROM matching_results WHERE id = ?').run(req.params.id);
    res.json({ message: 'Ergebnis gelöscht' });
  } catch (error) {
    console.error('Error deleting result:', error);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

module.exports = router;
