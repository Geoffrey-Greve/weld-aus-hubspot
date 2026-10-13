/**
 * logo-strip.module/module.js
 * - Pauses marquee animation on mouse hover and keyboard focus
 * - Respects prefers-reduced-motion: falls back to static grid
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('.wa-logo-strip--marquee').forEach(function (strip) {
      var list = strip.querySelector('.wa-logo-strip__list');
      if (!list) return;

      if (prefersReduced) {
        strip.classList.remove('wa-logo-strip--marquee');
        strip.classList.add('wa-logo-strip--static');
        var dupes = list.querySelectorAll('[aria-hidden="true"]');
        dupes.forEach(function (el) { el.remove(); });
        return;
      }

      function pause() { list.style.animationPlayState = 'paused'; }
      function resume() { list.style.animationPlayState = 'running'; }

      strip.addEventListener('mouseenter', pause);
      strip.addEventListener('mouseleave', resume);
      strip.addEventListener('focusin', pause);
      strip.addEventListener('focusout', resume);
    });
  });
}());
