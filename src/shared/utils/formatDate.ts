/**
 * Date formatting utilities for the Weld Australia theme.
 *
 * All dates in HubDB and CRM properties are ISO 8601 strings.
 * These helpers normalise display to Australian English conventions.
 */

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
}

/**
 * Format an ISO date string as a localised Australian English date.
 *
 * @example formatDate('2026-05-16') → "16 May 2026"
 */
export function formatDate(
  isoString: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_OPTIONS
): string {
  return new Intl.DateTimeFormat('en-AU', options).format(new Date(isoString))
}

/**
 * Short date format: day + abbreviated month + year.
 *
 * @example formatDateShort('2026-05-16') → "16 May 2026"
 */
export function formatDateShort(isoString: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(isoString))
}

/**
 * Format a date range as a compact string.
 *
 * Same month: "16-18 May 2026"
 * Cross-month: "16 May - 2 June 2026"
 * Cross-year:  "28 Dec 2026 - 3 Jan 2027"
 *
 * The end date is only ever ADDED to the start date. A missing, unparseable or
 * BACKWARDS end date renders the start date alone, because a range that runs backwards
 * is not information, it is a typo being published: Ref 40 found a live session listed
 * as "1 Dec - 1 Oct 2024" on /courses/iwe. The start date is the half a visitor can act
 * on, and it is the half every other rule reads (see `hasStartDatePassed`), so it is the
 * half that survives.
 *
 * The start's YEAR is kept whenever it differs from the end's. Separate defect, same
 * page: a course running 28 December into 3 January rendered "28 Dec - 3 Jan 2027", which
 * reads as starting in December 2027, a year late. That one is valid data rendered
 * ambiguously rather than a typo, and it affects any course that runs over New Year.
 *
 * @example formatDateRange('2026-05-16', '2026-05-18') → "16-18 May 2026"
 * @example formatDateRange('2026-05-30', '2026-06-02') → "30 May - 2 June 2026"
 * @example formatDateRange('2026-12-28', '2027-01-03') → "28 Dec 2026 - 3 Jan 2027"
 * @example formatDateRange('2026-12-01', '2024-10-01') → "1 December 2026"
 */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return ''

  const end = new Date(endIso)
  // No end, an unparseable one, or one that precedes the start: the start stands alone.
  if (Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return formatDate(startIso)
  }

  const sameYear = start.getFullYear() === end.getFullYear()
  const sameMonth = sameYear && start.getMonth() === end.getMonth()

  if (sameMonth) {
    const startDay = new Intl.DateTimeFormat('en-AU', { day: 'numeric' }).format(start)
    const endFull = new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(end)
    return `${startDay}-${endFull}`
  }

  const startPart = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(start)
  const endPart = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(end)
  return `${startPart} - ${endPart}`
}
