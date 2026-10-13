/**
 * /courses badges a course whose sessions have all already started.
 *
 * The directory card had no notion of a finished session at all. A course that
 * ran in August listed in September as an ordinary, bookable card (QA ref 120,
 * Visual Welding Inspection), and the only way to get it off the page was the
 * "Starting from today" toggle - which is opt-in, and which also hid the Online
 * Welding Supervisor course, a rolling all-year offering whose start date is in
 * the past (QA ref 107). Weld Australia asked, reasonably, what the filter was
 * for. It is a convenience; the badge is the correctness mechanism.
 *
 * CLAUDE.md § 7.6: a session whose START date has passed is closed, because that
 * is the Worker's own default cutoff (`registration_closes_at` NULL resolves to
 * `starts_at`) said one page earlier. Nothing is hidden - a closed course still
 * renders, badged - and "Sold out" / "Cancelled" are editorial decisions that
 * outrank it and keep their own badge.
 *
 * HubL cannot be executed here, so these read the source, and pin the HubL date
 * rule against `hasStartDatePassed`, its TypeScript twin in the React islands.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasStartDatePassed } from '../../src/shared/api/eventEngine'

const read = (path: string): string => readFileSync(resolve(__dirname, '../../', path), 'utf8')

const RULE = read('theme/templates/partials/_session-priceable.html')
const CARD = read('theme/modules/featured-courses.module/module.html')
const CARD_CSS = read('theme/modules/featured-courses.module/module.css')

describe('_session-priceable.html exports the date rule on its own', () => {
  it('defines has_started as a macro of its own', () => {
    expect(RULE).toMatch(/\{%\s*macro has_started\(row, today_key\)\s*%\}/)
  })

  it('priceable calls it rather than repeating the comparison', () => {
    const body = RULE.slice(RULE.indexOf('{% macro priceable('))
    expect(body).toMatch(/_has_started\s*=\s*has_started\(row, today_key\)/)
    // The literal date comparison must exist exactly once in the file, inside
    // has_started. Two copies is how a badge and a price start disagreeing.
    expect(RULE.match(/_start_key\s*<\s*today_key/g)).toHaveLength(1)
  })

  it('compares whole local days, like hasStartDatePassed does', () => {
    expect(RULE).toMatch(/datetimeformat\('%Y%m%d'\)/)
    // Its TypeScript twin, on the same three cases.
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86_400_000)
    const tomorrow = new Date(today.getTime() + 86_400_000)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    expect(hasStartDatePassed(iso(yesterday))).toBe(true)
    expect(hasStartDatePassed(iso(tomorrow))).toBe(false)
    // A row with no date is never treated as finished, in either language.
    expect(hasStartDatePassed('')).toBe(false)
    expect(RULE).toMatch(/if row\.start_date else ''/)
  })
})

describe('the /courses card', () => {
  it('asks has_started per session, not only priceable', () => {
    // `priceable` also demands a way to buy, so a course with upcoming sessions
    // and no registration URL would otherwise be badged as finished.
    expect(CARD).toMatch(/wa_session\.has_started\(s, _fc_today_key\)/)
  })

  it('tracks whether any session is still to come', () => {
    expect(CARD).toMatch(/namespace\(member=0, public=0, found=false, has_open=false\)/)
    expect(CARD).toMatch(/_card_prices\.has_open = true/)
  })

  it('does not count an off-sale session as evidence the course is still open', () => {
    // Cancelled, and since Ref 74c Sold Out and Closed too, through the shared
    // vocabulary: an upcoming sitting nobody can book does not keep a card bookable.
    const mark = CARD.indexOf('{% set _card_prices.has_open = true %}')
    const guard = CARD.lastIndexOf('{% if not _s_started and not _s_off_sale %}', mark)
    expect(guard).toBeGreaterThan(-1)
    expect(mark - guard).toBeLessThan(200)
    expect(CARD).toContain('{% set _s_off_sale = wa_status.is_off_sale(s.status.name) | trim %}')
  })

  it('derives the directory card status from every session, not the representative row', () => {
    // The representative row is arbitrary. Its own status disabled a course with another
    // open sitting, and left "Register now" on one whose only upcoming sitting was Closed.
    expect(CARD).toMatch(
      /\{% if directory_mode\.enabled and fc_sessions\.rows \| length > 0 %\}\s*\{% set status_key = _card_status_key %\}/
    )
    const decide = CARD.slice(CARD.indexOf('{% if _card_prices.has_open %}'))
    const order = [
      "{% set _card_status_key = 'available' %}",
      "{% set _card_status_key = 'sold_out' %}",
      "{% set _card_status_key = 'registration_closed' %}",
      "{% set _card_status_key = 'cancelled' %}",
    ].map((line) => decide.indexOf(line))
    for (const at of order) expect(at).toBeGreaterThan(-1)
    // Open first: any on-sale upcoming sitting makes the whole course bookable.
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // Cancelled only when EVERY row is: one withdrawn sitting beside sessions that have
    // run is the date badge's case, not a cancelled course.
    expect(decide).toContain('_card_status.cancelled == _card_status.sessions')
  })

  it('badges a single-session card off the row itself', () => {
    expect(CARD).toMatch(/registrations_closed = wa_session\.has_started\(row, _fc_today_key\)/)
  })

  it('leaves a course with no dated session alone', () => {
    // card_start_value is the set of session start dates; empty means nothing is
    // dated, which is not evidence the course is over.
    expect(CARD).toMatch(/registrations_closed = card_start_value and not _card_prices\.has_open/)
  })

  it('lets Sold Out, Cancelled and Closed outrank it — they say more than a date can', () => {
    // Every editorial status, through the shared vocabulary (Ref 74c), not a comparison
    // against the one word 'Available'.
    expect(CARD).toMatch(
      /\{%\s*if not status_bookable\s*%\}\{%\s*set registrations_closed = false\s*%\}/
    )
  })

  it('renders the badge, and says closed rather than sold out', () => {
    expect(CARD).toMatch(/\{%\s*elif registrations_closed\s*%\}/)
    expect(CARD).toMatch(/Registrations closed/)
    expect(CARD).toMatch(/wa-fc__status-badge--closed/)
  })

  it('still renders the course — a badged card, never a dropped one', () => {
    // The badge sits inside the card's badge list, so nothing gates the <article>
    // or the grid item on it.
    expect(CARD).not.toMatch(/\{%\s*if not registrations_closed\s*%\}[\s\S]{0,200}<article/)
    expect(CARD).not.toMatch(/\{%\s*if not registrations_closed\s*%\}[\s\S]{0,200}<li class="wa-fc__grid-item/)
  })

  it('styles the badge', () => {
    expect(CARD_CSS).toMatch(/\.wa-fc__status-badge--closed\s*\{/)
  })
})

/**
 * QA ref 107, the second half: with the badge doing the correctness work, the
 * "Starting from today" toggle had one remaining effect and that effect was the
 * bug - it hid a rolling all-year course. Weld asked what benefit it added. None,
 * so it is gone rather than relabelled.
 */
