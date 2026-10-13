/**
 * Horizontal-overflow guard at mobile width.
 *
 * Runs only under the `mobile-chrome` project (see playwright.config.ts).
 *
 * NOT a scrollWidth assertion. base.css sets `html, body { overflow-x: clip }`
 * as a backstop, which clamps `document.documentElement.scrollWidth` to the
 * padding box - so `scrollWidth <= clientWidth` would be vacuously true forever
 * and would never catch a regression. Walking the tree and checking each box's
 * right edge still detects overflow with that guard in place.
 *
 * Regression this locks in: `.btn` used to carry `white-space: nowrap`, so any
 * CTA with a long label ran off the right edge on a phone (QA 240/237) or, in
 * an `overflow: hidden` card, clipped its own content (QA 224).
 *
 * Two suites live here, and they are deliberate complements:
 *
 *   1. "No horizontal overflow" - nothing escapes the VIEWPORT. It exempts any
 *      element clipped by an ancestor, because a marquee or a scroller that
 *      overflows inside `overflow: hidden` is intentional.
 *   2. "Content is not clipped by its own card" - nothing escapes its own
 *      CLIPPING CONTAINER. That exemption in (1) is precisely where QA 224
 *      hid: the card's grid track grew past its padding box, `overflow: hidden`
 *      silently cut the heading and the CTA, and the page-level walk saw
 *      nothing wrong because the card itself still fitted the viewport.
 *
 * Coverage: `membership-directory-cta` is the first HubL-module fixture here;
 * the rest are React islands. The other HubL modules (split-feature, hero)
 * still have no fixture and are verified against a real sandbox upload.
 */

import { test, expect } from '@playwright/test'

/** Static fixtures under /a11y that the Vite dev server serves. */
const FIXTURES = [
  'header',
  'course-filter',
  'find-a-member',
  'resource-library',
  'member-dashboard',
  'corporate-admin',
  'checkout',
  'membership-directory-cta',
] as const

// 1px absorbs sub-pixel layout rounding. Real overflow is tens of px.
const TOLERANCE_PX = 1

test.describe('No horizontal overflow at mobile width', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture} fits the viewport`, async ({ page }) => {
      await page.goto(`/a11y/${fixture}.html`)
      await page.waitForLoadState('networkidle')

      const offenders = await page.evaluate((tolerance) => {
        // clientWidth is the viewport content width and is NOT clamped by
        // overflow-x: clip, so a 100vw element still registers as overflowing.
        const limit = document.documentElement.clientWidth

        /**
         * An element can't widen the page if an ancestor clips or scrolls it.
         * This single rule legitimises every intentional case without an
         * allowlist to maintain - the logo-strip and testimonial marquees
         * (width: max-content inside an overflow:hidden viewport), the
         * horizontally scrollable sub-nav, and the compare-table scroller are
         * all covered by it.
         *
         * The walk stops ABOVE <body> on purpose. base.css sets
         * `html, body { overflow-x: clip }` as a site-wide backstop, so
         * including body here would mark every element on every page as
         * "legitimately clipped" and the suite would pass unconditionally.
         * (It did - caught by injecting a deliberate 600px-wide div and
         * watching the test stay green.) Only clipping *inside* the page
         * counts as intentional.
         */
        const isClippedByAncestor = (el: Element): boolean => {
          for (
            let p = el.parentElement;
            p && p !== document.body && p !== document.documentElement;
            p = p.parentElement
          ) {
            if (getComputedStyle(p).overflowX !== 'visible') return true
          }
          return false
        }

        const out: string[] = []

        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') continue
          // Viewport-anchored: off-canvas drawers and toasts park off-screen by design.
          if (style.position === 'fixed') continue

          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue

          // Right edge only. Content left of the origin can't be scrolled to and
          // doesn't extend the scroll area; checking rect.left would false-positive
          // on the fixtures' own `.skip-to-content { left: -9999px }`.
          if (rect.right <= limit + tolerance) continue
          if (isClippedByAncestor(el)) continue

          const id = el.id ? `#${el.id}` : ''
          const cls =
            typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).join('.')}`
              : ''
          out.push(
            `${el.tagName.toLowerCase()}${id}${cls} → right ${Math.round(rect.right)}px (limit ${limit}px)`
          )
        }

        return out.slice(0, 15)
      }, TOLERANCE_PX)

      expect(
        offenders,
        `${offenders.length} element(s) extend past the right edge on ${fixture}.html:\n` +
          offenders.join('\n')
      ).toEqual([])
    })
  }
})

/**
 * Fixtures whose cards clip their own content, checked against the CARD rather
 * than the viewport.
 *
 * Scoped to a list rather than run over every fixture on purpose: the island
 * fixtures carry marquees and horizontal scrollers that overflow their
 * `overflow: hidden` viewport by design, and they would fail this rule for
 * reasons that are not bugs.
 */
const CLIPPING_FIXTURES = [
  { fixture: 'membership-directory-cta', card: '.wa-membership-directory__card' },
] as const

/**
 * Widths, not one width. QA 224 was reported on a phone, but the failure mode
 * is a grid track that will not shrink, so it appears wherever the card gets
 * narrow - including the tablet end of the single-column media query.
 */
const MOBILE_WIDTHS = [320, 360, 375, 393, 412, 480, 600, 768, 819] as const

test.describe('Content is not clipped by its own card', () => {
  for (const { fixture, card } of CLIPPING_FIXTURES) {
    for (const width of MOBILE_WIDTHS) {
      test(`${fixture} fits inside ${card} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/a11y/${fixture}.html`)
        await page.waitForLoadState('networkidle')
        // Poppins is wider than the system fallback, and that difference is
        // what decides whether a label fits. Measuring before it loads would
        // make this test pass against the wrong font.
        await page.evaluate(() => document.fonts.ready)

        const offenders = await page.evaluate(
          ({ card, tolerance }) => {
            const root = document.querySelector<HTMLElement>(card)
            if (!root) throw new Error(`card selector ${card} matched nothing`)

            const style = getComputedStyle(root)
            const rect = root.getBoundingClientRect()
            // Padding box, not border box. Content that reaches into the card's
            // own padding is already visually touching the edge.
            const limit = rect.right - parseFloat(style.paddingRight)

            const out: string[] = []

            for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
              const s = getComputedStyle(el)
              if (s.display === 'none' || s.visibility === 'hidden') continue
              // The decorative background image is inset:0 by design.
              if (s.position === 'absolute' || s.position === 'fixed') continue

              const r = el.getBoundingClientRect()
              if (r.width === 0 || r.height === 0) continue

              // Two distinct failures. `boxOver`: the element's border box runs
              // past the card's padding box - the grid-track bug. `textOver`:
              // the box fits but its own content paints wider than it, which is
              // how a non-wrapping label gets cut mid-word.
              const boxOver = r.right - limit
              const textOver = el.scrollWidth - el.clientWidth
              if (boxOver <= tolerance && textOver <= tolerance) continue

              const cls =
                typeof el.className === 'string' && el.className.trim()
                  ? `.${el.className.trim().split(/\s+/).join('.')}`
                  : ''
              out.push(
                `${el.tagName.toLowerCase()}${cls} → box +${Math.round(boxOver)}px, content +${textOver}px`
              )
            }

            return out.slice(0, 15)
          },
          { card, tolerance: TOLERANCE_PX }
        )

        expect(
          offenders,
          `${offenders.length} element(s) are clipped by ${card} at ${width}px on ${fixture}.html:\n` +
            offenders.join('\n')
        ).toEqual([])
      })
    }
  }
})
