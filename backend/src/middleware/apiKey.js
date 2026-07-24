const crypto = require('crypto');

function constantTimeEquals(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));

  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function apiKeyAuth(req, res, next) {
  const configuredKey = process.env.EXTERNAL_API_KEY || process.env.PUBLIC_API_KEY;
  if (!configuredKey) {
    return res.status(503).json({ error: 'Externe API ist nicht konfiguriert. Bitte EXTERNAL_API_KEY setzen.' });
  }

  const providedKey = req.get('X-API-Key') || req.query?.api_key;
  if (!providedKey || !constantTimeEquals(providedKey, configuredKey)) {
    return res.status(401).json({ error: 'Ungueltiger oder fehlender API-Key' });
  }

  req.apiClient = { type: 'external', keyPrefix: configuredKey.slice(0, 6) };
  next();
}

module.exports = apiKeyAuth;