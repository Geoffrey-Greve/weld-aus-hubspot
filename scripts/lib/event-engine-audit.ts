/**
 * Pure planner for the Event Engine wiring audit.
 *
 * Why this exists
 * ---------------
 * `use_event_engine` is the editorial opt-in that routes a HubDB row's Register
 * CTA at the on-site checkout tunnel. It is deliberately NOT inferred from the
 * presence of `worker_event_id`: a row can retain stale Worker and ticket ids
 * after being routed back to its legacy registration flow, and the identifiers
 * alone must not re-enable self-service booking (see the comments in
 * `src/modules/corporate-admin/CorporateAdmin.tsx` and
 * `theme/templates/partials/course-modules.html`).
 *
 * The cost of that deliberate design is that a forgotten tickbox is invisible:
 * the row still renders, the CTA still works, and it quietly sends the buyer to
 * the legacy flow while `/checkout/?session_id=<row>` remains transactable for
 * anyone holding the link. This module finds those rows, plus the mirror-image
 * faults where the box IS ticked but the row cannot complete a booking.
 *
 * It is READ-ONLY by construction: it takes rows in and returns findings out.
 * Nothing here writes, and the CLI that wraps it (`scripts/audit-event-engine.ts`)
 * has no write path either. Deciding what a row's registration should do is an
 * editorial call, never a script's.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A HubDB row as the v3 API returns it. Only the bits the audit reads. */
export interface HubDbRow {
  id?: string | number
  name?: string
  /**
   * The dynamic page path, a ROW-LEVEL field on the v3 API
   * (`HubDbTableRowV3.path`) rather than a column. The dynamic-page settings
   * call it `hs_path`, but no table carries a column of that name.
   */
  path?: string
  values?: Record<string, unknown>
}

export type AuditSeverity = 'error' | 'warn' | 'info'

export type AuditCode =
  /** Ticked, but no `worker_event_id` - degrades to the legacy flow; engine unused. */
  | 'ticked_no_worker_id'
  /** Ticked and wired, but no bookable ticket type - the buyer dead-ends at payment. */
  | 'ticked_no_ticket_type'
  /** Wired for the Event Engine but NOT ticked - the forgotten-tickbox case. */
  | 'unticked_with_worker_id'
  /** On the legacy flow with no usable fallback URL - nowhere to send the buyer. */
  | 'no_usable_registration_url'
  /** Ticked with a member ticket only, on a row FLAGGED members-only. Intended. */
  | 'members_only_ticket'
  /** Ticked with a member ticket only, on a row guests ARE offered. A dead end. */
  | 'guest_ticket_missing'
  /** Booking through the Event Engine AND carrying an external registration_url. */
  | 'ticked_with_external_url'
  /** The row's own price columns and its ticket_types_json disagree; the columns win. */
  | 'price_columns_shadow_ticket_json'

export interface AuditFinding {
  code: AuditCode
  severity: AuditSeverity
  /** HubDB row id, as a string. */
  rowId: string
  /** Human-readable row identity for the console report. */
  label: string
  /** What is wrong, in terms of what a visitor experiences. */
  detail: string
  /** The specific edit that resolves it. */
  fix: string
}

export interface AuditSummary {
  /** Rows the audit actually examined. */
  examined: number
  /** Rows skipped because they are cancelled or already finished. */
  skipped: number
  /** Rows examined that produced no finding at all. */
  clean: number
  errors: number
  warnings: number
  infos: number
}

export interface AuditResult {
  findings: AuditFinding[]
  summary: AuditSummary
}

export interface AuditOptions {
  /** Audit rows whose session has already finished. Default false. */
  includePast?: boolean
  /** "Today" for the past-session filter, as ISO `YYYY-MM-DD`. Defaults to the clock. */
  today?: string
}

// ---------------------------------------------------------------------------
// Table adapters
// ---------------------------------------------------------------------------

/**
 * The two tables carrying `use_event_engine` describe a session differently, so
 * each names its own columns rather than the planner guessing. Adding a third
 * table is a new entry here, not a new branch in the rules below.
 */
