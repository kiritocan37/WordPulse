'use strict';

const express = require('express');
const router = express.Router();
const { FEED_SOURCES } = require('./feeds');
const { Cache } = require('./cache');
const { translateArticle } = require('./translate');
const { CACHE_TTL, DEFAULTS, LIMITS } = require('./config');
const { getProcessedArticles } = require('./services/articleService');

// GET /api/articles
router.get('/articles', async (req, res) => {
  // Set up abort controller for client disconnection
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    // Whitelists for query parameters
    const VALID_COUNTRIES = ['US', 'UK', 'QA', 'DE', 'FR'];
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

    const articles = await getProcessedArticles({
      countryFilter,
      categoryFilter,
      langFilter,
      abortSignal: abortController.signal
    });

    res.json(articles);
  } catch (err) {
    // Don't error on abort
    if (err.name !== 'AbortError') {
      console.error('Error fetching articles:', err);
      res.status(500).json({ error: 'Failed to fetch articles' });
    } else {
      // Client disconnected, send 499 if headers not sent
      if (!res.headersSent) {
        res.status(499).json({ error: 'Client closed request' });
      }
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
