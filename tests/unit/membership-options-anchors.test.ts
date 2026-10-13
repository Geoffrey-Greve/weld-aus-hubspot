import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deep-link behaviour for theme/modules/membership-options.module.
 *
 * /membership#membership-<tab> links (header nav, footer, home page tier cards,
 * the membership prospectus) used to land on the wrong tab - or do nothing at
 * all - depending on which hash was used and how far page load had progressed.
 * These tests pin the hash -> tab resolution so that does not regress.
 */

const MODULE_JS = readFileSync(
  resolve(__dirname, '../../theme/modules/membership-options.module/module.js'),
  'utf8'
)

/**
 * Mirrors the markup module.html emits for the tab set configured on
 * theme/templates/pages/membership.html. The `individual` and `reciprocal`
 * anchors belong to cards rather than the section-level anchor list, matching
 * the `_reserved_anchor_keys` guard in the template.
 */
const TABS = [
  { key: 'corporate', cards: ['gold', 'silver', 'bronze'] },
  { key: 'supplier', cards: ['gold', 'silver', 'bronze'] },
  { key: 'individual', cards: ['individual', 'reciprocal'] },
  {
    key: 'free',
    cards: ['student-and-apprentice-membership', 'tafe-and-government-rto-membership']
  }
]
const RESERVED_ANCHOR_KEYS = ['individual', 'reciprocal']

const cardId = (tabKey: string, slug: string) =>
  RESERVED_ANCHOR_KEYS.includes(slug) ? `membership-${slug}` : `membership-${tabKey}-${slug}`

function renderModule(): string {
  const anchors = TABS.filter((tab) => !RESERVED_ANCHOR_KEYS.includes(tab.key))
    .map(
      (tab) =>
        `<span class="wa-membership-options__anchor" id="membership-${tab.key}" data-membership-anchor="${tab.key}"></span>`
    )
    .join('')

  const tabButtons = TABS.map(
    (tab, index) =>
      `<button role="tab" id="wa-membership-tab-x-${tab.key}" data-membership-tab="${tab.key}"
        aria-selected="${index === 0}"
        class="wa-membership-options__tab${index === 0 ? ' is-active' : ''}">${tab.key}</button>`
  ).join('')

  const tabPanels = TABS.map(
    (tab, index) =>
      `<div class="wa-membership-options__panel${index === 0 ? ' is-active' : ''}"
        data-membership-panel="${tab.key}" ${index === 0 ? '' : 'hidden'}>
        ${tab.cards
          .map(
            (card) =>
              `<article class="wa-membership-options__card" id="${cardId(tab.key, card)}"
                data-membership-card="${card}" data-membership-card-tab="${tab.key}"></article>`
          )
          .join('')}
      </div>`
  ).join('')

  return `
    <section class="wa-membership-options" id="membership-options">
      <div class="container">
        <div class="wa-membership-options__anchors" aria-hidden="true">${anchors}</div>
        <div class="wa-membership-options__tabs" role="tablist">${tabButtons}</div>
        ${tabPanels}
      </div>
    </section>
    <a id="nav-corporate" href="/membership#membership-corporate">Corporate</a>
    <a id="nav-industry" href="/membership#membership-industry">Industry supplier</a>
    <a id="nav-benefits" href="/membership#benefits">Benefits</a>
    <a id="nav-campaign" href="/membership?campaign=x#membership-supplier">Campaign</a>
  `
}

let scrollCalls: number
let scrollOptions: ScrollToOptions[]
let tabScrollOptions: ScrollToOptions[]
let compactMobile = true

/**
 * jsdom shares one window/document across a file, but module.js binds its
 * listeners to both. Without this, every mount leaves a listener closed over a
 * detached DOM behind, and those stale handlers run first on the next test.
 */
type Registered = { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject }
let registered: Registered[] = []

function trackListeners() {
  ;[window as EventTarget, document as EventTarget].forEach((target) => {
    const original = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, options) => {
      if (fn) registered.push({ target, type, fn })
      original(type, fn, options)
    })
  })
}

function releaseListeners() {
  registered.forEach(({ target, type, fn }) => target.removeEventListener(type, fn))
  registered = []
}

/** Mount the module against a given URL hash and run its script. */
function mount(hash: string) {
  document.body.innerHTML = renderModule()
  window.history.replaceState(null, '', `/membership${hash}`)
  scrollCalls = 0
  scrollOptions = []
  tabScrollOptions = []

  // jsdom has no layout engine: stub the two APIs the scroll maths depends on.
  window.scrollTo = ((options?: ScrollToOptions | number) => {
    scrollCalls += 1
    if (typeof options === 'object') scrollOptions.push(options)
  }) as typeof window.scrollTo
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: compactMobile && query === '(max-width: 680px)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  const tabList = document.querySelector('.wa-membership-options__tabs') as HTMLElement
  tabList.scrollTo = ((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') tabScrollOptions.push(options)
  }) as typeof tabList.scrollTo
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const isTabList = this.classList.contains('wa-membership-options__tabs')
    const top = isTabList ? 300 : 500
    return { top, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
  })

  trackListeners()

  // module.js is a side-effecting HubSpot module script, not an ES module.
  new Function(MODULE_JS)()
}

