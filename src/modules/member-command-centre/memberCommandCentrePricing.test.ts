/**
 * Defect 213 - "Member pricing mis-match between the member portal and the courses
 * page when signed in."
 *
 * The portal priced courses off `profile.member_tier`, which is a DISPLAY label:
 * member-command-centre.module falls it back to the literal "Member" (and to
 * "Support needed" on the no-membership profile) so the hero always reads sensibly.
 * Those strings are not inert. normaliseMemberPriceTier('Member') matches the
 * "member" substring and resolves to the `individual` tier, so the portal read
 * price_individual, while /courses/ - which sends '' when no tier resolves - read
 * price_member. Two different HubDB columns for the same signed-in visitor.
 *
 * These tests pin the two surfaces together: whatever tier a visitor has, the portal
 * and the course page must resolve the same number.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isPricingMember, pricingTier } from './MemberCommandCentre'
import { resolveMemberPrice, resolveRegistrationPrice } from '@shared/utils/memberPricing'
import type { PreviewProfile } from './types'

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    })

  if (!channels || channels.length !== 3) return 0

  const [r, g, b] = channels as [number, number, number]
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

// Deliberately different values per column so a wrong column is a wrong number.
const COURSE = {
  price_member: 3460,
  price_individual: 3615,
  price_student: 1800,
  price_bronze: 3300,
  price_silver: 3100,
  price_gold: 2900,
  price_non_member: 3900,
}

function profile(overrides: Partial<PreviewProfile> = {}): PreviewProfile {
  return {
    profile_key: 'crm-1',
    member_tier: 'Member',
    membership_status: 'Active',
    is_linked_member: true,
    ...overrides,
  } as PreviewProfile
}

/** What the portal quotes, end to end. */
function portalPrice(p: PreviewProfile): number {
  return isPricingMember(p) ? resolveMemberPrice(COURSE, pricingTier(p)).price : 0
}

/** What /courses/ quotes for the same visitor (CourseFilter → resolveRegistrationPrice). */
function coursePagePrice(isMember: boolean, tier: string): number {
  return resolveRegistrationPrice(COURSE, isMember, tier)
}

describe('portal vs course-page price parity (defect 213)', () => {
  it('does not let the "Member" display fallback pick a different column', () => {
    // The original regression: the portal's display label 'Member' matched the "member"
    // substring inside the INDIVIDUAL branch and resolved to price_individual (3615),
    // while the course page sent '' and resolved to price_member (3460). Same visitor,
    // two numbers.
    //
    // That asymmetry no longer exists: a bare 'Member' now resolves to the generic
    // member level, matching both an empty tier and the Worker's own canonicaliser
    // (config/member-tier-levels.json). So the display label leaking into pricing is
    // harmless rather than merely avoided, which is a stronger version of what this
    // test was guarding.
    expect(resolveMemberPrice(COURSE, 'Member').price).toBe(3460)
    expect(resolveMemberPrice(COURSE, '').price).toBe(3460)

    const p = profile({ member_tier: 'Member', pricing_member_tier: '', is_pricing_member: true })
    expect(portalPrice(p)).toBe(coursePagePrice(true, ''))
    expect(portalPrice(p)).toBe(3460)

    // And the label still cannot pick a column the course page would not: the property
    // this test exists for is the two agreeing, whatever the label is.
    expect(portalPrice(profile({ member_tier: 'Member', pricing_member_tier: 'Member' }))).toBe(
      coursePagePrice(true, 'Member')
    )
  })

  it.each([
    ['Corporate Gold', 2900],
    ['Corporate Silver', 3100],
    ['Corporate Bronze', 3300],
    ['Apprentice', 1800],
    ['Individual', 3615],
  ])('agrees with the course page for %s', (tier, expected) => {
    const p = profile({
      member_tier: tier,
      pricing_member_tier: tier,
      is_pricing_member: true,
    })
    expect(portalPrice(p)).toBe(expected)
    expect(portalPrice(p)).toBe(coursePagePrice(true, tier))
  })

  it('quotes nothing for the "Support needed" no-membership profile', () => {
    const p = profile({
      member_tier: 'Support needed',
      pricing_member_tier: '',
      is_pricing_member: false,
      is_linked_member: false,
      membership_status: 'Grace period',
    })
    expect(isPricingMember(p)).toBe(false)
    expect(portalPrice(p)).toBe(0)
    // Which is what the course page does for a non-member: public price only.
    expect(coursePagePrice(false, '')).toBe(COURSE.price_non_member)
  })

  it('quotes nothing for a lapsed member', () => {
    const p = profile({
      member_tier: 'Corporate Gold',
      pricing_member_tier: 'Corporate Gold',
      is_pricing_member: false,
      membership_status: 'Lapsed',
    })
    expect(portalPrice(p)).toBe(0)
  })
})

