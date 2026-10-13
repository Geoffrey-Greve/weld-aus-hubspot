/**
 * Event Engine (Cloudflare Worker) client - shared booking contract.
 *
 * Single source of truth for the Worker's 3 public endpoints, ported from the
 * proven vanilla widget at
 * theme/modules/event-registration.module/module.js. The events page uses that
 * vanilla module directly; the React training checkout (checkout-tunnel) consumes
 * this typed helper.
 *
 *   GET  /api/v1/events/{slug}/availability   (header X-Portal-Id)
 *   POST /api/v1/events/{slug}/reserve        (X-Portal-Id, Idempotency-Key)
 *   GET  /api/v1/orders/{id}                  (X-Portal-Id, polled until paymentUrl)
 *
 * The Worker keys events by slug and is authoritative for price/availability -
 * never trust client-side seat counts.
 */

import { type SessionStatus, hubdbStatusToSessionStatus } from '../status/sessionStatus'

// ---------------------------------------------------------------------------
// Config + types
// ---------------------------------------------------------------------------

export interface EventEngineConfig {
  /** Base URL of the Worker, e.g. https://event-engine.<acct>.workers.dev. */
  workerBaseUrl: string
  /** Sent as the X-Portal-Id header. */
  portalId: string
}

export interface ReserveBuyer {
  name: string
  email: string
  /** Optional ABN for company tax invoices (digits only). */
  abn?: string
}

export interface ReserveBody {
  buyer: ReserveBuyer
  /** Single-seat path (one ticket type). */
  ticketTypeId?: string
  /** Selected child modules for one parent-course checkout. */
  selectedModules?: Array<{
    eventId: string
    ticketTypeId: string
    expectedUnitCents?: number
  }>
  /** Client-displayed combined total for selected modules, in cents. */
  expectedTotalCents?: number
  /**
   * Group path - one entry per attendee. `hubspotContactId` binds the seat to an
   * existing Contact rather than matching on email, which corporate bulk booking
   * relies on: the admin books employees whose Contact records already exist.
   */
  attendees?: Array<{
    name: string
    email: string
    ticketTypeId: string
    hubspotContactId?: string
  }>
  /** Visitor's resolved member tier, used by Event Engine to validate tier pricing. */
  memberTier?: string
  /**
   * Member company ID entered at checkout to unlock member pricing as a guest
   * (matched against the members directory's hubspot_company_id). Event Engine
   * must re-validate this server-side before honouring the discount.
   */
  memberCompanyId?: string
  /** Client-displayed unit price in cents. Event Engine must validate this server-side. */
  expectedUnitCents?: number
  /**
   * The displayed unit price in cents when we want it CHECKED but not ENFORCED.
   *
   * `expectedUnitCents` is sent only for a buyer resolved as a member, so a guest had
   * no price guard at all: the page could display one amount and the invoice carry
   * another with nothing noticing. Enabling the enforcing guard for guests in one step
   * could start refusing bookings that work today, over a disagreement nobody has
   * measured — so guests send this, the worker logs `price_drift` with
   * `enforced: false`, and once those logs are clean guests move onto
   * `expectedUnitCents`.
   */
  quotedUnitCents?: number
  /** Cloudflare Turnstile token for public zero-total registrations. */
  turnstileToken?: string
  /**
   * Answers to the event's ORDER-scoped questions (a purchase order number), asked once
   * for the whole booking.
   */
  answers?: QuestionAnswers
  /**
   * Answers to the event's ATTENDEE-scoped questions (dietary requirements) on the
   * single-seat path, where the buyer takes the seat themselves. When `attendees` is sent,
   * each entry carries its own instead.
   */
  attendeeAnswers?: QuestionAnswers
}

/**
 * Reserve outcomes. `reserved` is the paid path (an invoice is being created
 * asynchronously - poll the order for the paymentUrl). `confirmed` is the free
 * path. `waitlisted` means the event was full. Any other `status` is an error
 * shape (members_only, membership_unverified, offer_expired, …).
 */
