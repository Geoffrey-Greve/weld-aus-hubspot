/**
 * testimonial-slider.js - Vanilla JS carousel for .wa-testimonial-slider.
 *
 * Loaded lazily via IntersectionObserver in testimonial-slider.module/module.html
 * so it never blocks the initial render.
 *
 * Reads data attributes from the <section>:
 *   data-autoplay  "true" | "false"
 *   data-interval  milliseconds (autoplay delay)
 *
 * Handles multiple sliders on the same page.
 */

(function () {
  'use strict'

  function initSlider(section) {
    var track = section.querySelector('.wa-testimonial-slider__track')
    var slides = section.querySelectorAll('.wa-testimonial-slider__slide')
    var dots = section.querySelectorAll('.wa-testimonial-slider__dot')
    var btnPrev = section.querySelector('.wa-testimonial-slider__btn--prev')
    var btnNext = section.querySelector('.wa-testimonial-slider__btn--next')

    if (!track || slides.length < 2) return

    var total = slides.length
    var current = 0
    var autoplay = section.dataset.autoplay === 'true'
    var interval = parseInt(section.dataset.interval, 10) || 5000
    var timer = null

    function goTo(index) {
      var prev = current
      current = (index + total) % total

      // Update slides
      slides[prev].classList.remove('wa-testimonial-slider__slide--active')
      slides[prev].setAttribute('aria-hidden', 'true')
      slides[current].classList.add('wa-testimonial-slider__slide--active')
      slides[current].setAttribute('aria-hidden', 'false')

      // Update dots
      if (dots.length) {
        dots[prev].classList.remove('wa-testimonial-slider__dot--active')
        dots[prev].setAttribute('aria-selected', 'false')
        dots[current].classList.add('wa-testimonial-slider__dot--active')
        dots[current].setAttribute('aria-selected', 'true')
      }
    }

    function next() { goTo(current + 1) }
    function prev() { goTo(current - 1) }

    function startAutoplay() {
      if (!autoplay) return
      stopAutoplay()
      timer = setInterval(next, interval)
    }

    function stopAutoplay() {
      if (timer) { clearInterval(timer); timer = null }
    }

    if (btnNext) {
      btnNext.addEventListener('click', function () { stopAutoplay(); next(); startAutoplay() })
    }
    if (btnPrev) {
      btnPrev.addEventListener('click', function () { stopAutoplay(); prev(); startAutoplay() })
    }

    // Dot buttons
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var idx = parseInt(dot.dataset.index, 10)
        if (!isNaN(idx)) { stopAutoplay(); goTo(idx); startAutoplay() }
      })
    })

    // Pause on hover / focus
    section.addEventListener('mouseenter', stopAutoplay)
    section.addEventListener('mouseleave', startAutoplay)
    section.addEventListener('focusin', stopAutoplay)
    section.addEventListener('focusout', startAutoplay)

    // Keyboard: arrow keys when focus is inside the slider
    section.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { stopAutoplay(); prev(); startAutoplay() }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { stopAutoplay(); next(); startAutoplay() }
    })

    // Swipe / touch support
    var touchStartX = 0
    section.addEventListener('touchstart', function (e) {
      touchStartX = e.changedTouches[0].screenX
    }, { passive: true })
    section.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].screenX - touchStartX
      if (Math.abs(dx) > 50) { stopAutoplay(); dx < 0 ? next() : prev(); startAutoplay() }
    }, { passive: true })

    startAutoplay()
  }

  function init() {
    document.querySelectorAll('.wa-testimonial-slider').forEach(initSlider)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
