import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, type Mock } from 'vitest'
import {
  CheckoutTunnel,
  CHECKOUT_STORAGE_KEY,
  type CheckoutTunnelProps,
  type CheckoutSession
} from './CheckoutTunnel'
import { CHECKOUT_PRICING_HANDOFF_KEY } from '@shared/utils/checkoutPricingHandoff'

// Mock the Event Engine client so no network calls happen and we can assert the
// reserve/poll contract directly.
const RESERVATION_EXPIRED_MESSAGE =
  'Your reservation has expired. We hold your place for about 15 minutes - you haven’t been charged. Please start again to book.'

vi.mock('@shared/api/eventEngine', async () => {
  // `applyAvailability` is a pure fold of the Worker's answer over the HubDB row, and the
  // Step 1 assertions below are about what it decides. Mocking it would test the mock, so
  // the real one is imported and only the network calls are stubbed.
  const actual = await vi.importActual<typeof import('@shared/api/eventEngine')>(
    '@shared/api/eventEngine'
  )
  const EXPIRED = new Set([
    'expired',
    'cancelled',
    'canceled',
    'reservation_expired',
    'session_expired',
    'hold_expired',
    'order_expired',
    'not_found',
    'order_not_found',
    'session_not_found',
    'reservation_not_found'
  ])
  const isReservationExpired = (input: unknown): boolean => {
    if (!input) return false
    const obj = typeof input === 'string' ? { status: input } : (input as Record<string, unknown>)
    const status = obj.status
    if (typeof status !== 'string') return false
    return EXPIRED.has(status.toLowerCase().replace(/[\s-]+/g, '_'))
  }
  return {
    applyAvailability: actual.applyAvailability,
    // Pure helpers, same reasoning: the assertions below are about what they decide.
    hasStartDatePassed: actual.hasStartDatePassed,
    splitAnswers: actual.splitAnswers,
    missingRequiredAnswers: actual.missingRequiredAnswers,
    reservationScope: actual.reservationScope,
    // An event that asks nothing by default, so every pre-existing case renders the form it
    // always did. `null` is the distinct "could not read them" answer, exercised below.
    fetchEventQuestions: vi.fn(async () => []),
    // No live read in these tests: null means Step 1 renders exactly what HubDB said,
    // which is the pre-existing behaviour every case below was written against.
    fetchAvailability: vi.fn(async () => null),
    reserveSeat: vi.fn(),
    reserveCoursePackage: vi.fn(),
    pollOrder: vi.fn(),
    getIdempotencyKey: vi.fn(() => 'idem-key'),
    clearIdempotencyKey: vi.fn(),
    friendlyReserveError: vi.fn((r: { message?: string }) => r.message || 'error'),
    isReservationExpired,
    // Must match the real module: the component compares res.status against these
    // to decide whether an outcome is ambiguous (keep the idempotency key) or a
    // definite worker error (retire it).
    TRANSPORT_ERROR_STATUS: 'transport_error',
    SERVER_ERROR_STATUS: 'server_error',
    RESERVATION_EXPIRED_MESSAGE:
      'Your reservation has expired. We hold your place for about 15 minutes - you haven’t been charged. Please start again to book.'
  }
})
import * as engine from '@shared/api/eventEngine'

// Mock the member-company validation so no real HubDB call is made.
vi.mock('@shared/api/members', () => ({
  validateMemberCompany: vi.fn()
}))
import * as members from '@shared/api/members'
import { resetAvailabilityCache } from '@shared/api/useLiveAvailability'

const reserveSeat = engine.reserveSeat as unknown as Mock
const pollOrder = engine.pollOrder as unknown as Mock
const clearIdempotencyKey = engine.clearIdempotencyKey as unknown as Mock
const getIdempotencyKey = engine.getIdempotencyKey as unknown as Mock

/**
 * The scope the key was stored under, whatever it is. Ref 40 item 5 made it a
 * fingerprint of who is buying and what, not the bare event id, so the invariant the
 * tests hold is that the key is RETIRED under the same scope it was taken out under -
 * a mismatch would leave the stored key alive and replay the last booking.
 */
function scopeUsedForKey(): string {
  expect(getIdempotencyKey).toHaveBeenCalled()
  return getIdempotencyKey.mock.calls.at(-1)![0] as string
}
const validateMemberCompany = members.validateMemberCompany as unknown as Mock
const fetchAvailability = engine.fetchAvailability as unknown as Mock
const fetchEventQuestions = engine.fetchEventQuestions as unknown as Mock

// ─── The clock ─────────────────────────────────────────────────────────────────
//
// The fixtures below are dated, and Step 1 now refuses a session whose start date has
// passed (applyAvailability's start-date rule, Ref 46 round 2 - the stale module links in
// that report led straight to a checkout for a course that had already run). Without a
// fixed clock this suite would pass until the fixture dates went by and then fail for a
// reason that has nothing to do with the code.
//
// Only Date is faked: waitFor() needs a real setTimeout to poll on.
const NOW = new Date('2026-05-01T09:00:00+09:30')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterAll(() => {
  vi.useRealTimers()
})

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION: CheckoutSession = {
  id: '101',
  kind: 'course',
  course_name: 'AS1796 Cert 10',
  city: 'Sydney',
  start_date: '2026-06-01',
  end_date: '2026-06-05',
  price_member: 800,
  price_individual: 800,
  price_student: 800,
  price_bronze: 780,
  price_silver: 750,
  price_gold: 700,
  price_non_member: 1200,
  registration_url: '',
  status: 'available',
  zoom_link: '',
  worker_event_id: 'cert10-syd-jun',
  member_ticket_type_id: 'tt_member',
  non_member_ticket_type_id: 'tt_public'
}

const EVENT_SESSION: CheckoutSession = {
  id: '201',
  kind: 'event',
  course_name: 'Industry Night',
  city: 'Online',
  start_date: '2026-08-12',
  end_date: '2026-08-12',
  price_member: 0,
  price_non_member: 45,
  registration_url: '',
  status: 'available',
  zoom_link: '',
  worker_event_id: 'evt_industry_night',
  member_ticket_type_id: 'tt_event_member',
  non_member_ticket_type_id: 'tt_event_public'
}

function makeProps(overrides: Partial<CheckoutTunnelProps> = {}): CheckoutTunnelProps {
  return {
    session: SESSION,
    member_is_logged_in: true,
    member_is_member: true,
    member_tier: 'corporate_gold',
    member_name: 'Mel',
    member_email: 'mel@example.com',
    step_labels: { step_1: 'Confirm', step_2: 'Details', step_3: 'Pricing', step_4: 'Payment' },
    guest_checkout_allowed: true,
    membership_offer_post_purchase: false,
    membership_offer_message: '',
    payment_provider: 'event_engine',
    stripe_publishable_key: '',
    worker_base_url: 'https://w.example.com',
    worker_portal_id: '441838610',
    confirmation_redirect: '/checkout/?confirmed=1',
    support_email: 'training@example.com',
    portal_id: '441838610',
    ...overrides
  }
}

