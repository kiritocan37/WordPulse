'use strict';

const Redis = require('ioredis');

/**
 * Redis-backed cache with TTL support and in-flight promise deduplication.
 * Falls back to in-memory cache if Redis is unavailable.
 */
class RedisCache {
  /**
   * @param {Object} options - Redis connection options
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 10 minutes)
   */
  constructor(options = {}, ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.inFlightPromises = new Map();
    this.useRedis = true;
    
    try {
      this.redis = new Redis(options);
      // Handle connection errors
      this.redis.on('error', (err) => {
        console.error('Redis connection error:', err);
        this.useRedis = false;
      });
    } catch (err) {
      console.warn('Failed to initialize Redis, falling back to in-memory cache:', err);
      this.useRedis = false;
      this.store = new Map();
      
      // Setup in-memory cleanup interval
      const interval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
          if (now - entry.timestamp > this.ttlMs) {
            this.store.delete(key);
          }
        }
      }, this.ttlMs / 2);
      
      if (interval.unref) {
          interval.unref();
      }
    }
  }

  /**
   * Retrieve cached data by key. Returns null if expired or not found.
   * @param {string} key
   * @returns {Promise<*|null>}
   */
  async get(key) {
    if (!this.useRedis) {
      // In-memory fallback
      const entry = this.store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.store.delete(key);
        return null;
      }
      return entry.data;
    }

    try {
      const cached = await this.redis.get(key);
      if (cached === null) return null;
      
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp > this.ttlMs) {
        await this.redis.del(key);
        return null;
      }
      return parsed.data;
    } catch (err) {
      console.error('Redis get error:', err);
      this.useRedis = false; // Fallback to in-memory for future operations
      return null;
    }
  }

  /**
   * Store data with the current timestamp.
   * @param {string} key
   * @param {*} data
   * @returns {Promise<void>}
   */
  async set(key, data) {
    if (!this.useRedis) {
      // In-memory fallback
      this.store.set(key, {
        data,
        timestamp: Date.now()
      });
      return;
    }

    try {
      const value = JSON.stringify({
        data,
        timestamp: Date.now()
      });
      await this.redis.setex(key, Math.ceil(this.ttlMs / 1000), value);
    } catch (err) {
      console.error('Redis set error:', err);
      this.useRedis = false; // Fallback to in-memory for future operations
      // Store in-memory as backup
      if (!this.store) this.store = new Map();
      this.store.set(key, {
        data,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Check whether a cached entry is stale or missing.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async isStale(key) {
    if (!this.useRedis) {
      // In-memory fallback
      const entry = this.store.get(key);
      if (!entry) return true;
      return Date.now() - entry.timestamp > this.ttlMs;
    }

    try {
      const cached = await this.redis.get(key);
      if (cached === null) return true;
      
      const parsed = JSON.parse(cached);
      return Date.now() - parsed.timestamp > this.ttlMs;
    } catch (err) {
      console.error('Redis isStale error:', err);
      this.useRedis = false; // Fallback to in-memory
      return true; // Assume stale to force refresh
    }
  }

  /**
   * Get the age of a cached entry in milliseconds.
   * @param {string} key
   * @returns {Promise<number|null>}
   */
  async getAge(key) {
    if (!this.useRedis) {
      // In-memory fallback
      const entry = this.store.get(key);
      if (!entry) return null;
      return Date.now() - entry.timestamp;
    }

    try {
      const cached = await this.redis.get(key);
      if (cached === null) return null;
      
      const parsed = JSON.parse(cached);
      return Date.now() - parsed.timestamp;
    } catch (err) {
      console.error('Redis getAge error:', err);
      this.useRedis = false; // Fallback to in-memory
      return null;
    }
  }

  /**
   * Remove all entries from the cache.
   * @returns {Promise<void>}
   */
  async clear() {
    if (!this.useRedis) {
      // In-memory fallback
      this.store.clear();
      return;
    }

    try {
      await this.redis.flushdb();
    } catch (err) {
      console.error('Redis clear error:', err);
      this.useRedis = false; // Fallback to in-memory
      if (this.store) this.store.clear();
    }
  }

  /**
   * Retrieve cached data, or fetch it if missing/stale.
   * Prevents cache stampedes by sharing the in-flight promise.
   * @param {string} key
   * @param {Function} fetchFn - Async function returning the data
   * @returns {Promise<*>}
   */
  async getOrFetch(key, fetchFn) {
    // First check if we have a valid cached value
    const cached = await this.get(key);
    if (cached !== null) return cached;

    if (this.inFlightPromises.has(key)) {
      return this.inFlightPromises.get(key);
    }

    const promise = fetchFn().then(async (data) => {
      await this.set(key, data);
      this.inFlightPromises.delete(key);
      return data;
    }).catch(async (err) => {
      this.inFlightPromises.delete(key);
      throw err;
    });

    this.inFlightPromises.set(key, promise);
    return promise;
  }
}

module.exports = { RedisCache };
