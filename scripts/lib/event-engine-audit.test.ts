import { describe, expect, it } from 'vitest'
import {
  auditRow,
  auditRows,
  classifyRegistrationUrl,
  COURSES_ADAPTER,
  EVENTS_ADAPTER,
  isoDate,
  skipReason,
  truthy,
  type HubDbRow
} from './event-engine-audit'

const TODAY = '2026-09-17'

/** A course session that is correctly wired to the Event Engine. */
function course(values: Record<string, unknown> = {}): HubDbRow {
  return {
    id: '101',
    values: {
      course_name: 'AS1796 Cert 10',
      city: { name: 'Adelaide' },
      start_date: '2026-10-12',
      end_date: '2026-10-16',
      use_event_engine: true,
      worker_event_id: 'evt_abc',
      member_ticket_type_id: 'tt_member',
      non_member_ticket_type_id: 'tt_standard',
      registration_url: '',
      ...values
    }
  }
}

function event(values: Record<string, unknown> = {}): HubDbRow {
  return {
    id: '202',
    values: {
      event_name: 'Welding Technology Breakfast',
      city: 'Melbourne',
      event_date: '2026-11-03',
      use_event_engine: true,
      worker_event_id: 'evt_xyz',
      ticket_types_json: JSON.stringify([
        { worker_ticket_type_id: 'tt_standard', member_only: false }
      ]),
      ...values
    }
  }
}

function codes(row: HubDbRow, adapter = COURSES_ADAPTER): string[] {
  return auditRow(row, adapter).map((f) => f.code)
}

describe('the forgotten tickbox', () => {
  it('flags a row wired to the Event Engine but left unticked', () => {
    const findings = auditRow(course({ use_event_engine: false }), COURSES_ADAPTER)
    const finding = findings.find((f) => f.code === 'unticked_with_worker_id')
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('warn')
    // The direct-checkout hole is the part a reader would not guess, so it has
    // to survive in the message rather than only in the docs.
    expect(finding!.detail).toContain('/checkout/?session_id=101')
    expect(finding!.detail).toContain('evt_abc')
  })

  it('uses the event_id param for rows from the events table', () => {
    const findings = auditRow(event({ use_event_engine: false }), EVENTS_ADAPTER)
    const finding = findings.find((f) => f.code === 'unticked_with_worker_id')
    expect(finding!.detail).toContain('/checkout/?event_id=202')
  })

  it('does not promise a booking the checkout cannot take', () => {
    // Claiming the direct URL transacts, and telling the editor to tick the box,
    // would send every CTA into a checkout that dead-ends at payment.
    const noTickets = course({
      use_event_engine: false,
      member_ticket_type_id: '',
      non_member_ticket_type_id: '',
      registration_url: 'https://events.hapily.com/weld/as1796'
    })
    const finding = auditRow(noTickets, COURSES_ADAPTER).find(
      (f) => f.code === 'unticked_with_worker_id'
    )!
    expect(finding.detail).toContain('cannot complete for anyone')
    expect(finding.detail).not.toContain('still takes a real booking')
    expect(finding.fix).toContain('Add a ticket type BEFORE ticking')
  })

  it('says member-only when the row has a member ticket but no guest ticket', () => {
    const memberOnly = course({
      use_event_engine: false,
      non_member_ticket_type_id: '',
      registration_url: 'https://events.hapily.com/weld/as1796'
    })
    const finding = auditRow(memberOnly, COURSES_ADAPTER).find(
      (f) => f.code === 'unticked_with_worker_id'
    )!
    expect(finding.detail).toContain('only completes for logged-in members')
    expect(finding.fix).toContain('Tick use_event_engine')
  })

  it('does not flag an unticked row that was never wired', () => {
    expect(
      codes(
        course({
          use_event_engine: false,
          worker_event_id: '',
          member_ticket_type_id: '',
          non_member_ticket_type_id: '',
          registration_url: 'https://events.hapily.com/weld/as1796'
        })
      )
    ).toEqual([])
  })

  it('treats every HubDB truthy shape as ticked', () => {
    for (const ticked of [true, 1, '1', 'true', 'TRUE', 'yes']) {
      expect(codes(course({ use_event_engine: ticked }))).toEqual([])
    }
    for (const unticked of [false, 0, '0', 'false', '', null, undefined]) {
      expect(truthy(unticked)).toBe(false)
      expect(codes(course({ use_event_engine: unticked }))).toContain('unticked_with_worker_id')
    }
  })
})

