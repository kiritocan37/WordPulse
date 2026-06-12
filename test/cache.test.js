'use strict';

const { Cache } = require('../src/cache');
const sinon = require('sinon');
const assert = require('assert');

describe('Cache', function() {
  let cache;
  const ttlMs = 50; // Short TTL for testing

  beforeEach(function() {
    sinon.useFakeTimers();
    cache = new Cache(ttlMs);
  });

  afterEach(function() {
    sinon.restore();
  });

  describe('get()', function() {
    it('should return null for non-existent key', function() {
      assert.strictEqual(cache.get('non-existent'), null);
    });

    it('should return cached value for existing key', function() {
      const testValue = { foo: 'bar' };
      cache.set('test-key', testValue);
      assert.deepStrictEqual(cache.get('test-key'), testValue);
    });

    it('should return null for expired key', function() {
      const testValue = { foo: 'bar' };
      cache.set('test-key', testValue);

      // Fast-forward time past TTL
      sinon.clock.tick(ttlMs + 1);

      assert.strictEqual(cache.get('test-key'), null);
    });
  });

  describe('set()', function() {
    it('should store value with timestamp', function() {
      const testValue = { foo: 'bar' };
      cache.set('test-key', testValue);

      const entry = cache.store.get('test-key');
      assert.ok(entry);
      assert.deepStrictEqual(entry.data, testValue);
      assert.ok(entry.timestamp !== undefined);
      assert.ok(typeof entry.timestamp === 'number');
    });
  });

  describe('isStale()', function() {
    it('should return true for non-existent key', function() {
      assert.strictEqual(cache.isStale('non-existent'), true);
    });

    it('should return false for fresh key', function() {
      cache.set('test-key', { foo: 'bar' });
      assert.strictEqual(cache.isStale('test-key'), false);
    });

    it('should return true for expired key', function() {
      cache.set('test-key', { foo: 'bar' });
      sinon.clock.tick(ttlMs + 1);
      assert.strictEqual(cache.isStale('test-key'), true);
    });
  });

  describe('getAge()', function() {
    it('should return null for non-existent key', function() {
      assert.strictEqual(cache.getAge('non-existent'), null);
    });

    it('should return age in milliseconds for existing key', function() {
      cache.set('test-key', { foo: 'bar' });
      const initialAge = cache.getAge('test-key');
      assert.ok(initialAge >= 0 && initialAge < 10); // Should be very small

      sinon.clock.tick(20);
      const aged = cache.getAge('test-key');
      assert.ok(aged >= 20 && aged < 30);
    });
  });

  describe('clear()', function() {
    it('should remove all entries', function() {
      cache.set('key1', { foo: 'bar' });
      cache.set('key2', { baz: 'qux' });
      assert.strictEqual(cache.store.size, 2);

      cache.clear();
      assert.strictEqual(cache.store.size, 0);
    });
  });

  describe('getOrFetch()', function() {
    it('should return cached value if available', async function() {
      const testValue = { foo: 'bar' };
      cache.set('test-key', testValue);

      const fetchFn = sinon.fake.rejects(new Error('Should not be called'));
      const result = await cache.getOrFetch('test-key', fetchFn);

      assert.deepStrictEqual(result, testValue);
      assert.strictEqual(fetchFn.called, false);
    });

    it('should fetch and cache value if not available', async function() {
      const fetchValue = { fetched: 'value' };
      const fetchFn = sinon.fake.resolves(fetchValue);

      const result = await cache.getOrFetch('test-key', fetchFn);

      assert.deepStrictEqual(result, fetchValue);
      assert.strictEqual(fetchFn.calledOnce, true);

      // Should now be cached
      const cachedResult = await cache.getOrFetch('test-key', fetchFn);
      assert.deepStrictEqual(cachedResult, fetchValue);
      assert.strictEqual(fetchFn.calledOnce, true); // Still only called once
    });

    it('should handle fetch errors', async function() {
      const fetchFn = sinon.fake.rejects(new Error('Fetch failed'));

      try {
        await cache.getOrFetch('test-key', fetchFn);
        assert.fail('Expected function to throw');
      } catch (err) {
        assert.strictEqual(err.message, 'Fetch failed');
      }
    });
  });
});