export interface TableAdapter {
  /** HubDB table name. */
  table: string
  /** Query param the checkout tunnel reads for this table's rows. */
  checkoutParam: 'session_id' | 'event_id'
  /** Column holding the display name. */
  nameColumn: string
  /** Columns that locate the session, most specific first. Used only for the label. */
  placeColumns: string[]
  /** Date columns, earliest-relevant first, used for the past-session filter. */
  dateColumns: string[]
  /** Resolves the row's bookable ticket types. */
  ticketTypes(values: Record<string, unknown>): TicketTypes
  /**
   * Whether the row DECLARES itself members-only, so the template never offers
   * a guest the booking form in the first place.
   *
   * This is what separates an intended member-only ticket list from a dead end.
   * `event-detail.html` gates on `is_members_only`, NOT on the ticket JSON:
   * `_engine_allowed = (not _is_members_only) or _contact_is_active`. So a row
   * with only a member ticket and the flag off hands a logged-out visitor the
   * booking form and then tells them online booking is not configured.
   */
  membersOnly(values: Record<string, unknown>): boolean
  /**
   * Prices the row states in two places that the page now reads in one order.
   *
   * Only the `events` table has two: named columns (`member_price`,
   * `non_member_price`, and the `*_discount_` percentages) AND a price per entry in
   * `ticket_types_json`. Since QA ref 73 / events-engine migration 0044 the named
   * columns win, on the page and in the Worker alike - so wherever the two disagree,
   * a number the tenant typed has quietly stopped being the one anybody pays.
   *
   * `courses` has one price source and returns nothing. Omitted rather than
   * returning an empty array so a third table's author has to decide.
   */
  priceSources?(values: Record<string, unknown>): PriceSourceComparison[]
}

/** One audience's price, as the row states it in each of its two places. */
export interface PriceSourceComparison {
  /** 'member' | 'guest', for the report. */
  audience: string
  /** The figure the named column states, or null when the column is blank. */
  columnDollars: number | null
  /** The figure the matching ticket_types_json entry states, or null. */
  ticketDollars: number | null
  /** Which column the reader should edit. */
  columnName: string
}

export interface TicketTypes {
  /** Ticket a logged-in member reserves against. */
  member: string
  /** Ticket a guest reserves against. Empty = guests cannot book this row. */
  nonMember: string
}

export const COURSES_ADAPTER: TableAdapter = {
  table: 'courses',
  checkoutParam: 'session_id',
  nameColumn: 'course_name',
  placeColumns: ['city', 'delivery_mode'],
  dateColumns: ['end_date', 'start_date'],
  ticketTypes(values) {
    return {
      member: text(values.member_ticket_type_id),
      nonMember: text(values.non_member_ticket_type_id)
    }
  },
  // The courses table has no members-only column, so a course can never declare
  // the intent. Every course whose only ticket is the member one therefore
  // offers guests a checkout it cannot complete.
  membersOnly: () => false
}

export const EVENTS_ADAPTER: TableAdapter = {
  table: 'events',
  checkoutParam: 'event_id',
  nameColumn: 'event_name',
  placeColumns: ['city', 'event_location', 'event_state'],
  dateColumns: ['event_end_date', 'event_date'],
  ticketTypes(values) {
    // Mirrors the resolution in theme/modules/checkout-tunnel.module/module.html:
    // first member_only ticket wins the member slot, first other ticket wins the
    // guest slot, and a row with only a guest ticket serves members from it too.
    let member = ''
    let nonMember = ''
    for (const ticket of parseTicketTypesJson(values.ticket_types_json)) {
      const id = text(ticket.worker_ticket_type_id) || text(ticket.id)
      if (!id) continue
      if (ticket.member_only) {
        if (!member) member = id
      } else if (!nonMember) {
        nonMember = id
      }
    }
    if (!member && nonMember) member = nonMember
    return { member, nonMember }
  },
  membersOnly: (values) => truthy(values.is_members_only),
  priceSources(values) {
    let memberTicket: number | null = null
    let guestTicket: number | null = null
    for (const ticket of parseTicketTypesJson(values.ticket_types_json)) {
      const id = text(ticket.worker_ticket_type_id) || text(ticket.id)
      if (!id) continue
      const price = money(ticket.price_dollars)
      if (ticket.member_only) {
        if (memberTicket === null) memberTicket = price
      } else if (guestTicket === null) {
        guestTicket = price
      }
    }
    // A row with only a guest ticket serves members from it too, which is what both
    // the checkout tunnel and `ticketTypes` above already do.
    if (memberTicket === null) memberTicket = guestTicket

    return [
      {
        audience: 'member',
        columnDollars: money(values.member_price),
        ticketDollars: memberTicket,
        columnName: 'member_price'
      },
      {
        audience: 'guest',
        columnDollars: money(values.non_member_price),
        ticketDollars: guestTicket,
        columnName: 'non_member_price'
      }
    ]
  }
}

