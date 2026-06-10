document.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('error-message');
  const heroSection = document.getElementById('hero-section');
  const bentoGrid = document.getElementById('bento-grid');
  const sectionDivider = document.getElementById('section-divider');
  const langSelect = document.getElementById('lang-select');
  const editionDate = document.getElementById('edition-date');
  const catFilters = document.querySelectorAll('#category-filters .filter-btn');
  const countryFilters = document.querySelectorAll('#country-filters .filter-btn');

  let currentLang = document.getElementById('lang-select') ? document.getElementById('lang-select').value : 'en';
  let currentCategory = '';
  let currentCountry = '';
  let currentAbortController = null;

  function isSafeUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.origin);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  // Edition date
  const now = new Date();
  if (editionDate) {
    editionDate.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  // Initialize
  fetchArticles();

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
  });

  countryFilters.forEach(btn => {
    btn.addEventListener('click', (e) => {
      countryFilters.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentCountry = e.target.dataset.country;
      fetchArticles();
    });
  });

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
      renderArticles(articles);
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

  function renderArticles(articles) {
    hideLoader();
    
    heroSection.innerHTML = '';
    bentoGrid.innerHTML = '';
    
    if (!articles || articles.length === 0) {
      showError('No articles found matching the selected criteria.');
      return;
    }

    // Render Hero
    const heroArticle = articles[0];
    
    const heroMeta = document.createElement('div');
    heroMeta.className = 'hero-meta';
    
    const heroSource = document.createElement('span');
    heroSource.textContent = heroArticle.source;
    const heroDate = document.createElement('span');
    heroDate.textContent = new Date(heroArticle.pubDate).toLocaleDateString();
    const heroCategory = document.createElement('span');
    heroCategory.textContent = heroArticle.category;
    
    heroMeta.append(heroSource, heroDate, heroCategory);

    const heroTitle = document.createElement('h1');
    heroTitle.className = 'hero-title';
    const heroLink = document.createElement('a');
    heroLink.textContent = heroArticle.title;
    if (heroArticle.link && isSafeUrl(heroArticle.link)) {
      heroLink.href = heroArticle.link;
      heroLink.target = '_blank';
      heroLink.rel = 'noopener noreferrer';
    } else {
      heroLink.href = 'javascript:void(0)';
    }
    heroTitle.appendChild(heroLink);

    const heroDesc = document.createElement('p');
    heroDesc.className = 'hero-desc';
    heroDesc.textContent = heroArticle.description || '';

    heroSection.append(heroMeta, heroTitle, heroDesc);
    heroSection.classList.remove('hidden');

    // Show divider between hero and grid
    if (sectionDivider) {
      sectionDivider.classList.remove('hidden');
    }

    // Render Grid
    const gridArticles = articles.slice(1);
    
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

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
      const cardLink = document.createElement('a');
      cardLink.textContent = article.title;
      if (article.link && isSafeUrl(article.link)) {
        cardLink.href = article.link;
        cardLink.target = '_blank';
        cardLink.rel = 'noopener noreferrer';
      } else {
        cardLink.href = 'javascript:void(0)';
      }
      cardTitle.appendChild(cardLink);

      const cardDesc = document.createElement('p');
      cardDesc.className = 'card-desc';
      cardDesc.textContent = article.description ? article.description.substring(0, 150) + '...' : '';

      card.append(cardMeta, cardTitle, cardDesc);
      bentoGrid.appendChild(card);
      observer.observe(card);
    });

    bentoGrid.classList.remove('hidden');
  }

  function showLoader() {
    loader.classList.remove('hidden');
    loader.classList.add('loader-pulse');
    heroSection.classList.add('hidden');
    bentoGrid.classList.add('hidden');
    if (sectionDivider) sectionDivider.classList.add('hidden');
    errorMessage.classList.add('hidden');
  }

  function hideLoader() {
    loader.classList.add('hidden');
    loader.classList.remove('loader-pulse');
  }

  function showError(msg) {
    hideLoader();
    heroSection.classList.add('hidden');
    bentoGrid.classList.add('hidden');
    if (sectionDivider) sectionDivider.classList.add('hidden');
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
  }
});
