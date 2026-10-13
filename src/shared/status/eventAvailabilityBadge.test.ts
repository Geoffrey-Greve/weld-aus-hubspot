import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AvailabilityResponse } from '../api/eventEngine'
import { badgeFor, initAvailability, resetBadgeCache } from './eventAvailabilityBadge'

/**
 * Ref 74c Phase 1 — the events badge now reads the Worker's registration cutoff.
 *
 * Two promises are worth holding down: the badge says what the Worker says (including the
 * cutoff it used to be blind to), and it NEVER hides a sellable event because the Worker was
 * unreachable.
 */

function response(over: Partial<AvailabilityResponse> = {}): AvailabilityResponse {
  return {
    status: 'ok',
    eventFull: false,
    bookable: true,
    ticketTypes: [
      {
        ticketTypeId: 'tt-1',
        available: 20,
        soldOut: false,
        bookable: true,
        waitlistAvailable: false,
      },
    ],
    ...over,
  }
}

describe('badgeFor', () => {
  it('says registrations are closed once the cutoff has passed', () => {
    // The whole point of Phase 1: this used to read "Places available" right up to the
    // moment the buyer was refused at reserve.
    expect(badgeFor(response({ registrationClosed: true, bookable: false }))).toEqual({
      state: 'closed',
      label: 'Registrations closed',
    })
  })

  it('says bookings are on hold when a human stopped sales', () => {
    expect(badgeFor(response({ salesPaused: true, bookable: false }))).toEqual({
      state: 'paused',
      label: 'Bookings on hold',
    })
  })

  it('offers the waitlist on a sold-out event, and only there', () => {
    const soldOut = response({
      eventFull: true,
      bookable: false,
      ticketTypes: [
        {
          ticketTypeId: 'tt-1',
          available: 0,
          soldOut: true,
          bookable: false,
          waitlistAvailable: true,
        },
      ],
    })
    expect(badgeFor(soldOut)).toEqual({ state: 'soldout', label: 'Sold out - join waitlist' })

    // "Registrations closed" must not invite a waitlist: reserve refuses before it reaches
    // one, so the offer would be a form that always fails.
    expect(badgeFor({ ...soldOut, registrationClosed: true }).label).toBe('Registrations closed')
  })

  it('calls an event with nothing on sale "opening soon", not "sold out"', () => {
    // Matches the course cards. Nothing is full here; there is simply nothing for sale yet.
    expect(badgeFor(response({ bookable: false, ticketTypes: [] }))).toEqual({
      state: 'notbookable',
      label: 'Booking opening soon',
    })
  })

  it('bands a nearly-gone event without printing the count', () => {
    const live = response({
      ticketTypes: [
        {
          ticketTypeId: 'tt-1',
          available: 3,
          soldOut: false,
          bookable: true,
          waitlistAvailable: false,
        },
      ],
    })
    expect(badgeFor(live)).toEqual({ state: 'limited', label: 'Limited places remaining' })
    expect(badgeFor(response())).toEqual({ state: 'available', label: 'Places available' })
  })

  it('FAILS OPEN when the Worker could not be read', () => {
    // A badge that hid a sellable event because a fetch timed out would be worse than the
    // stale state it replaced. The Worker is authoritative at reserve either way.
    expect(badgeFor(null)).toEqual({ state: 'available', label: 'Booking open' })
  })

  // ── Ref 74c Phase 3: the row's own status ────────────────────────────────

  it('never lets a live read RE-OPEN an event staff marked Closed', () => {
    // The same guarantee courses got in Phase 2, on the events side. The seats are real -
    // staff simply stopped selling them - so the Worker's "20 available, bookable" must
    // not win.
    expect(badgeFor(response(), 'Closed')).toEqual({
      state: 'closed',
      label: 'Registrations closed',
    })
  })

  it('closes an event that was never wired to the Worker at all', () => {
    // No live read, no worker_event_id, no cutoff: the column alone has to be able to
    // close an event, or the manual control only works on Event Engine-backed rows.
    expect(badgeFor(null, 'Closed')).toEqual({
      state: 'closed',
      label: 'Registrations closed',
    })
    expect(badgeFor(null, 'Cancelled')).toEqual({ state: 'cancelled', label: 'Cancelled' })
  })

  it('is OPTIONAL: no status behaves exactly as Phase 1 shipped', () => {
    for (const absent of [undefined, null, '']) {
      expect(badgeFor(response(), absent)).toEqual({
        state: 'available',
        label: 'Places available',
      })
      expect(badgeFor(null, absent)).toEqual({ state: 'available', label: 'Booking open' })
    }
  })

  it('still reports the cutoff when the row says nothing', () => {
    // Both roads reach the same sentence: the manual close above, and the Worker's own
    // cutoff here.
    expect(badgeFor(response({ registrationClosed: true, bookable: false }), 'Available')).toEqual({
      state: 'closed',
      label: 'Registrations closed',
    })
  })
})

