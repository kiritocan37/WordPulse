'use strict';

const { fetchAllFeeds } = require('../feeds');
const { Cache } = require('../cache');
const { translateArticle } = require('../translate');
const { CACHE_TTL, DEFAULTS, LIMITS } = require('../config');

// In-memory cache for RSS feeds (10 minutes TTL)
const articleCache = new Cache(CACHE_TTL.ARTICLE_FEED);
const CACHE_KEY = DEFAULTS.ARTICLE_CACHE_KEY;

/**
 * Fetch and process articles based on filters.
 * @param {Object} options - Options object
 * @param {string} [options.countryFilter] - Country code to filter by (e.g., 'US')
 * @param {string} [options.categoryFilter] - Category to filter by (e.g., 'tech')
 * @param {string} [options.langFilter] - Language to translate to (e.g., 'en', 'fr')
 * @param {AbortSignal} [options.abortSignal] - Signal to abort ongoing operations
 * @returns {Promise<Array>} Processed articles
 */
async function getProcessedArticles({ countryFilter, categoryFilter, langFilter = 'en', abortSignal }) {
  // Fetch articles (from cache or network)
  let articles = await articleCache.getOrFetch(CACHE_KEY, () => fetchAllFeeds());

  // Apply filters in a single pass (AND logic)
  if (countryFilter || categoryFilter) {
    articles = articles.filter(a =>
      (!countryFilter || a.country === countryFilter) &&
      (!categoryFilter || a.category === categoryFilter)
    );
  }

  // Sort all articles by date (newest first)
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

// Improved Source Diversity: take up to LIMITS.ARTICLES_PER_SOURCE per source, in date order
  const diverseArticles = [];
  const sourceCount = {};
  for (const article of articles) {
    const sourceId = article.sourceId;
    const count = sourceCount[sourceId] || 0;
    if (count < LIMITS.ARTICLES_PER_SOURCE) {
      diverseArticles.push(article);
      sourceCount[sourceId] = count + 1;
    }
  }

  const paginated = diverseArticles.slice(0, LIMITS.MAX_PAGINATED_ARTICLES);
  let translatedArticles = [];
  const CONCURRENCY_LIMIT = LIMITS.TRANSLATION_CONCURRENCY;

  // Worker pool for translation
  const queue = [...paginated];
  const results = new Array(queue.length);
  let index = 0;

  const worker = async () => {
    while (true) {
      // Check for abort signal
      if (abortSignal && abortSignal.aborted) {
        break;
      }

      // Get the next index to process
      const i = index++;
      if (i >= queue.length) {
        break; // No more articles to process
      }

      try {
        const translated = await translateArticle(queue[i], langFilter, abortSignal);
        results[i] = translated;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Translation error:', err.message || err);
        }
        // Graceful fallback: use original article
        results[i] = queue[i];
      }
    }
  };

  // Create workers
  const workers = [];
  for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
    workers.push(worker());
  }

  // Wait for all workers to finish
  await Promise.all(workers);

  // Add all results to translatedArticles (in order)
  translatedArticles = results.slice(0, index);

  return translatedArticles;
}

module.exports = {
  getProcessedArticles
};