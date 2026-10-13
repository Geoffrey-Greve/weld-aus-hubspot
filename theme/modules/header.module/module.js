/**
 * header.module/module.js
 * Vanilla JS for:
 *  1. Hamburger / mobile nav toggle
 *  2. Focus trap inside mobile nav
 *  3. Close mobile nav on Escape key
 *  4. Desktop dropdown: hover (mouse) + click (keyboard)
 *  5. Close dropdowns when clicking outside
 *  6. Mobile sub-menu collapsible lists
 *  7. Scroll listener: .is-scrolled class on header after 60px
 *  8. Close mobile nav on resize to desktop
 *
 * No dependencies. Runs after DOMContentLoaded.
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {

    var header      = document.getElementById('wa-site-header');
    var hamburger   = document.getElementById('wa-hamburger');
    var mobileNav   = document.getElementById('wa-mobile-nav');
    var primaryNav  = document.getElementById('wa-primary-nav');
    var memberMenu  = document.querySelector('.wa-nav-bar__member-menu');
    var memberBtn   = memberMenu ? memberMenu.querySelector('.wa-nav-bar__cta') : null;
    var searchToggle = document.querySelector('.wa-nav-bar__search-toggle');
    var searchPanel = document.getElementById('wa-header-search');
    var searchForm = searchPanel ? searchPanel.querySelector('.wa-header-search__form') : null;
    var searchInput = searchPanel ? searchPanel.querySelector('.wa-header-search__input') : null;
    var searchClose = searchPanel ? searchPanel.querySelector('.wa-header-search__close') : null;
    var mobileMemberBtn = mobileNav ? mobileNav.querySelector('.wa-mobile-nav__cta') : null;

    var FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    function getFocusable(container) {
      return Array.from(container.querySelectorAll(FOCUSABLE)).filter(function (el) {
        return !el.closest('[hidden]') && getComputedStyle(el).display !== 'none';
      });
    }

    // ── 1: Mobile nav toggle ─────────────────────────────────────────────── //

    function openMobileNav() {
      if (!mobileNav || !hamburger) return;
      mobileNav.removeAttribute('hidden');
      mobileNav.removeAttribute('inert');
      hamburger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      var firstFocusable = getFocusable(mobileNav)[0];
      if (firstFocusable) firstFocusable.focus();
    }

    function closeMobileNav(restoreFocus) {
      if (!mobileNav || !hamburger) return;
      if (typeof restoreFocus === 'undefined') restoreFocus = true;
      mobileNav.setAttribute('hidden', '');
      mobileNav.setAttribute('inert', '');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (restoreFocus) hamburger.focus();
    }

    function closeMemberDropdown() {
      if (!memberMenu || !memberBtn) return;
      memberMenu.classList.remove('is-open');
      memberBtn.setAttribute('aria-expanded', 'false');
    }

    function isSearchOpen() {
      return !!(searchPanel && !searchPanel.hasAttribute('hidden'));
    }

    function openSearch() {
      if (!searchPanel || !searchToggle) return;

      searchPanel.removeAttribute('hidden');
      searchToggle.setAttribute('aria-expanded', 'true');
      if (header) header.classList.add('is-search-open');

      closeMemberDropdown();
      closeAllDropdowns();

      if (mobileNav && !mobileNav.hasAttribute('hidden')) {
        closeMobileNav(false);
      }

      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () {
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        });
      } else if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }

    function closeSearch(restoreFocus) {
      if (!searchPanel || !searchToggle) return;
      if (typeof restoreFocus === 'undefined') restoreFocus = false;

      searchPanel.setAttribute('hidden', '');
      searchToggle.setAttribute('aria-expanded', 'false');
      if (header) header.classList.remove('is-search-open');
      if (restoreFocus) searchToggle.focus();
    }

    function submitHeaderSearch() {
      if (!searchForm || !searchInput) return false;

      var cleanQuery = searchInput.value.replace(/\s+/g, ' ').trim();
      if (!cleanQuery) {
        searchInput.focus();
        return false;
      }

      var action = searchForm.getAttribute('action') || '/hs-search-results';
      var glue = action.indexOf('?') === -1 ? '?' : '&';

      searchInput.value = cleanQuery;
      window.location.href = action + glue + 'term=' + encodeURIComponent(cleanQuery);
      return true;
    }

    if (hamburger) {
      hamburger.addEventListener('click', function () {
        if (hamburger.getAttribute('aria-expanded') === 'true') {
          closeMobileNav();
        } else {
          closeSearch(false);
          openMobileNav();
        }
      });
    }

    // ── 3: Escape key ────────────────────────────────────────────────────── //

    if (searchToggle && searchPanel) {
      searchToggle.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        if (isSearchOpen()) {
          closeSearch(true);
        } else {
          openSearch();
        }
      });
    }

    if (searchClose) {
      searchClose.addEventListener('click', function () {
        closeSearch(true);
      });
    }

    if (searchForm && searchInput) {
      searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitHeaderSearch();
      });

      searchInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.keyCode !== 13) return;
        e.preventDefault();
        submitHeaderSearch();
      });
    }

    document.addEventListener('click', function (e) {
      if (!isSearchOpen()) return;
      if (searchPanel && searchPanel.contains(e.target)) return;
      if (searchToggle && searchToggle.contains(e.target)) return;
      closeSearch(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      if (mobileNav && !mobileNav.hasAttribute('hidden')) {
        closeMobileNav();
        return;
      }
      if (isSearchOpen()) {
        closeSearch(true);
        return;
      }
      closeMemberDropdown();
      closeAllDropdowns();
    });

    // ── 2: Focus trap inside mobile nav ─────────────────────────────────── //

    if (mobileNav) {
      mobileNav.addEventListener('keydown', function (e) {
        if ((e.key !== 'Tab' && e.keyCode !== 9) || mobileNav.hasAttribute('hidden')) return;
        var focusable = getFocusable(mobileNav);
        if (!focusable.length) return;
        var first = focusable[0];
        var last  = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
    }

    // ── 6: Mobile sub-menu collapsibles ─────────────────────────────────── //

    if (mobileNav) {
      if (mobileMemberBtn) {
        mobileMemberBtn.addEventListener('click', function () {
          var expanded = mobileMemberBtn.getAttribute('aria-expanded') === 'true';
          var memberList = document.getElementById(mobileMemberBtn.getAttribute('aria-controls'));
          mobileMemberBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
          if (memberList) {
            if (expanded) { memberList.setAttribute('hidden', ''); }
            else          { memberList.removeAttribute('hidden'); }
          }
        });
      }

      mobileNav.querySelectorAll('.wa-mobile-nav__parent-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var expanded = btn.getAttribute('aria-expanded') === 'true';
          var sub = document.getElementById(btn.getAttribute('aria-controls'));
          btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
          if (sub) {
            if (expanded) { sub.setAttribute('hidden', ''); }
            else          { sub.removeAttribute('hidden'); }
          }
        });
      });
    }

    // ── 4: Desktop dropdowns ─────────────────────────────────────────────── //

    function closeAllDropdowns(except) {
      if (!primaryNav) return;
      primaryNav.querySelectorAll('.wa-primary-nav__link[aria-expanded]').forEach(function (btn) {
        if (btn === except) return;
        btn.setAttribute('aria-expanded', 'false');
        var dd = document.getElementById(btn.getAttribute('aria-controls'));
        if (dd) dd.classList.remove('is-open');
      });
    }

    if (primaryNav) {
      // Mouse: open on hover, close on mouseleave of parent item
      primaryNav.querySelectorAll('.wa-primary-nav__item--has-dropdown').forEach(function (item) {
        var btn = item.querySelector('.wa-primary-nav__link[aria-haspopup]');
        var dd  = btn ? document.getElementById(btn.getAttribute('aria-controls')) : null;
        if (!btn || !dd) return;

        item.addEventListener('mouseenter', function () {
          closeAllDropdowns(btn);
          btn.setAttribute('aria-expanded', 'true');
          dd.classList.add('is-open');
        });

        item.addEventListener('mouseleave', function () {
          btn.setAttribute('aria-expanded', 'false');
          dd.classList.remove('is-open');
        });

        // Keyboard: click/Enter/Space toggles; ArrowDown opens and focuses first item
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var open = btn.getAttribute('aria-expanded') === 'true';
          closeAllDropdowns(btn);
          btn.setAttribute('aria-expanded', open ? 'false' : 'true');
          if (open) { dd.classList.remove('is-open'); }
          else      { dd.classList.add('is-open'); }
        });

        btn.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown' || e.keyCode === 40) {
            e.preventDefault();
            btn.setAttribute('aria-expanded', 'true');
            dd.classList.add('is-open');
            var first = dd.querySelector('a');
            if (first) first.focus();
          }
        });

        // Arrow key navigation inside dropdown
        dd.addEventListener('keydown', function (e) {
          var links = Array.from(dd.querySelectorAll('.wa-nav-dropdown__link'));
          var idx   = links.indexOf(document.activeElement);
          if (e.key === 'ArrowDown' || e.keyCode === 40) {
            e.preventDefault();
            var next = links[idx + 1] || links[0];
            if (next) next.focus();
          } else if (e.key === 'ArrowUp' || e.keyCode === 38) {
            e.preventDefault();
            var prev = links[idx - 1] || links[links.length - 1];
            if (prev) prev.focus();
          }
        });
      });

      // ── 5: Close on outside click ───────────────────────────────────────── //
      document.addEventListener('click', function (e) {
        if (!primaryNav.contains(e.target)) closeAllDropdowns();
      });
    }

    // ── 7: Scroll listener ───────────────────────────────────────────────── //

    if (memberMenu && memberBtn) {
      memberBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = memberMenu.classList.contains('is-open');
        memberMenu.classList.toggle('is-open', !open);
        memberBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      });

      document.addEventListener('click', function (e) {
        if (!memberMenu.contains(e.target)) closeMemberDropdown();
      });
    }

    if (header) {
      window.addEventListener('scroll', function () {
        if (window.scrollY > 60) {
          header.classList.add('is-scrolled');
        } else {
          header.classList.remove('is-scrolled');
        }
      }, { passive: true });
    }

    // ── 8: Close mobile nav on resize to desktop ─────────────────────────── //

    var mq = window.matchMedia('(min-width: 1140px)');

    function onBreakpointChange(e) {
      if (e.matches && mobileNav && !mobileNav.hasAttribute('hidden')) {
        closeMobileNav();
      }
    }

    if (mq.addEventListener) {
      mq.addEventListener('change', onBreakpointChange);
    } else if (mq.addListener) {
      mq.addListener(onBreakpointChange);
    }

  }); // end DOMContentLoaded

}());
