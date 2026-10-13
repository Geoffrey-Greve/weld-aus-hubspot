/**
 * The course-page routing rules.
 *
 * QA ref 86: "Welding Supervisor Mackay (26 October) shows as open but when you
 * go to register, shows Maryborough training schedule and no courses available.
 * Course modules are wrong." One card, one click, a different course's sessions
 * and a different course's modules.
 *
 * The mechanism: a directory card links to `/courses/<course_slug>`, HubSpot
 * serves that path from the one row whose `hs_path` matches, and the page then
 * derives its whole schedule from THAT row's `course_id`. Two different keys,
 * nothing keeping them in step. These tests pin the rules that name it.
 */
import { describe, expect, it } from 'vitest'
import { auditCourseRouting, type RoutingCode } from './course-routing-audit'
import type { HubDbRow } from './event-engine-audit'

let nextId = 1

/**
 * A `courses` row shaped the way the HubDB v3 API returns one.
 *
 * `hs_path` is lifted OUT of the column values onto the row, because that is
 * where HubSpot puts it: the dynamic page path is a row-level field, and no
 * table carries a column of that name. Building these rows the other way round
 * is what let the first version of this audit pass its tests while answering
 * `served: unknown` for every slug on a real portal.
 */
function session(values: Record<string, unknown>): HubDbRow {
  const { hs_path: path, ...rest } = values
  const row: HubDbRow = { id: String(nextId++), values: rest }
  if (typeof path === 'string') row.path = path
  return row
}

const codes = (result: { findings: Array<{ code: RoutingCode }> }): RoutingCode[] =>
  result.findings.map((f) => f.code)

describe('the ref 86 shape: one slug, two course ids', () => {
  const rows = [
    session({
      course_slug: 'welding-supervisor',
      course_id: 'WS-MARY',
      hs_path: 'welding-supervisor',
      course_name: 'Welding Supervisor',
      city: 'Maryborough',
      start_date: '2026-11-02'
    }),
    session({
      course_slug: 'welding-supervisor',
      course_id: 'WS-MACKAY',
      course_name: 'Welding Supervisor',
      city: 'Mackay',
      start_date: '2026-10-26'
    })
  ]

  it('names the slug as spanning two course ids', () => {
    expect(codes(auditCourseRouting(rows))).toContain('slug_spans_course_ids')
  })

  it('names the session a visitor cannot reach, and where it is', () => {
    const finding = auditCourseRouting(rows).findings.find(
      (f) => f.code === 'sessions_unreachable'
    )
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe('error')
    // Recognisable in the HubDB UI without opening every row.
    expect(finding!.message).toContain('Mackay')
    expect(finding!.message).toContain('2026-10-26')
    expect(finding!.message).toContain('/courses/welding-supervisor')
  })

  it('works out which course_id the URL actually serves, from the page path', () => {
    const report = auditCourseRouting(rows).slugs[0]!
    expect(report.servedCourseId).toBe('WS-MARY')
    expect(report.unreachable.map((u) => u.label)).toEqual([
      'Welding Supervisor · Mackay · 2026-10-26'
    ])
  })

  it('gives a remedy that is a row edit, naming the value to set', () => {
    const finding = auditCourseRouting(rows).findings.find(
      (f) => f.code === 'sessions_unreachable'
    )!
    expect(finding.remedy).toContain('WS-MARY')
    expect(finding.rowIds).toHaveLength(1)
  })

  it('counts the slug once in the summary', () => {
    const { summary } = auditCourseRouting(rows)
    expect(summary.slugs).toBe(1)
    expect(summary.slugsWithUnreachableSessions).toBe(1)
    expect(summary.errors).toBeGreaterThan(0)
  })
})

describe('a healthy course', () => {
  it('reports nothing', () => {
    const rows = [
      session({ course_slug: 'iwi-s', course_id: 'IWIS', hs_path: 'iwi-s', city: 'Sydney' }),
      session({ course_slug: 'iwi-s', course_id: 'IWIS', city: 'Melbourne' })
    ]
    const result = auditCourseRouting(rows)
    expect(result.findings).toEqual([])
    expect(result.summary.errors).toBe(0)
    expect(result.slugs[0]!.unreachable).toEqual([])
  })
})