/** Walk a logged-in member from step 1 to the step-4 submit button. */
function advanceMemberToPayment() {
  fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
  // step 2 auto-skips for members → step 3
  fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('CheckoutTunnel - event_engine provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Module-level and shared across mounts, so one test's read would otherwise decide
    // the next one's Step 1.
    resetAvailabilityCache()
    window.turnstile = undefined
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  it('reserves with the MEMBER ticket id and ends on the invoice, without navigating away', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, eventId, body] = reserveSeat.mock.calls[0]!
    expect(eventId).toBe('cert10-syd-jun')
    expect(body.ticketTypeId).toBe('tt_member')
    expect(body.memberTier).toBe('corporate_gold')
    expect(body.expectedUnitCents).toBe(70000)
    expect(body.buyer).toEqual({ name: 'Mel', email: 'mel@example.com' })

    // The tunnel used to set window.location to the hosted invoice, which threw the buyer
    // off the site with no way back and no record on screen of what they had booked. It
    // stops here instead and hands them a link.
    const payLink = await screen.findByRole('link', { name: /pay invoice now/i })
    expect(payLink).toHaveAttribute('href', 'https://invoice.example.com/pay/1')
    // A new tab, so the site stays underneath them - and an anchor rather than
    // window.open, because this resolves in pollOrder's async callback where every popup
    // blocker would eat it.
    expect(payLink).toHaveAttribute('target', '_blank')
    expect(payLink).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(window.location.href).toBe('')

    // What they booked and what they owe are still on the screen beside the link.
    expect(screen.getByText('Your place is held')).toBeInTheDocument()
    expect(screen.getByText(/AS1796 Cert 10/)).toBeInTheDocument()
    expect(screen.getByText('$770.00')).toBeInTheDocument()

    // Receipt persisted for the confirmation page.
    expect(sessionStorage.getItem(CHECKOUT_STORAGE_KEY)).toContain('AS1796 Cert 10')
    const receipt = JSON.parse(sessionStorage.getItem(CHECKOUT_STORAGE_KEY) || '{}')
    // The receipt records what the buyer pays: the ex-GST fee plus GST.
    expect(receipt.amount_paid).toBe(770)
  })

  it('forwards the employer HubL priced from, so the worker re-validates the same company', async () => {
    // The worker resolves membership from the buyer's EMAIL. A corporate employee whose
    // own contact carries no membership resolves as a non-member there, is priced at the
    // public rate, and the reserve guard refuses the member price this page displayed:
    // "The course price changed before checkout". The company id is what lets the worker
    // read the record this page priced from. It never trusts the number itself.
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps({ member_company_id: '285887775182' })} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.memberCompanyId).toBe('285887775182')
  })

  it('sends no company id when HubL priced from the contact alone', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.memberCompanyId).toBeUndefined()
  })

  it('falls back to the standard ticket id for a member when no distinct member ticket is configured', async () => {
    // Tiered-pricing model: one standard ticket per session; the member discount is
    // applied server-side by the Event Engine. The member must still reserve against the
    // standard ticket rather than getting "not configured".
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    const session = { ...SESSION, member_ticket_type_id: '' }
    render(<CheckoutTunnel {...makeProps({ session })} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.ticketTypeId).toBe('tt_public')
  })

  it('quotes the selected HubDB price as the EX-GST registration fee', async () => {
    render(<CheckoutTunnel {...makeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )
    // The HubDB figure is the fee line, not the total.
    expect(screen.getByText('$700.00')).toBeInTheDocument()
    // Non-member standard rate, struck through, is also ex GST.
    expect(screen.getByText('$1,200.00')).toBeInTheDocument()
  })

  it('adds GST on top of the ex-GST fee and totals the two', async () => {
    render(<CheckoutTunnel {...makeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )
    // HubDB holds $700 EX GST, so GST is 10% ON TOP - not $700/11 out of the middle.
    expect(screen.getByText('GST')).toBeInTheDocument()
    expect(screen.getByText('$70.00')).toBeInTheDocument()
    expect(screen.queryByText('$63.64')).toBeNull()
    // Total is fee + GST.
    expect(screen.getByText('Total (inc. GST)')).toBeInTheDocument()
    expect(screen.getByText('$770.00')).toBeInTheDocument()
  })

  it('strikes out the standard rate only when the member actually saves', async () => {
    // A great many Weld sessions carry one rate for everyone: `price_member` and
    // `price_non_member` hold the same number. This line used to render whenever the
    // buyer was a member, so those sessions showed a crossed-out figure identical to the
    // one beside it - a discount of nothing, and two prices for the buyer to choose
    // between on the screen where they commit to paying.
    render(
      <CheckoutTunnel
        {...makeProps({
          // Every tier column and the public column at one rate, which is how Weld hold
          // a session with no member discount.
          session: {
            ...SESSION,
            price_member: 700,
            price_individual: 700,
            price_student: 700,
            price_bronze: 700,
            price_silver: 700,
            price_gold: 700,
            price_non_member: 700
          }
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )
    expect(screen.queryByText('Standard rate (ex GST)')).toBeNull()
    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    // Fee, GST on top, total. One price, stated once.
    expect(screen.getByText('$700.00')).toBeInTheDocument()
    expect(screen.getByText('$70.00')).toBeInTheDocument()
    expect(screen.getByText('$770.00')).toBeInTheDocument()
  })

  it('skips sign-in/guest details for a logged-in member even when tier is blank', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(
      <CheckoutTunnel
        {...makeProps({
          member_tier: '',
          member_status: '',
          member_name: 'Ollie Member',
          member_email: 'ollie@example.com'
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /proceed to payment/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.ticketTypeId).toBe('tt_member')
    expect(body.buyer).toEqual({ name: 'Ollie Member', email: 'ollie@example.com' })
  })

  it('quotes price_member for an entitled member with a blank tier (defect 126)', async () => {
    // Reproduces portal $5,500 / checkout $5,850: HubL scrubs "Not Applicable"
    // to '', the portal keeps that empty (→ price_member), but checkout used to
    // invent the literal "Member" which normaliseMemberPriceTier maps to
    // price_individual (often equal to the full non-member rate).
    const cert10: CheckoutSession = {
      ...SESSION,
      price_member: 5500,
      price_individual: 5850,
      price_student: 5500,
      price_bronze: 5615,
      price_silver: 5500,
      price_gold: 5380,
      price_non_member: 5850
    }

    render(
      <CheckoutTunnel
        {...makeProps({
          session: cert10,
          member_tier: '',
          member_status: 'Active'
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )

    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getAllByText('$5,500.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('−$350.00')).toBeInTheDocument()
    // Must not land on the individual/full column via the old "Member" invent.
    expect(screen.queryByText('Individual member rate')).toBeNull()
  })

  it('prefers company Gold over a weaker contact Individual tier (defect 126)', async () => {
    // Portal quotes Corporate Gold; checkout used to keep contact Individual
    // whenever it was non-empty and land on price_individual ≈ full rate.
    const iwiBasic: CheckoutSession = {
      ...SESSION,
      course_name: 'IIW Welding Inspector – Basic (IWI-B)',
      price_member: 2350,
      price_individual: 2350,
      price_student: 2535,
      price_bronze: 2300,
      price_silver: 2250,
      price_gold: 2170,
      price_non_member: 2555
    }

    render(
      <CheckoutTunnel
        {...makeProps({
          session: iwiBasic,
          member_tier: 'Individual',
          member_company_tier: 'Corporate Gold',
          member_status: 'Current'
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )

    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getAllByText('$2,170.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('−$385.00')).toBeInTheDocument()
    expect(screen.queryByText('Individual member rate')).toBeNull()
  })

  it('quotes the corporate silver rate when HubL forwards that tier', async () => {
    const cert10: CheckoutSession = {
      ...SESSION,
      price_member: 5735,
      price_individual: 5735,
      price_silver: 5500,
      price_non_member: 5850
    }

    render(
      <CheckoutTunnel
        {...makeProps({
          session: cert10,
          member_tier: 'Corporate Silver',
          member_status: 'Current'
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )

    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getAllByText('$5,500.00').length).toBeGreaterThanOrEqual(1)
  })

  it('uses a real forwarded silver tier when the entitlement boolean is missing', async () => {
    // Reproduces course page / invoice $5,500 but checkout Step 3 $5,850:
    // HubSpot forwards the real Silver tier, but the strict boolean entitlement
    // can be false/missing on the checkout page render. A real logged-in tier
    // should still quote and reserve the member price, while non_member
    // sentinels remain blocked by the company-ID tests below.
    const cert10: CheckoutSession = {
      ...SESSION,
      price_member: 5735,
      price_individual: 5850,
      price_silver: 5500,
      price_non_member: 5850
    }
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o-silver' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/silver' })

    render(
      <CheckoutTunnel
        {...makeProps({
          session: cert10,
          member_is_member: false,
          member_tier: 'Silver Corporate',
          member_company_tier: '',
          member_status: 'Current'
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )

    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getAllByText('$5,500.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('−$350.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.ticketTypeId).toBe('tt_member')
    expect(body.memberTier).toBe('Silver Corporate')
    expect(body.expectedUnitCents).toBe(550000)
  })

  it('uses the course-page pricing handoff when checkout HubL loses the login context', async () => {
    // The course detail page can correctly resolve Silver, but /checkout may
    // render with member_is_logged_in/member_is_member false and no tier. The
    // click handoff carries that already-resolved context for this same session
    // so Step 3 does not fall back to the public $5,850 display.
    const cert10: CheckoutSession = {
      ...SESSION,
      id: '346457798087',
      price_member: 5735,
      price_individual: 5850,
      price_silver: 5500,
      price_non_member: 5850
    }
    sessionStorage.setItem(
      CHECKOUT_PRICING_HANDOFF_KEY,
      JSON.stringify({
        sessionId: cert10.id,
        isMember: true,
        memberTier: 'Silver Corporate',
        expiresAt: Date.now() + 60_000
      })
    )
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o-silver' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/silver' })

    render(
      <CheckoutTunnel
        {...makeProps({
          session: cert10,
          member_is_logged_in: false,
          member_is_member: false,
          member_tier: '',
          member_company_tier: '',
          member_status: '',
          member_name: '',
          member_email: ''
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'silver@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Silver Buyer' }
    })
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: 'silver@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )

    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getAllByText('$5,500.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('−$350.00')).toBeInTheDocument()
    expect(screen.queryByLabelText(/member company id/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.ticketTypeId).toBe('tt_member')
    expect(body.memberTier).toBe('Silver Corporate')
    expect(body.expectedUnitCents).toBe(550000)
    expect(body.buyer).toEqual({ name: 'Silver Buyer', email: 'silver@example.com' })
  })

  it('quotes silver for HubDB QA persona labels (Silver Corporate)', async () => {
    // portal_test_profiles uses "Silver Corporate" / tier_key corporate_silver
    // for nick+portal-qa-corporate-silver@…, checkout HubL now forwards that
    // label so Step 3 matches the portal member rate (defect 126 follow-up).
    const cert10: CheckoutSession = {
      ...SESSION,
      price_member: 5735,
      price_individual: 5850,
      price_silver: 5500,
      price_non_member: 5850
    }

    render(
      <CheckoutTunnel
        {...makeProps({
          session: cert10,
          member_tier: 'Silver Corporate',
          member_company_tier: 'Silver Corporate',
          member_status: 'Active'
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )

    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getAllByText('$5,500.00').length).toBeGreaterThanOrEqual(1)
    // Public $5,850 may still appear struck-through; the payable rate must be Silver.
    expect(screen.getByText('−$350.00')).toBeInTheDocument()
  })

  it('redirects to the confirmation page for a free (confirmed) registration', async () => {
    reserveSeat.mockResolvedValue({ status: 'confirmed' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(window.location.href).toBe('/checkout/?confirmed=1'))
    expect(pollOrder).not.toHaveBeenCalled()
  })

  it('renders the confirmation state on the published checkout route', async () => {
    sessionStorage.setItem(
      CHECKOUT_STORAGE_KEY,
      JSON.stringify({
        registration_type: 'event',
        course_name: 'Industry Night',
        city: 'Online',
        start_date: '2026-08-12',
        end_date: '2026-08-12',
        amount_paid: 0,
        is_member_price: true,
        zoom_link: '',
        purchaser_name: 'Mel',
        purchaser_email: 'mel@example.com'
      })
    )

    render(<CheckoutTunnel {...makeProps({ session: null, show_confirmation: true })} />)

    expect(screen.getByRole('heading', { name: /you're registered/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Industry Night')).toBeInTheDocument())
  })

  it('blocks checkout when a session has explicitly zero seats remaining', () => {
    render(
      <CheckoutTunnel
        {...makeProps({
          session: {
            ...SESSION,
            status: 'available',
            seats_remaining: 0,
            seats_remaining_is_set: true
          }
        })}
      />
    )

    expect(screen.getByText(/this session is sold out/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm and continue/i })).toBeNull()
  })

  // ─── Live availability (Event Engine) ────────────────────────────────────────
  //
  // Step 1 is where a buyer should find out a session is gone, not after typing their
  // details, their colleagues' names and their ABN, only for reserve to refuse.

  it('blocks checkout when the worker says sold out and HubDB still advertises places', async () => {
    fetchAvailability.mockResolvedValueOnce({
      status: 'ok',
      eventFull: true,
      ticketTypes: [{ ticketTypeId: 'tt_member', available: 0, soldOut: true, waitlistAvailable: true }]
    })

    render(<CheckoutTunnel {...makeProps({ session: { ...SESSION, seats_remaining: 9 } })} />)

    await waitFor(() => expect(screen.getByText(/this session is sold out/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /confirm and continue/i })).toBeNull()
  })

  it('tells a buyer registrations have closed rather than that it sold out', async () => {
    fetchAvailability.mockResolvedValueOnce({
      status: 'ok',
      eventFull: false,
      registrationClosed: true,
      ticketTypes: [{ ticketTypeId: 'tt_member', available: 9, soldOut: false, waitlistAvailable: false }]
    })

    render(<CheckoutTunnel {...makeProps()} />)

    await waitFor(() =>
      expect(screen.getByText(/registrations for this session have closed/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/sold out/i)).not.toBeInTheDocument()
  })

  it('refuses a session that has already run, before the buyer types anything', async () => {
    // Ref 46 round 2: a stale module link sent a buyer to the checkout for a course that
    // ran in August, and the tunnel walked them towards paying the full course price for
    // it. NOW is 1 May 2026, so a 1 March session is over. No live read at all here - a
    // legacy row has no worker event id for one.
    fetchAvailability.mockResolvedValue(null)

    render(
      <CheckoutTunnel
        {...makeProps({
          session: { ...SESSION, start_date: '2026-03-01', end_date: '2026-03-05' }
        })}
      />
    )

    await waitFor(() =>
      expect(screen.getByText(/registrations for this session have closed/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /confirm and continue/i })).toBeNull()
  })

  it('blocks a bundle on a module that has already run, and names it', async () => {
    // Same rule one level down: the whole bundle reserves as one booking, so a module that
    // ran in March takes the rest with it. Naming which one is the difference between a
    // buyer who can pick again and one who just sees "unavailable".
    fetchAvailability.mockResolvedValue(null)

    const moduleSession: CheckoutSession = {
      ...SESSION,
      selected_modules: [
        {
          id: 'm1',
          course_name: 'Module 1: Theory',
          city: 'Sydney',
          start_date: '2026-03-01',
          end_date: '2026-03-02',
          price_member: 400,
          price_non_member: 600,
          worker_event_id: 'mod_1',
          member_ticket_type_id: 'tt_m1_member',
          non_member_ticket_type_id: 'tt_m1_public'
        }
      ]
    }

    render(<CheckoutTunnel {...makeProps({ session: moduleSession })} />)

    await waitFor(() =>
      expect(screen.getByText(/module 1: theory is no longer available/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /confirm and continue/i })).toBeNull()
  })

  it('tells a buyer bookings are on hold when staff paused sales', async () => {
    fetchAvailability.mockResolvedValueOnce({
      status: 'ok',
      eventFull: false,
      salesPaused: true,
      ticketTypes: [{ ticketTypeId: 'tt_member', available: 9, soldOut: false, waitlistAvailable: false }]
    })

    render(<CheckoutTunnel {...makeProps()} />)

    await waitFor(() =>
      expect(screen.getByText(/bookings for this session are temporarily on hold/i)).toBeInTheDocument()
    )
  })

  it('lets checkout proceed when the live read fails', async () => {
    // Advisory only. Reserve is still the authority, so an optimistic Step 1 can send
    // someone to a checkout that tells them the truth: it can never oversell.
    fetchAvailability.mockResolvedValueOnce(null)

    render(
      <CheckoutTunnel {...makeProps({ session: { ...SESSION, seats_remaining: 9 } })} />
    )

    expect(screen.getByRole('button', { name: /confirm and continue/i })).toBeInTheDocument()
  })

  // ─── Custom registration questions (Event Engine Phase 2.3) ──────────────────

  const DIETARY = {
    id: 'q1',
    key: 'dietary_requirements',
    label: 'Dietary requirements',
    fieldType: 'textarea' as const,
    options: null,
    required: false,
    scope: 'attendee' as const,
    helpText: null,
    sortOrder: 0,
    hsProperty: 'dietary_requirements',
    prefill: true
  }
  const PO_NUMBER = {
    ...DIETARY,
    id: 'q2',
    key: 'po_number',
    label: 'Purchase order number',
    fieldType: 'text' as const,
    scope: 'order' as const,
    hsProperty: null
  }

  it('sends each answer in the field its scope is validated against', async () => {
    fetchEventQuestions.mockResolvedValueOnce([DIETARY, PO_NUMBER])
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()

    await waitFor(() => expect(screen.getByLabelText(/dietary requirements/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/dietary requirements/i), {
      target: { value: 'Coeliac' }
    })
    fireEvent.change(screen.getByLabelText(/purchase order number/i), {
      target: { value: 'PO-4471' }
    })
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    // Per seat vs per booking. Sending either in the other field is rejected by name.
    expect(body.attendeeAnswers).toEqual({ dietary_requirements: 'Coeliac' })
    expect(body.answers).toEqual({ po_number: 'PO-4471' })
  })

  it('renders nothing extra, and sends nothing extra, when the event asks nothing', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.answers).toBeUndefined()
    expect(body.attendeeAnswers).toBeUndefined()
  })

  it('stops a submit that skips a required question, without reserving a seat', async () => {
    // A courtesy, not the gate: the worker enforces `required` too. What it buys is that
    // the buyer is not sent to an invoice page only to be refused.
    fetchEventQuestions.mockResolvedValueOnce([{ ...DIETARY, required: true }])

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()

    await waitFor(() => expect(screen.getByLabelText(/dietary requirements/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() =>
      expect(screen.getByText(/please answer the required questions/i)).toBeInTheDocument()
    )
    expect(reserveSeat).not.toHaveBeenCalled()
  })

  it('lets the submit through once the required question is answered', async () => {
    fetchEventQuestions.mockResolvedValueOnce([{ ...DIETARY, required: true }])
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()

    await waitFor(() => expect(screen.getByLabelText(/dietary requirements/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))
    await waitFor(() =>
      expect(screen.getByText(/please answer the required questions/i)).toBeInTheDocument()
    )

    fireEvent.change(screen.getByLabelText(/dietary requirements/i), {
      target: { value: 'None' }
    })
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
  })

  it('retries once on its own, silently', async () => {
    // The common failure is a single dropped request, and the buyer is told nothing either
    // way.
    fetchEventQuestions.mockResolvedValueOnce(null).mockResolvedValueOnce([DIETARY])
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()

    await waitFor(() => expect(screen.getByLabelText(/dietary requirements/i)).toBeInTheDocument())
    expect(screen.queryByText(/could not load the extra questions/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
  })

  it('says nothing to the buyer when the questions cannot be read, and books anyway', async () => {
    // Nothing here is public-facing. Most events ask nothing at all, so a notice about
    // "extra questions" names something the buyer cannot recognise or act on, and blocking
    // the button on it stopped a registration over a fault they could not see or fix.
    fetchEventQuestions.mockResolvedValue(null)
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    // Both automatic attempts have landed (on nothing) before the buyer submits.
    await waitFor(() => expect(fetchEventQuestions).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/could not load the extra questions/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/could not load the registration questions/i)).not.toBeInTheDocument()
  })

  it('uses the definitions its own reload just fetched, not the stale empty set', async () => {
    // The reload has to hand the definitions BACK rather than only setting state: the
    // submit's closure still holds the stale empty set, so a required question would pass
    // the courtesy check and the answers would be split against nothing.
    fetchEventQuestions
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue([{ ...DIETARY, required: true }])
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    await waitFor(() => expect(fetchEventQuestions).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() =>
      expect(screen.getByText(/please answer the required questions/i)).toBeInTheDocument()
    )
    expect(reserveSeat).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/dietary requirements/i), {
      target: { value: 'Coeliac' }
    })
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    expect(reserveSeat.mock.calls[0]?.[2]).toMatchObject({
      attendeeAnswers: { dietary_requirements: 'Coeliac' }
    })
  })

  it('renders the field when the worker refuses for a question it never showed', async () => {
    // The one case the buyer hears about the definitions at all, and they hear it as the
    // question by name, from the side that enforces it, with the field pulled in to answer.
    fetchEventQuestions
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue([{ ...DIETARY, required: true }])
    reserveSeat.mockResolvedValue({
      status: 'missing_required_answer',
      message: '"Dietary requirements" is required'
    })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    await waitFor(() => expect(fetchEventQuestions).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText(/dietary requirements/i)).toBeInTheDocument())
  })

  it('books an event that genuinely asks nothing without a notice', async () => {
    fetchEventQuestions.mockResolvedValue([])
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o1' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/1' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/could not load the extra questions/i)).not.toBeInTheDocument()
  })

  it('blocks step 1 when a SELECTED MODULE has closed, and names which one', async () => {
    // A selected-module checkout books several events as one booking, so one closed module
    // fails the whole reserve. On a page listing five modules that all look fine, a generic
    // "unavailable" tells the buyer nothing they can act on.
    const moduleSession: CheckoutSession = {
      ...SESSION,
      selected_modules: [
        {
          id: 'm1',
          course_name: 'Module 1: Welding Symbols',
          city: 'Sydney',
          start_date: '2026-06-01',
          end_date: '2026-06-02',
          price_member: 400,
          price_non_member: 600,
          worker_event_id: 'mod_1',
          member_ticket_type_id: 'tt_m1_member',
          non_member_ticket_type_id: 'tt_m1_public'
        },
        {
          id: 'm2',
          course_name: 'Module 2: NDT Basics',
          city: 'Sydney',
          start_date: '2026-06-03',
          end_date: '2026-06-04',
          price_member: 400,
          price_non_member: 600,
          worker_event_id: 'mod_2',
          member_ticket_type_id: 'tt_m2_member',
          non_member_ticket_type_id: 'tt_m2_public'
        }
      ]
    }

    // The parent and module 1 are fine; module 2 has closed.
    fetchAvailability.mockImplementation(async (_cfg: unknown, eventId: string) => ({
      status: 'ok',
      eventFull: false,
      bookable: eventId !== 'mod_2',
      registrationClosed: eventId === 'mod_2',
      ticketTypes: [
        {
          ticketTypeId: eventId === 'mod_2' ? 'tt_m2_member' : 'tt_member',
          available: 5,
          soldOut: false,
          waitlistAvailable: false
        }
      ]
    }))

    render(<CheckoutTunnel {...makeProps({ session: moduleSession })} />)

    await waitFor(() =>
      expect(screen.getByText(/module 2: ndt basics is no longer available/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/registrations have closed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm and continue/i })).toBeNull()
    // And it did not stop at the parent: every module was read.
    expect(fetchAvailability).toHaveBeenCalledTimes(3)
  })

  it('lets a module bundle through when every module is open', async () => {
    const moduleSession: CheckoutSession = {
      ...SESSION,
      selected_modules: [
        {
          id: 'm1',
          course_name: 'Module 1',
          city: 'Sydney',
          start_date: '2026-06-01',
          end_date: '2026-06-02',
          price_member: 400,
          price_non_member: 600,
          worker_event_id: 'mod_1',
          member_ticket_type_id: 'tt_member',
          non_member_ticket_type_id: 'tt_public'
        }
      ]
    }
    fetchAvailability.mockResolvedValue({
      status: 'ok',
      eventFull: false,
      bookable: true,
      ticketTypes: [
        { ticketTypeId: 'tt_member', available: 5, soldOut: false, waitlistAvailable: false }
      ]
    })

    render(<CheckoutTunnel {...makeProps({ session: moduleSession })} />)

    // Wait for both reads to land before asserting: the button is present from the first
    // render regardless, so asserting on it alone would pass before the live state arrived.
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm and continue/i })).toBeInTheDocument()
    )
  })

  it('blocks step 1 when the buyer\'s own ticket type is paused', async () => {
    // The event is open and the public ticket is fine; the member ticket is not. Without
    // the per-type check a member walks every step and is refused at reserve.
    fetchAvailability.mockResolvedValueOnce({
      status: 'ok',
      eventFull: false,
      bookable: true,
      ticketTypes: [
        {
          ticketTypeId: 'tt_member',
          available: 5,
          soldOut: false,
          salesPaused: true,
          bookable: false,
          waitlistAvailable: false
        },
        { ticketTypeId: 'tt_public', available: 5, soldOut: false, waitlistAvailable: false }
      ]
    })

    render(<CheckoutTunnel {...makeProps()} />)

    await waitFor(() =>
      expect(screen.getByText(/bookings for this session are temporarily on hold/i)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /confirm and continue/i })).toBeNull()
  })

  it('shows a generic thank-you state when no checkout session is available', () => {
    render(<CheckoutTunnel {...makeProps({ session: null, show_confirmation: false })} />)

    expect(screen.getByRole('heading', { name: /^thank you$/i })).toBeInTheDocument()
    expect(screen.getByText(/couldn't match this checkout link/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /browse available courses/i })).toHaveAttribute(
      'href',
      '/courses/'
    )
    expect(screen.queryByText(/session not found/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/isn't available/i)).not.toBeInTheDocument()
  })

  it('shows a not-configured notice (no submit) when ticket ids are missing', async () => {
    const session = { ...SESSION, member_ticket_type_id: '', non_member_ticket_type_id: '' }
    render(<CheckoutTunnel {...makeProps({ session })} />)
    advanceMemberToPayment()

    expect(screen.getByText(/isn't configured for this session yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete registration/i })).toBeNull()
    // The root reads live availability for the session regardless of whether checkout is
    // configured for it, so let that settle rather than leaving it to land after the test.
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalled())
  })

  it('uses event wording and event ticket ids for an Event checkout item', async () => {
    reserveSeat.mockResolvedValue({ status: 'confirmed' })

    render(
      <CheckoutTunnel
        {...makeProps({
          session: EVENT_SESSION,
          requested_item_type: 'event',
          support_email: 'events@example.com'
        })}
      />
    )

    expect(screen.getByRole('heading', { name: /confirm your event/i })).toBeInTheDocument()

    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, eventId, body] = reserveSeat.mock.calls[0]!
    expect(eventId).toBe('evt_industry_night')
    expect(body.ticketTypeId).toBe('tt_event_member')
  })

  it('requires and forwards a Turnstile token for free Event Engine checkout', async () => {
    reserveSeat.mockResolvedValue({ status: 'confirmed' })
    let turnstileCallback: ((token: string) => void) | undefined
    window.turnstile = {
      render: vi.fn((_container, options) => {
        turnstileCallback = options.callback
        return 'turnstile-widget-1'
      }),
      reset: vi.fn()
    }

    render(
      <CheckoutTunnel
        {...makeProps({
          session: {
            ...EVENT_SESSION,
            price_individual: 0,
            price_student: 0,
            price_bronze: 0,
            price_silver: 0,
            price_gold: 0,
            price_non_member: 0
          },
          requested_item_type: 'event',
          turnstile_site_key: 'site-key'
        })}
      />
    )

    advanceMemberToPayment()
    expect(await screen.findByText(/security check/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /complete registration/i })
    expect(submit).toBeDisabled()

    await act(async () => {
      turnstileCallback?.('cf-token')
    })

    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.turnstileToken).toBe('cf-token')
  })

  it('requires and forwards a Turnstile token for PAID Event Engine checkout', async () => {
    // The paid path is the one that matters: a paid booking holds its seat until the
    // invoice due date, so an unchallenged caller could park seats for weeks. The widget
    // must render here, or the Worker rejects the reservation as token-less.
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o-paid' })
    let turnstileCallback: ((token: string) => void) | undefined
    window.turnstile = {
      render: vi.fn((_container, options) => {
        turnstileCallback = options.callback
        return 'turnstile-widget-paid'
      }),
      reset: vi.fn()
    }

    render(
      <CheckoutTunnel
        {...makeProps({
          requested_item_type: 'event',
          turnstile_site_key: 'site-key'
        })}
      />
    )

    advanceMemberToPayment()
    expect(await screen.findByText(/security check/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /complete registration/i })
    expect(submit).toBeDisabled()

    await act(async () => {
      turnstileCallback?.('cf-token-paid')
    })

    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.turnstileToken).toBe('cf-token-paid')
  })

  it('leaves checkout unchallenged when no Turnstile site key is configured', async () => {
    // Component-level contract only: with no site key the widget never renders and
    // checkout still books. NOTE this is not reachable in production today,
    // checkout-tunnel.module/module.html substitutes a hard-coded default site key for an
    // empty field, so the Worker's secret, not this field, is the real per-portal switch.
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o-nokey' })
    window.turnstile = undefined

    render(<CheckoutTunnel {...makeProps({ requested_item_type: 'event' })} />)

    advanceMemberToPayment()
    expect(screen.queryByText(/security check/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.turnstileToken).toBeUndefined()
  })

  it('shows the expired screen (not a raw error) when reserve returns an expiry status', async () => {
    reserveSeat.mockResolvedValue({ status: 'session_not_found', message: 'session not found' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /your reservation has expired/i })
      ).toBeInTheDocument()
    )
    expect(screen.getByText(RESERVATION_EXPIRED_MESSAGE)).toBeInTheDocument()
    // Never surfaces the raw worker string.
    expect(screen.queryByText(/session not found/i)).toBeNull()
    // Retry is cleaned up so the next attempt reserves afresh.
    expect(clearIdempotencyKey).toHaveBeenCalledWith(scopeUsedForKey())

    // "Start again" returns to the reserve form for a clean retry.
    fireEvent.click(screen.getByRole('button', { name: /start again/i }))
    expect(screen.getByRole('button', { name: /complete registration/i })).toBeInTheDocument()
  })

  // Ref 217. transport_error and server_error are AMBIGUOUS outcomes: the reserve
  // POST may have committed server-side and only the answer was lost. Retiring the
  // idempotency key would let a buyer's retry mint a second hold, order and invoice,
  // because the worker's replay protection is keyed on it.
  it.each([
    ['transport_error', { status: 'transport_error', message: 'Failed to fetch' }],
    ['server_error', { status: 'server_error', httpStatus: 500, rawBody: 'Internal Server Error' }]
  ])('keeps the idempotency key after an ambiguous %s', async (_label, response) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reserveSeat.mockResolvedValue(response)

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    expect(clearIdempotencyKey).not.toHaveBeenCalled()
    // Still a retryable form, not the expired dead end.
    expect(screen.getByRole('button', { name: /complete registration/i })).toBeInTheDocument()
  })

  it('retires the idempotency key for a definite worker error shape', async () => {
    // members_only is unambiguous - the worker created nothing, so a retry should
    // start fresh rather than replay a stored response.
    reserveSeat.mockResolvedValue({ status: 'members_only' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(clearIdempotencyKey).toHaveBeenCalledWith(scopeUsedForKey()))
  })

  it('shows the expired screen when the reserved order poll reports it expired', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o9' })
    pollOrder.mockResolvedValue({ status: 'reservation_expired' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /your reservation has expired/i })
      ).toBeInTheDocument()
    )
    expect(window.location.href).toBe('')
  })
})

describe('CheckoutTunnel - event_engine tier resolution (guest)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  it('reserves with the NON-MEMBER ticket id for a guest', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o2' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/2' })

    render(
      <CheckoutTunnel
        {...makeProps({
          member_is_logged_in: false,
          member_is_member: false,
          member_tier: '',
          member_name: '',
          member_email: ''
        })}
      />
    )

    // Guest flow: step 1 → step 2 (email → options → guest details) → step 3 → step 4
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Guest Person' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'guest@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.ticketTypeId).toBe('tt_public')
    expect(body.buyer.email).toBe('guest@example.com')
  })

  it('does NOT fall back to a member ticket for a guest on a members-only session', async () => {
    // Session with only a member ticket configured must stay "not configured" for guests,
    // never route them to the member ticket.
    const session = { ...SESSION, non_member_ticket_type_id: '' }
    render(
      <CheckoutTunnel
        {...makeProps({
          session,
          member_is_logged_in: false,
          member_is_member: false,
          member_tier: '',
          member_name: '',
          member_email: ''
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Guest Person' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'guest@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))
    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))

    expect(screen.getByText(/isn't configured for this session yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete registration/i })).toBeNull()
    expect(reserveSeat).not.toHaveBeenCalled()
  })
})

describe('CheckoutTunnel - Back navigation', () => {
  const GUEST = {
    member_is_logged_in: false,
    member_is_member: false,
    member_tier: '',
    member_name: '',
    member_email: ''
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  it('logged-in member: Back from the pricing step returns to Confirm session (step 2 skipped both ways)', () => {
    render(<CheckoutTunnel {...makeProps()} />)

    // Forward: step 1 → skip Identify → step 3 (pricing)
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()

    // Back: must land on step 1, NOT bounce back to step 3 (the reported bug)
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /confirm your session/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /review your pricing/i })).not.toBeInTheDocument()
  })

  it('guest: Back walks step 3 → step 2 → step 1', () => {
    render(<CheckoutTunnel {...makeProps(GUEST)} />)

    // Step 1 → Step 2 (email entry) → options → guest → Step 3
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    expect(screen.getByRole('heading', { name: /your details/i })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Guest Person' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'guest@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))
    expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()

    // Back: step 3 → step 2 (remounts fresh at email-entry phase)
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /your details/i })).toBeInTheDocument()

    // Back again: step 2 → step 1
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /confirm your session/i })).toBeInTheDocument()
  })

  it('guest: Back from the identify options phase returns to the email-entry field', () => {
    render(<CheckoutTunnel {...makeProps(GUEST)} />)

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(
      screen.getByRole('heading', { name: /how would you like to continue/i })
    ).toBeInTheDocument()

    // Back within step 2: options → email entry (not out of the step)
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /your details/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
  })

  it('step 1 has no Back control (nothing to go back to)', () => {
    render(<CheckoutTunnel {...makeProps()} />)
    expect(screen.getByRole('heading', { name: /confirm your session/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
  })

  it('step indicator: a logged-in member selecting the skipped Identify step lands on step 1', () => {
    // The indicator renders into a portal target; provide it so the chips mount.
    const portalTarget = document.createElement('div')
    portalTarget.id = 'wa-checkout-steps'
    document.body.appendChild(portalTarget)

    try {
      render(<CheckoutTunnel {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()

      // Click the completed "Details" (step 2) chip - must not strand the member there.
      fireEvent.click(screen.getByRole('button', { name: /return to details/i }))
      expect(screen.getByRole('heading', { name: /confirm your session/i })).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: /how would you like to continue/i })
      ).not.toBeInTheDocument()
    } finally {
      document.body.removeChild(portalTarget)
    }
  })
})

describe('CheckoutTunnel - company ID member discount (guest)', () => {
  const GUEST = {
    member_is_logged_in: false,
    member_is_member: false,
    member_tier: '',
    member_name: '',
    member_email: ''
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  /** Walk a guest from step 1 to the pricing step (step 3). */
  function advanceGuestToPricing() {
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Guest Person' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'guest@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))
  }

  it('shows the company-ID unlock form for a guest, with public pricing', () => {
    render(<CheckoutTunnel {...makeProps(GUEST)} />)
    advanceGuestToPricing()

    expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/member company id/i)).toBeInTheDocument()
    // Public rate ($1,200), no member savings line yet.
    expect(screen.getByText('Registration fee (ex GST)')).toBeInTheDocument()
    expect(screen.queryByText(/member savings/i)).not.toBeInTheDocument()
  })

  it('applies the tiered member rate ex GST when a valid company ID is entered', async () => {
    validateMemberCompany.mockResolvedValueOnce({
      companyId: '1024',
      companyName: 'ACME Welding Pty Ltd',
      tier: 'corporate_gold'
    })

    render(<CheckoutTunnel {...makeProps(GUEST)} />)
    advanceGuestToPricing()

    fireEvent.change(screen.getByLabelText(/member company id/i), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

    expect(validateMemberCompany).toHaveBeenCalledWith('441838610', '1024')

    // Applied confirmation + gold tier rate + savings appear.
    expect(await screen.findByText(/member pricing applied via/i)).toBeInTheDocument()
    expect(screen.getByText('ACME Welding Pty Ltd')).toBeInTheDocument()
    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.getByText(/member savings/i)).toBeInTheDocument()
    // price_gold = 700 EX GST, so the fee is $700 and the total is $700 + $70.
    expect(screen.getByText('$700.00')).toBeInTheDocument()
    expect(screen.getByText('$70.00')).toBeInTheDocument()
    expect(screen.getByText('$770.00')).toBeInTheDocument()
  })

  it('forwards the company ID and member ticket to the Event Engine reserve call', async () => {
    validateMemberCompany.mockResolvedValueOnce({
      companyId: '1024',
      companyName: 'ACME Welding Pty Ltd',
      tier: 'corporate_gold'
    })
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o9' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/9' })

    render(<CheckoutTunnel {...makeProps(GUEST)} />)
    advanceGuestToPricing()

    fireEvent.change(screen.getByLabelText(/member company id/i), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))
    await screen.findByText(/member pricing applied via/i)

    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const [, , body] = reserveSeat.mock.calls[0]!
    expect(body.ticketTypeId).toBe('tt_member')
    expect(body.memberTier).toBe('corporate_gold')
    expect(body.memberCompanyId).toBe('1024')
    expect(body.expectedUnitCents).toBe(70000)
  })

  it('shows a friendly error and keeps public pricing for an unknown ID', async () => {
    validateMemberCompany.mockResolvedValueOnce(null)

    render(<CheckoutTunnel {...makeProps(GUEST)} />)
    advanceGuestToPricing()

    fireEvent.change(screen.getByLabelText(/member company id/i), { target: { value: '9999' } })
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't find an active member company/i
    )
    expect(screen.queryByText(/member savings/i)).not.toBeInTheDocument()
    expect(screen.getByText('Registration fee (ex GST)')).toBeInTheDocument()
  })

  it('does not show the unlock form for a logged-in member', async () => {
    render(<CheckoutTunnel {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )
    expect(screen.queryByLabelText(/member company id/i)).not.toBeInTheDocument()
  })
})

