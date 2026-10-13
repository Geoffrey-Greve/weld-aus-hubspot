/**
 * Defect 213 drift guard, and the tier-level contract with the Worker.
 *
 * Member pricing is resolved THREE times for the same buyer: in HubL
 * (theme/templates/partials/_member-pricing.html, for server-rendered cards), in
 * TypeScript (memberPricing.ts, for the React islands), and again in the Worker at
 * reserve (toCanonicalMemberLevel in events-engine). All three must agree, because a
 * disagreement reaches the buyer as "the course price changed before checkout" (the
 * Worker resolving higher than the page quoted) or as a silent undercharge (resolving
 * lower, which reserve honours and logs).
 *
 * This file used to assert only that the two local copies shared a VOCABULARY: that
 * every keyword the TS matcher knows appears somewhere in the HubL source. That passes
 * while the branches are in a different order, while a filter truncates differently,
 * and it said nothing at all about the Worker. It passed throughout the period when
 * a tier of "Member" resolved to price_individual here and price_member there.
 *
 * So the HubL macro is now PARSED and EVALUATED (see `evaluateHubLTierKey`) and both
 * local implementations are run over config/member-tier-levels.json, the table the
 * Worker's own test asserts against too. Agreement is checked, not inferred.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normaliseMemberPriceTier, resolveMemberPrice, tierDiscountPrice } from './memberPricing'

const HUBL = readFileSync(
  resolve(__dirname, '../../../theme/templates/partials/_member-pricing.html'),
  'utf8'
)

interface TierContract {
  levels: string[]
  labels: Array<{ label: string; level: string; note?: string }>
}

/**
 * The shared contract. events-engine holds a byte-identical copy and asserts its own
 * canonicaliser against it, so the two repos agree by table rather than by comment.
 */
const CONTRACT: TierContract = JSON.parse(
  readFileSync(resolve(__dirname, '../../../config/member-tier-levels.json'), 'utf8')
)

/**
 * Extract the branch chain out of the HubL `member_tier_key` macro and run it.
 *
 * The macro is a flat if/elif/else over `'<keyword>' in _k` tests, which is
 * mechanically parseable — and parsing it is the only way to assert the thing that
 * actually matters: BRANCH ORDER. "Individual Member" contains both 'individual' and
 * 'member', so which branch wins is the whole question, and no substring assertion
 * over the source can answer it.
 */
