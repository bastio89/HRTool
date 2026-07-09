const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../database');
const { logAudit } = require('./audit');
const { logAiCall } = require('../aiLogger');
const { generatorRateLimiter } = require('../middleware/rateLimiter');
const { promptGuard } = require('../middleware/promptSanitizer');
const { getAiConfig, stripReasoningTags } = require('../aiConfig');

const router = express.Router();

// ─── Helper: Get SMTP settings from DB ───
function getSmtpSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key LIKE 'email_%'").all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

// ─── Helper: Check if stage trigger is enabled ───
function isStageTriggerEnabled(stage) {
  const key = `email_trigger_${stage}`;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  // Default: enabled (1) if no setting exists
  return !row || row.value !== '0';
}

// ─── Helper: Create Nodemailer transporter ───
function createTransporter(smtp) {
  if (!smtp.smtp_host || !smtp.smtp_user || !smtp.smtp_pass) {
    return null;
  }
  return nodemailer.createTransport({
    host: smtp.smtp_host,
    port: parseInt(smtp.smtp_port) || 587,
    secure: parseInt(smtp.smtp_port) === 465,
    auth: {
      user: smtp.smtp_user,
      pass: smtp.smtp_pass,
    },
    tls: { rejectUnauthorized: false },
  });
}

// ─── Helper: Build formal salutation from gender + name ───
function buildAnrede(gender, vorname, nachname) {
  if (gender === 'Frau') return `Sehr geehrte Frau ${nachname}`;
  if (gender === 'Herr') return `Sehr geehrter Herr ${nachname}`;
  // Divers or unknown: neutral greeting
  return nachname ? `Guten Tag ${vorname} ${nachname}` : `Guten Tag ${vorname}`;
}

// ─── Helper: Replace template variables ───
function resolveTemplate(text, vars) {
  return text
    .replace(/\{\{anrede\}\}/g, vars.anrede || '')
    .replace(/\{\{vorname\}\}/g, vars.vorname || '')
    .replace(/\{\{nachname\}\}/g, vars.nachname || '')
    .replace(/\{\{name\}\}/g, vars.name || '')
    .replace(/\{\{email\}\}/g, vars.email || '')
    .replace(/\{\{stelle\}\}/g, vars.stelle || '')
    .replace(/\{\{unternehmen\}\}/g, vars.unternehmen || '')
    .replace(/\{\{datum\}\}/g, new Date().toLocaleDateString('de-DE'));
}

// ─── Helper: Send email and log ───
async function sendEmailHelper({ candidateId, templateId, toEmail, subject, body, sentBy }) {
  const smtp = getSmtpSettings();
  const transporter = createTransporter(smtp);
  if (!transporter) {
    throw new Error('SMTP nicht konfiguriert. Bitte unter Administration → E-Mail die SMTP-Einstellungen hinterlegen.');
  }

  const fromName = smtp.smtp_from_name || smtp.email_company_name || 'HR-Tool';
  const fromEmail = smtp.smtp_user;

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: toEmail,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });

    db.prepare(`INSERT INTO email_log (candidate_id, template_id, to_email, subject, body, status, sent_by) VALUES (?, ?, ?, ?, ?, 'sent', ?)`)
      .run(candidateId || null, templateId || null, toEmail, subject, body, sentBy || 'system');

    return { success: true };
  } catch (err) {
    db.prepare(`INSERT INTO email_log (candidate_id, template_id, to_email, subject, body, status, error_message, sent_by) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`)
      .run(candidateId || null, templateId || null, toEmail, subject, body, err.message, sentBy || 'system');
    throw err;
  }
}

// ═══════════════════════════════════════
// SMTP Settings
// ═══════════════════════════════════════

/**
 * @swagger
 * /emails/smtp/settings:
 *   get:
 *     summary: SMTP-Einstellungen laden
 *     tags: [Email]
 *     responses:
 *       200: { description: SMTP-Konfiguration }
 */
router.get('/smtp/settings', (req, res) => {
  try {
    const smtp = getSmtpSettings();
    // Don't expose the password
    if (smtp.smtp_pass) smtp.smtp_pass = '••••••••';
    res.json(smtp);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der SMTP-Einstellungen' });
  }
});

/**
 * @swagger
 * /emails/smtp/settings:
 *   put:
 *     summary: SMTP-Einstellungen speichern
 *     tags: [Email]
 */