describe('the "Starting from today" toggle is gone', () => {
  it('renders no toggle', () => {
    expect(CARD).not.toMatch(/data-wa-fc-starting-today/)
    expect(CARD).not.toMatch(/Starting from today<\/span>/)
  })

  it('leaves no filter clause behind it', () => {
    expect(CARD).not.toMatch(/activeStartingToday|hasStartingTodayOrFuture/)
    expect(CARD).toMatch(
      /return filterMatch && cityMatch && deliveryMatch && searchMatch;/
    )
  })

  it('leaves no dead browser clock behind it', () => {
    // `getLocalTodayIso` existed only to feed the toggle. Whether a session has
    // run is decided server-side now, by the shared macro - one definition, not a
    // browser clock and a HubL one free to disagree across a timezone boundary.
    expect(CARD).not.toMatch(/getLocalTodayIso|todayIso/)
  })

  it('drops its styles too', () => {
    expect(CARD_CSS).not.toMatch(/wa-fc-start-toggle/)
  })

  it('does not draw an empty filter bar now that the row can be empty', () => {
    // The toggle was the one control in that row that always rendered. A module
    // offering a single location and a single delivery mode would otherwise draw
    // the divider rule over nothing.
    expect(CARD).toMatch(
      /\{% if module\.show_filters and \(fc_location_options\.items \| length > 1 or fc_delivery_options\.items \| length > 1\) %\}/
    )
  })

  it('keeps the filters the toggle sat beside', () => {
    expect(CARD).toMatch(/data-wa-fc-city=/)
    expect(CARD).toMatch(/data-wa-fc-delivery=/)
  })
})