export interface ReserveResponse {
  status?: string
  orderId?: string
  pollUrl?: string
  message?: string
  /** HTTP status, set only on the synthetic failure shapes below. */
  httpStatus?: number
  /** Truncated raw body when it wasn't JSON. For logging only - never shown to a buyer. */
  rawBody?: string
}

/**
 * Synthetic statuses this client produces when the Worker's answer isn't a usable
 * error shape. They are deliberately distinct so a buyer (and the console) can tell
 * "we never reached the service" from "the service failed".
 *
 * `transport_error` - fetch itself rejected: offline, DNS, TLS, or a CORS rejection.
 *                     The browser never tells us which, so the copy stays broad.
 * `server_error`    - we got an HTTP response whose body wasn't JSON. Hono's default
 *                     error handler answers with plain-text "Internal Server Error",
 *                     so this is the shape *every* unhandled Worker exception takes.
 */
export const TRANSPORT_ERROR_STATUS = 'transport_error'
export const SERVER_ERROR_STATUS = 'server_error'

export interface OrderStatus {
  status?: string
  paymentUrl?: string
}

/** One public ticket type in the availability response. */
export interface AvailabilityTicketType {
  ticketTypeId: string
  /** Seats left, or null when the type is uncapped. */
  available: number | null
  soldOut: boolean
  /** Migration 0038 — this type alone taken off sale. */
  salesPaused?: boolean
  /** Migration 0038 — not sold out, not paused, not closed. The field to gate a CTA on. */
  bookable?: boolean
  waitlistAvailable: boolean
}

export interface AvailabilityResponse {
  status: string
  eventFull: boolean
  /** Migration 0038 — the cutoff has passed (defaults to the session start). */
  registrationClosed?: boolean
  /** Migration 0038 — a human stopped sales. */
  salesPaused?: boolean
  registrationClosesAt?: string
  bookable?: boolean
  ticketTypes: AvailabilityTicketType[]
}

/**
 * Why a session cannot be booked, in the order a buyer needs to hear it.
 *
 * Declared in `@shared/status/sessionStatus` and re-exported here, because the HubDB-only
 * surfaces (the timetable, the command centre) need the same vocabulary without importing a
 * Worker client they never call. Kept as an alias so every existing `LiveSessionStatus`
 * import keeps working.
 */
export type LiveSessionStatus = SessionStatus

/** A question definition as the worker's public endpoint returns it. */
export interface RegistrationQuestion {
  id: string
  key: string
  label: string
  fieldType: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'phone'
  /** Present for select/multiselect only. */
  options: Array<{ value: string; label: string }> | null
  required: boolean
  /** 'attendee' = once per seat (dietary); 'order' = once per booking (a PO number). */
  scope: 'attendee' | 'order'
  helpText: string | null
  sortOrder: number
  /** The HubSpot contact property this answer round-trips through, if any. */
  hsProperty: string | null
  /** Whether the stored value may be offered back as the default next time. */
  prefill: boolean
}

/**
 * Answers keyed by question `key`. A multiselect joins its values with ';' — HubSpot's own
 * encoding for a multiple-checkbox property, so the worker's write-back is a copy rather
 * than a re-serialisation that has to agree with HubSpot's parser.
 */
export type QuestionAnswers = Record<string, string>

export interface LiveSessionState {
  status: LiveSessionStatus
  seatsRemaining: number | null
  /** 'worker' when a live read decided this, 'hubdb' when the row did. */
  source: 'worker' | 'hubdb'
}

// ---------------------------------------------------------------------------
// Reservation expiry
// ---------------------------------------------------------------------------

/**
 * The Event Engine holds a reserved ticket for a short window (~15 minutes).
 * When that hold lapses - the buyer waited too long on payment, the poll ran
 * past the hold, or they returned to a stale checkout - the Worker reports it
 * via an expiry/not-found status (reserve response or order lookup). This is
 * the single buyer-facing copy for that outcome.
 */
