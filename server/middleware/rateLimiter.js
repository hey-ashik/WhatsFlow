/**
 * Lightweight sliding-window in-memory rate limiter middleware.
 * Zero external dependencies.
 */

function extractClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    const first = forwarded.split(',')[0].trim();
    if (first && first.length <= 45) return first;
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // default 1 minute
    this.max = options.max || 60; // default 60 requests per window
    this.keyGenerator = options.keyGenerator || null;
    this.keyByIp = Boolean(options.keyByIp);
    this.message = options.message || {
      success: false,
      error: 'Too many requests. Please slow down and try again later.'
    };
    this.hits = new Map(); // key -> Array of timestamps

    // Cleanup interval to prevent memory growth
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.max(this.windowMs, 30000));
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  getKey(req) {
    if (this.keyGenerator && typeof this.keyGenerator === 'function') {
      return this.keyGenerator(req);
    }

    const clientIp = extractClientIP(req);
    if (this.keyByIp) {
      return `ip:${clientIp}`;
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return `auth:${authHeader.replace('Bearer ', '').trim()}`;
    }

    const apiKey = req.headers['x-api-key'];
    if (apiKey && typeof apiKey === 'string') {
      return `key:${apiKey.trim()}`;
    }

    return `ip:${clientIp}`;
  }

  middleware() {
    return (req, res, next) => {
      const key = this.getKey(req);
      const now = Date.now();
      const timestamps = this.hits.get(key) || [];

      // Filter timestamps within current sliding window
      const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

      if (validTimestamps.length >= this.max) {
        res.setHeader('Retry-After', Math.ceil((validTimestamps[0] + this.windowMs - now) / 1000));
        res.setHeader('X-RateLimit-Limit', this.max);
        res.setHeader('X-RateLimit-Remaining', 0);
        return res.status(429).json(this.message);
      }

      validTimestamps.push(now);
      this.hits.set(key, validTimestamps);

      res.setHeader('X-RateLimit-Limit', this.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.max - validTimestamps.length));

      next();
    };
  }
}

// Preset Limiters
const authLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  keyByIp: true,
  message: { success: false, error: 'Too many authentication attempts. Please wait a minute.' }
}).middleware();

const messageDispatchLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, error: 'Message dispatch rate limit exceeded. Please throttle your requests.' }
}).middleware();

const apiGeneralLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: { success: false, error: 'API rate limit exceeded.' }
}).middleware();

module.exports = {
  RateLimiter,
  extractClientIP,
  authLimiter,
  messageDispatchLimiter,
  apiGeneralLimiter
};
