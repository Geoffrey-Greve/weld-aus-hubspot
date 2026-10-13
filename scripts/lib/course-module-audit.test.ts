import { describe, expect, it } from 'vitest'
import { type HubDbRow } from './event-engine-audit'
import {
  auditCourseModules,
  parseSessionId,
  resolveModuleSession,
  type ModuleAuditCode
} from './course-module-audit'

const TODAY = '2026-09-18'

/** A parent course row: the page the module section renders on. */
function courseRow(values: Record<string, unknown> = {}, id = '900'): HubDbRow {
  return {
    id,
    values: {
      course_name: 'IIW Welding Engineer (IWE)',
      course_id: 'iwe',
      use_event_engine: true,
      worker_event_id: 'evt_iwe',
      ...values
    }
  }
}

/** A session row a module's booking URL can point at. */
function sessionRow(values: Record<string, unknown> = {}, id = '101'): HubDbRow {
  return {
    id,
    values: {
      course_name: 'IWE Module 1',
      course_id: 'iwe',
      start_date: '2026-11-02',
      end_date: '2026-11-06',
      price_non_member: 1800,
      worker_event_id: 'evt_m1',
      member_ticket_type_id: 'tt_member',
      non_member_ticket_type_id: 'tt_standard',
      ...values
    }
  }
}

function moduleRow(values: Record<string, unknown> = {}, id = '1'): HubDbRow {
  return {
    id,
    values: {
      name: 'IWE Module 1',
      parent_course_id: 'iwe',
      module_order: 1,
      show_on_website: true,
      module_booking_url: 'https://weldaustralia.com.au/checkout/?session_id=101',
      ...values
    }
  }
}

function run(input: Parameters<typeof auditCourseModules>[0]) {
  return auditCourseModules({ today: TODAY, siteHost: 'weldaustralia.com.au', ...input })
}

function codes(result: ReturnType<typeof auditCourseModules>): ModuleAuditCode[] {
  return result.findings.map((f) => f.code)
}

describe('parseSessionId', () => {
  it('reads session_id, then event_id as the alternate spelling', () => {
    expect(parseSessionId('/checkout/?session_id=101')).toBe('101')
    expect(parseSessionId('https://x/checkout?event_id=202')).toBe('202')
    expect(parseSessionId('/checkout/?event_id=202&session_id=101')).toBe('101')
  })

  it('is empty for a URL that names no session', () => {
    expect(parseSessionId('/training/')).toBe('')
    expect(parseSessionId('')).toBe('')
    expect(parseSessionId('mailto:training@weldaustralia.com.au')).toBe('')
  })
})

describe('resolveModuleSession', () => {
  const courses = new Map([['101', sessionRow()]])
  const events = new Map<string, HubDbRow>([
    [
      '202',
      {
        id: '202',
        values: {
          event_name: 'Welding Awards 2026',
          event_date: '2026-11-20',
          worker_event_id: 'evt_awards',
          ticket_types_json: JSON.stringify([
            { worker_ticket_type_id: 'tt_pub', price_dollars: 150, member_only: false }
          ])
        }
      }
    ]
  ])

  it('prefers a courses row carrying a worker_event_id', () => {
    const session = resolveModuleSession('/checkout/?session_id=101', courses, events, TODAY)
    expect(session.source).toBe('courses')
    expect(session.workerEventId).toBe('evt_m1')
    expect(session.publicPrice).toBe(1800)
  })

  it('falls through to events, reading the price off the public ticket', () => {
    const session = resolveModuleSession('/checkout/?event_id=202', courses, events, TODAY)
    expect(session.source).toBe('events')
    expect(session.nonMemberTicketTypeId).toBe('tt_pub')
    expect(session.publicPrice).toBe(150)
  })

  it('treats Cancelled and Sold Out as off sale, naming which', () => {
    const cancelled = new Map([['101', sessionRow({ status: { name: 'Cancelled' } })]])
    expect(resolveModuleSession('?session_id=101', cancelled, events, TODAY).offSaleLabel).toBe(
      'Cancelled'
    )
  })

  it('closes a session that has already started, and leaves a dateless one alone', () => {
    const past = new Map([['101', sessionRow({ start_date: '2026-08-04' })]])
    expect(resolveModuleSession('?session_id=101', past, events, TODAY).offSaleLabel).toBe(
      'Registrations closed'
    )
    const undated = new Map([['101', sessionRow({ start_date: '', end_date: '' })]])
    expect(resolveModuleSession('?session_id=101', undated, events, TODAY).offSale).toBe(false)
  })
})

