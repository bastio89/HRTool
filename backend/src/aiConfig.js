const db = require('./database');

// Default values used when neither the DB settings nor env vars are configured.
const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

function readSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row?.value?.trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Central AI (LLM) configuration resolver.
 *
 * Precedence: DB settings (admin-configurable) → environment variables → hardcoded defaults.
 * `host.docker.internal` is normalized to `localhost` so the URL works both inside
 * and outside of Docker.
 *
 * @returns {{ baseUrl: string, model: string, source: { baseUrl: string, model: string } }}
 */
function getAiConfig() {
  const dbBaseUrl = readSetting('ai_base_url');
  const dbModel = readSetting('ai_model');

  const envBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || null;
  const envModel = process.env.OLLAMA_MODEL?.trim() || null;

  const rawBaseUrl = dbBaseUrl || envBaseUrl || DEFAULT_BASE_URL;
  const model = dbModel || envModel || DEFAULT_MODEL;

  const baseUrl = rawBaseUrl.replace('host.docker.internal', 'localhost').replace(/\/+$/, '');

  return {
    baseUrl,
    model,
    source: {
      baseUrl: dbBaseUrl ? 'settings' : envBaseUrl ? 'env' : 'default',
      model: dbModel ? 'settings' : envModel ? 'env' : 'default',
    },
  };
}

module.exports = { getAiConfig, DEFAULT_BASE_URL, DEFAULT_MODEL };
