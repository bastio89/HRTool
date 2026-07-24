const db = require('./database');

// Default values used when neither the DB settings nor env vars are configured.
const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_PROVIDER = 'auto'; // 'auto' | 'ollama' | 'openai'

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
 *
 * @returns {{ baseUrl: string, model: string, provider: string, source: object }}
 */
function getAiConfig() {
  const dbBaseUrl = readSetting('ai_base_url');
  const dbModel = readSetting('ai_model');
  const dbProvider = readSetting('ai_provider');

  const envBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || null;
  const envModel = process.env.OLLAMA_MODEL?.trim() || null;
  const envProvider = process.env.AI_PROVIDER?.trim() || null;

  const rawBaseUrl = dbBaseUrl || envBaseUrl || DEFAULT_BASE_URL;
  const model = dbModel || envModel || DEFAULT_MODEL;
  const provider = dbProvider || envProvider || DEFAULT_PROVIDER;

  const baseUrl = normalizeAiBaseUrl(rawBaseUrl);

  return {
    baseUrl,
    model,
    provider,
    source: {
      baseUrl: dbBaseUrl ? 'settings' : envBaseUrl ? 'env' : 'default',
      model: dbModel ? 'settings' : envModel ? 'env' : 'default',
      provider: dbProvider ? 'settings' : envProvider ? 'env' : 'default',
    },
  };
}

// ─── Provider detection cache (per baseUrl, TTL 5 min) ───────────────────────
const _providerCache = new Map();
const PROVIDER_CACHE_TTL = 5 * 60 * 1000;

/**
 * Detect whether the AI host speaks Ollama or OpenAI-compatible API.
 * Calls GET /api/tags; if the response contains {models: [...]} → 'ollama', else → 'openai'.
 * Result is cached per baseUrl for 5 minutes to avoid a round-trip on every AI call.
 *
 * @param {string} baseUrl
 * @returns {Promise<'ollama'|'openai'>}
 */
async function detectProvider(baseUrl) {
  const cached = _providerCache.get(baseUrl);
  if (cached && Date.now() - cached.at < PROVIDER_CACHE_TTL) return cached.provider;

  let detected = 'openai';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.models)) detected = 'ollama';
    }
  } catch {}

  _providerCache.set(baseUrl, { provider: detected, at: Date.now() });
  return detected;
}

/**
 * Resolve 'auto' to a concrete provider by detecting the API dialect.
 * @param {string} baseUrl
 * @param {string} configuredProvider  'auto' | 'ollama' | 'openai'
 * @returns {Promise<'ollama'|'openai'>}
 */
async function resolveAiProvider(baseUrl, configuredProvider) {
  if (configuredProvider === 'ollama' || configuredProvider === 'openai') return configuredProvider;
  return detectProvider(baseUrl);
}

/**
 * Invalidate the cached provider detection for a given base URL.
 * Call this after the user changes the AI host in settings.
 */
function invalidateProviderCache(baseUrl) {
  if (baseUrl) _providerCache.delete(baseUrl);
  else _providerCache.clear();
}

// ─── Unified request builder ──────────────────────────────────────────────────
/**
 * Build the fetch URL + body for an AI generation call.
 * @param {{ baseUrl, model, provider: 'ollama'|'openai', prompt, format, options }} params
 * @returns {{ url: string, body: object }}
 */
function buildAiRequest({ baseUrl, model, provider, prompt, format, options = {} }) {
  if (provider === 'openai') {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.num_predict === 'number') body.max_tokens = options.num_predict;
    if (format === 'json') body.response_format = { type: 'text' };
    return { url: `${baseUrl}/v1/chat/completions`, body };
  }
  // Ollama
  const body = { model, prompt, stream: false, options };
  if (format) body.format = format;
  return { url: `${baseUrl}/api/generate`, body };
}

/**
 * Extract the text content and token counts from an AI API response object.
 * @param {object} data  Parsed response JSON
 * @param {'ollama'|'openai'} provider
 * @returns {{ text: string, promptTokens: number|null, evalTokens: number|null }}
 */
function extractAiText(data, provider) {
  if (provider === 'openai') {
    return {
      text: data.choices?.[0]?.message?.content || '',
      promptTokens: data.usage?.prompt_tokens ?? null,
      evalTokens: data.usage?.completion_tokens ?? null,
    };
  }
  return {
    text: data.response || data.thinking || '',
    promptTokens: data.prompt_eval_count ?? null,
    evalTokens: data.eval_count ?? null,
  };
}

/**
 * Ping the AI service to check reachability. Uses the right health endpoint
 * for each provider dialect.
 * @param {string} baseUrl
 * @param {'ollama'|'openai'} provider  Must be resolved (not 'auto')
 * @param {number} timeoutMs
 */
async function pingAiService(baseUrl, provider, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = provider === 'openai' ? `${baseUrl}/v1/models` : `${baseUrl}/`;
    await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch the list of available models from the AI host.
 * @param {string} baseUrl
 * @param {'ollama'|'openai'} provider  Must be resolved (not 'auto')
 * @param {number} timeoutMs
 * @returns {Promise<Array<{name:string, size:number|null, modified_at:string|null}>>}
 */
async function fetchAiModels(baseUrl, provider, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (provider === 'openai') {
      const res = await fetch(`${baseUrl}/v1/models`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // OpenAI /v1/models returns { data: [{id, ...}] }
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      return list.map((m) => ({ name: m.id || m.name, size: null, modified_at: m.created ? new Date(m.created * 1000).toISOString() : null }));
    } else {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.models)
        ? data.models.map((m) => ({ name: m.name, size: m.size ?? null, modified_at: m.modified_at ?? null }))
        : [];
    }
  } finally {
    clearTimeout(t);
  }
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

module.exports = {
  getAiConfig,
  normalizeAiBaseUrl,
  resolveAiProvider,
  detectProvider,
  invalidateProviderCache,
  buildAiRequest,
  extractAiText,
  pingAiService,
  fetchAiModels,
  stripReasoningTags,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
};