describe('auditCourseModules', () => {
  it('reports nothing for a fully wired course, and counts it bookable', () => {
    const result = run({
      moduleRows: [moduleRow()],
      courseRows: [courseRow(), sessionRow()],
      moduleColumns: ['parent_course_id', 'name', 'module_booking_url', 'show_on_website']
    })
    expect(result.findings).toEqual([])
    expect(result.courses[0]).toMatchObject({ modules: 1, resolved: 1, selectable: 1 })
  })

  it('names the missing column once, instead of every row that reads it', () => {
    // The production Ref 46 shape: the template is current, the column was never
    // seeded, so every module renders the "Contact to book" mailto.
    const result = run({
      moduleRows: [
        moduleRow({ module_booking_url: '' }, '1'),
        moduleRow({ module_booking_url: '' }, '2')
      ],
      courseRows: [courseRow()],
      moduleColumns: ['parent_course_id', 'name', 'show_on_website']
    })
    expect(codes(result)).toEqual(['booking_url_column_missing'])
    expect(result.courses[0]).toMatchObject({ selectable: 0 })
  })

  it('reports a blank URL per row when the column DOES exist', () => {
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '' })],
      courseRows: [courseRow()],
      moduleColumns: ['module_booking_url']
    })
    expect(codes(result)).toEqual(['module_no_booking_url'])
  })

  it('says nothing about the column when the schema could not be read', () => {
    // An unreadable schema is not evidence of a missing column: "cannot see" is
    // never "not there", or the report sends somebody re-seeding a sound table.
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '' })],
      courseRows: [courseRow()]
    })
    expect(codes(result)).toEqual(['module_no_booking_url'])
  })

  it('catches a booking URL left pointing at the other portal', () => {
    const result = run({
      moduleRows: [
        moduleRow({ module_booking_url: 'https://weldaustralia.dev/checkout?session_id=101' })
      ],
      courseRows: [courseRow(), sessionRow()]
    })
    expect(codes(result)).toContain('module_url_foreign_host')
  })

  it('leaves a third-party booking host alone', () => {
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: 'https://events.hapily.com/x?session_id=101' })],
      courseRows: [courseRow(), sessionRow()]
    })
    expect(codes(result)).not.toContain('module_url_foreign_host')
  })

  it('flags several modules sharing one session, and one pointing at another course', () => {
    // Ref 46 round 2: four IWI-S modules all resolving to a single session, and
    // an AS1796 module whose URL opened the Welding Awards checkout.
    const result = run({
      moduleRows: [
        moduleRow({}, '1'),
        moduleRow({ name: 'IWE Module 2' }, '2'),
        moduleRow({ name: 'IWE Module 3', module_booking_url: '?session_id=777' }, '3')
      ],
      courseRows: [courseRow(), sessionRow(), sessionRow({ course_id: 'awards' }, '777')]
    })
    expect(codes(result).filter((c) => c === 'module_session_shared')).toHaveLength(2)
    expect(codes(result)).toContain('module_session_other_course')
  })

  it('reports an unresolvable id rather than silently counting it clean', () => {
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '/checkout/?session_id=999' })],
      courseRows: [courseRow()]
    })
    expect(codes(result)).toEqual(['module_session_not_found'])
    expect(result.courses[0]).toMatchObject({ resolved: 0 })
  })

  it('separates a session with no worker id, no guest ticket, and no price', () => {
    const result = run({
      moduleRows: [
        moduleRow({}, '1'),
        moduleRow({ name: 'M2', module_booking_url: '?session_id=102' }, '2'),
        moduleRow({ name: 'M3', module_booking_url: '?session_id=103' }, '3')
      ],
      courseRows: [
        courseRow(),
        sessionRow({ worker_event_id: '' }, '101'),
        sessionRow({ non_member_ticket_type_id: '' }, '102'),
        sessionRow({ price_non_member: 0 }, '103')
      ]
    })
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        'module_not_bookable',
        'module_guest_ticket_missing',
        'module_zero_price'
      ])
    )
    expect(result.courses[0]).toMatchObject({ selectable: 0 })
  })

  it('reports an off-sale module as a note, not a fault', () => {
    const result = run({
      moduleRows: [moduleRow()],
      courseRows: [courseRow(), sessionRow({ start_date: '2026-08-04', end_date: '2026-08-08' })]
    })
    expect(codes(result)).toEqual(['module_off_sale'])
    expect(result.summary.errors).toBe(0)
    expect(result.summary.infos).toBe(1)
  })

  it('reports a parent that is not engine ready, because it switches every tickbox off', () => {
    const result = run({
      moduleRows: [moduleRow()],
      courseRows: [courseRow({ use_event_engine: false }), sessionRow()]
    })
    expect(codes(result)).toContain('parent_not_engine_ready')
    // The module itself is perfectly wired; the page still cannot sell it.
    expect(result.courses[0]).toMatchObject({ resolved: 1, selectable: 0 })
  })

  it('stays quiet about a sibling session row that is not itself engine ticked', () => {
    // Every session of a course shares its course_id, and most are wired for
    // their own Register CTA rather than for this page. Raising a finding per
    // unticked sibling would bury the courses where nothing is ready at all.
    const result = run({
      moduleRows: [moduleRow()],
      courseRows: [
        courseRow({}, '900'),
        courseRow({ use_event_engine: false }, '901'),
        sessionRow()
      ]
    })
    expect(result.findings).toEqual([])
  })

  it('reports modules attached to a course_id no course row carries', () => {
    const result = run({
      moduleRows: [moduleRow({ parent_course_id: 'typo' })],
      courseRows: [courseRow(), sessionRow()]
    })
    const finding = result.findings.find((f) => f.code === 'parent_course_missing')
    expect(finding?.detail).toContain('never render at all')
    expect(finding?.severity).toBe('error')
  })

  it('does not call a missing course an unticked box', () => {
    // Different faults, different owners, different fixes: one is a row edit by
    // whoever wires sessions, the other is a typo in parent_course_id or a course
    // that was never migrated into `courses`. Sharing one code buried the single
    // genuine wiring finding under seventeen missing courses on production, and
    // left a --json consumer unable to separate them.
    const codes = run({
      moduleRows: [moduleRow({ parent_course_id: 'typo' })],
      courseRows: [courseRow(), sessionRow()]
    }).findings.map((f) => f.code)
    expect(codes).toContain('parent_course_missing')
    expect(codes).not.toContain('parent_not_engine_ready')
  })

  it('still calls an unticked box an unticked box', () => {
    const codes = run({
      moduleRows: [moduleRow()],
      courseRows: [courseRow({ use_event_engine: false })]
    }).findings.map((f) => f.code)
    expect(codes).toContain('parent_not_engine_ready')
    expect(codes).not.toContain('parent_course_missing')
  })

  it('does not print the course id twice when it is all the label has', () => {
    // "course_id welding-symbols (course_id welding-symbols)" is a report telling
    // the reader it does not know what it is looking at.
    const finding = run({
      moduleRows: [moduleRow({ parent_course_id: 'welding-symbols' })],
      courseRows: [courseRow(), sessionRow()]
    }).findings.find((f) => f.code === 'parent_course_missing')
    expect(finding?.label).toBe('course_id welding-symbols')
  })

  it('skips rows with Show on Website unticked unless asked for them', () => {
    const rows = [moduleRow({ show_on_website: false, module_booking_url: '' })]
    expect(run({ moduleRows: rows, courseRows: [courseRow()] }).findings).toEqual([])
    expect(
      run({ moduleRows: rows, courseRows: [courseRow()], includeHidden: true }).findings
    ).toHaveLength(1)
  })
})