router.put('/smtp/settings', (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, email_company_name } = req.body;
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);

    if (smtp_host !== undefined) upsert.run('smtp_host', smtp_host);
    if (smtp_port !== undefined) upsert.run('smtp_port', String(smtp_port));
    if (smtp_user !== undefined) upsert.run('smtp_user', smtp_user);
    if (smtp_pass !== undefined && smtp_pass !== '••••••••') upsert.run('smtp_pass', smtp_pass);
    if (smtp_from_name !== undefined) upsert.run('smtp_from_name', smtp_from_name);
    if (email_company_name !== undefined) upsert.run('email_company_name', email_company_name);

    logAudit(req, 'smtp-konfiguriert', 'Setting', null, 'SMTP', { host: smtp_host });
    res.json({ success: true });
  } catch (err) {
    console.error('SMTP settings error:', err);
    res.status(500).json({ error: 'Fehler beim Speichern der SMTP-Einstellungen' });
  }
});

/**
 * @swagger
 * /emails/smtp/test:
 *   post:
 *     summary: SMTP-Verbindung testen
 *     tags: [Email]
 */
router.post('/smtp/test', async (req, res) => {
  try {
    const smtp = getSmtpSettings();
    const transporter = createTransporter(smtp);
    if (!transporter) {
      return res.status(400).json({ error: 'SMTP nicht konfiguriert' });
    }

    await transporter.verify();
    res.json({ success: true, message: 'SMTP-Verbindung erfolgreich' });
  } catch (err) {
    res.status(400).json({ success: false, error: `SMTP-Verbindung fehlgeschlagen: ${err.message}` });
  }
});

// ═══════════════════════════════════════
// Email Templates CRUD
// ═══════════════════════════════════════

/**
 * @swagger
 * /emails/templates:
 *   get:
 *     summary: Alle E-Mail-Templates laden
 *     tags: [Email]
 */
router.get('/templates', (req, res) => {
  try {
    const templates = db.prepare('SELECT * FROM email_templates ORDER BY name ASC').all();
    res.json({ data: templates });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Templates' });
  }
});

router.get('/templates/:id', (req, res) => {
  try {
    const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template nicht gefunden' });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden des Templates' });
  }
});

router.post('/templates', (req, res) => {
  try {
    const { name, subject, body, trigger_stage, is_active } = req.body;
    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'Name, Betreff und Text sind Pflichtfelder' });
    }
    const result = db.prepare(
      'INSERT INTO email_templates (name, subject, body, trigger_stage, is_active) VALUES (?, ?, ?, ?, ?)'
    ).run(name, subject, body, trigger_stage || null, is_active !== undefined ? is_active : 1);

    logAudit(req, 'template-erstellt', 'EmailTemplate', result.lastInsertRowid, name);
    res.status(201).json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Erstellen des Templates' });
  }
});

