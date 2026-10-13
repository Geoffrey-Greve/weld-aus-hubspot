/**
 * CheckoutTunnel - multi-step course/event registration tunnel.
 *
 * Steps:
 *   1. Confirm session - validate ?session_id against HubDB data passed by HubL.
 *   2. Identify       - logged-in members skip; guests enter email + name.
 *   3. Discount preview - show member vs public pricing; fire GA4 event if discount.
 *   4. Payment        - hapily redirect | Stripe inline | external redirect.
 *
 * See CLAUDE.md §6.7 and docs/02-module-catalog.md §4.8 for the full spec.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  formatCurrencyDollars,
  gstOnExclusiveDollars,
  totalIncGstDollars
} from '@shared/utils/formatCurrency'
import { formatDateRange } from '@shared/utils/formatDate'
import { buildRegistrationUrl } from '@shared/utils/registration'
import { readCheckoutPricingHandoff } from '@shared/utils/checkoutPricingHandoff'
import {
  pickBestMemberTier,
  resolveMemberPrice,
  resolveRegistrationPrice
} from '@shared/utils/memberPricing'
import { pushDataLayer } from '@shared/api/events'
import { validateMemberCompany, type MemberCompany } from '@shared/api/members'
import {
  reserveSeat,
  reserveCoursePackage,
  reserveSelectedModules,
  pollOrder,
  getIdempotencyKey,
  clearIdempotencyKey,
  reservationScope,
  friendlyReserveError,
  isReservationExpired,
  RESERVATION_EXPIRED_MESSAGE,
  TRANSPORT_ERROR_STATUS,
  SERVER_ERROR_STATUS,
  applyAvailability,
  hasStartDatePassed,
  fetchEventQuestions,
  missingRequiredAnswers,
  splitAnswers,
  type AvailabilityResponse,
  type EventEngineConfig,
  type QuestionAnswers,
  type RegistrationQuestion,
  type ReserveBody
} from '@shared/api/eventEngine'
import { useLiveAvailability } from '@shared/api/useLiveAvailability'
import { type HubdbStatus, statusPresentation } from '@shared/status/sessionStatus'
import { RegistrationQuestions } from '@shared/components/RegistrationQuestions'
import { CheckoutConfirmation } from '../checkout-confirmation/CheckoutConfirmation'
import { CHECKOUT_STORAGE_KEY, type CheckoutReceipt } from './checkoutReceipt'
import './CheckoutTunnel.css'

/** Stable identity: a fresh [] every render would re-run the availability effect. */
const EMPTY_EVENT_IDS: string[] = []

export { CHECKOUT_STORAGE_KEY }
export type { CheckoutReceipt }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckoutSession {
  id: string
  kind?: 'course' | 'event'
  course_name: string
  city: string
  start_date: string
  end_date: string
  price_member: number
  price_individual?: number
  price_student?: number
  price_bronze?: number
  price_silver?: number
  price_gold?: number
  /**
   * A tier priced as a PERCENTAGE off `price_non_member`, which is how the `events`
   * HubDB table states its tiers (QA ref 73). `resolveMemberPrice` applies them; a
   * course row carries none, so nothing on that path changes.
   */
  discount_gold?: number | string | null
  discount_silver?: number | string | null
  discount_bronze?: number | string | null
  price_non_member: number
  registration_url: string
  /** The HubDB `status` column, slugged by HubL. `closed` is Ref 74c. */
  status: HubdbStatus
  seats_remaining?: number | null
  seats_remaining_is_set?: boolean
  zoom_link: string
  /** Event Engine event id for this session (Worker keys events by slug). */
  worker_event_id?: string
  /** Worker ticket type ids (tt_…) for member / non-member pricing. */
  member_ticket_type_id?: string
  non_member_ticket_type_id?: string
  /** Explicit opt-in for the complete-course package reservation path. */
  course_package_booking?: boolean
  /** Child module rows selected from the parent course page for one combined checkout. */
  selected_modules?: CheckoutSelectedModule[]
}

export interface CheckoutSelectedModule {
  id: string
  course_name: string
  city: string
  start_date: string
  end_date: string
  price_member: number
  price_individual?: number
  price_student?: number
  price_bronze?: number
  price_silver?: number
  price_gold?: number
  /**
   * A tier priced as a PERCENTAGE off `price_non_member`, which is how the `events`
   * HubDB table states its tiers (QA ref 73). `resolveMemberPrice` applies them; a
   * course row carries none, so nothing on that path changes.
   */
  discount_gold?: number | string | null
  discount_silver?: number | string | null
  discount_bronze?: number | string | null
  price_non_member: number
  worker_event_id?: string
  member_ticket_type_id?: string
  non_member_ticket_type_id?: string
}

export interface CheckoutTunnelProps {
  session: CheckoutSession | null
  /** Render the saved receipt/confirmation state on the published checkout page. */
  show_confirmation?: boolean
  /** Used for empty/error copy when the URL points at a missing item. */
  requested_item_type?: 'course' | 'event'
  /** True when HubSpot Private Content reports an authenticated contact. */
  member_is_logged_in: boolean
  /** True when CRM status/tier or the HubDB members directory confirms member entitlement. */
  member_is_member: boolean
  member_tier: string
  /**
   * Scrubbed company membership level (Corporate Gold / Silver / …). Kept
   * separate from `member_tier` so React can prefer the stronger of the two
   * when a contact holds both an individual membership and a corporate seat.
   */
  member_company_tier?: string
  member_status?: string
  member_name: string
  member_email: string
  member_company_name?: string
  /**
   * The HubSpot Company this page priced from, when the buyer's membership came from
   * their employer rather than their own contact record.
   *
   * Forwarded to the Worker at reserve so it re-validates the SAME company
   * (resolveMembershipFromCompanyId) instead of resolving membership from the buyer's
   * email alone. An employee whose contact carries no membership of their own resolves
   * as a non-member that way, gets priced at the public rate, and the reserve price
   * guard then refuses the booking with "the course price changed before checkout".
   * The Worker never trusts the id - it reads the company itself.
   */
  member_company_id?: string
  step_labels: {
    step_1: string
    step_2: string
    step_3: string
    step_4: string
  }
  guest_checkout_allowed: boolean
  membership_offer_post_purchase: boolean
  membership_offer_message: string
  payment_provider: 'hapily' | 'stripe' | 'redirect' | 'event_engine'
  stripe_publishable_key: string
  /** Public Cloudflare Turnstile site key. Secret stays in the Worker env. */
  turnstile_site_key?: string
  /** Event Engine Worker base URL (set once on the /checkout/ module tag). */
  worker_base_url: string
  /** X-Portal-Id for the Worker; defaults to the Hub ID on the HubL side. */
  worker_portal_id: string
  confirmation_redirect: string
  support_email: string
  portal_id: string
}

type CheckoutStep = 1 | 2 | 3 | 4

interface GuestDetails {
  name: string
  email: string
}

function hasValue(value: string | null | undefined): boolean {
  return Boolean(value && value.trim())
}

function normaliseMembershipSignal(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const NON_MEMBER_SIGNALS = new Set([
  'not_applicable',
  'non_member',
  'nonmember',
  'never_member',
  'none',
  'na',
  'n_a'
])

const INACTIVE_MEMBER_STATUSES = new Set(['lapsed', 'expired', 'inactive', 'cancelled', 'canceled'])

const REAL_MEMBER_TIER_TOKENS = [
  'gold',
  'silver',
  'bronze',
  'student',
  'apprentice',
  'individual',
  'reciprocal',
  'associate',
  'honorary',
  'honourary',
  'industry_supplier',
  'corporate',
  'tafe',
  'government_rto',
  'rto'
]

function isInactiveMemberStatus(value: string | null | undefined): boolean {
  const key = normaliseMembershipSignal(value)
  return Boolean(key && INACTIVE_MEMBER_STATUSES.has(key))
}

function hasRealMemberTierSignal(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => {
    const key = normaliseMembershipSignal(value)
    if (!key || NON_MEMBER_SIGNALS.has(key)) return false
    return REAL_MEMBER_TIER_TOKENS.some((token) => key.includes(token))
  })
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export function saveCheckoutReceipt(receipt: CheckoutReceipt): void {
  try {
    sessionStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(receipt))
  } catch {
    // sessionStorage unavailable (private browsing modes) - non-fatal
  }
}

// ─── Third-party script type stubs ────────────────────────────────────────────

interface TurnstileRenderOptions {
  sitekey: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId?: string) => void
}

declare global {
  interface Window {
    Stripe?: (key: string) => StripeInstance
    turnstile?: TurnstileApi
  }
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-wa-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('turnstile_script_failed')), {
        once: true
      })
      return
    }

    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.dataset.waTurnstile = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('turnstile_script_failed'))
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

// ─── Step indicator (portal into checkout header) ─────────────────────────────

interface StepIndicatorProps {
  currentStep: CheckoutStep
  labels: CheckoutTunnelProps['step_labels']
  onStepSelect: (step: CheckoutStep) => void
}

function getRegistrationType(session: CheckoutSession | null | undefined): 'course' | 'event' {
  return session?.kind === 'event' ? 'event' : 'course'
}

