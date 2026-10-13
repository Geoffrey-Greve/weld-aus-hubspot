import { describe, expect, it } from 'vitest'
import {
  normaliseMemberPriceTier,
  pickBestMemberTier,
  resolveMemberPrice,
  resolveRegistrationPrice,
} from './memberPricing'

const COURSE_PRICES = {
  price_non_member: 5850,
  price_member: 5735,
  price_individual: 5735,
  price_student: 5735,
  price_bronze: 5615,
  price_silver: 5500,
  price_gold: 5380,
}

describe('memberPricing', () => {
  it.each([
    ['individual', 'individual', 5735],
    ['Reciprocal', 'individual', 5735],
    ['Industry Supplier', 'individual', 5735],
    ['Apprentice', 'student', 5735],
    ['Student member', 'student', 5735],
    ['Corporate Bronze', 'bronze', 5615],
    ['corporate_silver', 'silver', 5500],
    // HubDB portal_test_profiles labels (plus-address QA personas)
    ['Silver Corporate', 'silver', 5500],
    ['Gold Corporate', 'gold', 5380],
    ['Bronze Corporate', 'bronze', 5615],
    ['Gold', 'gold', 5380],
  ])('resolves %s to the correct tier price', (tier, expectedKey, expectedPrice) => {
    const result = resolveMemberPrice(COURSE_PRICES, tier)
    expect(result.tierKey).toBe(expectedKey)
    expect(result.price).toBe(expectedPrice)
  })

  it('falls back safely when a specific tier price is not populated', () => {
    const result = resolveMemberPrice(
      {
        price_non_member: 5850,
        price_member: 5735,
        price_gold: 0,
      },
      'Gold'
    )

    expect(result.price).toBe(5735)
    expect(result.fallbackUsed).toBe(true)
  })

  it('returns public pricing for non-members', () => {
    expect(resolveRegistrationPrice(COURSE_PRICES, false, 'Gold')).toBe(5850)
  })

  it('normalises common CRM value shapes', () => {
    expect(normaliseMemberPriceTier('corporate-gold')).toBe('gold')
    expect(normaliseMemberPriceTier('corporate_silver')).toBe('silver')
    expect(normaliseMemberPriceTier('Industry Supplier')).toBe('individual')
  })

  it('keeps an empty tier on price_member, and now a bare "Member" too (126, then the Worker drift)', () => {
    // Defect 126: checkout substituted the literal 'Member' for an empty tier, and
    // 'Member' matched the "member" substring inside the INDIVIDUAL branch, so the
    // substitution silently moved the buyer onto price_individual. The fix was to stop
    // substituting, and this test pinned the asymmetry as the tripwire for it coming
    // back.
    //
    // The asymmetry is now gone at the source: a bare 'Member' resolves to the generic
    // `member` level, the same as an empty tier, because that is what the Worker's
    // canonicaliser has always done and the disagreement was refusing real bookings
    // (see config/member-tier-levels.json). The tripwire is kept as the equality below
    // rather than the difference: if the substitution returns it is now a no-op, which
    // is the outcome 126 wanted in the first place.
    const prices = {
      price_non_member: 5850,
      price_member: 5500,
      price_individual: 5850,
    }
    expect(normaliseMemberPriceTier('')).toBe('member')
    expect(normaliseMemberPriceTier('Member')).toBe('member')
    expect(resolveMemberPrice(prices, '').price).toBe(5500)
    expect(resolveMemberPrice(prices, 'Member').price).toBe(5500)
    expect(resolveRegistrationPrice(prices, true, '')).toBe(5500)
    // A label naming a real tier is still read as that tier: 'individual' is tested
    // before the fallthrough, so this is not a blanket "anything with member" rule.
    expect(normaliseMemberPriceTier('Individual Member')).toBe('individual')
    expect(resolveMemberPrice(prices, 'Individual Member').price).toBe(5850)
  })

  it('prefers corporate metal over a weaker individual membership (defect 126)', () => {
    expect(pickBestMemberTier('Individual', 'Corporate Gold')).toBe('Corporate Gold')
    expect(pickBestMemberTier('Corporate Silver', 'Corporate Gold')).toBe('Corporate Gold')
    expect(pickBestMemberTier('', 'Corporate Bronze', 'corporate_gold')).toBe('corporate_gold')
    expect(pickBestMemberTier('Apprentice', '')).toBe('Apprentice')
    expect(pickBestMemberTier('', '', null)).toBe('')
  })
})
