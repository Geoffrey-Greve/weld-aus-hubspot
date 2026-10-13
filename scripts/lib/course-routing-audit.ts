/**
 * Pure planner for the course-page routing audit.
 *
 * The problem it solves
 * ---------------------
 * A course is identified by TWO different columns on the same `courses` table,
 * and nothing keeps them in step.
 *
 *   /courses/<course_slug>            ← what a directory card links to
 *      ↓ HubSpot serves that path from the row whose `hs_path` matches
 *   dynamic_page_hubdb_row            ← exactly ONE row, whichever that is
 *      ↓ .course_id
 *   hubdb_table_rows('courses', 'course_id__eq=…')   ← the whole schedule
 *      ↓ parent_course_id
 *   course_modules rows               ← the module list
 *
 * `courses` is a table of SESSIONS, so a course is many rows. The directory
 * dedupes them by `course_slug` and links to `/courses/<slug>`; the course page
 * then re-derives the schedule, the modules, the fees panel and the page title
 * from ONE row's `course_id`. When a slug spans more than one `course_id`, the
 * page shows one of them and the rest are unreachable from the URL their own
 * card points at.
 *
 * That is QA ref 86, symptom for symptom: "Welding Supervisor Mackay (26
 * October) shows as open but when you go to register, shows Maryborough
 * training schedule and no courses available. Course modules are wrong." One
 * card, one click, a different course's sessions and a different course's
 * modules - because the card and the page are keyed on different columns.
 *
 * None of it is visible from a page. The card renders, the link works, the page
 * renders, and every individual row looks correct in the HubDB UI; only the
 * relationship between them is wrong. That is why it has to be a report.
 *
 * Nothing here is fixed by a deploy. Every finding is a HubDB edit, which is
 * why this reports and stops - same contract as `event-engine-audit.ts` and
 * `course-module-audit.ts`, and for the same reason: which sessions belong to
 * which course is an editorial call, never a script's.
 *
 * READ-ONLY by construction: rows in, findings out.
 */
import { isoDate, text, truthy, type HubDbRow } from './event-engine-audit'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoutingSeverity = 'error' | 'warn' | 'info'

export type RoutingCode =
  /** Sessions under this slug that the page it links to cannot show. The ref 86 finding. */
  | 'sessions_unreachable'
  /** One `course_slug`, more than one `course_id`. The cause of the above. */
  | 'slug_spans_course_ids'
  /** No row for this slug carries the dynamic path, so which row backs the URL is chance. */
  | 'no_row_owns_path'
  /** A row has sessions but no `course_slug`: no card link, no page. */
  | 'slug_missing'
  /** A row has a slug but no `course_id`: its page queries nothing and shows no sessions. */
  | 'course_id_missing'
  /** One `course_id` under several slugs: several URLs render one identical schedule. */
  | 'course_id_spans_slugs'
  /** A row's `hs_path` is not its `course_slug`, so the directory demotes it. */
  | 'path_slug_mismatch'
  /** A module points at a `parent_course_id` no `courses` row carries. */
  | 'modules_orphaned'

export interface RoutingFinding {
  code: RoutingCode
  severity: RoutingSeverity
  /** The `course_slug` this is about, or '(no slug)'. */
  slug: string
  message: string
  /** What to change in HubDB. Always a row edit, never a deploy. */
  remedy: string
  /** Row ids the finding is about, so it can be opened in the HubDB UI. */
  rowIds: string[]
}

export interface SlugReport {
  slug: string
  /** Every `courses` row carrying this slug. */
  rowCount: number
  /** Distinct `course_id` values under it. More than one is the ref 86 shape. */
  courseIds: string[]
  /** The `course_id` the URL actually serves, when one row owns the path. */
  servedCourseId: string | null
  /** Sessions the served page cannot show, described so they can be recognised. */
  unreachable: Array<{ id: string; label: string }>
  findings: RoutingFinding[]
}

