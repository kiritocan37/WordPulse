'use strict';

// Mock dependencies
const sinon = require('sinon');
const assert = require('assert');
const express = require('express');

describe('Routes', function() {
  let sandbox;
  let router;
  let mockFeedAllFeeds;
  let mockTranslateArticle;

  beforeEach(function() {
    sandbox = sinon.createSandbox();

    // Mock the dependencies
    mockFeedAllFeeds = sandbox.stub().resolves([
      {
        title: 'Test Article 1',
        description: 'Description 1',
        source: 'BBC',
        sourceId: 'bbc',
        country: 'UK',
        category: 'world',
        pubDate: 'Thu, 11 Jun 2026 12:00:00 GMT',
        link: 'https://example.com/1',
        originalLang: 'en',
        imageUrl: null
      },
      {
        title: 'Test Article 2',
        description: 'Description 2',
        source: 'Reuters',
        sourceId: 'reuters',
        country: 'US',
        category: 'tech',
        pubDate: 'Thu, 11 Jun 2026 11:00:00 GMT',
        link: 'https://example.com/2',
        originalLang: 'en',
        imageUrl: null
      }
    ]);

    mockTranslateArticle = sandbox.stub().callsFake((article) => Promise.resolve(article));

    // Require the routes module with mocked dependencies
    const proxyquire = require('proxyquire');
    const routesStub = proxyquire('../src/routes', {
      './feeds': {
        fetchAllFeeds: mockFeedAllFeeds,
        FEED_SOURCES: [
          { id: 'bbc', name: 'BBC', country: 'UK', language: 'en', defaultCategory: 'world' },
          { id: 'reuters', name: 'Reuters', country: 'US', language: 'en', defaultCategory: 'world' }
        ]
      },
      './cache': {
        Cache: function() {
          return {
            getOrFetch: function(key, fn) {
              return fn();
            }
          };
        }
      },
      './translate': { translateArticle: mockTranslateArticle },
      './config': {
        CACHE_TTL: { ARTICLE_FEED: 10 * 60 * 1000 },
        DEFAULTS: { ARTICLE_CACHE_KEY: 'all_articles' },
        LIMITS: {
          TRANSLATION_CONCURRENCY: 5,
          ARTICLES_PER_SOURCE: 5,
          MAX_PAGINATED_ARTICLES: 30
        }
      }
    });

    router = routesStub;
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('GET /articles', function() {
    it('should return articles with proper filtering', async function() {
      const req = {
        query: {},
        url: '/articles',
        on: sinon.stub().returnsThis()
      };
      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis()
      };

      return new Promise((resolve, reject) => {
        router(req, res, (err) => {
          if (err) {
            reject(err);
          } else {
            // Wait for async operations to complete
            setTimeout(() => {
              console.log('In setTimeout, about to resolve');
              resolve();
            }, 500);
          }
        });
      }).then(() => {
        console.log('In then, res.json.callCount:', res.json.callCount);
        if (res.json.called) {
          console.log('res.json.firstCall.args:', res.json.firstCall.args);
        }
        // Should have called json with articles
        assert.ok(res.json.calledOnce);

        // Get the articles that were passed to json
        const articlesArg = res.json.firstCall.args[0];
        assert.ok(Array.isArray(articlesArg));
        assert.ok(articlesArg.length > 0);
      });
    });

    it('should filter by country', async function() {
      const req = {
        query: { country: 'uk' },
        url: '/articles',
        on: sinon.stub().returnsThis()
      };
      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis()
      };

      return new Promise((resolve, reject) => {
        router(req, res, (err) => {
          if (err) {
            reject(err);
          } else {
            // Wait for async operations to complete
            setTimeout(() => resolve(), 100);
          }
        });
      }).then(() => {
        const articlesArg = res.json.firstCall.args[0];
        // All articles should have country UK (after filtering)
        articlesArg.forEach(article => {
          assert.strictEqual(article.country.toLowerCase(), 'uk');
        });
      });
    });

    it('should filter by category', async function() {
      const req = {
        query: { category: 'tech' },
        url: '/articles',
        on: sinon.stub().returnsThis()
      };
      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis()
      };

      return new Promise((resolve, reject) => {
        router(req, res, (err) => {
          if (err) {
            reject(err);
          } else {
            // Wait for async operations to complete
            setTimeout(() => resolve(), 100);
          }
        });
      }).then(() => {
        const articlesArg = res.json.firstCall.args[0];
        // All articles should have category tech (after filtering)
        articlesArg.forEach(article => {
          assert.strictEqual(article.category.toLowerCase(), 'tech');
        });
      });
    });

    it('should handle errors gracefully', async function() {
      // Make fetchAllFeeds reject
      mockFeedAllFeeds.reset();
      mockFeedAllFeeds.rejects(new Error('Feed error'));

      const req = {
        query: {},
        url: '/articles',
        on: sinon.stub().returnsThis()
      };
      const res = {
        json: sinon.stub(),
        status: sinon.stub().returnsThis()
      };

      return new Promise((resolve, reject) => {
        router(req, res, (err) => {
          if (err) {
            reject(err);
          } else {
            // Wait for async operations to complete
            setTimeout(() => resolve(), 100);
          }
        });
      }).then(() => {
        // Should have called status(500) and json with error
        assert.ok(res.status.calledWith(500));
        assert.ok(res.json.calledOnce);
        const errorArg = res.json.firstCall.args[0];
        assert.ok(errorArg.error);
      });
    });
  });

  describe('GET /sources', function() {
    it('should return sources', async function() {
      const req = {
        url: '/sources',
        on: sinon.stub().returnsThis()
      };
      const res = {
        json: sinon.stub()
      };

      return new Promise((resolve, reject) => {
        router(req, res, (err) => {
          if (err) {
            reject(err);
          } else {
            // Wait for async operations to complete
            setTimeout(() => resolve(), 100);
          }
        });
      }).then(() => {
        assert.ok(res.json.calledOnce);
        const sourcesArg = res.json.firstCall.args[0];
        assert.ok(Array.isArray(sourcesArg));
        assert.ok(sourcesArg.length > 0);

        // Check structure
        sourcesArg.forEach(source => {
          assert.ok(source.id);
          assert.ok(source.name);
          assert.ok(source.country);
          assert.ok(source.language);
        });
      });
    });
  });
});