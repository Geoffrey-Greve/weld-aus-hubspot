/**
 * Every surface that prices a course must resolve the buyer's employer the same way.
 *
 * Three strengths of the same resolution shipped side by side. The checkout swept
 * Contact → Company associations; the five course-pricing surfaces read
 * `associatedcompanyid` and nothing else, in five byte-identical copies.
 *
 * `associatedcompanyid` is only ever set for a PRIMARY association, and a large part
 * of Weld's corporate membership is linked to an employer by an ordinary association
 * with no primary among them — the same finding that fixed the Worker's own
 * `price_mismatch` failures. So a Gold employee saw the PUBLIC price on the course
 * page, the /courses directory, the timetable, the fees panel and the cards, and
 * their member price only if they reached the checkout. Most never do. That is QA
 * Ref 72 and it is squarely against objective 5 in CLAUDE.md §1.
 *
 * HubL cannot be executed here, so this asserts the structural property that the bug
 * was: that no pricing surface resolves a company on its own any more. Five copies is
 * what let them drift apart, so the test is about there being one.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

/** Every surface that turns a HubDB row into a price for a logged-in visitor. */
const PRICING_SURFACES = [
  'theme/modules/course-filter.module/module.html',
  'theme/modules/course-timetable-filter.module/module.html',
  'theme/modules/featured-courses.module/module.html',
  'theme/modules/courses-upcoming-sessions.module/module.html',
  'theme/modules/pricing-table.module/module.html',
]

const RESOLVER = 'theme/templates/partials/_member-company-resolve.html'

describe('the shared company resolver', () => {
  const source = read(RESOLVER)

  it('tries the contact mirror before spending an API call', () => {
    // Free: already on request_contact. Checkout reads it first for the same reason.
    expect(source).toContain('wa_company_membership_tier')
    expect(source).toContain('wa_company_membership_status')
  })

  it('sweeps ordinary associations when there is no primary one', () => {
    // The actual fix. 279 is the unlabeled v4 type, 1 the legacy one — the same pair
    // checkout-tunnel uses, because that is the version proven in production.
    expect(source).toContain('crm_associations')
    expect(source).toContain('[279, 1]')
  })

  it('keeps company ids as strings, so a 12-digit id is not truncated', () => {
    // `|int` on a 12-digit HubSpot id is how the sweep would silently return a
    // different company. The resolver must never pipe a candidate id through it.
    expect(source).not.toMatch(/wa_company_(candidate_id|assoc_id|sweep\.id)[^\n]*\|\s*int/)
  })

  it('does nothing at all for an anonymous visitor', () => {
    // These are public, high-traffic pages. Almost all the traffic must pay nothing,
    // so every step sits inside one logged-in gate.
    expect(source).toContain('{% if request_contact.is_logged_in %}')
  })

  it('scrubs the CRM "no membership" sentinels on the way out', () => {
    // Callers must not scrub twice, so the partial owns it.
    expect(source).toContain('wa_tier_co.scrub')
  })

  it('declares wa_company_from_sweep before the branch that sets it', () => {
    // The sweep block does not run on every path, so reading its namespace outside
    // would be an undefined reference — which is what the first draft of this did.
    const declared = source.indexOf('{% set wa_company_from_sweep = false %}')
    const used = source.indexOf('{% if wa_company_from_sweep %}')
    expect(declared).toBeGreaterThan(-1)
    expect(used).toBeGreaterThan(declared)
  })
})

describe('no pricing surface resolves a company on its own', () => {
  it.each(PRICING_SURFACES)('%s uses the shared resolver', (file) => {
    expect(read(file)).toContain('_member-company-resolve.html')
  })

  it.each(PRICING_SURFACES)('%s no longer reads a company record directly', (file) => {
    // The five identical copies of `crm_object('company', …)` are the thing that
    // drifted from checkout. Adding one back here is how this bug comes back.
    expect(read(file)).not.toContain("crm_object('company'")
  })

  it.each(PRICING_SURFACES)('%s passes both inputs the resolver needs', (file) => {
    const source = read(file)
    // Without the contact ids the sweep has nothing to sweep, and the surface
    // silently degrades to exactly the behaviour this replaced.
    expect(source).toContain('{% set wa_company_in_company_id =')
    expect(source).toContain('{% set wa_company_in_contact_ids =')
  })

  it.each(PRICING_SURFACES)('%s sets the inputs BEFORE including the resolver', (file) => {
    const source = read(file)
    const inputs = source.indexOf('{% set wa_company_in_contact_ids =')
    const include = source.indexOf('_member-company-resolve.html')
    expect(inputs).toBeLessThan(include)
  })
})

describe('checkout keeps its own sweep until it adopts the resolver', () => {
  it('still resolves a company for a member with no primary association', () => {
    // Checkout is the money path and was already correct, so it is deliberately not
    // rewritten in the same change. This pins the behaviour the course pages were
    // just brought up to, so the two cannot diverge in the other direction while the
    // duplication remains.
    const checkout = read('theme/modules/checkout-tunnel.module/module.html')
    expect(checkout).toContain('crm_associations')
    expect(checkout).toContain('[279, 1]')
  })
})
