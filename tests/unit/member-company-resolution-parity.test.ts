/**
 * The checkout and the course surfaces find a member's employer the same way.
 *
 * This is the resolution that decides whether a buyer is quoted a member price,
 * and getting it wrong in one place and not the other is the single most
 * expensive bug this project has had. A Gold employee with no PRIMARY company
 * association saw the public price on every course surface and their member
 * price only at the checkout - and when the Worker's own resolution was
 * narrower again, the reserve guard refused the price the page had quoted and
 * the buyer was told "the course price changed before checkout" (QA refs 72,
 * 109, and the events-engine note on resolveAssociatedCompanyId).
 *
 * Five course surfaces now share `_member-company-resolve.html`. The checkout
 * keeps its own, DELIBERATELY: it is a superset, not a copy. It also resolves
 * the company's name, membership expiry and membership number, and it has four
 * company-record lookup forms to the partial's one. Folding the two together
 * would either add a fifth company read to the checkout or push the checkout's
 * full weight onto /courses, the highest-traffic page on the site. Neither is
 * worth it for code tidiness.
 *
 * What matters is that the LADDER cannot drift - the order of the three steps,
 * the association types, and the properties read. So it is pinned here, the way
 * memberPricingParity.test.ts pins the CMS against the Worker across two repos
 * that cannot share code either.
 *
 * If you change one of these files, this test tells you which line to change in
 * the other.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(__dirname, '../../', path), 'utf8')

const SHARED = read('theme/templates/partials/_member-company-resolve.html')
const CHECKOUT = read('theme/modules/checkout-tunnel.module/module.html')

const BOTH: Array<[string, string]> = [
  ['_member-company-resolve.html', SHARED],
  ['checkout-tunnel.module', CHECKOUT],
]

describe.each(BOTH)('%s', (_name, src) => {
  it('step 1: reads the contact mirror of the employer tier', () => {
    expect(src).toMatch(/wa_company_membership_tier/)
    expect(src).toMatch(/wa_company_membership_status/)
  })

  it('step 2: reads associatedcompanyid', () => {
    expect(src).toMatch(/associatedcompanyid/)
  })

  it('step 3: sweeps contact → company associations when there is no primary', () => {
    // This is the step whose absence priced corporate employees as non-members.
    expect(src).toMatch(/crm_associations\(/)
    expect(src).toMatch(/'HUBSPOT_DEFINED'/)
  })

  it('sweeps unlabeled v4 (279) then legacy (1), in that order', () => {
    expect(src).toMatch(/\[279, 1\]/)
  })

  it('keeps company ids as STRINGS', () => {
    // HubL `| int` overflows a 12-digit CRM id to 0, and Gold silently never
    // loaded for those companies.
    const ladder = src.slice(src.indexOf('crm_associations('))
    expect(ladder).not.toMatch(/company[_a-z]*id[^\n]*\|\s*int\b/)
  })

  it('rejects the same "no company" sentinels HubSpot hands back', () => {
    for (const sentinel of ["'0'", "'None'", "'none'", "'null'", "'[object Object]'"]) {
      expect(src).toContain(sentinel)
    }
  })

  it('reads BOTH the corporate and the industry supplier property families', () => {
    // A supplier resolved off the corporate columns alone reads as no tier at all.
    expect(src).toMatch(/corporate_membership_level_2/)
    expect(src).toMatch(/corporate_membership_status/)
    expect(src).toMatch(/industry_supplier_membership_level_2/)
    expect(src).toMatch(/industry_supplier_membership_status/)
  })

  it('scrubs the CRM "no membership" sentinels through the shared macro file', () => {
    // MEMBERSHIP_SENTINELS in the Worker is kept identical to _member-tier.html's
    // list; scrubbing by hand in one place is how the two come apart.
    expect(src).toMatch(/_member-tier\.html/)
  })
})

describe('the two implementations point at each other', () => {
  it('the shared partial names the checkout as the other implementation', () => {
    expect(SHARED).toContain('checkout-tunnel')
  })

  it('the checkout names the shared partial', () => {
    // Without this a reader has no way to know a second implementation exists.
    expect(CHECKOUT).toContain('_member-company-resolve.html')
  })
})
