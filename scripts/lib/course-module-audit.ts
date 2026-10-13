/**
 * Pure planner for the course-module booking audit.
 *
 * The problem it solves
 * ---------------------
 * A `course_modules` row carries a name, an order and a booking URL - nothing
 * else. Everything that decides whether a buyer can book that module (its
 * dates, its price, its ticket types, whether it is even on sale) lives on the
 * `courses` or `events` row the booking URL points at, and the only thing
 * joining the two is an id somebody typed into a URL by hand.
 *
 * The page degrades quietly when that join fails, by design: an unresolvable
 * module keeps its own "Book this module" link, and a module with no URL at all
 * falls back to a `mailto:` to the training team, because a listed module with
 * nothing to act on is the one outcome `course-modules.html` exists to prevent.
 * The cost of degrading well is that a portal where the join has failed for
 * EVERY row looks exactly like a portal where module booking was never built.
 * That is Ref 46 on production: 27 modules across 9 course pages, every one of
 * them rendering "Contact to book", read as "the feature has not shipped" when
 * the template was current and the rows were empty.
 *
 * Nothing here is fixed by a deploy. Every finding below is a HubDB edit or a
 * seed run, which is why this reports and stops - same contract as
 * `event-engine-audit.ts`, and for the same reason: which session a module
 * should book is an editorial call, never a script's.
 *
 * READ-ONLY by construction: rows in, findings out.
 */
import { EVENTS_ADAPTER, isoDate, text, truthy, type HubDbRow } from './event-engine-audit'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModuleSeverity = 'error' | 'warn' | 'info'

export type ModuleAuditCode =
  /** The `module_booking_url` column is absent from the portal's table. */
  | 'booking_url_column_missing'
  /** `courses.module_product_id` is absent, so the product-id join cannot run. */
  | 'product_id_column_missing'
  /** Carries a product id, but no `courses` row claims it and it has no URL. */
  | 'module_session_not_created'
  /** Row has no booking URL - the module can only be booked by emailing. */
  | 'module_no_booking_url'
  /** Booking URL carries no `session_id` / `event_id`, so it names no session. */
  | 'module_url_no_session_id'
  /** Booking URL points at a different Weld portal's site (a copied dev URL). */
  | 'module_url_foreign_host'
  /** The id in the URL matches no row in `courses` or `events`. */
  | 'module_session_not_found'
  /** Resolves to a session belonging to a DIFFERENT course. */
  | 'module_session_other_course'
  /** Several modules of one course resolve to the same session. */
  | 'module_session_shared'
  /** Resolves, but the session has no `worker_event_id` to reserve against. */
  | 'module_not_bookable'
  /** Bookable, but the only ticket type is member-only. Guests dead-end. */
  | 'module_guest_ticket_missing'
  /** Bookable and ticketed, but no price - the worker's strict guard 409s. */
  | 'module_zero_price'
  /** Cancelled, sold out, or already run. */
  | 'module_off_sale'
  /** No `courses` row carries this `parent_course_id` at all - the page does not exist. */
  | 'parent_course_missing'
  /** No course row for this course_id is Event Engine ready. */
  | 'parent_not_engine_ready'

export interface ModuleFinding {
  code: ModuleAuditCode
  severity: ModuleSeverity
  /** Which layer the fix belongs to. */
  scope: 'table' | 'course' | 'module'
  /** `parent_course_id` the finding belongs to, or '' for a table-level one. */
  courseId: string
  /** HubDB row id, as a string. '' for course- and table-level findings. */
  rowId: string
  /** Human-readable identity for the console report. */
  label: string
  /** What is wrong, in terms of what a visitor experiences. */
  detail: string
  /** The specific edit that resolves it. */
  fix: string
}

