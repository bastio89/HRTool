/**
 * Prompt-Injection-Schutz (EU AI Act Art. 9 — Risikomanagement)
 * 
 * Sanitizes user inputs before they reach the LLM to prevent:
 * - System prompt override attempts
 * - Role/persona injection
 * - Instruction manipulation
 * - Data exfiltration attempts
 * - Encoded injection patterns
 */

// Known injection patterns (case-insensitive)
const INJECTION_PATTERNS = [
  // System prompt overrides
  /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)/i,
  /\bforget\s+(everything|all|your)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bact\s+as\s+(if\s+you\s+are|a)\b/i,
  /\bpretend\s+(you\s+are|to\s+be)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\bsystem\s*:\s*you\b/i,
  /\brole\s*:\s*(system|assistant|admin)/i,
  
  // Data exfiltration
  /\b(show|reveal|display|print|output)\s+(the|your|all)\s+(system|internal|secret|hidden|original)\s+(prompt|instructions?|configuration|data)/i,
  /\bwhat\s+(are|is)\s+your\s+(instructions?|rules?|system\s+prompt|configuration)/i,
  
  // Command injection
  /\b(execute|run|eval)\s*\(/i,
  /\bimport\s+os\b/i,
  /\b__[a-z]+__\b/i,
  /\{\{.*\}\}/,  // Template injection
  
  // Base64/encoding tricks
  /\batob\s*\(/i,
  /\bbase64\s*(decode|encode)/i,
  /\bfrom_base64/i,
];

// Characters/sequences to sanitize
const DANGEROUS_SEQUENCES = [
  { pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, replacement: '' },  // Control chars
  { pattern: /\r\n/g, replacement: '\n' },  // Normalize line endings
];

// Maximum prompt input lengths per feature
const MAX_LENGTHS = {
  'matching': 5000,
  'job-generator': 2000,
  'email-template': 1000,
  'interview-questions': 2000,
  'cv-parser': 10000,
  'default': 3000,
};

/**
 * Sanitize a text input for LLM usage
 * @param {string} text - Raw user input
 * @param {string} feature - AI feature name
 * @returns {{ sanitized: string, warnings: string[] }}
 */
function sanitizePromptInput(text, feature = 'default') {
  if (!text || typeof text !== 'string') return { sanitized: '', warnings: [] };
  
  const warnings = [];
  let sanitized = text;
  
  // 1. Remove dangerous character sequences
  for (const { pattern, replacement } of DANGEROUS_SEQUENCES) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // 2. Check for injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      warnings.push(`Verdächtiges Muster erkannt: ${pattern.source.substring(0, 50)}`);
      // Remove the matched pattern
      sanitized = sanitized.replace(pattern, '[ENTFERNT]');
    }
  }
  
  // 3. Enforce length limits
  const maxLen = MAX_LENGTHS[feature] || MAX_LENGTHS['default'];
  if (sanitized.length > maxLen) {
    warnings.push(`Eingabe gekürzt: ${sanitized.length} → ${maxLen} Zeichen`);
    sanitized = sanitized.substring(0, maxLen);
  }
  
  // 4. Limit line count (prevent prompt flooding)
  const lines = sanitized.split('\n');
  if (lines.length > 200) {
    warnings.push(`Zeilenanzahl begrenzt: ${lines.length} → 200`);
    sanitized = lines.slice(0, 200).join('\n');
  }
  
  // 5. Trim excessive whitespace
  sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n').trim();
  
  return { sanitized, warnings };
}

/**
 * Sanitize all string fields in an object
 * @param {Object} obj - Object with string values
 * @param {string} feature - AI feature name
 * @returns {{ sanitized: Object, allWarnings: string[] }}
 */
function sanitizeObject(obj, feature = 'default') {
  const sanitized = {};
  const allWarnings = [];
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const result = sanitizePromptInput(value, feature);
      sanitized[key] = result.sanitized;
      if (result.warnings.length > 0) {
        allWarnings.push(...result.warnings.map(w => `${key}: ${w}`));
      }
    } else {
      sanitized[key] = value;
    }
  }
  
  return { sanitized, allWarnings };
}

/**
 * Express middleware — sanitizes req.body before AI endpoints
 * Usage: router.post('/endpoint', promptGuard('feature-name'), handler)
 */
function promptGuard(feature = 'default') {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') return next();
    
    const { sanitized, allWarnings } = sanitizeObject(req.body, feature);
    
    if (allWarnings.length > 0) {
      console.warn(`[PromptGuard] ${feature} — ${allWarnings.length} Warnung(en):`, allWarnings);
      
      // Log to audit if user available
      try {
        const db = require('../database');
        db.prepare(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_label, details) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(req.user?.id || null, req.user?.username || 'system', 'prompt-injection-blocked', 'ai', feature, JSON.stringify({ warnings: allWarnings }));
      } catch (_) {}
      
      // Check severity — if too many warnings, block the request
      if (allWarnings.length >= 3) {
        return res.status(400).json({
          error: 'Eingabe enthält verdächtige Muster und wurde blockiert (Prompt-Injection-Schutz)',
          warnings: allWarnings,
        });
      }
    }
    
    // Replace body with sanitized version
    req.body = sanitized;
    // Attach warnings for downstream logging
    req.promptWarnings = allWarnings;
    next();
  };
}

module.exports = { sanitizePromptInput, sanitizeObject, promptGuard };
