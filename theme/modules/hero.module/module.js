/*
  hero.module/module.js

  Click-to-play poster facade. When a hero has a "Video poster image" set, the
  template renders a <button class="wa-hero__video-facade"> with the poster
  instead of the iframe. On click we swap in the real embed with autoplay so the
  visitor goes straight into the video. Falls back to nothing if no facades exist.

  Delegated from document so it works no matter when this script loads and
  regardless of how many hero instances are on the page.
*/
(function () {
  'use strict';

  function withAutoplay(src) {
    // Append autoplay (and mute for reliable mobile autoplay) using the right
    // separator. Works for both youtube.com/embed/ID and player.vimeo.com URLs.
    var sep = src.indexOf('?') === -1 ? '?' : '&';
    return src + sep + 'autoplay=1&mute=1';
  }

  function play(facade) {
    var src = facade.getAttribute('data-video-src');
    if (!src) return;

    var iframe = document.createElement('iframe');
    iframe.setAttribute('src', withAutoplay(src));
    iframe.setAttribute('title', facade.getAttribute('aria-label') || 'Video');
    iframe.setAttribute(
      'allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    );
    iframe.setAttribute('allowfullscreen', '');

    var frame = facade.parentNode;
    if (!frame) return;
    frame.replaceChild(iframe, facade);
    // Move keyboard focus into the freshly loaded player.
    try { iframe.focus(); } catch (e) {}
  }

  document.addEventListener('click', function (event) {
    var facade = event.target.closest && event.target.closest('.wa-hero__video-facade, .wa-split-feature__video-facade');
    if (facade) {
      event.preventDefault();
      play(facade);
    }
  });
})();