export const RESERVATION_EXPIRED_MESSAGE =
  'Your reservation has expired. We hold your place for about 15 minutes - you haven’t been charged. Please start again to book.'

/**
 * True when a reserve/order `status` (or an OrderStatus object) signals that the
 * reservation hold has lapsed or the order no longer exists. Defensive and
 * case-insensitive: covers the documented shapes plus likely synonyms so an
 * unmapped-but-expiry-ish status still routes to the friendly expired screen
 * rather than leaking a raw error.
 */
export function isReservationExpired(
  input: string | OrderStatus | ReserveResponse | null | undefined
): boolean {
  if (!input) return false
  const status = typeof input === 'string' ? input : input.status
  if (!status) return false
  const key = status.toLowerCase().replace(/[\s-]+/g, '_')
  return [
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
  ].includes(key)
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Reuse one Idempotency-Key across retries of the SAME logical submission, so a
 * network retry can't double-book. Cleared on a terminal outcome (see
 * clearIdempotencyKey) so the next genuine attempt gets a fresh key.
 */
export function getIdempotencyKey(eventId: string): string {
  const storageKey = `evt-idem:${eventId}`
  try {
    const stored = sessionStorage.getItem(storageKey)
    if (stored) return stored
    const key = newIdempotencyKey()
    sessionStorage.setItem(storageKey, key)
    return key
  } catch {
    // sessionStorage unavailable (private mode) - still return a usable key.
    return newIdempotencyKey()
  }
}

export function clearIdempotencyKey(eventId: string): void {
  try {
    sessionStorage.removeItem(`evt-idem:${eventId}`)
  } catch {
    // non-fatal
  }
}

/** FNV-1a, hex. Short and stable; nothing here is a security boundary. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/**
 * The storage scope for one submission's Idempotency-Key.
 *
 * The key exists so a retry of the SAME submission cannot double-book, and the worker
 * honours it by REPLAYING the stored response verbatim. That makes the scope the whole
 * question: scoped to the event alone (which it was until Ref 40 item 5), a buyer who
 * timed out on "your place is held", went back, typed a different email and submitted
 * again was replayed the FIRST booking - their new details discarded, and the first
 * order's invoice handed back to them. That is the report's "guest checkout with an
 * existing email attaches to an existing invoice", from the other end.
 *
 * So the scope carries what makes a booking a DIFFERENT booking rather than a retry of
 * this one: who is buying, and what they are buying. Deliberately not the buyer's name,
 * their answers, or the Turnstile token - correcting a typo or a dietary note and
 * resubmitting is the same booking, and minting a fresh key there would take a second
 * seat for the same person.
 */
