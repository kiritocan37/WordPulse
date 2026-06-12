const translate = require('google-translate-api-x');
const crypto = require('crypto');
const { TIMEOUTS, CACHE_TTL } = require('./config');
const { retryWithBackoff, CircuitBreaker } = require('./utils/retry');

/**
 * Translate text using google-translate-api-x with fallback.
 * @param {string} text - The text to translate
 * @param {string} targetLang - The target language code (e.g., 'en', 'ru', 'uk')
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<string>} Translated text
 */
async function translateText(text, targetLang, signal) {
  if (!text) return text;

  // Normalize language codes (take first 2 letters for better matching)
  const normalizedTargetLang = targetLang.toLowerCase().substring(0, 2);

  // Mapping UA to UK for translation APIs
  const apiLang = normalizedTargetLang === 'ua' ? 'uk' : normalizedTargetLang;

  // Circuit breaker for translation service
  const translateCircuitBreaker = new CircuitBreaker({
    failureThreshold: 3,
    timeout: 60000, // 1 minute
    resetTimeout: 30000 // 30 seconds
  });

  return translateCircuitBreaker.execute(async () => {
    // Use retry mechanism for translation
    return retryWithBackoff(async () => {
      const res = await Promise.race([
        translate(text, { to: apiLang }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Google translate timed out after ${TIMEOUTS.TRANSLATION_PRIMARY}ms`)), TIMEOUTS.TRANSLATION_PRIMARY)
        )
      ]);
      return res.text;
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
  }).catch(async (err) => {
    console.error(`Google translate failed for "${text.substring(0, 20)}...": ${err.message}`);

    // Fallback: LibreTranslate (public instance) - configurable via env
    try {
      const libreTranslateUrl = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.de/translate';
      const controller = new AbortController();

      // Combine timeout with abort signal
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => {
          controller.abort();
          reject(new Error(`LibreTranslate timeout after ${TIMEOUTS.TRANSLATION_FALLBACK}ms`));
        }, TIMEOUTS.TRANSLATION_FALLBACK)
      );

      const fetchPromise = fetch(libreTranslateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: 'auto',
          target: apiLang,
          format: 'text'
        }),
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      // Note: timeoutId is not defined here, but the original code had it - removing clearTimeout for now

      if (response.ok) {
        const data = await response.json();
        return data.translatedText || text;
      } else {
        throw new Error(`LibreTranslate returned ${response.status}`);
      }
    } catch (fallbackErr) {
      // Ignore abort errors from signal
      if (fallbackErr.name !== 'AbortError') {
        console.error(`LibreTranslate fallback failed: ${fallbackErr.message}`);
      }

      // Return original text instead of throwing error to avoid breaking cache
      // This allows the system to continue working and retry later
      return text;
    }
  });
}

const { Cache } = require('./cache');
const translationCache = new Cache(CACHE_TTL.TRANSLATION); // 1-hour TTL from config

/**
 * Generate a stable cache key for an article
 * @param {string} lang - Target language
 * @param {object} article - Article object
 * @returns {string} Cache key
 */
function generateTranslationCacheKey(lang, article) {
  // Create a more stable key using multiple article properties
  const keyData = {
    lang: lang,
    title: article.title || '',
    link: article.link || '',
    sourceId: article.sourceId || '',
    pubDate: article.pubDate || ''
  };

  const keyString = JSON.stringify(keyData);
  const hash = crypto.createHash('md5').update(keyString).digest('hex');
  return `trans_${lang}_${hash}`;
}

/**
 * Translate an article object's title and description.
 * @param {object} article - Article object
 * @param {string} targetLang - Target language (e.g., 'en', 'ru', 'ua')
 * @param {AbortSignal} signal - Optional abort signal for cancellation
 * @returns {Promise<object>} Translated article object
 */
async function translateArticle(article, targetLang, signal) {
  const lang = targetLang.toLowerCase();

  // Skip translation if it's already in the target language (roughly)
  const normalizedArticleLang = article.originalLang?.toLowerCase().substring(0, 2) || '';
  const normalizedTargetLang = lang.substring(0, 2);

  if (normalizedTargetLang === 'en' && normalizedArticleLang === 'en') return article;
  if (normalizedTargetLang === 'ru' && normalizedArticleLang === 'ru') return article;
  if (normalizedTargetLang === 'ua' && normalizedArticleLang === 'uk') return article;

  const cacheKey = generateTranslationCacheKey(lang, article);

  return translationCache.getOrFetch(cacheKey, async () => {
    const [translatedTitle, translatedDesc] = await Promise.all([
      translateText(article.title, lang, signal),
      translateText(article.description, lang, signal)
    ]);

    return {
      ...article,
      title: translatedTitle,
      description: translatedDesc
    };
  });
}

module.exports = {
  translateText,
  translateArticle,
  generateTranslationCacheKey
};