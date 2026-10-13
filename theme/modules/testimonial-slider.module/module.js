/**
 * testimonial-slider.module/module.js
 * MTestimonials - spotlight layout interaction only.
 * Grid layout is purely static CSS; no JS required.
 *
 * Handles:
 *   - Selector button click → activate corresponding panel + dot chip
 *   - Dot chip click → same
 *   - Autoplay cycling (6 s interval) with pause-on-interaction restart
 *   - Respects prefers-reduced-motion: no autoplay when reduced motion is set
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('.wa-testimonials__spotlight').forEach(function (wrap) {
    var buttons = Array.prototype.slice.call(wrap.querySelectorAll('.wa-testimonials__selector'));
    var panels  = Array.prototype.slice.call(wrap.querySelectorAll('.wa-testimonials__panel'));
    var dots    = Array.prototype.slice.call(wrap.querySelectorAll('.wa-testimonials__dot'));

    if (!buttons.length || !panels.length) return;

    var current  = 0;
    var timer    = null;
    var autoplay = wrap.dataset.autoplay === 'true' && !reduceMotion;

    function activate(idx) {
      // Deactivate current
      buttons[current].classList.remove('is-active');
      buttons[current].setAttribute('aria-selected', 'false');
      panels[current].classList.remove('is-active');
      panels[current].setAttribute('aria-hidden', 'true');
      if (dots[current]) {
        dots[current].classList.remove('is-active');
        dots[current].setAttribute('aria-selected', 'false');
      }

      // Activate new
      current = idx;
      buttons[current].classList.add('is-active');
      buttons[current].setAttribute('aria-selected', 'true');
      panels[current].classList.add('is-active');
      panels[current].setAttribute('aria-hidden', 'false');
      if (dots[current]) {
        dots[current].classList.add('is-active');
        dots[current].setAttribute('aria-selected', 'true');
      }
    }

    function startTimer() {
      if (!autoplay) return;
      timer = setInterval(function () {
        activate((current + 1) % buttons.length);
      }, 6000);
    }

    function stopTimer() {
      clearInterval(timer);
      timer = null;
    }

    // Selector button clicks
    buttons.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        stopTimer();
        activate(i);
        startTimer();
      });
    });

    // Dot chip clicks
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        stopTimer();
        activate(i);
        startTimer();
      });
    });

    // Keyboard: left/right arrow navigation when focus is on a selector or dot
    wrap.addEventListener('keydown', function (e) {
      var target = e.target;
      var isNavItem =
        target.classList.contains('wa-testimonials__selector') ||
        target.classList.contains('wa-testimonials__dot');

      if (!isNavItem) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        stopTimer();
        activate((current + 1) % buttons.length);
        buttons[current].focus();
        startTimer();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        stopTimer();
        activate((current - 1 + buttons.length) % buttons.length);
        buttons[current].focus();
        startTimer();
      }
    });

    startTimer();
  });
})();