describe('ticked but unbookable', () => {
  it('warns, not errors, when the box is ticked with no worker event', () => {
    // The theme degrades this row to its legacy registration URL rather than
    // dead-ending the buyer, so it is a config mismatch and not a broken page.
    const findings = auditRow(
      course({ worker_event_id: '', registration_url: 'https://events.hapily.com/weld/as1796' }),
      COURSES_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual(['ticked_no_worker_id'])
    expect(findings[0]!.severity).toBe('warn')
  })

  it('also demands a fallback URL from a ticked-but-unwired row', () => {
    // It is on the legacy flow in practice, so it needs a working URL just as
    // much as an unticked row does. Keying this off the raw tick missed it.
    const findings = auditRow(
      course({ worker_event_id: '', registration_url: '' }),
      COURSES_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual([
      'ticked_no_worker_id',
      'no_usable_registration_url'
    ])
  })

  it('errors when no ticket type is configured', () => {
    const findings = auditRow(
      course({ member_ticket_type_id: '', non_member_ticket_type_id: '' }),
      COURSES_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual(['ticked_no_ticket_type'])
    expect(findings[0]!.severity).toBe('error')
  })

  it('errors on a course with only a member ticket', () => {
    // The courses table has no members-only column, so a course can never
    // declare the intent - guests are offered the form and then dead-ended.
    const findings = auditRow(course({ non_member_ticket_type_id: '' }), COURSES_ADAPTER)
    expect(findings.map((f) => f.code)).toEqual(['guest_ticket_missing'])
    expect(findings[0]!.severity).toBe('error')
  })

  it('does not stack a missing-worker warning with a missing-ticket error', () => {
    // One row, one fault to fix first. The worker id is the blocker, and
    // without it the checkout is never reached for the tickets to matter.
    expect(
      codes(
        course({
          worker_event_id: '',
          non_member_ticket_type_id: '',
          member_ticket_type_id: '',
          registration_url: 'https://events.hapily.com/weld/as1796'
        })
      )
    ).toEqual(['ticked_no_worker_id'])
  })
})

describe('events ticket_types_json', () => {
  it('reads the first non-member ticket as the guest ticket', () => {
    expect(codes(event(), EVENTS_ADAPTER)).toEqual([])
  })

  it('accepts a bare id when worker_ticket_type_id is absent', () => {
    expect(
      codes(
        event({ ticket_types_json: JSON.stringify([{ id: 'tt_1', member_only: false }]) }),
        EVENTS_ADAPTER
      )
    ).toEqual([])
  })

  const MEMBER_ONLY_TICKETS = JSON.stringify([
    { worker_ticket_type_id: 'tt_member', member_only: true }
  ])

  it('accepts a member-only ticket list on a row flagged members-only', () => {
    // event-detail.html gates guests on is_members_only, so with the flag set
    // nobody is ever handed a form they cannot complete.
    const findings = auditRow(
      event({ ticket_types_json: MEMBER_ONLY_TICKETS, is_members_only: true }),
      EVENTS_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual(['members_only_ticket'])
    expect(findings[0]!.severity).toBe('info')
  })

  it('errors on a member-only ticket list when the row is NOT flagged members-only', () => {
    // The gate is `(not is_members_only) or contact_is_active`, so with the flag
    // off a logged-out visitor gets the booking form and then "not configured".
    // Reporting this as info let --strict pass on a guest dead end.
    const findings = auditRow(
      event({ ticket_types_json: MEMBER_ONLY_TICKETS, is_members_only: false }),
      EVENTS_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual(['guest_ticket_missing'])
    expect(findings[0]!.severity).toBe('error')
  })

  it('treats unparseable or empty JSON as no ticket types rather than throwing', () => {
    for (const bad of ['{not json', '', '{}', '[]', null]) {
      expect(codes(event({ ticket_types_json: bad }), EVENTS_ADAPTER)).toEqual([
        'ticked_no_ticket_type'
      ])
    }
  })

  it('ignores tickets carrying no id at all', () => {
    expect(
      codes(event({ ticket_types_json: JSON.stringify([{ member_only: false }]) }), EVENTS_ADAPTER)
    ).toEqual(['ticked_no_ticket_type'])
  })
})

describe('registration_url fallback', () => {
  it('classifies a blank or placeholder URL as missing', () => {
    expect(classifyRegistrationUrl('')).toBe('missing')
    expect(classifyRegistrationUrl('   ')).toBe('missing')
    expect(classifyRegistrationUrl('#')).toBe('missing')
    expect(classifyRegistrationUrl(null)).toBe('missing')
  })

  it('classifies a URL pointing back into the site as self-referential', () => {
    expect(classifyRegistrationUrl('/courses/as1796-cert-10')).toBe('self-referential')
    expect(classifyRegistrationUrl('https://weldaustralia.com.au/courses/as1796')).toBe(
      'self-referential'
    )
    expect(classifyRegistrationUrl('https://www.weldaustralia.com.au/events/breakfast')).toBe(
      'self-referential'
    )
  })

  it('classifies a real external booking URL as usable', () => {
    expect(classifyRegistrationUrl('https://events.hapily.com/weld/as1796')).toBe('usable')
    expect(classifyRegistrationUrl('https://weldaustralia.com.au/contact')).toBe('usable')
  })

  it('warns when a legacy row has nowhere to send the buyer', () => {
    const findings = auditRow(
      course({ use_event_engine: false, worker_event_id: '', registration_url: '' }),
      COURSES_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual(['no_usable_registration_url'])
    expect(findings[0]!.detail).toContain('mailto:')
  })

  it('warns when a legacy row links back at itself', () => {
    const findings = auditRow(
      course({
        use_event_engine: false,
        worker_event_id: '',
        registration_url: '/courses/as1796-cert-10'
      }),
      COURSES_ADAPTER
    )
    expect(findings.map((f) => f.code)).toEqual(['no_usable_registration_url'])
  })

  it('does not check registration_url on a ticked row - the CTA never uses it', () => {
    expect(codes(course({ registration_url: '' }))).toEqual([])
  })

  it('reports both faults when a row is wired, unticked and has no fallback', () => {
    expect(codes(course({ use_event_engine: false, registration_url: '' }))).toEqual([
      'unticked_with_worker_id',
      'no_usable_registration_url'
    ])
  })
})

/**
 * QA ref 121. Weld entered a TryBooking link on the SA Open Day row and the yellow
 * "Register Now" button kept booking on-site. Neither value is wrong on its own,
 * both look right in the HubDB UI, and only the relationship between them is the
 * fault - so, like ref 86, it needs a report.
 */
describe('ticked AND carrying an external registration URL', () => {
  it('reports a course row that books on-site and also holds a working URL', () => {
    const findings = auditRow(
      course({ registration_url: 'https://www.trybooking.com/AUABC' }),
      COURSES_ADAPTER
    )
    const finding = findings.find((f) => f.code === 'ticked_with_external_url')
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('info')
    expect(finding!.detail).toContain('https://www.trybooking.com/AUABC')
    expect(finding!.fix).toContain('untick use_event_engine')
  })

  it('reports it on an events row too - that is where it was found', () => {
    expect(
      codes(event({ registration_url: 'https://www.trybooking.com/AUABC' }), EVENTS_ADAPTER)
    ).toContain('ticked_with_external_url')
  })

  it('says nothing when the row carries no URL at all', () => {
    expect(codes(course())).toEqual([])
  })

  it('says nothing about a URL that points back into the site', () => {
    // Not a destination anybody meant to send a buyer to, and the row is not on
    // the legacy flow, so there is no ambiguity to report.
    expect(codes(course({ registration_url: '/courses/as1796-cert-10' }))).toEqual([])
  })

  it('says nothing when the row is NOT booking on-site', () => {
    // An external URL is the whole point of a legacy row. Reporting it there
    // would fire on most of the table.
    expect(
      codes(
        course({
          use_event_engine: false,
          worker_event_id: '',
          registration_url: 'https://www.trybooking.com/AUABC'
        })
      )
    ).toEqual([])
  })

  it('never trips --strict on its own: info, so a correct row is not a failure', () => {
    const findings = auditRow(
      course({ registration_url: 'https://www.trybooking.com/AUABC' }),
      COURSES_ADAPTER
    )
    expect(findings.every((f) => f.severity === 'info')).toBe(true)
  })
})

describe('which rows are worth auditing', () => {
  it('skips a cancelled session', () => {
    expect(
      skipReason(course({ status: { name: 'Cancelled' } }), COURSES_ADAPTER, { today: TODAY })
    ).toBe('cancelled')
  })

  it('skips a session that has already finished', () => {
    const past = course({ start_date: '2026-03-02', end_date: '2026-03-06' })
    expect(skipReason(past, COURSES_ADAPTER, { today: TODAY })).toBe('past')
    expect(skipReason(past, COURSES_ADAPTER, { today: TODAY, includePast: true })).toBeNull()
  })

  it('keeps a multi-day course that started yesterday and is still running', () => {
    const running = course({ start_date: '2026-09-16', end_date: '2026-09-20' })
    expect(skipReason(running, COURSES_ADAPTER, { today: TODAY })).toBeNull()
  })

  it('never assumes an undated row is past', () => {
    const undated = course({ start_date: '', end_date: '' })
    expect(skipReason(undated, COURSES_ADAPTER, { today: TODAY })).toBeNull()
  })

  it('reads epoch-millis dates as well as ISO strings', () => {
    expect(isoDate(Date.UTC(2026, 9, 12))).toBe('2026-10-12')
    expect(isoDate('2026-10-12')).toBe('2026-10-12')
    expect(isoDate(String(Date.UTC(2026, 9, 12)))).toBe('2026-10-12')
    expect(isoDate('')).toBe('')
    expect(isoDate('not a date')).toBe('')
  })
})

describe('auditRows', () => {
  const rows = [
    course({ course_name: 'Clean' }),
    // Wired but unticked, with a working legacy URL - isolates the headline finding.
    {
      ...course({
        use_event_engine: false,
        registration_url: 'https://events.hapily.com/weld/as1796'
      }),
      id: '102'
    },
    // Reaches the checkout and has nothing to sell there: the one real dead end.
    { ...course({ member_ticket_type_id: '', non_member_ticket_type_id: '' }), id: '103' },
    { ...course({ status: { name: 'Cancelled' }, use_event_engine: false }), id: '104' },
    { ...course({ start_date: '2026-01-05', end_date: '2026-01-09' }), id: '105' }
  ]

  it('counts what it examined, skipped and cleared', () => {
    const { summary } = auditRows(rows, COURSES_ADAPTER, { today: TODAY })
    expect(summary.examined).toBe(3)
    expect(summary.skipped).toBe(2) // cancelled + past
    expect(summary.clean).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.warnings).toBe(1)
  })

  it('sorts errors above warnings so the report leads with what is broken', () => {
    const { findings } = auditRows(rows, COURSES_ADAPTER, { today: TODAY })
    expect(findings.map((f) => f.severity)).toEqual(['error', 'warn'])
  })

  it('returns nothing for an empty table', () => {
    const { findings, summary } = auditRows([], COURSES_ADAPTER, { today: TODAY })
    expect(findings).toEqual([])
    expect(summary.examined).toBe(0)
  })
})

describe('row labels', () => {
  it('names the row so an editor can find it in HubDB', () => {
    const [finding] = auditRow(course({ use_event_engine: false }), COURSES_ADAPTER)
    expect(finding!.label).toBe('AS1796 Cert 10 - Adelaide, 2026-10-12 (row 101)')
  })

  it('falls back to the HubDB row name when the name column is blank', () => {
    const row: HubDbRow = {
      id: '9',
      name: 'Imported row 9',
      values: { use_event_engine: false, worker_event_id: 'evt_1' }
    }
    const [finding] = auditRow(row, COURSES_ADAPTER)
    expect(finding!.label).toBe('Imported row 9 (row 9)')
  })
})

/**
 * QA ref 73 / events-engine migration 0044. An events row states its prices in two
 * places - the named columns and a price per entry in `ticket_types_json` - and since
 * 0044 the named columns win, on the page and in the Worker alike. So wherever the two
 * disagree, a figure the tenant typed has quietly stopped being the one anybody pays,
 * and no page shows it: the page renders one number and gives no hint a second exists.
 */
describe('two price sources on one events row', () => {
  const twoPriced = (values: Record<string, unknown> = {}) =>
    event({
      non_member_price: 550,
      ticket_types_json: JSON.stringify([
        { worker_ticket_type_id: 'tt_standard', member_only: false, price_dollars: 500 },
        { worker_ticket_type_id: 'tt_member', member_only: true, price_dollars: 450 }
      ]),
      ...values
    })

  it('reports the guest price stated twice, with both figures and the winner', () => {
    const finding = auditRow(twoPriced(), EVENTS_ADAPTER).find(
      (f) => f.code === 'price_columns_shadow_ticket_json'
    )
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('info')
    expect(finding!.detail).toContain('non_member_price says $550.00')
    expect(finding!.detail).toContain('$500.00')
    expect(finding!.detail).toContain('$550.00 is what the buyer is quoted and invoiced')
    expect(finding!.fix).toContain('non_member_price')
  })

  it('reports the member price separately, because they are two edits', () => {
    const findings = auditRow(
      twoPriced({ member_price: 400, non_member_price: 500 }),
      EVENTS_ADAPTER
    ).filter((f) => f.code === 'price_columns_shadow_ticket_json')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.detail).toContain('member price')
    expect(findings[0]!.detail).toContain('member_price says $400.00')
  })

  it('says nothing when the two agree', () => {
    expect(
      codes(twoPriced({ member_price: 450, non_member_price: 500 }), EVENTS_ADAPTER)
    ).not.toContain('price_columns_shadow_ticket_json')
  })

  it('says nothing when the column is blank — that is a fallback, not a disagreement', () => {
    // An unset column resolves to nothing on the page and to null in the Worker, and
    // both sides then keep the ticket type's own price.
    expect(codes(twoPriced({ non_member_price: '' }), EVENTS_ADAPTER)).not.toContain(
      'price_columns_shadow_ticket_json'
    )
  })

  it('reads a column the tenant typed as "$500.00" the same as 500', () => {
    // A currency column comes back as a formatted string often enough that reading it
    // literally would report a disagreement on every correctly-keyed row.
    expect(
      codes(twoPriced({ non_member_price: '$500.00' }), EVENTS_ADAPTER)
    ).not.toContain('price_columns_shadow_ticket_json')
  })

  it('never fires on a course row — it has one price source', () => {
    expect(
      codes(course({ price_non_member: 2555, price_member: 2280 }), COURSES_ADAPTER)
    ).not.toContain('price_columns_shadow_ticket_json')
  })
})

/**
 * A URL on HubSpot's own hosted domain is the SITE, not somewhere else.
 *
 * Weld's production run reported three course rows as `ticked_with_external_url` over
 * `https://441838610.hs-sites-ap1.com/checkout/?session_id=...` — the portal's own
 * checkout, called external because the host did not match the custom domain. That
 * finding's remedy says to untick `use_event_engine` so the CTA follows the URL, which
 * would send the buyer to the on-site checkout for whatever session id the link carries.
 */
describe('the portal serves more than one hostname', () => {
  it.each([
    'https://weldaustralia.com.au/courses/iwi-s',
    'https://www.weldaustralia.com.au/checkout/?session_id=123',
    'https://441838610.hs-sites-ap1.com/checkout/?session_id=346457798087',
    'https://441838610.hs-sites.com/events/gala-2026',
    'https://441838610.hubspotpagebuilder-eu1.com/courses/iwe',
    '/checkout/?session_id=123',
    '/courses/iwi-s'
  ])('reads %s as the site itself', (url) => {
    expect(classifyRegistrationUrl(url)).toBe('self-referential')
  })

  it.each([
    'https://www.trybooking.com/AUABC',
    'https://events.weldaustralia.com.au.evil.example/x',
    'https://hs-sites-ap1.com.evil.example/x',
    'https://zoom.us/webinar/register/123'
  ])('still reads %s as a real external booking page', (url) => {
    expect(classifyRegistrationUrl(url)).toBe('usable')
  })

  it('stops calling the portal’s own checkout an external URL', () => {
    const row = course({
      registration_url: 'https://441838610.hs-sites-ap1.com/checkout/?session_id=346457798087'
    })
    expect(codes(row, COURSES_ADAPTER)).not.toContain('ticked_with_external_url')
  })

  it('and reports it as no usable fallback once the tick comes off', () => {
    // The state the mislabelling hid: unticked, the CTA follows this URL, and it goes to
    // the on-site checkout for a session id that is not this row's.
    const row = course({
      use_event_engine: false,
      worker_event_id: '',
      registration_url: 'https://441838610.hs-sites-ap1.com/checkout/?session_id=346457798087'
    })
    expect(codes(row, COURSES_ADAPTER)).toContain('no_usable_registration_url')
  })
})