const activeTab = () =>
  document
    .querySelector('[data-membership-tab][aria-selected="true"]')
    ?.getAttribute('data-membership-tab')

const visiblePanel = () =>
  document
    .querySelector('[data-membership-panel]:not([hidden])')
    ?.getAttribute('data-membership-panel')

describe('membership-options deep links', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    compactMobile = true
    // The module re-applies its scroll on a few timers as the page settles;
    // fake timers keep those from outliving the test environment.
    vi.useFakeTimers()
  })

  afterEach(() => {
    releaseListeners()
    vi.useRealTimers()
  })

  it.each([
    ['#membership-corporate', 'corporate'],
    ['#membership-supplier', 'supplier'],
    ['#membership-individual', 'individual'],
    ['#membership-free', 'free']
  ])('opens the matching tab for %s', (hash, expected) => {
    mount(hash)
    expect(activeTab()).toBe(expected)
    expect(visiblePanel()).toBe(expected)
    expect(scrollCalls).toBeGreaterThan(0)
    expect(scrollOptions.every((options) => options.left === 0)).toBe(true)
  })

  it('brings a footer-selected Free membership tab into the mobile tab strip', () => {
    mount('#membership-free')
    expect(tabScrollOptions.at(-1)).toMatchObject({ left: 0, behavior: 'auto' })
  })

  it.each([
    // The tab key is `supplier`; links in the wild say "industry".
    ['#membership-industry', 'supplier'],
    ['#membership-industry-supplier', 'supplier'],
    ['#membership-Industry-Supplier', 'supplier'],
    ['#membership-student', 'free'],
    ['#membership-apprentice', 'free'],
    ['#membership-company', 'corporate'],
    // Underscores normalise to hyphens, so the alias table is keyed that way.
    // (This one also resolves via the "corporate-" prefix fallback.)
    ['#membership-corporate_membership', 'corporate'],
    // location.hash keeps percent escapes; they have to be decoded first.
    ['#membership-industry%20supplier', 'supplier'],
    ['#membership-industry%2Dsupplier', 'supplier']
  ])('resolves the aliased hash %s', (hash, expected) => {
    mount(hash)
    expect(activeTab()).toBe(expected)
    expect(visiblePanel()).toBe(expected)
  })

  it('falls back to the raw fragment when it is not valid percent-encoding', () => {
    // decodeURIComponent throws on a lone '%'; the hash must still resolve.
    mount('#membership-corporate%')
    expect(activeTab()).toBe('corporate')
  })

  it.each([
    ['#membership-corporate-gold', 'corporate'],
    ['#membership-reciprocal', 'individual'],
    ['#membership-free-tafe-and-government-rto-membership', 'free']
  ])('opens the owning tab for card anchor %s', (hash, expected) => {
    mount(hash)
    expect(activeTab()).toBe(expected)
    expect(visiblePanel()).toBe(expected)
  })

  it('keeps the tab row visible for the Individual card footer link', () => {
    mount('#membership-individual')
    expect(scrollOptions.at(-1)).toMatchObject({ left: 0, top: 166, behavior: 'auto' })
  })

  it('keeps the desktop tab strip still while aligning Individual to the tab row', () => {
    compactMobile = false
    mount('#membership-individual')
    expect(tabScrollOptions).toHaveLength(0)
    expect(scrollOptions.at(-1)).toMatchObject({ left: 0, top: 166, behavior: 'auto' })
  })

  it('leaves the first tab active and does not scroll without a hash', () => {
    mount('')
    expect(activeTab()).toBe('corporate')
    expect(scrollCalls).toBe(0)
  })

  it('ignores anchors that belong to other sections of the page', () => {
    mount('#benefits')
    expect(activeTab()).toBe('corporate')
    expect(scrollCalls).toBe(0)

    const link = document.getElementById('nav-benefits')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('switches tabs when the hash is already in the address bar', () => {
    // Clicking a link for the current hash fires no `hashchange`, so the tab
    // used to stay put. Navigating between two membership hashes must work too.
    mount('#membership-corporate')
    expect(activeTab()).toBe('corporate')

    document
      .getElementById('nav-industry')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(activeTab()).toBe('supplier')

    document
      .getElementById('nav-corporate')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(activeTab()).toBe('corporate')
  })

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
    ['middle click', { button: 1 }]
  ])('does not intercept a %s click, so the browser can open a new tab', (_label, init) => {
    mount('#membership-corporate')

    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
    document.getElementById('nav-industry')!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(activeTab()).toBe('corporate')
  })

  it('lets a link with a different query string navigate normally', () => {
    // Intercepting would preventDefault and push only the hash, dropping ?campaign=x.
    mount('#membership-corporate')

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('nav-campaign')!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(activeTab()).toBe('corporate')
  })

  it('responds to hashchange', () => {
    mount('#membership-corporate')
    window.history.replaceState(null, '', '/membership#membership-free')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(activeTab()).toBe('free')
  })
})
