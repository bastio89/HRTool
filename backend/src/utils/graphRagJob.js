const { graphRagAuthHeaders } = require('../graphragAuth');

// Loescht nur den Neo4j-Knoten (scope "neo4j"); die PostgreSQL-Zeile loescht
// das Backend selbst. Frueher hat GraphRAG dabei alle PostgreSQL-Stellen mit
// derselben graph_job_id mitgeloescht.
async function deleteJobFromGraphRag(req, job) {
  const ids = [...new Set([job.uuid, job.graph_job_id].map(value => String(value || '').trim()).filter(Boolean))];
  if (ids.length <= 1) return deleteJobNodeFromGraphRag(req, job, ids[0] || null);
  const results = [];
  for (const id of ids) results.push(await deleteJobNodeFromGraphRag(req, job, id));
  return results.find(result => result?.deleted) || results[0];
}

async function deleteJobNodeFromGraphRag(req, job, graphId) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/ingest/job`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...graphRagAuthHeaders(req) },
      body: JSON.stringify({
        scope: 'neo4j',
        job_id: graphId,
        title: job.title || null,
        description: job.description || null,
        requirements: job.requirements || null,
        about_us: job.about_us || null,
        benefits: job.benefits || null,
        location: job.location || null,
        type: job.type || null,
        url: job.url || null,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`GraphRAG HTTP ${response.status}: ${payload.detail || payload.error || 'Unbekannter Fehler'}`);
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { deleteJobFromGraphRag };