export function reservationScope(
  eventId: string,
  identity: {
    buyerEmail?: string
    ticketTypeId?: string
    selectedModules?: Array<{ eventId: string; ticketTypeId: string }>
  }
): string {
  const parts = [
    eventId,
    (identity.buyerEmail ?? '').trim().toLowerCase(),
    identity.ticketTypeId ?? '',
    (identity.selectedModules ?? [])
      .map((module) => `${module.eventId}:${module.ticketTypeId}`)
      .join(',')
  ]
  return `${eventId}:${fingerprint(parts.join('|'))}`
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

function base(cfg: EventEngineConfig): string {
  return cfg.workerBaseUrl.replace(/\/$/, '')
}

function headers(cfg: EventEngineConfig, extra?: Record<string, string>): HeadersInit {
  return { 'X-Portal-Id': cfg.portalId, ...(extra ?? {}) }
}

/**
 * Live seat availability for one session, straight from the Worker's Durable Object.
 *
 * This is the read the course pages were missing: they rendered `seats_remaining`, a
 * number a person types into HubDB by hand, so a sold-out or closed session kept
 * advertising places until someone remembered to edit the row.
 *
 * ADVISORY, and deliberately so. Every caller falls back to the HubDB row when this
 * returns null, because the alternative — a CDN hiccup taking a sellable course off the
 * website — is worse than a stale seat count. The Worker is still the authority at
 * reserve time, so an optimistic page can only ever send someone to a checkout that tells
 * them the truth; it can never oversell.
 */
export async function fetchAvailability(
  cfg: EventEngineConfig,
  eventId: string
): Promise<AvailabilityResponse | null> {
  const url = `${base(cfg)}/api/v1/events/${encodeURIComponent(eventId)}/availability`
  try {
    const response = await fetch(url, { headers: headers(cfg), credentials: 'omit' })
    if (!response.ok) return null
    const data = (await response.json()) as AvailabilityResponse
    return data && data.status === 'ok' ? data : null
  } catch {
    return null
  }
}

/**
 * Today as a local `YYYY-MM-DD` string.
 *
 * Built out of the LOCAL calendar fields rather than `toISOString().slice(0, 10)`,
 * which is the UTC date: at +09:30 that is yesterday until 9:30am, and a training
 * course starting at 9am with arrivals from 8:30 is the ordinary shape of Weld's
 * timetable. The same reasoning the worker's `timezone.ts` applies to an attendance
 * date (events-engine CLAUDE.md, "A date is a LOCAL fact").
 */
function localDateKey(now: Date): string {
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * True when a session's start date is before today.
 *
 * `YYYY-MM-DD` compares correctly as a string, so no Date is parsed out of the row: a
 * bare date has no time and no zone, and giving it one is how it moves a day. Anything
 * that is not a leading `YYYY-MM-DD` (blank, `null`, a malformed import) reads as NOT
 * past, because the only safe answer to "we cannot tell when this runs" is to keep
 * selling it and let the Worker refuse at reserve.
 */
export function hasStartDatePassed(
  startDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  const key = String(startDate ?? '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  return key < localDateKey(now)
}

/**
 * Fold a live availability read over what HubDB says about a session.
 *
 * HubDB is the baseline — it is all a non-Event-Engine row has — and a successful read
 * refines it. `null` (no worker id, or the read failed) leaves the row exactly as the CMS
 * rendered it.
 *
 * THE WORKER MAY ONLY NARROW AVAILABILITY, NEVER WIDEN IT. Three things in the row are
 * editorial decisions a person made, and none of them is the Worker's to reverse:
 *
 *   `cancelled` — the Worker has no concept of a cancelled session at all.
 *   `sold_out`  — staff close a session by hand for reasons the seat count cannot see: the
 *                 trainer is sick, the room shrank, the last two places are being held for
 *                 an apprentice intake. Before this, a live read saying "seats available"
 *                 silently overrode that and the page kept selling.
 *   `closed`    — (Ref 74c) staff shut registrations on an upcoming course. The Worker has
 *                 its own cutoff (`registrationClosed`, migration 0038) and they resolve to
 *                 the same status, but they are independent: an event with no cutoff set, or
 *                 a course with no `worker_event_id` at all, still has to honour the column.
 *                 A live read saying "seats available" must NEVER re-open a closed row.
 *
 * The cost of that rule, accepted deliberately: a refund that frees a seat no longer
 * reopens a hand-closed session. Someone has to clear the status column. That is the right
 * way round, because a page that sells a seat staff have withdrawn is worse than one that
 * needs a human to reopen it, and `sales_paused` on the Worker side is the reversible
 * control for the cases where the seat count really is the whole story.
 *
 * `seats_remaining` is NOT an editorial decision. It is a hand-typed number that goes
 * stale the moment a seat sells, and an import that wrote 0 into every blank cell would
 * otherwise close a whole timetable permanently. So a sold-out derived from it stays soft:
 * the Worker overrides it, exactly as before.
 *
 * `startDate` is the other derived fact, and it is soft for the same reason. A session
 * whose start date has passed is closed: that is the Worker's own default cutoff
 * (`registration_closes_at` NULL resolves to `starts_at`, migration 0038), so this only
 * says the same thing one page earlier, for the rows the Worker never sees. It is NOT
 * editorial, so a live read outranks it in both directions - a tenant who deliberately
 * left a walk-up window open an hour past the start still sells, because the Worker says
 * so and the Worker is the one holding that column.
 *
 * Nothing here filters a session OUT of a listing. The page still renders it, with the
 * sentence that fits; hiding a row would leave a buyer who followed a link to it staring
 * at a page that never mentions the thing they clicked.
 */
export function applyAvailability(
  hubdb: {
    /** The row's own `status` column: the editorial decision, not a derived value. */
    status: string
    /** `seats_remaining`, or null when the column is blank. */
    seatsRemaining: number | null
    /**
     * Whether `seats_remaining` actually holds a number. A blank column is not zero, and
     * the caller is the only side that can tell the difference — HubL renders both as
     * nothing. Absent means "not set", which is the safe reading.
     */
    seatsRemainingIsSet?: boolean
    /**
     * The session's `start_date` as `YYYY-MM-DD`. Absent or unparseable means "we cannot
     * tell", which reads as still selling - see `hasStartDatePassed`.
     */
    startDate?: string | null
  },
  live: AvailabilityResponse | null,
  /**
   * The ticket type this buyer would actually reserve, when there is one.
   *
   * Checkout books ONE type (member or public), so the event being open is not enough: a
   * paused member ticket on an otherwise-open event would let a member walk every step of
   * the tunnel and be refused at reserve. A listing card passes nothing and is judged on
   * the event as a whole, which is right — it is not choosing a ticket yet.
   */
  ticketTypeId?: string
): LiveSessionState {
  // Editorial decisions, settled before the Worker is asked anything. Read through the
  // shared mapper rather than comparing raw strings, so every spelling HubL can produce
  // ("Sold Out", "sold_out", "Closed") lands on the same status.
  const editorial = hubdbStatusToSessionStatus(hubdb.status)
  if (editorial !== 'available') {
    return { status: editorial, seatsRemaining: hubdb.seatsRemaining, source: 'hubdb' }
  }

  // The soft, derived sold-out: only ever consulted when there is no better answer.
  const seatsRemainingSaysFull =
    hubdb.seatsRemainingIsSet === true &&
    hubdb.seatsRemaining !== null &&
    hubdb.seatsRemaining <= 0

  if (!live) {
    // A session that has already begun is closed, and says so rather than "sold out": a
    // course that ran last month has no waitlist to invite anyone onto. It outranks the
    // seats-derived sell-out for the same reason - the seat count on a finished course is
    // not a fact about anything a buyer can do now.
    const status: LiveSessionStatus = hasStartDatePassed(hubdb.startDate)
      ? 'registration_closed'
      : seatsRemainingSaysFull
        ? 'sold_out'
        : 'available'
    return {
      status,
      seatsRemaining: hubdb.seatsRemaining,
      source: 'hubdb'
    }
  }

  const publicTicketTypes = live.ticketTypes ?? []

  // Seats are summed across the public ticket types the Worker returned. An uncapped type
  // reports null, and null is not zero: one uncapped type means the session as a whole has
  // no meaningful number to show, so no "only N left" nudge is rendered at all.
  let seatsRemaining: number | null = 0
  for (const ticket of publicTicketTypes) {
    if (ticket.available === null || ticket.available === undefined) {
      seatsRemaining = null
      break
    }
    seatsRemaining = (seatsRemaining ?? 0) + Math.max(0, ticket.available)
  }

  // The one type being booked, when the caller named one and the worker returned it. A
  // named type the worker does not list is not treated as paused: it may simply be an
  // internal or import ticket the public read filters out, and guessing "closed" there
  // would block a booking the worker would have accepted.
  const selected = ticketTypeId
    ? publicTicketTypes.find((t) => t.ticketTypeId === ticketTypeId)
    : undefined

  // An empty list is the one case `every()` gets dangerously wrong: `[].every()` is true,
  // so a session whose ticket types have not been added yet — or whose only types are
  // internal or CAMS imports, which the public read filters out — used to read as sold
  // out. Checked AFTER the three signals above, because a paused, closed or genuinely
  // full event deserves its own sentence whatever it has left to sell.
  const status: LiveSessionStatus = live.salesPaused || selected?.salesPaused
    ? 'sales_paused'
    : live.registrationClosed
      ? 'registration_closed'
      : live.eventFull
        ? 'sold_out'
        : publicTicketTypes.length === 0
          ? 'not_bookable'
          : (selected ? selected.soldOut : publicTicketTypes.every((t) => t.soldOut))
            ? 'sold_out'
            : 'available'

  // When a type is named, the count the buyer is shown is that type's own seats — summing
  // across types would promise a member seats that only exist on the public ticket.
  const remaining =
    selected && selected.available !== null && selected.available !== undefined
      ? Math.max(0, selected.available)
      : selected
        ? null
        : seatsRemaining

  return { status, seatsRemaining: status === 'not_bookable' ? null : remaining, source: 'worker' }
}

/**
 * The event's custom registration questions (Phase 2.3).
 *
 * DEFINITIONS ONLY. The worker deliberately hands an unauthenticated caller nobody's
 * answers — prefill is the CMS's job, because the CMS is the side that knows which logged-in
 * visitor it is rendering for. `hsProperty` names the contact property to prefill from.
 *
 * Returns `null` on failure, which is NOT the same as `[]`: an event that asks nothing is
 * a complete answer, and a failed read is the caller's cue to try again before it submits.
 * Neither is a sentence for the buyer. Nothing here is public-facing copy - the checkout
 * retries silently and books regardless, and the worker, which is the gate, names the
 * question if one really was required.
 */
export async function fetchEventQuestions(
  cfg: EventEngineConfig,
  eventId: string
): Promise<RegistrationQuestion[] | null> {
  const url = `${base(cfg)}/api/v1/events/${encodeURIComponent(eventId)}/questions`
  try {
    const response = await fetch(url, { headers: headers(cfg), credentials: 'omit' })
    if (!response.ok) return null
    const data = (await response.json()) as { questions?: RegistrationQuestion[] }
    // A 200 with no `questions` array is a shape this client does not understand, not an
    // event that asks nothing — treat it as unread rather than as empty.
    return Array.isArray(data?.questions) ? data.questions : null
  } catch {
    return null
  }
}

/**
 * Split answers into the two fields reserve expects.
 *
 * The scopes are validated against different question sets and a key in the wrong one is
 * rejected by name, so this cannot be one bag. `attendeeAnswers` is the single-seat
 * shorthand's channel — on that path the buyer is the attendee and the worker builds the
 * attendee itself, so there is nowhere else for a per-seat answer to travel.
 */
export function splitAnswers(
  questions: RegistrationQuestion[],
  values: QuestionAnswers
): { answers: QuestionAnswers; attendeeAnswers: QuestionAnswers } {
  const answers: QuestionAnswers = {}
  const attendeeAnswers: QuestionAnswers = {}
  for (const question of questions) {
    const value = values[question.key]
    if (value === undefined || value === '') continue
    if (question.scope === 'order') answers[question.key] = value
    else attendeeAnswers[question.key] = value
  }
  return { answers, attendeeAnswers }
}

/**
 * The questions a buyer has left unanswered, by `key`.
 *
 * Client-side validation is a courtesy, never the gate: the brief is explicit that
 * `required` is enforced in the worker, because this form is a module a marketer can edit
 * and the staff and corporate booking paths never render it at all.
 */
export function missingRequiredAnswers(
  questions: RegistrationQuestion[],
  values: QuestionAnswers
): string[] {
  return questions
    .filter((question) => question.required)
    .filter((question) => {
      const value = values[question.key]
      return value === undefined || value === null || String(value).trim() === ''
    })
    .map((question) => question.key)
}

/**
 * POST a reservation. Branch on the returned `status` (the Worker uses 4xx for
 * error shapes but still returns a JSON body, so we parse regardless of ok).
 *
 * Never throws. This used to `await response.json()` unconditionally, so a Worker
 * 5xx with a plain-text body - which is exactly what an unhandled Worker exception
 * produces - raised a SyntaxError that the caller could only report as one generic
 * sentence. Every failure now comes back as a classified status instead.
 *
 * @param idempotencyKey Stable key for this logical submission (see getIdempotencyKey).
 */
export async function reserveSeat(
  cfg: EventEngineConfig,
  eventId: string,
  body: ReserveBody,
  idempotencyKey: string
): Promise<ReserveResponse> {
  const url = `${base(cfg)}/api/v1/events/${encodeURIComponent(eventId)}/reserve`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(cfg, {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      }),
      credentials: 'omit',
      body: JSON.stringify(body)
    })
  } catch (err) {
    return {
      status: TRANSPORT_ERROR_STATUS,
      message: err instanceof Error ? err.message : String(err)
    }
  }

  const text = await response.text().catch(() => '')
  try {
    return JSON.parse(text) as ReserveResponse
  } catch {
    return {
      status: SERVER_ERROR_STATUS,
      httpStatus: response.status,
      rawBody: text.slice(0, 500)
    }
  }
}

