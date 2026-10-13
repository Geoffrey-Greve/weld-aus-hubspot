import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reserveSeat,
  reserveCoursePackage,
  pollOrder,
  friendlyReserveError,
  isReservationExpired,
  RESERVATION_EXPIRED_MESSAGE,
  getIdempotencyKey,
  clearIdempotencyKey,
  reservationScope,
  fetchAvailability,
  applyAvailability,
  hasStartDatePassed,
  fetchEventQuestions,
  splitAnswers,
  missingRequiredAnswers,
  type AvailabilityResponse,
  type EventEngineConfig,
  type RegistrationQuestion,
} from './eventEngine'

const cfg: EventEngineConfig = {
  // Trailing slash is intentional - base() should strip it.
  workerBaseUrl: 'https://w.example.com/',
  portalId: '441838610',
}

describe('reserveSeat', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs to the reserve endpoint with portal + idempotency headers and the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ status: 'reserved', orderId: 'o1' })),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await reserveSeat(
      cfg,
      'cert10-syd-jun',
      { buyer: { name: 'Mel', email: 'mel@x.com' }, ticketTypeId: 'tt_member' },
      'idem-1'
    )

    expect(res.status).toBe('reserved')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://w.example.com/api/v1/events/cert10-syd-jun/reserve')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Portal-Id']).toBe('441838610')
    expect(init.headers['Idempotency-Key']).toBe('idem-1')
    expect(JSON.parse(init.body)).toEqual({
      buyer: { name: 'Mel', email: 'mel@x.com' },
      ticketTypeId: 'tt_member',
    })
  })

  // Ref 217. The Worker's Hono default error handler answers with the plain-text
  // body "Internal Server Error", so every unhandled Worker exception arrives in
  // this shape. Parsing it as JSON used to throw, collapsing a diagnosable server
  // fault into one generic sentence with no HTTP status.
  it('classifies a non-JSON error body as server_error instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 500, text: () => Promise.resolve('Internal Server Error') })
    )

    const res = await reserveSeat(cfg, 'evt', { buyer: { name: 'Mel', email: 'm@x.com' } }, 'idem-2')

    expect(res.status).toBe('server_error')
    expect(res.httpStatus).toBe(500)
    expect(res.rawBody).toBe('Internal Server Error')
    expect(friendlyReserveError(res)).toContain('error 500')
  })

  it('classifies an empty body as server_error rather than a successful reserve', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 502, text: () => Promise.resolve('') }))

    const res = await reserveSeat(cfg, 'evt', { buyer: { name: 'Mel', email: 'm@x.com' } }, 'idem-3')

    expect(res.status).toBe('server_error')
    expect(res.httpStatus).toBe(502)
  })

  // fetch only rejects on transport failure - offline, DNS, TLS, or a CORS
  // rejection. The browser never says which, so the copy stays broad, but it must
  // be distinguishable from "the service answered and failed".
  it('classifies a rejected fetch as transport_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const res = await reserveSeat(cfg, 'evt', { buyer: { name: 'Mel', email: 'm@x.com' } }, 'idem-4')

    expect(res.status).toBe('transport_error')
    expect(res.message).toBe('Failed to fetch')
    expect(friendlyReserveError(res)).toMatch(/couldn’t reach the booking service/i)
  })

  it('still parses a JSON error shape returned with a 4xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 403,
        text: () => Promise.resolve(JSON.stringify({ status: 'members_only', message: 'nope' })),
      })
    )

    const res = await reserveSeat(cfg, 'evt', { buyer: { name: 'Mel', email: 'm@x.com' } }, 'idem-5')

    expect(res.status).toBe('members_only')
    expect(friendlyReserveError(res)).toBe('This ticket is for members only.')
  })

  it('keeps transport and server failures distinguishable to the buyer', () => {
    const transport = friendlyReserveError({ status: 'transport_error' })
    const server = friendlyReserveError({ status: 'server_error', httpStatus: 500 })
    expect(transport).not.toBe(server)
  })

  it('tells a repeated address in THIS booking apart from a seat already taken', () => {
    // One sentence for both is how "already registered for this event" ended up in
    // front of a first-time buyer whose only mistake was choosing two tickets.
    const inBooking = friendlyReserveError({
      status: 'duplicate_attendee_in_booking',
      message: 'Each place needs its own attendee email address. "pat@x.com" is listed more than once in this booking.',
    })
    const alreadyHeld = friendlyReserveError({ status: 'duplicate_attendee' })

    expect(inBooking).not.toBe(alreadyHeld)
    // The worker names the offending address; that is the actionable half.
    expect(inBooking).toContain('pat@x.com')
    expect(alreadyHeld).toMatch(/already has a place/i)
  })

  it('still says something useful when the worker sends no message with the duplicate', () => {
    expect(friendlyReserveError({ status: 'duplicate_attendee_in_booking' })).toMatch(
      /its own attendee email address/i
    )
  })
})