/** Per-course roll-up: what the module section on that page actually offers. */
export interface CourseModuleReport {
  courseId: string
  courseName: string
  /** `courses` rows sharing this course_id - each renders the module section. */
  parentRows: number
  /** How many of those carry BOTH use_event_engine and worker_event_id. */
  parentEngineReady: number
  /** Module rows with Show on Website ticked. */
  modules: number
  /** Modules whose booking URL resolved to a real session row. */
  resolved: number
  /**
   * Modules that would render a tickbox: resolved, bookable, on sale, priced,
   * with a ticket a guest may buy - AND a parent row that is engine ready.
   * This is the number the QA sweep counted by hand, per page.
   */
  selectable: number
}

export interface ModuleAuditSummary {
  courses: number
  modules: number
  resolved: number
  selectable: number
  errors: number
  warnings: number
  infos: number
}

export interface ModuleAuditResult {
  findings: ModuleFinding[]
  courses: CourseModuleReport[]
  summary: ModuleAuditSummary
}

export interface ModuleAuditInput {
  /** `course_modules` rows, as the HubDB v3 API returns them. */
  moduleRows: HubDbRow[]
  /** `courses` rows. */
  courseRows: HubDbRow[]
  /** `events` rows. Empty is fine - some portals have none. */
  eventRows?: HubDbRow[]
  /**
   * Column names the portal's `course_modules` table actually has. Omit when
   * unknown; pass it and a missing `module_booking_url` becomes the one finding
   * that explains every other row at once.
   */
  moduleColumns?: string[]
  /**
   * Column names the portal's `courses` table has. Omit when unknown; pass it and
   * a missing `module_product_id` becomes one finding rather than N.
   */
  courseColumns?: string[]
  /**
   * The hostname this portal serves. A booking URL on a DIFFERENT weldaustralia
   * host is a row copied between portals, which resolves fine (the ids ride the
   * query string) and then sends the buyer to the other site.
   */
  siteHost?: string
  /** "Today" as ISO `YYYY-MM-DD`. Defaults to the clock. */
  today?: string
  /** Include modules whose row has Show on Website unticked. Default false. */
  includeHidden?: boolean
}

// ---------------------------------------------------------------------------
// Session resolution
//
// Mirrors theme/templates/partials/_module-session-resolve.html. Parity is the
// point: a finding that describes a page the template does not render is worse
// than no finding, because it sends somebody editing rows that were never the
// problem. The HubL is the authority; this follows it.
// ---------------------------------------------------------------------------

/** The id a booking URL names: `session_id` first, `event_id` as the alternate. */
export function parseSessionId(url: string): string {
  const query = String(url ?? '').split('?')[1] ?? ''
  if (!query) return ''
  let session = ''
  let event = ''
  for (const pair of query.split('&')) {
    const [rawKey, rawValue = ''] = pair.split('=')
    const key = (rawKey ?? '').toLowerCase().trim()
    const value = rawValue.trim()
    if (key === 'session_id' && !session) session = value
    else if (key === 'event_id' && !event) event = value
  }
  return session || event
}

export interface ResolvedSession {
  found: boolean
  source: 'courses' | 'events' | ''
  id: string
  name: string
  /** `courses.course_id` of the resolved row, for the wrong-course check. */
  courseId: string
  workerEventId: string
  memberTicketTypeId: string
  nonMemberTicketTypeId: string
  /** The public price, which is what a guest is quoted and what QA tested. */
  publicPrice: number
  status: string
  hasStarted: boolean
  offSale: boolean
  offSaleLabel: string
}

const EMPTY_SESSION: ResolvedSession = {
  found: false,
  source: '',
  id: '',
  name: '',
  courseId: '',
  workerEventId: '',
  memberTicketTypeId: '',
  nonMemberTicketTypeId: '',
  publicPrice: 0,
  status: '',
  hasStarted: false,
  offSale: false,
  offSaleLabel: ''
}

