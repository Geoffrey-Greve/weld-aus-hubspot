import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Gating and pricing for the module selector in
 * theme/templates/partials/course-modules.html.
 *
 * The selection posts to /checkout/?session_id=<parent course row>, and the
 * checkout tunnel reserves it against the PARENT row's Event Engine event
 * (EventEnginePayment reads session.worker_event_id as its eventId). So a
 * parent row with no Event Engine configuration can render a selector that
 * sends the buyer to a payment step which can only say "Online booking isn't
 * configured".
 *
 * These tests read the HubL source and work out which {% if %} conditions each
 * fragment sits inside, so a future edit that moves a control out of its gate
 * fails here rather than in production.
 */

const PARTIAL = readFileSync(
  resolve(__dirname, '../../theme/templates/partials/course-modules.html'),
  'utf8'
)

const RESOLVER = readFileSync(
  resolve(__dirname, '../../theme/templates/partials/_module-session-resolve.html'),
  'utf8'
)

const HANDOFF_UTIL = readFileSync(
  resolve(__dirname, '../../src/shared/utils/checkoutPricingHandoff.ts'),
  'utf8'
)

const GATE = '_combined_booking_enabled'

/** The HubL block tags we care about, in source order. */
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

/**
 * The stack of {% if %} expressions enclosing `needle`. An {% else %} branch
 * reports its condition negated, so "rendered when the gate is false" is
 * distinguishable from "rendered when it is true".
 */
