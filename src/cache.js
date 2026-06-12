'use strict';

// Use Redis cache when environment variables are provided, otherwise fall back to in-memory
const { RedisCache } = require('./cache-redis');
const { CACHE_TTL } = require('./config');

const cacheOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || null,
  db: process.env.REDIS_DB || 0,
  // Enable TLS for Upstash Redis
  tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
  // Disable lazy connect to catch connection errors early
  lazyConnect: false,
  // Enable keep alive for Upstash
  keepAlive: 30000,
  // Retry strategy for Upstash
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

// Determine if we should use Redis based on environment variables
const useRedis = process.env.REDIS_HOST || process.env.REDIS_URL;

// Metrics for cache performance
let cacheHits = 0;
let cacheMisses = 0;

let cache;
if (useRedis) {
  try {
    cache = new RedisCache(cacheOptions, CACHE_TTL.ARTICLE_FEED);
    console.log('Using Redis cache (Upstash compatible)');
  } catch (err) {
    console.warn('Failed to initialize Redis cache, falling back to in-memory:', err.message);
    cache = null;
  }
}

// Initialize in-memory cache as fallback or primary
if (!cache) {
  class Cache {
    /**
     * @param {number} ttlMs - Time-to-live in milliseconds
     */
    constructor(ttlMs) {
      this.ttlMs = ttlMs;
      this.store = new Map();
    }

    /**
     * Retrieve cached data by key. Returns null if expired or not found.
     * @param {string} key
     * @returns {*|null}
     */
    get(key) {
      const entry = this.store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.store.delete(key);
        return null;
      }
      return entry.data;
    }

    /**
     * Store data with the current timestamp.
     * @param {string} key
     * @param {*} data
     */
    set(key, data) {
      this.store.set(key, {
        data,
        timestamp: Date.now()
      });
    }

    /**
     * Check whether a cached entry is stale or missing.
     * @param {string} key
     * @returns {boolean}
     */
    isStale(key) {
      const entry = this.store.get(key);
      if (!entry) return true;
      return Date.now() - entry.timestamp > this.ttlMs;
    }

    /**
     * Get the age of a cached entry in milliseconds.
     * @param {string} key
     * @returns {number|null}
     */
    getAge(key) {
      const entry = this.store.get(key);
      if (!entry) return null;
      return Date.now() - entry.timestamp;
    }

    /**
     * Remove all entries from the cache.
     */
    clear() {
      this.store.clear();
    }

    /**
     * Retrieve cached data, or fetch it if missing/stale.
     * @param {string} key
     * @param {Function} fetchFn - Async function returning the data
     * @returns {Promise<*>}
     */
    async getOrFetch(key, fetchFn) {
      // First check if we have a valid cached value
      const cached = this.get(key);
      if (cached !== null) {
        cacheHits++;
        return cached;
      }

      // If not cached or stale, fetch new data
      cacheMisses++;
      const data = await fetchFn();
      this.set(key, data);
      return data;
    }

    /**
     * Get cache statistics
     * @returns {Object}
     */
    getStats() {
      const total = cacheHits + cacheMisses;
      return {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: total > 0 ? (cacheHits / total * 100).toFixed(2) + '%' : '0%'
      };
    }
  }

  cache = new Cache(CACHE_TTL);
  console.log('Using in-memory cache');
}

// Wrapper to track cache hits/misses for Redis as well
const originalGetOrFetch = cache.getOrFetch.bind(cache);
cache.getOrFetch = async (key, fetchFn) => {
  // Try to get from cache first to track hits
  try {
    const cached = await cache.get(key);
    if (cached !== null) {
      cacheHits++;
      return cached;
    }
  } catch (err) {
    // If Redis get fails, continue to fetch
    console.warn('Cache get failed, proceeding with fetch:', err.message);
  }

  // Fetch new data
  cacheMisses++;
  const data = await fetchFn();
  try {
    await cache.set(key, data);
  } catch (err) {
    console.warn('Cache set failed:', err.message);
  }
  return data;
};

module.exports = { Cache: cache.constructor, cache };