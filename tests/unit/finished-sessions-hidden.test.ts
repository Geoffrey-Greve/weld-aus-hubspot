/**
 * A session that has FINISHED leaves the website (QA ref 120).
 *
 * Weld's training team asked on 22 Sep for courses to come off the site once they are
 * over, rather than sit there badged: /courses/iwi-b-hobart stayed listed with both its
 * dates in the past. The rule is the END date, deliberately not the start: a session that
 * has begun and not finished is still running and keeps its "Registrations closed" badge
 * (`has_started`, § 7.6), and a row with no end date never counts as ended, because the
 * rolling all-year Online Welding Supervisor course starts in the past (QA ref 107).
 *
 * The same review found the card for a date-closed course still carried a working
 * "Register now": only the HubDB status reached the CTA gate.
 *
 * HubL cannot run here, so these read the shipped source.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(__dirname, '../../', path), 'utf8')

const RULE = read('theme/templates/partials/_session-priceable.html')

/** Every surface that LISTS course sessions, and must drop finished ones. */
const LISTINGS = [
  'theme/modules/featured-courses.module/module.html',
  'theme/modules/course-filter.module/module.html',
  'theme/modules/course-timetable-filter.module/module.html',
  'theme/modules/course-timetable-compact.module/module.html',
  'theme/templates/partials/training-course-cards.html',
]

describe('has_ended', () => {
  it('is defined once, beside has_started, and reads the END date', () => {
    expect(RULE).toMatch(/\{%\s*macro has_ended\(row, today_key\)\s*%\}/)
    const body = RULE.slice(RULE.indexOf('{% macro has_ended('), RULE.indexOf('{% endmacro %}', RULE.indexOf('{% macro has_ended(')))
    expect(body).toMatch(/row\.end_date \| datetimeformat\('%Y%m%d'\)/)
    expect(body).not.toMatch(/start_date/)
  })

  it('never treats a row with no end date as finished', () => {
    expect(RULE).toMatch(/row\.end_date \| datetimeformat\('%Y%m%d'\) if row\.end_date else ''/)
    expect(RULE).toMatch(/_end_key and today_key and _end_key < today_key/)
  })
})

describe('every course listing drops finished sessions', () => {
  for (const path of LISTINGS) {
    it(path, () => {
      const src = read(path)
      expect(src).toMatch(/_session-priceable\.html" as wa_session/)
      expect(src).toMatch(/not wa_session\.has_ended\(/)
      // Loop `continue` is not something HubL is relied on for here; the lists are
      // pre-filtered instead.
      expect(src).not.toMatch(/\{%\s*continue\s*%\}/)
    })
  }
})

describe('the /courses card CTA', () => {
  it('disables Register now when every sitting has started, not only on a HubDB status', () => {
    const card = read('theme/modules/featured-courses.module/module.html')
    const actions = card.slice(card.indexOf('<div class="wa-fc__actions">'))
    const gate = actions.indexOf('{% elif registrations_closed %}')
    expect(gate).toBeGreaterThan(-1)
    // It must be tested BEFORE either Register now branch.
    expect(gate).toBeLessThan(actions.indexOf('href="{{ register_href }}"'))
  })
})
