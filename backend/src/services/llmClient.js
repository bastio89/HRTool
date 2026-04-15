const DEFAULT_TIMEOUT_MS = 180000;

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getLlmConfig() {
  const explicitProvider = process.env.LLM_PROVIDER?.toLowerCase();
  const hasOpenAiKey = Boolean((process.env.OPENAI_API_KEY || '').trim());
  const provider = explicitProvider || (hasOpenAiKey ? 'openai' : 'ollama');

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const openAiBaseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || 'https://api.openai.com';
  const baseUrl = provider === 'openai' || provider === 'openai-compatible' ? openAiBaseUrl : ollamaBaseUrl;

  return {
    provider,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: process.env.LLM_MODEL || process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'llama3.2',
    apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_TOKEN || '',
    timeoutMs: parseInteger(process.env.LLM_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    pingTimeoutMs: parseInteger(process.env.LLM_PING_TIMEOUT_MS, 5000),
    allowJsonResponseFormat: parseBoolean(process.env.OPENAI_RESPONSE_FORMAT_JSON, false),
  };
}

function normalizeBaseUrl(url) {
  if (!url) return '';
  return String(url).replace(/\/+$/, '');
}

function buildRequestUrl(baseUrl, path) {
  const trimmedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  if (trimmedBase.endsWith('/v1') && normalizedPath.startsWith('v1/')) {
    return `${trimmedBase}/${normalizedPath.replace(/^v1\//, '')}`;
  }
  return `${trimmedBase}/${normalizedPath}`;
}

function readEnvValue(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function parseLlmRawResponse(provider, raw) {
  if (provider === 'ollama') {
    return {
      text: typeof raw?.response === 'string' ? raw.response : '',
      inputTokens: raw?.prompt_eval_count ?? null,
      outputTokens: raw?.eval_count ?? null,
    };
  }

  const text = Array.isArray(raw?.choices) && raw.choices.length > 0
    ? raw.choices[0]?.message?.content || ''
    : '';
  const usage = raw?.usage || {};
  return {
    text: typeof text === 'string' ? text : '',
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
  };
}

async function parseResponseBody(response) {
  const responseText = await response.text();
  try {
    return {
      text: responseText,
      json: responseText ? JSON.parse(responseText) : null,
    };
  } catch {
    return {
      text: responseText,
      json: null,
    };
  }
}

async function doFetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const parsed = await parseResponseBody(response);
    return { response, ...parsed };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkLlmHealth() {
  const cfg = getLlmConfig();
  const url = cfg.provider === 'openai' || cfg.provider === 'openai-compatible'
    ? buildRequestUrl(cfg.baseUrl, '/v1/models')
    : buildRequestUrl(cfg.baseUrl, '/');

  const headers = {};
  if (cfg.apiKey && (cfg.provider === 'openai' || cfg.provider === 'openai-compatible')) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }

  const result = await doFetchJson(url, {
    method: 'GET',
    headers,
  }, cfg.pingTimeoutMs);

  return {
    ok: result.response.ok,
    status: result.response.status,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    body: readEnvValue(result.text, null),
    responseText: result.text,
  };
}

async function callLlm({
  prompt,
  responseFormat = 'text',
  options = {},
  timeoutMs,
}) {
  const cfg = getLlmConfig();
  const providerOptions = { ...options };
  const model = readEnvValue(cfg.model, 'llama3.2');
  const requestTimeoutMs = parseInteger(timeoutMs, cfg.timeoutMs);
  const startedAt = Date.now();

  if (cfg.provider === 'ollama') {
    const requestBody = {
      model,
      prompt: String(prompt ?? ''),
      stream: false,
      options: {
        temperature: providerOptions.temperature ?? 0.2,
        ...(providerOptions.num_predict ? { num_predict: providerOptions.num_predict } : {}),
      },
    };

    if (responseFormat === 'json') {
      requestBody.format = 'json';
    }
    if (providerOptions.max_tokens) {
      requestBody.options.num_predict = providerOptions.max_tokens;
    }

    const { response, text, json } = await doFetchJson(buildRequestUrl(cfg.baseUrl, '/api/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }, requestTimeoutMs);

    const parsed = json || {};
    const rawText = text || '';
    const responseText = parseLlmRawResponse(cfg.provider, parsed).text || rawText;
    const tokenInfo = parseLlmRawResponse(cfg.provider, parsed);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      provider: cfg.provider,
      model,
      text: responseText,
      raw: parsed,
      inputTokens: tokenInfo.inputTokens,
      outputTokens: tokenInfo.outputTokens,
      durationMs: Date.now() - startedAt,
      rawResponseText: rawText,
    };
  }

  const messages = [
    {
      role: 'system',
      content: readEnvValue(process.env.LLM_SYSTEM_PROMPT, 'Du bist ein hilfreicher KI-Assistent für das HRTool und gib immer strukturierte, konkrete Ergebnisse aus.'),
    },
    {
      role: 'user',
      content: String(prompt ?? ''),
    },
  ];

  const requestBody = {
    model,
    messages,
    temperature: providerOptions.temperature ?? 0.2,
    stream: false,
  };
  if (providerOptions.max_tokens) {
    requestBody.max_tokens = providerOptions.max_tokens;
  }
  if (responseFormat === 'json' && cfg.allowJsonResponseFormat) {
    requestBody.response_format = { type: 'json_object' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }

  const { response, text, json } = await doFetchJson(buildRequestUrl(cfg.baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  }, requestTimeoutMs);

  const parsed = json || {};
  const bodyText = parseLlmRawResponse(cfg.provider, parsed).text || text;
  const tokenInfo = parseLlmRawResponse(cfg.provider, parsed);

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    provider: cfg.provider,
    model,
    text: bodyText,
    raw: parsed,
    inputTokens: tokenInfo.inputTokens,
    outputTokens: tokenInfo.outputTokens,
    durationMs: Date.now() - startedAt,
    rawResponseText: text,
  };
}

module.exports = {
  getLlmConfig,
  callLlm,
  checkLlmHealth,
};