/** Reserve a paid parent course and every required child module as one package. */
export async function reserveCoursePackage(
  cfg: EventEngineConfig,
  eventId: string,
  body: ReserveBody,
  idempotencyKey: string
): Promise<ReserveResponse> {
  const url = `${base(cfg)}/api/v1/events/${encodeURIComponent(eventId)}/reserve-course-package`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(cfg, { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
      credentials: 'omit',
      body: JSON.stringify(body)
    })
  } catch (err) {
    return { status: TRANSPORT_ERROR_STATUS, message: err instanceof Error ? err.message : String(err) }
  }

  const text = await response.text().catch(() => '')
  try {
    return JSON.parse(text) as ReserveResponse
  } catch {
    return { status: SERVER_ERROR_STATUS, httpStatus: response.status, rawBody: text.slice(0, 500) }
  }
}

/** Reserve an arbitrary subset of child course modules as one order/invoice. */
export async function reserveSelectedModules(
  cfg: EventEngineConfig,
  eventId: string,
  body: ReserveBody,
  idempotencyKey: string
): Promise<ReserveResponse> {
  const url = `${base(cfg)}/api/v1/events/${encodeURIComponent(eventId)}/reserve-selected-modules`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(cfg, { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
      credentials: 'omit',
      body: JSON.stringify(body)
    })
  } catch (err) {
    return { status: TRANSPORT_ERROR_STATUS, message: err instanceof Error ? err.message : String(err) }
  }

  const text = await response.text().catch(() => '')
  try {
    return JSON.parse(text) as ReserveResponse
  } catch {
    return { status: SERVER_ERROR_STATUS, httpStatus: response.status, rawBody: text.slice(0, 500) }
  }
}

