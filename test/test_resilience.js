'use strict';

const assert = require('assert');
const http = require('http');
const { fetchFeed } = require('../src/feeds');
const { translateText } = require('../src/translate');

let passed = 0;
let failed = 0;

function logResult(testName, success, detail) {
  if (success) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}: ${detail}`);
    failed++;
  }
}

/**
 * Helper: create an HTTP server with a given handler.
 * Returns { server, port } after the server is listening.
 */
function createMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/**
 * Helper: build a minimal valid RSS XML string with given items.
 */
function buildRSS(title, items) {
  const itemXml = items.map(it => `
    <item>
      <title>${it.title}</title>
      <description>${it.description || ''}</description>
      <link>${it.link || 'http://example.com'}</link>
      <pubDate>${it.pubDate || new Date().toUTCString()}</pubDate>
    </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    ${itemXml}
  </channel>
</rss>`;
}

async function runTests() {
  console.log('Starting resilience tests...\n');

  // ===================================================================
  // Test 1: fetchFeed times out for a hanging server
  // ===================================================================
  console.log('Test 1: fetchFeed timeout on hanging server');
  {
    const { server, port } = await createMockServer((req, res) => {
      // Never respond — simulates a hanging feed
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<rss><channel><title>Slow</title></channel></rss>');
      }, 30000); // 30s — way beyond the 4.5s timeout
    });

    const slowSource = {
      id: 'slow',
      name: 'Slow Mock',
      country: 'US',
      language: 'en',
      feedUrl: `http://localhost:${port}/rss`,
      fallbackUrl: null,
      defaultCategory: 'world'
    };

    const startTime = Date.now();
    const results = await fetchFeed(slowSource);
    const duration = Date.now() - startTime;

    logResult(
      `fetchFeed returns empty in <5.5s (took ${duration}ms)`,
      duration < 5500 && Array.isArray(results) && results.length === 0,
      `duration=${duration}ms, results=${JSON.stringify(results)}`
    );

    server.close();
  }

  // ===================================================================
  // Test 2: Full API flow — one feed hangs, other feeds still return
  // ===================================================================
  console.log('\nTest 2: API returns healthy feeds even when one feed hangs');
  {
    // Create a hanging feed server (never responds)
    const { server: hangingServer, port: hangingPort } = await createMockServer((req, res) => {
      // Never respond within the timeout period
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<rss><channel><title>Hanging</title></channel></rss>');
      }, 30000);
    });

    // Create a healthy feed server (responds immediately)
    const healthyRSS = buildRSS('Healthy Feed', [
      { title: 'Healthy Article 1', description: 'Description 1' },
      { title: 'Healthy Article 2', description: 'Description 2' },
      { title: 'Healthy Article 3', description: 'Description 3' },
    ]);

    const { server: healthyServer, port: healthyPort } = await createMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(healthyRSS);
    });

    const hangingSource = {
      id: 'hanging',
      name: 'Hanging Feed',
      country: 'US',
      language: 'en',
      feedUrl: `http://localhost:${hangingPort}/rss`,
      fallbackUrl: null,
      defaultCategory: 'world'
    };

    const healthySource = {
      id: 'healthy',
      name: 'Healthy Feed',
      country: 'UK',
      language: 'en',
      feedUrl: `http://localhost:${healthyPort}/rss`,
      fallbackUrl: null,
      defaultCategory: 'world'
    };

    // Fetch both in parallel using Promise.allSettled (same pattern as fetchAllFeeds)
    const startTime = Date.now();
    const results = await Promise.allSettled([
      fetchFeed(hangingSource),
      fetchFeed(healthySource)
    ]);
    const duration = Date.now() - startTime;

    const articles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    logResult(
      `Returns articles from healthy feed (got ${articles.length} articles)`,
      articles.length >= 3,
      `Expected >=3 articles, got ${articles.length}`
    );

    logResult(
      `Completes within 6s even with hanging feed (took ${duration}ms)`,
      duration < 6000,
      `Took ${duration}ms`
    );

    // Verify articles are from the healthy feed
    const healthyArticles = articles.filter(a => a.sourceId === 'healthy');
    logResult(
      `All returned articles are from healthy source`,
      healthyArticles.length === articles.length && healthyArticles.length > 0,
      `Healthy: ${healthyArticles.length}, Total: ${articles.length}`
    );

    hangingServer.close();
    healthyServer.close();
  }

  // ===================================================================
  // Test 3: translateText timeout — translation falls through gracefully
  // ===================================================================
  console.log('\nTest 3: translateText handles errors gracefully');
  {
    // translateText should return original text when translation fails.
    // Since google-translate-api-x will fail in a test environment (no real API),
    // the function should fall through to the fallback chain and ultimately
    // return the original text without hanging.
    const originalText = 'Test resilience text for translation';
    const startTime = Date.now();

    const result = await translateText(originalText, 'fr');
    const duration = Date.now() - startTime;

    // The translation should either translate successfully OR return original text,
    // but must NOT hang. The timeout is 4 seconds for Google + 5 seconds for LibreTranslate.
    // In a test env both should fail quickly (connection refused), so total should be fast.
    logResult(
      `translateText completes within 12s (took ${duration}ms)`,
      duration < 12000,
      `Took ${duration}ms, expected < 12000ms`
    );

    logResult(
      `translateText returns a non-empty string`,
      typeof result === 'string' && result.length > 0,
      `Got: ${JSON.stringify(result)}`
    );
  }

  // ===================================================================
  // Test 4: fetchFeed handles immediate connection errors gracefully
  // ===================================================================
  console.log('\nTest 4: fetchFeed handles connection-refused gracefully');
  {
    const deadSource = {
      id: 'dead',
      name: 'Dead Feed',
      country: 'US',
      language: 'en',
      feedUrl: 'http://localhost:1/rss', // Port 1 — connection refused
      fallbackUrl: null,
      defaultCategory: 'world'
    };

    const startTime = Date.now();
    const results = await fetchFeed(deadSource);
    const duration = Date.now() - startTime;

    logResult(
      `Returns empty array immediately on connection error (took ${duration}ms)`,
      Array.isArray(results) && results.length === 0 && duration < 5000,
      `duration=${duration}ms, results length=${results.length}`
    );
  }

  // ===================================================================
  // Test 5: fetchFeed with fallback — primary fails, fallback succeeds
  // ===================================================================
  console.log('\nTest 5: fetchFeed falls back to fallback URL when primary fails');
  {
    const fallbackRSS = buildRSS('Fallback Feed', [
      { title: 'Fallback Article', description: 'From fallback' },
    ]);

    const { server: fallbackServer, port: fallbackPort } = await createMockServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(fallbackRSS);
    });

    const sourceWithFallback = {
      id: 'fallback_test',
      name: 'Fallback Test',
      country: 'DE',
      language: 'en',
      feedUrl: 'http://localhost:1/rss', // Primary: dead
      fallbackUrl: `http://localhost:${fallbackPort}/rss`, // Fallback: healthy
      defaultCategory: 'world'
    };

    const results = await fetchFeed(sourceWithFallback);

    logResult(
      `Returns articles from fallback URL (got ${results.length})`,
      results.length >= 1 && results[0].title === 'Fallback Article',
      `Got: ${JSON.stringify(results.map(r => r.title))}`
    );

    fallbackServer.close();
  }

  // ===================================================================
  // Summary
  // ===================================================================
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
