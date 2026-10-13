/**
 * Automated WCAG 2.1 AA audit - page-level structure and HubL template fixtures.
 *
 * Tests landmark structure, skip-to-content links, heading hierarchy,
 * and page-level axe violations for each static fixture.
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function assertNoViolations(page: Parameters<typeof AxeBuilder>[0]['page']) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .exclude('iframe[src*="hapily"]')
    .exclude('iframe[src*="hubspot"]')
    .analyze()

  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  )
  if (serious.length > 0) {
    const summary = serious
      .map(
        (v) =>
          `[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
          v.nodes
            .slice(0, 2)
            .map((n) => `  → ${n.html}`)
            .join('\n')
      )
      .join('\n\n')
    throw new Error(`${serious.length} serious/critical axe violation(s):\n\n${summary}`)
  }
}

// ─── Page structure (header fixture) ─────────────────────────────────────────

test.describe('Global page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/header.html')
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('page has exactly one banner landmark (the <header>)', async ({ page }) => {
    // axe landmark-one-main rule + banner uniqueness
    const banners = await page.evaluate(() =>
      document.querySelectorAll('[role="banner"], header:not([role])').length
    )
    expect(banners).toBe(1)
  })

  test('page has exactly one main landmark', async ({ page }) => {
    const mains = page.locator('main, [role="main"]')
    await expect(mains).toHaveCount(1)
  })

  test('skip-to-content link is the first focusable element', async ({ page }) => {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
    expect(focused).toBe('Skip to main content')
  })

  test('skip-to-content link target (#main-content) exists and is reachable', async ({
    page,
  }) => {
    const mainContent = page.locator('#main-content')
    await expect(mainContent).toHaveAttribute('tabindex', '-1')
    // Programmatic navigation to skip target
    await page.evaluate(() => {
      const el = document.getElementById('main-content')
      el?.focus()
    })
    const focused = await page.evaluate(() => document.activeElement?.id)
    expect(focused).toBe('main-content')
  })

  test('exactly one skip link, and its target id is unique', async ({ page }) => {
    const skipLinks = page.locator('a.skip-to-content')
    await expect(skipLinks).toHaveCount(1)
    const href = await skipLinks.getAttribute('href')
    expect(href).toBe('#main-content')
    // The target exists exactly once (no duplicate ids, no broken target).
    const targets = await page.evaluate(
      () => document.querySelectorAll('#main-content').length
    )
    expect(targets).toBe(1)
  })

  test('utility bar does NOT carry role="banner"', async ({ page }) => {
    const utilityBar = page.locator('.wa-utility-bar')
    const role = await utilityBar.getAttribute('role')
    expect(role).not.toBe('banner')
  })

  test('mobile nav dialog has role="dialog" and aria-modal', async ({ page }) => {
    const mobileNav = page.locator('#wa-mobile-nav')
    await expect(mobileNav).toHaveAttribute('role', 'dialog')
    await expect(mobileNav).toHaveAttribute('aria-modal', 'true')
    await expect(mobileNav).toHaveAttribute('aria-label')
  })

  test('primary nav has aria-label', async ({ page }) => {
    const nav = page.locator('nav[aria-label="Primary navigation"]')
    await expect(nav).toHaveCount(1)
  })

  test('footer nav has aria-label', async ({ page }) => {
    const footerNav = page.locator('footer nav[aria-label]')
    await expect(footerNav).toHaveCount(1)
  })
})

// ─── Course filter page ───────────────────────────────────────────────────────

test.describe('Course filter page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/course-filter.html')
    await page.waitForSelector('.wa-course-filter')
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('location selector has a visible label', async ({ page }) => {
    const label = page.locator('label[for="wa-cf-city"]')
    await expect(label).toBeVisible()
    await expect(label).toContainText('Select a location')
  })

  test('page has a skip-to-content link', async ({ page }) => {
    const skip = page.locator('a[href="#main-content"]')
    await expect(skip).toHaveCount(1)
  })
})

// ─── Find a member page ───────────────────────────────────────────────────────

test.describe('Find a member page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/find-a-member.html')
    await page.waitForSelector('.wa-fam')
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('search input has an associated label', async ({ page }) => {
    const label = page.locator('label[for="wa-fam-search"]')
    await expect(label).toHaveCount(1)
    // Label may be visually hidden - that's fine
    const forAttr = await label.getAttribute('for')
    const input = page.locator(`#${forAttr}`)
    await expect(input).toHaveCount(1)
  })

  test('member cards are articles with aria-label', async ({ page }) => {
    const cards = page.locator('.wa-fam__card[aria-label]')
    await expect(cards).toHaveCount(await page.locator('.wa-fam__card').count())
  })
})

// ─── Resource library page ────────────────────────────────────────────────────

test.describe('Resource library page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/resource-library.html')
    await page.waitForSelector('.wa-rl')
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('search input has an associated label', async ({ page }) => {
    const label = page.locator('label[for="wa-rl-search"]')
    await expect(label).toHaveCount(1)
  })

  test('resource grid uses <ul role="list">', async ({ page }) => {
    const grid = page.locator('.wa-rl__grid')
    await expect(grid).toHaveAttribute('role', 'list')
  })
})

// ─── Corporate admin page ─────────────────────────────────────────────────────

test.describe('Corporate admin page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/corporate-admin.html')
    await page.waitForSelector('.wa-ca')
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('employee checkboxes are inside a fieldset with legend', async ({ page }) => {
    const fieldset = page.locator('.wa-ca__employee-select')
    await expect(fieldset).toHaveCount(1)
    const legend = fieldset.locator('legend')
    await expect(legend).toHaveText(/Select employees/)
  })
})

// ─── Member dashboard page ────────────────────────────────────────────────────

test.describe('Member dashboard page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/member-dashboard.html')
    await page.waitForSelector('.wa-dashboard', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })
})

// ─── Checkout page ────────────────────────────────────────────────────────────

test.describe('Checkout page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/checkout.html')
    await page.waitForSelector('.wa-checkout-tunnel', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('step indicator is an <ol> with aria-label', async ({ page }) => {
    const steps = page.locator('ol[aria-label="Checkout progress"]')
    await expect(steps).toHaveCount(1)
  })

  test('page has exactly one h1 and starts the heading order at level 1', async ({
    page,
  }) => {
    await expect(page.locator('h1')).toHaveCount(1)
    // No heading level appears before the first h1 in DOM order.
    const firstHeadingLevel = await page.evaluate(() => {
      const h = document.querySelector('h1, h2, h3, h4, h5, h6')
      return h ? Number(h.tagName[1]) : 0
    })
    expect(firstHeadingLevel).toBe(1)
  })
})