describe('CheckoutTunnel - company ID tier precedence', () => {
  // A logged-in contact who is NOT an entitled member but carries a stale /
  // `non_member` `member_tier`. The unlock form still shows (they are not a
  // member-by-login), so applying a corporate company ID must win the tier.
  const STALE_TIER_CONTACT = {
    member_is_logged_in: true,
    member_is_member: false,
    member_tier: 'non_member',
    member_name: 'Stale Person',
    member_email: 'stale@example.com'
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  it('applies the validated company tier over a stale/non_member member_tier', async () => {
    validateMemberCompany.mockResolvedValueOnce({
      companyId: '1024',
      companyName: 'ACME Welding Pty Ltd',
      tier: 'corporate_gold'
    })

    render(<CheckoutTunnel {...makeProps(STALE_TIER_CONTACT)} />)
    // Logged in → step 2 is skipped; confirm goes straight to pricing.
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))

    fireEvent.change(await screen.findByLabelText(/member company id/i), {
      target: { value: '1024' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))

    await screen.findByText(/member pricing applied via/i)
    // The Gold company rate ($700) must win - NOT the individual rate ($800)
    // that a `non_member` token would otherwise resolve to.
    expect(screen.getByText('Member rate (ex GST)')).toBeInTheDocument()
    expect(screen.queryByText('Individual member rate')).toBeNull()
    expect(screen.getByText('$700.00')).toBeInTheDocument()
    expect(screen.getByText('$770.00')).toBeInTheDocument()
    expect(screen.queryByText('$800.00')).toBeNull()
  })
})