/** Seconds between order polls. Exported so a caller counting the wait out loud
 *  cannot drift from the interval it is actually counting. */
export const POLL_INTERVAL_MS = 3000

export interface PollOptions {
  intervalMs?: number
  maxAttempts?: number
  /**
   * Called before each read with the attempt number (1-based), the budget, and how long
   * the poll has been waiting. `elapsedMs` is 0 on the first attempt, because the callback
   * fires BEFORE the read rather than after it - counting attempts as though each one had
   * already cost an interval reports the wait a whole interval longer than it is.
   *
   * The poll can run to two minutes, and until Ref 40 item 6 the buyer watched a single
   * unchanging line for all of it, having just committed to paying. Nothing here decides
   * anything; it exists so the screen can say the wait is progressing.
   */
  onAttempt?: (attempt: number, maxAttempts: number, elapsedMs: number) => void
}

/**
 * Poll GET /api/v1/orders/:id until the invoice paymentUrl appears, the order
 * reaches a terminal cancelled/expired state, or maxAttempts is exhausted.
 * Resolves with the last OrderStatus seen - the caller inspects paymentUrl/status.
 * Transient read errors are tolerated (the order may still be settling).
 */
export function pollOrder(
  cfg: EventEngineConfig,
  orderId: string,
  opts: PollOptions = {}
): Promise<OrderStatus> {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS
  const maxAttempts = opts.maxAttempts ?? 40 // ~2 minutes at 3s
  const url = `${base(cfg)}/api/v1/orders/${encodeURIComponent(orderId)}`

  return new Promise((resolve) => {
    let attempts = 0

    const tick = (): void => {
      attempts++
      opts.onAttempt?.(attempts, maxAttempts, (attempts - 1) * intervalMs)
      fetch(url, { method: 'GET', headers: headers(cfg), credentials: 'omit' })
        // A non-OK read (incl. a transient 404 while a fresh order settles) is
        // tolerated: reject → retry. Expiry is concluded only from an explicit
        // terminal status in the body, never from a bare 404.
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((order: OrderStatus) => {
          if (order.paymentUrl) return resolve(order)
          if (isReservationExpired(order)) return resolve(order)
          if (attempts >= maxAttempts) return resolve(order)
          setTimeout(tick, intervalMs)
        })
        .catch(() => {
          if (attempts >= maxAttempts) return resolve({})
          setTimeout(tick, intervalMs)
        })
    }

    tick()
  })
}

