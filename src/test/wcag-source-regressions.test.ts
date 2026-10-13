/**
 * WCAG source-level regression guards.
 *
 * These assert the exact defects fixed in the 2026-07-15 WCAG 2.1 AA
 * remediation stay fixed. They read the theme source directly (no browser),
 * so they catch a regression the moment someone re-introduces it in HubL/CSS.
 *
 * Colour contrast ratios (WCAG 1.4.3 / 1.4.11) live in wcag-contrast.test.ts —
 * this file only checks that accessible token *names* are still referenced.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const countMatches = (haystack: string, needle: RegExp) =>
  (haystack.match(needle) ?? []).length

describe('WCAG 2.4.1 - skip link', () => {
  it('base.html renders exactly one skip link → #main-content', () => {
    const base = read('theme/templates/layouts/base.html')
    expect(countMatches(base, /class="skip-to-content"/g)).toBe(1)
    expect(base).toContain('href="#main-content"')
    expect(base).toMatch(/<main id="main-content" tabindex="-1">/)
  })

  it('header module no longer emits a second (broken) skip link', () => {
    const header = read('theme/modules/header.module/module.html')
    expect(header).not.toContain('skip-to-content')
    expect(header).not.toContain('wa-main-content')
  })

  it('skip link is styled globally in base.css (not only the header module)', () => {
    const baseCss = read('theme/assets/css/base.css')
    expect(baseCss).toContain('.skip-to-content')
    // revealed on both :focus and :focus-visible
    expect(baseCss).toMatch(/\.skip-to-content:focus\b/)
  })

  it('auth pages do not duplicate id="main-content"', () => {
    for (const p of ['theme/templates/pages/login.html', 'theme/templates/pages/reset.html']) {
      expect(read(p)).not.toContain('id="main-content"')
    }
  })
})

describe('WCAG 1.3.1 - heading order', () => {
  it('checkout page provides a top-level h1', () => {
    const checkout = read('theme/templates/pages/checkout.html')
    expect(checkout).toMatch(/<h1[^>]*>/)
  })
})

describe('WCAG 3.3.2 - auth native status labels', () => {
  it('hides empty HubSpot auth status labels as a visual fallback', () => {
    const authCss = read('theme/assets/css/auth.css')
    expect(authCss).toMatch(
      /\.is-auth-page label\.hs-membership-global-error:empty,\s*\.is-auth-page label\.hs-membership-global-message:empty\s*\{[\s\S]*display:\s*none\s*!important;/s
    )
  })

  it('normalizes HubSpot auth global status labels so WAVE does not see empty labels', () => {
    const base = read('theme/templates/layouts/base.html')
    expect(base).toContain("document.body.classList.contains('is-auth-page')")
    expect(base).toContain("label.hs-membership-global-error, label.hs-membership-global-message")
    expect(base).toContain("document.createElement('div')")
    expect(base).toContain("replaceChild(replacement, label)")
    expect(base).toContain("role', isError ? 'alert' : 'status'")
    expect(base).toContain('MutationObserver')
  })
})

describe('WCAG 2.4.4 - redundant links', () => {
  it('hidden mobile nav is inert so it is not a duplicate link set', () => {
    const header = read('theme/modules/header.module/module.html')
    expect(header).toMatch(/id="wa-mobile-nav"[\s\S]*?inert/)
  })
})

describe('WCAG 1.4.3 - accessible text-tone tokens exist', () => {
  it('tokens.css defines the AA magenta/gold/semantic text tones', () => {
    const tokens = read('theme/assets/css/tokens.css')
    for (const t of [
      '--wa-color-magenta-text',
      '--wa-color-magenta-on-dark',
      '--wa-color-gold-text',
      '--wa-color-success-text',
      '--wa-color-info-text',
      '--wa-color-text-muted-on-dark',
    ]) {
      expect(tokens).toContain(t)
    }
  })

  it('footer muted meta text uses the AA on-dark muted token (not low-opacity lavender)', () => {
    const footerCss = read('theme/modules/footer.module/module.css')
    expect(footerCss).toContain('--wa-color-text-muted-on-dark')
    expect(footerCss).toMatch(
      /\.wa-footer__acknowledgement\s*\{[^}]*color:\s*var\(--wa-color-text-muted-on-dark/s
    )
    expect(footerCss).toMatch(
      /\.wa-footer__copyright\s*\{[^}]*color:\s*var\(--wa-color-text-muted-on-dark/s
    )
    // No live color declarations still using the old low-opacity lavender.
    expect(footerCss).not.toMatch(/color:\s*rgba\(\s*184\s*,\s*190\s*,\s*219\s*,/i)
  })

  it('no body/meta text uses white-on-navy below the AA floor (α ≤ 0.46)', () => {
    // White α ≤ 0.46 on primary (#1c1e4c) is < 4.5:1. Clear fails fixed 2026-08
    // now use --wa-color-text-muted-on-dark instead.
    const files = [
      'theme/assets/css/team-profile.css',
      'theme/assets/css/course-detail.css',
      'theme/assets/css/blog.css',
      'theme/assets/css/certification-detail.css',
      'theme/assets/css/job-detail.css',
      'theme/assets/css/job-board.css',
      'theme/modules/tiers.module/module.css',
      'theme/modules/engineering-iwe-team.module/module.css',
    ]
    const lowAlpha = /(?:^|[;{]\s*)\s*color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.(?:3\d|4[0-6])\s*\)/im
    for (const file of files) {
      expect(read(file), file).not.toMatch(lowAlpha)
    }
  })

  it('card-grid gold/green pills no longer use white text on mid-tone fills', () => {
    const css = read('theme/modules/card-grid.module/module.css')
    expect(css).toMatch(
      /\.wa-card-grid--photo_overlay\s+\.wa-card-grid__tag--gold\s*\{[^}]*color:\s*#5c3d00/s
    )
    expect(css).toMatch(
      /\.wa-card-grid--photo_overlay\s+\.wa-card-grid__tag--green\s*\{[^}]*color:\s*#0a4d2c/s
    )
    expect(css).not.toMatch(
      /\.wa-card-grid--photo_overlay\s+\.wa-card-grid__tag--gold\s*\{[^}]*color:\s*#fff/s
    )
    expect(css).not.toMatch(
      /\.wa-card-grid--photo_overlay\s+\.wa-card-grid__tag--green\s*\{[^}]*color:\s*#fff/s
    )
  })

  it('resource doc meta ("PDF · Free") uses AA muted text, not translucent navy', () => {
    const css = read('theme/modules/split-feature.module/module.css')
    expect(css).toMatch(
      /\.wa-split-feature__doc-desc\s*\{[^}]*color:\s*var\(--wa-color-text-muted/s
    )
    expect(css).not.toMatch(
      /\.wa-split-feature__doc-desc\s*\{[^}]*color:\s*rgba\(\s*15\s*,\s*16\s*,\s*48/s
    )
  })

  it('the overline no longer uses raw brand magenta as small text', () => {
    const components = read('theme/assets/css/components.css')
    const block = components.slice(components.indexOf('.wa-overline__text'))
    expect(block).toContain('--wa-color-magenta-text')
  })
})