describe('the other ways the two keys come apart', () => {
  it('flags a row with no slug: nothing links to it', () => {
    const result = auditCourseRouting([session({ course_id: 'X', city: 'Perth' })])
    expect(codes(result)).toContain('slug_missing')
  })

  it('flags a row with no course_id: its page would query nothing', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'x', hs_path: 'x', city: 'Perth' })
    ])
    expect(codes(result)).toContain('course_id_missing')
  })

  it('flags a slug no row owns, where the served row is HubSpot’s choice', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'x', course_id: 'X', hs_path: 'x-old' }),
      session({ course_slug: 'x', course_id: 'X', hs_path: 'x-older' })
    ])
    expect(codes(result)).toContain('no_row_owns_path')
    expect(result.slugs[0]!.servedCourseId).toBeNull()
  })

  it('never sends anyone to backfill:paths for it: one path per COURSE, not per session', () => {
    const finding = auditCourseRouting([
      session({ course_slug: 'x', course_id: 'X', hs_path: 'stale' })
    ]).findings.find((f) => f.code === 'no_row_owns_path')!
    // backfill:paths mints a path for every row it can slug. On `courses`, where
    // a course is many session rows, that publishes a URL per session.
    expect(finding.remedy).not.toContain('backfill:paths')
    expect(finding.remedy).toContain('ONE row')
  })

  it('flags one course split across two URLs', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'a', course_id: 'SAME', hs_path: 'a' }),
      session({ course_slug: 'b', course_id: 'SAME', hs_path: 'b' })
    ])
    expect(codes(result)).toContain('course_id_spans_slugs')
  })

  it('treats a stray page path as a warning while one row still owns the slug', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'a', course_id: 'A', hs_path: 'a' }),
      session({ course_slug: 'a', course_id: 'A', hs_path: 'a-2024' })
    ])
    expect(codes(result)).toContain('path_slug_mismatch')
    expect(codes(result)).not.toContain('no_row_owns_path')
    expect(result.summary.errors).toBe(0)
  })

  it('compares slugs and paths case-insensitively, as HubSpot serves them', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'IWI-S', course_id: 'X', hs_path: 'iwi-s' })
    ])
    expect(codes(result)).not.toContain('no_row_owns_path')
    expect(codes(result)).not.toContain('path_slug_mismatch')
  })

  it('reads the path off the ROW, which is where HubSpot puts it', () => {
    const owned: HubDbRow = {
      id: '1',
      path: 'x',
      values: { course_slug: 'x', course_id: 'X' }
    }
    expect(codes(auditCourseRouting([owned]))).not.toContain('no_row_owns_path')
    expect(auditCourseRouting([owned]).slugs[0]!.servedCourseId).toBe('X')
  })

  it('does not accept a path hiding in the column values', () => {
    // There is no `hs_path` COLUMN. A table that grew one by hand is not the
    // page path HubSpot serves, and treating it as one would report a URL as
    // owned while the card still 404s.
    const result = auditCourseRouting([
      { id: '1', values: { course_slug: 'x', course_id: 'X', hs_path: 'x' } }
    ])
    expect(codes(result)).toContain('no_row_owns_path')
  })

  it('says a table with no paths at all ONCE, not under every slug', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'a', course_id: 'A' }),
      session({ course_slug: 'b', course_id: 'B' }),
      session({ course_slug: 'c', course_id: 'C' })
    ])
    const owned = result.findings.filter((f) => f.code === 'no_row_owns_path')
    expect(owned).toHaveLength(1)
    expect(owned[0]!.slug).toBe('(table)')
  })
})

