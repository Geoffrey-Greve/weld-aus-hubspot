import { describe, expect, it } from 'vitest'
import type { LiveSessionStatus } from '../api/eventEngine'
import {
  SESSION_STATUSES,
  type SessionStatus,
  hubdbStatusToSessionStatus,
  statusPresentation,
} from './sessionStatus'

describe('hubdbStatusToSessionStatus', () => {
  it('reads every spelling of sold out that reaches React today', () => {
    // HubL slugs it on the course modules, passes the raw option name on the command
    // centre, and the card partials compare `.name`. All three arrive here.
    for (const raw of ['Sold Out', 'sold out', 'sold_out', 'SOLD OUT', 'Sold-Out']) {
      expect(hubdbStatusToSessionStatus(raw)).toBe('sold_out')
    }
  })

  it('reads cancelled, including the American spelling', () => {
    for (const raw of ['Cancelled', 'cancelled', 'Canceled']) {
      expect(hubdbStatusToSessionStatus(raw)).toBe('cancelled')
    }
  })

  it('treats a blank cell as available, not as a missing decision', () => {
    expect(hubdbStatusToSessionStatus('')).toBe('available')
    expect(hubdbStatusToSessionStatus('   ')).toBe('available')
    expect(hubdbStatusToSessionStatus(null)).toBe('available')
    expect(hubdbStatusToSessionStatus(undefined)).toBe('available')
  })

  it('reads "Closed" as the registration cutoff (Ref 74c)', () => {
    // Phase 1 asserted the opposite - 'Closed' was an unknown value and stayed sellable.
    // Phase 2 adds it to the column, and it resolves to the SAME status the Worker's own
    // cutoff produces: staff shutting registrations by hand and the clock running out are
    // one fact to a buyer, so they get one sentence and one badge.
    for (const raw of ['Closed', 'closed', 'CLOSED', 'Registrations Closed']) {
      expect(hubdbStatusToSessionStatus(raw)).toBe('registration_closed')
    }
  })

  it('leaves an unknown value sellable rather than closing it', () => {
    // A status nobody taught this code about must not take a session off sale.
    expect(hubdbStatusToSessionStatus('Postponed')).toBe('available')
    expect(hubdbStatusToSessionStatus('Waitlist only')).toBe('available')
  })
})

describe('statusPresentation', () => {
  it('gives each status its own sentence', () => {
    // These strings are the contract the module tests assert against. Changing one here
    // changes it on every surface at once, which is the reason this module exists.
    expect(statusPresentation('sold_out').label).toBe('Sold out')
    expect(statusPresentation('registration_closed').label).toBe('Registrations closed')
    expect(statusPresentation('sales_paused').label).toBe('Bookings on hold')
    expect(statusPresentation('cancelled').label).toBe('Cancelled')
    expect(statusPresentation('not_bookable').label).toBe('Booking opening soon')
  })

  it('offers a Register control for available and nothing else', () => {
    expect(statusPresentation('available').bookable).toBe(true)
    for (const status of SESSION_STATUSES.filter((s) => s !== 'available')) {
      expect(statusPresentation(status).bookable).toBe(false)
    }
  })

  it('answers every status, with a distinct slug', () => {
    const slugs = SESSION_STATUSES.map((status) => statusPresentation(status).slug)
    expect(slugs).toHaveLength(SESSION_STATUSES.length)
    expect(new Set(slugs).size).toBe(SESSION_STATUSES.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z-]+$/)
  })
})

describe('the union stays in step with the Worker client', () => {
  it('is the same set LiveSessionStatus carries', () => {
    // eventEngine re-exports this type rather than declaring its own. If someone splits
    // them again, these assignments stop compiling — which is the test.
    const fromShared: LiveSessionStatus = 'registration_closed' satisfies SessionStatus
    const fromClient: SessionStatus = 'not_bookable' satisfies LiveSessionStatus
    expect(fromShared).toBe('registration_closed')
    expect(fromClient).toBe('not_bookable')
    expect(SESSION_STATUSES).toHaveLength(6)
  })
})