router.put('/templates/:id', (req, res) => {
  try {
    const { name, subject, body, trigger_stage, is_active } = req.body;
    db.prepare(`
      UPDATE email_templates SET name=?, subject=?, body=?, trigger_stage=?, is_active=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(name, subject, body, trigger_stage || null, is_active !== undefined ? is_active : 1, req.params.id);

    logAudit(req, 'template-bearbeitet', 'EmailTemplate', req.params.id, name);
    res.json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Templates' });
  }
});

router.delete('/templates/:id', (req, res) => {
  try {
    const tpl = db.prepare('SELECT name FROM email_templates WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
    logAudit(req, 'template-gelöscht', 'EmailTemplate', req.params.id, tpl?.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen des Templates' });
  }
});

// ═══════════════════════════════════════
// Send Email
// ═══════════════════════════════════════

/**
 * @swagger
 * /emails/send:
 *   post:
 *     summary: E-Mail an Kandidaten senden
 *     tags: [Email]
 */
router.post('/send', async (req, res) => {
  try {
    const { candidate_id, template_id, to_email, subject, body, job_title } = req.body;

    let finalTo = to_email;
    let finalSubject = subject;
    let finalBody = body;

    // If template is provided, load and resolve
    let candidate = null;
    if (candidate_id) {
      candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id);
    }

    if (template_id && !subject && !body) {
      const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(template_id);
      if (!tpl) return res.status(404).json({ error: 'Template nicht gefunden' });

      const smtp = getSmtpSettings();
      const nameParts = (candidate?.name || '').split(' ');
      const vorname = nameParts[0] || '';
      const nachname = nameParts.slice(1).join(' ') || '';
      const vars = {
        vorname,
        nachname,
        anrede: buildAnrede(candidate?.gender, vorname, nachname),
        name: candidate?.name || '',
        email: candidate?.email || '',
        stelle: job_title || '',
        unternehmen: smtp.email_company_name || 'Unser Unternehmen',
      };

      finalSubject = resolveTemplate(tpl.subject, vars);
      finalBody = resolveTemplate(tpl.body, vars);
    }

    if (!finalTo && candidate?.email) finalTo = candidate.email;
    if (!finalTo) return res.status(400).json({ error: 'Keine E-Mail-Adresse angegeben' });
    if (!finalSubject || !finalBody) return res.status(400).json({ error: 'Betreff und Text sind erforderlich' });

    await sendEmailHelper({
      candidateId: candidate_id,
      templateId: template_id,
      toEmail: finalTo,
      subject: finalSubject,
      body: finalBody,
      sentBy: req.user?.username || 'system',
    });

    // Log activity on candidate
    if (candidate_id) {
      db.prepare('INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)')
        .run(candidate_id, 'E-Mail', `E-Mail gesendet: "${finalSubject}" an ${finalTo}`);
    }

    logAudit(req, 'email-gesendet', 'Email', null, finalTo, { subject: finalSubject, candidate_id });
    res.json({ success: true, message: 'E-Mail erfolgreich gesendet' });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: `E-Mail konnte nicht gesendet werden: ${err.message}` });
  }
});

/**
 * @swagger
 * /emails/send-with-template:
 *   post:
 *     summary: E-Mail mit aufgelöstem Template senden
 *     tags: [Email]
 */
router.post('/send-with-template', async (req, res) => {
  try {
    const { candidate_id, template_id, job_title, custom_subject, custom_body } = req.body;
    if (!candidate_id) return res.status(400).json({ error: 'Kandidat erforderlich' });

    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id);
    if (!candidate) return res.status(404).json({ error: 'Kandidat nicht gefunden' });
    if (!candidate.email) return res.status(400).json({ error: 'Kandidat hat keine E-Mail-Adresse' });

    let finalSubject = custom_subject;
    let finalBody = custom_body;

    if (template_id) {
      const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(template_id);
      if (!tpl) return res.status(404).json({ error: 'Template nicht gefunden' });

      const smtp = getSmtpSettings();
      const nameParts = candidate.name.split(' ');
      const vorname = nameParts[0] || '';
      const nachname = nameParts.slice(1).join(' ') || '';
      const vars = {
        vorname,
        nachname,
        anrede: buildAnrede(candidate.gender, vorname, nachname),
        name: candidate.name,
        email: candidate.email,
        stelle: job_title || '',
        unternehmen: smtp.email_company_name || 'Unser Unternehmen',
      };

      if (!finalSubject) finalSubject = resolveTemplate(tpl.subject, vars);
      if (!finalBody) finalBody = resolveTemplate(tpl.body, vars);
    }

    if (!finalSubject || !finalBody) return res.status(400).json({ error: 'Betreff und Text erforderlich' });

    await sendEmailHelper({
      candidateId: candidate_id,
      templateId: template_id,
      toEmail: candidate.email,
      subject: finalSubject,
      body: finalBody,
      sentBy: req.user?.username || 'system',
    });

    db.prepare('INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)')
      .run(candidate_id, 'E-Mail', `E-Mail gesendet: "${finalSubject}" an ${candidate.email}`);

    logAudit(req, 'email-gesendet', 'Email', null, candidate.email, { subject: finalSubject, candidate_id });
    res.json({ success: true, message: 'E-Mail erfolgreich gesendet' });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: `E-Mail konnte nicht gesendet werden: ${err.message}` });
  }
});

// ═══════════════════════════════════════
// Preview (resolve template with candidate data)
// ═══════════════════════════════════════

router.post('/preview', (req, res) => {
  try {
    const { template_id, candidate_id, job_title } = req.body;
    const tpl = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(template_id);
    if (!tpl) return res.status(404).json({ error: 'Template nicht gefunden' });

    const candidate = candidate_id ? db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate_id) : null;
    const smtp = getSmtpSettings();
    const nameParts = (candidate?.name || 'Max Mustermann').split(' ');
    const vorname = nameParts[0] || 'Max';
    const nachname = nameParts.slice(1).join(' ') || 'Mustermann';
    const vars = {
      vorname,
      nachname,
      anrede: buildAnrede(candidate?.gender || 'Herr', vorname, nachname),
      name: candidate?.name || 'Max Mustermann',
      email: candidate?.email || 'max@example.de',
      stelle: job_title || 'Beispiel-Stelle',
      unternehmen: smtp.email_company_name || 'Unser Unternehmen',
    };

    res.json({
      subject: resolveTemplate(tpl.subject, vars),
      body: resolveTemplate(tpl.body, vars),
    });
  } catch (err) {
    res.status(500).json({ error: 'Vorschau fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════
// Email Log
// ═══════════════════════════════════════

router.get('/log', (req, res) => {
  try {
    const { candidate_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '';
    const params = [];
    if (candidate_id) {
      where = 'WHERE el.candidate_id = ?';
      params.push(candidate_id);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM email_log el ${where}`).get(...params).count;
    const logs = db.prepare(`
      SELECT el.*, c.name as candidate_name, et.name as template_name
      FROM email_log el
      LEFT JOIN candidates c ON c.id = el.candidate_id
      LEFT JOIN email_templates et ON et.id = el.template_id
      ${where}
      ORDER BY el.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    res.json({ data: logs, pagination: { page: parseInt(page), limit: parseInt(limit), total } });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden des E-Mail-Logs' });
  }
});

// ═══════════════════════════════════════
// Stage Trigger Toggles
// ═══════════════════════════════════════

const STAGES = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt'];

router.get('/triggers', (req, res) => {
  try {
    const triggers = {};
    for (const stage of STAGES) {
      triggers[stage] = isStageTriggerEnabled(stage);
    }
    res.json(triggers);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Laden der Trigger-Einstellungen' });
  }
});

router.put('/triggers', (req, res) => {
  try {
    const { triggers } = req.body;
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
    for (const stage of STAGES) {
      if (triggers[stage] !== undefined) {
        upsert.run(`email_trigger_${stage}`, triggers[stage] ? '1' : '0');
      }
    }
    logAudit(req, 'email-trigger-konfiguriert', 'Setting', null, 'Email-Trigger', { triggers });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Speichern der Trigger-Einstellungen' });
  }
});

// ═══════════════════════════════════════
// AI Template Generation (Ollama)
// ═══════════════════════════════════════

router.post('/generate-template', generatorRateLimiter, promptGuard('email-template'), async (req, res) => {
  try {
    const { purpose, tone, stage } = req.body;
    if (!purpose) {
      return res.status(400).json({ error: 'Zweck des Templates ist erforderlich' });
    }

    const { baseUrl: OLLAMA_URL, model: OLLAMA_MODEL } = getAiConfig();

    const smtp = getSmtpSettings();
    const companyName = smtp.email_company_name || 'Unser Unternehmen';

    const prompt = `Du bist ein professioneller HR-Texter. Erstelle eine E-Mail-Vorlage auf Deutsch für ein HR-Tool.

Zweck: ${purpose}
${tone ? `Tonalität: ${tone}` : 'Tonalität: professionell und freundlich'}
${stage ? `Pipeline-Stufe: ${stage}` : ''}
Unternehmen: ${companyName}

Verwende diese Platzhalter im Text:
- {{anrede}} = Korrekte Anrede (z.B. "Sehr geehrte Frau Hannot" oder "Sehr geehrter Herr Müller"). IMMER als Briefanrede nutzen!
- {{vorname}} = Vorname des Bewerbers
- {{nachname}} = Nachname des Bewerbers  
- {{stelle}} = Stellenbezeichnung
- {{unternehmen}} = Unternehmensname
- {{datum}} = aktuelles Datum

WICHTIG: Beginne die Anrede im Template IMMER mit {{anrede}}, gefolgt von einem Komma. Beispiel: "{{anrede}},\\n\\nvielen Dank..."

Antworte NUR mit diesem exakten JSON-Format (ohne Markdown, ohne Erklärung):
{"name": "KURZER TEMPLATE-NAME", "subject": "BETREFF-ZEILE mit Platzhaltern", "body": "VOLLSTÄNDIGER E-MAIL-TEXT mit Platzhaltern und Zeilenumbrüchen als \\n"}

Die Werte MÜSSEN Strings sein. Verwende \\n für Zeilenumbrüche im body.`;

    const startTime = Date.now();

    // Ping Ollama
    try {
      const pc = new AbortController();
      setTimeout(() => pc.abort(), 5000);
      await fetch(`${OLLAMA_URL}/`, { signal: pc.signal });
    } catch (_) {
      logAiCall({ userId: req.user?.id, feature: 'email-template', model: OLLAMA_MODEL, prompt, response: null, parsedResult: null, durationMs: Date.now() - startTime, success: false, errorMessage: 'Ollama nicht erreichbar' });
      return res.status(502).json({ error: 'Ollama ist nicht erreichbar. Bitte sicherstellen, dass Ollama läuft.' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    let response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.7, num_predict: 3000 }
        }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        logAiCall({ userId: req.user?.id, feature: 'email-template', model: OLLAMA_MODEL, prompt, response: null, parsedResult: null, durationMs: Date.now() - startTime, success: false, errorMessage: 'Timeout' });
        return res.status(504).json({ error: 'Timeout: KI-Generierung hat zu lange gedauert.' });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      logAiCall({ userId: req.user?.id, feature: 'email-template', model: OLLAMA_MODEL, prompt, response: errText, parsedResult: null, durationMs: Date.now() - startTime, success: false, errorMessage: 'Ollama HTTP ' + response.status });
      return res.status(502).json({ error: 'Ollama-Fehler: ' + (errText || 'Unbekannter Fehler') });
    }

    const data = await response.json();
    const raw = data.response || '';

    let parsed = { name: '', subject: '', body: '' };
    try {
      const clean = stripReasoningTags(raw);
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
        // Convert literal \n to real newlines in body
        if (parsed.body) parsed.body = parsed.body.replace(/\\n/g, '\n');
      } else {
        throw new Error('Kein JSON in Antwort');
      }
    } catch (parseErr) {
      logAiCall({ userId: req.user?.id, feature: 'email-template', model: OLLAMA_MODEL, prompt, response: raw, parsedResult: null, durationMs: Date.now() - startTime, inputTokens: data.prompt_eval_count || null, outputTokens: data.eval_count || null, success: false, errorMessage: 'JSON-Parse: ' + parseErr.message });
      return res.status(502).json({ error: 'KI-Antwort konnte nicht verarbeitet werden: ' + parseErr.message });
    }

    const durationMs = Date.now() - startTime;
    logAiCall({ userId: req.user?.id, feature: 'email-template', model: OLLAMA_MODEL, prompt, response: raw, parsedResult: parsed, durationMs, inputTokens: data.prompt_eval_count || null, outputTokens: data.eval_count || null, success: true });
    logAudit(req, 'ki-email-template', 'EmailTemplate', null, parsed.name, { purpose, model: OLLAMA_MODEL });

    res.json({
      name: parsed.name || parsed.Name || '',
      subject: parsed.subject || parsed.Subject || parsed.Betreff || parsed.betreff || '',
      body: parsed.body || parsed.Body || parsed.Text || parsed.text || '',
      model: OLLAMA_MODEL,
    });
  } catch (err) {
    console.error('AI template generation error:', err);
    res.status(500).json({ error: `KI-Generierung fehlgeschlagen: ${err.message}` });
  }
});

// ═══════════════════════════════════════
// Pipeline stage trigger (called internally)
// ═══════════════════════════════════════

// Export the trigger function for use from pipeline.js
async function triggerStageEmail(candidateId, newStage, jobTitle, username) {
  try {
    // Check if trigger is enabled for this stage
    if (!isStageTriggerEnabled(newStage)) {
      console.log(`📧 Pipeline-Trigger für "${newStage}" ist deaktiviert — übersprungen`);
      return;
    }

    const template = db.prepare(
      'SELECT * FROM email_templates WHERE trigger_stage = ? AND is_active = 1'
    ).get(newStage);
    if (!template) return; // No template for this stage

    const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
    if (!candidate?.email) return; // No email address

    const smtp = getSmtpSettings();
    if (!smtp.smtp_host) return; // SMTP not configured

    const nameParts = candidate.name.split(' ');
    const vars = {
      vorname: nameParts[0] || '',
      nachname: nameParts.slice(1).join(' ') || '',
      name: candidate.name,
      email: candidate.email,
      stelle: jobTitle || '',
      unternehmen: smtp.email_company_name || 'Unser Unternehmen',
    };

    const subject = resolveTemplate(template.subject, vars);
    const body = resolveTemplate(template.body, vars);

    await sendEmailHelper({
      candidateId,
      templateId: template.id,
      toEmail: candidate.email,
      subject,
      body,
      sentBy: username || 'pipeline-trigger',
    });

    db.prepare('INSERT INTO activities (candidate_id, type, content) VALUES (?, ?, ?)')
      .run(candidateId, 'E-Mail', `Automatische E-Mail (Pipeline-Trigger "${newStage}"): "${subject}"`);

    console.log(`📧 Pipeline-Trigger: E-Mail "${template.name}" an ${candidate.email} gesendet (Stage: ${newStage})`);
  } catch (err) {
    console.error(`📧 Pipeline-Trigger fehlgeschlagen (${newStage}):`, err.message);
  }
}

router.triggerStageEmail = triggerStageEmail;
module.exports = router;
