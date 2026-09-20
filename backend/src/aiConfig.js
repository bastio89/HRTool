const fs = require('fs');
const db = require('./database');
const { modelConfigService } = require('./modelConfigService');

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

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

function isRunningInDocker() {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv') || process.env.DOCKER_CONTAINER === 'true';
}

function resolveAiRuntimeBaseUrl(baseUrl) {
  const normalized = normalizeAiBaseUrl(baseUrl);
  if (!normalized || !isRunningInDocker()) return normalized;

  try {
    const url = new URL(normalized);
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      url.hostname = 'host.docker.internal';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Leave invalid URLs unchanged; the downstream fetch will report the real error.
  }

  return normalized;
}

function openAiApiBase(baseUrl) {
  return baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
}

/**
 * Central AI (LLM) configuration resolver.
 *
 * Configuration is read exclusively from the shared settings table.
 *
 * @returns {{ baseUrl: string, model: string, provider: string, source: object }}
 */
function getAiConfig() {
  const config = modelConfigService.getAiConfig();
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    embeddingModel: config.embeddingModel,
    provider: config.provider,
    apiKey: config.apiKey,
    reasoningLevel: config.reasoningLevel,
    loggingEnabled: config.loggingEnabled,
    source: config.source,
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
  const runtimeBaseUrl = resolveAiRuntimeBaseUrl(baseUrl);
  const cached = _providerCache.get(runtimeBaseUrl);
  if (cached && Date.now() - cached.at < PROVIDER_CACHE_TTL) return cached.provider;

  let detected = 'openai';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${runtimeBaseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.models)) detected = 'ollama';
    }
  } catch {}

  _providerCache.set(runtimeBaseUrl, { provider: detected, at: Date.now() });
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
  if (baseUrl) {
    _providerCache.delete(baseUrl);
    _providerCache.delete(resolveAiRuntimeBaseUrl(baseUrl));
    return;
  }
  _providerCache.clear();
}

function invalidateAiConfigCache() {
  modelConfigService.invalidate();
}

// ─── Unified request builder ──────────────────────────────────────────────────
/**
 * Build the fetch URL + body for an AI generation call.
 * @param {{ baseUrl, model, provider: 'ollama'|'openai', prompt, format, options }} params
 * @returns {{ url: string, body: object }}
 */
function buildAiRequest({ baseUrl, model, provider, prompt, format, options = {}, apiKey }) {
  const runtimeBaseUrl = resolveAiRuntimeBaseUrl(baseUrl);
  const headers = { 'Content-Type': 'application/json' };
  if (!apiKey) apiKey = getAiConfig().apiKey;
  if (provider === 'openai') {
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    if (typeof options.temperature === 'number') body.temperature = options.temperature;
    if (typeof options.num_predict === 'number') body.max_tokens = options.num_predict;
    if (format === 'json') body.response_format = { type: 'text' };
    if (runtimeBaseUrl.includes('openrouter.ai')) {
      const reasoningLevel = getAiConfig().reasoningLevel;
      body.reasoning = reasoningLevel === 'none' ? { enabled: false } : { effort: reasoningLevel };
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (runtimeBaseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'http://localhost:5173';
      headers['X-Title'] = process.env.OPENROUTER_APP_NAME || 'HRTool';
    }
    return { url: `${openAiApiBase(runtimeBaseUrl)}/chat/completions`, body, headers };
  }
  // Ollama
  const body = { model, prompt, stream: false, options };
  if (typeof body.options.think !== 'boolean') body.options.think = getAiConfig().reasoningLevel !== 'none';
  if (format) body.format = format;
  return { url: `${runtimeBaseUrl}/api/generate`, body, headers };
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
async function pingAiService(baseUrl, provider, timeoutMs = 5000, apiKey = null) {
  const runtimeBaseUrl = resolveAiRuntimeBaseUrl(baseUrl);
  if (!apiKey) apiKey = getAiConfig().apiKey;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = provider === 'openai' ? `${openAiApiBase(runtimeBaseUrl)}/models` : `${runtimeBaseUrl}/`;
    await fetch(url, { signal: ctrl.signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined });
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
async function fetchAiModels(baseUrl, provider, timeoutMs = 5000, apiKey = null) {
  const runtimeBaseUrl = resolveAiRuntimeBaseUrl(baseUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (provider === 'openai') {
      const res = await fetch(`${openAiApiBase(runtimeBaseUrl)}/models`, { signal: ctrl.signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // OpenAI /v1/models returns { data: [{id, ...}] }
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
      return list.map((m) => ({ name: m.id || m.name, size: null, modified_at: m.created ? new Date(m.created * 1000).toISOString() : null }));
    } else {
      const res = await fetch(`${runtimeBaseUrl}/api/tags`, { signal: ctrl.signal });
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

function normalizeModelName(model) {
  return String(model || '').trim().toLowerCase();
}

function isEmbeddingModelName(modelName) {
  const normalized = normalizeModelName(modelName);
  if (!normalized) return false;
  const searchable = normalized.replace(/[\s_\/-]+/g, ' ');

  const embeddingHints = [
    'embed',
    'embedding',
    'text-embedding',
    'text embedding',
    'all-minilm',
    'bge-',
    'e5-',
    'gte-',
    'nomic-',
    'mxbai-embed',
    'snowflake-arctic-embed',
    'instructor-',
    'jina-embeddings',
    'voyage-embedding',
    'multilingual-e5',
    'text2vec',
    'qwen3 embedding',
    'qwen embedding',
  ];

  return embeddingHints.some((hint) => normalized.includes(hint) || searchable.includes(hint));
}

function filterModelsByKind(models, kind = 'chat') {
  const normalizedKind = String(kind || 'chat').trim().toLowerCase();
  if (!Array.isArray(models)) return [];

  const mapped = models
    .map((model) => ({
      ...model,
      name: model?.name ? String(model.name).trim() : '',
    }))
    .filter((model) => model.name);

  if (normalizedKind === 'embedding') {
    const filtered = mapped.filter((model) => isEmbeddingModelName(model.name));
    return filtered;
  }

  return mapped;
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
  resolveAiRuntimeBaseUrl,
  buildAiRequest,
  extractAiText,
  pingAiService,
  fetchAiModels,
  filterModelsByKind,
  stripReasoningTags,
  OPENROUTER_BASE_URL,
  invalidateAiConfigCache,
};
