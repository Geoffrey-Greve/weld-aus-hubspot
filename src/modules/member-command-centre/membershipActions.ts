import type { FinancialItem, MembershipStatus, PreviewProfile } from './types'

export const MEMBERSHIP_JOIN_URL = '/membership/join/'
export const MEMBERSHIP_OPTIONS_URL = '/membership/#membership-options'

/**
 * Map a CRM / display tier label onto the membership-join `?tier=` slug.
 * Unknown / honorary tiers return '' so callers can fall back to the bare join URL.
 */
export function membershipTierSlug(memberTier: string | null | undefined): string {
  const raw = (memberTier || '').trim().toLowerCase().replace(/[_\s]+/g, '-')
  const isSupplier = raw.includes('supplier')
  if (!raw) return ''
  if (raw.includes('gold')) return isSupplier ? 'supplier-gold' : 'corporate-gold'
  if (raw.includes('silver')) return isSupplier ? 'supplier-silver' : 'corporate-silver'
  if (raw.includes('bronze')) return isSupplier ? 'supplier-bronze' : 'corporate-bronze'
  if (isSupplier) return 'supplier-bronze'
  if (raw.includes('apprentice') || raw.includes('student')) return 'student-apprentice'
  if (raw.includes('reciprocal')) return 'reciprocal'
  if (raw.includes('tafe') || raw.includes('rto')) return 'tafe-rto'
  if (raw.includes('individual')) return 'individual'
  return ''
}

/** Same-tier renew / re-apply handoff (HubSpot payment link per tier on the join page). */
export function membershipRenewalUrl(memberTier: string | null | undefined): string {
  const slug = membershipTierSlug(memberTier)
  return slug ? `${MEMBERSHIP_JOIN_URL}?tier=${slug}` : MEMBERSHIP_JOIN_URL
}

/**
 * Upgrade handoff. Corporate/supplier bronze→silver→gold land on the next tier's
 * payment link. Top-tier and individual-style members go to the comparison page
 * so they can pick deliberately.
 */
export function membershipUpgradeUrl(memberTier: string | null | undefined): string {
  const slug = membershipTierSlug(memberTier)
  const nextBySlug: Record<string, string> = {
    'corporate-bronze': 'corporate-silver',
    'corporate-silver': 'corporate-gold',
    'supplier-bronze': 'supplier-silver',
    'supplier-silver': 'supplier-gold',
  }
  if (slug && nextBySlug[slug]) {
    return `${MEMBERSHIP_JOIN_URL}?tier=${nextBySlug[slug]}`
  }
  return MEMBERSHIP_OPTIONS_URL
}

export interface OutstandingPayable {
  pay_url: string
  balance_due: number
  name: string
  status: string
  number: string
  amount: number
  date: string | number | null
  pdf_url: string
  overdue: boolean
}

function numericValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function statusLooksOverdue(status: string | null | undefined): boolean {
  return (status || '').toLowerCase().includes('overdue')
}

/**
 * Prefer an open HubSpot invoice (pay_url + balance) over the generic tier
 * payment link. Invoice payers renew by settling that invoice; card subscribers
 * usually have nothing outstanding and should not be pushed through join again.
 */
export function getOutstandingPayable(profile: PreviewProfile): OutstandingPayable | null {
  const items = Array.isArray(profile.financial_items) ? profile.financial_items : []
  for (const item of items) {
    const balance = numericValue(item.balance_due)
    const payUrl = (item.pay_url || '').trim()
    if (balance > 0 && payUrl) {
      return {
        pay_url: payUrl,
        balance_due: balance,
        name: item.name || 'Invoice',
        status: item.status || 'Due',
        number: item.name || '',
        amount: numericValue(item.amount) || balance,
        date: item.date ?? null,
        pdf_url: item.pdf_url || '',
        overdue: statusLooksOverdue(item.status),
      }
    }
  }

  const profilePayUrl = (profile.invoice_pay_url || '').trim()
  const profileBalance = numericValue(profile.invoice_balance_due)
  if (profilePayUrl && profileBalance > 0) {
    return {
      pay_url: profilePayUrl,
      balance_due: profileBalance,
      name: profile.invoice_number || 'Invoice',
      status: profile.invoice_status || 'Due',
      number: profile.invoice_number || '',
      amount: numericValue(profile.invoice_amount) || profileBalance,
      date: profile.invoice_date ?? null,
      pdf_url: profile.invoice_pdf_url || '',
      overdue: profile.invoice_status === 'Overdue' || statusLooksOverdue(profile.invoice_status),
    }
  }

  return null
}

export type MembershipHeroActionKind = 'pay_invoice' | 'renew' | 'upgrade'

export interface MembershipHeroAction {
  kind: MembershipHeroActionKind
  href: string
  label: string
  danger: boolean
  note: string | null
}

function daysUntil(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const time =
    typeof value === 'number'
      ? value < 1e12
        ? value * 1000
        : value
      : Date.parse(String(value))
  if (!Number.isFinite(time)) return null
  return Math.ceil((time - Date.now()) / 86_400_000)
}

/**
 * Hero / membership CTA priority:
 * 1. Outstanding HubSpot invoice → pay that invoice
 * 2. Lapsed → renew via tier payment link
 * 3. Inside 60-day window, no invoice → upgrade path (card auto-renews; invoice
 *    members get a note to pay from Financials when the invoice arrives)
 */
export function getMembershipHeroAction(
  profile: Pick<PreviewProfile, 'member_tier' | 'membership_status' | 'renewal_date'> &
    Partial<PreviewProfile>,
  outstanding: OutstandingPayable | null = getOutstandingPayable(profile as PreviewProfile),
): MembershipHeroAction | null {
  if (outstanding) {
    return {
      kind: 'pay_invoice',
      href: outstanding.pay_url,
      label: outstanding.overdue ? 'Pay overdue invoice' : 'Pay invoice now',
      danger: outstanding.overdue,
      note: null,
    }
  }

  const status = profile.membership_status as MembershipStatus
  if (status === 'Lapsed' || status === 'Grace period') {
    return {
      kind: 'renew',
      href: membershipRenewalUrl(profile.member_tier),
      label: status === 'Lapsed' ? 'Renew membership' : 'Renew membership now',
      danger: status === 'Lapsed',
      note: null,
    }
  }

  const days = daysUntil(profile.renewal_date)
  if (days !== null && days <= 60) {
    return {
      kind: 'upgrade',
      href: membershipUpgradeUrl(profile.member_tier),
      label: 'Upgrade membership',
      danger: false,
      note: 'Card payments renew automatically. Paying by invoice? Use Pay now under Financials when your renewal invoice arrives.',
    }
  }

  return null
}

export function financialItemIsPayable(item: FinancialItem): boolean {
  return Boolean((item.pay_url || '').trim()) && numericValue(item.balance_due) > 0
}
