'use strict';

const RSSParser = require('rss-parser');
const crypto = require('crypto');
const { CACHE_TTL, TIMEOUTS } = require('./config');
const { retryWithBackoff, CircuitBreaker } = require('./utils/retry');

// Optional fetch for article content (requires node-fetch, which is already used by rss-parser)
let fetch;
try {
  fetch = require('node-fetch');
} catch (e) {
  fetch = null;
}

// Constants for article fetch
const ARTICLE_FETCH_TIMEOUT_MS = 10000; // 10 seconds
const MAX_ARTICLE_CONTENT_LENGTH = 1024 * 1024; // 1MB

// Sources for which we do NOT attempt to fetch the article page (to avoid overreach)
// Add source IDs here if needed (e.g., sources that block bots or require complex JS)
const BLOCKED_SOURCES_FOR_FETCH = new Set([]);

let lastSuccessfulArticles = [];
let lastSuccessfulArticlesTimestamp = 0;
const LAST_SUCCESSFUL_TTL = CACHE_TTL.LAST_SUCCESSFUL; // 1 hour TTL for fallback cache

// Circuit breakers for each feed source to prevent cascading failures
const feedCircuitBreakers = new Map();

// Get or create circuit breaker for a feed source
function getFeedCircuitBreaker(sourceId) {
  if (!feedCircuitBreakers.has(sourceId)) {
    feedCircuitBreakers.set(sourceId, new CircuitBreaker({
      failureThreshold: 3,
      timeout: 60000, // 1 minute
      resetTimeout: 30000 // 30 seconds
    }));
  }
  return feedCircuitBreakers.get(sourceId);
}

const parser = new RSSParser({
  timeout: parseInt(process.env.RSS_TIMEOUT_MS) || TIMEOUTS.RSS_PARSER,
  headers: {
    'User-Agent': 'WorldPulse/1.0 (News Aggregator)'
  }
});

/**
 * Feed source configuration. Each source has a primary URL
 * and an optional fallback URL for resilience.
 */
const FEED_SOURCES = [
  {
    id: 'bbc',
    name: 'BBC World',
    country: 'UK',
    language: 'en',
    feedUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    fallbackUrl: null,
    defaultCategory: 'world'
  },
  {
    id: 'reuters',
    name: 'Reuters',
    country: 'US',
    language: 'en',
    feedUrl: 'https://www.reutersagency.com/feed/',
    fallbackUrl: null,
    defaultCategory: 'world'
  },
  {
    id: 'aljazeera',
    name: 'Al Jazeera',
    country: 'QA',
    language: 'en',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    fallbackUrl: null,
    defaultCategory: 'world'
  },
  {
    id: 'dw',
    name: 'Deutsche Welle',
    country: 'DE',
    language: 'de',
    feedUrl: 'https://rss.dw.com/xml/rss-de-all',
    fallbackUrl: 'https://rss.dw.com/xml/rss-de-news',
    defaultCategory: 'world'
  },
  {
    id: 'lemonde',
    name: 'Le Monde',
    country: 'FR',
    language: 'fr',
    feedUrl: 'https://www.lemonde.fr/rss/une.xml',
    fallbackUrl: null,
    defaultCategory: 'world'
  }
];

/**
 * Multilingual keyword maps for categorizing articles.
 * Includes terms in English, French, German, and Russian.
 * Fixed duplicates and improved keyword lists.
 */
const CATEGORY_KEYWORDS = {
  tech: [
    'tech', 'technology', 'digital', 'cyber', 'ai', 'artificial intelligence',
    'software', 'hardware', 'internet', 'startup', 'silicon valley', 'computing',
    'technologie', 'numerique', 'informatique',
    'technik', 'digital',
    'технологии', 'цифров', 'интернет', 'кибер'
  ],
  politics: [
    'politic', 'politics', 'government', 'election', 'parliament',
    'congress', 'senate', 'democrat', 'republican', 'diplomacy', 'minister',
    'politique', 'election', 'gouvernement',
    'politik', 'regierung', 'wahl', 'bundestag',
    'политик', 'выборы', 'правительств', 'парламент'
  ],
  culture: [
    'culture', 'art', 'music', 'film', 'cinema', 'book', 'theater',
    'entertainment', 'sport', 'football', 'olympic', 'festival',
    'musique', 'litterature',
    'kultur', 'kunst', 'musik', 'kino', 'sport',
    'культур', 'искусств', 'спорт', 'кино', 'музык'
  ],
  world: [
    'world', 'international', 'global', 'war', 'conflict', 'crisis',
    'monde', 'international',
    'welt', 'international',
    'мир', 'международн'
  ]
};

