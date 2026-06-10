const translate = require('google-translate-api-x');

/**
 * Translate text using google-translate-api-x with fallback.
 * @param {string} text - The text to translate
 * @param {string} targetLang - The target language code (e.g., 'en', 'ru', 'uk')
 * @returns {Promise<string>} Translated text, or original text if translation fails
 */
async function translateText(text, targetLang) {
  if (!text) return text;
  
  // Mapping UA to UK for translation APIs
  const apiLang = targetLang === 'ua' ? 'uk' : targetLang;

  try {
    const TRANSLATE_TIMEOUT = 4000; // 4s timeout for primary translation
    const res = await Promise.race([
      translate(text, { to: apiLang }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Google translate timed out after ${TRANSLATE_TIMEOUT}ms`)), TRANSLATE_TIMEOUT)
      )
    ]);
    return res.text;
  } catch (err) {
    console.error(`Google translate failed for "${text.substring(0, 20)}...": ${err.message}`);
    
    // Fallback: LibreTranslate (public instance)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://libretranslate.de/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: 'auto',
          target: apiLang,
          format: 'text'
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        return data.translatedText || text;
      }
    } catch (fallbackErr) {
      console.error(`LibreTranslate fallback failed: ${fallbackErr.message}`);
    }
    
    // Ultimate fallback: throw an error so caching layer does not cache original text as translated
    throw new Error('All translation services failed');
  }
}

const { Cache } = require('./cache');
const translationCache = new Cache(60 * 60 * 1000); // 1-hour TTL

/**
 * Translate an article object's title and description.
 * @param {object} article - Article object
 * @param {string} targetLang - Target language (e.g., 'en', 'ru', 'ua')
 * @returns {Promise<object>} Translated article object
 */
async function translateArticle(article, targetLang) {
  const lang = targetLang.toLowerCase();
  
  // Skip translation if it's already in the target language (roughly)
  // Mapping English
  if (lang === 'en' && article.originalLang === 'en') return article;
  if (lang === 'ru' && article.originalLang === 'ru') return article;
  if (lang === 'ua' && article.originalLang === 'uk') return article;

  const cacheKey = `trans_${lang}_${article.link || article.title}`;
  
  return translationCache.getOrFetch(cacheKey, async () => {
    const [translatedTitle, translatedDesc] = await Promise.all([
      translateText(article.title, lang),
      translateText(article.description, lang)
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
  translateArticle
};
