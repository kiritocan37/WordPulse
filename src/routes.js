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

    // Source Diversity: group by sourceId and take max 5 per source
    const articlesBySource = {};
    for (const a of articles) {
      if (!articlesBySource[a.sourceId]) {
        articlesBySource[a.sourceId] = [];
      }
      if (articlesBySource[a.sourceId].length < 5) {
        articlesBySource[a.sourceId].push(a);
      }
    }

    let diverseArticles = Object.values(articlesBySource).flat();
    diverseArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    const paginated = diverseArticles.slice(0, 30);
    const translatedArticles = [];
    const CONCURRENCY_LIMIT = 5;

    for (let i = 0; i < paginated.length; i += CONCURRENCY_LIMIT) {
      const chunk = paginated.slice(i, i + CONCURRENCY_LIMIT);
      const promises = chunk.map(a => translateArticle(a, lang));
      const results = await Promise.allSettled(promises);
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          translatedArticles.push(result.value);
        } else {
          console.error('Translation error:', result.reason);
          translatedArticles.push(chunk[index]); // Graceful fallback
        }
      });
    }

    res.json(translatedArticles);
  } catch (err) {
    console.error('Error fetching articles:', err);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// GET /api/sources
router.get('/sources', (req, res) => {
  res.json(FEED_SOURCES.map(s => ({
    id: s.id,
    name: s.name,
    country: s.country,
    language: s.language
  })));
});

module.exports = router;