export const ADAPTERS: Record<string, TableAdapter> = {
  courses: COURSES_ADAPTER,
  events: EVENTS_ADAPTER
}

// ---------------------------------------------------------------------------
// Value helpers
//
// HubDB is loosely typed on the way out: a boolean arrives as true, 1 or "true"
// depending on how the row was written (UI, CSV import, API), and a select
// column arrives as an object carrying `name`. Normalise once, here.
// ---------------------------------------------------------------------------

/** Normalises a HubDB scalar (including a select object) to a trimmed string. */
export function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const name = (value as { name?: unknown }).name
    if (typeof name === 'string') return name.trim()
  }
  return ''
}

/**
 * A price cell as dollars, or null when the cell is blank / unreadable.
 *
 * Null is "the tenant stated nothing here", which is what makes a blank column a
 * fallback rather than a disagreement. Mirrors `numericValue` in
 * src/shared/utils/memberPricing.ts, which is what the page reads these with.
 */
export function money(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}

/** A price for the report. Plain, because a finding is read in a terminal. */
function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** True for every shape HubDB uses to mean a ticked checkbox. */
export function truthy(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.trim().toLowerCase())
  return false
}

interface RawTicket {
  id?: unknown
  worker_ticket_type_id?: unknown
  member_only?: unknown
  price_dollars?: unknown
}

function parseTicketTypesJson(value: unknown): RawTicket[] {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RawTicket[]) : []
  } catch {
    // Unparseable JSON is reported as "no ticket types" rather than thrown: the
    // buyer-visible effect is identical, and an audit that crashes on one bad
    // row tells you nothing about the other two hundred.
    return []
  }
}

/**
 * Whether a legacy `registration_url` can actually take a booking.
 *
 * Mirrors `isUsableRegistrationUrl` in CourseFilter.tsx, which also rejects a
 * URL pointing back at the page the CTA sits on - a number of imported rows do
 * that, and the CTA then reopens the same page in a new tab. Node has no
 * `window.location` to compare against, so this approximates that check by
 * treating any same-site `/courses/…` or `/events/…` target as self-referential.
 * The approximation can only under-report: a genuinely different course page is
 * still a dead end for this row's buyer.
 */
export function classifyRegistrationUrl(value: unknown): 'usable' | 'missing' | 'self-referential' {
  const url = text(value)
  if (!url || url === '#') return 'missing'

  let path = ''
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url)
      if (!isOwnSiteHost(parsed.hostname)) return 'usable'
      path = parsed.pathname
    } catch {
      return 'usable'
    }
  } else if (url.startsWith('/')) {
    path = url.split('?')[0] ?? ''
  } else {
    return 'usable'
  }

  return /^\/(courses|events|checkout)\//i.test(path) || path === '/checkout'
    ? 'self-referential'
    : 'usable'
}

/**
 * Is this hostname the portal's OWN site?
 *
 * The custom domain is only half of it: HubSpot also serves every page on its hosted
 * domain, `<portalId>.hs-sites-<region>.com` (and `hubspotpagebuilder` variants), and
 * that is the address staff copy out of the page editor. Weld's production audit
 * reported three course rows as `ticked_with_external_url` over URLs reading
 * `https://441838610.hs-sites-ap1.com/checkout/?session_id=...` - the site's own
 * checkout, called external because the host did not match.
 *
 * Mislabelling it is not cosmetic: that finding's remedy says to untick
 * `use_event_engine` so the CTA follows the URL, which would send the buyer to the
 * on-site checkout for whatever `session_id` the link happens to carry. And on an
 * UNTICKED row the same URL reads as a working fallback, so `no_usable_registration_url`
 * stays silent about a Register button that goes nowhere useful.
 */
