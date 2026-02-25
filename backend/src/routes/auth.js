const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

// AI Act Art. 15: JWT-Secret darf NICHT hardcoded sein
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET Umgebungsvariable ist nicht gesetzt!');
  console.error('   Bitte in .env setzen: JWT_SECRET=<mindestens-32-zeichen-zufallsstring>');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login (JWT Token)
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: JWT Token + User-Daten }
 *       401: { description: Ungültige Anmeldedaten }
 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Fehler bei der Anmeldung' });
  }
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Aktueller Benutzer
 *     tags: [Auth]
 *     responses:
 *       200: { description: Benutzer-Profil }
 *       401: { description: Nicht eingeloggt }
 */
router.get('/me', (req, res) => {
  // Auth is checked by middleware
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  const user = db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  res.json(user);
});

/**
 * @swagger
 * /auth/users:
 *   get:
 *     summary: Alle Benutzer (Admin)
 *     tags: [Auth]
 *     responses:
 *       200: { description: Benutzerliste }
 */
router.get('/users', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins dürfen Benutzer verwalten' });
  }
  const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ data: users });
});

/**
 * @swagger
 * /auth/users:
 *   post:
 *     summary: Benutzer erstellen (Admin)
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *               display_name: { type: string }
 *               role: { type: string, enum: [admin, recruiter] }
 *     responses:
 *       201: { description: Erstellter Benutzer }
 */
router.post('/users', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins dürfen Benutzer anlegen' });
  }

  try {
    const { username, password, display_name, role } = req.body;
    if (!username || !password || !display_name) {
      return res.status(400).json({ error: 'Benutzername, Passwort und Anzeigename erforderlich' });
    }
    if (!['admin', 'recruiter'].includes(role)) {
      return res.status(400).json({ error: 'Ungültige Rolle' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)'
    ).run(username, hash, display_name, role || 'recruiter');

    const user = db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    logAudit(req, 'benutzer-erstellt', 'User', user.id, user.display_name, { role: user.role });
    res.status(201).json(user);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Fehler beim Anlegen des Benutzers' });
  }
});

/**
 * @swagger
 * /auth/users/{id}:
 *   delete:
 *     summary: Benutzer löschen (Admin)
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Gelöscht }
 */
router.delete('/users/:id', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins dürfen Benutzer löschen' });
  }
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
  }

  try {
    const existing = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logAudit(req, 'benutzer-gelöscht', 'User', req.params.id, existing.display_name);
    res.json({ message: 'Benutzer gelöscht' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Benutzers' });
  }
});

/**
 * @swagger
 * /auth/change-password:
 *   put:
 *     summary: Passwort ändern
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200: { description: Passwort geändert }
 */
router.put('/change-password', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });

  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 4 Zeichen lang sein' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    logAudit(req, 'passwort-geändert', 'User', req.user.id, req.user.display_name);
    res.json({ message: 'Passwort geändert' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Fehler beim Ändern des Passworts' });
  }
});

/**
 * @swagger
 * /auth/users/{id}/reset-password:
 *   put:
 *     summary: Passwort eines Benutzers zurücksetzen (Admin)
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               newPassword: { type: string, minLength: 4 }
 *     responses:
 *       200: { description: Passwort zurückgesetzt }
 *       403: { description: Keine Berechtigung }
 *       404: { description: Benutzer nicht gefunden }
 */
router.put('/users/:id/reset-password', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins dürfen Passwörter zurücksetzen' });
  }

  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 4 Zeichen lang sein' });
    }

    const existing = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    logAudit(req, 'passwort-zurückgesetzt', 'User', req.params.id, existing.display_name);
    res.json({ message: 'Passwort wurde zurückgesetzt' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts' });
  }
});

/**
 * @swagger
 * /auth/admin/backup:
 *   get:
 *     summary: Datenbank-Backup herunterladen (Admin)
 *     tags: [Auth]
 *     responses:
 *       200: { description: SQLite-Datenbankdatei als Download }
 *       403: { description: Keine Berechtigung }
 */
router.get('/admin/backup', (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Admins dürfen Backups erstellen' });
  }

  try {
    const dbPath = path.join(__dirname, '..', '..', 'data', 'hrtool.db');
    const backupDir = path.join(__dirname, '..', '..', 'data', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFilename = `hrtool-backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupFilename);

    // Use SQLite backup API for safe copy (even while DB is in use)
    db.backup(backupPath).then(() => {
      logAudit(req, 'backup-erstellt', 'System', null, backupFilename);
      res.download(backupPath, backupFilename, (err) => {
        // Clean up backup file after download
        try { fs.unlinkSync(backupPath); } catch {}
        if (err && !res.headersSent) {
          res.status(500).json({ error: 'Fehler beim Download' });
        }
      });
    }).catch(err => {
      console.error('Backup error:', err);
      res.status(500).json({ error: 'Fehler beim Erstellen des Backups' });
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Backups' });
  }
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
