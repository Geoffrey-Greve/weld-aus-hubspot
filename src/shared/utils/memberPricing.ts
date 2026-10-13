export interface TierPricedItem {
  price_member?: number | string | null
  price_individual?: number | string | null
  price_student?: number | string | null
  price_bronze?: number | string | null
  price_silver?: number | string | null
  price_gold?: number | string | null
  price_non_member?: number | string | null

  /**
   * A tier's price stated as a PERCENTAGE off `price_non_member` rather than in
   * dollars (QA ref 73, events-engine migration 0044).
   *
   * The `events` HubDB table prices this way - one public figure and
   * `gold_discount_` / `silver_discount_` / `bronze_discount_` beside it - while
   * `courses` names an absolute column per tier. Both are legitimate price lists and
   * the tenant keys one of each, so neither shape gets to be the only one: forcing
   * them together would leave two columns per tier free to disagree the moment
   * somebody edits the wrong one.
   *
   * Nothing on the `courses` path sets these, so a course row resolves exactly as it
   * did before.
   */
  discount_member?: number | string | null
  discount_individual?: number | string | null
  discount_student?: number | string | null
  discount_bronze?: number | string | null
  discount_silver?: number | string | null
  discount_gold?: number | string | null
}

export type MemberPriceTierKey =
  | 'individual'
  | 'student'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'member'

export interface ResolvedMemberPrice {
  price: number
  tierKey: MemberPriceTierKey
  label: string
  fallbackUsed: boolean
}

const TIER_LABELS: Record<MemberPriceTierKey, string> = {
  individual: 'Individual member rate',
  student: 'Apprentice/student member rate',
  bronze: 'Corporate Bronze member rate',
  silver: 'Corporate Silver member rate',
  gold: 'Corporate Gold member rate',
  member: 'Member rate',
}

function numericValue(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  const cleaned = value.replace(/[$,\s]/g, '')
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : 0
}

export function normaliseMemberPriceTier(memberTier: string | null | undefined): MemberPriceTierKey {
  const raw = (memberTier || '').trim().toLowerCase()
  if (!raw) return 'member'

  const value = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (value.includes('gold')) return 'gold'
  if (value.includes('silver')) return 'silver'
  if (value.includes('bronze')) return 'bronze'
  if (value.includes('apprentice') || value.includes('student')) return 'student'
  if (
    value.includes('individual') ||
    value.includes('reciprocal') ||
    value.includes('associate') ||
    value.includes('honorary') ||
    value.includes('honourary') ||
    value.includes('industry supplier')
  ) {
    return 'individual'
  }

  // Everything else, including a label that is just "Member" or "Corporate Member",
  // takes the generic `price_member` column.
  //
  // This branch used to also catch `value.includes('member')` and send it to
  // `individual`. The Worker's own canonicaliser (toCanonicalMemberLevel in
  // events-engine membership.ts) has always given bare "member" its own level, so
  // those labels were priced from `price_individual` on the page and `price_member`
  // at reserve. Where both columns are set and differ that is either a refused
  // booking (resolved higher than quoted → price_mismatch, "the course price changed
  // before checkout") or a silent undercharge (resolved lower → honoured, logged).
  //
  // Narrowing it here cannot introduce a new disagreement: when `price_member` is
  // blank the shared fallback chain in resolveMemberPrice below is member →
  // individual → non-member, so such a label still lands on `price_individual`
  // exactly as before. It only changes the answer in the case the two sides already
  // disagreed. `individual` keeps its own keywords, so "Individual Member" is
  // unaffected — 'individual' matches first.
  return 'member'
}

function priceForTier(item: TierPricedItem, tierKey: MemberPriceTierKey): number {
  switch (tierKey) {
    case 'gold':
      return numericValue(item.price_gold)
    case 'silver':
      return numericValue(item.price_silver)
    case 'bronze':
      return numericValue(item.price_bronze)
    case 'student':
      return numericValue(item.price_student)
    case 'individual':
      return numericValue(item.price_individual)
    case 'member':
      return numericValue(item.price_member)
  }
}

