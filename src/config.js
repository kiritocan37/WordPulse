// Configuration file for WordPulse magic numbers and constants

/**
 * Timeouts and delays (in milliseconds)
 */
const TIMEOUTS = {
  RSS_PARSER: 4000,           // Timeout for RSS parser initialization
  RSS_FETCH: 4500,            // Timeout for fetching individual feeds
  TRANSLATION_PRIMARY: 4000,  // Timeout for primary translation service
  TRANSLATION_FALLBACK: 5000  // Timeout for LibreTranslate fallback
};

/**
 * Cache TTL values (in milliseconds)
 */
const CACHE_TTL = {
  ARTICLE_FEED: 10 * 60 * 1000,      // 10 minutes - RSS article cache
  TRANSLATION: 60 * 60 * 1000,       // 1 hour - Translation cache
  LAST_SUCCESSFUL: 60 * 60 * 1000    // 1 hour - Fallback cache for failed feeds
};

/**
 * Processing limits and counts
 */
const LIMITS = {
  TRANSLATION_CONCURRENCY: 5,        // Number of concurrent translations
  ARTICLES_PER_SOURCE: 5,            // Top articles per source for diversity
  MAX_PAGINATED_ARTICLES: 30,        // Maximum articles to return in feed
  RETRY_DELAY_MULTIPLIER: 50,        // Multiplier for exponential backoff
  MAX_RETRY_DELAY: 2000              // Maximum delay between retries (ms)
};

/**
 * Default values
 */
const DEFAULTS = {
  LANGUAGE: 'en',                    // Default language for translation
  ARTICLE_CACHE_KEY: 'all_articles'  // Cache key for article feed
};

/**
 * Cache key prefixes
 */
const CACHE_KEY_PREFIXES = {
  TRANSLATION: 'trans_'              // Prefix for translation cache keys
};

module.exports = {
  TIMEOUTS,
  CACHE_TTL,
  LIMITS,
  DEFAULTS,
  CACHE_KEY_PREFIXES
};