function enclosingConditions(source: string, needle: string): string[] {
  const at = source.indexOf(needle)
  expect(at, `fragment not found in partial: ${needle}`).toBeGreaterThan(-1)

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

const gatedOn = (needle: string): boolean =>
  enclosingConditions(PARTIAL, needle).some((condition) => condition.includes(GATE))

const definitionOf = (name: string): string => {
  const line = PARTIAL.split('\n').find((candidate) => candidate.includes(`set ${name} =`))
  expect(line, `no definition for ${name}`).toBeDefined()
  return line as string
}

describe('course-modules combined booking gate', () => {
  it('requires the parent row to be Event Engine configured with at least one bookable module', () => {
    // The editorial opt-in and the worker identifier the checkout reserves against.
    const parentReady = definitionOf('_parent_engine_ready')
    expect(parentReady).toContain('dynamic_page_hubdb_row.use_event_engine')
    expect(parentReady).toContain('_parent_worker_event_id')

    // One ticked row is a valid booking (the worker accepts 1..12 selected
    // modules), so the old "two or more" rule would hide a single bookable
    // module behind a checkbox that could never submit.
    const gate = definitionOf(GATE)
    expect(gate).toContain('_parent_engine_ready')
    expect(gate).toContain('_modules_ns.bookable > 0')

    // The worker id is read off the parent row, not a module row.
    expect(PARTIAL).toContain(
      "{% set _parent_worker_event_id = dynamic_page_hubdb_row.worker_event_id | default('', true) | string | trim %}"
    )
  })

  it('requires the parent session to still be on sale, not merely wired up', () => {
    // /reserve-selected-modules checks the PARENT course's sales window before it
    // looks at any selected module, and migration 0038 closes registration at
    // starts_at by default. A page served by a row that ran in August therefore
    // rendered tickboxes, priced a basket and was refused at reserve with
    // "Registrations for this course have closed" - which was eight of Weld's nine
    // module-bearing course pages on 2026-09-20.
    expect(definitionOf('_parent_engine_ready')).toContain('_parent_on_sale')

    const onSale = definitionOf('_parent_on_sale')
    expect(onSale).toContain('_parent_has_started')
    // Cancelled, Sold Out AND Closed (Ref 74c), through the shared vocabulary rather than
    // a list that has to be remembered each time the status set grows.
    expect(onSale).toContain('_parent_off_sale')
    expect(PARTIAL).toContain('{% import "./session-status.html" as wa_status %}')
    expect(definitionOf('_parent_off_sale')).toContain(
      'wa_status.is_off_sale(dynamic_page_hubdb_row.status.name)'
    )
    expect(onSale).not.toContain("'Sold Out'")
  })

  it('takes the started-session rule from the shared macro, not a second copy', () => {
    // _session-priceable.html already owns "has this row started", and the fees
    // panel and the directory card both read it. A second date rule here is how
    // the badge and the price came apart before it existed.
    expect(PARTIAL).toContain('{% import "./_session-priceable.html" as wa_session %}')
    expect(definitionOf('_parent_has_started')).toContain('wa_session.has_started(dynamic_page_hubdb_row')
  })

  it('gates the complete-course CTA on the same parent being sellable', () => {
    // It reserves against the same parent event and fails the same way, so it
    // must not outlive the selector.
    expect(definitionOf('_complete_course_available')).toContain('_parent_engine_ready')
  })

  it('counts bookable modules before the display loop renders any checkbox', () => {
    const countedAt = PARTIAL.indexOf('_modules_ns.bookable = _modules_ns.bookable + 1')
    const firstCheckbox = PARTIAL.indexOf('data-wa-module-choice')
    expect(countedAt).toBeGreaterThan(-1)
    expect(countedAt).toBeLessThan(firstCheckbox)
  })

  it('counts only modules whose booking URL resolves to a real session', () => {
    // The checkout reads session_id/event_id off each selected module, so a
    // module whose booking link is an ordinary external page resolves nothing.
    // `_module-session-resolve.html` parses those ids and leaves
    // `module_session.bookable` false without a worker_event_id, which is what
    // keeps an unreadable URL out of the count AND out of the checkbox.
    expect(PARTIAL).toContain('{% include "./_module-session-resolve.html" %}')
    expect(PARTIAL).toContain(
      '{% if module_session.bookable and not module_session.off_sale and _module_display_price > 0 and _module_ticket_id %}'
    )
  })

  it('hides the selection checkboxes unless combined booking is available', () => {
    expect(gatedOn('data-wa-module-choice')).toBe(true)
  })

  it('hides the combined submit action unless combined booking is available', () => {
    expect(gatedOn('data-wa-module-submit')).toBe(true)
    expect(gatedOn('data-wa-course-module-selector')).toBe(true)
  })

  it('keeps the per-module booking link outside the gate', () => {
    // A half-configured course degrades to individual booking, not a dead end.
    expect(gatedOn('wa-course-modules__row-link" href=')).toBe(false)
  })

  it('renders the booking link on any row that is not selectable, priced or not', () => {
    // A module can resolve a perfectly good price and still not be selectable -
    // most often because the PARENT row is not Event Engine configured, which
    // turns off every checkbox on the page. Gating the link on `price > 0` being
    // FALSE left those rows showing a price with nothing to click, which is the
    // dead end the per-module link exists to prevent.
    //
    // The one exception is an off-sale row: sending a buyer to the booking page of
    // a session that was cancelled or has already run is a dead end, not the cure
    // for one. Its badge is what explains it.
    expect(PARTIAL).toContain('{% if not _is_selectable and not _module_item.off_sale %}')
    // ...and the enclosing branch must not exclude a priced row either.
    expect(PARTIAL).toContain(
      '{% if _module_item.price > 0 or (not _is_selectable and not _module_item.off_sale) %}'
    )
  })

  it('leaves no listed module without something to act on', () => {
    // Ref 46 round 2 item 1: a module was listed with no CTA of any kind, so it
    // "cannot be booked by any path". A row with no booking URL now gets the
    // training team, the same mailto: fallback CourseFilter gives a session with no
    // usable registration URL. Every listed module ends in a checkbox, a link or a
    // badge saying why not.
    expect(PARTIAL).toContain('{% if _module_item.booking_url %}')
    expect(PARTIAL).toContain('mailto:training@weldaustralia.com.au?subject=')
    expect(PARTIAL).toContain('Contact to book')
    // Outside the combined-booking gate, like the link it sits beside: a
    // half-configured course degrades to individual booking, not to a dead end.
    expect(gatedOn('Contact to book')).toBe(false)
  })

  it('ships no selector script on a page with no control for it to drive', () => {
    // Ref 46 on production: every course page carried the module-selection
    // JavaScript while none of them rendered a checkbox for it to find, because
    // no module had a booking URL to resolve. Inert rather than broken, but a
    // page holding half a feature is what made a data fault read as a deploy
    // that never happened.
    const conditions = enclosingConditions(PARTIAL, 'var HANDOFF_KEY')
    expect(conditions.some((c) => c.includes(GATE))).toBe(true)
    // The handoff half belongs to the complete-course CTA, which can render
    // when the selector does not - so the script ships for that case too.
    expect(conditions.some((c) => c.includes('_complete_course_available'))).toBe(true)
  })

  it('caps a selection at the worker limit of 12 modules', () => {
    // packages/worker/src/routes/reserve.ts throws too_many_selected_modules
    // above 12. The bar must not submit a request it knows would 400.
    expect(definitionOf('_module_selection_max')).toContain('12')
    expect(PARTIAL).toContain('data-max-modules="{{ _module_selection_max }}"')
    expect(PARTIAL).toContain("form.getAttribute('data-max-modules')")
  })
})

describe('course-modules pricing', () => {
  it('passes both the booking URL and the resolved tier into the session resolver', () => {
    // Drop either and every module silently loses its price and dates, which
    // takes the checkboxes with them - `selectable` needs a price above zero.
    expect(PARTIAL).toContain('{% set module_session_input.url =')
    expect(PARTIAL).toContain('{% set module_session_input.tier = _modules_tier %}')
    expect(PARTIAL).toContain('{% include "./_module-session-resolve.html" %}')
    expect(RESOLVER).toContain('module_session_input.url')
    expect(RESOLVER).toContain('module_session_input.tier')
  })

  it('requires a worker id, a price and a bookable ticket type to be selectable', () => {
    // Every condition is one the checkout requires of each selected module, so
    // a row failing any of them takes the whole basket to a dead end:
    // no worker id = nothing to reserve; no price = a guaranteed price_mismatch
    // 409 against the worker's STRICT per-module guard; no ticket type = the
    // tunnel's `isConfigured` fails and the payment step says "not configured".
    expect(PARTIAL).toContain(
      "'selectable':   module_session.bookable and not module_session.off_sale and _module_display_price > 0 and _module_ticket_id"
    )
    // The bookable COUNT (which decides whether checkboxes render at all) must
    // apply the same conditions, or the gate opens on rows the list will then
    // render as unselectable.
    expect(PARTIAL).toContain(
      '{% if module_session.bookable and not module_session.off_sale and _module_display_price > 0 and _module_ticket_id %}'
    )
  })

  it('refuses a module its own HubDB row has taken off sale', () => {
    // CLAUDE.md § 7.6: Cancelled and Sold Out are EDITORIAL decisions, and every
    // other surface that offers a session honours them - the corporate bulk
    // booking panel excludes both, the course cards badge them. The module
    // selector did not, so a cancelled module kept its tickbox and went into the
    // basket beside live ones, where the worker now rejects the whole booking.
    // Cancelled, Sold Out and Closed (Ref 74c), and labelled in the shared sentence.
    expect(RESOLVER).toContain('{% import "./session-status.html" as wa_status_ms %}')
    expect(RESOLVER).toContain('{% if wa_status_ms.is_off_sale(module_session.status) | trim %}')
    expect(RESOLVER).toContain(
      '{% set module_session.off_sale_label = wa_status_ms.status_label(_ms_status_key) | trim %}'
    )
    // The product-id join's "soonest sitting still on sale" pick honours it too, or a
    // Closed sitting could win over a live one of the same module.
    expect(RESOLVER).toContain('wa_status_ms.is_off_sale(_ms_candidate.status.name)')
    expect(RESOLVER).not.toContain("in ['Cancelled', 'Sold Out']")
    // Read off the resolved SOURCE, not merely off a row that was looked up: an
    // id present in both tables resolves to `events`, whose schema has no status
    // column at all, and the leftover course row says nothing about it.
    expect(RESOLVER).toContain("{% if module_session.source == 'courses' and _ms_course_row %}")
    // Said out loud on the row, and which kind: "Sold out" invites a waitlist
    // enquiry, "Cancelled" and a course that has already run do not.
    expect(PARTIAL).toContain('wa-course-modules__badge--off-sale')
    expect(PARTIAL).toContain('{% if _module_item.off_sale %}')
    expect(PARTIAL).toContain('{{ _module_item.off_sale_label | escape }}')
  })

  it('refuses a module whose session has already run', () => {
    // Ref 46 round 2 item 2: four IWI-S modules whose booking URLs all resolved to
    // one August session, still offered for sale in September. The date is the only
    // thing on the row that knew, and it applies to BOTH sources - `events` carries
    // no status column, but every row has a date.
    expect(RESOLVER).toContain(
      '{% set module_session.has_started = _ms_start_key and _ms_start_key < _ms_today_key %}'
    )
    expect(RESOLVER).toContain("{% set _ms_today_key = local_dt | datetimeformat('%Y%m%d') %}")
    // Folded into off_sale, so it reaches selectability and the "Book this module"
    // link through the one path the editorial closures already take.
    expect(RESOLVER).toContain('{% elif module_session.has_started %}')
    expect(RESOLVER).toContain("{% set module_session.off_sale_label = 'Registrations closed' %}")
  })

  it('picks the visitor-applicable ticket the way the checkout does', () => {
    // ticketTypeForSession(): a member falls back to the public ticket, a guest
    // never falls back to a member-only one. A guest facing a member-only row
    // resolves to '' and the row stops being selectable - the audit's
    // `guest_ticket_missing` caught before it reaches a payment step.
    expect(RESOLVER).toContain('member_ticket_type_id')
    expect(RESOLVER).toContain('non_member_ticket_type_id')
    expect(RESOLVER).toContain(
      '{% set module_session.member_ticket_type_id = _ms_ticket_ns.member_id | default(_ms_ticket_ns.public_id, true) %}'
    )
    expect(RESOLVER).toContain(
      '{% set module_session.non_member_ticket_type_id = _ms_ticket_ns.public_id %}'
    )
    expect(PARTIAL).toContain(
      '{% set _module_ticket_id = module_session.non_member_ticket_type_id | string | trim %}'
    )
  })

  it('resolves the member tier through the shared company-aware resolver', () => {
    // Defect 213: a per-surface reimplementation is what quoted the same
    // corporate employee different numbers on different pages.
    expect(PARTIAL).toContain('{% include "./_resource-member-resolve.html" %}')
    expect(PARTIAL).toContain('{% set _modules_is_member = resource_member.is_active %}')
    expect(PARTIAL).toContain('{% import "./_member-pricing.html" as wa_price %}')
  })

  it('reads the session behind a module from courses before events', () => {
    // Mirrors the checkout tunnel's own precedence, so the page and the
    // payment step cannot resolve the same module to different rows.
    const coursesAt = RESOLVER.indexOf("hubdb_table_row('courses', module_session.id)")
    const eventsAt = RESOLVER.indexOf("hubdb_table_row('events', module_session.id)")
    expect(coursesAt).toBeGreaterThan(-1)
    expect(eventsAt).toBeGreaterThan(coursesAt)
  })

  it('accepts both session_id and event_id in a module booking URL', () => {
    // Production module rows carry event_id; the courses table's own rows carry
    // session_id. The selector JS used to parse both, and the HubL now does.
    expect(RESOLVER).toContain("_ms_key == 'session_id'")
    expect(RESOLVER).toContain("_ms_key == 'event_id'")
  })

  it('shows the member rate to visitors who are not members', () => {
    // Ref 32: gating member pricing on membership hid the value proposition
    // from exactly the audience it was meant to convert.
    expect(PARTIAL).toContain('{% set _show_member_teaser = (not _modules_is_member)')
    expect(PARTIAL).toContain('wa-course-modules__price-member-teaser')
  })
})

describe('course-modules checkout pricing handoff', () => {
  const stringLiteral = (source: string, re: RegExp): string => {
    const m = source.match(re)
    expect(m, `no match for ${re}`).toBeTruthy()
    return (m as RegExpMatchArray)[1]
  }

  it('uses the same sessionStorage key as the checkout tunnel reads', () => {
    // The HubL cannot import the TS module, so the key is duplicated. If these
    // drift, the handoff is written somewhere the checkout never looks and a
    // member is silently quoted the public price one page later.
    const util = stringLiteral(HANDOFF_UTIL, /CHECKOUT_PRICING_HANDOFF_KEY = '([^']+)'/)
    const hubl = stringLiteral(PARTIAL, /var HANDOFF_KEY = '([^']+)';/)
    expect(hubl).toBe(util)
  })

  it('uses the same TTL as the checkout tunnel expects', () => {
    const util = stringLiteral(HANDOFF_UTIL, /HANDOFF_TTL_MS = ([^\n]+)/).replace(/\s+$/, '')
    const hubl = stringLiteral(PARTIAL, /var HANDOFF_TTL_MS = ([^;]+);/)
    expect(hubl).toBe(util)
  })

  it('writes the payload shape readCheckoutPricingHandoff validates', () => {
    for (const field of ['sessionId', 'isMember', 'memberTier', 'expiresAt']) {
      expect(HANDOFF_UTIL).toContain(field)
      expect(PARTIAL).toContain(field + ':')
    }
  })

  it('saves the handoff on BOTH routes into the checkout', () => {
    // The module selection (a JS navigation) and the complete-course CTA (a
    // plain link). Either one losing it quotes a member the public price.
    expect(PARTIAL).toContain('saveHandoff(form);')
    expect(PARTIAL).toContain('data-wa-checkout-handoff')
    expect(PARTIAL).toContain("document.querySelectorAll('[data-wa-checkout-handoff]').forEach(")
  })

  it('keys the handoff on the PARENT row, which is the id the checkout resolves', () => {
    // readCheckoutPricingHandoff(session.id) compares against the checkout's own
    // session - and a module selection reserves against the parent row.
    expect(PARTIAL).toContain(
      '{% set _modules_handoff_session_id = dynamic_page_hubdb_row.hs_id | string %}'
    )
  })
})