describe('a stranded session, and who the remedy may name', () => {
  it('names the served course_id when a row owns the URL', () => {
    const finding = auditCourseRouting([
      session({ course_slug: 'ws', course_id: 'WS-MARY', hs_path: 'ws' }),
      session({ course_slug: 'ws', course_id: 'WS-MACKAY', city: 'Mackay' })
    ]).findings.find((f) => f.code === 'sessions_unreachable')!
    expect(finding.remedy).toContain('WS-MARY')
  })

  it('refuses to issue a guess as a bulk row edit when no row owns the URL', () => {
    const finding = auditCourseRouting([
      session({ course_slug: 'ws', course_id: 'WS-MARY', hs_path: 'stale' }),
      session({ course_slug: 'ws', course_id: 'WS-MARY', hs_path: 'stale-2' }),
      session({ course_slug: 'ws', course_id: 'WS-MACKAY', city: 'Mackay' })
    ]).findings.find((f) => f.code === 'sessions_unreachable')!
    expect(finding.remedy).toContain('not knowable')
    expect(finding.remedy).toContain('page path')
    expect(finding.remedy).not.toMatch(/^Set course_id/)
  })
})

describe('--slug scopes the report, never the universe', () => {
  const rows = [
    session({ course_slug: 'ws', course_id: 'WS', hs_path: 'ws' }),
    session({ course_slug: 'iwi-s', course_id: 'IWIS', hs_path: 'iwi-s' })
  ]

  it('reports only the slug asked about', () => {
    const result = auditCourseRouting(rows, { slugs: ['ws'] })
    expect(result.slugs.map((s) => s.slug)).toEqual(['ws'])
  })

  it('still knows every course id, so other courses’ modules are not orphans', () => {
    const result = auditCourseRouting(rows, {
      slugs: ['ws'],
      moduleRows: [session({ parent_course_id: 'IWIS', name: 'Module 1' })]
    })
    expect(codes(result)).not.toContain('modules_orphaned')
  })

  it('still sees a course_id shared with a slug outside the filter', () => {
    const result = auditCourseRouting(
      [
        session({ course_slug: 'ws', course_id: 'SAME', hs_path: 'ws' }),
        session({ course_slug: 'ws-old', course_id: 'SAME', hs_path: 'ws-old' })
      ],
      { slugs: ['ws'] }
    )
    expect(codes(result)).toContain('course_id_spans_slugs')
  })

  it('does not answer a one-course question with the whole table’s sluglessness', () => {
    const result = auditCourseRouting([...rows, session({ course_id: 'ORPHAN' })], {
      slugs: ['ws']
    })
    expect(codes(result)).not.toContain('slug_missing')
  })
})

