/*
  locations.module/module.js

  Wires the city list to the SVG map. Clicking a city button focuses the
  matching marker (turns it yellow via .is-active) and clears the others.
  The primary city is rendered active on load; if none is primary, the
  first city is activated.

  Scoped per section (data-wa-locations) so multiple instances don't clash.
  Delegated from document so it works regardless of script load timing.
*/
(function () {
  'use strict';

  function normaliseSlug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
  }

  function activate(section, slug) {
    slug = normaliseSlug(slug);
    if (!slug) return;
    section.querySelectorAll('.wa-locations__pin').forEach(function (m) {
      m.classList.toggle('is-active', normaliseSlug(m.getAttribute('data-city')) === slug);
    });
    section.querySelectorAll('.wa-locations__city').forEach(function (b) {
      var on = normaliseSlug(b.getAttribute('data-city')) === slug;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function initSection(section) {
    if (section.dataset.waLocationsReady) return;
    section.dataset.waLocationsReady = '1';

    // Ensure exactly one city is active on load.
    if (!section.querySelector('.wa-locations__city.is-active')) {
      var first = section.querySelector('.wa-locations__city');
      if (first) activate(section, first.getAttribute('data-city'));
    }

    // Clicking a city button focuses its marker.
    section.querySelectorAll('.wa-locations__city').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activate(section, btn.getAttribute('data-city'));
      });
    });

    // Clicking a pin on the map also selects that city.
    section.querySelectorAll('.wa-locations__pin').forEach(function (pin) {
      pin.addEventListener('click', function () {
        activate(section, pin.getAttribute('data-city'));
      });
    });
  }

  function initAll() {
    document.querySelectorAll('[data-wa-locations]').forEach(initSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll, { once: true });
  } else {
    initAll();
  }
})();
