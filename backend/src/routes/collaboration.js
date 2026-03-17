const express = require('express');
const db = require('../database');
const { logAudit } = require('./audit');

const router = express.Router();

// ═══════════════════════════════════════
// Comments (on candidates, jobs, pipeline entries)
// ═══════════════════════════════════════

// GET /collaboration/comments?entity_type=candidate&entity_id=5
router.get('/comments', (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type und entity_id sind erforderlich' });
    }

    const comments = db.prepare(`
      SELECT c.*, u.display_name as author_name, u.username as author_username
      FROM comments c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.entity_type = ? AND c.entity_id = ?
      ORDER BY c.created_at ASC
    `).all(entity_type, entity_id);

    // Parse mentions
    const result = comments.map(c => ({
      ...c,
      mentions: c.mentions ? JSON.parse(c.mentions) : [],
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Kommentare' });
  }
});

// POST /collaboration/comments
router.post('/comments', (req, res) => {
  try {
    const { entity_type, entity_id, content, parent_id } = req.body;
    if (!entity_type || !entity_id || !content?.trim()) {
      return res.status(400).json({ error: 'entity_type, entity_id und content sind erforderlich' });
    }

    // Extract @mentions from content
    const mentionPattern = /@(\w+)/g;
    const mentionMatches = [...content.matchAll(mentionPattern)];
    const mentionedUsernames = mentionMatches.map(m => m[1]);

    // Resolve mentioned users
    let mentions = [];
    if (mentionedUsernames.length > 0) {
      const placeholders = mentionedUsernames.map(() => '?').join(',');
      mentions = db.prepare(`SELECT id, username, display_name FROM users WHERE username IN (${placeholders})`).all(...mentionedUsernames);
    }

    const result = db.prepare(`
      INSERT INTO comments (entity_type, entity_id, user_id, content, mentions, parent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entity_type, entity_id, req.user.id, content.trim(), JSON.stringify(mentions.map(u => u.id)), parent_id || null);

    // Create notifications for mentioned users
    if (mentions.length > 0) {
      const insertNotif = db.prepare(`
        INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const mentioned of mentions) {
        if (mentioned.id !== req.user.id) {
          insertNotif.run(
            mentioned.id, 'mention',
            `${req.user.display_name || req.user.username} hat Sie erwähnt`,
            content.substring(0, 200),
            entity_type, entity_id, req.user.id
          );
        }
      }
    }

    // Also notify other commenters on the same entity
    const otherCommenters = db.prepare(`
      SELECT DISTINCT user_id FROM comments
      WHERE entity_type = ? AND entity_id = ? AND user_id != ? AND user_id NOT IN (${mentions.map(() => '?').join(',') || '0'})
    `).all(entity_type, entity_id, req.user.id, ...mentions.map(u => u.id));

    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of otherCommenters) {
      insertNotif.run(
        c.user_id, 'comment',
        `Neuer Kommentar von ${req.user.display_name || req.user.username}`,
        content.substring(0, 200),
        entity_type, entity_id, req.user.id
      );
    }

    logAudit(req, 'comment-created', entity_type, entity_id, content.substring(0, 100));

    const comment = db.prepare(`
      SELECT c.*, u.display_name as author_name, u.username as author_username
      FROM comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ ...comment, mentions });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Kommentars' });
  }
});

// DELETE /collaboration/comments/:id
router.delete('/comments/:id', (req, res) => {
  try {
    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Kommentar nicht gefunden' });
    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    logAudit(req, 'comment-deleted', comment.entity_type, comment.entity_id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Kommentars' });
  }
});

// GET /collaboration/comments/count?entity_type=candidate&entity_ids=1,2,3
router.get('/comments/count', (req, res) => {
  try {
    const { entity_type, entity_ids } = req.query;
    if (!entity_type || !entity_ids) return res.json({});
    
    const ids = entity_ids.split(',').map(Number).filter(Boolean);
    if (ids.length === 0) return res.json({});

    const placeholders = ids.map(() => '?').join(',');
    const counts = db.prepare(`
      SELECT entity_id, COUNT(*) as count
      FROM comments WHERE entity_type = ? AND entity_id IN (${placeholders})
      GROUP BY entity_id
    `).all(entity_type, ...ids);

    const result = {};
    counts.forEach(c => { result[c.entity_id] = c.count; });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Zählen' });
  }
});

// ═══════════════════════════════════════
// Notifications
// ═══════════════════════════════════════

// GET /collaboration/notifications
router.get('/notifications', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    const where = unreadOnly ? 'AND n.is_read = 0' : '';
    const total = db.prepare(`SELECT COUNT(*) as c FROM notifications n WHERE n.user_id = ? ${where}`).get(req.user.id).c;

    const notifications = db.prepare(`
      SELECT n.*, u.display_name as from_name, u.username as from_username
      FROM notifications n
      LEFT JOIN users u ON u.id = n.created_by
      WHERE n.user_id = ? ${where}
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    const unreadCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;

    res.json({ data: notifications, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Benachrichtigungen' });
  }
});

// PUT /collaboration/notifications/:id/read
router.put('/notifications/:id/read', (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

// PUT /collaboration/notifications/read-all
router.put('/notifications/read-all', (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

// GET /collaboration/notifications/unread-count
router.get('/notifications/unread-count', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;
    res.json({ count });
  } catch (error) {
    res.json({ count: 0 });
  }
});

// GET /collaboration/users — List users for @mention autocomplete
router.get('/users', (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, display_name, role FROM users ORDER BY display_name').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

module.exports = router;
