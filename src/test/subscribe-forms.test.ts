/**
 * Subscribe forms - source-level regression guards.
 *
 * Two modules collect an email address into HubSpot: the global footer
 * newsletter and the Weld Connect block on the news pages. Both have broken the
 * same way, twice, and independently:
 *
 *   1. Each rendered a static `GET /subscribe` form, so subscribing navigated to
 *      /subscribe?email=... instead of submitting.
 *   2. Each was then "fixed" by adding a HubSpot Forms v2 embed alongside that
 *      static form, marked `hidden`. In the footer that left BOTH forms on
 *      screen, because an author-origin `display` beats the UA stylesheet's
 *      `[hidden] { display: none }` - and the visible, better-looking one was
 *      still the broken GET form.
 *
 * They are now the same shape: one form, no native submission target, posted to
 * the HubSpot Forms API by module.js. This file asserts that shape for BOTH
 * modules from one table, so they cannot quietly drift apart again - which is
 * exactly how news-subscribe ended up carrying the bug after the footer's copy
 * of the same code had been fixed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, WCAG_AA_NORMAL } from '../shared/utils/contrast'

const root = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

type SubscribeModule = {
  name: string
  dir: string
  /** Where the form's own styling lives - module.css for one, blog.css for the other. */
  stylesheet: string
  feedbackSelector: string
  errorSelector: string
  buttonSelector: string
  /** Background the status line renders on, for contrast checks. */
  backgrounds: string[]
}

const NEWS_SUBSCRIBE: SubscribeModule = {
  name: 'news-subscribe',
  dir: 'theme/modules/news-subscribe.module',
  stylesheet: 'theme/assets/css/blog.css',
  feedbackSelector: '.wa-news-subscribe__feedback {',
  errorSelector: '.wa-news-subscribe__feedback.is-error {',
  buttonSelector: '.wa-news-subscribe-form button,',
  // banner band (--wa-blog-primary) and the article sidebar card
  backgrounds: ['#1c1e4c', '#202152'],
}

const MODULES: SubscribeModule[] = [
  {
    name: 'footer',
    dir: 'theme/modules/footer.module',
    stylesheet: 'theme/modules/footer.module/module.css',
    feedbackSelector: '.wa-footer__newsletter-feedback {',
    errorSelector: '.wa-footer__newsletter-feedback.is-error {',
    buttonSelector: '.wa-footer__newsletter-button {',
    // .wa-footer__band--nav
    backgrounds: ['#101132'],
  },
  NEWS_SUBSCRIBE,
]

const parts = (m: SubscribeModule) => ({
  html: read(`${m.dir}/module.html`),
  js: read(`${m.dir}/module.js`),
  moduleCss: read(`${m.dir}/module.css`),
  css: read(m.stylesheet),
  fields: JSON.parse(read(`${m.dir}/fields.json`)) as { name: string }[],
})

/** Reads the first hex colour declared in the rule block starting at `selector`. */
const colourIn = (css: string, selector: string): string | undefined => {
  const start = css.indexOf(selector)
  if (start === -1) return undefined
  return css.slice(start).match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1]
}

describe.each(MODULES)('$name - exactly one form', (m) => {
  it('renders a single <form> element', () => {
    expect(parts(m).html.match(/<form\b/g) ?? []).toHaveLength(1)
  })

  it('has no HubSpot Forms embed left behind', () => {
    const { html, js } = parts(m)
    expect(js).not.toContain('hbspt')
    expect(js).not.toContain('js.hsforms.net')
    expect(html).not.toContain('hbspt')
    expect(html).not.toContain('js.hsforms.net')
  })

  it('carries no dead HubSpot embed CSS overrides', () => {
    const { moduleCss } = parts(m)
    for (const selector of ['.hs-form', '.hs-input', '.hs-button', '.submitted-message']) {
      expect(moduleCss).not.toContain(selector)
    }
  })
})

describe.each(MODULES)('$name - cannot navigate to /subscribe on submit', (m) => {
  it('the form declares no action and no method', () => {
    const { html } = parts(m)
    const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'))
    expect(form).not.toMatch(/\baction=/)
    expect(form).not.toMatch(/\bmethod=/)
  })

  it('/subscribe appears only as a link target, never as a form action', () => {
    const { html } = parts(m)
    expect(html).not.toContain('action="/subscribe"')
    expect(html).toContain('href="/subscribe"')
  })

  it('module.js cancels the native submit before doing anything else', () => {
    expect(parts(m).js).toContain('event.preventDefault()')
  })
})