export interface RoutingSummary {
  slugs: number
  rows: number
  errors: number
  warnings: number
  /** Slugs where at least one session is unreachable from its own card. */
  slugsWithUnreachableSessions: number
  /**
   * Orphaned `course_modules` rows and how many of them the product-id join can
   * name a parent for. `null` when the module check did not run - the caller
   * passed no rows, or a `--slug` filter suppressed it - because "we did not
   * look" must never read as "none found".
   */
  orphanedModules: { rows: number; resolvable: number } | null
}

export interface RoutingResult {
  slugs: SlugReport[]
  findings: RoutingFinding[]
  summary: RoutingSummary
}

export interface RoutingOptions {
  /** `course_modules` rows, if the caller read them. Omit to skip the module check. */
  moduleRows?: HubDbRow[]
  /**
   * Report on these slugs only (case-insensitive). Every rule still sees EVERY
   * row: filtering the rows themselves would shrink the set of known course ids
   * and report every other course's modules as orphaned, and would hide a
   * `course_id` this course shares with a slug outside the filter. The findings
   * that are about the table rather than one slug are suppressed under a filter
   * instead, because they are not answers to what was asked.
   */
  slugs?: string[]
}

// ---------------------------------------------------------------------------
// Row reading
// ---------------------------------------------------------------------------

const v = (row: HubDbRow, key: string): string => text(row.values?.[key])

const rowId = (row: HubDbRow): string => String(row.id ?? '')

/** Slugs and paths are compared case-insensitively: HubSpot lower-cases a path. */
const key = (value: string): string => value.trim().toLowerCase()

/**
 * The dynamic page path HubSpot serves this row at.
 *
 * It is a ROW-LEVEL field on the v3 API (`HubDbTableRowV3.path`), NOT a column:
 * `courses` has no `hs_path` column, and that name is only what the
 * dynamic-page settings call it. `hubdb-slug.ts` reads the same field.
 *
 * Reading it out of `values` was this audit's own first bug: against real rows
 * every slug answered `served: unknown`, the two path findings could never
 * fire, and the ref 86 remedy named a guessed `course_id` instead of the one
 * HubSpot actually serves.
 */
const pathOf = (row: HubDbRow): string => text(row.path)

/** Enough of a session to recognise it in the HubDB UI: city, then date. */
function sessionLabel(row: HubDbRow): string {
  const parts = [v(row, 'course_name'), v(row, 'city'), isoDate(row.values?.start_date)]
  return parts.filter(Boolean).join(' · ') || `row ${rowId(row)}`
}

// ---------------------------------------------------------------------------
// Orphaned modules: resolving the parent from the PRODUCT ID
// ---------------------------------------------------------------------------

/**
 * What the product-id join found for one orphaned `course_modules` row.
 *
 * `parent_course_id` on an orphan holds a value no `courses` row carries, so
 * there is nothing in that column to resolve from - which is why this audit
 * used to say "decide which course it belongs to" and stop. But the SECOND key
 * answers it: § 7.7, `course_modules.hubspot_product_id` joins to
 * `courses.module_product_id`, and the `courses` row claiming that product id
 * IS the module's session. That row's `course_id` is the value the orphan
 * should carry.
 *
 * The join is evidence, not proof, and the two ways it can mislead are both
 * reported rather than papered over:
 *
 *  - a module session row may carry its OWN `course_id` rather than its
 *    parent's (§ 7.7 describes both shapes). Naming that id as the parent would
 *    move the orphan rather than fix it, so a candidate only counts as
 *    `corroborated` when some NON-module row carries it too - that is, when the
 *    course has real sessions of its own.
 *  - one product id may be claimed by several `courses` rows sitting under
 *    different `course_id` values, which is a data fault of its own.
 */
export interface OrphanResolution {
  /** The module row this is about. */
  rowId: string
  /** `hubspot_product_id`, falling back to `product_id`. '' when neither is set. */
  productId: string
  /** Distinct `course_id` values on the `courses` rows claiming that product id. */
  candidates: string[]
  /** The single candidate a non-module `courses` row also carries, if there is one. */
  resolved: string | null
  /** Why `resolved` is null, for a report that has to say what it looked at. */
  reason:
    | 'resolved'
    | 'no_product_id'
    | 'no_course_row_claims_it'
    | 'candidate_has_no_sessions'
    | 'several_candidates'
}

