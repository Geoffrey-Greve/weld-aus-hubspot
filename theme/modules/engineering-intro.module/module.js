(function () {
  function findFacade(target) {
    while (target && target !== document) {
      if (target.classList && target.classList.contains('wa-engineering-intro__video-facade')) {
        return target
      }
      target = target.parentNode
    }
    return null
  }

  function withAutoplay(src) {
    if (!src) return ''
    var joiner = src.indexOf('?') === -1 ? '?' : '&'
    return src + joiner + 'autoplay=1'
  }

  document.addEventListener('click', function (event) {
    var button = findFacade(event.target)
    if (!button) return

    var videoWrap = button.parentNode
    var videoSrc = button.getAttribute('data-video-src')
    var videoTitle = button.getAttribute('data-video-title') || 'Weld Australia Engineering Services'

    if (!videoWrap || !videoSrc) return

    var iframe = document.createElement('iframe')
    iframe.src = withAutoplay(videoSrc)
    iframe.title = videoTitle
    iframe.loading = 'lazy'
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    iframe.allowFullscreen = true

    videoWrap.innerHTML = ''
    videoWrap.appendChild(iframe)
    iframe.focus()
  })
})()
