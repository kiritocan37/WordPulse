'use strict';

const express = require('express');
const router = express.Router();
const { fetchAllFeeds, FEED_SOURCES } = require('./feeds');
const { Cache } = require('./cache');
const { translateArticle } = require('./translate');
const { CACHE_TTL, DEFAULTS, LIMITS } = require('./config');

// In-memory cache for RSS feeds (10 minutes TTL)
const articleCache = new Cache(CACHE_TTL.ARTICLE_FEED);
const CACHE_KEY = DEFAULTS.ARTICLE_CACHE_KEY;

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
    // Whitelists for query parameters
    const VALID_COUNTRIES = ['US', 'UK', 'QA', 'DE', 'FR', 'RU'];
    const VALID_CATEGORIES = ['world', 'tech', 'politics', 'culture'];
    const VALID_LANGS = ['en', 'fr', 'de', 'ru'];

    const countryParam = req.query.country;
    let countryFilter = '';
    if (countryParam && VALID_COUNTRIES.includes(countryParam.toUpperCase())) {
      countryFilter = countryParam.toUpperCase();
    }

    const categoryParam = req.query.category;
    let categoryFilter = '';
    if (categoryParam && VALID_CATEGORIES.includes(categoryParam.toLowerCase())) {
      categoryFilter = categoryParam.toLowerCase();
    }

    const langParam = req.query.lang;
    let langFilter = 'en';
    if (langParam && VALID_LANGS.includes(langParam.toLowerCase())) {
      langFilter = langParam.toLowerCase();
    }

    let articles = await getArticles();

    // Filter by country
    if (countryFilter) {
      articles = articles.filter(a => a.country === countryFilter);
    }

    // Filter by category
    if (categoryFilter) {
      articles = articles.filter(a => a.category === categoryFilter);
    }

    // Improved Source Diversity: for each source, take top LIMITS.ARTICLES_PER_SOURCE most recent articles
    const articlesBySource = {};
    for (const a of articles) {
      if (!articlesBySource[a.sourceId]) {
        articlesBySource[a.sourceId] = [];
      }
      articlesBySource[a.sourceId].push(a);
    }

    // Sort each source's articles by date (newest first) and take top LIMITS.ARTICLES_PER_SOURCE
    const diverseArticles = Object.values(articlesBySource)
      .map(sourceArticles =>
        sourceArticles
          .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
          .slice(0, LIMITS.ARTICLES_PER_SOURCE)
      )
      .flat()
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)); // Global sort by date

    const paginated = diverseArticles.slice(0, LIMITS.MAX_PAGINATED_ARTICLES);
    const translatedArticles = [];
    const CONCURRENCY_LIMIT = LIMITS.TRANSLATION_CONCURRENCY;

    for (let i = 0; i < paginated.length; i += CONCURRENCY_LIMIT) {
      // Skip processing if request was aborted
      if (abortController.signal.aborted) {
        break; // Stop processing completely when aborted
      }

      const chunk = paginated.slice(i, i + CONCURRENCY_LIMIT);
      const promises = chunk.map(a => translateArticle(a, langFilter, abortController.signal));
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