function getItemNoun(type: 'course' | 'event'): string {
  return type === 'event' ? 'event' : 'session'
}

function getBrowseUrl(type: 'course' | 'event'): string {
  return type === 'event' ? '/events/' : '/courses/'
}

function getBrowseLabel(type: 'course' | 'event'): string {
  return type === 'event' ? 'browse other events' : 'browse other sessions'
}

function selectedModulesFor(session: CheckoutSession): CheckoutSelectedModule[] {
  return Array.isArray(session.selected_modules) ? session.selected_modules : []
}

function ticketTypeForSession(
  item: Pick<CheckoutSession, 'member_ticket_type_id' | 'non_member_ticket_type_id'>,
  isMember: boolean
): string {
  return isMember
    ? item.member_ticket_type_id || item.non_member_ticket_type_id || ''
    : item.non_member_ticket_type_id || ''
}

function selectedModuleLineItems(
  session: CheckoutSession,
  isMember: boolean,
  memberTier: string
): Array<CheckoutSelectedModule & { selectedPrice: number; ticketTypeId: string }> {
  return selectedModulesFor(session).map((module) => ({
    ...module,
    selectedPrice: resolveRegistrationPrice(module as CheckoutSession, isMember, memberTier),
    ticketTypeId: ticketTypeForSession(module, isMember)
  }))
}

function selectedModuleTotal(
  session: CheckoutSession,
  isMember: boolean,
  memberTier: string
): number {
  return selectedModuleLineItems(session, isMember, memberTier).reduce(
    (sum, module) => sum + module.selectedPrice,
    0
  )
}

