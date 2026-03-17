const express = require('express');
const db = require('../database');

const router = express.Router();

// Valid weight keys
const VALID_KEYS = [
  'skills', 'experience', 'education', 'location',
  'languages', 'salary', 'availability', 'certificates',
  'cultural_fit', 'mobility'
];

/**
 * @swagger
 * /matching-weights/profiles:
 *   get:
 *     summary: Alle Matching-Gewichtungsprofile laden
 *     tags: [Matching-Gewichtung]
 *     responses:
 *       200: { description: Liste aller Gewichtungsprofile }
 */
router.get('/profiles', (req, res) => {
  try {
    const profiles = db.prepare(
      'SELECT * FROM matching_weight_profiles ORDER BY is_default DESC, name ASC'
    ).all();
    res.json({
      data: profiles.map(p => ({ ...p, weights: JSON.parse(p.weights) }))
    });
  } catch (error) {
    console.error('Error fetching weight profiles:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Gewichtungsprofile' });
  }
});

/**
 * @swagger
 * /matching-weights/profiles/{id}:
 *   get:
 *     summary: Einzelnes Gewichtungsprofil laden
 *     tags: [Matching-Gewichtung]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Gewichtungsprofil }
 *       404: { description: Nicht gefunden }
 */
router.get('/profiles/:id', (req, res) => {
  try {
    const profile = db.prepare('SELECT * FROM matching_weight_profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' });
    res.json({ ...profile, weights: JSON.parse(profile.weights) });
  } catch (error) {
    console.error('Error fetching weight profile:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Profils' });
  }
});

/**
 * @swagger
 * /matching-weights/profiles:
 *   post:
 *     summary: Neues Gewichtungsprofil erstellen
 *     tags: [Matching-Gewichtung]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             properties:
 *               name: { type: string, description: Profilname }
 *               weights: { type: object, description: 'Gewichtungen (-10 bis +10) für jedes Kriterium' }
 *     responses:
 *       201: { description: Profil erstellt }
 *       400: { description: Ungültige Eingabe }
 */
router.post('/profiles', (req, res) => {
  try {
    const { name, weights } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Profilname ist erforderlich' });
    }

    // Validate weights
    const validatedWeights = {};
    for (const key of VALID_KEYS) {
      const val = weights?.[key] ?? 0;
      validatedWeights[key] = Math.max(-10, Math.min(10, Math.round(Number(val) || 0)));
    }

    const result = db.prepare(
      'INSERT INTO matching_weight_profiles (name, weights, created_by) VALUES (?, ?, ?)'
    ).run(name.trim(), JSON.stringify(validatedWeights), req.user?.display_name || req.user?.username || 'System');

    res.status(201).json({
      id: result.lastInsertRowid,
      name: name.trim(),
      is_default: 0,
      weights: validatedWeights,
    });
  } catch (error) {
    console.error('Error creating weight profile:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Profils' });
  }
});

/**
 * @swagger
 * /matching-weights/profiles/{id}:
 *   put:
 *     summary: Gewichtungsprofil aktualisieren
 *     tags: [Matching-Gewichtung]
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
 *               name: { type: string }
 *               weights: { type: object }
 *     responses:
 *       200: { description: Profil aktualisiert }
 */
router.put('/profiles/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM matching_weight_profiles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profil nicht gefunden' });

    const { name, weights } = req.body;
    const validatedWeights = {};
    for (const key of VALID_KEYS) {
      const val = weights?.[key] ?? JSON.parse(existing.weights)[key] ?? 0;
      validatedWeights[key] = Math.max(-10, Math.min(10, Math.round(Number(val) || 0)));
    }

    db.prepare(
      'UPDATE matching_weight_profiles SET name = ?, weights = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run((name || existing.name).trim(), JSON.stringify(validatedWeights), req.params.id);

    res.json({
      id: Number(req.params.id),
      name: (name || existing.name).trim(),
      is_default: existing.is_default,
      weights: validatedWeights,
    });
  } catch (error) {
    console.error('Error updating weight profile:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Profils' });
  }
});

/**
 * @swagger
 * /matching-weights/profiles/{id}:
 *   delete:
 *     summary: Gewichtungsprofil löschen
 *     tags: [Matching-Gewichtung]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Profil gelöscht }
 */
router.delete('/profiles/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM matching_weight_profiles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profil nicht gefunden' });
    if (existing.is_default) {
      return res.status(400).json({ error: 'Standard-Profil kann nicht gelöscht werden' });
    }
    db.prepare('DELETE FROM matching_weight_profiles WHERE id = ?').run(req.params.id);
    res.json({ message: 'Profil gelöscht' });
  } catch (error) {
    console.error('Error deleting weight profile:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Profils' });
  }
});

/**
 * @swagger
 * /matching-weights/profiles/{id}/default:
 *   put:
 *     summary: Profil als Standard setzen
 *     tags: [Matching-Gewichtung]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Als Standard gesetzt }
 */
router.put('/profiles/:id/default', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM matching_weight_profiles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profil nicht gefunden' });

    db.prepare('UPDATE matching_weight_profiles SET is_default = 0').run();
    db.prepare('UPDATE matching_weight_profiles SET is_default = 1 WHERE id = ?').run(req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Error setting default profile:', error);
    res.status(500).json({ error: 'Fehler beim Setzen des Standards' });
  }
});

module.exports = router;
