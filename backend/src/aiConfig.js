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

function normalizeAiBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/**
 * Central AI (LLM) configuration resolver.
 *
 * Precedence: DB settings (admin-configurable) → environment variables → hardcoded defaults.
 * The URL is only trimmed and normalized; Docker-specific hosts such as
 * host.docker.internal must be preserved for container networking.
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

  const baseUrl = normalizeAiBaseUrl(rawBaseUrl);

  return {
    baseUrl,
    model,
    source: {
      baseUrl: dbBaseUrl ? 'settings' : envBaseUrl ? 'env' : 'default',
      model: dbModel ? 'settings' : envModel ? 'env' : 'default',
    },
  };
}

/**
 * Strip reasoning/thinking blocks emitted by models like Qwen3, DeepSeek-R1, etc.
 * Also strips markdown code fences. Returns clean text ready for JSON.parse().
 *
 * Handles:
 *   - <think>...</think>  (Qwen3, DeepSeek-R1)
 *   - <thinking>...</thinking>  (some DeepSeek variants)
 *   - ```json ... ```  (markdown code fences)
 */
function stripReasoningTags(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

module.exports = { getAiConfig, normalizeAiBaseUrl, stripReasoningTags, DEFAULT_BASE_URL, DEFAULT_MODEL };
