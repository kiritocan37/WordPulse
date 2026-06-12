'use strict';

const express = require('express');
const router = express.Router();
const { fetchAllFeeds, FEED_SOURCES } = require('./feeds');
const { Cache } = require('./cache');
const { translateArticle } = require('./translate');

// In-memory cache for RSS feeds (10 minutes TTL)
const articleCache = new Cache(10 * 60 * 1000);
const CACHE_KEY = 'all_articles';

/**
 * Fetch articles, either from cache or directly from RSS.
 */
async function getArticles() {
  return articleCache.getOrFetch(CACHE_KEY, () => fetchAllFeeds());
}

// GET /api/articles
router.get('/articles', async (req, res) => {
  // Set up abort controller for client disconnection
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const country = req.query.country || '';
    const category = req.query.category || '';
    const lang = req.query.lang || 'en';

    let articles = await getArticles();

    // Filter by country
    if (country) {
      articles = articles.filter(a => a.country.toLowerCase() === country.toLowerCase());
    }

    // Filter by category
    if (category) {
      articles = articles.filter(a => a.category.toLowerCase() === category.toLowerCase());
    }

    // Improved Source Diversity: for each source, take top 5 most recent articles
    const articlesBySource = {};
    for (const a of articles) {
      if (!articlesBySource[a.sourceId]) {
        articlesBySource[a.sourceId] = [];
      }
      articlesBySource[a.sourceId].push(a);
    }

    // Sort each source's articles by date (newest first) and take top 5
    const diverseArticles = Object.values(articlesBySource)
      .map(sourceArticles =>
        sourceArticles
          .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
          .slice(0, 5)
      )
      .flat()
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)); // Global sort by date

    const paginated = diverseArticles.slice(0, 30);
    const translatedArticles = [];
    const CONCURRENCY_LIMIT = 5;

    for (let i = 0; i < paginated.length; i += CONCURRENCY_LIMIT) {
      if (abortController.signal.aborted) {
        return;
      }

      const chunk = paginated.slice(i, i + CONCURRENCY_LIMIT);
      const promises = chunk.map(a => translateArticle(a, lang, abortController.signal));
      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          translatedArticles.push(result.value);
        } else {
          // Don't treat AbortError as an error - it's expected when client disconnects
          if (result.reason && result.reason.name !== 'AbortError') {
            console.error('Translation error:', result.reason.message || result.reason);
          }
          translatedArticles.push(chunk[index]); // Graceful fallback
        }
      });
    }

    res.json(translatedArticles);
  } catch (err) {
    // Don't error on abort
    if (err.name !== 'AbortError') {
      console.error('Error fetching articles:', err);
      res.status(500).json({ error: 'Failed to fetch articles' });
    }
  }
});

// GET /api/sources
router.get('/sources', (req, res) => {
  try {
    res.json(FEED_SOURCES.map(s => ({
      id: s.id,
      name: s.name,
      country: s.country,
      language: s.language
    })));
  } catch (err) {
    console.error('Error in /sources handler:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
