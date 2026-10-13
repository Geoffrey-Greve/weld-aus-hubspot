import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasStartDatePassed } from '../../src/shared/api/eventEngine'
import { HUBDB_STATUS_ALIASES, statusPresentation } from '../../src/shared/status/sessionStatus'

/**
 * The "From $X ex GST" figures on a course page, and the price on its card in /courses.
 *
 * Ref 46 round 2 item 4: AS1796 Cert 10 advertised "From $4,950" against a single
 * bookable session at $6,000, and IWI-S "From $8,800" against $9,450. The panel takes the
 * MINIMUM price across every `courses` row sharing the course id, and it was taking it
 * across rows nobody could buy - sessions that had already run, and ones staff had
 * cancelled or closed. A headline price no customer can pay is worse than no headline
 * price at all.
 *
 * Ref 40 found the other half of it: the /courses directory card took the FIRST row HubDB
 * returned for the course, so one course quoted a different number on the card, in the
 * upcoming-sessions strip and in the fees panel, and the card's was routinely a session
 * that had already run. The rule now lives once, in `_session-priceable.html`, and both
 * surfaces read it - which is the only way "they agree" can be a property of the code
 * rather than a coincidence. It gained a third condition there: a row a visitor has no
 * way to BUY cannot set the price either, which is how /courses/iwe came to advertise
 * "From $60" off a row called "IWE Module 1 Test".
 *
 * HubL cannot be executed here, so these read the source and work out which {% if %}
 * conditions the minimum sits inside - the same technique as
 * course-modules-combined-booking.test.ts. They also pin the CMS-side rule against
 * `hasStartDatePassed`, its TypeScript twin in the React islands: the panel and the
 * session cards below it have to agree about which sessions are still on sale, and they
 * are written in two languages that cannot import from each other.
 */

const read = (path: string): string => readFileSync(resolve(__dirname, '../../', path), 'utf8')

const RULE = read('theme/templates/partials/_session-priceable.html')
const PANEL = read('theme/modules/pricing-table.module/module.html')
const CARD = read('theme/modules/featured-courses.module/module.html')

interface Tag {
  index: number
  kind: 'if' | 'elif' | 'else' | 'endif' | 'for' | 'endfor'
  expression: string
}

function tags(source: string): Tag[] {
  const found: Tag[] = []
  const pattern = /\{%-?\s*(if|elif|else|endif|for|endfor)\b([^%]*)%\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    found.push({
      index: match.index,
      kind: match[1] as Tag['kind'],
      expression: match[2].trim()
    })
  }
  return found
}

/** The stack of {% if %} expressions enclosing `needle`, {% else %} reported negated. */
function enclosingConditions(source: string, needle: string): string[] {
  const at = source.indexOf(needle)
  expect(at, `fragment not found: ${needle}`).toBeGreaterThan(-1)

  const stack: string[] = []
  for (const tag of tags(source)) {
    if (tag.index >= at) break
    switch (tag.kind) {
      case 'if':
        stack.push(tag.expression)
        break
      case 'elif':
      case 'else':
        stack[stack.length - 1] = `not (${stack[stack.length - 1]})`
        break
      case 'endif':
        stack.pop()
        break
      default:
        break
    }
  }
  return stack
}

const definitionIn = (source: string, name: string): string => {
  const line = source.split('\n').find((candidate) => candidate.includes(`set ${name} =`))
  expect(line, `no definition for ${name}`).toBeDefined()
  return line as string
}