function evaluateHubLTierKey(raw: string): string {
  const macro = HUBL.match(/{% macro member_tier_key\(raw\) %}([\s\S]*?){% endmacro %}/)
  const body = macro?.[1]
  if (!body) throw new Error('member_tier_key macro not found in _member-pricing.html')

  // Mirror the macro's own normalisation line.
  const k = (raw ?? '').toString().toLowerCase().trim().replace(/_/g, ' ').replace(/-/g, ' ')

  // {% if not _k %}member  → the empty-tier branch.
  if (!k) {
    const empty = body.match(/{% if not _k %}([a-z]+)/)?.[1]
    if (!empty) throw new Error('no `{% if not _k %}` branch')
    return empty
  }

  // {% elif 'a' in _k or 'b' in _k %}result  → ordered, and order is the point.
  const branchPattern = /{% elif ((?:'[^']+' in _k(?: or )?)+) %}([a-z]+)/g
  for (const branch of body.matchAll(branchPattern)) {
    const keywords = [...(branch[1] ?? '').matchAll(/'([^']+)' in _k/g)].map((m) => m[1] ?? '')
    const result = branch[2]
    if (result && keywords.some((keyword) => keyword && k.includes(keyword))) return result
  }

  const fallthrough = body.match(/{% else %}([a-z]+){% endif %}/)?.[1]
  if (!fallthrough) throw new Error('no `{% else %}` fallthrough branch')
  return fallthrough
}

describe('the tier-level contract is honoured by both local implementations', () => {
  it('parses the HubL macro into runnable branches', () => {
    // If the macro is rewritten into a shape the parser cannot read, every case below
    // would pass vacuously. Prove the evaluator works before trusting it.
    expect(evaluateHubLTierKey('Corporate Gold')).toBe('gold')
    expect(evaluateHubLTierKey('')).toBe('member')
    expect(evaluateHubLTierKey('Platinum')).toBe('member')
  })

  it.each(CONTRACT.labels.map((entry) => [entry.label || '(empty)', entry.label, entry.level]))(
    'TypeScript maps %s to %s',
    (_display, label, level) => {
      expect(normaliseMemberPriceTier(label)).toBe(level)
    }
  )

  it.each(CONTRACT.labels.map((entry) => [entry.label || '(empty)', entry.label, entry.level]))(
    'HubL maps %s to %s',
    (_display, label, level) => {
      expect(evaluateHubLTierKey(label)).toBe(level)
    }
  )

  it('agrees with TypeScript on every label, which is the property that matters', () => {
    for (const { label } of CONTRACT.labels) {
      expect(evaluateHubLTierKey(label), `label: ${JSON.stringify(label)}`).toBe(
        normaliseMemberPriceTier(label)
      )
    }
  })

  it('sends a bare "member" label to the generic column, not to individual', () => {
    // The specific drift with the Worker. Kept as its own case so a future edit to the
    // contract table cannot quietly drop it.
    expect(normaliseMemberPriceTier('Member')).toBe('member')
    expect(normaliseMemberPriceTier('Corporate Member')).toBe('member')
    expect(evaluateHubLTierKey('Member')).toBe('member')
    expect(evaluateHubLTierKey('Corporate Member')).toBe('member')
    // ...while a label naming a real level still reaches it, order being the reason.
    expect(normaliseMemberPriceTier('Individual Member')).toBe('individual')
    expect(evaluateHubLTierKey('Individual Member')).toBe('individual')
  })

  it('only knows the levels the contract declares', () => {
    for (const { label } of CONTRACT.labels) {
      expect(CONTRACT.levels).toContain(normaliseMemberPriceTier(label))
    }
  })
})

const TIER_COLUMNS = [
  'price_gold_aud_ex_gst',
  'price_silver_aud_ex_gst',
  'price_bronze_aud_ex_gst',
  'price_student_aud_ex_gst',
  'price_individual',
  'price_member',
  'price_non_member',
]

describe('HubL member pricing mirrors memberPricing.ts', () => {
  it.each(TIER_COLUMNS)('HubL reads the %s column', (column) => {
    expect(HUBL).toContain(`row.${column}`)
  })

  it('resolves an empty tier to the generic member rate on both sides', () => {
    // The specific regression: '' must NOT resolve to `individual`. The HubL macros
    // encode this as the final {% else %} branch reading price_member.
    expect(normaliseMemberPriceTier('')).toBe('member')
    expect(HUBL).toContain('{% else %}{% set _exact = row.price_member')
  })

  it('keeps the price_member → price_individual → price_non_member fallback chain', () => {
    // The generic member and public branches now try the `events` column names too
    // (member_price / non_member_price), so the assertion names the whole expression
    // rather than a prefix that would also pass if the fallback were dropped.
    expect(HUBL).toContain('row.price_member|default(row.member_price, true)|default(0, true)|float > 0')
    expect(HUBL).toContain('row.price_individual|default(0, true)|float > 0')
    expect(HUBL).toContain(
      'row.price_non_member|default(row.non_member_price, true)|default(0, true)|float'
    )
  })

  // ---- QA ref 73 / events-engine 0044: a tier stated as a percentage ----

  it.each([
    ['gold', 'gold_discount_'],
    ['silver', 'silver_discount_'],
    ['bronze', 'bronze_discount_'],
  ])('HubL reads the %s discount column', (_tier, column) => {
    expect(HUBL).toContain(`row.${column}`)
  })

  it('bounds a percentage to (0, 100) on both sides', () => {
    // 0 is "nobody entered one", the state of most rows; 100 or more gives a seat away.
    expect(HUBL).toContain('_pct > 0 and _pct < 100 and _public > 0')
    expect(tierDiscountPrice({ price_non_member: 500, discount_gold: 0 }, 'gold')).toBe(0)
    expect(tierDiscountPrice({ price_non_member: 500, discount_gold: 100 }, 'gold')).toBe(0)
    expect(tierDiscountPrice({ price_non_member: 500, discount_gold: 120 }, 'gold')).toBe(0)
    expect(tierDiscountPrice({ price_non_member: 0, discount_gold: 20 }, 'gold')).toBe(0)
  })

  it('computes the discounted figure the same way in HubL as in TypeScript', () => {
    // The arithmetic is the half that can silently differ - a rounding step on one side
    // and not the other is cents on every event booking - so the HubL expression is
    // lifted out of the shipped macro and run, rather than matched as a string.
    const expr = HUBL.match(/\{\{ \(\(_public \* \(100 - _pct\) \/ 100\) \* 100\)\|round \/ 100 \}\}/)
    expect(expr, 'the HubL discount expression changed shape').not.toBeNull()
    const hubl = (pub: number, pct: number) => Math.round(((pub * (100 - pct)) / 100) * 100) / 100

    for (const [pub, pct] of [
      [500, 20],
      [500, 5],
      [2555, 12.5],
      [1234.56, 7],
      [99.99, 33],
    ] as Array<[number, number]>) {
      expect(tierDiscountPrice({ price_non_member: pub, [`discount_gold`]: pct }, 'gold')).toBe(
        hubl(pub, pct)
      )
    }
  })

  it('puts the tier discount ABOVE the generic member price, as the Worker does', () => {
    // A 5% bronze discount on a $500 event is $475, DEARER than a $450 generic member
    // rate. The buyer's tier is the more specific statement about them and it is what
    // the page quotes, so the invoice has to agree - the Worker's chain is the level's
    // absolute column, then the level's discount, then member/individual/public.
    const row = { price_non_member: 500, price_member: 450, discount_bronze: 5 }
    expect(resolveMemberPrice(row, 'Corporate Bronze').price).toBe(475)
    // ...and the absolute column, where a tenant states one, still wins over both.
    expect(resolveMemberPrice({ ...row, price_bronze: 399 }, 'Corporate Bronze').price).toBe(399)
    // A tier with no discount and no column of its own still falls through to member.
    expect(resolveMemberPrice(row, 'Corporate Silver').price).toBe(450)
    // The HubL macro orders its branches the same way: exact, then percentage, then the
    // generic chain.
    const memberMacro = HUBL.slice(HUBL.indexOf('{% macro member_price('))
    expect(memberMacro.indexOf('{% if _exact > 0 %}')).toBeLessThan(
      memberMacro.indexOf('_pct > 0 and _pct < 100')
    )
    expect(memberMacro.indexOf('_pct > 0 and _pct < 100')).toBeLessThan(
      memberMacro.indexOf('row.price_member|default(row.member_price, true)|default(0, true)|float > 0')
    )
  })

  it('leaves a course row untouched — it carries no discount columns', () => {
    const course = {
      price_non_member: 2555,
      price_member: 2280,
      price_individual: 2300,
      price_gold: 2170,
    }
    expect(resolveMemberPrice(course, 'Corporate Gold').price).toBe(2170)
    expect(resolveMemberPrice(course, '').price).toBe(2280)
    expect(resolveMemberPrice(course, 'Apprentice').price).toBe(2280)
  })

  it('does not call one macro from another (HubL import namespaces are restricted)', () => {
    const macroBodies = HUBL.split('{% macro ').slice(1)
    expect(macroBodies.length).toBeGreaterThan(0)
    for (const body of macroBodies) {
      const name = body.slice(0, body.indexOf('('))
      for (const other of ['member_tier_key', 'tier_price', 'member_price', 'non_member_price']) {
        if (other === name) continue
        // \b so `member_price` does not match inside `non_member_price`.
        expect(body).not.toMatch(new RegExp(`\\b${other}\\(`))
      }
    }
  })
})

/**
 * Defect 213, entitlement half.
 *
 * Pricing was unified by _member-pricing.html, but every surface still decided for
 * itself what counted as a real membership. HubSpot stores "no membership" as a
 * dropdown LABEL, not an empty string, so a bare truthiness test read
 * "Not Applicable" as a real individual membership and refused to fall back to the
 * employer's corporate tier - the same Gold-company employee was quoted price_gold
 * on /courses/ and price_member on the timetable, featured lists and the portal.
 *
 * _member-tier.html is now the single definition. These tests keep it that way.
 */
const TIER_HUBL = readFileSync(
  resolve(__dirname, '../../../theme/templates/partials/_member-tier.html'),
  'utf8'
)

// The CRM values that mean "this person has no membership of their own".
const SENTINELS = ['not_applicable', 'non_member', 'nonmember', 'never_member', 'none', 'n/a']

// Every surface that resolves a visitor's entitlement before pricing them.
const TIER_CONSUMERS = [
  'theme/modules/course-filter.module/module.html',
  'theme/modules/course-timetable-filter.module/module.html',
  'theme/modules/featured-courses.module/module.html',
  'theme/modules/courses-upcoming-sessions.module/module.html',
  'theme/modules/pricing-table.module/module.html',
  'theme/modules/member-command-centre.module/module.html',
  'theme/modules/checkout-tunnel.module/module.html',
  'theme/modules/resource-library.module/module.html',
]

function readTheme(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../../', relativePath), 'utf8')
}

describe('HubL membership sentinels have one definition', () => {
  it.each(SENTINELS)('_member-tier.html treats "%s" as no membership', (sentinel) => {
    expect(TIER_HUBL).toContain(`'${sentinel}'`)
  })

  it('exposes the predicate, scrub, and company-metal preference', () => {
    expect(TIER_HUBL).toContain('{% macro is_real_tier(raw)')
    expect(TIER_HUBL).toContain('{% macro scrub(raw)')
    expect(TIER_HUBL).toContain('{% macro prefer_pricing_tier(contact_tier, company_tier)')
  })

  it('does not call one macro from another (HubL import namespaces are restricted)', () => {
    const macroBodies = TIER_HUBL.split('{% macro ').slice(1)
    expect(macroBodies.length).toBe(3)
    for (const body of macroBodies) {
      const name = body.slice(0, body.indexOf('('))
      for (const other of ['is_real_tier', 'scrub', 'prefer_pricing_tier']) {
        if (other === name) continue
        expect(body).not.toMatch(new RegExp(`\\b${other}\\(`))
      }
    }
  })

  it.each(TIER_CONSUMERS)('%s imports the shared partial', (path) => {
    expect(readTheme(path)).toContain('_member-tier.html" as wa_tier')
  })

  it.each(TIER_CONSUMERS)('%s does not re-declare the sentinel list', (path) => {
    // The exact regression: a local copy of the list is how the four surfaces
    // drifted apart in the first place.
    expect(readTheme(path)).not.toContain("'not_applicable'")
  })

  it('training-course-cards keeps a single membership test', () => {
    // It computed the price from a company-aware tier, then suppressed the render
    // with a second contact-only boolean, so corporate employees had a member
    // price calculated and thrown away.
    const cards = readTheme('theme/templates/partials/training-course-cards.html')
    expect(cards).not.toContain('{% set visitor_is_member =')
    expect(cards).toContain('{% if show_member_price %}')
  })
})

// Surfaces that must honour HubDB portal_test_profiles for plus-address QA
// accounts - otherwise /portal quotes Silver while /checkout quotes full price.
const QA_PERSONA_CONSUMERS = [
  'theme/modules/checkout-tunnel.module/module.html',
  'theme/modules/course-filter.module/module.html',
  'theme/modules/course-timetable-filter.module/module.html',
  'theme/modules/featured-courses.module/module.html',
  'theme/modules/courses-upcoming-sessions.module/module.html',
  'theme/modules/pricing-table.module/module.html',
]

describe('HubL QA personas reach checkout and course pricing', () => {
  it('keeps a shared resolver partial', () => {
    const partial = readTheme('theme/templates/partials/_qa-persona-resolve.html')
    expect(partial).toContain("hubdb_table_rows('portal_test_profiles'")
    expect(partial).toContain('qa_persona.entitled')
    expect(partial).toContain('qa_persona.pricing_tier')
  })

  it.each(QA_PERSONA_CONSUMERS)('%s includes the shared QA persona resolver', (path) => {
    expect(readTheme(path)).toContain("_qa-persona-resolve.html'")
  })

  it.each(QA_PERSONA_CONSUMERS)('%s prefers company metal via prefer_pricing_tier', (path) => {
    // Course surfaces and checkout must prefer Gold/Silver/Bronze over a
    // weaker contact Individual tier - same rule as the portal (defect 213).
    expect(readTheme(path)).toContain('prefer_pricing_tier')
  })
})

describe('Resources membership resolver', () => {
  it('keeps listing and detail on the shared company-aware resolver', () => {
    const resolver = readTheme('theme/templates/partials/_resource-member-resolve.html')

    expect(readTheme('theme/modules/resource-library.module/module.html'))
      .toContain('_resource-member-resolve.html')
    expect(readTheme('theme/templates/pages/resource-detail.html'))
      .toContain('_resource-member-resolve.html')
    expect(resolver).toContain("crm_object('company'")
    expect(resolver).toContain('wa_company_membership_tier')
    expect(resolver).toContain('prefer_pricing_tier')
    expect(resolver).toContain("_qa-persona-resolve.html")
  })
})

describe('Course seat availability guardrails', () => {
  it('preserves blank HubDB seats as unknown, and never folds a seat count into the status', () => {
    // The two values mean different things and bind differently: the status column is a
    // decision staff made and applyAvailability treats it as final, while a seat count is
    // hand-typed and a live read overrides it. Folding them together in HubL would make a
    // 0 written by an import (into a column that is blank on most rows) permanently
    // close a session with nothing able to re-open it.
    const courseFilter = readTheme('theme/modules/course-filter.module/module.html')
    const checkoutTunnel = readTheme('theme/modules/checkout-tunnel.module/module.html')

    const sources = [
      { source: courseFilter, rawField: "row.seats_remaining | default('', false)" },
      { source: checkoutTunnel, rawField: "session_row.seats_remaining | default('', false)" },
    ]

    for (const { source, rawField } of sources) {
      expect(source).toContain(rawField)
      expect(source).toContain('has_seats_remaining')
      expect(source).toContain('seats_remaining_is_set')
      expect(source).not.toContain("status_value = 'sold_out'")
    }
  })

  it('hands the course card what it needs to read live seats, not just the HubDB count', () => {
    // seats_remaining is hand-typed, so it is the FALLBACK. The card can only correct it
    // if HubL forwards the worker id and the worker connection alongside it: drop either
    // and every course session silently goes back to advertising a stale number.
    const courseFilter = readTheme('theme/modules/course-filter.module/module.html')

    expect(courseFilter).toContain("'worker_event_id'")
    expect(courseFilter).toContain("'worker_base_url'")
    expect(courseFilter).toContain('theme.integrations.event_engine_worker_base_url')
  })
})

/**
 * QA 109 / 117: "The course price changed before checkout."
 *
 * Membership is decided twice for the same buyer: here, to quote them a price, and again
 * in the Event Engine worker at reserve, to charge them one. The worker refuses to
 * invoice more than the page displayed, so any signal this page counts as membership and
 * the worker does not turns into a REFUSED booking for a real customer.
 *
 * The contract (events-engine CLAUDE.md, "the worker's membership gate must stay in
 * parity with the CMS gate") is three kinds of signal: an active status on the contact or
 * the company, an active Find a Member row, a real tier on either record. The checkout gate
 * had grown five more: a CAMS person id, a membership expiry date, a merely-present
 * company status. None of them is membership, and none of them has ever been counted by
 * the worker or the course page.
 */
describe('Checkout membership gate matches the worker and the course page', () => {
  const CHECKOUT = readTheme('theme/modules/checkout-tunnel.module/module.html')
  const COURSE_FILTER = readTheme('theme/modules/course-filter.module/module.html')

  function gateExpression(source: string, variable: string): string {
    const marker = `{% set ${variable} = `
    const start = source.indexOf(marker)
    expect(start, `${variable} not found`).toBeGreaterThan(-1)
    return source.slice(start, source.indexOf('%}', start))
  }

  const signalGate = () => gateExpression(CHECKOUT, 'checkout_has_membership_signal')

  it.each([
    ['checkout_member_status_is_active'],
    ['checkout_member_company_status_is_active'],
    ['checkout_member_match_ns.active'],
    ['checkout_member_tier_is_member'],
    ['checkout_member_company_tier_is_member'],
  ])('counts %s', (term) => {
    expect(signalGate()).toContain(term)
  })

  it.each([
    ['checkout_member_id_signal', 'a CAMS person id is a migration artefact, not membership'],
    ['checkout_member_expiry', 'an expiry date is what a LAPSED member has'],
    ['checkout_member_company_ns.expiry', 'same, on the employer'],
    ['checkout_member_company_ns.member_id', 'same, on the employer'],
    [
      'checkout_member_company_status_for_pricing',
      'a company status that is merely present includes "Lapsed"',
    ],
  ])('does not count %s (%s)', (term) => {
    expect(signalGate()).not.toContain(term)
  })

  it('treats a lapsed status on either record as a hard no, as the worker does', () => {
    const gate = gateExpression(CHECKOUT, 'checkout_member_is_member')
    expect(gate).toContain('not checkout_member_status_is_inactive')
    expect(gate).toContain('not checkout_member_company_status_is_inactive')
  })

  it('uses the same active-status vocabulary as the course page', () => {
    const active = "['current', 'active', 'grace', 'grace_period', 'honorary', 'honourary']"
    const inactive = "['lapsed', 'expired', 'inactive', 'cancelled', 'canceled']"
    for (const source of [CHECKOUT, COURSE_FILTER]) {
      expect(source).toContain(active)
      expect(source).toContain(inactive)
    }
  })

  it('forwards the employer it priced from so the worker can re-validate it', () => {
    // The worker resolves membership from the buyer's EMAIL. An employee carrying no
    // membership of their own resolves as a non-member that way, is priced at the public
    // rate, and the reserve guard refuses the member price this page quoted. The id lets
    // the worker read the same company; it never trusts the number itself.
    expect(CHECKOUT).toContain("'member_company_id'")
    expect(readFileSync(resolve(__dirname, '../../modules/checkout-tunnel/CheckoutTunnel.tsx'), 'utf8'))
      .toContain('member_company_id')
  })
})

/**
 * QA ref 73 / events-engine migration 0044: the `events` HubDB row is a pricing source.
 *
 * Weld type `member_price`, `non_member_price` and `gold_/silver_/bronze_discount_` into
 * their events rows and, until 0044, nothing on either side read one: the Worker priced
 * every event from `pricing_rules` and the page from `ticket_types_json`. The Worker reads
 * the row now, so these two surfaces have to quote from the same place - and the checkout
 * tunnel is the one that sends `expectedUnitCents`, so on that page a disagreement is not
 * a wrong number, it is a refused booking.
 */
describe('the events HubDB row prices the page, as it now prices the Worker', () => {
  const CHECKOUT = readFileSync(
    resolve(__dirname, '../../../theme/modules/checkout-tunnel.module/module.html'),
    'utf8'
  )
  const WIDGET = readFileSync(
    resolve(__dirname, '../../../theme/modules/event-registration.module/module.html'),
    'utf8'
  )

  it('forwards each tier percentage onto the checkout island', () => {
    // Without these the island resolves every member - Gold, Silver, Bronze - to the one
    // generic `member_price`, which is ref 73 exactly.
    for (const column of ['gold_discount_', 'silver_discount_', 'bronze_discount_']) {
      expect(CHECKOUT).toContain(`event_row.${column}`)
    }
    for (const key of ['discount_gold', 'discount_silver', 'discount_bronze']) {
      expect(CHECKOUT).toContain(`'${key}':`)
    }
  })

  it('forwards them for a selected MODULE that resolves to an events row too', () => {
    for (const column of ['gold_discount_', 'silver_discount_', 'bronze_discount_']) {
      expect(CHECKOUT).toContain(`selected_module_event_row.${column}`)
    }
  })

  it('lets the row columns outrank ticket_types_json, not the other way round', () => {
    // The inversion had to land WITH the Worker, not after it. The Worker reads these
    // columns and ignores its own `ticket_types.price_cents` copy, so a page still
    // quoting the JSON puts the quote and the invoice back on two separately maintained
    // numbers - which the reserve guard reports as "the course price changed before
    // checkout" over a change nobody made.
    for (const prefix of ['event', 'selected_module_event']) {
      const raw = `${prefix}_member_price_raw`
      const assign = `{% set ${prefix}_ticket_ns.member_price = ${raw} | float %}`
      const assignIndex = CHECKOUT.indexOf(assign)
      expect(assignIndex, `${prefix}: the row-column assignment is gone`).toBeGreaterThan(-1)
      // It must NOT sit inside the "only if the JSON said nothing" branch any more.
      const guard = `{% if not ${prefix}_ticket_ns.has_member_price %}`
      expect(assignIndex).toBeLessThan(CHECKOUT.indexOf(guard))
    }
  })

  it('has the event widget read the row before the JSON as well', () => {
    // It sends no `expectedUnitCents`, so nothing would refuse a disagreement here: the
    // buyer would simply be billed a number they were never shown.
    expect(WIDGET).toContain('wa_evt_price.member_price(event, \'\')')
    expect(WIDGET).toContain('wa_evt_price.non_member_price(event)')
    expect(WIDGET).toContain('t_row_price if t_row_price > 0')
  })

  it('keeps the blank-column fallback on every surface', () => {
    // An unset column resolves to nothing here and to null in the Worker, and both sides
    // then keep the ticket type's own price. That is what makes this a no-op for every
    // event whose named columns are empty.
    expect(WIDGET).toContain("t.price_dollars | default(0, true)")
    expect(CHECKOUT).toContain('event_price_from_raw')
  })
})