describe('initAvailability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetBadgeCache()
    document.body.innerHTML = ''
  })

  function badge(attrs: Record<string, string>): HTMLElement {
    const el = document.createElement('span')
    el.setAttribute('data-wa-availability-badge', '')
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
    document.body.appendChild(el)
    return el
  }

  function stubFetch(body: unknown) {
    const mock = vi.fn(
      async () =>
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    )
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('renders the Worker answer onto the badge', async () => {
    stubFetch(response({ registrationClosed: true, bookable: false }))
    const el = badge({
      'data-worker-event-id': 'evt-closed',
      'data-worker-base-url': 'https://worker.test',
      'data-portal-id': '441838610',
    })

    initAvailability(document)
    await vi.waitFor(() => expect(el.dataset.state).toBe('closed'))
    expect(el.textContent).toBe('Registrations closed')
    expect(el.hidden).toBe(false)
  })

  it('reads the Worker config off an ancestor when the badge carries none', async () => {
    // events-listing.module puts it on the section; the two page templates put it on the
    // badge. Both have to keep working.
    stubFetch(response())
    const section = document.createElement('div')
    section.setAttribute('data-wa-availability-worker', 'https://worker.test')
    section.setAttribute('data-wa-availability-portal', '441838610')
    document.body.appendChild(section)
    const el = document.createElement('span')
    el.setAttribute('data-wa-availability-badge', '')
    el.setAttribute('data-worker-event-id', 'evt-section')
    section.appendChild(el)

    initAvailability(document)
    await vi.waitFor(() => expect(el.dataset.state).toBe('available'))
    expect(el.textContent).toBe('Places available')
  })

  it('hides a badge with no configuration instead of guessing an environment', () => {
    // It used to default to a hardcoded STAGING worker and portal id, on production pages.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const el = badge({ 'data-worker-event-id': 'evt-unconfigured' })

    initAvailability(document)
    expect(el.hidden).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails open when the Worker answers with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    )
    const el = badge({
      'data-worker-event-id': 'evt-down',
      'data-worker-base-url': 'https://worker.test',
      'data-portal-id': '441838610',
    })

    initAvailability(document)
    await vi.waitFor(() => expect(el.textContent).toBe('Booking open'))
    expect(el.dataset.state).toBe('available')
    expect(el.hidden).toBe(false)
  })

  it('renders a closed row without asking the Worker at all (Ref 74c Phase 3)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const el = badge({
      'data-worker-event-id': 'evt-closed-by-hand',
      'data-worker-base-url': 'https://worker.test',
      'data-portal-id': '441838610',
      'data-hubdb-status': 'Closed',
    })

    initAvailability(document)
    expect(el.dataset.state).toBe('closed')
    expect(el.textContent).toBe('Registrations closed')
    // The row already settled it; a request could only confirm seats nobody may buy.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('binds each badge once', async () => {
    const fetchMock = stubFetch(response())
    const el = badge({
      'data-worker-event-id': 'evt-once',
      'data-worker-base-url': 'https://worker.test',
      'data-portal-id': '441838610',
    })

    initAvailability(document)
    initAvailability(document)
    await vi.waitFor(() => expect(el.dataset.state).toBe('available'))
    expect(el.getAttribute('data-wa-availability-bound')).toBe('true')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('the built bundle', () => {
  const built = resolve(__dirname, '../../../theme/assets/js/event-availability.js')

  it.skipIf(!existsSync(built))(
    'is a classic script the host templates can load without type="module"',
    () => {
      // events.html, event-detail.html and events-listing.module all use a plain
      // <script src … defer>. An ESM bundle would throw before a badge ever bound.
      const code = readFileSync(built, 'utf8')
      expect(code).not.toMatch(/^\s*import\s/m)
      expect(code).not.toMatch(/^\s*export\s/m)
    }
  )

  it.skipIf(!existsSync(built))('runs in a DOM and keeps the refresh hook a function', () => {
    // The entry exports nothing on purpose: an IIFE with exports would overwrite the global
    // with a module namespace and `WAEventAvailability.refresh` would stop being callable.
    const code = readFileSync(built, 'utf8')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 }))
    )
    document.body.innerHTML = ''
    new Function(code).call(window)
    expect(typeof window.WAEventAvailability?.refresh).toBe('function')
    vi.unstubAllGlobals()
  })
})