describe('course-module audit: the product-id join', () => {
  it('resolves a module with no booking URL at all', () => {
    // events-engine migration 0031: "The Course Modules HubDB table identifies a
    // module by its HubSpot Product ID." A `courses` row carrying the same id IS
    // the module's session, so nothing needs typing into module_booking_url.
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '', hubspot_product_id: '2618' })],
      courseRows: [courseRow(), sessionRow({ module_product_id: '2618', is_module: true })],
      today: TODAY
    })
    expect(codes(result)).not.toContain('module_no_booking_url')
    expect(codes(result)).not.toContain('module_session_not_created')
    expect(result.courses[0]?.resolved).toBe(1)
  })

  it('prefers the soonest sitting still on sale over one that has run', () => {
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '', hubspot_product_id: '2618' })],
      courseRows: [
        courseRow(),
        sessionRow({ module_product_id: '2618', is_module: true, start_date: '2026-03-02' }, '101'),
        sessionRow({ module_product_id: '2618', is_module: true, start_date: '2026-11-02' }, '102')
      ],
      today: TODAY
    })
    // The March sitting has run; the November one is what a buyer can take.
    expect(codes(result)).not.toContain('module_off_sale')
    expect(result.courses[0]?.selectable).toBe(1)
  })

  it('keeps an off-sale module visible rather than unresolved', () => {
    // No sitting is on sale, so the soonest overall is kept and BADGED - dropping
    // the row would leave a module nobody can see the state of.
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '', hubspot_product_id: '2618' })],
      courseRows: [
        courseRow(),
        sessionRow({ module_product_id: '2618', is_module: true, start_date: '2026-03-02' }, '101')
      ],
      today: TODAY
    })
    expect(codes(result)).toContain('module_off_sale')
    expect(codes(result)).not.toContain('module_session_not_created')
  })

  it('never lets a whole-course row answer for a module (Ref 46)', () => {
    // Production's parent course rows were given their full-course Product ID. A
    // module sharing that id must not resolve to the parent session, or the selector
    // sells the whole course, at its price, under the module's name.
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '', hubspot_product_id: '2618' })],
      courseRows: [courseRow({ module_product_id: '2618' })],
      today: TODAY
    })
    expect(codes(result)).toContain('module_session_not_created')
    expect(result.courses[0]?.resolved).toBe(0)
  })

  it('names the session row to create, not a URL to type', () => {
    const result = run({
      moduleRows: [moduleRow({ module_booking_url: '', hubspot_product_id: '2618' })],
      courseRows: [courseRow()],
      today: TODAY
    })
    expect(codes(result)).toContain('module_session_not_created')
    const finding = result.findings.find((f) => f.code === 'module_session_not_created')
    expect(finding?.detail).toContain('2618')
    expect(finding?.fix).toContain('module_product_id')
    expect(finding?.fix).toContain('is_module')
  })

  it('reports a missing module_product_id column once, not per row', () => {
    const result = run({
      moduleRows: [
        moduleRow({ module_booking_url: '', hubspot_product_id: '2618' }, '1'),
        moduleRow({ module_booking_url: '', hubspot_product_id: '2619' }, '2')
      ],
      courseRows: [courseRow()],
      courseColumns: ['course_id', 'worker_event_id'],
      today: TODAY
    })
    expect(codes(result).filter((c) => c === 'product_id_column_missing')).toHaveLength(1)
    expect(codes(result)).not.toContain('module_session_not_created')
  })

  it('stops blaming a foreign host once the product id resolves the module', () => {
    // The URL is never followed when a courses row claims the product id, so its
    // host cannot send anybody anywhere.
    const result = run({
      moduleRows: [
        moduleRow({
          module_booking_url: 'https://weldaustralia.dev/checkout/?session_id=101',
          hubspot_product_id: '2618'
        })
      ],
      courseRows: [courseRow(), sessionRow({ module_product_id: '2618', is_module: true })],
      siteHost: 'weldaustralia.com.au',
      today: TODAY
    })
    expect(codes(result)).not.toContain('module_url_foreign_host')
  })

  it('still resolves from the booking URL when no row claims the product id', () => {
    const result = run({
      moduleRows: [moduleRow({ hubspot_product_id: '2618' })],
      courseRows: [courseRow(), sessionRow()],
      today: TODAY
    })
    expect(result.courses[0]?.resolved).toBe(1)
    expect(codes(result)).not.toContain('module_session_not_created')
  })
})