describe('reserveCoursePackage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs the parent-course booking to the package endpoint with the normal reservation contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ status: 'reserved', orderId: 'package-order-1' })),
    })
    vi.stubGlobal('fetch', fetchMock)

    const body = { buyer: { name: 'Mel', email: 'mel@x.com' }, ticketTypeId: 'course-package-ticket' }
    const res = await reserveCoursePackage(cfg, 'course-iwe', body, 'package-idem-1')

    expect(res).toEqual({ status: 'reserved', orderId: 'package-order-1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://w.example.com/api/v1/events/course-iwe/reserve-course-package')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Portal-Id']).toBe('441838610')
    expect(init.headers['Idempotency-Key']).toBe('package-idem-1')
    expect(JSON.parse(init.body)).toEqual(body)
  })
})

describe('pollOrder', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('resolves once a paymentUrl appears', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ paymentUrl: 'https://pay' }) })
    vi.stubGlobal('fetch', fetchMock)

    const order = await pollOrder(cfg, 'o1', { intervalMs: 1, maxAttempts: 5 })
    expect(order.paymentUrl).toBe('https://pay')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxAttempts without a paymentUrl', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'pending' }) })
    vi.stubGlobal('fetch', fetchMock)

    const order = await pollOrder(cfg, 'o1', { intervalMs: 1, maxAttempts: 3 })
    expect(order.paymentUrl).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('tolerates transient 404s (retries) and does not prematurely expire the hold', async () => {
    // A freshly-created paid order can 404 briefly while it settles. A bare 404
    // must NOT be treated as terminal expiry (that would let "Start again" spawn
    // a duplicate reservation while the original hold is live).
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    const order = await pollOrder(cfg, 'o1', { intervalMs: 1, maxAttempts: 3 })
    expect(isReservationExpired(order)).toBe(false)
    expect(order.paymentUrl).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('resolves immediately on any recognized terminal expiry status in the body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'reservation_expired' }) })
    vi.stubGlobal('fetch', fetchMock)

    const order = await pollOrder(cfg, 'o1', { intervalMs: 1, maxAttempts: 40 })
    expect(order.status).toBe('reservation_expired')
    expect(isReservationExpired(order)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('isReservationExpired', () => {
  it('recognises expiry and not-found signals (case/format insensitive)', () => {
    for (const s of [
      'expired',
      'cancelled',
      'Reservation Expired',
      'session_expired',
      'hold-expired',
      'ORDER_EXPIRED',
      'not_found',
      'session_not_found',
    ]) {
      expect(isReservationExpired(s)).toBe(true)
    }
    expect(isReservationExpired({ status: 'reservation_expired' })).toBe(true)
  })

  it('does not treat live/other statuses (or waitlist offers) as expired', () => {
    for (const s of ['reserved', 'confirmed', 'pending', 'waitlisted', 'offer_expired', '']) {
      expect(isReservationExpired(s)).toBe(false)
    }
    expect(isReservationExpired(null)).toBe(false)
    expect(isReservationExpired(undefined)).toBe(false)
  })
})

describe('friendlyReserveError', () => {
  it('maps known statuses and falls back to the message', () => {
    expect(friendlyReserveError({ status: 'members_only' })).toMatch(/members only/i)
    expect(friendlyReserveError({ status: 'membership_unverified' })).toMatch(/verify/i)
    expect(friendlyReserveError({ status: 'something_else', message: 'boom' })).toBe('boom')
  })

  it('maps expiry/not-found statuses to the reservation-expired copy (not the raw message)', () => {
    expect(friendlyReserveError({ status: 'expired', message: 'session not found' })).toBe(
      RESERVATION_EXPIRED_MESSAGE
    )
    expect(friendlyReserveError({ status: 'session_not_found' })).toBe(RESERVATION_EXPIRED_MESSAGE)
    expect(friendlyReserveError({ status: 'reservation_expired' })).toBe(RESERVATION_EXPIRED_MESSAGE)
  })

  it('keeps the distinct waitlist-offer copy for offer_* statuses', () => {
    expect(friendlyReserveError({ status: 'offer_expired' })).toMatch(/waitlist offer/i)
    expect(friendlyReserveError({ status: 'offer_seat_taken' })).toMatch(/waitlist offer/i)
  })
})

describe('idempotency keys', () => {
  beforeEach(() => sessionStorage.clear())

  it('reuses one key until cleared, then issues a fresh one', () => {
    const k1 = getIdempotencyKey('e1')
    expect(getIdempotencyKey('e1')).toBe(k1)
    clearIdempotencyKey('e1')
    expect(getIdempotencyKey('e1')).not.toBe(k1)
  })

  // Ref 40 item 5. The worker REPLAYS a stored response for a repeated key, so scoping
  // it to the event alone meant a buyer who timed out, went back and typed a different
  // email was handed the first booking's invoice instead of one of their own.
  it('gives a different buyer a different key on the same event', () => {
    const first = reservationScope('e1', { buyerEmail: 'one@example.com', ticketTypeId: 'tt' })
    const second = reservationScope('e1', { buyerEmail: 'two@example.com', ticketTypeId: 'tt' })
    expect(second).not.toBe(first)
    expect(getIdempotencyKey(second)).not.toBe(getIdempotencyKey(first))
  })

  it('is stable for a retry of the same submission, whatever the case or spacing', () => {
    expect(reservationScope('e1', { buyerEmail: ' One@Example.com ', ticketTypeId: 'tt' })).toBe(
      reservationScope('e1', { buyerEmail: 'one@example.com', ticketTypeId: 'tt' })
    )
  })

  it('separates a different ticket type and a different module selection', () => {
    const base = { buyerEmail: 'one@example.com' }
    expect(reservationScope('e1', { ...base, ticketTypeId: 'member' })).not.toBe(
      reservationScope('e1', { ...base, ticketTypeId: 'public' })
    )
    expect(
      reservationScope('e1', {
        ...base,
        selectedModules: [{ eventId: 'm1', ticketTypeId: 't1' }]
      })
    ).not.toBe(
      reservationScope('e1', {
        ...base,
        selectedModules: [
          { eventId: 'm1', ticketTypeId: 't1' },
          { eventId: 'm2', ticketTypeId: 't2' }
        ]
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Live availability
// ---------------------------------------------------------------------------

describe('fetchAvailability', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reads the availability endpoint with the portal header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', eventFull: false, ticketTypes: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetchAvailability(cfg, 'cert10-syd-jun')

    expect(res?.status).toBe('ok')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://w.example.com/api/v1/events/cert10-syd-jun/availability')
    expect((init.headers as Record<string, string>)['X-Portal-Id']).toBe('441838610')
  })

  it('answers null on any failure rather than throwing at the card', async () => {
    // Advisory: a failed read must leave the page on the HubDB row, not blank a card.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchAvailability(cfg, 'e1')).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    expect(await fetchAvailability(cfg, 'e1')).toBeNull()
  })

  it('answers null on a body that is not the ok shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'event_not_found' }),
      })
    )
    expect(await fetchAvailability(cfg, 'gone')).toBeNull()
  })
})

describe('hasStartDatePassed', () => {
  // Fixed local noon, so every case below is unambiguous whatever zone CI runs in.
  const now = new Date(2026, 8, 18, 12, 0, 0) // 18 Sep 2026, local

  it('is past for a session that started before today', () => {
    expect(hasStartDatePassed('2026-08-03', now)).toBe(true)
  })

  it('is NOT past on the day it starts', () => {
    // A course starting this morning is still sellable at the door, and the Worker is the
    // one holding the real cutoff - closing it here a few hours early is not ours to do.
    expect(hasStartDatePassed('2026-09-18', now)).toBe(false)
  })

  it('is not past for a future session', () => {
    expect(hasStartDatePassed('2026-11-02', now)).toBe(false)
  })

  it('reads a date we cannot parse as "still selling", never as over', () => {
    // Blank, null and a malformed import all mean "we cannot tell when this runs". The
    // safe answer is to keep offering it and let the Worker refuse at reserve; the unsafe
    // one silently takes a live course off the site.
    expect(hasStartDatePassed('', now)).toBe(false)
    expect(hasStartDatePassed(null, now)).toBe(false)
    expect(hasStartDatePassed(undefined, now)).toBe(false)
    expect(hasStartDatePassed('3 August 2026', now)).toBe(false)
  })

  it('reads the date off a full ISO timestamp', () => {
    expect(hasStartDatePassed('2026-08-03T00:00:00.000Z', now)).toBe(true)
  })

  it('compares against the LOCAL calendar day, not the UTC one', () => {
    // 08:00 on the 18th in Adelaide is still the 17th in UTC. A session starting on the
    // 17th has run; reading the UTC date would call it today and keep selling it. Same
    // fault the worker's timezone.ts fixes for a certificate's attendance date.
    const morning = new Date(2026, 8, 18, 8, 0, 0)
    expect(hasStartDatePassed('2026-09-17', morning)).toBe(true)
  })
})

describe('applyAvailability', () => {
  const hubdb = (status: string, seatsRemaining: number | null = null) => ({
    status,
    seatsRemaining,
  })
  const live = (over: Partial<AvailabilityResponse> = {}): AvailabilityResponse => ({
    status: 'ok',
    eventFull: false,
    ticketTypes: [
      { ticketTypeId: 'tt1', available: 6, soldOut: false, waitlistAvailable: false },
    ],
    ...over,
  })

  it('keeps the HubDB row when there is no live read', () => {
    expect(applyAvailability(hubdb('available', 8), null)).toEqual({
      status: 'available',
      seatsRemaining: 8,
      source: 'hubdb',
    })
  })

  it('closes a session whose start date has passed, with no live read to ask', () => {
    // Ref 46 round 2: stale course rows kept selling long after the course ran, and set
    // the "from" price on the page as well. This is the Worker's own default cutoff
    // (registration_closes_at defaults to starts_at) said one page earlier, for the rows
    // the Worker never sees.
    expect(applyAvailability({ ...hubdb('available', 8), startDate: '2020-01-01' }, null)).toEqual({
      status: 'registration_closed',
      seatsRemaining: 8,
      source: 'hubdb',
    })
  })

  it('says "closed", not "sold out", about a course that has already run', () => {
    // Different sentences on purpose: a sell-out invites a waitlist enquiry, and there is
    // no waitlist for a course that finished. The seat count on a finished course is not a
    // fact about anything the buyer can do now, so the clock outranks it.
    expect(
      applyAvailability(
        { ...hubdb('available', 0), seatsRemainingIsSet: true, startDate: '2020-01-01' },
        null
      )
    ).toMatchObject({ status: 'registration_closed' })
  })

  it('leaves a future session alone', () => {
    expect(applyAvailability({ ...hubdb('available', 8), startDate: '2099-01-01' }, null)).toEqual({
      status: 'available',
      seatsRemaining: 8,
      source: 'hubdb',
    })
  })

  it('lets a live read re-open a started session, because the cutoff is the Worker\'s', () => {
    // The clock is a DERIVED fact, like seats_remaining, not an editorial one like a
    // hand-set Sold Out. A tenant who left a walk-up window open past the start owns that
    // decision in registration_closes_at, and the Worker is the side holding it.
    expect(
      applyAvailability({ ...hubdb('available', 4), startDate: '2020-01-01' }, live())
    ).toMatchObject({ status: 'available', source: 'worker' })
  })

  it('still refuses to un-cancel a started session', () => {
    // Editorial first, always: the clock never gets to restate a cancellation as a closure.
    expect(
      applyAvailability({ ...hubdb('cancelled', 0), startDate: '2020-01-01' }, null)
    ).toMatchObject({ status: 'cancelled' })
  })

  it('lets the worker correct a HubDB row that still advertises places', () => {
    // The whole point: seats_remaining is hand-typed and goes stale the moment a seat sells.
    expect(applyAvailability(hubdb('available', 8), live({ eventFull: true }))).toMatchObject({
      status: 'sold_out',
      source: 'worker',
    })
  })

  it('never lets the worker re-open a session staff closed by hand', () => {
    // The status column is a person's decision, made for reasons the seat count cannot
    // see. A live read saying "six seats" used to override it and the page kept selling.
    // The accepted cost: a refund no longer re-opens a hand-closed session on its own.
    expect(applyAvailability(hubdb('sold_out', 0), live())).toEqual({
      status: 'sold_out',
      seatsRemaining: 0,
      source: 'hubdb',
    })
  })

  it('still lets the worker correct a sold-out derived from a stale seat count', () => {
    // seats_remaining is hand-typed and an import can write 0 into every blank cell, so a
    // sold-out derived from it stays soft where a hand-set status column does not.
    expect(
      applyAvailability(
        { status: 'available', seatsRemaining: 0, seatsRemainingIsSet: true },
        live()
      )
    ).toMatchObject({ status: 'available', seatsRemaining: 6, source: 'worker' })
  })

  it('treats a blank seat count as unknown, not as zero', () => {
    // HubL renders a blank number column and a 0 identically; only the caller can tell
    // them apart, and a whole timetable of blanks is not a sold-out timetable.
    expect(applyAvailability({ status: 'available', seatsRemaining: null }, null)).toMatchObject(
      { status: 'available' }
    )
    expect(
      applyAvailability({ status: 'available', seatsRemaining: 0, seatsRemainingIsSet: true }, null)
    ).toMatchObject({ status: 'sold_out' })
  })

  it('reports an event with no public ticket types as not bookable, never as sold out', () => {
    // `[].every()` is true, so this read used to close a session whose ticket types had
    // not been added yet — or whose only types are internal or CAMS imports, which the
    // public read filters out. Nothing here is full; there is simply nothing on sale.
    expect(
      applyAvailability(hubdb('available', 8), live({ ticketTypes: [] }))
    ).toEqual({ status: 'not_bookable', seatsRemaining: null, source: 'worker' })
  })

  it('still reports a genuinely full event as sold out when it lists no types', () => {
    expect(
      applyAvailability(hubdb('available', 8), live({ ticketTypes: [], eventFull: true }))
    ).toMatchObject({ status: 'sold_out' })
  })

  it('prefers a closed or paused sale over "not bookable"', () => {
    // A buyer gets the most specific sentence available: "registrations have closed" and
    // "on hold" both say more than "not open yet".
    expect(
      applyAvailability(hubdb('available'), live({ ticketTypes: [], registrationClosed: true }))
    ).toMatchObject({ status: 'registration_closed' })
    expect(
      applyAvailability(hubdb('available'), live({ ticketTypes: [], salesPaused: true }))
    ).toMatchObject({ status: 'sales_paused' })
  })

  it('reports a closed registration distinctly from a sell-out', () => {
    expect(
      applyAvailability(hubdb('available', 8), live({ registrationClosed: true }))
    ).toMatchObject({ status: 'registration_closed' })
  })

  it('reports a paused sale distinctly, and ahead of the clock', () => {
    expect(
      applyAvailability(
        hubdb('available', 8),
        live({ salesPaused: true, registrationClosed: true })
      )
    ).toMatchObject({ status: 'sales_paused' })
  })

  it('never lets the worker un-cancel a session', () => {
    // Cancelling is an editorial decision recorded in HubDB; the worker has no opinion.
    expect(applyAvailability(hubdb('cancelled', 0), live())).toEqual({
      status: 'cancelled',
      seatsRemaining: 0,
      source: 'hubdb',
    })
  })

  it('never lets a live read RE-OPEN a row staff marked Closed (Ref 74c)', () => {
    // The guarantee Phase 2 exists for. The row says registrations are shut; the Worker
    // says six seats and not full. The seats are real - staff simply stopped selling them -
    // so the page must say "Registrations closed" and offer no Register button.
    expect(
      applyAvailability(hubdb('closed', 6), live({ eventFull: false, bookable: true }))
    ).toEqual({
      status: 'registration_closed',
      seatsRemaining: 6,
      source: 'hubdb',
    })

    // And it holds for a session with ticket types wide open, which is the shape that
    // would have re-opened it if the check ran after the live read instead of before.
    expect(
      applyAvailability(
        hubdb('Closed'),
        live({
          ticketTypes: [
            { ticketTypeId: 'tt1', available: 99, soldOut: false, bookable: true, waitlistAvailable: false },
          ],
        })
      )
    ).toMatchObject({ status: 'registration_closed', source: 'hubdb' })
  })

  it('reads the status column in whatever spelling HubL sent it', () => {
    // The card partials pass the raw option name, the course modules pass a slug. Both
    // reach this function, and both must land on the same editorial decision.
    expect(applyAvailability(hubdb('Sold Out', 0), live())).toMatchObject({
      status: 'sold_out',
      source: 'hubdb',
    })
    expect(applyAvailability(hubdb('Cancelled', 0), live())).toMatchObject({
      status: 'cancelled',
      source: 'hubdb',
    })
  })

  it('sums seats across ticket types', () => {
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          { ticketTypeId: 'a', available: 4, soldOut: false, waitlistAvailable: false },
          { ticketTypeId: 'b', available: 3, soldOut: false, waitlistAvailable: false },
        ],
      })
    )
    expect(res.seatsRemaining).toBe(7)
  })

  it('treats an uncapped ticket type as "no number to show", not as zero', () => {
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          { ticketTypeId: 'a', available: null, soldOut: false, waitlistAvailable: false },
          { ticketTypeId: 'b', available: 3, soldOut: false, waitlistAvailable: false },
        ],
      })
    )
    expect(res.seatsRemaining).toBeNull()
    expect(res.status).toBe('available')
  })

  it('blocks on the SELECTED ticket type being paused, on an otherwise-open event', () => {
    // A member walking every step of checkout only to be refused at reserve is the failure
    // this closes: the event is open, the public ticket is fine, theirs is not.
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          {
            ticketTypeId: 'member',
            available: 5,
            soldOut: false,
            salesPaused: true,
            bookable: false,
            waitlistAvailable: false,
          },
          { ticketTypeId: 'public', available: 5, soldOut: false, waitlistAvailable: false },
        ],
      }),
      'member'
    )
    expect(res.status).toBe('sales_paused')
  })

  it('blocks on the selected ticket type being sold out while others have seats', () => {
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          { ticketTypeId: 'member', available: 0, soldOut: true, waitlistAvailable: true },
          { ticketTypeId: 'public', available: 9, soldOut: false, waitlistAvailable: false },
        ],
      }),
      'member'
    )
    expect(res).toMatchObject({ status: 'sold_out', seatsRemaining: 0 })
  })

  it('counts the selected type\'s own seats, not the sum across types', () => {
    // Summing would promise a member seats that only exist on the public ticket.
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          { ticketTypeId: 'member', available: 2, soldOut: false, waitlistAvailable: false },
          { ticketTypeId: 'public', available: 40, soldOut: false, waitlistAvailable: false },
        ],
      }),
      'member'
    )
    expect(res.seatsRemaining).toBe(2)
  })

  it('does not treat an unlisted ticket type as closed', () => {
    // The public read filters internal and import tickets out. Guessing "closed" for one
    // would block a booking the worker would have accepted.
    const res = applyAvailability(hubdb('available'), live(), 'some-internal-ticket')
    expect(res.status).toBe('available')
  })

  it('judges the event as a whole when no ticket type is named', () => {
    // A listing card is not choosing a ticket yet.
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          {
            ticketTypeId: 'member',
            available: 5,
            soldOut: false,
            salesPaused: true,
            waitlistAvailable: false,
          },
          { ticketTypeId: 'public', available: 5, soldOut: false, waitlistAvailable: false },
        ],
      })
    )
    expect(res.status).toBe('available')
  })

  it('is sold out only when every ticket type is', () => {
    const res = applyAvailability(
      hubdb('available'),
      live({
        ticketTypes: [
          { ticketTypeId: 'a', available: 0, soldOut: true, waitlistAvailable: true },
          { ticketTypeId: 'b', available: 2, soldOut: false, waitlistAvailable: false },
        ],
      })
    )
    expect(res.status).toBe('available')
  })
})

