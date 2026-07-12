const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const insertStmt = db.prepare(`
  INSERT INTO ai_logs (user_id, feature, model, model_version, prompt_hash, prompt, response, parsed_result, duration_ms, input_tokens, output_tokens, success, error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const logDir = path.join(__dirname, '..', 'data');
const logFilePath = path.join(logDir, 'ai-logs.jsonl');

function appendDebugLog(entry) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFilePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (err) {
    console.error('⚠️ AI-Log-Datei Fehler:', err.message);
  }
}

/**
 * Log an AI/LLM call for EU AI Act compliance (Art. 12).
 *
 * @param {Object} opts
 * @param {number|null}  opts.userId       - ID of the user who triggered the call
 * @param {string}       opts.feature      - 'matching' | 'cv-parser' | 'job-generator'
 * @param {string}       opts.model        - Model name (e.g. 'llama3.2')
 * @param {string|null}  opts.modelVersion - Optional version/tag
 * @param {string}       opts.prompt       - Full prompt sent to the model
 * @param {string}       opts.response     - Raw response text
 * @param {*}            opts.parsedResult - Parsed/structured result (will be JSON-stringified)
 * @param {number}       opts.durationMs   - Wall-clock time for the call in ms
 * @param {number|null}  opts.inputTokens  - Token count (if available)
 * @param {number|null}  opts.outputTokens - Token count (if available)
 * @param {boolean}      opts.success      - Whether the call succeeded
 * @param {string|null}  opts.errorMessage - Error message if failed
 */
function logAiCall(opts) {
  try {
    const promptHash = opts.prompt
      ? crypto.createHash('sha256').update(opts.prompt).digest('hex').slice(0, 16)
      : null;

    const parsedStr = opts.parsedResult != null
      ? (typeof opts.parsedResult === 'string' ? opts.parsedResult : JSON.stringify(opts.parsedResult))
      : null;

    const responseStr = opts.response != null
      ? (typeof opts.response === 'string' ? opts.response : JSON.stringify(opts.response))
      : null;

    insertStmt.run(
      opts.userId ?? null,
      opts.feature,
      opts.model ?? null,
      opts.modelVersion ?? null,
      promptHash,
      opts.prompt ?? null,
      responseStr,
      parsedStr,
      opts.durationMs ?? null,
      opts.inputTokens ?? null,
      opts.outputTokens ?? null,
      opts.success ? 1 : 0,
      opts.errorMessage ?? null,
    );

    appendDebugLog({
      ts: new Date().toISOString(),
      source: opts.source || (process.env.NODE_ENV === 'test' ? 'test' : 'runtime'),
      userId: opts.userId ?? null,
      feature: opts.feature,
      model: opts.model ?? null,
      modelVersion: opts.modelVersion ?? null,
      promptHash,
      prompt: opts.prompt ?? null,
      response: responseStr,
      parsedResult: parsedStr,
      durationMs: opts.durationMs ?? null,
      inputTokens: opts.inputTokens ?? null,
      outputTokens: opts.outputTokens ?? null,
      success: !!opts.success,
      errorMessage: opts.errorMessage ?? null,
    });
  } catch (err) {
    // Logging must never break the main flow
    console.error('⚠️ AI-Log Fehler:', err.message);
  }
}

module.exports = { logAiCall };
