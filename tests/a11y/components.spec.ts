/**
 * Automated WCAG 2.1 AA audit - React island components.
 *
 * Each test loads a static fixture page via the Vite dev server, waits for
 * the React island to mount, then runs @axe-core/playwright and asserts zero
 * serious or critical violations.
 *
 * Run with: pnpm test:a11y
 * Requires: pnpm dev server running (playwright.config.ts handles this).
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Shared helper: mount all islands on the page and run axe
async function assertNoViolations(
  page: Parameters<typeof AxeBuilder>[0]['page'],
  waitForSelector?: string
) {
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 10_000 })
  }
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    // Exclude third-party iframes that we don't control
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
  return results
}

// ─── Course Filter ────────────────────────────────────────────────────────────

test.describe('CourseFilter island', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/course-filter.html')
    await page.waitForSelector('.wa-course-filter', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations on load', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('has no violations after switching to Melbourne (sold-out)', async ({ page }) => {
    await page.selectOption('#wa-cf-city', 'Melbourne')
    await assertNoViolations(page)
  })

  test('sold-out session renders a disabled button (not an anchor)', async ({ page }) => {
    await page.selectOption('#wa-cf-city', 'Melbourne')
    const disabledBtn = page.locator('button[disabled]:has-text("Sold out")')
    await expect(disabledBtn).toBeVisible()
    // Must not be an <a> - anchors without href are ambiguous to AT
    const disabledAnchor = page.locator('a[aria-disabled="true"]')
    await expect(disabledAnchor).toHaveCount(0)
  })

  test('cancelled session renders a disabled button', async ({ page }) => {
    await page.selectOption('#wa-cf-city', 'Brisbane')
    const cancelledBtn = page.locator('button[disabled]:has-text("Cancelled")')
    await expect(cancelledBtn).toBeVisible()
  })

  test('EOI form (delivery filter with no sessions) has no violations', async ({ page }) => {
    // The location selector only offers cities this course actually runs in,
    // so the EOI is reached by narrowing delivery instead: Sydney is
    // Face-to-Face only in the fixture.
    await page.selectOption('#wa-cf-city', 'Sydney')
    await page.selectOption('#wa-cf-delivery', 'Blended')
    await page.waitForSelector('.wa-course-filter__eoi')
    await assertNoViolations(page)
  })
})

// A course with no sessions at all renders the EOI form and no location
// selector - its own fixture so the two states can't collide on element ids.
test.describe('CourseFilter island - no sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/course-filter-empty.html')
    await page.waitForSelector('.wa-course-filter__eoi', { timeout: 10_000 })
  })

  test('EOI form has no violations', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('renders no location selector and no city-specific copy', async ({ page }) => {
    await expect(page.locator('#wa-cf-city')).toHaveCount(0)
    await expect(page.locator('.wa-course-filter__eoi')).not.toContainText('scheduled in ')
  })
})

// ─── Find a Member ────────────────────────────────────────────────────────────

test.describe('FindAMember island', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/find-a-member.html')
    await page.waitForSelector('.wa-fam', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations on load', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('filter by tier has no violations', async ({ page }) => {
    const goldChip = page.locator('.wa-filter-chip:has-text("Gold")')
    await goldChip.click()
    // Move keyboard focus away and wait for active styles to settle (transition).
    await page.keyboard.press('Tab')
    await expect(goldChip).toHaveCSS('background-color', 'rgb(28, 30, 76)')
    await assertNoViolations(page)
  })

  test('text search has no violations', async ({ page }) => {
    await page.fill('#wa-fam-search', 'ABC')
    await page.waitForTimeout(400) // debounce
    await assertNoViolations(page)
  })

  test('tier badges use accessible dark text (contrast)', async ({ page }) => {
    // Gold badge: verify the computed color is dark (#5c3d00 / rgb(92,61,0))
    const goldBadge = page.locator('.wa-fam__tier-badge--gold').first()
    const goldColor = await goldBadge.evaluate(
      (el) => getComputedStyle(el).color
    )
    // rgb(92, 61, 0) or similar dark value - NOT the golden #c9a227
    expect(goldColor).not.toContain('201, 162')   // was #c9a227 which was failing contrast
    expect(goldColor).not.toContain('178, 115')   // was #b27330 (bronze used on gold)

    const bronzeBadge = page.locator('.wa-fam__tier-badge--bronze').first()
    const bronzeColor = await bronzeBadge.evaluate(
      (el) => getComputedStyle(el).color
    )
    expect(bronzeColor).not.toContain('178, 115')  // was #b27330 which was failing
  })

  test('filter chips are keyboard-accessible with aria-pressed', async ({ page }) => {
    const chip = page.locator('.wa-filter-chip').first()
    await chip.focus()
    expect(await chip.getAttribute('aria-pressed')).toBe('false')
    await chip.press('Space')
    expect(await chip.getAttribute('aria-pressed')).toBe('true')
  })

  test('sort buttons update aria-pressed state', async ({ page }) => {
    const nameBtn = page.locator('.wa-fam__sort-btn:has-text("Name A")')
    expect(await nameBtn.getAttribute('aria-pressed')).toBe('false')
    await nameBtn.click()
    expect(await nameBtn.getAttribute('aria-pressed')).toBe('true')
  })

  test('result count is announced via aria-live', async ({ page }) => {
    const count = page.locator('[aria-live="polite"][aria-atomic="true"]')
    await expect(count).toHaveCount(1)
  })

  test('empty state has no violations', async ({ page }) => {
    await page.fill('#wa-fam-search', 'xxxxxxxxxxx_no_match')
    await page.waitForTimeout(400)
    await assertNoViolations(page)
  })
})

// ─── Resource Library ─────────────────────────────────────────────────────────

test.describe('ResourceLibrary island', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/resource-library.html')
    await page.waitForSelector('.wa-rl', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations on load', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('locked card shows upgrade CTA, not a broken resource', async ({ page }) => {
    const lockedCard = page.locator('.wa-rl__card--locked')
    await expect(lockedCard).toBeVisible()
    // Locked overlay CTA must be reachable
    const cta = lockedCard.locator('.wa-rl__locked-cta')
    await expect(cta).toBeVisible()
    const href = await cta.getAttribute('href')
    expect(href).toBe('/membership/')
  })

  test('locked card does NOT have aria-live on the overlay', async ({ page }) => {
    const overlay = page.locator('.wa-rl__locked-overlay')
    const ariaLive = await overlay.first().getAttribute('aria-live')
    expect(ariaLive).toBeNull()
  })

  test('keyword search updates result count live region', async ({ page }) => {
    await page.fill('#wa-rl-search', 'Webinar')
    await page.waitForTimeout(400)
    const countEl = page.locator('.wa-rl__count[aria-live="polite"]')
    await expect(countEl).toHaveText(/1 resource/)
  })

  test('category filter has no violations', async ({ page }) => {
    await page.click('.wa-rl__filter-option:has-text("Webinars")')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await assertNoViolations(page)
  })
})

// ─── Corporate Admin ──────────────────────────────────────────────────────────

test.describe('CorporateAdmin island', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/corporate-admin.html')
    await page.waitForSelector('.wa-ca', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations on load', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('voucher progress bar has correct aria attributes', async ({ page }) => {
    const bar = page.locator('[role="progressbar"]')
    await expect(bar).toHaveAttribute('aria-valuenow', '3')
    await expect(bar).toHaveAttribute('aria-valuemin', '0')
    await expect(bar).toHaveAttribute('aria-valuemax', '10')
  })

  test('employee checkboxes are keyboard-navigable', async ({ page }) => {
    const checkboxes = page.locator('.wa-ca__employee-list input[type="checkbox"]')
    await expect(checkboxes).toHaveCount(3)
    await checkboxes.first().focus()
    await checkboxes.first().press('Space')
    expect(await checkboxes.first().isChecked()).toBe(true)
  })

  // The fixture carries two sessions: index 1 is Event-Engine-backed (renders the
  // self-service submit button), index 2 is not (renders the mailto CTA). The
  // error-region tests below drive the mailto path, where the CTA stays clickable
  // while aria-disabled and reports why.
  test('submit with no employees selected shows error', async ({ page }) => {
    await page.selectOption('#wa-ca-session', { index: 2 })
    // Fallback CTA is a mailto anchor with pointer-events:none while aria-disabled.
    await page.locator('.wa-ca__bulk-actions .wa-btn--primary').dispatchEvent('click')
    const error = page.locator('[role="alert"]')
    await expect(error).toBeVisible()
  })

  test('error message is a role="alert" region', async ({ page }) => {
    await page.selectOption('#wa-ca-session', { index: 2 })
    await page.locator('.wa-ca__bulk-actions .wa-btn--primary').dispatchEvent('click')
    const alert = page.locator('.wa-ca__error[role="alert"]')
    await expect(alert).toBeVisible()
  })

  test('self-service submit is disabled until employees are selected', async ({ page }) => {
    await page.selectOption('#wa-ca-session', { index: 1 })
    const submit = page.locator('.wa-ca__bulk-actions button[type="submit"]')
    await expect(submit).toBeDisabled()

    await page.locator('.wa-ca__employee-list input[type="checkbox"]').first().check()
    await expect(submit).toBeEnabled()
  })
})

// ─── Checkout Tunnel ──────────────────────────────────────────────────────────

test.describe('CheckoutTunnel island', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/a11y/checkout.html')
    await page.waitForSelector('.wa-checkout-tunnel', { timeout: 10_000 })
  })

  test('has no serious/critical axe violations on step 1', async ({ page }) => {
    await assertNoViolations(page)
  })

  test('step indicator uses aria-current="step" on current step', async ({ page }) => {
    const currentStep = page.locator('.wa-checkout-steps__item[aria-current="step"]')
    await expect(currentStep).toHaveCount(1)
  })

  test('has no violations on step 2 (identify)', async ({ page }) => {
    const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next")').first()
    if (await nextBtn.isVisible()) {
      await nextBtn.click()
      await assertNoViolations(page)
    }
  })
})
