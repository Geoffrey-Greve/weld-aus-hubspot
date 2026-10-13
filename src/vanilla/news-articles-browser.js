(function () {
  'use strict';

  var SECTION_SELECTOR = '[data-news-browser]';
  var CARD_SELECTOR = '.wa-blog-card';
  var PAGE_LINK_WINDOW = 5;

  function normaliseText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalisePath(value) {
    var path = String(value || '/').replace(/\/+$/, '');
    return path || '/';
  }

  function pageUrl(baseUrl, pageNumber) {
    var url = new URL(baseUrl.href);
    url.pathname = normalisePath(url.pathname) + '/page/' + pageNumber;
    url.search = '';
    url.hash = '';
    return url.href;
  }

  function fetchDocument(url) {
    return fetch(url, {
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Unable to load news page ' + response.status);
      }
      return response.text();
    }).then(function (html) {
      return new DOMParser().parseFromString(html, 'text/html');
    });
  }

  function parseCard(card) {
    var link = card.getAttribute('href') || '';
    var titleElement = card.querySelector('.wa-blog-card__title');
    var title = titleElement ? titleElement.textContent : '';
    var topics = (card.getAttribute('data-topics') || '').split(/\s+/).filter(Boolean);
    var absoluteUrl;

    try {
      absoluteUrl = new URL(link, window.location.origin).href;
    } catch (error) {
      absoluteUrl = link;
    }

    return {
      key: absoluteUrl,
      title: normaliseText(title),
      topics: topics,
      html: card.outerHTML
    };
  }

  function collectCards(root) {
    var section = root.matches && root.matches(SECTION_SELECTOR)
      ? root
      : root.querySelector(SECTION_SELECTOR);

    if (!section) {
      return [];
    }

    return Array.prototype.map.call(section.querySelectorAll(CARD_SELECTOR), parseCard);
  }

  function uniqueCards(groups) {
    var seen = Object.create(null);
    var items = [];

    groups.forEach(function (group) {
      group.forEach(function (item) {
        if (!item.key || seen[item.key]) {
          return;
        }
        seen[item.key] = true;
        items.push(item);
      });
    });

    return items;
  }

  function initBrowser(section) {
    if (section.getAttribute('data-news-browser-initialised') === 'true') {
      return;
    }
    section.setAttribute('data-news-browser-initialised', 'true');

    var results = section.querySelector('[data-blog-results]');
    var grid = results ? results.querySelector('.wa-blog-grid') : null;
    var emptyState = results ? results.querySelector('.wa-blog-empty--filtered') : null;
    var featured = section.querySelector('[data-blog-featured]');
    var count = section.querySelector('.wa-blog-browser__count');
    var searchForm = section.querySelector('.wa-blog-search');
    var searchInput = searchForm ? searchForm.querySelector('input[type="search"]') : null;
    var chips = Array.prototype.slice.call(section.querySelectorAll('[data-topic-filter]'));
    var nativePagination = section.querySelector('.wa-blog-pagination');
    var forceClientPagination = section.getAttribute('data-blog-force-client-pagination') === 'true';

    if (!results || !grid || !searchInput) {
      return;
    }

    var activeChip = section.querySelector('[data-topic-filter].wa-topic-chip--active');
    var initialTopic = activeChip ? activeChip.getAttribute('data-topic-filter') : 'all';
    var initialTagArchive = window.location.pathname.indexOf('/tag/') !== -1;
    var original = {
      gridHtml: grid.innerHTML,
      countText: count ? count.textContent : '',
      featuredHidden: featured ? featured.hidden : true,
      paginationHidden: nativePagination ? nativePagination.hidden : true
    };
    var state = {
      activeTopic: initialTopic || 'all',
      items: [],
      page: 1,
      pageSize: Math.max(1, parseInt(section.getAttribute('data-blog-page-size'), 10) || 12),
      query: normaliseText(searchInput.value),
      ready: false
    };
    var debounceTimer = null;
    var pendingTagUrl = '';
    var clientPagination = document.createElement('nav');

    clientPagination.className = 'wa-blog-pagination';
    clientPagination.setAttribute('data-blog-client-pagination', '');
    clientPagination.setAttribute('aria-label', 'Filtered news pagination');
    clientPagination.hidden = true;
    results.insertAdjacentElement('afterend', clientPagination);
    results.setAttribute('aria-busy', 'true');

    function updateActiveChip() {
      chips.forEach(function (chip) {
        var isActive = chip.getAttribute('data-topic-filter') === state.activeTopic;
        chip.classList.toggle('wa-topic-chip--active', isActive);
        if (isActive) {
          chip.setAttribute('aria-current', 'true');
        } else {
          chip.removeAttribute('aria-current');
        }
      });
    }

    function updateCount(total) {
      if (!count) {
        return;
      }
      count.textContent = total + ' article' + (total === 1 ? '' : 's');
    }

    function filteredItems() {
      return state.items.filter(function (item) {
        var topicMatch = state.activeTopic === 'all' || item.topics.indexOf(state.activeTopic) !== -1;
        var titleMatch = !state.query || item.title.indexOf(state.query) !== -1;
        return topicMatch && titleMatch;
      });
    }

    function paginationButton(label, page, disabled, active, ariaLabel) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'wa-blog-pagination__link' + (active ? ' is-active' : '');
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('aria-label', ariaLabel);

      if (active) {
        button.setAttribute('aria-current', 'page');
      }

      if (!disabled && !active) {
        button.addEventListener('click', function () {
          state.page = page;
          renderClientResults(true);
        });
      }

      return button;
    }

    function renderClientPagination(totalPages) {
      clientPagination.innerHTML = '';

      if (totalPages <= 1) {
        clientPagination.hidden = true;
        return;
      }

      clientPagination.hidden = false;
      clientPagination.appendChild(paginationButton(
        'Previous',
        state.page - 1,
        state.page === 1,
        false,
        state.page === 1 ? 'Previous filtered page unavailable' : 'Go to previous filtered page'
      ));

      var start = Math.max(1, state.page - 2);
      var end = Math.min(totalPages, start + PAGE_LINK_WINDOW - 1);
      start = Math.max(1, end - PAGE_LINK_WINDOW + 1);

      for (var page = start; page <= end; page += 1) {
        clientPagination.appendChild(paginationButton(
          String(page),
          page,
          false,
          page === state.page,
          'Go to filtered news page ' + page
        ));
      }

      clientPagination.appendChild(paginationButton(
        'Next',
        state.page + 1,
        state.page === totalPages,
        false,
        state.page === totalPages ? 'Next filtered page unavailable' : 'Go to next filtered page'
      ));
    }

    function restoreNativeResults() {
      grid.innerHTML = original.gridHtml;
      grid.hidden = false;
      if (emptyState) {
        emptyState.hidden = true;
      }
      if (featured) {
        featured.hidden = original.featuredHidden;
      }
      if (count) {
        count.textContent = original.countText;
      }
      if (nativePagination) {
        nativePagination.hidden = original.paginationHidden;
      }
      clientPagination.hidden = true;
      clientPagination.innerHTML = '';
      updateActiveChip();
    }

    function renderClientResults(shouldScroll) {
      if (!state.ready) {
        return;
      }

      var hasFilter = state.activeTopic !== 'all' || Boolean(state.query);
      if (!hasFilter && !initialTagArchive && !forceClientPagination) {
        restoreNativeResults();
        return;
      }

      var matches = filteredItems();
      var totalPages = Math.max(1, Math.ceil(matches.length / state.pageSize));
      state.page = Math.min(Math.max(1, state.page), totalPages);

      var start = (state.page - 1) * state.pageSize;
      var visibleItems = matches.slice(start, start + state.pageSize);
      grid.innerHTML = visibleItems.map(function (item) {
        return item.html;
      }).join('');
      grid.hidden = visibleItems.length === 0;

      if (emptyState) {
        emptyState.hidden = visibleItems.length !== 0;
      }
      if (featured) {
        featured.hidden = original.featuredHidden;
      }
      if (nativePagination) {
        nativePagination.hidden = true;
      }

      updateCount(forceClientPagination && !hasFilter ? visibleItems.length : matches.length);
      updateActiveChip();
      renderClientPagination(matches.length ? totalPages : 0);

      if (shouldScroll) {
        var heading = section.querySelector('.wa-blog-browser__head');
        if (heading) {
          heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    function scheduleRender() {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(function () {
        state.page = 1;
        renderClientResults(false);
      }, 120);
    }

    searchInput.addEventListener('input', function () {
      state.query = normaliseText(searchInput.value);
      scheduleRender();
    });

    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      state.query = normaliseText(searchInput.value);
      state.page = 1;
      if (state.ready) {
        renderClientResults(false);
      }
    });

    chips.forEach(function (chip) {
      chip.addEventListener('click', function (event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        state.activeTopic = chip.getAttribute('data-topic-filter') || 'all';
        state.page = 1;
        pendingTagUrl = chip.href;
        updateActiveChip();

        if (state.ready) {
          pendingTagUrl = '';
          renderClientResults(false);
        }
      });
    });

    var baseUrl = new URL(section.getAttribute('data-blog-index-url') || '/news/', window.location.origin);
    baseUrl.search = '';
    baseUrl.hash = '';

    var isBaseFirstPage = normalisePath(window.location.pathname) === normalisePath(baseUrl.pathname);
    var firstDocumentPromise = isBaseFirstPage
      ? Promise.resolve(document)
      : fetchDocument(baseUrl.href);

    firstDocumentPromise.then(function (firstDocument) {
      var firstSection = firstDocument === document
        ? section
        : firstDocument.querySelector(SECTION_SELECTOR);

      if (!firstSection) {
        throw new Error('News browser section was not found');
      }

      var totalPages = Math.max(
        1,
        Math.min(100, parseInt(firstSection.getAttribute('data-blog-total-pages'), 10) || 1)
      );
      var documentPromises = [Promise.resolve(firstDocument)];

      for (var page = 2; page <= totalPages; page += 1) {
        documentPromises.push(fetchDocument(pageUrl(baseUrl, page)));
      }

      return Promise.all(documentPromises);
    }).then(function (documents) {
      var cardGroups = documents.map(collectCards);
      section.setAttribute('data-blog-index-page-counts', cardGroups.map(function (items) { return items.length; }).join(','));
      state.items = uniqueCards(cardGroups);
      section.setAttribute('data-blog-index-size', String(state.items.length));
      if (!state.items.length) {
        throw new Error('No news articles were found');
      }

      state.ready = true;
      section.setAttribute('data-news-browser-status', 'ready');
      results.removeAttribute('aria-busy');
      pendingTagUrl = '';

      if (state.activeTopic !== 'all' || state.query || initialTagArchive || forceClientPagination) {
        renderClientResults(false);
      }
    }).catch(function () {
      section.setAttribute('data-news-browser-status', 'fallback');
      results.removeAttribute('aria-busy');
      if (pendingTagUrl) {
        window.location.assign(pendingTagUrl);
      }
    });
  }

  function start() {
    Array.prototype.forEach.call(document.querySelectorAll(SECTION_SELECTOR), initBrowser);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