export function isOwnSiteHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (/(^|\.)weldaustralia\.(com\.au|dev)$/.test(host)) return true
  // HubSpot's own hosting, per portal and per region: 441838610.hs-sites-ap1.com,
  // 1234.hs-sites.com, 1234.hubspotpagebuilder-eu1.com, and so on.
  return /(^|\.)(hs-sites|hubspotpagebuilder)(-[a-z0-9]+)?\.com$/.test(host)
}

// ---------------------------------------------------------------------------
// Row filtering
// ---------------------------------------------------------------------------

/** ISO `YYYY-MM-DD` for a HubDB date value (epoch millis, or an ISO string). */
export function isoDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10)
  const raw = text(value)
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber).toISOString().slice(0, 10)
  }
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10)
}

/**
 * Why a row is not worth auditing, or null if it is.
 *
 * A cancelled session and one that finished last month both render as history.
 * Flagging them buries the rows somebody can still act on, which is the failure
 * mode that stops a report being read.
 */
export function skipReason(
  row: HubDbRow,
  adapter: TableAdapter,
  options: AuditOptions = {}
): string | null {
  const values = row.values ?? {}

  if (text(values.status).toLowerCase() === 'cancelled') return 'cancelled'

  if (!options.includePast) {
    const today = options.today ?? new Date().toISOString().slice(0, 10)
    // The LAST relevant date decides: a multi-day course that started yesterday
    // and runs to Friday is still live, and a row with no date at all is never
    // assumed to be past.
    const dates = adapter.dateColumns.map((c) => isoDate(values[c])).filter(Boolean)
    if (dates.length) {
      const latest = dates.reduce((a, b) => (a > b ? a : b))
      if (latest < today) return 'past'
    }
  }

  return null
}

