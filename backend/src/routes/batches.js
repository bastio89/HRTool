const express = require('express');
const db = require('../database');
const { graphRagRequest, RUN_ID } = require('../graphragRequest');

const router = express.Router();

router.use((req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Authentifizierung erforderlich' });
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(401).json({ error: 'Benutzer nicht mehr vorhanden' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Nur Administratoren haben Zugriff auf Batchverarbeitung' });
    next();
  } catch (error) {
    console.error('Error authorizing batch access:', error);
    res.status(500).json({ error: 'Batch-Berechtigung konnte nicht geprueft werden' });
  }
});

async function proxy(req, res, kind) {
  try {
    if (req.params.runId && !RUN_ID.test(req.params.runId)) {
      return res.status(400).json({ error: 'Ungueltige Matching-Lauf-ID' });
    }
    let endpoint = '/admin/batches';
    if (req.params.runId) endpoint += `/${req.params.runId}`;
    if (kind === 'retry') endpoint += '/retry';
    const query = new URLSearchParams();
    for (const key of kind === 'list' ? ['status', 'source', 'cursor', 'limit'] : ['pairStatus', 'cursor', 'limit']) {
      if (req.query[key] !== undefined) {
        if (typeof req.query[key] !== 'string') return res.status(400).json({ error: `Ungueltiger Parameter: ${key}` });
        query.set(key, req.query[key]);
      }
    }
    if (kind !== 'retry' && query.size) endpoint += `?${query}`;
    const { data, status } = await graphRagRequest(req, endpoint, kind === 'retry' ? req.body : undefined);
    const valid = kind === 'list' ? Array.isArray(data.items)
      : kind === 'detail' ? data.run?.runId === req.params.runId && Array.isArray(data.pairs) && data.counters
        : data.runId === req.params.runId && data.stage === 'queued';
    if (!valid) throw Object.assign(new Error('Unvollstaendige GraphRAG-Batchantwort'), { status: 502 });
    res.status(status).json(data);
  } catch (error) {
    console.error('Error proxying batch request:', error);
    res.status(error.status || 500).json({ error: 'Batchanfrage fehlgeschlagen', details: error.message });
  }
}

/**
 * @openapi
 * /batches:
 *   get:
 *     summary: Globale technische Matching-Queue
 *     description: Nur aktuell gespeicherte Administratoren, nicht API-Key oder JWT-Rollenbehauptung allein. Stabil absteigend nach Erstellzeit und UUID paginiert; Cursor beim Filterwechsel zuruecksetzen.
 *     tags: [Batchverarbeitung]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [queued, preparing, matching, blocked_credits, completed, completed_with_errors, needs_review, failed] } }
 *       - { in: query, name: source, schema: { type: string, minLength: 1, maxLength: 255 } }
 *       - { in: query, name: cursor, schema: { type: string, format: uuid } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 25 } }
 *     responses:
 *       200:
 *         description: Persistierte Auftraege mit ungefilterten Gesamtzaehlern
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items: { type: array, items: { $ref: '#/components/schemas/BatchSummary' } }
 *                 nextCursor: { type: string, format: uuid, nullable: true }
 *       401: { description: Fehlender Bearer oder geloeschter Benutzer }
 *       403: { description: Keine aktuell gespeicherte Adminrolle }
 *       400: { description: Mehrdeutiger Queryparameter }
 *       422: { description: Ungueltiger Filter, Cursor oder Seitenumfang }
 *       502: { description: Unvollstaendige oder ungueltige GraphRAG-Antwort }
 *       503: { description: GraphRAG nicht erreichbar }
 * /batches/{runId}:
 *   get:
 *     summary: Lauf und paginierte Paarziele
 *     tags: [Batchverarbeitung]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: runId, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: pairStatus, schema: { type: string, enum: [pending, running, computed, cached, shared, failed, skipped, needs_review, preparation_required] } }
 *       - { in: query, name: cursor, description: Paarziel-ID aus diesem Lauf, schema: { type: integer, format: int64, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 25 } }
 *     responses:
 *       200:
 *         description: Filter verkleinern niemals den Nenner der Zaehler
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - { $ref: '#/components/schemas/BatchSummary' }
 *                 - type: object
 *                   properties:
 *                     pairs: { type: array, items: { $ref: '#/components/schemas/BatchPair' } }
 *                     nextCursor: { type: integer, format: int64, nullable: true }
 *       400: { description: Ungueltige Lauf-ID oder mehrdeutiger Queryparameter }
 *       401: { description: Authentifizierung erforderlich }
 *       403: { description: Adminrolle erforderlich }
 *       404: { description: Lauf nicht gefunden }
 *       422: { description: Ungueltiger oder fremder Paar-Cursor oder Filter }
 *       502: { description: Ungueltige GraphRAG-Antwort }
 *       503: { description: GraphRAG nicht erreichbar }
 * /batches/{runId}/retry:
 *   post:
 *     summary: Ausgewaehlte unvollstaendige Paarziele sicher freigeben
 *     description: Nur ohne aktiven Worker. Keine Wiederholung gueltiger oder laufender Paare. Originalresultate anderer Ziele und die bestehende Laufabbuchung bleiben erhalten. Geteilte Arbeit nimmt der urspruengliche Eigentuemerlauf wieder auf. Ungewisse Provideraufrufe brauchen ausdrueckliche Kostenbestaetigung; Aktion wird ohne CV-Texte auditiert.
 *     tags: [Batchverarbeitung]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: runId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [pairIds]
 *             properties:
 *               pairIds: { type: array, minItems: 1, maxItems: 100, uniqueItems: true, items: { type: integer, format: int64, minimum: 1 } }
 *               confirmUncertain: { type: boolean, default: false, description: Ein frueherer Provideraufruf kann bereits Kosten verursacht haben; Wiederholung kann zusaetzliche Providerkosten erzeugen. }
 *     responses:
 *       200:
 *         description: Im selben Lauf vorgemerkt, noch kein Matching-Abschluss
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 runId: { type: string, format: uuid }
 *                 stage: { type: string, enum: [queued] }
 *       400: { description: Ungueltige Lauf-ID }
 *       401: { description: Authentifizierung erforderlich }
 *       403: { description: Adminrolle erforderlich }
 *       404: { description: Lauf nicht gefunden }
 *       409: { description: Aktiver Worker, nicht wiederholbares Paar, geloeschte Quelle, fremde/mehrfache Ziel-ID oder fehlende Ungewissheitsbestaetigung }
 *       422: { description: Ungueltiger Request oder leere/zu grosse Auswahl }
 *       502: { description: Ungueltige GraphRAG-Antwort }
 *       503: { description: GraphRAG nicht erreichbar }
 */
router.get('/', (req, res) => proxy(req, res, 'list'));
router.get('/:runId', (req, res) => proxy(req, res, 'detail'));
router.post('/:runId/retry', (req, res) => proxy(req, res, 'retry'));

module.exports = router;