// Pre-compile regex patterns for categorization at module initialization
const CATEGORY_REGEXES = {};
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  CATEGORY_REGEXES[category] = keywords.map(kw => {
    // Escape special regex characters in keyword
    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedKw}\\b`, 'i');
  });
}

/**
 * Categorize an article using keyword matching against RSS categories,
 * title, and description text.
 * Uses word boundary matching for more accurate categorization.
 * @param {object} item - RSS feed item
 * @param {object} source - Source configuration
 * @returns {string} Category name (world, tech, politics, culture)
 */
function categorizeArticle(item, source) {
  const rawCats = (item.categories || []).map(c =>
    typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase()
  );

  const searchText = [
    ...rawCats,
    (item.title || '').toLowerCase(),
    (item.contentSnippet || item.content || item.summary || '').toLowerCase()
  ].join(' ');

  const scores = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    const regexes = CATEGORY_REGEXES[category];
    for (let i = 0; i < keywords.length; i++) {
      if (searchText.match(regexes[i])) {
        score++;
      }
    }
    scores[category] = score;
  }

  const best = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (best.length > 0) return best[0][0];
  return source.defaultCategory || 'world';
}

/**
 * Extract an image URL from an RSS item if available.
 * Checks enclosure, media:content, media:thumbnail, and img tags in content.
 * @param {object} item - RSS feed item
 * @returns {string|null}
 */
function extractImage(item) {
  if (item.enclosure && item.enclosure.url) return item.enclosure.url;

  if (item['media:content']) {
    const media = item['media:content'];
    // Handle @attributes in XML parsing
    if (media.$ && media.$.url) return media.$.url;
    if (media.url) return media.url;
  }

  if (item['media:thumbnail']) {
    const thumb = item['media:thumbnail'];
    if (thumb.$ && thumb.$.url) return thumb.$.url;
    if (thumb.url) return thumb.url;
  }

  if (item.content) {
    const match = item.content.match(/<img[^>]+src=["']([^"']+)["']/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Map an RSS item to our standardized article schema.
 * @param {object} item - RSS feed item
 * @param {object} source - Source configuration
 * @returns {Promise<object>} Promise resolving to standardized article object
 */
async function mapItemToArticle(item, source) {
  // Prefer the fullest content available: content (content:encoded), then contentSnippet, then summary
  let description = '';
  if (item.content) {
    description = item.content;
  } else if (item.contentSnippet) {
    description = item.contentSnippet;
  } else if (item.summary) {
    description = item.summary;
  }

  // Clean HTML tags from description
  description = description.replace(/<[^>]*>?/gm, '');

  // If description is too short and we have a link, optionally fetch article page
  if (description.length < 100 && item.link && fetch && !BLOCKED_SOURCES_FOR_FETCH.has(source.id)) {
    try {
      const fetchedContent = await fetchArticleContent(item.link, source.id);
      if (fetchedContent && fetchedContent.length > description.length) {
        description = fetchedContent;
      }
    } catch (err) {
      // If fetch fails, continue with original description
      console.debug(`Failed to fetch article content for ${item.link}: ${err.message}`);
    }
  }

  return {
    title: item.title || '',
    description: description,
    source: source.name,
    sourceId: source.id,
    country: source.country,
    category: categorizeArticle(item, source),
    pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
    link: item.link || '',
    originalLang: source.language,
    imageUrl: extractImage(item)
  };
}

const fetchWithTimeout = (url, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Feed timeout for ${url}`));
    }, timeoutMs);

    parser.parseURL(url)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
};

