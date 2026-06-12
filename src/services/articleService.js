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

  // Apply filters
  if (countryFilter) {
    articles = articles.filter(a => a.country === countryFilter);
  }
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
    if (abortSignal && abortSignal.aborted) {
      break; // Stop processing completely when aborted
    }

    const chunk = paginated.slice(i, i + CONCURRENCY_LIMIT);
    const promises = chunk.map(a => translateArticle(a, langFilter, abortSignal));
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

  return translatedArticles;
}

module.exports = {
  getProcessedArticles
};