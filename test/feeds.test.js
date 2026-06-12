'use strict';

const { categorizeArticle, extractImage, mapItemToArticle, CATEGORY_KEYWORDS } = require('../src/feeds');
const sinon = require('sinon');
const assert = require('assert');

describe('Feeds', function() {
  let sandbox;

  beforeEach(function() {
    sandbox = sinon.createSandbox();
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('categorizeArticle()', function() {
    it('should categorize tech articles correctly', function() {
      const item = {
        title: 'New AI breakthrough in machine learning',
        contentSnippet: 'Scientists have developed a new neural network architecture',
        categories: []
      };
      const source = { defaultCategory: 'world' };

      const category = categorizeArticle(item, source);
      assert.strictEqual(category, 'tech');
    });

    it('should categorize politics articles correctly', function() {
      const item = {
        title: 'Election results show unexpected outcome',
        contentSnippet: 'Voters across the country participated in the parliamentary vote',
        categories: []
      };
      const source = { defaultCategory: 'world' };

      const category = categorizeArticle(item, source);
      assert.strictEqual(category, 'politics');
    });

    it('should use RSS categories when available', function() {
      const item = {
        title: 'Some article',
        contentSnippet: 'Some content',
        categories: ['Technology', 'Gadgets']
      };
      const source = { defaultCategory: 'world' };

      const category = categorizeArticle(item, source);
      assert.strictEqual(category, 'tech');
    });

    it('should fallback to source default category', function() {
      const item = {
        title: 'Uncategorized article',
        contentSnippet: 'Some random content',
        categories: []
      };
      const source = { defaultCategory: 'tech' };

      const category = categorizeArticle(item, source);
      assert.strictEqual(category, 'tech');
    });

    it('should use word boundaries to avoid false positives', function() {
      const item = {
        title: 'Technique for cooking',
        contentSnippet: 'This technique is useful in the kitchen',
        categories: []
      };
      const source = { defaultCategory: 'world' };

      const category = categorizeArticle(item, source);
      // Should NOT match 'tech' because 'technique' doesn't have 'tech' as a separate word
      assert.notStrictEqual(category, 'tech');
      assert.strictEqual(category, 'world');
    });
  });

  describe('extractImage()', function() {
    it('should extract image from enclosure', function() {
      const item = {
        enclosure: {
          url: 'https://example.com/image.jpg'
        }
      };

      const imageUrl = extractImage(item);
      assert.strictEqual(imageUrl, 'https://example.com/image.jpg');
    });

    it('should extract image from media:content', function() {
      const item = {
        'media:content': {
          url: 'https://example.com/media-image.jpg'
        }
      };

      const imageUrl = extractImage(item);
      assert.strictEqual(imageUrl, 'https://example.com/media-image.jpg');
    });

    it('should extract image from media:thumbnail', function() {
      const item = {
        'media:thumbnail': {
          url: 'https://example.com/thumb-image.jpg'
        }
      };

      const imageUrl = extractImage(item);
      assert.strictEqual(imageUrl, 'https://example.com/thumb-image.jpg');
    });

    it('should extract image from content img tag', function() {
      const item = {
        content: '<p>Some text <img src="https://example.com/content-image.jpg" alt="test"></p>'
      };

      const imageUrl = extractImage(item);
      assert.strictEqual(imageUrl, 'https://example.com/content-image.jpg');
    });

    it('should return null when no image found', function() {
      const item = {
        title: 'Article without image',
        description: 'Just some text'
      };

      const imageUrl = extractImage(item);
      assert.strictEqual(imageUrl, null);
    });
  });

  describe('mapItemToArticle()', function() {
    it('should map RSS item to article object correctly', function() {
      const item = {
        title: 'Test Article',
        contentSnippet: 'This is a test description',
        link: 'https://example.com/article',
        pubDate: 'Thu, 11 Jun 2026 12:00:00 GMT',
        enclosure: {
          url: 'https://example.com/image.jpg'
        }
      };

      const source = {
        id: 'test-source',
        name: 'Test Source',
        country: 'US',
        language: 'en',
        defaultCategory: 'tech'
      };

      const article = mapItemToArticle(item, source);

      assert.strictEqual(article.title, 'Test Article');
      assert.strictEqual(article.description, 'This is a test description');
      assert.strictEqual(article.source, 'Test Source');
      assert.strictEqual(article.sourceId, 'test-source');
      assert.strictEqual(article.country, 'US');
      assert.strictEqual(article.category, 'tech'); // Based on content matching
      assert.strictEqual(article.link, 'https://example.com/article');
      assert.strictEqual(article.originalLang, 'en');
      assert.strictEqual(article.imageUrl, 'https://example.com/image.jpg');
    });

    it('should handle missing fields gracefully', function() {
      const item = {
        title: 'Minimal Article'
      };

      const source = {
        id: 'minimal',
        name: 'Minimal Source',
        country: 'UK',
        language: 'en',
        defaultCategory: 'world'
      };

      const article = mapItemToArticle(item, source);

      assert.strictEqual(article.title, 'Minimal Article');
      assert.strictEqual(article.description, ''); // Empty string when no content
      assert.strictEqual(article.source, 'Minimal Source');
      assert.strictEqual(article.sourceId, 'minimal');
      assert.strictEqual(article.country, 'UK');
      assert.strictEqual(article.category, 'world');
      assert.strictEqual(article.link, '');
      assert.strictEqual(article.originalLang, 'en');
      assert.strictEqual(article.imageUrl, null);
    });
  });
});