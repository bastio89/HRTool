const { graphRagAuthHeaders } = require('./graphragAuth');

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function graphRagRequest(req, endpoint, payload) {
  const baseUrl = process.env.GRAPHRAG_BASE_URL?.trim() || 'http://graphrag:8000';
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}${endpoint}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...graphRagAuthHeaders(req) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw Object.assign(new Error('GraphRAG ist nicht erreichbar', { cause: error }), { status: 503 });
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw Object.assign(new Error('Ungueltige GraphRAG-JSON-Antwort', { cause: error }), { status: 502 });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('Ungueltige GraphRAG-Antwort'), { status: 502 });
  }
  if (!response.ok) {
    const detailObject = data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail) ? data.detail : null;
    const message = detailObject?.error || (typeof data.detail === 'string' ? data.detail : null) || data.error || `GraphRAG HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, details: message, detailObject });
  }
  return { data, status: response.status };
}

module.exports = { graphRagRequest, RUN_ID };