describe('CheckoutTunnel - redirect provider forwards company discount', () => {
  const REDIRECT_SESSION: CheckoutSession = {
    ...SESSION,
    registration_url: 'https://ext.example.com/checkout'
  }
  const GUEST = {
    member_is_logged_in: false,
    member_is_member: false,
    member_tier: '',
    member_name: '',
    member_email: ''
  } as const

  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  function advanceGuestToPricing() {
    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Guest Person' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'guest@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))
  }

  it('appends the tier and validated company ID to the redirect URL', async () => {
    validateMemberCompany.mockResolvedValueOnce({
      companyId: '1024',
      companyName: 'ACME Welding Pty Ltd',
      tier: 'corporate_gold'
    })

    render(
      <CheckoutTunnel
        {...makeProps({ ...GUEST, session: REDIRECT_SESSION, payment_provider: 'redirect' })}
      />
    )
    advanceGuestToPricing()

    fireEvent.change(screen.getByLabelText(/member company id/i), { target: { value: '1024' } })
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }))
    await screen.findByText(/member pricing applied via/i)

    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    const target = new URL(window.location.href)
    expect(target.origin + target.pathname).toBe('https://ext.example.com/checkout')
    expect(target.searchParams.get('wa_member_tier')).toBe('corporate_gold')
    expect(target.searchParams.get('wa_member_company_id')).toBe('1024')
  })

  it('leaves the redirect URL unchanged for a guest with no discount', async () => {
    render(
      <CheckoutTunnel
        {...makeProps({ ...GUEST, session: REDIRECT_SESSION, payment_provider: 'redirect' })}
      />
    )
    advanceGuestToPricing()

    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    expect(window.location.href).toBe('https://ext.example.com/checkout')
  })
})

