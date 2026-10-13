/**
 * sticky-sub-nav.module/module.js
 *
 * Responsibilities:
 *   1. Stick the nav after the user scrolls past `data-scroll-threshold` px.
 *   2. Use IntersectionObserver to highlight the link whose target section
 *      is currently in the viewport.
 *
 * Runs immediately (no DOMContentLoaded wrapper needed - HubSpot places
 * module scripts at the bottom of the page, after the DOM is ready).
 */
(function () {
  'use strict';

  var nav = document.getElementById('wa-sub-nav') ||
            document.querySelector('.wa-sub-nav');
  if (!nav) return;

  var threshold   = parseInt(nav.dataset.scrollThreshold || '200', 10);
  var links       = Array.from(nav.querySelectorAll('.wa-sub-nav__link'));
  var ACTIVE_CLS  = 'is-active';
  var STICKY_CLS  = 'is-sticky';

  // ── 1. Sticky on scroll ──────────────────────────────────────────────────
  var initialTop  = nav.getBoundingClientRect().top + window.pageYOffset;

  function handleScroll() {
    var scrolled = window.pageYOffset > threshold;
    nav.classList.toggle(STICKY_CLS, scrolled);
    // Reserve space so content below doesn't jump when nav goes sticky
    if (scrolled) {
      nav.style.setProperty('--wa-sub-nav-placeholder', nav.offsetHeight + 'px');
    }
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll(); // run once on load

  // ── 2. Intersection Observer - active section highlight ──────────────────
  if (!('IntersectionObserver' in window)) return;

  // Collect all target sections referenced by the nav links
  var sectionMap = {};
  links.forEach(function (link) {
    var targetId = link.dataset.target;
    var section  = targetId ? document.getElementById(targetId) : null;
    if (section) sectionMap[targetId] = link;
  });

  var sectionIds = Object.keys(sectionMap);
  if (!sectionIds.length) return;

  // Track which sections are intersecting so we can pick the topmost one
  var intersecting = {};

  function setActive() {
    // Find the first (topmost in DOM order) currently-intersecting section
    var activeId = null;
    sectionIds.forEach(function (id) {
      if (intersecting[id] && !activeId) activeId = id;
    });

    links.forEach(function (link) {
      var isActive = link.dataset.target === activeId;
      link.classList.toggle(ACTIVE_CLS, isActive);
      link.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        intersecting[entry.target.id] = entry.isIntersecting;
      });
      setActive();
    },
    {
      // Fire when the section top crosses the middle of the viewport
      rootMargin: '-10% 0px -60% 0px',
      threshold: 0
    }
  );

  sectionIds.forEach(function (id) {
    observer.observe(document.getElementById(id));
  });

  // ── 3. Smooth-scroll on link click ───────────────────────────────────────
  links.forEach(function (link) {
    link.addEventListener('click', function (e) {
      var targetId = link.dataset.target;
      var section  = targetId ? document.getElementById(targetId) : null;
      if (!section) return;
      e.preventDefault();
      var navHeight = nav.classList.contains(STICKY_CLS) ? nav.offsetHeight : 0;
      var top = section.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
      window.scrollTo({ top: top, behavior: 'smooth' });
      // Update URL hash without jumping
      history.pushState(null, '', '#' + targetId);
    });
  });
})();