/**
 * Fetch article content from a URL and extract main text.
 * @param {string} url - Article URL
 * @param {string} sourceId - Source ID for logging
 * @returns {Promise<string|null>} Extracted text or null if failed
 */
async function fetchArticleContent(url, sourceId) {
  if (!fetch) return null;

  try {
    const response = await fetch(url, {
      timeout: ARTICLE_FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': 'WorldPulse/1.0 (News Aggregator)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Remove script and style tags
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Try to find article content by looking for semantic tags
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      text = articleMatch[1];
    } else {
      // Try to find main content div
      const mainMatch = html.match(/<div\b[^>]*\b(class|id)=["']([^"']*?(main|content|article|post|entry)[^"']*?)["'][^>]*>([\s\S]*?)<\/div>/i);
      if (mainMatch) {
        text = mainMatch[4];
      } else {
        // Fallback to body content
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
          text = bodyMatch[1];
        }
      }
    }

    // Strip all HTML tags and clean up whitespace
    text = text
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Limit length to prevent extremely long descriptions
    if (text.length > MAX_ARTICLE_CONTENT_LENGTH) {
      text = text.substring(0, MAX_ARTICLE_CONTENT_LENGTH) + '...';
    }

    return text.length > 0 ? text : null;
  } catch (err) {
    console.debug(`Failed to extract article content from ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch and parse a single RSS feed. Tries fallback URL on failure.
 * Uses retry mechanism and circuit breaker for resilience.
 * @param {object} source - Source configuration
 * @returns {Promise<object[]>} Array of article objects
 */
async function fetchFeed(source) {
  const circuitBreaker = getFeedCircuitBreaker(source.id);

  return circuitBreaker.execute(async () => {
    // Use retry mechanism for fetching feeds
    return retryWithBackoff(async () => {
      let feed;
      const TIMEOUT = parseInt(process.env.RSS_TIMEOUT_MS) || TIMEOUTS.RSS_FETCH; // Configurable timeout

      try {
        feed = await fetchWithTimeout(source.feedUrl, TIMEOUT);
      } catch (primaryErr) {
        console.error(`Feed failed for ${source.name} (${source.feedUrl}): ${primaryErr.message}`);
        if (source.fallbackUrl) {
          try {
            feed = await fetchWithTimeout(source.fallbackUrl, TIMEOUT);
          } catch (fallbackErr) {
            console.error(`Both feed and fallback failed for ${source.name}: ${fallbackErr.message}`);
            throw new Error(`Both feed URLs failed for ${source.name}`);
          }
        } else {
          throw new Error(`Feed URL failed for ${source.name}`);
        }
      }

      if (!feed || !feed.items) {
        throw new Error(`No items found in feed for ${source.name}`);
      }

      return feed.items.map(item => mapItemToArticle(item, source));
    }, {
      maxAttempts: 2,
      baseDelay: 500,
      maxDelay: 3000,
      retryConditions: [
        /timeout/i,
        /network/i,
        /fetch/i,
        /ECONNRESET/i,
        /ETIMEDOUT/i
      ]
    });
  });
}

/**
 * Fetch all feeds in parallel using Promise.allSettled for resilience.
 * Individual feed failures do not break the overall result.
 * @returns {Promise<object[]>} Combined and sorted array of articles
 */
async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    FEED_SOURCES.map(source => fetchFeed(source))
  );

  const articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Sort by publication date, newest first
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Update last successful articles with timestamp
  if (articles.length > 0) {
    lastSuccessfulArticles = articles;
    lastSuccessfulArticlesTimestamp = Date.now();
  } else if (Date.now() - lastSuccessfulArticlesTimestamp < LAST_SUCCESSFUL_TTL &&
             lastSuccessfulArticles.length > 0) {
    // Return cached articles if within TTL
    return [...lastSuccessfulArticles];
  }

  return articles;
}

module.exports = {
  FEED_SOURCES,
  fetchFeed,
  fetchAllFeeds,
  categorizeArticle,
  extractImage,
  mapItemToArticle,
  CATEGORY_KEYWORDS
};