describe.each(MODULES)('$name - submits to the HubSpot Forms API', (m) => {
  it('posts to the v3 submissions endpoint', () => {
    const { js } = parts(m)
    expect(js).toContain('https://api.hsforms.com/submissions/v3/integration/submit/')
    expect(js).toMatch(/method:\s*'POST'/)
  })

  it('sends the hubspotutk cookie as context.hutk for contact attribution', () => {
    const { js } = parts(m)
    expect(js).toContain('hubspotutk')
    expect(js).toContain('payload.context.hutk')
  })

  it('surfaces a failure instead of failing silently', () => {
    const { js } = parts(m)
    expect(js).toContain('data-error-message')
    expect(js).toContain('data-subscribe-url')
  })
})

describe.each(MODULES)('$name - never renders a button that cannot submit', (m) => {
  it('the form only exists when a form has been selected', () => {
    const { html } = parts(m)
    const formIndex = html.indexOf('<form')
    // news-subscribe wraps its form in a macro, so the guard tests the macro's
    // `form_id` parameter rather than the module-level `_form_id`.
    expect(html.slice(0, formIndex)).toMatch(/\{%-? if _?(nl_)?form_id/)
  })

  it('the editor can edit the failure copy', () => {
    const names = parts(m).fields.map((f) => f.name)
    expect(names.some((n) => n.endsWith('error_message'))).toBe(true)
  })
})

describe.each(MODULES)('$name - accessibility', (m) => {
  it('the email input has a real <label>, autocomplete and required', () => {
    const { html } = parts(m)
    const labelFor = html.match(/<label[^>]*\sfor="([^"]+)"/)?.[1]
    expect(labelFor, 'form should have a <label for=...>').toBeDefined()
    expect(html).toContain('autocomplete="email"')
    expect(html).toMatch(/name="email"[\s\S]{0,200}?required/)
  })

  it('the result is announced via a live region', () => {
    const { html } = parts(m)
    const feedback = html.slice(html.indexOf('feedback'))
    expect(feedback).toContain('role="status"')
    expect(feedback).toContain('aria-live="polite"')
  })

  it('the submit button meets the 44px minimum touch target', () => {
    const { css } = parts(m)
    const block = css.slice(css.indexOf(m.buttonSelector))
    const height = block.match(/(?:min-)?height:\s*(\d+)px|var\(--wa-touch-min/)
    expect(height, `${m.buttonSelector} should declare a height`).not.toBeNull()
    if (height?.[1]) expect(Number(height[1])).toBeGreaterThanOrEqual(44)
  })

  it.each([
    ['success', 'feedbackSelector'] as const,
    ['error', 'errorSelector'] as const,
  ])('the %s message meets AA contrast on every background it renders on', (label, key) => {
    const { css } = parts(m)
    const colour = colourIn(css, m[key])
    expect(colour, `${m[key]} should declare a hex colour`).toBeDefined()

    for (const bg of m.backgrounds) {
      const ratio = contrastRatio(colour as string, bg)
      expect(
        ratio,
        `${m.name} ${label}: ${colour} on ${bg} = ${ratio.toFixed(2)}:1 (need ≥ ${WCAG_AA_NORMAL}:1)`
      ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
    }
  })
})

/**
 * news-subscribe renders twice on an article page (sidebar card + bottom
 * banner), which the footer never does.
 */
describe('news-subscribe - two instances on one page stay independent', () => {
  const m = NEWS_SUBSCRIBE

  it('the status line id and the form\'s data-feedback-id both derive from _uid', () => {
    const { html } = parts(m)
    expect(html).toMatch(/_feedback_id = 'wa-news-subscribe-feedback-' ~ _uid/)
    expect(html).toContain('data-feedback-id="{{ feedback_id | escape }}"')
    expect(html).toContain('id="{{ feedback_id }}"')
  })

  it('module.js resolves the status line by id, not by walking the DOM', () => {
    const { js } = parts(m)
    expect(js).toContain("getAttribute('data-feedback-id')")
    expect(js).toContain('document.getElementById(id)')
    expect(js).not.toContain('closest(')
  })

  it('keeps the [hidden] guard that the footer bug came from omitting', () => {
    const { moduleCss } = parts(m)
    expect(moduleCss).toMatch(/\.wa-news-subscribe-form\[hidden\]\s*\{\s*display:\s*none\s*!important/)
  })
})
