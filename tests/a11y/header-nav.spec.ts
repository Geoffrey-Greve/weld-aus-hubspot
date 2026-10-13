/**
 * Issue 54 - the desktop primary nav must never collide with the actions group.
 *
 * The reported bug was "on tablet in landscape, long first names cause the menu
 * to stretch to the right and fall off the screen". Two separate mechanisms
 * produced that, and fixing either one alone leaves the other:
 *
 *   1. `.wa-primary-nav` was `flex: 1` with no `min-width: 0`, so its default
 *      `min-width: auto` refused to shrink below the intrinsic width of its
 *      nowrap links and pushed `.wa-nav-bar__actions` off the right edge.
 *   2. Once it could shrink, the nowrap list kept its intrinsic width and simply
 *      painted OVER the actions instead - different symptom, same collision.
 *
 * Neither is really about the name. Measured against the seven-item fallback
 * menu in Poppins, the desktop nav needs 670px and gets 574px at 1024px, so at
 * iPad landscape width the menu cannot fit however short the name is truncated.
 * That is why the desktop breakpoint is 1140px rather than 1024px - it first
 * fits at 1120px, but only by 12px, and 1140px leaves 31px of headroom.
 *
 * This suite asserts the geometry directly, because the older a11y/header.html
 * fixture uses simplified `wa-nav` markup and has none of it.
 */
import { test, expect } from '@playwright/test'

/** The breakpoint at which header.module swaps the hamburger for the full nav. */
const DESKTOP_BREAKPOINT = 1140

/** 1px absorbs sub-pixel layout rounding; a real collision is tens of px. */
const TOLERANCE_PX = 1

const WIDTHS = [
  { width: 1024, label: 'iPad 9.7"/10.2" landscape' },
  { width: 1120, label: 'just below the desktop breakpoint' },
  { width: DESKTOP_BREAKPOINT, label: 'the desktop breakpoint itself' },
  { width: 1180, label: 'iPad Air / Pro 11" landscape' },
  { width: 1366, label: 'iPad Pro 12.9" landscape' },
  { width: 1440, label: 'small laptop' },
]

type NavBox = {
  navVisible: boolean
  navLeft: number
  navContentWidth: number
  actionsLeft: number
  actionsRight: number
  viewport: number
  hamburgerVisible: boolean
  clippedLinks: string[]
}

async function measure(page: import('@playwright/test').Page): Promise<NavBox> {
  return page.evaluate(() => {
    const nav = document.querySelector('.wa-primary-nav') as HTMLElement
    const list = document.querySelector('.wa-primary-nav__list') as HTMLElement
    const actions = document.querySelector('.wa-nav-bar__actions') as HTMLElement
    const hamburger = document.querySelector('.wa-hamburger') as HTMLElement
    const visible = (el: HTMLElement) => getComputedStyle(el).display !== 'none'
    return {
      navVisible: visible(nav),
      navLeft: nav.getBoundingClientRect().left,
      // scrollWidth is the width the nowrap list WANTS, which is the number that
      // determines whether it overlaps - the border box alone would hide it.
      navContentWidth: list.scrollWidth,
      actionsLeft: actions.getBoundingClientRect().left,
      actionsRight: actions.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
      hamburgerVisible: visible(hamburger),
      // `.wa-primary-nav__link` carries overflow: hidden as a backstop, so a menu
      // that does not fit now CLIPS instead of overlapping. That makes a pure
      // geometry check blind to it - the list stops reporting overflow because
      // its items shrank. Catching a clipped label is what detects "the menu no
      // longer fits" under that backstop.
      clippedLinks: Array.from(document.querySelectorAll('.wa-primary-nav__link'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent || '').trim()),
    }
  })
}

test.describe('Header primary nav fits across tablet and desktop widths', () => {
  for (const { width, label } of WIDTHS) {
    test(`${width}px (${label}): actions stay on screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/a11y/header-nav.html')
      await page.waitForLoadState('networkidle')
      // Every measurement here is a text-width measurement, so it is only
      // meaningful once Poppins has actually painted.
      await page.evaluate(() => document.fonts.ready)

      const m = await measure(page)
      // The original defect: the member control pushed past the right edge.
      expect(m.actionsRight).toBeLessThanOrEqual(m.viewport + TOLERANCE_PX)
    })

    test(`${width}px (${label}): nav and actions do not overlap`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/a11y/header-nav.html')
      await page.waitForLoadState('networkidle')
      // Every measurement here is a text-width measurement, so it is only
      // meaningful once Poppins has actually painted.
      await page.evaluate(() => document.fonts.ready)

      const m = await measure(page)
      if (!m.navVisible) return // hamburger territory - nothing to collide

      const contentRight = m.navLeft + m.navContentWidth
      expect(contentRight).toBeLessThanOrEqual(m.actionsLeft + TOLERANCE_PX)

      // Every top-level label must be fully readable. If this trips, the menu
      // has outgrown the space at this width and DESKTOP_BREAKPOINT needs to go
      // up (or the menu needs to lose an item) - the clipping backstop is there
      // to stop it looking broken, not to make silently hidden nav acceptable.
      expect(m.clippedLinks, 'nav labels clipped - the menu does not fit').toEqual([])
    })
  }

  test('exactly one of the desktop nav and the hamburger is shown at each width', async ({ page }) => {
    for (const { width } of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/a11y/header-nav.html')
      await page.waitForLoadState('networkidle')
      // Every measurement here is a text-width measurement, so it is only
      // meaningful once Poppins has actually painted.
      await page.evaluate(() => document.fonts.ready)

      const m = await measure(page)
      // Guards the half-applied breakpoint: the switch lives in seven media
      // queries plus a matchMedia in module.js, so it is easy to move some and
      // not others and end up with both or neither.
      expect(
        m.navVisible,
        `at ${width}px the desktop nav should be ${width >= DESKTOP_BREAKPOINT ? 'shown' : 'hidden'}`
      ).toBe(width >= DESKTOP_BREAKPOINT)
      expect(m.hamburgerVisible, `at ${width}px the hamburger should be the inverse`).toBe(
        width < DESKTOP_BREAKPOINT
      )
    }
  })

  // The tablet band caps the member name at 96px; full-width desktop allows 150px.
  const NAME_CAP_PX: Record<number, number> = { 1180: 96, 1366: 96, 1440: 150 }

  for (const width of [1180, 1366, 1440]) {
    test(`${width}px: an absurd first name is capped, not allowed to push the nav`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/a11y/header-nav.html')
      await page.waitForLoadState('networkidle')
      // Every measurement here is a text-width measurement, so it is only
      // meaningful once Poppins has actually painted.
      await page.evaluate(() => document.fonts.ready)

      const nameWidth = await page.evaluate(() => {
        const el = document.getElementById('wa-profile-name')
        if (el) el.textContent = 'Bartholomewhendricksonwallingford'
        return el ? el.getBoundingClientRect().width : 0
      })

      // The cap is what stops an arbitrarily long name eating the menu's room.
      // Note it bounds GROWTH - a short name renders narrower than the cap, so
      // this deliberately does not assert a fixed width.
      expect(nameWidth).toBeLessThanOrEqual(NAME_CAP_PX[width] + TOLERANCE_PX)

      // And the thing the ticket actually reported: nothing leaves the screen,
      // and the menu still does not collide with the member control.
      const m = await measure(page)
      expect(m.actionsRight).toBeLessThanOrEqual(m.viewport + TOLERANCE_PX)
      expect(m.navLeft + m.navContentWidth).toBeLessThanOrEqual(m.actionsLeft + TOLERANCE_PX)
    })
  }
})
