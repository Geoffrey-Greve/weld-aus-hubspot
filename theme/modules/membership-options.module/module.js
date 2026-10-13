document.querySelectorAll('.wa-membership-options').forEach((root) => {
  const tabs = Array.from(root.querySelectorAll('[data-membership-tab]'))
  const panels = Array.from(root.querySelectorAll('[data-membership-panel]'))
  const tabList = root.querySelector('.wa-membership-options__tabs')

  if (!tabs.length || !panels.length) return

  const tabKeys = tabs.map((tab) => tab.getAttribute('data-membership-tab'))
  const isCompactMobile = () => {
    const matchesBreakpoint =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 680px)').matches
    /* Some Android WebViews report a wider layout viewport than the visible screen. */
    const hasScrollableTabs = tabList && tabList.scrollWidth > tabList.clientWidth
    return matchesBreakpoint || hasScrollableTabs
  }

  /*
   * Hashes in the wild do not always match tab_key. Nav items, campaign links,
   * the membership prospectus and legacy WordPress URLs use the client-facing
   * wording instead, so map those onto the real keys rather than silently
   * doing nothing (which is what /membership#membership-industry did).
   */
  const HASH_ALIASES = {
    industry: 'supplier',
    'industry-supplier': 'supplier',
    'industry-suppliers': 'supplier',
    suppliers: 'supplier',
    business: 'corporate',
    company: 'corporate',
    companies: 'corporate',
    corporates: 'corporate',
    'corporate-membership': 'corporate',
    individuals: 'individual',
    personal: 'individual',
    apprentice: 'free',
    apprentices: 'free',
    student: 'free',
    students: 'free',
    'student-apprentice': 'free',
    'free-membership': 'free',
    rto: 'free',
    tafe: 'free'
  }

  /*
   * Fragments reach us percent-encoded from campaign links and hand-authored
   * URLs (`#membership-industry%20supplier`), so decode before matching -
   * `location.hash` keeps the escapes. decodeURIComponent throws on a malformed
   * escape, so fall back to the raw value rather than losing the whole hash.
   */
  const decodeHash = (value) => {
    const raw = String(value == null ? '' : value)
      .trim()
      .replace(/^#/, '')
    try {
      return decodeURIComponent(raw).toLowerCase()
    } catch (error) {
      return raw.toLowerCase()
    }
  }

  /* Shape an already-decoded fragment into an alias / tab-key candidate. */
  const toKey = (decoded) =>
    decoded
      .replace(/[\s_]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')

  const activate = (key) => {
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute('data-membership-tab') === key
      tab.classList.toggle('is-active', isActive)
      tab.setAttribute('aria-selected', String(isActive))
      tab.tabIndex = isActive ? 0 : -1
    })

    panels.forEach((panel) => {
      const isActive = panel.getAttribute('data-membership-panel') === key
      panel.classList.toggle('is-active', isActive)
      panel.hidden = !isActive
    })
  }

  /*
   * The mobile tab strip scrolls independently from the page. When a footer
   * deep link selects a later tab (such as Free), make that active tab the
   * first visible tab instead of leaving it off to the right.
   */
  const revealActiveTab = (key) => {
    if (!isCompactMobile()) return
    const tab = tabs.find((item) => item.getAttribute('data-membership-tab') === key)
    if (!tab || !tabList) return

    const left = Math.max(tab.offsetLeft - tabList.offsetLeft, 0)
    if (typeof tabList.scrollTo === 'function') {
      tabList.scrollTo({ left, behavior: 'auto' })
    } else {
      tabList.scrollLeft = left
    }
  }

  /* Resolve a decoded hash down to one of the tab keys actually rendered. */
  const resolveTabKey = (decodedHash) => {
    const value = toKey(decodedHash).replace(/^membership-/, '')
    if (!value) return null
    if (tabKeys.indexOf(value) !== -1) return value

    const alias = HASH_ALIASES[value]
    if (alias && tabKeys.indexOf(alias) !== -1) return alias

    /* "corporate-gold" and friends should still land on the corporate tab. */
    return tabKeys.find((key) => value === key || value.indexOf(key + '-') === 0) || null
  }

  const headerOffset = () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      '--wa-site-header-offset'
    )
    const parsed = parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : 110
  }

  const scrollToTarget = (element) => {
    const top = window.scrollY + element.getBoundingClientRect().top - headerOffset() - 24
    /*
     * Android applies the initial fragment jump before the selected tab and
     * its cards finish rendering. A card target can therefore leave the page
     * horizontally offset even after we correct its vertical position. Reset
     * the document scroll origin as part of every controlled deep-link jump.
     */
    window.scrollTo({ left: 0, top: Math.max(top, 0), behavior: 'auto' })
  }

  /*
   * The old implementation scrolled once, inside a single requestAnimationFrame,
   * while the hero image, card logos and web fonts were all still loading -
   * anything that resized above the target left the page parked in the wrong
   * spot. That is why the deep links only worked on a warm cache. Re-apply the
   * scroll as the page settles, and stand down as soon as the visitor scrolls.
   */
  const SETTLE_MS = 1500
  let settleTarget = null
  let settleUntil = 0

  const reapplyScroll = () => {
    if (!settleTarget || Date.now() > settleUntil) return
    scrollToTarget(settleTarget)
  }

  const releaseSettle = () => {
    settleTarget = null
  }

  const scheduleSettle = (target) => {
    settleTarget = target
    settleUntil = Date.now() + SETTLE_MS
    scrollToTarget(target)
    window.requestAnimationFrame(reapplyScroll)
    ;[100, 350, 800, 1400].forEach((delay) => window.setTimeout(reapplyScroll, delay))
  }

  ;['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((type) => {
    window.addEventListener(type, releaseSettle, { passive: true })
  })

  window.addEventListener('load', reapplyScroll)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reapplyScroll)
  root.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', reapplyScroll, { once: true })
  })

  /* Put keyboard focus on the tab we just opened, without fighting the scroll. */
  const focusTab = (key) => {
    if (!key) return
    const tab = tabs.find((item) => item.getAttribute('data-membership-tab') === key)
    if (tab) tab.focus({ preventScroll: true })
  }

  const activateDeepLink = (rawHash) => {
    const hash = decodeHash(rawHash === undefined ? window.location.hash : rawHash)
    if (!hash) return false

    const target = Array.from(root.querySelectorAll('[id]')).find(
      (element) => element.id.toLowerCase() === hash
    )

    if (target) {
      const panel = target.closest('[data-membership-panel]')
      const key =
        target.getAttribute('data-membership-anchor') ||
        target.getAttribute('data-membership-card-tab') ||
        panel?.getAttribute('data-membership-panel')

      if (key) activate(key)
      revealActiveTab(key)
      /*
       * Individual and Reciprocal have card-level anchors for legacy links.
       * Opening those cards directly hides the tab strip above the viewport,
       * unlike the other footer links. Keep the selected tab visible by
       * settling on the tab row instead.
       */
      const scrollTarget = target.hasAttribute('data-membership-card-tab') ? tabList : target
      scheduleSettle(scrollTarget || target)
      focusTab(key)
      return true
    }

    const key = resolveTabKey(hash)
    if (!key) return false

    activate(key)
    revealActiveTab(key)
    scheduleSettle(root.querySelector('[data-membership-anchor="' + key + '"]') || root)
    focusTab(key)
    return true
  }

  tabs.forEach((tab, index) => {
    tab.tabIndex = index === 0 ? 0 : -1

    tab.addEventListener('click', () => {
      activate(tab.getAttribute('data-membership-tab'))
    })

    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()

      let nextIndex = index
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
      if (event.key === 'Home') nextIndex = 0
      if (event.key === 'End') nextIndex = tabs.length - 1

      const next = tabs[nextIndex]
      activate(next.getAttribute('data-membership-tab'))
      next.focus()
    })
  })

  /*
   * Clicking a header/footer link for the hash that is already in the address
   * bar does not fire `hashchange`, so the tab never switched and the page never
   * moved. Handle those clicks ourselves.
   */
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return

    /*
     * Never swallow a click the browser is meant to handle itself:
     * ctrl/cmd/shift/alt-click and non-primary buttons open new tabs or
     * windows, and download / targeted links leave the page entirely.
     */
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link = event.target.closest && event.target.closest('a[href*="#"]')
    if (!link) return
    if (link.hasAttribute('download')) return
    if (link.target && link.target !== '_self') return

    let url
    try {
      url = new URL(link.href, window.location.href)
    } catch (error) {
      return
    }

    if (url.origin !== window.location.origin) return
    if (url.pathname.replace(/\/$/, '') !== window.location.pathname.replace(/\/$/, '')) return
    /* A differing query string is a real navigation - let the browser do it. */
    if (url.search !== window.location.search) return
    if (!url.hash || url.hash === '#') return

    if (activateDeepLink(url.hash)) {
      event.preventDefault()
      if (url.hash !== window.location.hash) window.history.pushState(null, '', url.hash)
    }
  })

  activateDeepLink()
  window.addEventListener('hashchange', () => activateDeepLink())
  window.addEventListener('popstate', () => activateDeepLink())
})