function number(value: unknown): number {
  const raw = text(value)
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Public price for an `events` row, in the checkout tunnel's own precedence. */
function eventsPublicPrice(values: Record<string, unknown>, publicTicketId: string): number {
  if (publicTicketId) {
    const raw = typeof values.ticket_types_json === 'string' ? values.ticket_types_json : ''
    try {
      const parsed = JSON.parse(raw || '[]')
      if (Array.isArray(parsed)) {
        for (const ticket of parsed) {
          const id = text(ticket?.worker_ticket_type_id) || text(ticket?.id)
          if (id === publicTicketId) return number(ticket?.price_dollars)
        }
      }
    } catch {
      // Unparseable ticket JSON reads as "no ticket price" and falls through to
      // the row's own columns, exactly as the HubL does.
    }
  }
  return number(values.non_member_price) || number(values.price_from)
}

/**
 * Resolves one module booking URL against the two tables, courses first.
 *
 * The precedence is the template's: a `courses` row carrying a worker_event_id
 * wins outright, then an `events` row, then a `courses` row with no worker id
 * (present but not bookable - render what we know).
 */
export function resolveModuleSession(
  url: string,
  coursesById: Map<string, HubDbRow>,
  eventsById: Map<string, HubDbRow>,
  today: string
): ResolvedSession {
  const id = parseSessionId(url)
  if (!id) return { ...EMPTY_SESSION }

  const courseRow = coursesById.get(id)
  const courseValues = courseRow?.values ?? {}
  const courseWorkerId = text(courseValues.worker_event_id)
  const eventRow = courseRow && courseWorkerId ? undefined : eventsById.get(id)

  const session: ResolvedSession = { ...EMPTY_SESSION, id }

  if (courseRow && courseWorkerId) {
    session.found = true
    session.source = 'courses'
    session.name = text(courseValues.course_name) || text(courseRow.name)
    session.courseId = text(courseValues.course_id)
    session.workerEventId = courseWorkerId
    session.memberTicketTypeId = text(courseValues.member_ticket_type_id)
    session.nonMemberTicketTypeId = text(courseValues.non_member_ticket_type_id)
    session.publicPrice = number(courseValues.price_non_member)
    session.status = text(courseValues.status)
    session.hasStarted = startedBefore(isoDate(courseValues.start_date), today)
  } else if (eventRow) {
    const values = eventRow.values ?? {}
    const tickets = EVENTS_ADAPTER.ticketTypes(values)
    session.found = true
    session.source = 'events'
    session.name = text(values.event_name) || text(eventRow.name)
    session.workerEventId = text(values.worker_event_id)
    session.memberTicketTypeId = tickets.member
    session.nonMemberTicketTypeId = tickets.nonMember
    session.publicPrice = eventsPublicPrice(values, tickets.nonMember)
    // The events table carries no status column at all, so an events-sourced
    // module can only ever go off sale on its date.
    session.hasStarted = startedBefore(isoDate(values.event_date), today)
  } else if (courseRow) {
    session.found = true
    session.source = 'courses'
    session.name = text(courseValues.course_name) || text(courseRow.name)
    session.courseId = text(courseValues.course_id)
    session.publicPrice = number(courseValues.price_non_member)
    session.status = text(courseValues.status)
    session.hasStarted = startedBefore(isoDate(courseValues.start_date), today)
  }

  if (['cancelled', 'sold out'].includes(session.status.toLowerCase())) {
    session.offSale = true
    session.offSaleLabel = session.status
  } else if (session.hasStarted) {
    session.offSale = true
    session.offSaleLabel = 'Registrations closed'
  }

  return session
}

/**
 * The `courses` row that teaches this module, found the way
 * _module-session-resolve.html finds it: by `module_product_id`, preferring the
 * soonest sitting still on sale and falling back to the soonest overall so an
 * off-sale module still renders with its badge.
 *
 * This is the join events-engine migration 0031 describes - "The Course Modules
 * HubDB table identifies a module by its HubSpot Product ID" - and it is why a
 * module needs no hand-typed booking URL.
 */
export function findSessionByProductId(
  productId: string,
  courseRows: HubDbRow[],
  today: string
): HubDbRow | undefined {
  if (!productId) return undefined
  const matches = courseRows
    // Only a module session row answers for a module (is_module), as in the HubL: a
    // whole-course row carrying the same product id would sell the course under a
    // module's name, at the course's price (Ref 46).
    .filter(
      (row) =>
        text((row.values ?? {}).module_product_id) === productId &&
        Boolean((row.values ?? {}).is_module)
    )
    .sort((a, b) =>
      isoDate((a.values ?? {}).start_date).localeCompare(isoDate((b.values ?? {}).start_date))
    )
  if (matches.length === 0) return undefined
  const live = matches.find((row) => {
    const values = row.values ?? {}
    const status = text(values.status)
    return (
      !startedBefore(isoDate(values.start_date), today) &&
      status !== 'Cancelled' &&
      status !== 'Sold Out'
    )
  })
  return live ?? matches[0]
}

/**
 * The START date, not the end, and only when there IS one: "we cannot tell when
 * this runs" is not evidence that it is over. CLAUDE.md § 7.6.
 */
function startedBefore(startDate: string, today: string): boolean {
  return Boolean(startDate) && startDate < today
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

function isWeldHost(host: string): boolean {
  return /(^|\.)weldaustralia\.(com\.au|dev)$/i.test(host)
}

/** The host a booking URL points at, or '' for a relative one. */
function urlHost(url: string): string {
  if (!/^https?:\/\//i.test(url)) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function auditCourseModules(input: ModuleAuditInput): ModuleAuditResult {
  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const findings: ModuleFinding[] = []
  const courses: CourseModuleReport[] = []

  const coursesById = new Map<string, HubDbRow>()
  for (const row of input.courseRows) coursesById.set(String(row.id ?? ''), row)
  const eventsById = new Map<string, HubDbRow>()
  for (const row of input.eventRows ?? []) eventsById.set(String(row.id ?? ''), row)

  // A course page is a `courses` row, and several session rows can share one
  // course_id - each renders the same module section, so parent readiness is a
  // property of the group, not of one row.
  const parentsByCourseId = new Map<string, HubDbRow[]>()
  for (const row of input.courseRows) {
    const courseId = text((row.values ?? {}).course_id)
    if (!courseId) continue
    const list = parentsByCourseId.get(courseId) ?? []
    list.push(row)
    parentsByCourseId.set(courseId, list)
  }

  // The finding that explains every other one at once. Reported first and on its
  // own terms: with no column there is nothing to edit row by row, and the fix
  // is a seed run rather than data entry. CLAUDE.md § 11.4 - uploading the theme
  // does not create a HubDB column, so a module-booking deploy that skipped the
  // seed leaves every row reading a field the portal does not have.
  // Same shape for the product-id join: without `courses.module_product_id`
  // nothing can claim a module, so every row falls through to its booking URL and
  // the per-row remedy would be wrong advice on every line.
  const productColumnMissing =
    Array.isArray(input.courseColumns) && !input.courseColumns.includes('module_product_id')
  if (productColumnMissing) {
    findings.push({
      code: 'product_id_column_missing',
      severity: 'error',
      scope: 'table',
      courseId: '',
      rowId: '',
      label: 'courses table',
      detail:
        'The `module_product_id` column does not exist on this portal, so no `courses` row can ' +
        'claim a module by its HubSpot Product ID and every module falls back to a hand-typed ' +
        'booking URL.',
      fix: 'Run `pnpm seed:hubdb -- --env=<env>` to add it, then upload the theme (CLAUDE.md § 11.4).'
    })
  }

  const columnMissing =
    Array.isArray(input.moduleColumns) && !input.moduleColumns.includes('module_booking_url')
  if (columnMissing) {
    findings.push({
      code: 'booking_url_column_missing',
      severity: 'error',
      scope: 'table',
      courseId: '',
      rowId: '',
      label: 'course_modules table',
      detail:
        'The `module_booking_url` column does not exist on this portal, so every module row ' +
        'reads it as blank and every module on every course page renders the "Contact to book" ' +
        'mailto fallback. The template is behaving correctly; it has no URL to use.',
      fix: 'pnpm seed:hubdb -- --env=<env> to add the column, then populate it per module row.'
    })
  }

  const modulesByCourseId = new Map<string, HubDbRow[]>()
  for (const row of input.moduleRows) {
    const values = row.values ?? {}
    if (!input.includeHidden && !truthy(values.show_on_website)) continue
    const parentId = text(values.parent_course_id)
    const list = modulesByCourseId.get(parentId) ?? []
    list.push(row)
    modulesByCourseId.set(parentId, list)
  }

  const courseIds = Array.from(modulesByCourseId.keys()).sort()

  for (const courseId of courseIds) {
    const moduleRows = modulesByCourseId.get(courseId) ?? []
    const parentRows = parentsByCourseId.get(courseId) ?? []
    const engineReadyParents = parentRows.filter((row) => {
      const values = row.values ?? {}
      return truthy(values.use_event_engine) && Boolean(text(values.worker_event_id))
    })
    const courseName =
      text((parentRows[0]?.values ?? {}).course_name) ||
      text(parentRows[0]?.name) ||
      `course_id ${courseId || '(blank)'}`
    // `courseName` already falls back to the id when no course row exists, and
    // "course_id welding-symbols (course_id welding-symbols)" is a report telling
    // the reader it does not know what it is looking at.
    const courseLabel = courseName.startsWith('course_id ')
      ? courseName
      : `${courseName} (course_id ${courseId || '(blank)'})`

    // Which session each module resolves to, worked out before any finding is
    // raised: the shared-session and wrong-course checks need the whole set.
    const resolutions = moduleRows.map((row) => {
      const values = row.values ?? {}
      const url = text(values.module_booking_url)
      // `hubspot_product_id` is the column production fills; `product_id` is the
      // older empty one, kept as a fallback so a portal using it still resolves.
      const productId = text(values.hubspot_product_id) || text(values.product_id)

      // Product id first, then the booking URL - the order
      // _module-session-resolve.html resolves in. The matched row is fed back
      // through the SAME resolver as a synthetic `?session_id=`, so price,
      // ticket and off-sale all derive identically however the row was found:
      // this file's whole job is to describe the page the template renders.
      const productRow = findSessionByProductId(productId, input.courseRows, today)
      const resolvedBy: 'product' | 'url' | '' = productRow ? 'product' : url ? 'url' : ''
      const session = productRow
        ? resolveModuleSession(
            `?session_id=${String(productRow.id ?? '')}`,
            coursesById,
            eventsById,
            today
          )
        : url
          ? resolveModuleSession(url, coursesById, eventsById, today)
          : { ...EMPTY_SESSION }

      return {
        row,
        url,
        productId,
        resolvedBy,
        label: `${text(values.name) || text(row.name) || '(unnamed module)'} (row ${String(row.id ?? '?')})`,
        session
      }
    })

    const sessionCounts = new Map<string, number>()
    for (const r of resolutions) {
      if (!r.session.found) continue
      sessionCounts.set(r.session.id, (sessionCounts.get(r.session.id) ?? 0) + 1)
    }

    let resolved = 0
    let selectable = 0

    for (const { row, url, productId, resolvedBy, label, session } of resolutions) {
      const rowId = String(row.id ?? '')
      const push = (
        code: ModuleAuditCode,
        severity: ModuleSeverity,
        detail: string,
        fix: string
      ): void => {
        findings.push({ code, severity, scope: 'module', courseId, rowId, label, detail, fix })
      }

      if (resolvedBy !== 'product' && !url) {
        // A module carrying a product id needs no URL - it needs the session row
        // that claims that id. Naming the URL as the remedy sends somebody to type
        // one by hand, which is the very thing the product-id join removed.
        if (productId && !productColumnMissing) {
          push(
            'module_session_not_created',
            'error',
            `No \`courses\` row carries module_product_id ${productId}, and this module has no ` +
              'booking URL either, so it renders "Contact to book" and cannot be booked by any path.',
            `Add a \`courses\` row for the session that teaches this module: is_module ticked, ` +
              `module_product_id ${productId}, its own dates, prices, use_event_engine and ` +
              'worker_event_id. The module then resolves with no booking URL at all.'
          )
        } else if (!columnMissing && !productId) {
          push(
            'module_no_booking_url',
            'error',
            'No product id and no booking URL, so this module renders "Contact to book" (a mailto ' +
              'to the training team) and cannot be booked online by any path.',
            'Set HubSpot Product ID on this row and give its session a `courses` row carrying the ' +
              'same module_product_id - or, as the override, set Individual Module Booking URL to ' +
              '/checkout/?session_id=<courses row id>.'
          )
        }
        continue
      }

      // Only when the URL is what resolved the module: once a `courses` row claims
      // the product id the URL is never followed, so its host cannot mislead anyone.
      const host = resolvedBy === 'url' ? urlHost(url) : ''
      if (host && input.siteHost && isWeldHost(host) && host !== input.siteHost) {
        push(
          'module_url_foreign_host',
          'error',
          `Booking URL points at ${host}, not ${input.siteHost}. The ids still resolve here, so ` +
            'the price and dates look right, but "Book this module" sends the buyer to the other ' +
            "site - and that site's row ids are not these ones.",
          `Repoint the URL at ${input.siteHost} and confirm the session id names a row in THIS portal.`
        )
      }

      if (!session.id) {
        push(
          'module_url_no_session_id',
          'error',
          'Booking URL carries no session_id or event_id, so it names no session. The module ' +
            'renders its name and a link, with no dates, no price and no tickbox.',
          'Add ?session_id=<courses row id> (or ?event_id=<events row id>) to the booking URL.'
        )
        continue
      }

      if (!session.found) {
        push(
          'module_session_not_found',
          'error',
          `Session id ${session.id} matches no row in courses or events, so nothing resolves: no ` +
            'dates, no price, no tickbox, and the link leads to a checkout that cannot load the ' +
            'session.',
          'Correct the session id, or restore the session row it names.'
        )
        continue
      }

      resolved++

      if ((sessionCounts.get(session.id) ?? 0) > 1) {
        push(
          'module_session_shared',
          'warn',
          `Resolves to session ${session.id} ("${session.name}"), which ${sessionCounts.get(session.id)} of ` +
            "this course's modules point at. They all show the same dates and the same price, and " +
            'booking any of them books that one session.',
          'Give each module the id of its own session row.'
        )
      }

      if (session.source === 'courses' && session.courseId && session.courseId !== courseId) {
        push(
          'module_session_other_course',
          'warn',
          `Resolves to a session belonging to course_id ${session.courseId} ("${session.name}"), not to ` +
            'this course. The row prices and books someone onto a different course.',
          "Repoint at a session whose course_id matches this module's parent."
        )
      }

      if (session.offSale) {
        push(
          'module_off_sale',
          'info',
          `Resolved session is ${session.offSaleLabel.toLowerCase()}, so the module renders its dates and a ` +
            'badge saying so, with no tickbox and no booking link. Correct if the session really is ' +
            "over; a module pointing at last term's session is not.",
          'Repoint at the next session of this module once it is scheduled.'
        )
        continue
      }

      if (!session.workerEventId) {
        push(
          'module_not_bookable',
          'warn',
          `Resolved session "${session.name}" has no worker_event_id, so there is nothing to reserve ` +
            'against. The module keeps its own "Book this module" link and can never be part of a ' +
            'multi-module selection.',
          'Set worker_event_id on the session row (and its ticket type ids), per CLAUDE.md § 11.5.'
        )
        continue
      }

      if (!session.nonMemberTicketTypeId) {
        push(
          'module_guest_ticket_missing',
          'error',
          `Resolved session "${session.name}" has no ticket a guest may buy, so a logged-out visitor ` +
            'gets no tickbox here and the row is unbuyable for everyone but members.',
          'Add a public (non member-only) ticket type to the session, or set non_member_ticket_type_id.'
        )
        continue
      }

      if (session.publicPrice <= 0) {
        push(
          'module_zero_price',
          'warn',
          `Resolved session "${session.name}" prices at $0 for a guest. The page refuses to make an ` +
            "unpriced row selectable, because the worker's per-module price guard is a strict " +
            'equality check and a $0 quote is a hard price_mismatch at reserve.',
          "Set the session's price_non_member (and the member columns) on the session row."
        )
        continue
      }

      if (engineReadyParents.length > 0) selectable++
    }

    if (parentRows.length === 0) {
      // Its OWN code, not `parent_not_engine_ready`. A tickbox nobody ticked and
      // a course that does not exist are different faults with different owners:
      // one is a row edit by whoever wires sessions, the other is either a typo in
      // `parent_course_id` or a course Weld never migrated into `courses` at all.
      // Sharing a code buried the single genuine wiring finding under seventeen
      // missing courses on the first production run, and left `--json` consumers
      // unable to separate them.
      findings.push({
        code: 'parent_course_missing',
        severity: 'error',
        scope: 'course',
        courseId,
        rowId: '',
        label: courseLabel,
        detail:
          `No courses row carries course_id ${courseId || '(blank)'}, so these ${moduleRows.length} module row(s) ` +
          'are attached to a course page that does not exist and never render at all.',
        fix:
          "Correct Parent Course ID on the module rows to match the course row's course_id - " +
          'or, if this is a short course that has no `courses` row at all, create the course ' +
          'before wiring its modules. The modules cannot render until one of those is true.'
      })
    } else if (engineReadyParents.length === 0) {
      findings.push({
        code: 'parent_not_engine_ready',
        // An error only when there are modules it is holding back. With nothing
        // bookable underneath it, the tickbox was never the blocker.
        severity: selectable > 0 || resolved > 0 ? 'error' : 'warn',
        scope: 'course',
        courseId,
        rowId: '',
        label: courseLabel,
        detail:
          'No row for this course has both use_event_engine ticked and a worker_event_id, so the ' +
          'module selector is switched off on every page for this course. Every module falls back ' +
          'to its own link however well its own session is wired, and the "Book the complete ' +
          'course" card does not render either.',
        fix: 'Tick Use Event Engine and set worker_event_id on the course row, per CLAUDE.md § 11.5.'
      })
    }
    // A course row that is NOT engine ready while a sibling is raises nothing
    // here. Every session of a course shares its course_id, and most sessions
    // are wired for their own Register CTA rather than for this page - so a
    // per-row tick is `event-engine-audit`'s finding to raise, on the row it
    // belongs to. Repeating it per course would bury the courses where NOTHING
    // is ready, which is the one that switches the whole selector off.

    courses.push({
      courseId,
      courseName,
      parentRows: parentRows.length,
      parentEngineReady: engineReadyParents.length,
      modules: moduleRows.length,
      resolved,
      selectable
    })
  }

  const summary: ModuleAuditSummary = {
    courses: courses.length,
    modules: courses.reduce((n, c) => n + c.modules, 0),
    resolved: courses.reduce((n, c) => n + c.resolved, 0),
    selectable: courses.reduce((n, c) => n + c.selectable, 0),
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    infos: findings.filter((f) => f.severity === 'info').length
  }

  return { findings, courses, summary }
}
