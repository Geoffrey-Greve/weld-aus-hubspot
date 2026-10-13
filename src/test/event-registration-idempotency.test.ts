/**
 * The events module's Idempotency-Key scope.
 *
 * The worker REPLAYS a stored response verbatim for a repeated key, so the scope
 * decides what counts as "the same booking". Scoped to the event alone, a buyer who
 * timed out on "your place is held", went back, typed a different email and submitted
 * again was handed the FIRST booking's response with their new details discarded.
 *
 * That is Ref 40 item 5. It was fixed in the React checkout tunnel (`reservationScope`
 * in src/shared/api/eventEngine.ts) and never ported here, because this module is a
 * second, independent implementation of the same booking contract. One fix, two
 * implementations, and it reached one of them. These tests are on the copy that was
 * missed.
 *
 * theme/modules/event-registration.module/module.js is plain browser JS with no module
 * system, so the two pure functions are extracted from the shipped source and run.
 * That is deliberate: it tests the file that actually ships, not a transcription of it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  resolve(__dirname, '../../theme/modules/event-registration.module/module.js'),
  'utf8'
)

interface ReserveBody {
  buyer: { email?: string; name?: string; abn?: string }
  ticketTypeId?: string
  attendees?: Array<{ email?: string; name?: string; ticketTypeId?: string }>
}

type ScopeFn = (body: ReserveBody) => string

/** Lift `fingerprint` and `scopeKeyFor` out of the shipped module and bind them. */
function loadScopeFn(workerEventId = 'evt-1'): ScopeFn {
  const fingerprintSrc = SOURCE.match(/function fingerprint\(value\)[\s\S]*?\n {2}}/)?.[0]
  const scopeSrc = SOURCE.match(
    /EventRegistration\.prototype\.scopeKeyFor = function \(body\) \{[\s\S]*?\n {2}\}/
  )?.[0]

  if (!fingerprintSrc || !scopeSrc) {
    throw new Error('fingerprint/scopeKeyFor not found in module.js — did the shape change?')
  }

  const factory = new Function(
    'workerEventId',
    `${fingerprintSrc}
     const host = { cfg: { workerEventId } };
     host.scopeKeyFor = ${scopeSrc.replace('EventRegistration.prototype.scopeKeyFor = ', '')};
     return (body) => host.scopeKeyFor(body);`
  ) as (id: string) => ScopeFn

  return factory(workerEventId)
}

const scopeKeyFor = loadScopeFn()

const single = (email: string, ticketTypeId = 't1', name = 'Buyer'): ReserveBody => ({
  buyer: { email, name },
  ticketTypeId,
})

describe('event-registration Idempotency-Key scope', () => {
  it('is no longer the event alone', () => {
    // The defect, stated as a test: two different buyers on one event must not share
    // a key, or the second is replayed the first one's booking.
    expect(scopeKeyFor(single('first@example.com'))).not.toBe(
      scopeKeyFor(single('second@example.com'))
    )
  })

  it('still namespaces by event, so two events cannot collide', () => {
    const other = loadScopeFn('evt-2')
    expect(scopeKeyFor(single('a@example.com'))).toMatch(/^evt-idem:evt-1:/)
    expect(other(single('a@example.com'))).toMatch(/^evt-idem:evt-2:/)
    expect(scopeKeyFor(single('a@example.com'))).not.toBe(other(single('a@example.com')))
  })

  it('treats a corrected name or ABN as the SAME booking', () => {
    // The other half of the rule. A fresh key here would take a second seat for
    // someone who only fixed a typo, which is the failure the key exists to prevent.
    const base = scopeKeyFor({ buyer: { email: 'a@example.com', name: 'Jo' }, ticketTypeId: 't1' })
    const renamed = scopeKeyFor({
      buyer: { email: 'a@example.com', name: 'Joanne', abn: '12345678901' },
      ticketTypeId: 't1',
    })
    expect(renamed).toBe(base)
  })

  it('normalises the buyer email, so case and spacing are not a new booking', () => {
    expect(scopeKeyFor(single('  Person@Example.com  '))).toBe(scopeKeyFor(single('person@example.com')))
  })

  it('separates a different ticket type', () => {
    expect(scopeKeyFor(single('a@example.com', 't1'))).not.toBe(
      scopeKeyFor(single('a@example.com', 't2'))
    )
  })

  it('separates a changed attendee on the group path', () => {
    // Attendee emails decide who holds a seat and whose name is on a ticket, so they
    // are part of "what is being bought" exactly as the buyer's own address is.
    const group = (email: string): ReserveBody => ({
      buyer: { email: 'admin@example.com' },
      attendees: [
        { email: 'one@example.com', ticketTypeId: 't1' },
        { email, ticketTypeId: 't1' },
      ],
    })
    expect(scopeKeyFor(group('two@example.com'))).not.toBe(scopeKeyFor(group('three@example.com')))
  })

  it('separates a changed seat count on the group path', () => {
    const body = (n: number): ReserveBody => ({
      buyer: { email: 'admin@example.com' },
      attendees: Array.from({ length: n }, (_, i) => ({
        email: `a${i}@example.com`,
        ticketTypeId: 't1',
      })),
    })
    expect(scopeKeyFor(body(2))).not.toBe(scopeKeyFor(body(3)))
  })

  it('is stable for an identical resubmission, which is the whole point', () => {
    expect(scopeKeyFor(single('a@example.com'))).toBe(scopeKeyFor(single('a@example.com')))
  })
})

describe('event-registration key lifecycle', () => {
  it('recomputes the scope on every submission rather than at construction', () => {
    // The key was cached against a scope fixed in the constructor, so an edit between
    // attempts could not change it. Asserted on the source because the lifecycle lives
    // in getIdempotencyKey, which needs a DOM and a form to run.
    expect(SOURCE).toContain('var scopeKey = this.scopeKeyFor(body)')
    expect(SOURCE).toContain('if (scopeKey !== this.idemScopeKey)')
    expect(SOURCE).not.toContain("this.idemStorageKey = 'evt-idem:' + cfg.workerEventId")
  })

  it('passes the body in at the call site, or the scope cannot be computed', () => {
    expect(SOURCE).toContain("'Idempotency-Key': this.getIdempotencyKey(body)")
  })
})