/** Map a non-success reserve `status` to buyer-facing copy (mirrors module.js). */
export function friendlyReserveError(res: ReserveResponse): string {
  // Classify a lapsed reservation/hold first so an expiry/not-found status never
  // leaks the raw worker message (e.g. "session not found") to the buyer.
  if (isReservationExpired(res.status)) {
    return RESERVATION_EXPIRED_MESSAGE
  }
  switch (res.status) {
    case TRANSPORT_ERROR_STATUS:
      return 'We couldn’t reach the booking service. Check your internet connection and try again.'
    case SERVER_ERROR_STATUS:
      return `The booking service couldn’t complete your registration${
        res.httpStatus ? ` (error ${res.httpStatus})` : ''
      }. Please try again in a moment.`
    case 'members_only':
      return 'This ticket is for members only.'
    case 'membership_unverified':
      return 'We couldn’t verify your membership. Please contact support.'
    case 'price_mismatch':
      return 'The course price changed before checkout. Please refresh the page and try again.'
    case 'turnstile_required':
    case 'turnstile_failed':
      return 'Please complete the security check and try again.'
    case 'missing_required_answer':
      // The worker names the question ("Dietary requirements" is required), which is the
      // whole value of surfacing this: the checkout reaches here when its own copy of the
      // definitions could not be read, so the refusal is the first time either side knows
      // what the event asks. The field is pulled in behind this message.
      return res.message
        ? `${res.message}. Please complete the question below and try again.`
        : 'Please answer the required questions below and try again.'
    case 'unknown_question':
      return 'Please refresh the page and try again.'
    case 'ticket_not_available':
      return 'This ticket type is not available for public registration.'
    case 'no_selected_modules':
      return 'Please select at least one module before continuing.'
    case 'duplicate_selected_module':
      return 'Please select each module once only.'
    case 'duplicate_attendee_in_booking':
      // The worker names the address it saw twice, which is the actionable part.
      // Distinct from `duplicate_attendee`, which means somebody already holds a seat
      // from an EARLIER booking; this one is about the booking being submitted.
      return res.message || 'Each place needs its own attendee email address.'
    case 'duplicate_attendee':
      return 'That email address already has a place at this event.'
    case 'invalid_selected_module':
      return 'One selected module could not be booked. Please refresh and try again.'
    case 'course_component_full':
      return 'One selected module is now full. Please refresh and choose another module.'
    case 'course_component_not_configured':
    case 'selected_modules_questions_not_supported':
      return 'One selected module is not ready for combined checkout yet. Please book it separately.'
    case 'offer_expired':
    case 'offer_not_open':
    case 'offer_seat_taken':
      return 'That waitlist offer is no longer available.'
    default:
      return res.message || 'We couldn’t complete your registration. Please try again.'
  }
}