// ---------------------------------------------------------------------------
// Custom registration questions
// ---------------------------------------------------------------------------

const QUESTION: RegistrationQuestion = {
  id: 'q1',
  key: 'dietary_requirements',
  label: 'Dietary requirements',
  fieldType: 'textarea',
  options: null,
  required: false,
  scope: 'attendee',
  helpText: null,
  sortOrder: 0,
  hsProperty: 'dietary_requirements',
  prefill: true,
}

const PO_QUESTION: RegistrationQuestion = {
  ...QUESTION,
  id: 'q2',
  key: 'po_number',
  label: 'Purchase order number',
  fieldType: 'text',
  scope: 'order',
  hsProperty: null,
}

describe('fetchEventQuestions', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reads the public questions endpoint and returns the definitions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ eventId: 'e1', questions: [QUESTION] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchEventQuestions(cfg, 'e1')).toEqual([QUESTION])
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.example.com/api/v1/events/e1/questions')
  })

  it('answers null when it could not read them, which is not the same as none', async () => {
    // Collapsing the two is what makes a transient failure unrecoverable: on an event with
    // a required question the form renders nothing, the buyer submits, and the worker
    // refuses for a question they were never shown.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchEventQuestions(cfg, 'e1')).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect(await fetchEventQuestions(cfg, 'e1')).toBeNull()
  })

  it('answers null for a 200 whose shape it does not understand', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ eventId: 'e1' }) })
    )
    expect(await fetchEventQuestions(cfg, 'e1')).toBeNull()
  })

  it('answers [] for an event that genuinely asks nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ questions: [] }) })
    )
    expect(await fetchEventQuestions(cfg, 'e1')).toEqual([])
  })
})