describe('the guest price quote', () => {
  // A true guest used to reach reserve with NO enforced price guard: the page could
  // display one amount and the invoice carry another, with nothing anywhere noticing.
  // That is how GST reached a buyer twice - the page adds 10% to the HubDB figure it
  // shows, HubSpot adds the portal's rate to the figure the worker invoices, and while
  // those were two separately maintained numbers (HubDB here, `ticket_types.price_cents`
  // in D1) nothing required them to share a tax basis. They read off one row now, and
  // the guard refuses the difference instead of logging it.
  beforeEach(() => {
    vi.clearAllMocks()
    resetAvailabilityCache()
    window.turnstile = undefined
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/checkout/', search: '?session_id=101' }
    })
  })

  /** Walk a logged-out non-member all the way to a submitted reserve body. */
  async function guestReserveBody() {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o-guest' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/guest' })

    render(
      <CheckoutTunnel
        {...makeProps({
          member_is_logged_in: false,
          member_is_member: false,
          member_tier: '',
          member_company_tier: '',
          member_status: '',
          member_name: '',
          member_email: ''
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm and continue/i }))
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'guest@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Guest Buyer' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'guest@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /review your pricing/i })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: /proceed to payment/i }))
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    return reserveSeat.mock.calls[0]![2]
  }

  it('holds the worker to the displayed price for a guest, as it does for a member', async () => {
    const body = await guestReserveBody()

    // The public price off the same HubDB row the worker prices from.
    expect(body.expectedUnitCents).toBe(Math.round(SESSION.price_non_member * 100))
    // The measuring-only field is gone: an invoice above the displayed price is refused,
    // not logged and charged.
    expect(body).not.toHaveProperty('quotedUnitCents')
  })

  it('quotes the EX-GST figure, not the inc-GST total the buyer was shown', async () => {
    // The worker resolves its price from the same ex-GST HubDB row and GST is HubSpot's
    // to add on the invoice, so sending the gross total would refuse every booking -
    // and a guard that has to be switched off is how the double charge got through in
    // the first place.
    const body = await guestReserveBody()
    expect(body.expectedUnitCents).toBe(120000)
    // 1200 ex GST would be 132000 cents inc GST; the guard must see 120000.
    expect(body.expectedUnitCents).not.toBe(132000)
  })

  it('still sends the enforcing field for a member, unchanged', async () => {
    reserveSeat.mockResolvedValue({ status: 'reserved', orderId: 'o-member' })
    pollOrder.mockResolvedValue({ paymentUrl: 'https://invoice.example.com/pay/m' })

    render(<CheckoutTunnel {...makeProps()} />)
    advanceMemberToPayment()
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }))

    await waitFor(() => expect(reserveSeat).toHaveBeenCalledTimes(1))
    const body = reserveSeat.mock.calls[0]![2]
    expect(body.expectedUnitCents).toBe(70000)
    expect(body).not.toHaveProperty('quotedUnitCents')
  })
})