/** Console label: "AS1796 Cert 10 - Adelaide, 2026-10-12 (row 123)". */
export function rowLabel(row: HubDbRow, adapter: TableAdapter): string {
  const values = row.values ?? {}
  const name = text(values[adapter.nameColumn]) || text(row.name) || '(unnamed row)'
  const place = adapter.placeColumns.map((c) => text(values[c])).find(Boolean) ?? ''
  const date = adapter.dateColumns
    .map((c) => isoDate(values[c]))
    .filter(Boolean)
    .reduce((a, b) => (a < b ? a : b), '9999-12-31')
  const where = [place, date === '9999-12-31' ? '' : date].filter(Boolean).join(', ')
  return `${name}${where ? ` - ${where}` : ''} (row ${String(row.id ?? '?')})`
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * Whether the theme will actually route this row's Register CTA at the checkout.
 *
 * Mirrors the gate in CourseFilter.tsx / CourseTimetableFilter.tsx and the two
 * events surfaces: the tick is the editorial opt-in, `worker_event_id` is what
 * the checkout reserves against, and BOTH are required. Keeping this identical
 * to the theme is what stops the audit describing a page that no longer exists.
 */
export function usesCheckout(values: Record<string, unknown>): boolean {
  return truthy(values.use_event_engine) && Boolean(text(values.worker_event_id))
}

/** Every finding one row can produce. Ordered most severe first. */
export function auditRow(row: HubDbRow, adapter: TableAdapter): AuditFinding[] {
  const values = row.values ?? {}
  const rowId = String(row.id ?? '')
  const label = rowLabel(row, adapter)
  const findings: AuditFinding[] = []

  const ticked = truthy(values.use_event_engine)
  const workerEventId = text(values.worker_event_id)
  const onCheckout = usesCheckout(values)
  const tickets = adapter.ticketTypes(values)
  const checkoutUrl = `/checkout/?${adapter.checkoutParam}=${rowId}`

  if (ticked && !workerEventId) {
    // Not an error any more: the theme degrades this row to its legacy flow
    // rather than dead-ending a buyer at a checkout with nothing to load. It is
    // still a mismatch between what the row asks for and what it gets, which is
    // exactly the warn tier - the tenant ticked the box and the Event Engine is
    // not running this session.
    findings.push({
      code: 'ticked_no_worker_id',
      severity: 'warn',
      rowId,
      label,
      detail:
        'use_event_engine is ticked but there is no worker_event_id, so the CTA falls ' +
        'back to the legacy registration flow. The Event Engine is not selling this ' +
        'session: no live seat counts, no corporate bulk booking, no on-site checkout.',
      fix: 'Set worker_event_id, or untick use_event_engine if the legacy flow is intended.'
    })
  } else if (onCheckout && !tickets.member && !tickets.nonMember) {
    // This one genuinely dead-ends. The checkout loads (it has an event) and
    // then has nothing to reserve, and there is no fallback from that point.
    findings.push({
      code: 'ticked_no_ticket_type',
      severity: 'error',
      rowId,
      label,
      detail:
        `Wired to Event Engine event ${workerEventId} but carries no ticket type, so ` +
        `${checkoutUrl} dead-ends at the payment step for everyone.`,
      fix:
        adapter.table === 'events'
          ? 'Populate ticket_types_json with at least one ticket carrying a worker_ticket_type_id.'
          : 'Set non_member_ticket_type_id (and member_ticket_type_id where member pricing applies).'
    })
  } else if (onCheckout && !tickets.nonMember && adapter.membersOnly(values)) {
    // Deliberate: the row is flagged members-only, so the template never hands a
    // guest the booking form. Reported so it can be eyeballed, not condemned.
    findings.push({
      code: 'members_only_ticket',
      severity: 'info',
      rowId,
      label,
      detail:
        'Only a member ticket type is configured, and the row is flagged ' +
        'members-only, so guests are gated before they reach the booking form.',
      fix: 'Nothing to do. Add a non-member ticket type only if guests should be able to book.'
    })
  } else if (onCheckout && !tickets.nonMember) {
    // The row is NOT flagged members-only, so guests ARE offered the form and
    // then told booking is not configured. Same dead end as no ticket at all,
    // just only for the logged-out half of the audience.
    findings.push({
      code: 'guest_ticket_missing',
      severity: 'error',
      rowId,
      label,
      detail:
        `Only a member ticket type is configured, but the row is not flagged ` +
        `members-only, so ${checkoutUrl} offers logged-out visitors the booking ` +
        `form and then dead-ends them at "Online booking isn't configured".`,
      fix:
        adapter.table === 'events'
          ? 'Add a non-member ticket to ticket_types_json, or tick is_members_only so guests are gated up front.'
          : 'Set non_member_ticket_type_id. The courses table cannot declare a session members-only.'
    })
  }

  if (!ticked && workerEventId) {
    // Whether the direct URL actually transacts depends on the ticket types, and
    // so does the remedy. Telling someone to tick the box on a row with no
    // ticket would move every CTA onto a checkout that dead-ends at payment -
    // the fix would cause the fault the audit exists to find.
    const guestCanBook = Boolean(tickets.nonMember)
    const anyTicket = Boolean(tickets.member || tickets.nonMember)
    findings.push({
      code: 'unticked_with_worker_id',
      severity: 'warn',
      rowId,
      label,
      detail:
        `Wired to Event Engine event ${workerEventId} but use_event_engine is unticked. ` +
        'Every Register CTA uses the legacy registration flow, live seat counts fall back ' +
        'to the hand-typed seats_remaining, and corporate bulk booking hides the session' +
        (guestCanBook
          ? ` - while ${checkoutUrl} still takes a real booking for anyone holding the link.`
          : anyTicket
            ? ` - and ${checkoutUrl} only completes for logged-in members, since the row ` +
              'carries no non-member ticket type.'
            : ` - and ${checkoutUrl} cannot complete for anyone, since the row carries no ` +
              'ticket type at all.'),
      fix: anyTicket
        ? 'Tick use_event_engine, or clear worker_event_id if the legacy flow is intended.'
        : 'Add a ticket type BEFORE ticking use_event_engine, or clear worker_event_id if ' +
          'the legacy flow is intended. Ticking it as-is moves every CTA onto a checkout ' +
          'that dead-ends at payment.'
    })
  }

  // QA ref 121. The row books through the Event Engine AND carries a working
  // external registration_url, and only one of them can win: `_show_engine` in
  // event-detail.html (and the same branch in events-listing.module) prefers the
  // on-site checkout, so the URL is never reached and nothing says so.
  //
  // Weld entered a TryBooking link on SA Open Day and Register Now kept booking
  // on-site. Neither value is wrong on its own and both look right in the HubDB
  // UI, so like ref 86 this is only visible in the relationship between them.
  //
  // INFO, not warn: the row transacts correctly either way, and which one the
  // tenant meant is an editorial call this script does not get to make - the
  // same contract as the rest of the file. It reports and stops.
  if (onCheckout && classifyRegistrationUrl(values.registration_url) === 'usable') {
    findings.push({
      code: 'ticked_with_external_url',
      severity: 'info',
      rowId,
      label,
      detail:
        `Books through the Event Engine and also carries registration_url ` +
        `${text(values.registration_url)}. The Register CTA prefers the on-site ` +
        'checkout whenever use_event_engine and worker_event_id are both set, so ' +
        'that address is never used and no visitor reaches it.',
      fix:
        'Nothing to do if on-site booking is intended. To send people to the external ' +
        'page instead, untick use_event_engine - the CTA then follows registration_url. ' +
        'Clearing registration_url removes the ambiguity either way.'
    })
  }

  // QA ref 73 / events-engine migration 0044. An events row states its prices in two
  // places - the named columns and a price per entry in `ticket_types_json` - and since
  // 0044 the named columns win, on the page AND in the Worker. So wherever the two
  // disagree, a figure the tenant typed has quietly stopped being the one anybody pays.
  //
  // INFO, like `ticked_with_external_url` and for the same reason: the row transacts
  // correctly and consistently either way, both values look right in the HubDB UI, and
  // which one the tenant meant is an editorial call this script does not get to make.
  // It reports and stops.
  //
  // Reading it off a page is impossible - the page shows one number and gives no hint
  // that a second exists - which is why it is here rather than left to QA.
  for (const source of adapter.priceSources?.(values) ?? []) {
    const { columnDollars, ticketDollars } = source
    if (columnDollars === null || ticketDollars === null) continue
    if (columnDollars === ticketDollars) continue
    findings.push({
      code: 'price_columns_shadow_ticket_json',
      severity: 'info',
      rowId,
      label,
      detail:
        `The ${source.audience} price is stated twice and the two disagree: ` +
        `${source.columnName} says ${formatDollars(columnDollars)} and the matching ` +
        `ticket_types_json entry says ${formatDollars(ticketDollars)}. ` +
        `${formatDollars(columnDollars)} is what the buyer is quoted and invoiced - the ` +
        'column outranks the JSON on the checkout tunnel, on the event widget and in ' +
        'the Worker alike.',
      fix:
        `Set ${source.columnName} to the price you intend to charge, or clear it to fall ` +
        'back to the ticket type. Leaving both set is not wrong, but the JSON figure is ' +
        'no longer read and will drift unnoticed.'
    })
  }

  // Keyed off the real gate, not the raw tick: a ticked-but-unwired row is on
  // the legacy flow too, so it needs a working registration_url just as much.
  if (!onCheckout) {
    const registration = classifyRegistrationUrl(values.registration_url)
    if (registration !== 'usable') {
      findings.push({
        code: 'no_usable_registration_url',
        severity: 'warn',
        rowId,
        label,
        detail:
          registration === 'missing'
            ? 'Not booking through the Event Engine and has no registration_url, so ' +
              'Register falls back to a mailto: link to the training team.'
            : 'Not booking through the Event Engine and registration_url points back into ' +
              'the site, which the CTA treats as missing and falls back to a mailto: link.',
        fix: 'Wire the row to the Event Engine, or set a registration_url that starts an enrolment.'
      })
    }
  }

  return findings
}

const SEVERITY_ORDER: Record<AuditSeverity, number> = { error: 0, warn: 1, info: 2 }

/** Audits a whole table. */
export function auditRows(
  rows: HubDbRow[],
  adapter: TableAdapter,
  options: AuditOptions = {}
): AuditResult {
  const findings: AuditFinding[] = []
  let examined = 0
  let skipped = 0
  let clean = 0

  for (const row of rows) {
    if (skipReason(row, adapter, options)) {
      skipped += 1
      continue
    }
    examined += 1
    const rowFindings = auditRow(row, adapter)
    if (rowFindings.length === 0) clean += 1
    findings.push(...rowFindings)
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.label.localeCompare(b.label)
  )

  return {
    findings,
    summary: {
      examined,
      skipped,
      clean,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warn').length,
      infos: findings.filter((f) => f.severity === 'info').length
    }
  }
}
