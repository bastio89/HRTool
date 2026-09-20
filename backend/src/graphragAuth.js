/**
 * Headers for GraphRAG calls.
 *
 * The backend keeps the internal API key for service-to-service access and,
 * when a logged-in user request is being proxied, forwards the user's JWT as
 * well so Graphrag can bill the real user account.
 */
function graphRagAuthHeaders(req) {
  const key = process.env.GRAPHRAG_API_KEY?.trim();
  const headers = key ? { 'X-API-Key': key } : {};
  const authorization = req?.headers?.authorization;
  if (typeof authorization === 'string' && authorization.trim()) {
    headers.Authorization = authorization.trim();
  }
  return headers;
}

module.exports = { graphRagAuthHeaders };