describe('course-modules row layout', () => {
  it('makes the whole row the control rather than a bare checkbox', () => {
    // The 44x44 touch target in CLAUDE.md § 5.4 - a 22px checkbox alone is
    // half the mandated size.
    expect(PARTIAL).toContain('<label class="wa-course-modules__row">')
    expect(PARTIAL).toContain('min-height: var(--wa-touch-min, 44px);')
  })

  it('aligns the checkbox with a grid column, not with space-between', () => {
    // The previous layout flexed three variable-width children with
    // `justify-content: space-between`, so each tickbox landed wherever its
    // module name happened to end.
    expect(PARTIAL).toContain(
      'grid-template-columns: var(--wa-touch-min, 44px) minmax(0, 1fr) auto;'
    )
    expect(PARTIAL).not.toContain('.wa-course-modules__item-header')
  })
})

describe('course-modules product-id resolution', () => {
  it('resolves a module by its HubSpot product id before its booking URL', () => {
    // events-engine migration 0031 stores the module's product id on the child
    // event so a course page can find the session "without inferring it from a
    // title". The HubDB-to-HubDB half of that join lives here.
    expect(RESOLVER).toContain("hubdb_table_rows('courses', 'module_product_id__eq=' ~ _ms_product_id")
    // Only a module session row answers (Ref 46): a whole-course row carrying the
    // same product id would sell the course under the module's name.
    expect(RESOLVER).toContain('{% if _ms_candidate.is_module %}')
    // The URL is reached only when nothing claims the product id.
    expect(RESOLVER).toContain('{% if not module_session.id and _ms_url %}')
  })

  it('passes the column production actually fills', () => {
    // `product_id` is empty on all 44 live rows; `hubspot_product_id` is the one
    // with values in it. Reading the empty one resolves nothing.
    expect(PARTIAL).toContain('module_session_input.product_id = _module.hubspot_product_id')
  })

  it('prefers a sitting still on sale, and keeps one that is not', () => {
    // A module taught twice matches two rows. The soonest live one wins; when
    // none is live the soonest overall is kept so the row still renders a badge
    // rather than vanishing off the page.
    expect(RESOLVER).toContain('_ms_pick.live')
    expect(RESOLVER).toContain('_ms_pick.any')
    expect(RESOLVER).toContain("{% set _ms_matched = _ms_pick.live | default(_ms_pick.any, true) %}")
  })

  it('keeps the checkbox value a HubDB row id', () => {
    // /checkout/ resolves module_session_ids with hubdb_table_row('courses', id),
    // so a Worker event id there would resolve to nothing.
    expect(RESOLVER).toContain("{% set module_session.id = _ms_matched.hs_id | string %}")
  })
})

