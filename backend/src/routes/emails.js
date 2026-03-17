const express = require('express');
const nodemailer = require('nodemailer');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

// ─── Helper: Get SMTP settings from DB ───
function getSmtpSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key = 'email_company_name'").all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
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

// ─── Helper: Replace template variables ───
function resolveTemplate(text, vars) {
  return text
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
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime("now"))');

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
      const vars = {
        vorname: nameParts[0] || '',
        nachname: nameParts.slice(1).join(' ') || '',
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
      const vars = {
        vorname: nameParts[0] || '',
        nachname: nameParts.slice(1).join(' ') || '',
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
    const vars = {
      vorname: nameParts[0] || 'Max',
      nachname: nameParts.slice(1).join(' ') || 'Mustermann',
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
// Pipeline stage trigger (called internally)
// ═══════════════════════════════════════

// Export the trigger function for use from pipeline.js
async function triggerStageEmail(candidateId, newStage, jobTitle, username) {
  try {
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