describe('course "from" price is drawn from priceable sessions only', () => {
  it('takes the panel minimum inside the shared gate, not across every row', () => {
    for (const minimum of [
      '{% set _price_ns.member = _member_price %}',
      '{% set _price_ns.public = _public_price %}'
    ]) {
      expect(
        enclosingConditions(PANEL, minimum).some((condition) =>
          condition.includes('wa_session.priceable')
        ),
        `${minimum} is no longer gated on the shared priceable rule`
      ).toBe(true)
    }
    expect(PANEL).toContain('_session-priceable.html')
  })

  it('prices the /courses card from the same rule, so the two cannot disagree', () => {
    for (const minimum of [
      '{% set _card_prices.member = _s_member %}',
      '{% set _card_prices.public = _s_public %}'
    ]) {
      expect(
        enclosingConditions(CARD, minimum).some((condition) =>
          condition.includes('wa_session.priceable')
        ),
        `${minimum} is no longer gated on the shared priceable rule`
      ).toBe(true)
    }
    // And the card's displayed figures come from that minimum, not from whichever row
    // HubDB happened to return first for the course.
    expect(CARD).toContain('{% set price_member = _card_prices.member %}')
    expect(CARD).toContain('{% set price_non_member = _card_prices.public %}')
    // A minimum across sessions is a "from", and says so.
    expect(CARD).toContain("{% set price_prefix = 'From ' if directory_mode.enabled else '' %}")
  })

  it('excludes a session that has already started', () => {
    // The Worker's own default cutoff: registration_closes_at NULL resolves to starts_at
    // (migration 0038). Neither surface asks the Worker anything, so it says it in HubL.
    // The comparison moved into its own `has_started` macro when the /courses card needed
    // to BADGE a finished course as well as decline to price it (QA refs 120 and 107);
    // `priceable` delegates to it, so there is still exactly one definition.
    expect(definitionIn(RULE, '_has_started')).toContain('has_started(row, today_key)')
    const hasStartedMacro = RULE.slice(
      RULE.indexOf('{% macro has_started('),
      RULE.indexOf('{% macro priceable(')
    )
    expect(hasStartedMacro).toContain('_start_key < today_key')
    expect(RULE).toContain('not _has_started')
    // Compared against the request's own clock, not a build-time constant.
    expect(PANEL).toContain("{% set _today_key = local_dt | datetimeformat('%Y%m%d') %}")
    expect(CARD).toContain("{% set _fc_today_key = local_dt | datetimeformat('%Y%m%d') %}")
    // START date. END date would let a course that began three weeks ago keep setting the
    // price of a page that can no longer sell it.
    expect(definitionIn(RULE, '_start_key')).toContain('row.start_date')
  })

  it('excludes every editorial closure the shared vocabulary knows, and only those', () => {
    // CLAUDE.md § 7.6 / § 7.11: Cancelled, Sold Out and Closed (Ref 74c) are decisions a
    // person made. This is a macro file, so the key list is written out rather than
    // imported from session-status.html - which makes it the one copy that can drift, and
    // this the test that stops it. A Closed session left in the minimum put a price on
    // the card and the fees panel that no one could pay.
    const offSale = Object.entries(HUBDB_STATUS_ALIASES)
      .filter(([, status]) => !statusPresentation(status).bookable)
      .map(([alias]) => alias)
      .sort()
    const listed = RULE.match(/_status_key not in \[([^\]]*)\]/)
    expect(listed).not.toBeNull()
    const keys = [...listed![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    expect(keys).toEqual(offSale)
    expect(keys).toContain('closed')
    // Normalised the way the TypeScript normalises, or "Sold Out" never matches sold_out.
    expect(definitionIn(RULE, '_status_key')).toContain("| lower | trim | replace(' ', '_') | replace('-', '_')")
  })

  it('excludes a session with no way to buy it', () => {
    // Ref 40: /courses/iwe priced itself off "IWE Module 1 Test" at $60, a row badged
    // "Online booking is not available for this session yet", while its only bookable
    // session sold at $18,786.36. The Event Engine pairing is the one § 11.5 requires
    // before any CTA routes at the checkout - the tick alone is never enough.
    expect(definitionIn(RULE, '_uses_engine')).toContain('row.use_event_engine')
    expect(definitionIn(RULE, '_uses_engine')).toContain('_worker_id')
    expect(definitionIn(RULE, '_has_reg_url')).toContain("_reg_url != '#'")
    expect(RULE).toContain('(_uses_engine or _has_reg_url)')
  })

  it('keeps a row with no start date rather than guessing it is over', () => {
    // "We cannot tell when this runs" is not evidence that it has run. The TypeScript twin
    // reads a missing date the same way, and both are the safe direction: the page keeps
    // offering the session and the Worker refuses at reserve if it is wrong.
    expect(definitionIn(RULE, '_start_key')).toContain("if row.start_date else ''")
    expect(RULE).toContain('_start_key and today_key')
    expect(hasStartDatePassed('')).toBe(false)
  })

  it('states a saving some real session actually offers', () => {
    // The two minima are taken independently and can land on different sessions, so
    // differencing them advertises a discount no single session gives. The largest
    // per-row saving is what "up to" then literally means.
    expect(PANEL).toContain('{% set _price_ns.saving = _public_price - _member_price %}')
    expect(definitionIn(PANEL, '_show_dynamic_member_savings')).toContain('_price_ns.saving > 0')
    expect(PANEL).toContain('Members save up to {{ _price_ns.saving')
    expect(PANEL).not.toContain('(_price_ns.public - _price_ns.member) | format_currency')
  })

  it('falls through to "Contact us" when nothing is bookable, rather than a stale price', () => {
    // Both figures stay 0, _dynamic_prices is false for the member card, and the standard
    // card prints "Contact us" over a link into the session selector's EOI form.
    expect(definitionIn(PANEL, '_dynamic_prices')).toContain(
      '_price_ns.member > 0 or _price_ns.public > 0'
    )
    expect(PANEL).toContain("{% if _price_ns.public > 0 %}From {{ _price_ns.public")
    expect(PANEL).toContain('{% else %}Contact us{% endif %}')
  })
})
