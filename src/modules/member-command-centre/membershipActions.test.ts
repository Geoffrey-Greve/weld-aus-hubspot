import { describe, expect, it } from 'vitest'
import {
  getMembershipHeroAction,
  getOutstandingPayable,
  membershipRenewalUrl,
  membershipTierSlug,
  membershipUpgradeUrl,
} from './membershipActions'
import type { PreviewProfile } from './types'

function baseProfile(overrides: Partial<PreviewProfile> = {}): PreviewProfile {
  return {
    profile_key: 'test',
    first_name: 'Test',
    last_name: 'Member',
    initials: 'TM',
    role_title: 'Member',
    company_name: 'Test Co',
    member_tier: 'Corporate Silver',
    membership_status: 'Active',
    is_linked_member: true,
    is_primary_admin: false,
    member_since: '2024-01-01',
    member_id: 'WA-1',
    renewal_date: null,
    linked_seats: 0,
    linked_individual_label: '',
    state: 'SA',
    accent: 'silver',
    banner_type: 'none',
    banner_title: '',
    banner_body: '',
    banner_cta_label: '',
    banner_cta_url: '',
    certification_name: '',
    certification_meta: '',
    cert_progress_percent: 0,
    cert_steps_json: '[]',
    next_step_body: '',
    next_step_cta_label: '',
    next_step_cta_url: '',
    invoice_number: '',
    invoice_amount: 0,
    invoice_status: 'Paid',
    invoice_date: null,
    invoice_pdf_url: '',
    financial_items: [],
    team_linked_employees: 0,
    team_active_members: 0,
    training_vouchers_used: 0,
    training_vouchers_total: 0,
    summit_tickets_used: 0,
    summit_tickets_total: 0,
    ...overrides,
  }
}

describe('membershipTierSlug', () => {
  it('maps corporate and supplier tiers', () => {
    expect(membershipTierSlug('Corporate Gold')).toBe('corporate-gold')
    expect(membershipTierSlug('Supplier Bronze')).toBe('supplier-bronze')
    expect(membershipTierSlug('Student / Apprentice')).toBe('student-apprentice')
  })
})

describe('membershipRenewalUrl', () => {
  it('preselects the member tier on the join page', () => {
    expect(membershipRenewalUrl('Corporate Silver')).toBe('/membership/join/?tier=corporate-silver')
    expect(membershipRenewalUrl('')).toBe('/membership/join/')
  })
})

describe('membershipUpgradeUrl', () => {
  it('bumps bronze/silver to the next paid tier', () => {
    expect(membershipUpgradeUrl('Corporate Bronze')).toBe('/membership/join/?tier=corporate-silver')
    expect(membershipUpgradeUrl('Supplier Silver')).toBe('/membership/join/?tier=supplier-gold')
  })

  it('sends top-tier and individual members to the comparison page', () => {
    expect(membershipUpgradeUrl('Corporate Gold')).toBe('/membership/#membership-options')
    expect(membershipUpgradeUrl('Individual')).toBe('/membership/#membership-options')
  })
})

describe('getOutstandingPayable', () => {
  it('prefers the first financial item with a pay URL and balance', () => {
    const profile = baseProfile({
      financial_items: [
        {
          id: '1',
          name: 'Paid invoice',
          type: 'Invoice',
          amount: 100,
          status: 'Paid',
          date: '2026-01-01',
          pdf_url: 'https://example.com/a.pdf',
          source: 'HubSpot invoice',
          pay_url: '',
          balance_due: null,
        },
        {
          id: '2',
          name: 'Renewal INV-9',
          type: 'Invoice',
          amount: 2200,
          status: 'Overdue',
          date: '2026-06-01',
          pdf_url: '',
          source: 'HubSpot invoice',
          pay_url: 'https://pay.hubspot.com/inv-9',
          balance_due: 2200,
        },
      ],
    })

    expect(getOutstandingPayable(profile)).toMatchObject({
      pay_url: 'https://pay.hubspot.com/inv-9',
      balance_due: 2200,
      overdue: true,
    })
  })

  it('falls back to profile invoice_pay_url', () => {
    const profile = baseProfile({
      invoice_pay_url: 'https://pay.hubspot.com/inv-1',
      invoice_balance_due: 500,
      invoice_status: 'Due',
      invoice_number: 'INV-1',
    })
    expect(getOutstandingPayable(profile)?.pay_url).toBe('https://pay.hubspot.com/inv-1')
  })
})

describe('getMembershipHeroAction', () => {
  it('routes outstanding balances to the invoice pay URL', () => {
    const profile = baseProfile({
      membership_status: 'Active',
      renewal_date: Date.now() + 10 * 86_400_000,
      financial_items: [
        {
          id: '2',
          name: 'Renewal',
          type: 'Invoice',
          amount: 100,
          status: 'Due',
          date: null,
          pdf_url: '',
          source: 'HubSpot invoice',
          pay_url: 'https://pay.hubspot.com/due',
          balance_due: 100,
        },
      ],
    })
    expect(getMembershipHeroAction(profile)).toMatchObject({
      kind: 'pay_invoice',
      href: 'https://pay.hubspot.com/due',
      label: 'Pay invoice now',
    })
  })

  it('renews lapsed members via the tier payment link', () => {
    const profile = baseProfile({ membership_status: 'Lapsed', member_tier: 'Corporate Gold' })
    expect(getMembershipHeroAction(profile)).toMatchObject({
      kind: 'renew',
      href: '/membership/join/?tier=corporate-gold',
      label: 'Renew membership',
      danger: true,
    })
  })

  it('offers upgrade (not renew) inside the 60-day window when nothing is owed', () => {
    const profile = baseProfile({
      membership_status: 'Active',
      member_tier: 'Corporate Bronze',
      renewal_date: Date.now() + 20 * 86_400_000,
    })
    expect(getMembershipHeroAction(profile)).toMatchObject({
      kind: 'upgrade',
      href: '/membership/join/?tier=corporate-silver',
      label: 'Upgrade membership',
    })
    expect(getMembershipHeroAction(profile)?.note).toMatch(/Card payments renew automatically/i)
  })
})
