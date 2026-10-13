(function () {
  'use strict';

  function activate(facade) {
    var src = facade.getAttribute('data-video-src');
    if (!src) return;

    var type = facade.getAttribute('data-video-type') || 'video/mp4';
    var label = facade.getAttribute('data-video-label') || 'Membership video';
    var frame = facade.parentNode;
    if (!frame) return;

    var video = document.createElement('video');
    video.className = 'wa-membership-intro__video';
    video.setAttribute('controls', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('muted', '');
    video.setAttribute('aria-label', label);
    video.muted = true;

    var source = document.createElement('source');
    source.src = src;
    source.type = type;
    video.appendChild(source);

    var fallback = document.createElement('a');
    fallback.href = src;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    fallback.textContent = label;
    video.appendChild(fallback);

    frame.replaceChild(video, facade);

    try {
      video.focus();
      var play = video.play();
      if (play && typeof play.catch === 'function') {
        play.catch(function () {
          // If autoplay is blocked, controls remain visible for manual playback.
        });
      }
    } catch (error) {
      // Native controls remain available if focus/play is blocked.
    }
  }

  document.addEventListener('click', function (event) {
    var facade = event.target.closest && event.target.closest('.wa-membership-intro__video-facade');
    if (!facade) return;
    event.preventDefault();
    activate(facade);
  });
})();