function StepIndicator({
  currentStep,
  labels,
  onStepSelect
}: StepIndicatorProps): React.ReactElement {
  const steps = [labels.step_1, labels.step_2, labels.step_3, labels.step_4]

  return (
    <ol className="wa-checkout-steps" aria-label="Checkout progress">
      {steps.map((label, i) => {
        const stepNum = (i + 1) as CheckoutStep
        const isDone = stepNum < currentStep
        const isCurrent = stepNum === currentStep
        const isAvailable = stepNum <= currentStep

        return (
          <li
            key={stepNum}
            className={[
              'wa-checkout-steps__item',
              isDone ? 'wa-checkout-steps__item--done' : '',
              isCurrent ? 'wa-checkout-steps__item--current' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <button
              type="button"
              className="wa-checkout-steps__button"
              disabled={!isAvailable}
              onClick={() => {
                if (isAvailable) {
                  onStepSelect(stepNum)
                }
              }}
              aria-label={
                isCurrent
                  ? `Current step: ${label}`
                  : isDone
                    ? `Return to ${label}`
                    : `${label} is locked until earlier steps are complete`
              }
            >
              <span className="wa-checkout-steps__num" aria-hidden={isDone ? 'true' : undefined}>
                {isDone ? '✓' : stepNum}
              </span>
              <span className="wa-checkout-steps__label">{label}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ─── Session summary card (reused across steps) ───────────────────────────────

function SessionSummaryCard({ session }: { session: CheckoutSession }): React.ReactElement {
  const selectedModules = selectedModulesFor(session)
  return (
    <div className="wa-checkout-session-card">
      <h2 className="wa-checkout-session-card__title">{session.course_name}</h2>
      <dl className="wa-checkout-session-card__meta">
        <div className="wa-checkout-session-card__row">
          <dt>Location</dt>
          <dd>{session.city}</dd>
        </div>
        <div className="wa-checkout-session-card__row">
          <dt>Dates</dt>
          <dd>{formatDateRange(session.start_date, session.end_date)}</dd>
        </div>
      </dl>
      {selectedModules.length > 0 && (
        <div className="wa-checkout-selected-modules">
          <p className="wa-checkout-selected-modules__heading">
            Selected modules ({selectedModules.length})
          </p>
          <ul className="wa-checkout-selected-modules__list">
            {selectedModules.map((module) => (
              <li key={module.id}>{module.course_name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Step 1: Confirm session ──────────────────────────────────────────────────

/** One selected module's live state, alongside the ticket this checkout would book it on. */
interface ModuleAvailability {
  live: AvailabilityResponse | null
  name: string
  ticketTypeId: string
  /** The module session's own `start_date`, so one that has already run blocks the bundle. */
  startDate?: string
}

function Step1ConfirmSession({
  session,
  live,
  ticketTypeId,
  modules = [],
  onNext
}: {
  session: CheckoutSession
  live: AvailabilityResponse | null
  /** The ticket type this buyer would reserve, so a paused one blocks here not at reserve. */
  ticketTypeId?: string
  /** The modules a selected-module checkout would book alongside it. */
  modules?: ModuleAvailability[]
  onNext: () => void
}): React.ReactElement {
  const registrationType = getRegistrationType(session)
  const itemNoun = getItemNoun(registrationType)
  const browseUrl = getBrowseUrl(registrationType)
  const browseLabel = getBrowseLabel(registrationType)
  const hasExplicitSeatsRemaining = session.seats_remaining_is_set === true
  const hubdbSeatsRemaining =
    typeof session.seats_remaining === 'number' && Number.isFinite(session.seats_remaining)
      ? session.seats_remaining
      : null
  // The Worker's answer where there is one. Catching a closed or full session HERE rather
  // than at reserve is the point: the buyer finds out on the first screen instead of after
  // typing their details, their colleagues' names and their ABN. The row's status column
  // and its seats_remaining go over separately: a hand-set Sold Out is final, a stale seat
  // count is not.
  const state = applyAvailability(
    {
      status: session.status ?? 'available',
      seatsRemaining: hubdbSeatsRemaining,
      seatsRemainingIsSet: hasExplicitSeatsRemaining,
      startDate: session.start_date
    },
    live,
    ticketTypeId || undefined
  )
  const isSoldOut = state.status === 'sold_out'
  const isCancelled = state.status === 'cancelled'
  const isClosed = state.status === 'registration_closed'
  const isPaused = state.status === 'sales_paused'
  const isNotBookable = state.status === 'not_bookable'

  // A selected-module checkout books several events at once, and reserve takes them as one
  // booking: if the third module has closed, the whole thing fails. Naming WHICH module is
  // the difference between a buyer who can pick again and one who just sees "unavailable"
  // on a page listing five modules that all look fine.
  //
  // A module is judged even when its live read is missing, because its own start date is
  // enough on its own: the stale booking links this checkout is reached from point at
  // sessions that have already run, and a bundle carrying one of those cannot be sold
  // whatever the Worker did or did not answer.
  const blockedModules = modules
    .map((module) => ({
      name: module.name,
      state:
        module.live || hasStartDatePassed(module.startDate)
          ? applyAvailability(
              { status: 'available', seatsRemaining: null, startDate: module.startDate },
              module.live,
              module.ticketTypeId || undefined
            )
          : null
    }))
    .filter((module) => module.state !== null && !statusPresentation(module.state.status).bookable)

  // One question — "may this be booked" — asked once. The five booleans above stay because
  // each earns its OWN sentence below (a checkout says more than a badge does); what does
  // not stay is a hand-maintained OR-chain that has to be remembered every time the status
  // set grows.
  const isUnavailable = !statusPresentation(state.status).bookable || blockedModules.length > 0

  return (
    <div className="wa-checkout-step">
      <h2 className="wa-checkout-step__heading">Confirm your {itemNoun}</h2>
      <SessionSummaryCard session={session} />

      {isSoldOut && (
        <p className="wa-checkout-notice wa-checkout-notice--warning" role="alert">
          This {itemNoun} is sold out. Please <a href={browseUrl}>{browseLabel}</a>.
        </p>
      )}
      {isCancelled && (
        <p className="wa-checkout-notice wa-checkout-notice--warning" role="alert">
          This {itemNoun} has been cancelled. Please <a href={browseUrl}>{browseLabel}</a>.
        </p>
      )}
      {isClosed && (
        <p className="wa-checkout-notice wa-checkout-notice--warning" role="alert">
          Registrations for this {itemNoun} have closed. Please{' '}
          <a href={browseUrl}>{browseLabel}</a>.
        </p>
      )}
      {isPaused && (
        <p className="wa-checkout-notice wa-checkout-notice--warning" role="alert">
          Bookings for this {itemNoun} are temporarily on hold. Please check back shortly, or{' '}
          <a href={browseUrl}>{browseLabel}</a>.
        </p>
      )}
      {isNotBookable && (
        <p className="wa-checkout-notice wa-checkout-notice--warning" role="alert">
          Bookings for this {itemNoun} are not open yet. Please{' '}
          <a href={browseUrl}>{browseLabel}</a>, or contact the training team and we will
          let you know as soon as places are released.
        </p>
      )}
      {blockedModules.map((module) => (
        <p
          key={module.name}
          className="wa-checkout-notice wa-checkout-notice--warning"
          role="alert"
        >
          {module.name} is no longer available
          {module.state?.status === 'sold_out'
            ? ' (sold out)'
            : module.state?.status === 'registration_closed'
              ? ' (registrations have closed)'
              : module.state?.status === 'not_bookable'
                ? ' (bookings are not open yet)'
                : ' (bookings are temporarily on hold)'}
          . Please <a href={browseUrl}>{browseLabel}</a> and choose again.
        </p>
      ))}

      {!isUnavailable && (
        <div className="wa-checkout-step__actions wa-checkout-step__actions--single">
          <button className="wa-btn wa-btn--primary wa-btn--lg" onClick={onNext}>
            Confirm and continue
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Identify ─────────────────────────────────────────────────────────

type IdentifyPhase = 'email_entry' | 'options'

function Step2Identify({
  guestCheckoutAllowed,
  onNext,
  onBack
}: {
  guestCheckoutAllowed: boolean
  onNext: (guest: GuestDetails | null) => void
  onBack: () => void
}): React.ReactElement {
  const [phase, setPhase] = useState<IdentifyPhase>('email_entry')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  const loginReturn = encodeURIComponent(window.location.pathname + window.location.search)
  const loginHref = `/_hcms/mem/login?redirect_url=${loginReturn}`

  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPhase('options')
  }

  function handleGuestContinue(e: React.FormEvent) {
    e.preventDefault()
    onNext({ name, email })
  }

  if (phase === 'options') {
    return (
      <div className="wa-checkout-step">
        <h2 className="wa-checkout-step__heading">How would you like to continue?</h2>
        <div className="wa-checkout-identify-options">
          <a href={loginHref} className="wa-btn wa-btn--secondary">
            Sign in to member account
          </a>
          {guestCheckoutAllowed ? (
            <form className="wa-checkout-guest-form" onSubmit={handleGuestContinue}>
              <p className="wa-checkout-guest-form__divider">or continue as guest</p>
              <div className="wa-field">
                <label htmlFor="wa-ct-guest-name">Full name</label>
                <input
                  id="wa-ct-guest-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="wa-field">
                <label htmlFor="wa-ct-guest-email-2">Email</label>
                <input
                  id="wa-ct-guest-email-2"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button type="submit" className="wa-btn wa-btn--primary">
                Continue as guest
              </button>
            </form>
          ) : (
            <p className="wa-checkout-notice">
              Member login is required to complete this registration.
            </p>
          )}
        </div>
        <div className="wa-checkout-step__actions wa-checkout-step__actions--single">
          <button
            type="button"
            className="wa-btn wa-btn--ghost"
            onClick={() => setPhase('email_entry')}
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="wa-checkout-step">
      <h2 className="wa-checkout-step__heading">Your details</h2>
      <form onSubmit={handleEmailSubmit}>
        <div className="wa-field">
          <label htmlFor="wa-ct-email">Email address</label>
          <input
            id="wa-ct-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="wa-checkout-step__actions">
          <button type="button" className="wa-btn wa-btn--ghost" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="wa-btn wa-btn--primary">
            Continue
          </button>
        </div>
      </form>
      <p className="wa-checkout-step__sub">
        Already a member? <a href={loginHref}>Sign in</a>
      </p>
    </div>
  )
}

// ─── Member company unlock (Step 3) ───────────────────────────────────────────

function MemberCompanyUnlock({
  portalId,
  appliedCompany,
  onApplyCompany
}: {
  portalId: string
  appliedCompany: MemberCompany | null
  onApplyCompany: (company: MemberCompany | null) => void
}): React.ReactElement {
  const [companyId, setCompanyId] = useState('')
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = companyId.trim()
    if (!trimmed) {
      setError('Please enter your member company ID.')
      return
    }
    setValidating(true)
    setError('')
    try {
      const company = await validateMemberCompany(portalId, trimmed)
      if (company) {
        onApplyCompany(company)
      } else {
        setError(
          "We couldn't find an active member company with that ID. Please check the ID with your account admin."
        )
      }
    } catch {
      setError('We couldn’t verify that ID right now. Please try again in a moment.')
    } finally {
      setValidating(false)
    }
  }

  if (appliedCompany) {
    return (
      <div className="wa-checkout-member-unlock wa-checkout-member-unlock--applied">
        <p className="wa-checkout-discount-callout" role="status">
          Member pricing applied via <strong>{appliedCompany.companyName}</strong>.
        </p>
        <button
          type="button"
          className="wa-checkout-member-unlock__change"
          onClick={() => onApplyCompany(null)}
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="wa-checkout-member-unlock">
      <p className="wa-checkout-member-unlock__prompt">
        Registering through a member company? Enter your company ID to apply member pricing.
      </p>
      <form className="wa-checkout-member-unlock__form" onSubmit={handleSubmit} noValidate>
        <div className="wa-field wa-checkout-member-unlock__field">
          <label htmlFor="wa-ct-company-id">Member company ID</label>
          <input
            id="wa-ct-company-id"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 1024"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'wa-ct-company-id-error' : undefined}
            disabled={validating}
          />
        </div>
        <button
          type="submit"
          className="wa-btn wa-btn--secondary"
          disabled={validating}
          aria-busy={validating}
        >
          {validating ? 'Checking…' : 'Apply'}
        </button>
      </form>
      {error && (
        <p id="wa-ct-company-id-error" className="wa-checkout-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Step 3: Discount preview ─────────────────────────────────────────────────

function Step3DiscountPreview({
  session,
  isMember,
  memberTier,
  portalId,
  alreadyMemberByLogin,
  appliedCompany,
  onApplyCompany,
  onNext,
  onBack
}: {
  session: CheckoutSession
  isMember: boolean
  memberTier: string
  portalId: string
  alreadyMemberByLogin: boolean
  appliedCompany: MemberCompany | null
  onApplyCompany: (company: MemberCompany | null) => void
  onNext: () => void
  onBack: () => void
}): React.ReactElement {
  const registrationType = getRegistrationType(session)
  const moduleSelection = selectedModuleLineItems(session, isMember, memberTier)
  const hasModuleSelection = moduleSelection.length > 0
  const memberPrice = hasModuleSelection
    ? { price: selectedModuleTotal(session, true, memberTier) }
    : resolveMemberPrice(session, memberTier)
  const standardPrice = hasModuleSelection
    ? moduleSelection.reduce((sum, module) => sum + module.price_non_member, 0)
    : session.price_non_member
  const basePrice = hasModuleSelection
    ? moduleSelection.reduce((sum, module) => sum + module.selectedPrice, 0)
    : resolveRegistrationPrice(session, isMember, memberTier)
  const savings = isMember ? standardPrice - memberPrice.price : 0
  const hasSavings = isMember && savings > 0
  // HubDB prices are EX GST (the tiered columns are named `..._aud_ex_gst`, and every
  // course card on the site labels them that way), so GST is ADDED here rather than
  // split back out of the price. `basePrice` stays the ex-GST figure: it is what the
  // Worker resolves from the same HubDB row, so it is what the reserve price guard is
  // given to compare against.
  const gstAmount = gstOnExclusiveDollars(basePrice)
  const totalWithGst = totalIncGstDollars(basePrice)

  const discountFiredRef = useRef(false)
  useEffect(() => {
    if (hasSavings && !discountFiredRef.current) {
      discountFiredRef.current = true
      pushDataLayer('member_discount_applied', {
        registration_type: registrationType,
        item_id: session.id,
        item_name: session.course_name,
        course_id: session.id,
        course_name: session.course_name,
        savings_amount: savings,
        member_tier: memberTier,
        discount_source: appliedCompany ? 'company_id' : 'membership'
      })
    }
  }, [
    hasSavings,
    savings,
    session.id,
    session.course_name,
    memberTier,
    registrationType,
    appliedCompany
  ])

  return (
    <div className="wa-checkout-step">
      <h2 className="wa-checkout-step__heading">Review your pricing</h2>
      <SessionSummaryCard session={session} />

      {!alreadyMemberByLogin && (
        <MemberCompanyUnlock
          portalId={portalId}
          appliedCompany={appliedCompany}
          onApplyCompany={onApplyCompany}
        />
      )}

      <div className="wa-checkout-pricing">
        <div className="wa-checkout-pricing__lines">
          {/* Struck through only when there is genuinely something struck off. Weld price
              a good many sessions at one rate for everyone, and on those rows the member
              and standard columns hold the same number - so this line rendered a crossed
              out figure identical to the one beside it, claiming a discount of zero and
              inviting the buyer to work out which of the two they are being charged. The
              savings line below already gates on the same condition. */}
          {hasSavings && (
            <div className="wa-checkout-pricing__line wa-checkout-pricing__line--struck">
              <span className="wa-checkout-pricing__label">Standard rate (ex GST)</span>
              <span className="wa-checkout-pricing__amount wa-checkout-pricing__amount--struck">
                {formatCurrencyDollars(standardPrice)}
              </span>
            </div>
          )}
          <div className="wa-checkout-pricing__line">
            <span className="wa-checkout-pricing__label">
              {isMember ? 'Member rate' : 'Registration fee'} (ex GST)
            </span>
            <span
              className={[
                'wa-checkout-pricing__amount',
                isMember ? 'wa-checkout-pricing__amount--member' : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {formatCurrencyDollars(basePrice)}
            </span>
          </div>
          {hasSavings && (
            <div className="wa-checkout-pricing__line wa-checkout-pricing__line--savings">
              <span className="wa-checkout-pricing__label">Member savings</span>
              <span className="wa-checkout-pricing__amount wa-checkout-pricing__amount--savings">
                −{formatCurrencyDollars(savings)}
              </span>
            </div>
          )}
          <div className="wa-checkout-pricing__line wa-checkout-pricing__line--gst">
            <span className="wa-checkout-pricing__label">GST</span>
            <span className="wa-checkout-pricing__amount">
              {formatCurrencyDollars(gstAmount)}
            </span>
          </div>
          <div className="wa-checkout-pricing__line wa-checkout-pricing__line--total">
            <span className="wa-checkout-pricing__label">Total (inc. GST)</span>
            <span className="wa-checkout-pricing__amount wa-checkout-pricing__amount--total">
              {formatCurrencyDollars(totalWithGst)}
            </span>
          </div>
        </div>

        {hasSavings && (
          <p className="wa-checkout-discount-callout" role="status">
            You&apos;re saving <strong>{formatCurrencyDollars(savings)}</strong> with your Weld
            Australia membership.
          </p>
        )}
      </div>

      <div className="wa-checkout-step__actions">
        <button className="wa-btn wa-btn--ghost" onClick={onBack}>
          Back
        </button>
        <button className="wa-btn wa-btn--primary wa-btn--lg" onClick={onNext}>
          Proceed to payment
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: Payment ─────────────────────────────────────────────────────────

interface Step4PaymentProps {
  session: CheckoutSession
  isMember: boolean
  memberTier: string
  memberCompanyId?: string
  guest: GuestDetails | null
  memberName: string
  memberEmail: string
  paymentProvider: 'hapily' | 'stripe' | 'redirect' | 'event_engine'
  stripePublishableKey: string
  turnstileSiteKey?: string
  workerBaseUrl: string
  workerPortalId: string
  confirmationRedirect: string
  supportEmail: string
  onBack: () => void
}

function Step4Payment({
  session,
  isMember,
  memberTier,
  memberCompanyId,
  guest,
  memberName,
  memberEmail,
  paymentProvider,
  stripePublishableKey,
  turnstileSiteKey,
  workerBaseUrl,
  workerPortalId,
  confirmationRedirect,
  supportEmail,
  onBack
}: Step4PaymentProps): React.ReactElement {
  const registrationType = getRegistrationType(session)
  const moduleSelection = selectedModuleLineItems(session, isMember, memberTier)
  const hasModuleSelection = moduleSelection.length > 0
  const basePrice = hasModuleSelection
    ? moduleSelection.reduce((sum, module) => sum + module.selectedPrice, 0)
    : resolveRegistrationPrice(session, isMember, memberTier)
  // HubDB prices are EX GST (the tiered columns are named `..._aud_ex_gst`, and every
  // course card on the site labels them that way), so GST is ADDED here rather than
  // split back out of the price. `basePrice` stays the ex-GST figure: it is what the
  // Worker resolves from the same HubDB row, so it is what the reserve price guard is
  // given to compare against.
  const gstAmount = gstOnExclusiveDollars(basePrice)
  const totalWithGst = totalIncGstDollars(basePrice)
  const purchaserName = memberName || guest?.name || memberEmail || guest?.email || ''
  const purchaserEmail = memberEmail || guest?.email || ''

  function buildReceipt(): CheckoutReceipt {
    return {
      registration_type: registrationType,
      course_name: session.course_name,
      city: session.city,
      start_date: session.start_date,
      end_date: session.end_date,
      amount_paid: totalWithGst,
      is_member_price: isMember,
      zoom_link: session.zoom_link || '',
      purchaser_name: purchaserName,
      purchaser_email: purchaserEmail
    }
  }

  if (paymentProvider === 'event_engine') {
    return (
      <EventEnginePayment
        session={session}
        isMember={isMember}
        memberTier={memberTier}
        memberCompanyId={memberCompanyId}
        purchaserName={purchaserName}
        purchaserEmail={purchaserEmail}
        turnstileSiteKey={turnstileSiteKey}
        workerBaseUrl={workerBaseUrl}
        workerPortalId={workerPortalId}
        basePriceExGst={basePrice}
        gstAmount={gstAmount}
        totalWithGst={totalWithGst}
        confirmationRedirect={confirmationRedirect}
        supportEmail={supportEmail}
        receipt={buildReceipt()}
        onBack={onBack}
      />
    )
  }

  if (paymentProvider === 'stripe') {
    return (
      <StripePaymentForm
        session={session}
        publishableKey={stripePublishableKey}
        receipt={buildReceipt()}
        gstAmount={gstAmount}
        totalWithGst={totalWithGst}
        memberCompanyId={memberCompanyId}
        confirmationRedirect={confirmationRedirect}
        supportEmail={supportEmail}
        onBack={onBack}
      />
    )
  }

  // hapily + redirect - both redirect to registration_url.
  // Both providers get the member tier (and any validated company ID) appended
  // as query params so the external checkout can resolve the correct ticket
  // price tier and re-validate the discount server-side. Without this, a guest
  // who unlocked member pricing via a company ID would be handed off with the
  // bare URL, so the amount charged could differ from the price shown here.
  // (buildRegistrationUrl returns the URL unchanged when there is no member
  // tier, so guests/non-members redirect exactly as before.)
  // The total shown above is ours; the amount charged is hapily's. We hand off the tier
  // and company id so it can resolve the same ex-GST rate, but if hapily's own prices are
  // configured GST-inclusive the buyer will see a different number on the next page.
  // Worth checking against a live hapily session before this path carries real money.
  function handleRedirect() {
    saveCheckoutReceipt(buildReceipt())
    const targetUrl = buildRegistrationUrl(session.registration_url, memberTier, memberCompanyId)
    window.location.href = targetUrl
  }

  return (
    <div className="wa-checkout-step">
      <h2 className="wa-checkout-step__heading">Complete payment</h2>
      <SessionSummaryCard session={session} />

      <div className="wa-checkout-payment-summary">
        <p className="wa-checkout-payment-summary__gst">
          GST: {formatCurrencyDollars(gstAmount)}
        </p>
        <p className="wa-checkout-payment-summary__total">
          Total: <strong>{formatCurrencyDollars(totalWithGst)}</strong> (inc. GST)
        </p>
        {paymentProvider === 'hapily' ? (
          <p className="wa-checkout-payment-summary__note">
            You&apos;ll be taken to our secure payment page to complete your registration.
          </p>
        ) : (
          <p className="wa-checkout-payment-summary__note">
            You&apos;ll be redirected to complete payment.
          </p>
        )}
      </div>

      <div className="wa-checkout-step__actions">
        <button className="wa-btn wa-btn--ghost" onClick={onBack}>
          Back
        </button>
        <button className="wa-btn wa-btn--primary wa-btn--lg" onClick={handleRedirect}>
          Complete registration →
        </button>
      </div>

      <p className="wa-checkout-support">
        Need help? <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
    </div>
  )
}

// ─── Event Engine payment ─────────────────────────────────────────────────────

interface EventEnginePaymentProps {
  session: CheckoutSession
  isMember: boolean
  memberTier: string
  memberCompanyId?: string
  purchaserName: string
  purchaserEmail: string
  turnstileSiteKey?: string
  workerBaseUrl: string
  workerPortalId: string
  /** Ex-GST price, as held in HubDB. What the Worker's reserve price guard is given. */
  basePriceExGst: number
  /** GST payable on top of `basePriceExGst`. Display only. */
  gstAmount: number
  totalWithGst: number
  confirmationRedirect: string
  supportEmail: string
  receipt: CheckoutReceipt
  onBack: () => void
}

/**
 * Reserve a seat in the Event Engine, then hand off to payment:
 *   reserved  → poll the order until the HubSpot invoice paymentUrl is ready, redirect.
 *   confirmed → free registration; save receipt and go to the confirmation page.
 *   waitlisted / error → inline status (no redirect).
 *
 * The Worker is authoritative for price and membership at reserve time; the
 * displayed total is informational only.
 */
function EventEnginePayment({
  session,
  isMember,
  memberTier,
  memberCompanyId,
  purchaserName,
  purchaserEmail,
  turnstileSiteKey = '',
  workerBaseUrl,
  workerPortalId,
  basePriceExGst,
  gstAmount,
  totalWithGst,
  confirmationRedirect,
  supportEmail,
  receipt,
  onBack
}: EventEnginePaymentProps): React.ReactElement {
  const registrationType = getRegistrationType(session)
  const itemNoun = getItemNoun(registrationType)
  const analyticsPrefix =
    registrationType === 'event' ? 'event_registration' : 'course_registration'
  const eventId = session.worker_event_id || ''
  const moduleSelection = selectedModuleLineItems(session, isMember, memberTier)
  const hasModuleSelection = moduleSelection.length > 0
  // Members use the member ticket type when one is distinctly configured; otherwise they
  // fall back to the standard (non-member) ticket. Under the Event Engine's tiered-pricing
  // model a course/event has a single standard ticket and the member discount is applied
  // server-side (resolved from the buyer's membership), so members must still have a ticket
  // to reserve against rather than getting "not configured".
  //
  // Non-members are NOT given the member ticket as a fallback: a members-only session (one
  // with only member_ticket_type_id) must stay "not configured" for guests rather than
  // routing them to a member ticket they can't book (Worker members_only error) or the
  // wrong price tier.
  const ticketTypeId = ticketTypeForSession(session, isMember)

  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  // The hosted invoice, once the Worker has one. Terminal state for a paid booking: the
  // tunnel stops here rather than navigating away (see the panel below).
  const [invoiceUrl, setInvoiceUrl] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReady, setTurnstileReady] = useState(false)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)

  // Custom registration questions (Event Engine Phase 2.3). Definitions come from the
  // worker so the tenant can add one without a code change; dietary requirements is a
  // seeded row rather than a field hard-coded here.
  //
  // NOT PREFILLED YET, deliberately. The worker hands an unauthenticated caller definitions
  // only (answering `?email=` with someone's dietary requirements would be a data leak
  // wearing a convenience feature's name) so prefill has to come from HubL reading the
  // logged-in visitor's own contact. The `hsProperty` on each definition names the property
  // to read; wiring that needs a portal to test the HubL property access against, so it is
  // the follow-up rather than a guess shipped blind. Capture works without it.
  const [questions, setQuestions] = useState<RegistrationQuestion[]>([])
  const [answers, setAnswers] = useState<QuestionAnswers>({})
  const [missingAnswers, setMissingAnswers] = useState<string[]>([])
  // `null` from the worker means the definitions could not be READ, which is not the same
  // as an event that asks nothing. The distinction is kept so the submit path can try
  // once more before it goes ahead - but it is NEVER said out loud to the buyer. Most
  // events ask nothing at all, so a notice about "extra questions" describes something
  // the public has no way to recognise and cannot act on, and blocking the button on it
  // turned a silent, self-correcting fault into a dead end in front of a paying customer.
  // The worker is the gate, and its refusal names the question, which is the only
  // sentence here worth showing anyone.
  const [questionsUnavailable, setQuestionsUnavailable] = useState(false)

  const isConfigured = Boolean(
    workerBaseUrl &&
      eventId &&
      (hasModuleSelection
        ? moduleSelection.every((module) => module.worker_event_id && module.ticketTypeId)
        : ticketTypeId)
  )
  // Every public checkout is challenged, paid or free. The gate used to fire only on a $0
  // total, mirroring the Worker. A paid booking now holds its seat until the invoice due
  // date rather than for 15 minutes, so an unchallenged caller could park seats for weeks
  // without paying: the Worker's `shouldRequireTurnstile` was widened to match, and this
  // must render the widget for paid checkouts or the Worker rejects them as token-less.
  const requiresTurnstile = Boolean(turnstileSiteKey)

  // Gated on `isConfigured` rather than fired unconditionally: a session with no bookable
  // ticket renders no form to put the questions in, so the request would be pure noise.
  //
  // Returns the definitions rather than a flag: the submit path needs the fresh set in
  // hand, because `questions` in its own closure is still the stale one after setState.
  const loadQuestions = useCallback(async (): Promise<RegistrationQuestion[] | null> => {
    const defs = await fetchEventQuestions({ workerBaseUrl, portalId: workerPortalId }, eventId)
    if (defs === null) {
      setQuestionsUnavailable(true)
      return null
    }
    setQuestions(defs)
    setQuestionsUnavailable(false)
    return defs
  }, [workerBaseUrl, workerPortalId, eventId])

  useEffect(() => {
    if (!isConfigured) return
    let active = true
    // One automatic retry: the common failure here is a single dropped request, and the
    // buyer is told nothing either way.
    fetchEventQuestions({ workerBaseUrl, portalId: workerPortalId }, eventId)
      .then((defs) =>
        defs === null
          ? fetchEventQuestions({ workerBaseUrl, portalId: workerPortalId }, eventId)
          : defs
      )
      .then((defs) => {
        if (!active) return
        if (defs === null) setQuestionsUnavailable(true)
        else setQuestions(defs)
      })
    return () => {
      active = false
    }
  }, [isConfigured, workerBaseUrl, workerPortalId, eventId])

  const resetTurnstile = useCallback(() => {
    setTurnstileToken('')
    setTurnstileReady(false)
    const widgetId = turnstileWidgetIdRef.current
    if (widgetId && window.turnstile?.reset) {
      try {
        window.turnstile.reset(widgetId)
      } catch {
        // Non-fatal: the next render/user retry can generate a fresh token.
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    if (!requiresTurnstile) {
      setTurnstileToken('')
      setTurnstileReady(true)
      return () => {
        active = false
      }
    }

    setTurnstileReady(false)

    loadTurnstileScript()
      .then(() => {
        if (!active || !turnstileContainerRef.current || !window.turnstile) return
        if (turnstileWidgetIdRef.current) return

        turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token) => {
            if (!active) return
            setTurnstileToken(token || '')
            setTurnstileReady(Boolean(token))
            setError('')
          },
          'expired-callback': () => {
            if (!active) return
            setTurnstileToken('')
            setTurnstileReady(false)
            setError('Security check expired. Please verify again.')
          },
          'error-callback': () => {
            if (!active) return
            setTurnstileToken('')
            setTurnstileReady(false)
            setError('Security check could not be completed. Please try again.')
          }
        })
      })
      .catch(() => {
        if (!active) return
        setTurnstileToken('')
        setTurnstileReady(false)
        setError('Security check could not load. Please refresh and try again.')
      })

    return () => {
      active = false
    }
  }, [requiresTurnstile, turnstileSiteKey])

  // The reserved seat's hold has lapsed. Reset for a clean retry: the
  // idempotency key was already cleared when we detected expiry, so the next
  // submit reserves afresh.
  function handleStartAgain() {
    setExpired(false)
    setError('')
    setStatus('')
    setSubmitting(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isConfigured || submitting) return

    if (requiresTurnstile && !turnstileToken) {
      setStatus('')
      setError('Please complete the security check before continuing.')
      return
    }

    // The definitions never loaded, so this form cannot know what the event asks. One more
    // attempt, silently - and the submit goes ahead either way. Blocking here is what made
    // a fault the buyer cannot see or fix stop their registration: the overwhelming case is
    // an event that asks nothing, where the booking is perfectly complete without them, and
    // the rare one where a required question really is unanswered comes back from the worker
    // naming it, which is both actionable and the truth.
    let activeQuestions = questions
    if (questionsUnavailable) {
      const reloaded = await loadQuestions()
      if (reloaded) activeQuestions = reloaded
    }

    // A courtesy check only: the worker enforces `required` and is the gate. Catching it
    // here saves the buyer a round trip; missing it costs them one.
    const missing = missingRequiredAnswers(activeQuestions, answers)
    setMissingAnswers(missing)
    if (missing.length > 0) {
      setStatus('')
      setError('Please answer the required questions before continuing.')
      return
    }

    setSubmitting(true)
    setError('')
    setStatus('Reserving your place…')

    const cfg: EventEngineConfig = { workerBaseUrl, portalId: workerPortalId }
    const body: ReserveBody = {
      buyer: { name: purchaserName, email: purchaserEmail },
      ...(hasModuleSelection
        ? {
            selectedModules: moduleSelection.map((module) => ({
              eventId: module.worker_event_id || '',
              ticketTypeId: module.ticketTypeId,
              expectedUnitCents: Math.round(module.selectedPrice * 100)
            })),
            // EX GST. The Worker resolves its price from the same HubDB row, which is
            // ex GST, so a GST-inclusive figure here would read as price drift on every
            // booking (`comparePriceQuote` honours the lower resolved price and logs it).
            // GST is HubSpot's to add on the invoice, not ours to quote to the Worker.
            expectedTotalCents: Math.round(basePriceExGst * 100)
          }
        : { ticketTypeId }),
      ...(isMember && !hasModuleSelection
        ? { memberTier, expectedUnitCents: Math.round(basePriceExGst * 100) }
        : isMember
          ? { memberTier }
          : // A guest's price is ENFORCED now, like a member's. It was
            // `quotedUnitCents` - the same comparison with the refusal taken out, logging
            // `price_drift` and booking the seat anyway - because the public price the
            // Worker resolved came from `ticket_types.price_cents` in D1 while this page
            // quoted the HubDB row, two separately maintained copies that were expected
            // to disagree. They are one row now (events-engine `resolveHubDbStandardPrice`),
            // so the only way the resolved price still exceeds this one is a HubDB read
            // that failed, which is the exposure the member path has always carried.
            // What the measuring-only version allowed is a guest reading
            // "$5,113.64 + $511.36 = $5,625.00" here and being invoiced $6,187.50, because
            // the figure HubSpot grossed up by GST was a different figure from the one
            // this page added GST to. The guard is directional: it refuses only when the
            // invoice would come in ABOVE what was displayed.
            hasModuleSelection
            ? {}
            : { expectedUnitCents: Math.round(basePriceExGst * 100) }),
      // Forwarded when the member rate was unlocked via a company ID so the
      // Worker can re-validate the discount server-side.
      ...(memberCompanyId ? { memberCompanyId } : {}),
      ...(requiresTurnstile ? { turnstileToken } : {}),
      // Split by scope: the worker validates each against a different question set and
      // rejects a key sent in the wrong one by name. `attendeeAnswers` is the single-seat
      // shorthand's channel: the buyer IS the attendee here and the worker builds that
      // attendee itself, so there is nowhere else for a per-seat answer to travel.
      ...(() => {
        const split = splitAnswers(activeQuestions, answers)
        return {
          ...(Object.keys(split.answers).length > 0 ? { answers: split.answers } : {}),
          ...(Object.keys(split.attendeeAnswers).length > 0
            ? { attendeeAnswers: split.attendeeAnswers }
            : {})
        }
      })()
    }
    // Keyed on WHO is buying and WHAT, not on the event alone. The worker replays a
    // stored response for a repeated key, so an event-wide scope meant a buyer who timed
    // out, went back and entered a different email was handed the first booking's invoice
    // instead of a booking of their own (Ref 40 item 5).
    const idempotencyScope = reservationScope(eventId, {
      buyerEmail: purchaserEmail,
      ticketTypeId: hasModuleSelection ? undefined : ticketTypeId,
      selectedModules: hasModuleSelection
        ? moduleSelection.map((module) => ({
            eventId: module.worker_event_id || '',
            ticketTypeId: module.ticketTypeId
          }))
        : undefined
    })
    const idemKey = getIdempotencyKey(idempotencyScope)

    try {
      const res = hasModuleSelection
        ? await reserveSelectedModules(cfg, eventId, body, idemKey)
        : session.course_package_booking
          ? await reserveCoursePackage(cfg, eventId, body, idemKey)
          : await reserveSeat(cfg, eventId, body, idemKey)

      switch (res.status) {
        case 'reserved': {
          // Paid: an invoice is being created asynchronously. Poll for the link.
          setStatus('Preparing your invoice. This can take up to a minute - please don’t refresh.')
          const orderId = res.orderId || (res.pollUrl || '').split('/').pop() || ''
          if (!orderId) {
            clearIdempotencyKey(idempotencyScope)
            setError('Reserved, but we lost track of your order. Please contact support.')
            setSubmitting(false)
            return
          }
          // The wait is real (HubSpot creates the invoice asynchronously) so the screen
          // says so rather than freezing on one line for two minutes: Ref 40 item 6, a
          // buyer who has committed to paying and has no confirmation yet.
          const order = await pollOrder(cfg, orderId, {
            onAttempt: (attempt, _maxAttempts, elapsedMs) => {
              if (attempt > 1) {
                setStatus(
                  `Still preparing your invoice (${Math.round(elapsedMs / 1000)}s). Your place is held - please don’t refresh.`
                )
              }
            }
          })
          if (order.paymentUrl) {
            clearIdempotencyKey(idempotencyScope)
            saveCheckoutReceipt(receipt)
            pushDataLayer(`${analyticsPrefix}_reserved`, {
              registration_type: registrationType,
              item_id: session.id,
              item_name: session.course_name,
              course_id: session.id,
              course_name: session.course_name,
              is_member: isMember
            })
            // Deliberately NOT a redirect, and deliberately not window.open either.
            //
            // `window.location.href = paymentUrl` threw the buyer out of the site onto a
            // HubSpot-hosted invoice with no way back and no record on screen of what they
            // had just booked. Auto-opening a tab instead does not fix that: this runs in
            // pollOrder's async callback rather than a click handler, so every popup
            // blocker eats it and the buyer is left on a tunnel with no invoice at all.
            //
            // So the tunnel ends HERE, on its own page, and the buyer clicks through to
            // pay. A click is a user gesture, so the new tab is never blocked, and the
            // site stays underneath them.
            setStatus('')
            setInvoiceUrl(order.paymentUrl)
            setSubmitting(false)
            return
          }
          if (isReservationExpired(order)) {
            // The hold lapsed (or the order is gone) before payment completed.
            clearIdempotencyKey(idempotencyScope)
            setStatus('')
            setExpired(true)
          } else {
            // Timed out while settling - the hold stands; the invoice email follows.
            setStatus('Your place is held. We’ll email your invoice shortly.')
          }
          setSubmitting(false)
          return
        }

        case 'confirmed': {
          // Free registration - no payment step.
          clearIdempotencyKey(idempotencyScope)
          saveCheckoutReceipt(receipt)
          pushDataLayer(`${analyticsPrefix}_confirmed`, {
            registration_type: registrationType,
            item_id: session.id,
            item_name: session.course_name,
            course_id: session.id,
            course_name: session.course_name,
            is_member: isMember
          })
          setStatus('You’re registered. Redirecting…')
          window.location.href = confirmationRedirect
          return
        }

        case 'waitlisted': {
          clearIdempotencyKey(idempotencyScope)
          if (requiresTurnstile) resetTurnstile()
          setStatus(
            `This ${itemNoun} is full - you’ve been added to the waitlist. We’ll email you if a place opens up.`
          )
          setSubmitting(false)
          return
        }

        default: {
          // Ref 217: reserveSeat now classifies transport failures and non-JSON
          // responses instead of throwing, so the buyer is told which of the two
          // happened and the console carries the detail (HTTP status, raw body)
          // needed to trace it.
          //
          // Both are AMBIGUOUS: the POST may well have committed server-side and we
          // simply lost the answer. Keep the idempotency key so a retry replays the
          // Worker's stored response instead of minting a second hold, order and
          // invoice. Only a definite error shape from the Worker means nothing was
          // created and the key can be retired.
          const outcomeAmbiguous =
            res.status === TRANSPORT_ERROR_STATUS || res.status === SERVER_ERROR_STATUS

          if (outcomeAmbiguous) {
            console.error('[checkout] reserve failed', {
              reason: res.status,
              httpStatus: res.httpStatus,
              rawBody: res.rawBody,
              message: res.message,
              workerBaseUrl,
              eventId,
              ticketTypeId,
              selectedModuleEventIds: moduleSelection.map((module) => module.worker_event_id),
              isMember
            })
          } else {
            clearIdempotencyKey(idempotencyScope)
            if (requiresTurnstile) resetTurnstile()
          }

          if (isReservationExpired(res.status)) {
            setStatus('')
            setExpired(true)
          } else {
            // The worker refused over a question this form never rendered, which is the
            // one case where the buyer has to hear about the definitions at all - and
            // they hear it as the question, by name, from the side that enforces it.
            // Pull the set in again so the field they are being asked for is actually on
            // the page to answer.
            if (
              res.status === 'missing_required_answer' ||
              res.status === 'unknown_question'
            ) {
              void loadQuestions()
            }
            setError(friendlyReserveError(res))
          }
          setSubmitting(false)
        }
      }
    } catch (err) {
      // reserveSeat and pollOrder no longer throw, so reaching here means one of
      // our own success-path calls failed (receipt save, dataLayer push). Keep the
      // cause in the console rather than discarding it.
      console.error('[checkout] reserve failed', {
        reason: 'unexpected_client_error',
        workerBaseUrl,
        eventId,
        ticketTypeId,
        isMember,
        error: err
      })
      setError('Something went wrong completing your registration. Please try again.')
      if (requiresTurnstile) resetTurnstile()
      setSubmitting(false)
    }
  }

  if (invoiceUrl) {
    const browseUrl = getBrowseUrl(registrationType)
    const browseLabel = getBrowseLabel(registrationType)
    const browseLabelTitle = browseLabel.charAt(0).toUpperCase() + browseLabel.slice(1)
    return (
      <div className="wa-checkout-step">
        <div className="wa-checkout-held" role="status">
          <h2 className="wa-checkout-step__heading">Your place is held</h2>
          <p className="wa-checkout-held__lead">
            Pay your invoice to confirm your registration. Your place is held until the
            invoice falls due.
          </p>
        </div>

        <SessionSummaryCard session={session} />

        <div className="wa-checkout-payment-summary">
          <p className="wa-checkout-payment-summary__gst">
            GST: {formatCurrencyDollars(gstAmount)}
          </p>
          <p className="wa-checkout-payment-summary__total">
            Total: <strong>{formatCurrencyDollars(totalWithGst)}</strong> (inc. GST)
          </p>
        </div>

        <div className="wa-checkout-step__actions">
          <a className="wa-btn wa-btn--ghost" href={browseUrl}>
            {browseLabelTitle}
          </a>
          <a
            className="wa-btn wa-btn--primary wa-btn--lg"
            href={invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Pay invoice now
          </a>
        </div>
        <p className="wa-checkout-held__sub">
          The invoice opens in a new tab, so this page stays where it is. You can come back
          and pay from this link at any time while your place is held.
        </p>

        <p className="wa-checkout-support">
          Need help? <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      </div>
    )
  }

  if (expired) {
    const browseUrl = getBrowseUrl(registrationType)
    const browseLabel = getBrowseLabel(registrationType)
    const browseLabelTitle = browseLabel.charAt(0).toUpperCase() + browseLabel.slice(1)
    return (
      <div className="wa-checkout-step">
        <div className="wa-checkout-expired" role="alert">
          <h2 className="wa-checkout-step__heading">Your reservation has expired</h2>
          <p className="wa-checkout-expired__lead">{RESERVATION_EXPIRED_MESSAGE}</p>
          <p className="wa-checkout-expired__sub">
            Thanks for your patience - nothing was charged, and no place is being held.
          </p>
          <div className="wa-checkout-step__actions">
            <a className="wa-btn wa-btn--ghost" href={browseUrl}>
              {browseLabelTitle}
            </a>
            <button
              type="button"
              className="wa-btn wa-btn--primary wa-btn--lg"
              onClick={handleStartAgain}
            >
              Start again
            </button>
          </div>
        </div>
        <p className="wa-checkout-support">
          Need help? <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      </div>
    )
  }

  return (
    <div className="wa-checkout-step">
      <h2 className="wa-checkout-step__heading">Complete your registration</h2>
      <SessionSummaryCard session={session} />

      {!isConfigured ? (
        <p className="wa-checkout-notice wa-checkout-notice--warning" role="alert">
          Online booking isn&apos;t configured for this {itemNoun} yet. Please contact{' '}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      ) : (
        <form className="wa-checkout-event-engine" onSubmit={handleSubmit} noValidate>
          <div className="wa-checkout-payment-summary">
            <p className="wa-checkout-payment-summary__gst">
              GST: {formatCurrencyDollars(gstAmount)}
            </p>
            <p className="wa-checkout-payment-summary__total">
              Total: <strong>{formatCurrencyDollars(totalWithGst)}</strong> (inc. GST)
            </p>
            <p className="wa-checkout-payment-summary__note">
              We’ll hold your place and give you a secure link to pay your invoice.
            </p>
          </div>

          <RegistrationQuestions
            questions={questions}
            values={answers}
            missing={missingAnswers}
            disabled={submitting}
            idPrefix="wa-ct-q"
            onChange={(key, value) => {
              setAnswers((prev) => ({ ...prev, [key]: value }))
              setMissingAnswers((prev) => prev.filter((k) => k !== key))
            }}
          />

          {requiresTurnstile && (
            <div className="wa-checkout-turnstile">
              <p className="wa-checkout-turnstile__label">Security check</p>
              <div ref={turnstileContainerRef} className="wa-checkout-turnstile__widget" />
            </div>
          )}

          {status && (
            <p className="wa-checkout-notice" role="status" aria-live="polite">
              {status}
            </p>
          )}
          {error && (
            <p className="wa-checkout-error" role="alert">
              {error}
            </p>
          )}

          <div className="wa-checkout-step__actions">
            <button
              type="button"
              className="wa-btn wa-btn--ghost"
              onClick={onBack}
              disabled={submitting}
            >
              Back
            </button>
            <button
              type="submit"
              className="wa-btn wa-btn--primary wa-btn--lg"
              disabled={submitting || (requiresTurnstile && !turnstileReady)}
              aria-busy={submitting}
            >
              {submitting ? 'Processing…' : 'Complete registration →'}
            </button>
          </div>
        </form>
      )}

      <p className="wa-checkout-support">
        Need help? <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
    </div>
  )
}

// ─── Stripe payment form ─────────────────────────────────────────────────────

// Minimal Stripe type stubs (avoids adding @stripe/stripe-js as a hard dep)
interface StripeInstance {
  elements: () => StripeElements
  confirmCardPayment: (
    secret: string,
    data: { payment_method: { card: StripeElement } }
  ) => Promise<{
    error?: { message?: string }
    paymentIntent?: { status: string }
  }>
}

interface StripeElements {
  create: (type: 'card', options?: Record<string, unknown>) => StripeElement
}

interface StripeElement {
  mount: (container: HTMLElement) => void
  unmount: () => void
}

interface StripePaymentFormProps {
  session: CheckoutSession
  publishableKey: string
  receipt: CheckoutReceipt
  /** GST payable on top of the ex-GST price. Display only; the charge is `totalWithGst`. */
  gstAmount: number
  totalWithGst: number
  memberCompanyId?: string
  confirmationRedirect: string
  supportEmail: string
  onBack: () => void
}

function StripePaymentForm({
  session,
  publishableKey,
  receipt,
  gstAmount,
  totalWithGst,
  memberCompanyId,
  confirmationRedirect,
  supportEmail,
  onBack
}: StripePaymentFormProps): React.ReactElement {
  const cardMountRef = useRef<HTMLDivElement>(null)
  const stripeRef = useRef<StripeInstance | null>(null)
  const cardElementRef = useRef<StripeElement | null>(null)
  const [ready, setReady] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    function initStripeElements() {
      if (!window.Stripe) {
        setError('Payment provider unavailable. Please contact support.')
        return
      }
      if (!publishableKey) {
        setError('Payment not configured. Please contact support.')
        return
      }
      const stripe = window.Stripe(publishableKey)
      stripeRef.current = stripe
      const elements = stripe.elements()
      const card = elements.create('card', {
        style: { base: { fontSize: '16px', fontFamily: 'inherit', color: '#1a1a2e' } }
      })
      cardElementRef.current = card
      if (cardMountRef.current && mounted) {
        card.mount(cardMountRef.current)
        setReady(true)
      }
    }

    if (window.Stripe) {
      initStripeElements()
    } else {
      const script = document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.async = true
      script.onload = initStripeElements
      script.onerror = () => setError('Could not load payment provider. Please refresh.')
      document.head.appendChild(script)
    }

    return () => {
      mounted = false
      cardElementRef.current?.unmount()
    }
  }, [publishableKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripeRef.current || !cardElementRef.current) return
    setSubmitting(true)
    setError('')

    try {
      // POST to the backend to create a Stripe PaymentIntent.
      // Endpoint: POST /api/checkout/payment-intent
      // Expected response: { clientSecret: string }
      // This serverless function is provisioned by Ollie's backend setup.
      const intentResponse = await fetch('/api/checkout/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session.id,
          // INC GST. HubDB holds the ex-GST price and this checkout adds the tax, so
          // this is the buyer's total, not the HubDB figure. Whatever serves this
          // endpoint must charge it as given and must not add tax again.
          amount_cents: Math.round(totalWithGst * 100),
          course_name: session.course_name,
          purchaser_email: receipt.purchaser_email,
          purchaser_name: receipt.purchaser_name,
          is_member: receipt.is_member_price,
          // Forwarded so the backend can re-validate the member discount when
          // it was unlocked via a company ID (undefined for logged-in members).
          member_company_id: memberCompanyId
        })
      })

      if (!intentResponse.ok) {
        throw new Error('Could not initiate payment. Please try again or contact support.')
      }

      const { clientSecret } = (await intentResponse.json()) as { clientSecret: string }

      const { error: stripeError, paymentIntent } = await stripeRef.current.confirmCardPayment(
        clientSecret,
        {
          payment_method: { card: cardElementRef.current }
        }
      )

      if (stripeError) throw new Error(stripeError.message ?? 'Payment failed.')

      if (paymentIntent?.status === 'succeeded') {
        saveCheckoutReceipt(receipt)
        window.location.href = confirmationRedirect
      } else {
        setError(
          `Payment could not be completed (status: ${paymentIntent?.status ?? 'unknown'}). Please try again or contact support.`
        )
        setSubmitting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="wa-checkout-step">
      <h2 className="wa-checkout-step__heading">Enter payment details</h2>
      <SessionSummaryCard session={session} />
      <p className="wa-checkout-payment-summary__gst">
        GST: {formatCurrencyDollars(gstAmount)}
      </p>
      <p className="wa-checkout-payment-summary__total">
        Total: <strong>{formatCurrencyDollars(totalWithGst)}</strong> (inc. GST)
      </p>

      <form className="wa-checkout-stripe-form" onSubmit={handleSubmit} noValidate>
        <div className="wa-field">
          <label htmlFor="wa-ct-card">Card details</label>
          <div
            id="wa-ct-card"
            className="wa-checkout-card-element"
            ref={cardMountRef}
            aria-label="Card details"
          >
            {!ready && !error && (
              <span className="wa-checkout-card-element__loading">Loading payment form…</span>
            )}
          </div>
        </div>

        {error && (
          <p className="wa-checkout-error" role="alert">
            {error}
          </p>
        )}

        <div className="wa-checkout-step__actions">
          <button
            type="button"
            className="wa-btn wa-btn--ghost"
            onClick={onBack}
            disabled={submitting}
          >
            Back
          </button>
          <button
            type="submit"
            className="wa-btn wa-btn--primary wa-btn--lg"
            disabled={submitting || !ready}
            aria-busy={submitting}
          >
            {submitting ? 'Processing…' : `Pay ${formatCurrencyDollars(totalWithGst)}`}
          </button>
        </div>
      </form>

      <p className="wa-checkout-support">
        Need help? <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
    </div>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

export function CheckoutTunnel({
  session,
  show_confirmation,
  requested_item_type,
  member_is_logged_in,
  member_is_member,
  member_tier,
  member_company_tier,
  member_status,
  member_name,
  member_email,
  member_company_id,
  step_labels,
  guest_checkout_allowed,
  membership_offer_post_purchase: _offerPostPurchase,
  membership_offer_message: _offerMessage,
  payment_provider,
  stripe_publishable_key,
  turnstile_site_key,
  worker_base_url,
  worker_portal_id,
  confirmation_redirect,
  support_email,
  portal_id
}: CheckoutTunnelProps): React.ReactElement {
  const [step, setStep] = useState<CheckoutStep>(1)
  const [guest, setGuest] = useState<GuestDetails | null>(null)
  // A member company validated by entering a company ID - for guests / employees
  // of a member company who aren't logged in as an entitled member themselves.
  const [appliedCompany, setAppliedCompany] = useState<MemberCompany | null>(null)
  const requestedType = requested_item_type === 'event' ? 'event' : 'course'
  const registrationType = session ? getRegistrationType(session) : requestedType

  // Live seats for everything this checkout would actually book (migration 0038 also
  // reports a closed or paused event). Null until it lands, and null forever if it fails:
  // Step 1 keeps rendering what HubDB said, and the Worker still has the last word at
  // reserve.
  //
  // A selected-module checkout books SEVERAL events in one go, so every one of them is
  // read: a bundle whose third module has closed cannot be booked, and finding that out at
  // reserve after four screens is the thing this read exists to prevent.
  const checkoutEventIds = useMemo(() => {
    if (!session) return EMPTY_EVENT_IDS
    const ids = [
      session.worker_event_id,
      ...selectedModulesFor(session).map((module) => module.worker_event_id)
    ].filter((id): id is string => Boolean(id))
    return ids.length > 0 ? ids : EMPTY_EVENT_IDS
  }, [session])

  const liveAvailability = useLiveAvailability(
    worker_base_url,
    worker_portal_id || portal_id,
    checkoutEventIds
  )
  const sessionAvailability = session?.worker_event_id
    ? (liveAvailability[session.worker_event_id] ?? null)
    : null

  const isLoggedIn = Boolean(member_is_logged_in)
  // Defect 126 / 213: never invent the literal "Member" when HubL sends an empty
  // tier. normaliseMemberPriceTier('Member') matches the "member" substring and
  // resolves to `individual` (price_individual), while '' resolves to `member`
  // (price_member). The portal and /courses/ keep empty tiers empty - checkout
  // must too, or an entitled visitor with scrubbed/empty CRM tier sees the full
  // price here while the portal still quotes the member rate.
  const memberDisplayTier = hasValue(member_tier) ? member_tier : ''
  const companyDisplayTier = hasValue(member_company_tier) ? member_company_tier : ''
  const pricingHandoff = readCheckoutPricingHandoff(session?.id)
  const handoffDisplayTier = pricingHandoff?.isMember ? pricingHandoff.memberTier : ''
  const hasForwardedMemberTier =
    isLoggedIn &&
    !isInactiveMemberStatus(member_status) &&
    hasRealMemberTierSignal(memberDisplayTier, companyDisplayTier)
  const useMemberPricing = Boolean(
    (isLoggedIn && (member_is_member || hasForwardedMemberTier)) || pricingHandoff?.isMember
  )

  // Pricing applies when the buyer is an entitled logged-in member OR has
  // validated a member company ID at checkout. The tier drives the tiered
  // rate via resolveMemberPrice and is forwarded to the payment provider.
  //
  // Tier precedence (defect 126): union contact + company + company-ID unlock
  // and keep the strongest. A corporate Gold employee who also holds a weaker
  // Individual membership must still be quoted Gold - the old "contact wins
  // whenever it is non-empty" rule charged the full / individual rate while
  // the portal (company-aware) showed the discounted member price.
  const effectiveIsMember = useMemberPricing || Boolean(appliedCompany)
  const effectiveMemberTier = useMemberPricing
    ? pickBestMemberTier(
        memberDisplayTier,
        companyDisplayTier,
        handoffDisplayTier,
        appliedCompany?.tier
      )
    : appliedCompany?.tier || ''

  // Logged-in members skip the Identify step (step 2) in both directions.
  // The skip lives in the navigation callbacks - not a render-time effect - so
  // going Back from step 3 lands on step 1 instead of being bounced forward.
  const goNext = useCallback(() => {
    setStep((s) => {
      const next = Math.min(s + 1, 4)
      return (next === 2 && isLoggedIn ? 3 : next) as CheckoutStep
    })
  }, [isLoggedIn])
  const goBack = useCallback(() => {
    setStep((s) => {
      const prev = Math.max(s - 1, 1)
      return (prev === 2 && isLoggedIn ? 1 : prev) as CheckoutStep
    })
  }, [isLoggedIn])
  // Step-indicator jumps honour the same skip. A logged-in member can only reach
  // the Identify chip from a later step, so route a jump there back to step 1.
  const goToStep = useCallback(
    (target: CheckoutStep) => {
      setStep((target === 2 && isLoggedIn ? 1 : target) as CheckoutStep)
    },
    [isLoggedIn]
  )

  const stepsPortalTarget =
    typeof document !== 'undefined' ? document.getElementById('wa-checkout-steps') : null

  const labels: CheckoutTunnelProps['step_labels'] = {
    step_1:
      registrationType === 'event' ? 'Confirm event' : (step_labels?.step_1 ?? 'Confirm session'),
    step_2: step_labels?.step_2 ?? 'Your details',
    step_3: step_labels?.step_3 ?? 'Pricing',
    step_4: step_labels?.step_4 ?? 'Payment'
  }

  if (show_confirmation) {
    return (
      <CheckoutConfirmation
        heading="You're registered!"
        body="<p>We've sent a confirmation email to your inbox with the registration details.</p>"
        show_calendar_buttons
        show_zoom_link
        next_step_cta_label="Back to dashboard"
        next_step_cta_link="/portal/"
      />
    )
  }

  if (!session) {
    const itemNoun = getItemNoun(requestedType)
    const browseUrl = getBrowseUrl(requestedType)
    const browseCopy =
      requestedType === 'event' ? 'browse available events' : 'browse available courses'
    return (
      <div className="wa-checkout-tunnel">
        {/* Same 760px column as every other step (`__body container`), so the copy
            lines up with the heading instead of running the full 1260px container.
            The page already supplies an h1 (checkout.html), so this is an h2. */}
        <div className="wa-checkout-tunnel__body container">
          <div className="wa-checkout-error-state">
            <h2>Thank you</h2>
            <p>
              We couldn&apos;t match this checkout link to a current {itemNoun}. If you&apos;ve
              already registered, please check your email for your confirmation details. Otherwise,{' '}
              <a href={browseUrl}>{browseCopy}</a> or contact{' '}
              <a href={`mailto:${support_email}`}>{support_email}</a> and we&apos;ll help you with
              the next step.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wa-checkout-tunnel">
      {stepsPortalTarget &&
        createPortal(
          <StepIndicator currentStep={step} labels={labels} onStepSelect={goToStep} />,
          stepsPortalTarget
        )}

      <div className="wa-checkout-tunnel__body container">
        {step === 1 && (
          <Step1ConfirmSession
            session={session}
            live={sessionAvailability}
            // The ticket this buyer would reserve. Step 1 judges that type, not the event
            // as a whole: a paused member ticket on an otherwise-open event would otherwise
            // let a member walk every step and be refused at reserve.
            ticketTypeId={ticketTypeForSession(session, effectiveIsMember)}
            // Every module this checkout would also book, each with the type it would book
            // it on. One unbookable module blocks the bundle.
            modules={selectedModuleLineItems(session, effectiveIsMember, effectiveMemberTier).map(
              (module) => ({
                live: module.worker_event_id
                  ? (liveAvailability[module.worker_event_id] ?? null)
                  : null,
                name: module.course_name,
                ticketTypeId: module.ticketTypeId,
                startDate: module.start_date
              })
            )}
            onNext={goNext}
          />
        )}

        {step === 2 && (
          <Step2Identify
            guestCheckoutAllowed={guest_checkout_allowed}
            onNext={(g) => {
              setGuest(g)
              goNext()
            }}
            onBack={goBack}
          />
        )}

        {step === 3 && (
          <Step3DiscountPreview
            session={session}
            isMember={effectiveIsMember}
            memberTier={effectiveMemberTier}
            portalId={portal_id}
            alreadyMemberByLogin={useMemberPricing}
            appliedCompany={appliedCompany}
            onApplyCompany={setAppliedCompany}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === 4 && (
          <Step4Payment
            session={session}
            isMember={effectiveIsMember}
            memberTier={effectiveMemberTier}
            memberCompanyId={appliedCompany?.companyId || member_company_id || undefined}
            guest={guest}
            memberName={member_name}
            memberEmail={member_email}
            paymentProvider={payment_provider}
            stripePublishableKey={stripe_publishable_key}
            turnstileSiteKey={turnstile_site_key}
            workerBaseUrl={worker_base_url}
            workerPortalId={worker_portal_id}
            confirmationRedirect={confirmation_redirect}
            supportEmail={support_email}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  )
}