describe('the modules half of ref 86', () => {
  const courses = [session({ course_slug: 'ws', course_id: 'WS', hs_path: 'ws' })]

  it('flags a module whose parent course id belongs to no course', () => {
    const result = auditCourseRouting(courses, {
      moduleRows: [session({ parent_course_id: 'WS-OLD', name: 'Module 1' })]
    })
    expect(codes(result)).toContain('modules_orphaned')
  })

  it('names the VALUE, so the finding is an edit rather than a list of row ids', () => {
    const finding = auditCourseRouting(courses, {
      moduleRows: [session({ parent_course_id: 'WS-OLD', name: 'Module 1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('"WS-OLD"')
  })

  it('groups orphans by that value: one finding per wrong id, not per row', () => {
    // These fixtures carry no module_product_id, so neither value is answerable
    // and both collapse into the single table-wide finding - which still names
    // each value and carries every row id, so the edit stays addressable.
    const result = auditCourseRouting(courses, {
      moduleRows: [
        session({ parent_course_id: 'WS-OLD', name: 'Module 1' }),
        session({ parent_course_id: 'WS-OLD', name: 'Module 2' }),
        session({ parent_course_id: 'OTHER', name: 'Module 3' })
      ]
    })
    const orphans = result.findings.filter((f) => f.code === 'modules_orphaned')
    expect(orphans).toHaveLength(1)
    expect(orphans[0]!.message).toContain('"WS-OLD" (2)')
    expect(orphans[0]!.message).toContain('"OTHER" (1)')
    expect(orphans[0]!.rowIds).toHaveLength(3)
  })

  it('recognises the slug-instead-of-id mistake and names the id to use', () => {
    // `courses` here is slug `ws`, course_id `WS`. A module keyed on the slug is
    // the likeliest way to be orphaned, and the right value is readable off the
    // table - so the remedy states it rather than describing it.
    const finding = auditCourseRouting(courses, {
      moduleRows: [session({ parent_course_id: 'ws', name: 'Module 1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('course_slug')
    expect(finding.remedy).toContain('"WS"')
  })

  it('does not invent a remedy for an orphan nothing can resolve', () => {
    // These fixtures carry no `module_product_id`, so the product-id join cannot
    // run at all - which is its own finding, and still never names a course_id.
    const finding = auditCourseRouting(courses, {
      moduleRows: [session({ parent_course_id: 'NOTHING-LIKE-IT', name: 'Module 1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('No courses row carries a module_product_id at')
    expect(finding.remedy).toContain('audit:course-modules')
    expect(finding.remedy).not.toMatch(/Set parent_course_id to "/)
  })

  it('says a table-wide cause ONCE, not once per value', () => {
    // Production returned sixteen findings carrying an identical paragraph. A
    // reader cannot tell sixteen problems from one problem said sixteen times,
    // and the second is what that was.
    const many = ['a', 'b', 'c', 'd', 'e'].map((v) =>
      session({ parent_course_id: `orphan-${v}`, name: `Module ${v}` })
    )
    const orphans = auditCourseRouting(courses, { moduleRows: many }).findings.filter(
      (f) => f.code === 'modules_orphaned'
    )
    expect(orphans).toHaveLength(1)
    expect(orphans[0]!.rowIds).toHaveLength(5)
    expect(orphans[0]!.message).toContain('5 course_modules row(s) across 5')
  })

  it('still answers the slug reading per value, which the join is not needed for', () => {
    // Collapsing everything would swallow the one orphan that IS answerable with
    // an empty module_product_id: a module keyed on the course_slug.
    const orphans = auditCourseRouting(courses, {
      moduleRows: [
        session({ parent_course_id: 'ws', name: 'Keyed on the slug' }),
        session({ parent_course_id: 'nothing-like-it', name: 'Unanswerable' })
      ]
    }).findings.filter((f) => f.code === 'modules_orphaned')
    expect(orphans).toHaveLength(2)
    const slugOne = orphans.find((f) => f.message.includes('course_slug'))!
    expect(slugOne.remedy).toContain('"WS"')
    const collapsed = orphans.find((f) => f.message.includes('module_product_id'))!
    expect(collapsed.message).toContain('"nothing-like-it"')
  })

  it('says nothing about modules that resolve', () => {
    const result = auditCourseRouting(courses, {
      moduleRows: [session({ parent_course_id: 'WS', name: 'Module 1' })]
    })
    expect(codes(result)).not.toContain('modules_orphaned')
  })

  it('skips the check entirely when the caller did not read the table', () => {
    expect(codes(auditCourseRouting(courses))).not.toContain('modules_orphaned')
  })
})

describe('the report is read-only and complete', () => {
  it('returns every row it was given in the summary count', () => {
    const rows = [
      session({ course_slug: 'a', course_id: 'A', hs_path: 'a' }),
      session({ course_slug: 'a', course_id: 'A' }),
      session({ course_id: 'B' })
    ]
    expect(auditCourseRouting(rows).summary.rows).toBe(3)
  })

  it('carries row ids on every finding, so each one can be opened in HubDB', () => {
    const result = auditCourseRouting([
      session({ course_slug: 'a', course_id: 'A1', hs_path: 'a' }),
      session({ course_slug: 'a', course_id: 'A2' })
    ])
    for (const finding of result.findings) {
      // The `(table)` scope is about the table rather than any row, so it names
      // none; everything else has to be openable in HubDB.
      if (finding.slug === '(table)') continue
      expect(finding.rowIds.length).toBeGreaterThan(0)
    }
  })
})

/**
 * The product-id join, which is what turns an orphan from "decide which course
 * this belongs to" into a value readable off the table.
 *
 * `parent_course_id` on an orphan holds something no `courses` row carries, so
 * there is nothing in THAT column to resolve from. The second key answers it:
 * § 7.7, `course_modules.hubspot_product_id` joins to `courses.module_product_id`,
 * and the row claiming the product id is the module's session - whose `course_id`
 * is the value the orphan should have.
 *
 * Evidence, not proof. A module session row may carry its own `course_id` rather
 * than its parent's, so a candidate only counts when a NON-module row carries it
 * too. Production's sixteen orphans all name their own module slug
 * (`metallurgy-1`, `fabrication-math-1`, …), which matches no slug and no id, so
 * this join is the only thing that can answer them.
 */
describe('resolving an orphan from its HubSpot Product ID', () => {
  /** A course with real sessions, plus the module sitting that teaches PROD-1. */
  const table = [
    session({
      course_slug: 'as1796-cert-10',
      course_id: 'AS1796',
      hs_path: 'as1796-cert-10',
      course_name: 'AS1796 Cert 10',
      city: 'Adelaide',
      start_date: '2026-11-02'
    }),
    session({
      course_id: 'AS1796',
      course_name: 'Metallurgy 1',
      is_module: true,
      module_product_id: 'PROD-1',
      city: 'Adelaide',
      start_date: '2026-11-02'
    })
  ]

  const orphan = (values: Record<string, unknown> = {}): HubDbRow =>
    session({ parent_course_id: 'metallurgy-1', name: 'Metallurgy 1', ...values })

  it('names the course_id the product-id join resolves to', () => {
    const finding = auditCourseRouting(table, {
      moduleRows: [orphan({ hubspot_product_id: 'PROD-1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('AS1796')
    expect(finding.remedy).toContain('Set parent_course_id to "AS1796"')
    // Names the product id so the reader can check the join themselves rather
    // than taking a generated instruction on trust.
    expect(finding.remedy).toContain('PROD-1')
  })

  it('names the course by its URL too, so it can be recognised', () => {
    const finding = auditCourseRouting(table, {
      moduleRows: [orphan({ hubspot_product_id: 'PROD-1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('/courses/as1796-cert-10')
  })

  it('reads hubspot_product_id, not product_id', () => {
    // Both columns exist; production fills the first and leaves the second empty
    // on all 44 rows (§ 7.7). Reading only `product_id` resolves nothing at all.
    const finding = auditCourseRouting(table, {
      moduleRows: [orphan({ product_id: 'PROD-1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.remedy).toContain('Set parent_course_id to "AS1796"')
  })

  it('refuses a candidate no real session row carries', () => {
    // The module sitting holds its OWN course_id rather than its parent's, which
    // § 7.7 says is a shape that occurs. Naming it would move the orphan, not fix
    // it, so the join declines to answer and says why.
    const selfKeyed = [
      table[0]!,
      session({
        course_id: 'METALLURGY-1',
        course_name: 'Metallurgy 1',
        is_module: true,
        module_product_id: 'PROD-1',
        start_date: '2026-11-02'
      })
    ]
    const finding = auditCourseRouting(selfKeyed, {
      moduleRows: [orphan({ hubspot_product_id: 'PROD-1' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.remedy).not.toContain('Set parent_course_id to "METALLURGY-1"')
    expect(finding.message).toContain('module row holding its own id')
  })

  it('declines when a product id no courses row claims', () => {
    const finding = auditCourseRouting(table, {
      moduleRows: [orphan({ hubspot_product_id: 'PROD-NOPE' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('product ID no courses row claims')
    expect(finding.remedy).toContain('audit:course-modules')
    expect(finding.remedy).not.toMatch(/Set parent_course_id to "[A-Z]/)
  })

  it('says when the module carries no product id at all', () => {
    const finding = auditCourseRouting(table, {
      moduleRows: [orphan()]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('carries no HubSpot Product ID')
    expect(finding.remedy).toContain('set hubspot_product_id on the module row')
  })

  it('counts one row as one, in words', () => {
    // "1 have a product ID" reads as a bug in the report, which is how a reader
    // starts doubting everything else in it.
    const one = auditCourseRouting(table, {
      moduleRows: [orphan({ hubspot_product_id: 'PROD-NOPE' })]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(one.message).toContain('1 has a product ID')

    const two = auditCourseRouting(table, {
      moduleRows: [
        orphan({ hubspot_product_id: 'PROD-NOPE' }),
        orphan({ hubspot_product_id: 'PROD-ALSO-NOPE' })
      ]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(two.message).toContain('2 have a product ID')
  })

  it('reports coverage, so the orphans can be sized before anyone edits a row', () => {
    const result = auditCourseRouting(table, {
      moduleRows: [
        orphan({ hubspot_product_id: 'PROD-1' }),
        orphan({ parent_course_id: 'welding-symbols', hubspot_product_id: 'PROD-NOPE' })
      ]
    })
    expect(result.summary.orphanedModules).toEqual({ rows: 2, resolvable: 1 })
  })

  it('distinguishes zero orphans from never having looked', () => {
    // A CI job reading the document must not read "we did not run the module
    // check" as "the module check found nothing".
    expect(auditCourseRouting(table, { moduleRows: [] }).summary.orphanedModules).toEqual({
      rows: 0,
      resolvable: 0
    })
    expect(auditCourseRouting(table).summary.orphanedModules).toBeNull()
    // A --slug filter suppresses the table-wide check, so it reports null too.
    expect(
      auditCourseRouting(table, { moduleRows: [orphan()], slugs: ['as1796-cert-10'] }).summary
        .orphanedModules
    ).toBeNull()
  })

  it('splits a group whose rows resolve to different courses', () => {
    // Two modules sharing one wrong `parent_course_id` need not share a parent,
    // so a single "set it to X" would be wrong for one of them.
    const twoCourses = [
      ...table,
      session({
        course_slug: 'iwi-s',
        course_id: 'IWIS',
        hs_path: 'iwi-s',
        course_name: 'IWI-S',
        city: 'Online',
        start_date: '2026-12-01'
      }),
      session({
        course_id: 'IWIS',
        course_name: 'Module 2',
        is_module: true,
        module_product_id: 'PROD-2',
        start_date: '2026-12-01'
      })
    ]
    const finding = auditCourseRouting(twoCourses, {
      moduleRows: [
        orphan({ hubspot_product_id: 'PROD-1' }),
        orphan({ hubspot_product_id: 'PROD-2' })
      ]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('MORE THAN ONE course')
    expect(finding.remedy).toContain('AS1796')
    expect(finding.remedy).toContain('IWIS')
    expect(finding.remedy).toContain('per row')
  })

  it('still prefers the slug reading, which explains the mistake as well', () => {
    // Where both fire they agree; the slug version also says HOW it went wrong.
    const finding = auditCourseRouting(table, {
      moduleRows: [
        session({
          parent_course_id: 'as1796-cert-10',
          name: 'Metallurgy 1',
          hubspot_product_id: 'PROD-1'
        })
      ]
    }).findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.message).toContain('course_slug')
    expect(finding.remedy).toContain('"AS1796"')
  })

  it('stays a warn, and stays read-only', () => {
    const result = auditCourseRouting(table, {
      moduleRows: [orphan({ hubspot_product_id: 'PROD-1' })]
    })
    const finding = result.findings.find((f) => f.code === 'modules_orphaned')!
    expect(finding.severity).toBe('warn')
    expect(finding.rowIds.length).toBe(1)
  })

  it('does not report a module session row as a course of its own', () => {
    // `is_module` rows share their parent's course_id here, so they must not
    // start showing up as unreachable sessions or extra slugs.
    const result = auditCourseRouting(table, { moduleRows: [] })
    expect(codes(result)).not.toContain('slug_spans_course_ids')
    expect(codes(result)).not.toContain('sessions_unreachable')
  })
})