function discountForTier(item: TierPricedItem, tierKey: MemberPriceTierKey): number {
  switch (tierKey) {
    case 'gold':
      return numericValue(item.discount_gold)
    case 'silver':
      return numericValue(item.discount_silver)
    case 'bronze':
      return numericValue(item.discount_bronze)
    case 'student':
      return numericValue(item.discount_student)
    case 'individual':
      return numericValue(item.discount_individual)
    case 'member':
      return numericValue(item.discount_member)
  }
}

/**
 * This tier's percentage applied to the public price, or 0.
 *
 * Off the NON-MEMBER price, which is what "Gold members get 20% off" means on a page
 * showing one public figure, and which is what the Worker does
 * (`applyLevelDiscount` in events-engine hubdb-pricing.ts). Taking it off
 * `price_member` instead would discount an already-discounted number, and the two
 * sides would land on different figures for the same buyer.
 *
 * A percentage outside (0, 100) is IGNORED rather than honoured: 0 is "nobody entered
 * one", the state of most rows, and 100 or more gives a seat away, where a
 * fat-fingered cell is far likelier than a tenant meaning it. A free seat is a 0 in
 * the absolute column, where it is unambiguous.
 */
export function tierDiscountPrice(item: TierPricedItem, tierKey: MemberPriceTierKey): number {
  const percent = discountForTier(item, tierKey)
  if (!(percent > 0) || percent >= 100) return 0

  const base = numericValue(item.price_non_member)
  if (!(base > 0)) return 0

  return Math.round(base * (1 - percent / 100) * 100) / 100
}

export function resolveMemberPrice(
  item: TierPricedItem,
  memberTier: string | null | undefined
): ResolvedMemberPrice {
  const tierKey = normaliseMemberPriceTier(memberTier)
  // The chain, mirroring the Worker's `resolveHubDbMemberPrice` step for step: the
  // tier's own absolute column, then the tier's own discount, then the generic
  // member / individual / public fallbacks.
  //
  // The discount sits ABOVE the generic member price because the buyer's tier is the
  // more specific statement about them, and it can legitimately resolve DEARER than
  // `price_member` - a 5% bronze discount on a $500 event is $475 against a $450
  // generic member rate. The page quotes the tier, so the invoice must too.
  const exactPrice = priceForTier(item, tierKey)
  const discountPrice = exactPrice > 0 ? 0 : tierDiscountPrice(item, tierKey)
  const tierPrice = exactPrice || discountPrice
  const fallbackPrice =
    numericValue(item.price_member) ||
    numericValue(item.price_individual) ||
    numericValue(item.price_non_member)

  return {
    price: tierPrice || fallbackPrice,
    tierKey,
    label: TIER_LABELS[tierKey],
    fallbackUsed: tierPrice <= 0 && fallbackPrice > 0,
  }
}

export function resolveRegistrationPrice(
  item: TierPricedItem,
  isMember: boolean,
  memberTier: string | null | undefined
): number {
  return isMember ? resolveMemberPrice(item, memberTier).price : numericValue(item.price_non_member)
}

/**
 * Rank for "best" membership tier when a contact holds more than one context
 * (individual + corporate employee). Higher wins. Mirrors the Profile Switcher
 * rule: prefer the highest corporate tier, then student, then individual.
 */
const TIER_RANK: Record<MemberPriceTierKey, number> = {
  gold: 60,
  silver: 50,
  bronze: 40,
  student: 30,
  individual: 20,
  member: 10,
}

export function memberPriceTierRank(memberTier: string | null | undefined): number {
  return TIER_RANK[normaliseMemberPriceTier(memberTier)]
}

/**
 * Pick the strongest tier label from several candidates (contact, company,
 * company-ID unlock). Empty strings are ignored. Used so checkout and the
 * portal quote the same rate when a corporate employee also has a weaker
 * individual membership (defect 126).
 */
export function pickBestMemberTier(
  ...candidates: Array<string | null | undefined>
): string {
  let best = ''
  let bestRank = -1
  for (const candidate of candidates) {
    const value = (candidate || '').trim()
    if (!value) continue
    const rank = memberPriceTierRank(value)
    if (rank > bestRank) {
      best = value
      bestRank = rank
    }
  }
  return best
}