describe('isPricingMember / pricingTier fallbacks', () => {
  it('falls back to the legacy fields when HubL has not been redeployed yet', () => {
    // A portal page still serving the previous props has neither new field. It must
    // not price off member_tier - the whole point of the fix - so the tier is empty
    // and the generic member rate applies, matching /courses/.
    const legacy = profile({ member_tier: 'Corporate Gold' })
    delete (legacy as Partial<PreviewProfile>).pricing_member_tier
    delete (legacy as Partial<PreviewProfile>).is_pricing_member

    expect(isPricingMember(legacy)).toBe(true)
    expect(pricingTier(legacy)).toBe('')
    expect(portalPrice(legacy)).toBe(3460)
  })

  it('treats a lapsed legacy profile as not entitled', () => {
    const legacy = profile({ membership_status: 'Lapsed' })
    delete (legacy as Partial<PreviewProfile>).is_pricing_member
    expect(isPricingMember(legacy)).toBe(false)
  })

  it('never returns a tier for a visitor who is not entitled', () => {
    const p = profile({ pricing_member_tier: 'Corporate Gold', is_pricing_member: false })
    expect(pricingTier(p)).toBe('')
  })
})

/**
 * Defect 213, truncation half.
 *
 * The public serialisers passed the five tier columns through as |float but
 * truncated price_member / price_non_member with |int, while the portal used
 * |float throughout. A $577.50 course therefore rendered $577 on /courses/ and
 * $577.50 in the portal - and inside a single card a Gold member saw an
 * un-truncated struck-through price against a truncated one.
 */
describe('cent-level prices survive serialisation', () => {
  const CENTS = {
    price_member: 577.5,
    price_individual: 0,
    price_student: 0,
    price_bronze: 0,
    price_silver: 0,
    price_gold: 612.75,
    price_non_member: 899.5,
  }

  it('resolves the generic member rate without dropping cents', () => {
    expect(resolveMemberPrice(CENTS, '').price).toBe(577.5)
  })

  it('resolves a tier rate without dropping cents', () => {
    expect(resolveMemberPrice(CENTS, 'Corporate Gold').price).toBe(612.75)
  })

  it('quotes the same number in the portal as on the course page', () => {
    const p = profile({ pricing_member_tier: 'Corporate Gold', is_pricing_member: true })
    const portal = resolveMemberPrice(CENTS, pricingTier(p)).price
    const coursePage = resolveMemberPrice(CENTS, 'Corporate Gold').price
    expect(portal).toBe(coursePage)
    expect(portal).toBe(612.75)
  })

  it('no serialiser truncates a price with |int', () => {
    // The regression was mechanical, so guard it mechanically.
    const serialisers = [
      'theme/modules/course-filter.module/module.html',
      'theme/modules/course-timetable-filter.module/module.html',
      'theme/modules/checkout-tunnel.module/module.html',
      'theme/templates/pages/course-timetable-hub.html',
      'theme/templates/pages/course-router.html',
    ]
    for (const path of serialisers) {
      const source = readFileSync(resolve(__dirname, '../../../', path), 'utf8')
      const truncated = source
        .split('\n')
        .filter((line) => /price/.test(line) && /\|\s*int\b/.test(line))
      expect(truncated).toEqual([])
    }
  })
})

