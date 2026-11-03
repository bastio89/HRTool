const { graphRagAuthHeaders } = require('../graphragAuth');

function graphCandidateIds(candidate) {
  const normalize = (value) => String(value || '').trim();
  const ids = Array.isArray(candidate?.graph_candidate_ids) ? [...candidate.graph_candidate_ids] : [];
  if (candidate?.graph_candidate_id) ids.push(candidate.graph_candidate_id);
  // Der Neo4j-Knoten traegt die UUID des Bewerbers (siehe src/identity.js).
  if (candidate?.uuid) ids.push(candidate.uuid);
  return [...new Set(ids.map(normalize).filter(Boolean))];
}

async function deleteGraphCandidateById(candidate, candidateId, req) {
  const normalize = (value) => String(value || '').trim() || null;
  const email = normalize(candidate?.email);
  const phone = normalize(candidate?.phone);
  const name = normalize(candidate?.name);
  const location = normalize(candidate?.location);

  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/ingest/candidate`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...graphRagAuthHeaders(req) },
    body: JSON.stringify({
      candidate_id: candidateId || null,
      email: candidateId ? null : (email || null),
      phone: candidateId || email ? null : (phone || null),
      name: candidateId || email || phone ? null : name,
      location: candidateId || email || phone ? null : location,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `GraphRAG HTTP ${response.status}`);
  }
  return Number(payload.neo4j_deleted) || 0;
}

async function deleteGraphCandidate(candidate, req) {
  const graphIds = graphCandidateIds(candidate);
  if (graphIds.length > 0) {
    const deleted = await Promise.all(
      graphIds.map((candidateId) => deleteGraphCandidateById(candidate, candidateId, req)),
    );
    return deleted.reduce((total, count) => total + count, 0);
  }

  const hasLegacyIdentity = candidate?.email || candidate?.phone || (candidate?.name && candidate?.location);
  if (!hasLegacyIdentity) return 0;
  return deleteGraphCandidateById(candidate, null, req);
}

async function deleteGraphCandidates(candidates, req) {
  const unique = new Map();
  for (const candidate of candidates) {
    const graphIds = graphCandidateIds(candidate);
    if (graphIds.length > 0) {
      for (const graphId of graphIds) {
        unique.set(`graph:${graphId}`, { ...candidate, graph_candidate_id: graphId, graph_candidate_ids: [] });
      }
    } else {
      const key = `identity:${candidate.email || candidate.phone || `${candidate.name || ''}:${candidate.location || ''}`}`;
      unique.set(key, candidate);
    }
  }
  return Promise.all([...unique.values()].map((candidate) => deleteGraphCandidate(candidate, req)));
}

// Uebertraegt Bewerber aus PostgreSQL nach Neo4j (Knoten-ID = UUID des
// Bewerbers). Laeuft im Hintergrund: Ist GraphRAG nicht erreichbar, bleibt der
// Bewerber ohne Neo4j-Knoten und wird ueber "Abgleich nachholen" in der
// Dubletten-Uebersicht spaeter uebertragen.
async function syncGraphCandidates(candidateIds, req) {
  const ids = [...new Set((candidateIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return { synced: 0 };
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/sync/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...graphRagAuthHeaders(req) },
    body: JSON.stringify({ candidate_ids: ids }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || `GraphRAG HTTP ${response.status}`);
  return payload;
}

function syncGraphCandidatesInBackground(candidateIds, req) {
  syncGraphCandidates(candidateIds, req).catch((error) => {
    console.warn('Neo4j-Abgleich der Bewerber fehlgeschlagen:', error.message);
  });
}

// CV-Volltext und Anonymisierung liegen in candidate_texts (Schluessel ist die
// Bewerber-ID als Text, ohne Fremdschluessel) und muessen mitgeloescht werden.
function deleteCandidateTexts(db, candidateIds) {
  const ids = (candidateIds || []).map(id => String(id)).filter(Boolean);
  if (ids.length === 0) return 0;
  return db.prepare(`DELETE FROM candidate_texts WHERE candidate_id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes || 0;
}

module.exports = {
  deleteCandidateTexts,
  deleteGraphCandidate,
  deleteGraphCandidates,
  syncGraphCandidates,
  syncGraphCandidatesInBackground,
};