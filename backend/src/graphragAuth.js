/**
 * Header for server-to-server calls into GraphRAG.
 *
 * GraphRAG sits behind the public nginx proxy and had no authentication at
 * all. It now rejects anything without this key, so every backend call has to
 * carry it. Returns an empty object when no key is configured, which keeps
 * existing setups working until GRAPHRAG_API_KEY is set on both sides.
 */
function graphRagAuthHeaders() {
  const key = process.env.GRAPHRAG_API_KEY?.trim();
  return key ? { 'X-API-Key': key } : {};
}

module.exports = { graphRagAuthHeaders };
