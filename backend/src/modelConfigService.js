const db = require('./database');

const DEFAULT_CACHE_TTL_MS = 30_000;

class ModelConfigService {
  constructor(database, { ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
    this.db = database;
    this.ttlMs = Math.max(1_000, ttlMs);
    this.cache = new Map();
  }

  invalidate(task = null) {
    if (task) {
      this.cache.delete(task);
      return;
    }
    this.cache.clear();
  }

  getChatConfig() {
    return this._getConfig('chat');
  }

  getEmbeddingConfig() {
    return this._getConfig('embedding');
  }

  getAiConfig() {
    const chat = this.getChatConfig();
    const embedding = this.getEmbeddingConfig();
    return {
      ...chat,
      embeddingModel: embedding.model,
      source: {
        ...chat.source,
        embeddingModel: embedding.source.model,
      },
    };
  }

  _getConfig(task) {
    const now = Date.now();
    const cached = this.cache.get(task);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = this._loadConfig(task);
    this.cache.set(task, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  _loadConfig(task) {
    const rows = this._readSettings([
      'ai_base_url',
      'ai_model',
      'ai_embedding_model',
      'ai_provider',
      'ai_api_key',
      'ai_reasoning_level',
      'ai_log_llm_calls',
    ]);
    const provider = rows.ai_provider || 'auto';
    const normalizedProvider = provider.trim().toLowerCase();
    const baseUrl = this._normalizeBaseUrl(rows.ai_base_url || '');
    const model = task === 'embedding' ? (rows.ai_embedding_model || '') : (rows.ai_model || '');
    const reasoningLevel = ['none', 'low', 'medium', 'high'].includes(rows.ai_reasoning_level || '')
      ? rows.ai_reasoning_level
      : 'none';

    return {
      baseUrl,
      model,
      provider,
      apiKey: rows.ai_api_key || null,
      reasoningLevel,
      loggingEnabled: ['1', 'true', 'yes', 'on'].includes(String(rows.ai_log_llm_calls || '').trim().toLowerCase()),
      source: {
        baseUrl: rows.ai_base_url ? 'settings' : 'missing',
        model: task === 'embedding'
          ? (rows.ai_embedding_model ? 'settings' : 'missing')
          : (rows.ai_model ? 'settings' : 'missing'),
        provider: rows.ai_provider ? 'settings' : 'missing',
        apiKey: rows.ai_api_key ? 'settings' : 'missing',
        reasoningLevel: rows.ai_reasoning_level ? 'settings' : 'missing',
      },
      task,
      normalizedProvider,
    };
  }

  _readSettings(keys) {
    const filteredKeys = keys.filter((key) => typeof key === 'string' && key.trim());
    if (filteredKeys.length === 0) return {};

    const select = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    return filteredKeys.reduce((accumulator, key) => {
      const row = select.get(key);
      if (row && typeof row.value === 'string') {
        accumulator[key] = row.value.trim();
      }
      return accumulator;
    }, {});
  }

  _normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }
}

module.exports = {
  ModelConfigService,
  modelConfigService: new ModelConfigService(db),
};
