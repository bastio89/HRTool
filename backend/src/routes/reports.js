const express = require('express');
const db = require('../database');

const router = express.Router();

// ═══════════════════════════════════════
// Recruiting KPIs / Dashboard Reports
// ═══════════════════════════════════════

// GET /reports/overview — Überblick-KPIs
router.get('/overview', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const dateFilter = `datetime('now', '-${days} days')`;

    const candidates = db.prepare(`SELECT COUNT(*) as total FROM candidates`).get().total;
    const newCandidates = db.prepare(`SELECT COUNT(*) as c FROM candidates WHERE created_at >= ${dateFilter}`).get().c;
    const activeJobs = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'Offen'`).get().c;
    const totalJobs = db.prepare(`SELECT COUNT(*) as c FROM jobs`).get().c;
    const pipelineEntries = db.prepare(`SELECT COUNT(*) as c FROM pipeline_entries`).get().c;

    // Pipeline stage distribution
    const stages = db.prepare(`
      SELECT stage, COUNT(*) as count FROM pipeline_entries GROUP BY stage ORDER BY count DESC
    `).all();

    // Hire rate
    const hiredCount = db.prepare(`SELECT COUNT(*) as c FROM pipeline_entries WHERE stage = 'Hired'`).get().c;
    const recentHires = db.prepare(`SELECT COUNT(*) as c FROM pipeline_entries WHERE stage = 'Hired' AND updated_at >= ${dateFilter}`).get().c;

    // Interview count
    const interviewCount = db.prepare(`SELECT COUNT(*) as c FROM interviews WHERE created_at >= ${dateFilter}`).get().c;

    // Emails sent
    const emailsSent = db.prepare(`SELECT COUNT(*) as c FROM email_log WHERE created_at >= ${dateFilter}`).get().c;

    // AI usage
    const aiCalls = db.prepare(`SELECT COUNT(*) as c FROM ai_logs WHERE created_at >= ${dateFilter}`).get().c;

    res.json({
      period: { days },
      candidates: { total: candidates, new: newCandidates },
      jobs: { total: totalJobs, active: activeJobs },
      pipeline: { totalEntries: pipelineEntries, stages, hired: hiredCount, recentHires },
      interviews: { count: interviewCount },
      emails: { sent: emailsSent },
      ai: { calls: aiCalls },
    });
  } catch (error) {
    console.error('Error generating overview report:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Übersicht' });
  }
});

// GET /reports/pipeline-funnel?job_id=1
router.get('/pipeline-funnel', (req, res) => {
  try {
    const { job_id } = req.query;
    const stageOrder = ['Beworben', 'Screening', 'Interview', 'Angebot', 'Hired', 'Abgesagt'];

    let rows;
    if (job_id) {
      rows = db.prepare(`
        SELECT stage, COUNT(*) as count FROM pipeline_entries WHERE job_id = ? GROUP BY stage
      `).all(job_id);
    } else {
      rows = db.prepare(`SELECT stage, COUNT(*) as count FROM pipeline_entries GROUP BY stage`).all();
    }

    const funnel = stageOrder.map(s => {
      const found = rows.find(r => r.stage === s);
      return { stage: s, count: found ? found.count : 0 };
    });

    // Calculate conversion rates
    const withRates = funnel.map((step, i) => ({
      ...step,
      conversionRate: i === 0 ? 100 : (funnel[0].count > 0 ? Math.round((step.count / funnel[0].count) * 100) : 0),
      stepRate: i === 0 ? 100 : (funnel[i - 1].count > 0 ? Math.round((step.count / funnel[i - 1].count) * 100) : 0),
    }));

    res.json({ funnel: withRates, jobId: job_id || null });
  } catch (error) {
    console.error('Error generating pipeline funnel:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Pipeline-Funnels' });
  }
});

// GET /reports/time-to-hire
router.get('/time-to-hire', (req, res) => {
  try {
    // Calculate time from pipeline entry creation to Hired status
    const hired = db.prepare(`
      SELECT pe.id, pe.job_id, pe.candidate_id, pe.created_at as entered_at, pe.updated_at as hired_at,
             j.title as job_title, c.name as candidate_name,
             ROUND(julianday(pe.updated_at) - julianday(pe.created_at)) as days_to_hire
      FROM pipeline_entries pe
      LEFT JOIN jobs j ON j.id = pe.job_id
      LEFT JOIN candidates c ON c.id = pe.candidate_id
      WHERE pe.stage = 'Hired'
      ORDER BY pe.updated_at DESC
      LIMIT 50
    `).all();

    const days = hired.map(h => h.days_to_hire).filter(d => d >= 0);
    const avgDays = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
    const medianDays = days.length > 0 ? days.sort((a, b) => a - b)[Math.floor(days.length / 2)] : null;

    // By job
    const byJob = db.prepare(`
      SELECT j.title as job_title, j.id as job_id,
             COUNT(*) as hires,
             ROUND(AVG(julianday(pe.updated_at) - julianday(pe.created_at))) as avg_days
      FROM pipeline_entries pe
      LEFT JOIN jobs j ON j.id = pe.job_id
      WHERE pe.stage = 'Hired'
      GROUP BY pe.job_id
      ORDER BY avg_days ASC
    `).all();

    // Monthly trend
    const monthlyTrend = db.prepare(`
      SELECT strftime('%Y-%m', pe.updated_at) as month,
             COUNT(*) as hires,
             ROUND(AVG(julianday(pe.updated_at) - julianday(pe.created_at))) as avg_days
      FROM pipeline_entries pe
      WHERE pe.stage = 'Hired'
      GROUP BY strftime('%Y-%m', pe.updated_at)
      ORDER BY month DESC
      LIMIT 12
    `).all();

    res.json({
      summary: { avgDays, medianDays, totalHires: hired.length },
      recentHires: hired.slice(0, 20),
      byJob,
      monthlyTrend,
    });
  } catch (error) {
    console.error('Error generating time-to-hire:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Time-to-Hire-Reports' });
  }
});

// GET /reports/source-effectiveness
router.get('/source-effectiveness', (req, res) => {
  try {
    const sources = db.prepare(`
      SELECT COALESCE(c.source, 'Unbekannt') as source,
             COUNT(DISTINCT c.id) as total_candidates,
             COUNT(DISTINCT pe.id) as in_pipeline,
             SUM(CASE WHEN pe.stage = 'Interview' THEN 1 ELSE 0 END) as interviews,
             SUM(CASE WHEN pe.stage = 'Angebot' THEN 1 ELSE 0 END) as offers,
             SUM(CASE WHEN pe.stage = 'Hired' THEN 1 ELSE 0 END) as hires
      FROM candidates c
      LEFT JOIN pipeline_entries pe ON pe.candidate_id = c.id
      GROUP BY COALESCE(c.source, 'Unbekannt')
      ORDER BY total_candidates DESC
    `).all();

    const enriched = sources.map(s => ({
      ...s,
      pipelineRate: s.total_candidates > 0 ? Math.round((s.in_pipeline / s.total_candidates) * 100) : 0,
      interviewRate: s.in_pipeline > 0 ? Math.round((s.interviews / s.in_pipeline) * 100) : 0,
      hireRate: s.in_pipeline > 0 ? Math.round((s.hires / s.in_pipeline) * 100) : 0,
    }));

    res.json(enriched);
  } catch (error) {
    console.error('Error generating source report:', error);
    res.status(500).json({ error: 'Fehler' });
  }
});

// GET /reports/activity-timeline
router.get('/activity-timeline', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const timeline = db.prepare(`
      SELECT date(created_at) as date,
             'candidate' as type,
             COUNT(*) as count
      FROM candidates
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      UNION ALL
      SELECT date(created_at) as date,
             'pipeline' as type,
             COUNT(*) as count
      FROM pipeline_entries
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      UNION ALL
      SELECT date(created_at) as date,
             'interview' as type,
             COUNT(*) as count
      FROM interviews
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      UNION ALL
      SELECT date(created_at) as date,
             'email' as type,
             COUNT(*) as count
      FROM email_log
      WHERE created_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all(days, days, days, days);

    // Pivot to date-based structure
    const dateMap = {};
    for (const row of timeline) {
      if (!dateMap[row.date]) dateMap[row.date] = { date: row.date, candidates: 0, pipeline: 0, interviews: 0, emails: 0 };
      if (row.type === 'candidate') dateMap[row.date].candidates = row.count;
      if (row.type === 'pipeline') dateMap[row.date].pipeline = row.count;
      if (row.type === 'interview') dateMap[row.date].interviews = row.count;
      if (row.type === 'email') dateMap[row.date].emails = row.count;
    }

    res.json(Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date)));
  } catch (error) {
    console.error('Error generating activity timeline:', error);
    res.status(500).json({ error: 'Fehler' });
  }
});

