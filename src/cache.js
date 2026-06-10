'use strict';

/**
 * Generic in-memory cache with TTL support.
 * Uses a Map for O(1) lookups and insertion-order tracking.
 */
class Cache {
  /**
   * @param {number} ttlMs - Time-to-live in milliseconds (default: 10 minutes)
   */
  constructor(ttlMs = 10 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.store = new Map();
    this.inFlightPromises = new Map();

    // Prevent memory leaks by periodically evicting expired keys
    // .unref() ensures this background interval doesn't prevent Node from exiting
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now - entry.timestamp > this.ttlMs) {
          this.store.delete(key);
        }
      }
    }, this.ttlMs / 2); // Run eviction check twice per TTL window
    
    if (interval.unref) {
        interval.unref();
    }
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
   * Prevents cache stampedes by sharing the in-flight promise.
   * @param {string} key
   * @param {Function} fetchFn - Async function returning the data
   * @returns {Promise<*>}
   */
  async getOrFetch(key, fetchFn) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    if (this.inFlightPromises.has(key)) {
      return this.inFlightPromises.get(key);
    }

    const promise = fetchFn().then(data => {
      this.set(key, data);
      this.inFlightPromises.delete(key);
      return data;
    }).catch(err => {
      this.inFlightPromises.delete(key);
      throw err;
    });

    this.inFlightPromises.set(key, promise);
    return promise;
  }
}

module.exports = { Cache };