describe('module rows are not courses', () => {
  const read = (path: string): string =>
    readFileSync(resolve(__dirname, '../../', path), 'utf8')

  const SWEEPS: Array<[string, string]> = [
    ['theme/modules/featured-courses.module/module.html', 'all_courses'],
    ['theme/modules/featured-courses.module/module.html', 'all_upcoming'],
    ['theme/modules/featured-courses.module/module.html', 'all_manual'],
    ['theme/modules/featured-courses.module/module.html', 'all_cat'],
    ['theme/templates/partials/training-course-cards.html', 'all_course_rows'],
    ['theme/modules/course-filter.module/module.html', 'course_rows']
  ]

  it.each(SWEEPS)('%s excludes is_module rows from %s', (path, variable) => {
    // A module session row exists so the selector can price it and so the Worker
    // reads the same row. Left in a course sweep it becomes a card of its own,
    // or - carrying its parent's course_id - a bookable "session" of the course.
    const source = read(path)
    // Other conditions may follow is_module (Ref 120 adds has_ended); the module test must lead.
    expect(source).toContain(`{% for _r in ${variable} %}{% if not _r.is_module `)
  })

  it('keeps a module row out of the "From" price minimum', () => {
    // A module is cheaper than the course containing it, so left in the minimum
    // it drags every headline price down to the cheapest module.
    const priceable = read('theme/templates/partials/_session-priceable.html')
    expect(priceable).toContain('{%- if not row.is_module and not _has_started')
  })
})
