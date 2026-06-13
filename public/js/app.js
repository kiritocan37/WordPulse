document.addEventListener('DOMContentLoaded', () => {
  // Sentry browser initialization
  if (typeof Sentry !== 'undefined') {
    const sentryDsn = document.querySelector('meta[name="sentry-dsn"]')?.getAttribute('content') || '';
    Sentry.init({
      dsn: sentryDsn,
      tracesSampleRate: 1.0,
      // Set 'release' to the app version if available
      release: 'wordpulse@' + (Date.now().toString(36)),
    });
  }
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('error-message');
  const heroSection = document.getElementById('hero-section');
  const bentoGrid = document.getElementById('bento-grid');
  const sectionDivider = document.getElementById('section-divider');
  const langSelect = document.getElementById('lang-select');
  const editionDate = document.getElementById('edition-date');
  const catFilters = document.querySelectorAll('#category-filters .filter-btn');
  const countryFilters = document.querySelectorAll('#country-filters .filter-btn');
  const searchInput = document.getElementById('search-input');
  const retryButton = document.getElementById('retry-button');
  const loadMoreButton = document.getElementById('load-more-button');
  const loadMoreContainer = document.getElementById('load-more-container');

  let currentLang = document.getElementById('lang-select') ? document.getElementById('lang-select').value : 'en';
  let currentCategory = '';
  let currentCountry = '';
  let currentAbortController = null;
  let allArticles = []; // Store all fetched articles
  let filteredArticles = []; // Articles after applying search
  let currentOffset = 0; // For pagination of grid (skip hero)
  const PAGE_SIZE = 30;
  let searchTimeoutId = null;

  // Edition date
  const now = new Date();
  if (editionDate) {
    editionDate.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // Update HTML language attribute based on selected language
  function updateHtmlLang() {
    const htmlElement = document.getElementById('html-lang');
    if (htmlElement) {
      htmlElement.lang = currentLang === 'ua' ? 'uk' : currentLang;
    }
  }

  // Update meta tags for SEO and social sharing
  function updateMetaTags(article = null) {
    const titleElement = document.getElementById('page-title');
    const ogTitleElement = document.getElementById('meta-og-title');
    const ogDescriptionElement = document.getElementById('meta-og-description');
    const ogUrlElement = document.getElementById('meta-og-url');
    const ogLocaleElement = document.getElementById('meta-og-locale');
    const twitterCardElement = document.getElementById('meta-twitter-card');
    const descriptionElement = document.getElementById('meta-description');
    const canonicalElement = document.getElementById('link-canonical');
    const jsonLdElement = document.getElementById('json-ld');

    // Default values
    let pageTitle = 'WorldPulse | Global News Aggregator';
    let ogTitle = 'WordPulse - Global News';
    let ogDescription = 'International news from BBC Al Jazeera Reuters and more';
    let ogUrl = 'https://word-pulse-nine.vercel.app/';
    let ogLocale = 'en_US';
    let twitterCard = 'summary';
    let description = 'International news from BBC Al Jazeera Reuters and more';
    let canonicalUrl = 'https://word-pulse-nine.vercel.app/';

    // If we have a specific article (for hero article), override with article data
    if (article) {
      pageTitle = `${article.title} - WorldPulse`;
      ogTitle = article.title;
      ogDescription = article.description || 'International news from BBC Al Jazeera Reuters and more';
      ogUrl = `https://word-pulse-nine.vercel.app/article/${encodeURIComponent(article.title)}`;
      ogLocale = currentLang === 'ua' ? 'uk_UA' : `${currentLang.toUpperCase()}_${currentLang.toUpperCase() === 'UA' ? 'UA' : currentLang.toUpperCase()}`;
      description = article.description || 'International news from BBC Al Jazeera Reuters and more';
      canonicalUrl = ogUrl;

      // Update JSON-LD structured data for NewsArticle
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": article.title,
        "description": article.description || "",
        "image": article.urlToImage || "",
        "datePublished": article.pubDate,
        "dateModified": article.pubDate,
        "author": {
          "@type": "Organization",
          "name": article.source
        },
        "publisher": {
          "@type": "Organization",
          "name": article.source,
          "logo": {
            "@type": "ImageObject",
            "url": article.urlToImage || ""
          }
        },
        "mainEntityOfPage": {
          "@type": "WebPage",
          "@id": ogUrl
        }
      };
      jsonLdElement.textContent = JSON.stringify(jsonLd);
    } else {
      // Clear JSON-LD for homepage
      jsonLdElement.textContent = '';
    }

    // Update all meta tags
    if (titleElement) titleElement.textContent = pageTitle;
    if (ogTitleElement) ogTitleElement.content = ogTitle;
    if (ogDescriptionElement) ogDescriptionElement.content = ogDescription;
    if (ogUrlElement) ogUrlElement.content = ogUrl;
    if (ogLocaleElement) ogLocaleElement.content = ogLocale;
    if (twitterCardElement) twitterCardElement.content = twitterCard;
    if (descriptionElement) descriptionElement.content = description;
    if (canonicalElement) canonicalElement.href = canonicalUrl;
  }

  // Update hreflang links
  function updateHreflangLinks() {
    const langs = ['en', 'ru', 'ua'];
    langs.forEach(lang => {
      const linkElement = document.getElementById(`link-hreflang-${lang}`);
      if (linkElement) {
        linkElement.href = `https://word-pulse-nine.vercel.app/`;
      }
    });
  }

  // Initialize
  fetchArticles();
  initKeyboardNavigation();

  // Helper function to get CSS variable values
  function getCssVariable(variableName) {
    const element = document.documentElement;
    const cs = getComputedStyle(element);
    return cs.getPropertyValue(variableName).trim();
  }

  // Manual HTML sanitization function to prevent XSS
  function sanitizeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize keyboard navigation for better accessibility
  function initKeyboardNavigation() {
    // Make sure search input is accessible
    if (searchInput) {
      searchInput.setAttribute('aria-label', 'Search articles by title');
      searchInput.setAttribute('placeholder', 'Search articles by title...');
    }

    // Add skip to content link for keyboard users
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.className = 'skip-link';
    skipLink.textContent = 'Skip to main content';
    skipLink.style.position = 'absolute';
    skipLink.style.top = '-40px';
    skipLink.style.left = '0';
    skipLink.style.backgroundColor = getCssVariable('--accent-color');
    skipLink.style.color = getCssVariable('--bg-color');
    skipLink.style.padding = getCssVariable('--space-xs') + ' ' + getCssVariable('--space-sm');
    skipLink.style.zIndex = '1000';
    skipLink.style.borderRadius = '4px';
    skipLink.style.transition = 'top 0.3s ease';

    skipLink.addEventListener('focus', () => {
      skipLink.style.top = '0';
    });

    skipLink.addEventListener('blur', () => {
      skipLink.style.top = '-40px';
    });

    document.body.insertBefore(skipLink, document.body.firstChild);

    // Add main content landmark
    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.setAttribute('id', 'main-content');
    }
  }

  // Initialize keyboard navigation
  initKeyboardNavigation();

  // Event Listeners
  langSelect.addEventListener('change', (e) => {
    currentLang = e.target.value;
    fetchArticles();
  });

  catFilters.forEach(btn => {
    btn.addEventListener('click', (e) => {
      catFilters.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentCategory = e.target.dataset.category;
      fetchArticles();
    });

    // Add keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  });

  countryFilters.forEach(btn => {
    btn.addEventListener('click', (e) => {
      countryFilters.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentCountry = e.target.dataset.country;
      fetchArticles();
    });

    // Add keyboard support
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });
  });

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeoutId);
    searchTimeoutId = setTimeout(() => {
      applySearch(e.target.value);
    }, 300);
  });

  // Add submit on Enter for search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applySearch(e.target.value);
    }
  });

  if (retryButton) {
    retryButton.addEventListener('click', () => {
      fetchArticles();
    });

    // Add keyboard support
    retryButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        retryButton.click();
      }
    });
  }

  if (loadMoreButton) {
    loadMoreButton.addEventListener('click', () => {
      currentOffset++;
      displayArticles();
    });

    // Add keyboard support
    loadMoreButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        loadMoreButton.click();
      }
    });
  }

  async function fetchArticles() {
    showLoader();

    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    try {
      const url = new URL('/api/articles', window.location.origin);
      url.searchParams.append('lang', currentLang);
      if (currentCategory) url.searchParams.append('category', currentCategory);
      if (currentCountry) url.searchParams.append('country', currentCountry);

      // Set a 30-second timeout to abort the fetch and show an error
      const FETCH_TIMEOUT = 30000;
      const timeoutId = setTimeout(() => {
        currentAbortController.abort();
      }, FETCH_TIMEOUT);

      const response = await fetch(url, { signal: currentAbortController.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to fetch articles');

      const articles = await response.json();
      allArticles = articles;
      // Reset search and pagination when new articles are fetched
      filteredArticles = articles;
      currentOffset = 0;
      displayArticles();
    } catch (err) {
      if (err.name === 'AbortError') {
        // Distinguish between user-initiated abort (new fetch) and timeout abort
        // If the controller is still the current one, it was a timeout (not replaced by a new fetch)
        if (currentAbortController && currentAbortController.signal.aborted) {
          showError('Request timed out. Please check your connection and try again.');
        }
        return;
      }
      showError(err.message);
    }
  }

  function applySearch(searchTerm) {
    if (searchTerm.trim() === '') {
      filteredArticles = allArticles;
    } else {
      const term = searchTerm.toLowerCase();
      filteredArticles = allArticles.filter(article =>
        article.title.toLowerCase().includes(term)
      );
    }
    currentOffset = 0;
    displayArticles();
  }

  function displayArticles() {
    hideLoader();

    // Hide error message initially
    errorMessage.classList.add('hidden');
    errorMessage.textContent = '';

    if (!filteredArticles || filteredArticles.length === 0) {
      showError('No articles found matching the selected criteria.');
      return;
    }

    // Render Hero (always the first article)
    const heroArticle = filteredArticles[0];

    heroSection.innerHTML = '';

    // Create hero title
    const heroTitle = document.createElement('h1');
    heroTitle.className = 'hero-title';
    heroTitle.textContent = heroArticle.title;

    // Create inline article content container
    const heroContent = document.createElement('div');
    heroContent.className = 'hero-content';
    heroContent.innerHTML = `
      <div class="hero-meta">
        <span>${heroArticle.source}</span>
        <span>${new Date(heroArticle.pubDate).toLocaleDateString()}</span>
        <span>${heroArticle.category}</span>
      </div>
      ${heroArticle.imageUrl ? `<img src="${heroArticle.imageUrl}" alt="${heroArticle.title}" class="hero-image">` : ''}
      <p class="hero-description">${sanitizeHtml(heroArticle.description || '')}</p>
      <div class="hero-actions">
        <button class="read-original-btn" data-link="${heroArticle.link}" ${!heroArticle.link || !isSafeUrl(heroArticle.link) ? 'disabled' : ''}>
          Read Original
        </button>
      </div>
    `;

    heroSection.append(heroTitle, heroContent);

    // Add ARIA live region for hero content
    heroSection.setAttribute('aria-live', 'polite');
    heroSection.setAttribute('aria-atomic', 'true');

    heroSection.classList.remove('hidden');

    // Update SEO meta tags for the hero article
    updateHtmlLang();
    updateMetaTags(heroArticle);
    updateHreflangLinks();

    // Show divider between hero and grid
    if (sectionDivider) {
      sectionDivider.classList.remove('hidden');
    }

    // Render Grid (paginated)
    bentoGrid.innerHTML = '';

    // Calculate grid indices: skip hero (index 0), then paginate
    const gridStart = 1 + currentOffset * PAGE_SIZE;
    const gridEnd = gridStart + PAGE_SIZE;
    const gridArticles = filteredArticles.slice(gridStart, gridEnd);

    if (gridArticles.length === 0 && currentOffset > 0) {
      // If we've gone beyond available articles, reset to last page
      currentOffset = Math.max(0, Math.floor((filteredArticles.length - 1) / PAGE_SIZE));
      return displayArticles(); // Recursive call with corrected offset
    }

    // Use DocumentFragment for better DOM performance
    const fragment = document.createDocumentFragment();

    gridArticles.forEach((article, index) => {
      const card = document.createElement('article');
      card.className = 'card reveal';
      const delay = Math.min(index * 0.06, 0.6);
      card.style.transitionDelay = delay + 's';

      const cardMeta = document.createElement('div');
      cardMeta.className = 'card-meta';
      const cardSource = document.createElement('span');
      cardSource.textContent = `${article.source} (${article.country})`;
      const cardCat = document.createElement('span');
      cardCat.textContent = article.category;
      cardMeta.append(cardSource, cardCat);

      const cardTitle = document.createElement('h2');
      cardTitle.className = 'card-title';
      cardTitle.textContent = article.title;

      // Create inline article content container
      const cardContent = document.createElement('div');
      cardContent.className = 'card-content';
      cardContent.innerHTML = `
        ${article.imageUrl ? `<img src="${article.imageUrl}" alt="${article.title}" class="card-image">` : ''}
        <p class="card-description">${sanitizeHtml(article.description || '')}</p>
        <div class="card-actions">
          <button class="read-original-btn" data-link="${article.link}" ${!article.link || !isSafeUrl(article.link) ? 'disabled' : ''}>
            Read Original
          </button>
        </div>
      `;

      card.append(cardMeta, cardTitle, cardContent);
      fragment.appendChild(card);
    });

    bentoGrid.appendChild(fragment);
    bentoGrid.classList.remove('hidden');

    // Show/hide Load More button
    const totalGridArticles = filteredArticles.length - 1; // Excluding hero
    const shownGridArticles = gridEnd - 1; // Because gridStart starts at 1, so shown = gridEnd - 1
    if (loadMoreContainer) {
      if (shownGridArticles < totalGridArticles) {
        loadMoreContainer.classList.remove('hidden');
      } else {
        loadMoreContainer.classList.add('hidden');
      }
    }

    // Reset meta tags to homepage defaults when showing grid (not hero)
    updateHtmlLang();
    updateMetaTags(); // Pass null for homepage defaults
    updateHreflangLinks();

    // Re-initialize Intersection Observer for new cards
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    // Observe all cards (both existing and newly added)
    document.querySelectorAll('.card.reveal').forEach(card => {
      observer.observe(card);
    });

    // Add event listeners for Read Original buttons
    document.querySelectorAll('.read-original-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const link = e.target.dataset.link;
        if (link && isSafeUrl(link)) {
          window.open(link, '_blank');
        }
      });
    });
  }

  function isSafeUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.origin);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function showLoader() {
    loader.classList.remove('hidden');
    loader.classList.add('loader-pulse');
    heroSection.classList.add('hidden');
    bentoGrid.classList.add('hidden');
    if (sectionDivider) sectionDivider.classList.add('hidden');
    errorMessage.classList.add('hidden');
    if (loadMoreContainer) loadMoreContainer.classList.add('hidden');

    // Show skeleton loaders for hero and grid
    const skeletonHero = `
      <div class="hero skeleton">
        <div class="hero-meta">
          <span class="skeleton-text"></span>
          <span class="skeleton-text-xs"></span>
          <span class="skeleton-text-xs"></span>
        </div>
        <h1 class="hero-title skeleton-text-lg"></h1>
        <p class="hero-desc skeleton-text"></p>
        <p class="hero-desc skeleton-text"></p>
        <p class="hero-desc skeleton-text"></p>
      </div>
    `;

    const skeletonGrid = `
      <div class="bento-grid skeleton">
        ${Array.from({length: 6}).map(() => `
          <article class="card skeleton">
            <div class="card-meta">
              <span class="skeleton-text-xs"></span>
              <span class="skeleton-text-xs"></span>
            </div>
            <h2 class="card-title skeleton-text-lg"></h2>
            <p class="card-desc skeleton-text"></p>
            <p class="card-desc skeleton-text"></p>
          </article>
        `).join('')}
      </div>
    `;

    // Insert skeletons if they don't already exist
    if (!document.querySelector('.hero.skeleton')) {
      heroSection.insertAdjacentHTML('afterbegin', skeletonHero);
    }
    if (!document.querySelector('.bento-grid.skeleton')) {
      bentoGrid.insertAdjacentHTML('afterbegin', skeletonGrid);
    }

    // Show skeleton elements
    heroSection.classList.remove('hidden');
    bentoGrid.classList.remove('hidden');
    if (sectionDivider) sectionDivider.classList.remove('hidden');
  }

  function hideLoader() {
    loader.classList.add('hidden');
    loader.classList.remove('loader-pulse');

    // Hide skeleton loaders
    const skeletonHero = document.querySelector('.hero.skeleton');
    const skeletonGrid = document.querySelector('.bento-grid.skeleton');
    if (skeletonHero) skeletonHero.remove();
    if (skeletonGrid) skeletonGrid.remove();

    // Hide content sections
    heroSection.classList.add('hidden');
    bentoGrid.classList.add('hidden');
    if (sectionDivider) sectionDivider.classList.add('hidden');
    errorMessage.classList.add('hidden');
    if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
  }

  function showError(msg) {
    hideLoader();
    heroSection.classList.add('hidden');
    bentoGrid.classList.add('hidden');
    if (sectionDivider) sectionDivider.classList.add('hidden');
    if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    errorMessage.innerHTML = `<p>${msg}</p><button id="retry-button" class="filter-btn">Retry</button>`;
    errorMessage.classList.remove('hidden');
    // Re-attach retry button event listener
    const retryBtn = document.getElementById('retry-button');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        fetchArticles();
      });
    }
  }
});