// GET /reports/team-performance
router.get('/team-performance', (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Nur Administratoren' });
    }

    const days = parseInt(req.query.days) || 30;

    // Activities per user
    const userActivity = db.prepare(`
      SELECT u.id, u.display_name, u.username,
             (SELECT COUNT(*) FROM audit_log al WHERE al.user_id = u.id AND al.created_at >= datetime('now', '-' || ? || ' days')) as actions,
             (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id AND c.created_at >= datetime('now', '-' || ? || ' days')) as comments,
             (SELECT COUNT(*) FROM ai_logs ail WHERE ail.user_id = u.id AND ail.created_at >= datetime('now', '-' || ? || ' days')) as ai_calls
      FROM users u
      ORDER BY actions DESC
    `).all(days, days, days);

    res.json(userActivity);
  } catch (error) {
    console.error('Error generating team performance:', error);
    res.status(500).json({ error: 'Fehler' });
  }
});

// GET /reports/export/csv?type=pipeline|candidates|time-to-hire
router.get('/export/csv', (req, res) => {
  try {
    const { type } = req.query;
    let rows = [];
    let headers = [];
    let filename = 'export';

    if (type === 'pipeline') {
      headers = ['Job', 'Kandidat', 'Stage', 'Eingetragen am', 'Aktualisiert am'];
      rows = db.prepare(`
        SELECT j.title as job, c.name as kandidat, pe.stage, pe.created_at, pe.updated_at
        FROM pipeline_entries pe
        LEFT JOIN jobs j ON j.id = pe.job_id
        LEFT JOIN candidates c ON c.id = pe.candidate_id
        ORDER BY pe.updated_at DESC
      `).all();
      rows = rows.map(r => [r.job, r.kandidat, r.stage, r.created_at, r.updated_at]);
      filename = 'pipeline-export';
    } else if (type === 'candidates') {
      headers = ['Name', 'E-Mail', 'Standort', 'Skills', 'Status', 'Erstellt am'];
      rows = db.prepare('SELECT name, email, location, skills, status, created_at FROM candidates ORDER BY created_at DESC').all();
      rows = rows.map(r => [r.name, r.email, r.location, r.skills, r.status, r.created_at]);
      filename = 'kandidaten-export';
    } else if (type === 'time-to-hire') {
      headers = ['Job', 'Kandidat', 'Eingetragen am', 'Eingestellt am', 'Tage'];
      rows = db.prepare(`
        SELECT j.title as job, c.name as kandidat, pe.created_at, pe.updated_at,
               ROUND(julianday(pe.updated_at) - julianday(pe.created_at)) as tage
        FROM pipeline_entries pe
        LEFT JOIN jobs j ON j.id = pe.job_id
        LEFT JOIN candidates c ON c.id = pe.candidate_id
        WHERE pe.stage = 'Hired'
        ORDER BY pe.updated_at DESC
      `).all();
      rows = rows.map(r => [r.job, r.kandidat, r.created_at, r.updated_at, r.tage]);
      filename = 'time-to-hire-export';
    } else {
      return res.status(400).json({ error: 'Unbekannter Export-Typ. Verfügbar: pipeline, candidates, time-to-hire' });
    }

    // Build CSV
    const escapeCsv = (val) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\ufeff' + csv); // BOM for Excel UTF-8
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ error: 'Export fehlgeschlagen' });
  }
});

module.exports = router;