/**
 * `hubspot_product_id` is the column production fills; `product_id` exists and is
 * empty on every live row (§ 7.7). Reading only the second resolves nothing at all.
 */
export function moduleProductId(moduleRow: HubDbRow): string {
  const values = moduleRow.values ?? {}
  return text(values.hubspot_product_id) || text(values.product_id)
}

/** Does the table claim ANY module by product id? If not, the join cannot run. */
export function productJoinIsPopulated(courseRows: HubDbRow[]): boolean {
  return courseRows.some((row) => text((row.values ?? {}).module_product_id) !== '')
}

export function resolveOrphanParent(
  moduleRow: HubDbRow,
  courseRows: HubDbRow[]
): OrphanResolution {
  const rowIdValue = rowId(moduleRow)
  const productId = moduleProductId(moduleRow)
  if (!productId) {
    return { rowId: rowIdValue, productId, candidates: [], resolved: null, reason: 'no_product_id' }
  }

  const claiming = courseRows.filter(
    (row) => text((row.values ?? {}).module_product_id) === productId
  )
  const candidates = [...new Set(claiming.map((row) => v(row, 'course_id')).filter(Boolean))].sort()

  if (candidates.length === 0) {
    return {
      rowId: rowIdValue,
      productId,
      candidates,
      resolved: null,
      reason: 'no_course_row_claims_it'
    }
  }

  // A course with real sessions - rows that are NOT themselves module sittings.
  // This is what separates "the parent's id" from "a module row carrying its own".
  const idsWithRealSessions = new Set(
    courseRows
      .filter((row) => !truthy((row.values ?? {}).is_module))
      .map((row) => v(row, 'course_id'))
      .filter(Boolean)
  )
  const corroborated = candidates.filter((id) => idsWithRealSessions.has(id))

  if (corroborated.length === 1) {
    return { rowId: rowIdValue, productId, candidates, resolved: corroborated[0]!, reason: 'resolved' }
  }
  if (corroborated.length > 1) {
    return { rowId: rowIdValue, productId, candidates, resolved: null, reason: 'several_candidates' }
  }
  return {
    rowId: rowIdValue,
    productId,
    candidates,
    resolved: null,
    reason: candidates.length > 1 ? 'several_candidates' : 'candidate_has_no_sessions'
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function auditCourseRouting(
  courseRows: HubDbRow[],
  options: RoutingOptions = {}
): RoutingResult {
  const findings: RoutingFinding[] = []
  const reports: SlugReport[] = []

  const scope = (options.slugs ?? []).map(key)
  const inScope = (slug: string): boolean => scope.length === 0 || scope.includes(key(slug))
  const wholeTable = scope.length === 0

  // Does ANY row carry a dynamic page path? When none does, saying so once beats
  // repeating it under every slug - and it is a different fault: the table has
  // no dynamic page paths at all, rather than this course having lost its one.
  const tableHasPaths = courseRows.some((r) => pathOf(r))
  if (!tableHasPaths && courseRows.length > 0) {
    findings.push({
      code: 'no_row_owns_path',
      severity: 'error',
      slug: '(table)',
      message:
        'No row in the courses table has a dynamic page path, so HubSpot serves no ' +
        '/courses/<slug> URL from any of them and every directory card leads nowhere.',
      remedy:
        'Set the page path on the one row that should own each course URL (HubDB row editor → ' +
        'the row\'s page path). Dynamic pages must also be enabled on the table.',
      rowIds: []
    })
  }

  // Rows with no slug at all cannot be reached by any URL. Reported once, as a
  // group, because they share one remedy. Table-wide, so it is not an answer to
  // a --slug question.
  const slugless = wholeTable ? courseRows.filter((r) => !v(r, 'course_slug')) : []
  if (slugless.length > 0) {
    findings.push({
      code: 'slug_missing',
      severity: 'error',
      slug: '(no slug)',
      message:
        `${slugless.length} session row(s) have no course_slug, so no card links to them and ` +
        'they have no page of their own.',
      remedy: 'Set course_slug on each row to the slug of the course it belongs to.',
      rowIds: slugless.map(rowId)
    })
  }

  // Group the rest by slug.
  const bySlug = new Map<string, HubDbRow[]>()
  for (const row of courseRows) {
    const slug = v(row, 'course_slug')
    if (!slug) continue
    const k = key(slug)
    bySlug.set(k, [...(bySlug.get(k) ?? []), row])
  }

  // And by course_id, to catch one course split across several URLs.
  const byCourseId = new Map<string, Set<string>>()
  for (const row of courseRows) {
    const id = v(row, 'course_id')
    const slug = v(row, 'course_slug')
    if (!id || !slug) continue
    byCourseId.set(id, (byCourseId.get(id) ?? new Set()).add(key(slug)))
  }

  for (const [, rows] of [...bySlug.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const slug = v(rows[0]!, 'course_slug')
    if (!inScope(slug)) continue
    const report = auditSlug(slug, rows, { tableHasPaths })
    reports.push(report)
    findings.push(...report.findings)
  }

  for (const [courseId, slugs] of byCourseId) {
    if (slugs.size <= 1) continue
    // Kept under a filter when one of ITS slugs was asked about: the other slug
    // sharing the id is the answer, even though it was not named.
    if (![...slugs].some((sl) => inScope(sl))) continue
    findings.push({
      code: 'course_id_spans_slugs',
      severity: 'warn',
      slug: [...slugs].sort().join(', '),
      message:
        `course_id "${courseId}" is used under ${slugs.size} different slugs, so each of those ` +
        'URLs renders the same schedule and the directory shows a card for each.',
      remedy:
        'Decide which slug is the course, and repoint the other rows at it - or give the other ' +
        'rows their own course_id if they really are a different course.',
      rowIds: courseRows.filter((r) => v(r, 'course_id') === courseId).map(rowId)
    })
  }

  // Plain counters rather than a nullable object built up in place: TypeScript
  // narrows the latter to `null` inside the loop that fills it.
  let orphanChecked = false
  let orphanRows = 0
  let orphanResolvable = 0

  if (options.moduleRows && wholeTable) {
    const knownCourseIds = new Set(courseRows.map((r) => v(r, 'course_id')).filter(Boolean))
    // `course_slug` → the `course_id` its rows carry. A module keyed by the slug
    // is the single likeliest way to land here, and it is the one orphan whose
    // correct value can be read straight off the table.
    const idForSlug = new Map<string, string>()
    for (const row of courseRows) {
      const slug = v(row, 'course_slug')
      const id = v(row, 'course_id')
      if (slug && id && !idForSlug.has(key(slug))) idForSlug.set(key(slug), id)
    }

    const orphans = options.moduleRows.filter((m) => {
      const parent = v(m, 'parent_course_id')
      return parent !== '' && !knownCourseIds.has(parent)
    })

    // Grouped by the VALUE, not listed as rows. Seventeen row ids is not an edit
    // somebody can make; "these six rows say `welding-supervisor`, which is the
    // slug - the id is WS-01" is.
    const byValue = new Map<string, HubDbRow[]>()
    for (const row of orphans) {
      const parent = v(row, 'parent_course_id')
      byValue.set(parent, [...(byValue.get(parent) ?? []), row])
    }

    // Does the table claim ANY module by product id? On a portal where
    // `courses.module_product_id` was never populated the join cannot answer a
    // single orphan, and saying so once beats repeating "no courses row claims
    // this product id" under every value - a different fault with a different
    // fix (a seed run and some data entry, not sixteen row edits).
    const joinPopulated = productJoinIsPopulated(courseRows)
    const orderedValues = [...byValue.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    // ONE finding, not one per value, when the cause is table-wide and the remedy
    // is identical for every row. Production returned sixteen findings carrying
    // the same paragraph, which is the fault this file already names for
    // `no_row_owns_path` and for grouping orphans by value in the first place:
    // a reader cannot tell sixteen problems from one problem said sixteen times,
    // and the second is what this is.
    //
    // Nothing here is per-row until `courses.module_product_id` holds something,
    // so the values are listed inside the one finding and every row id comes with
    // it - the edit is still addressable, it is just not sixteen edits.
    //
    // The SLUG reading is independent of the join, so a value it can answer keeps
    // its own finding and its own remedy however empty module_product_id is. Only
    // the ones nothing can answer collapse.
    const unanswerable = joinPopulated
      ? []
      : orderedValues.filter(([parent]) => !idForSlug.has(key(parent)))
    const perValue = joinPopulated
      ? orderedValues
      : orderedValues.filter(([parent]) => idForSlug.has(key(parent)))

    if (unanswerable.length > 0) {
      const listed = unanswerable
        .map(([parent, rows]) => `"${parent}" (${rows.length})`)
        .join(', ')
      const allRows = unanswerable.flatMap(([, rows]) => rows)
      findings.push({
        code: 'modules_orphaned',
        severity: 'warn',
        slug: '(modules)',
        message:
          `${allRows.length} course_modules row(s) across ${unanswerable.length} ` +
          `parent_course_id value(s) name a course no courses row carries, so they appear ` +
          `on no course page: ${listed}. No courses row carries a module_product_id at ` +
          'all, so the product-id join cannot name any of their parents either - which ' +
          'means the module SESSION rows (§ 7.7) have not been created on this portal.',
        remedy:
          'This is one fix, not one per value. Run `pnpm audit:course-modules -- ' +
          '--env=<env>` first: it reports whether the module_product_id COLUMN is missing ' +
          '(a `pnpm seed:hubdb` run) or present but empty (the module session rows have to ' +
          'be created - is_module, module_product_id, dates, prices, worker_event_id). ' +
          'Once those rows exist, re-run this audit and it will name each orphan\'s parent.',
        rowIds: allRows.map(rowId)
      })
      orphanRows += allRows.length
      orphanChecked = true
    }

    for (const [parent, rows] of perValue) {
      const asSlug = idForSlug.get(key(parent))
      // The product-id join, per row: two modules can share a wrong
      // `parent_course_id` and still belong to different courses.
      const resolutions = rows.map((row) => resolveOrphanParent(row, courseRows))
      const resolvedIds = [
        ...new Set(resolutions.map((r) => r.resolved).filter((id): id is string => Boolean(id)))
      ]
      const slugFor = new Map<string, string>()
      for (const row of courseRows) {
        const id = v(row, 'course_id')
        const slug = v(row, 'course_slug')
        if (id && slug && !slugFor.has(id)) slugFor.set(id, slug)
      }
      const named = (id: string): string => {
        const slug = slugFor.get(id)
        return slug ? `"${id}" (/courses/${slug})` : `"${id}"`
      }

      // Evidence, strongest first. The slug reading is kept ahead of the product
      // join because it explains the MISTAKE as well as the value - somebody
      // typed the slug into the id column - and the two agree wherever both fire.
      let message =
        `${rows.length} course_modules row(s) name parent_course_id "${parent}", which no ` +
        'courses row carries, so they appear on no course page.'
      let remedy =
        'Set parent_course_id to the course_id of the course the module belongs to (the ' +
        'value on its session rows, not the slug). If the course itself is missing from ' +
        'the courses table, that is the fault to fix first.'

      if (asSlug) {
        message +=
          ' That is the course_slug of a real course, not its course_id - the modules are ' +
          'keyed on the wrong column.'
        remedy =
          `Set parent_course_id to "${asSlug}" on those rows - the course_id the ` +
          `/courses/${parent} session rows carry.`
      } else if (resolvedIds.length === 1 && resolutions.every((r) => r.resolved)) {
        const id = resolvedIds[0]!
        message +=
          ` Their HubSpot Product ID is claimed by a courses row under course_id ${named(id)}, ` +
          'which is the session each module teaches (CLAUDE.md § 7.7).'
        remedy =
          `Set parent_course_id to "${id}" on those rows. Read off the product-id join, not ` +
          'guessed: check one row by finding the courses row whose module_product_id is ' +
          `${resolutions[0]!.productId} and confirming it is a session of that course.`
      } else if (resolvedIds.length > 1) {
        message +=
          ' Their HubSpot Product IDs resolve to MORE THAN ONE course, so these rows share a ' +
          'wrong value but do not share a parent.'
        remedy =
          'Set parent_course_id per row, from the product-id join: ' +
          resolutions
            .map((r) => `row ${r.rowId} -> ${r.resolved ? named(r.resolved) : 'unresolved'}`)
            .join('; ') +
          '. Confirm each against the courses row carrying that module_product_id.'
      } else {
        // The join ran and did not answer. Say which of its two dead ends it was:
        // the remedies are different, and "we looked and found nothing" must not
        // read the same as "we did not look".
        const noProductId = resolutions.filter((r) => r.reason === 'no_product_id')
        const unclaimed = resolutions.filter((r) => r.reason === 'no_course_row_claims_it')
        const uncorroborated = resolutions.filter((r) => r.reason === 'candidate_has_no_sessions')
        // "1 have a product ID" reads as a bug in the report, which is how a
        // reader starts doubting the rest of it.
        const many = (n: number, plural: string, singular: string): string =>
          `${n} ${n === 1 ? singular : plural}`
        const parts: string[] = []
        if (noProductId.length > 0)
          parts.push(many(noProductId.length, 'carry', 'carries') + ' no HubSpot Product ID')
        if (unclaimed.length > 0)
          parts.push(
            many(unclaimed.length, 'have', 'has') + ' a product ID no courses row claims'
          )
        if (uncorroborated.length > 0)
          parts.push(
            many(uncorroborated.length, 'resolve', 'resolves') +
              ' only to a course_id that no real session row carries, which is a module row ' +
              "holding its own id rather than its parent's"
          )
        if (parts.length > 0) {
          message += ` The product-id join could not name the parent either: ${parts.join('; ')}.`
        }
        if (unclaimed.length > 0 || noProductId.length > 0) {
          remedy =
            'Set parent_course_id to the course_id of the course the module belongs to. The ' +
            'product-id join cannot answer it here, so this one is editorial: ' +
            (noProductId.length > 0
              ? 'set hubspot_product_id on the module row, and '
              : '') +
            'create the courses row that teaches the module (is_module, module_product_id, ' +
            'dates, prices, worker_event_id) - see `pnpm audit:course-modules`.'
        }
      }

      findings.push({
        code: 'modules_orphaned',
        severity: 'warn',
        slug: '(modules)',
        message,
        remedy,
        rowIds: rows.map(rowId)
      })

      orphanRows += rows.length
      // An orphan counts as resolvable only where the group speaks with one
      // voice: a mixed group needs a per-row edit, which is a different question
      // from "can this be answered off the table".
      orphanResolvable += asSlug ? rows.length : resolutions.filter((r) => r.resolved).length
    }

    // Zero orphans is a RESULT, and a different one from not having looked.
    orphanChecked = true
  }

  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.filter((f) => f.severity === 'warn').length

  return {
    slugs: reports,
    findings,
    summary: {
      slugs: reports.length,
      rows: courseRows.length,
      errors,
      warnings,
      slugsWithUnreachableSessions: reports.filter((r) => r.unreachable.length > 0).length,
      orphanedModules: orphanChecked ? { rows: orphanRows, resolvable: orphanResolvable } : null
    }
  }
}

function auditSlug(
  slug: string,
  rows: HubDbRow[],
  context: { tableHasPaths: boolean }
): SlugReport {
  const findings: RoutingFinding[] = []
  const courseIds = [...new Set(rows.map((r) => v(r, 'course_id')).filter(Boolean))].sort()

  const idless = rows.filter((r) => !v(r, 'course_id'))
  if (idless.length > 0) {
    findings.push({
      code: 'course_id_missing',
      severity: 'error',
      slug,
      message:
        `${idless.length} row(s) under /courses/${slug} have no course_id. A page backed by one ` +
        'of them queries for an empty id and shows no sessions at all.',
      remedy: `Set course_id on those rows to the value the other /courses/${slug} rows use.`,
      rowIds: idless.map(rowId)
    })
  }

  // Which row does HubSpot serve this URL from? The one whose dynamic path is
  // the slug. Without one, the page is backed by whichever row HubSpot picks.
  const owners = rows.filter((r) => pathOf(r) && key(pathOf(r)) === key(slug))
  const servedCourseId = owners.length > 0 ? v(owners[0]!, 'course_id') || null : null

  // Reported whether or not these rows carry OTHER paths: a slug no row owns is
  // a card pointing at a URL nothing serves, which is the fault either way. Only
  // a table with no paths anywhere is exempt, because it is said once above
  // rather than under every slug.
  if (owners.length === 0 && context.tableHasPaths) {
    findings.push({
      code: 'no_row_owns_path',
      severity: 'error',
      slug,
      message:
        `No row under /courses/${slug} has a dynamic page path matching its course_slug, so which ` +
        "row backs that URL is HubSpot's choice - or nothing does and the card 404s.",
      remedy:
        `Set the page path of the row that should own /courses/${slug} to "${slug}" - the row's ` +
        'own page path in the HubDB row editor, not a column. Set it on ONE row: every session ' +
        'sharing this slug is a row, and a path each would publish a URL per session.',
      rowIds: rows.map(rowId)
    })
  }

  const mismatched = rows.filter((r) => pathOf(r) && key(pathOf(r)) !== key(slug))
  if (mismatched.length > 0 && owners.length > 0) {
    findings.push({
      code: 'path_slug_mismatch',
      severity: 'warn',
      slug,
      message:
        `${mismatched.length} row(s) have a page path that is not their course_slug, so the ` +
        'directory treats them as non-canonical and prefers another row for the card.',
      remedy:
        'Harmless while one row owns the path; clear the stray paths if the directory is showing ' +
        'the wrong session on the card.',
      rowIds: mismatched.map(rowId)
    })
  }

  // THE ref 86 finding: sessions that exist under this slug but not under the
  // course_id the URL actually serves.
  let unreachable: Array<{ id: string; label: string }> = []
  if (courseIds.length > 1) {
    findings.push({
      code: 'slug_spans_course_ids',
      severity: 'error',
      slug,
      message:
        `/courses/${slug} covers ${courseIds.length} different course_id values ` +
        `(${courseIds.join(', ')}). The page can only ever show one of them.`,
      remedy:
        'Give every session of this course the same course_id, or split the odd ones onto their ' +
        'own course_slug so they get a page of their own.',
      rowIds: rows.map(rowId)
    })

    // Name the sessions a visitor cannot reach. When no row owns the path we
    // cannot know which id wins, so every id but the most common one is at risk
    // and the report says so rather than guessing.
    const servedId = servedCourseId ?? mostCommon(rows.map((r) => v(r, 'course_id')).filter(Boolean))
    unreachable = rows
      .filter((r) => v(r, 'course_id') && v(r, 'course_id') !== servedId)
      .map((r) => ({ id: rowId(r), label: sessionLabel(r) }))

    if (unreachable.length > 0) {
      // When a row owns the path we KNOW which course_id the page serves, so the
      // remedy can name it. When none does, the winner is a guess (the most
      // common id), and a guess must not be issued as a bulk row-edit
      // instruction - the first fix is to decide which row owns the URL.
      const remedy = servedCourseId
        ? `Set course_id on those rows to "${servedCourseId}" - the id on the row that owns ` +
          `/courses/${slug} - so they join the schedule their card points at.`
        : `No row owns /courses/${slug}, so which course_id the page serves is not knowable from ` +
          `the table: "${servedId}" below is only the most common one. Set the page path on the ` +
          'row that should own the URL first, then re-run; the id to standardise on follows ' +
          'from that.'
      findings.push({
        code: 'sessions_unreachable',
        severity: 'error',
        slug,
        message:
          `${unreachable.length} session(s) are advertised on /courses but cannot be seen or ` +
          `booked on /courses/${slug}, which is where their own card links: ` +
          `${unreachable.map((u) => u.label).join('; ')}.` +
          (servedCourseId ? '' : ' Which of them is stranded depends on which row owns the URL.'),
        remedy,
        rowIds: unreachable.map((u) => u.id)
      })
    }
  }

  return {
    slug,
    rowCount: rows.length,
    courseIds,
    servedCourseId,
    unreachable,
    findings
  }
}

/** The value appearing most often; ties break on first appearance. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = ''
  let bestCount = -1
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}
