/**
 * Simple in-memory rate limiter for AI endpoints (EU AI Act Art. 9 — Risikomanagement).
 * 
 * Limits requests per user per time window to prevent abuse of LLM resources.
 * No external dependencies needed — uses a Map with automatic cleanup.
 */

const rateBuckets = new Map();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.windowStart > bucket.windowMs * 2) {
      rateBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create a rate-limiting middleware.
 * @param {Object} opts
 * @param {number} opts.maxRequests - Max requests per window (default: 20)
 * @param {number} opts.windowMs   - Window in ms (default: 60000 = 1 min)
 * @param {string} opts.keyPrefix  - Prefix for the bucket key (default: 'ai')
 * @returns Express middleware
 */
function createRateLimiter({ maxRequests = 20, windowMs = 60000, keyPrefix = 'ai' } = {}) {
  return (req, res, next) => {
    const userId = req.user?.id || req.ip || 'anonymous';
    const key = `${keyPrefix}:${userId}`;
    const now = Date.now();

    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = { windowStart: now, count: 0, windowMs };
      rateBuckets.set(key, bucket);
    }

    bucket.count++;

    // Set rate-limit headers (standard)
    const remaining = Math.max(0, maxRequests - bucket.count);
    const resetAt = Math.ceil((bucket.windowStart + windowMs) / 1000);
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(resetAt));

    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Zu viele Anfragen. Bitte ${retryAfter} Sekunden warten.`,
        retryAfter,
      });
    }

    next();
  };
}

// Pre-configured limiters for different AI features
const aiRateLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60000, keyPrefix: 'ai' });
const matchingRateLimiter = createRateLimiter({ maxRequests: 5, windowMs: 60000, keyPrefix: 'matching' });
const generatorRateLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60000, keyPrefix: 'generator' });

module.exports = { createRateLimiter, aiRateLimiter, matchingRateLimiter, generatorRateLimiter };