describe('splitAnswers', () => {
  it('routes each answer to the field its scope is validated against', () => {
    // The worker rejects a key sent in the wrong scope BY NAME, so this cannot be one bag.
    expect(
      splitAnswers([QUESTION, PO_QUESTION], {
        dietary_requirements: 'Coeliac',
        po_number: 'PO-4471',
      })
    ).toEqual({
      answers: { po_number: 'PO-4471' },
      attendeeAnswers: { dietary_requirements: 'Coeliac' },
    })
  })

  it('drops blanks so an untouched optional question sends nothing', () => {
    expect(splitAnswers([QUESTION, PO_QUESTION], { dietary_requirements: '' })).toEqual({
      answers: {},
      attendeeAnswers: {},
    })
  })

  it('ignores a value with no matching definition', () => {
    // An unknown key is an error at the worker, so it must never leave the browser.
    expect(splitAnswers([QUESTION], { shirt_size: 'L' })).toEqual({
      answers: {},
      attendeeAnswers: {},
    })
  })
})

describe('missingRequiredAnswers', () => {
  const required = { ...QUESTION, required: true }

  it('names a required question left blank', () => {
    expect(missingRequiredAnswers([required], {})).toEqual(['dietary_requirements'])
    expect(missingRequiredAnswers([required], { dietary_requirements: '   ' })).toEqual([
      'dietary_requirements',
    ])
  })

  it('is satisfied by any real answer', () => {
    expect(missingRequiredAnswers([required], { dietary_requirements: 'None' })).toEqual([])
  })

  it('never blocks on an optional question', () => {
    expect(missingRequiredAnswers([QUESTION], {})).toEqual([])
  })
})