describe('member portal course-card price rendering contract', () => {
  it('keeps the portal module wired to the shared pricing helper', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../theme/modules/member-command-centre.module/module.html'),
      'utf8'
    )

    expect(source).toContain('_member-pricing.html')
    expect(source).toContain('wa_price.member_price(row')
    expect(source).toContain('wa_price.non_member_price(row)')
  })

  it('keeps a visible course-fee fallback when there is no member discount', () => {
    const source = readFileSync(resolve(__dirname, './MemberCommandCentre.tsx'), 'utf8')

    expect(source).toContain('courseActualPrice')
    expect(source).toContain('course fee')
    expect(source).toContain('hasMemberDiscount')
  })

  it('keeps portal course cards on course detail pages instead of checkout', () => {
    const moduleSource = readFileSync(
      resolve(__dirname, '../../../theme/modules/member-command-centre.module/module.html'),
      'utf8'
    )
    const reactSource = readFileSync(resolve(__dirname, './MemberCommandCentre.tsx'), 'utf8')

    expect(moduleSource).toContain("{% set course_url = course_detail_url %}")
    expect(moduleSource).not.toContain("{% set course_url = '/checkout/?session_id='")
    expect(reactSource).toContain("'View details'")
    expect(reactSource).not.toContain(": 'Register'")
  })
})

describe('member portal success-badge contrast', () => {
  it('uses the darker success text token on light-green badge surfaces', () => {
    const css = readFileSync(resolve(__dirname, './MemberCommandCentre.css'), 'utf8')

    expect(contrastRatio('#146c39', '#e8f7ef')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#1f8a4d', '#e8f7ef')).toBeLessThan(4.5)
    expect(css).toContain('--mcc-green-text: var(--wa-color-success-text, #146c39);')
    expect(css).toMatch(/\.wa-mcc__hero-status--success\s*\{[\s\S]*?color:\s*var\(--mcc-green-text\);/)
    expect(css).toMatch(/\.wa-mcc__course-status\s*\{[\s\S]*?color:\s*var\(--mcc-green-text\);/)
    expect(css).toMatch(/\.wa-mcc__status-pill--success,\s*[\s\S]*?\.wa-mcc__paid-pill\s*\{[\s\S]*?color:\s*var\(--mcc-green-text\);/)
  })
})

describe('member portal course-card and subtle-copy contrast', () => {
  it('keeps remaining course/event pricing text above AA contrast', () => {
    const css = readFileSync(resolve(__dirname, './MemberCommandCentre.css'), 'utf8')

    expect(contrastRatio('#146c39', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#1f8a4d', '#ffffff')).toBeLessThan(4.5)
    expect(contrastRatio('#667085', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#8b94a8', '#ffffff')).toBeLessThan(4.5)
    expect(css).toMatch(/\.wa-mcc__course-price-member\s*\{[\s\S]*?color:\s*var\(--mcc-green-text\);/)
    expect(css).toMatch(/\.wa-mcc__course-price-non\s*\{[\s\S]*?color:\s*var\(--mcc-muted\);/)
  })

  it('does not dim whole card rows or small supporting copy below AA contrast', () => {
    const css = readFileSync(resolve(__dirname, './MemberCommandCentre.css'), 'utf8')

    expect(contrastRatio('#667085', '#f7f8fb')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#778097', '#f5f7fb')).toBeLessThan(4.5)
    expect(contrastRatio('#b20d67', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#ed128d', '#ffffff')).toBeLessThan(4.5)
    expect(contrastRatio('#805300', '#fef4e5')).toBeGreaterThanOrEqual(4.5)
    expect(css).toMatch(/\.wa-mcc__eyebrow\s*\{[\s\S]*?color:\s*var\(--mcc-magenta-text\);/)
    expect(css).toMatch(/\.wa-mcc__step-name--locked\s*\{[\s\S]*?color:\s*var\(--mcc-muted\);/)
    expect(css).toMatch(/\.wa-mcc__data-note\s*\{[\s\S]*?color:\s*var\(--mcc-muted\);/)
    expect(css).toMatch(/\.wa-mcc__resource-row--locked\s*\{[\s\S]*?background:\s*#f2f4f8;[\s\S]*?border-color:\s*#d8deea;[\s\S]*?\}/)
    expect(css).not.toMatch(/\.wa-mcc__resource-row--locked\s*\{[\s\S]*?opacity:/)
  })
})
