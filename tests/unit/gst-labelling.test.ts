/**
 * Every surface that prints a price says it is ex GST.
 *
 * HubDB course columns and Event Engine ticket types are both entered
 * TAX-EXCLUSIVE (weld CLAUDE.md § 6.7; events-engine CLAUDE.md, "Stored prices
 * are TAX-EXCLUSIVE") and HubSpot adds the portal's tax rate on the invoice. A
 * price shown without that qualifier is a number the buyer is later charged 10%
 * more than, which is QA ref 36: "checkout wording needs to be consistent
 * (ex GST) across all modules".
 *
 * The checkout tunnel was fixed first. This is the sweep that found the one
 * remaining surface with no GST wording anywhere in it - the events
 * registration widget on event detail pages, which printed a bare figure per
 * ticket type.
 */
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')

/** A file that RENDERS a price, as opposed to one that merely computes one. */
const RENDERS_PRICE = [
  // HubL: {{ x | format_currency('AUD') }}
  /\{\{[^}]*format_currency\(\s*['"]AUD['"]\s*\)[^}]*\}\}/,
  // React: {formatCurrencyDollars(x)}
  /\{\s*formatCurrencyDollars\(/,
  // React: {formatMoney(x)}, the member portal's own formatter (QA ref 36, round
  // two: Nick found its course prices unlabelled because this sweep never saw it).
  /\{\s*formatMoney\(/,
]

function sourceFiles(): string[] {
  return globSync('**/*.{html,tsx}', {
    cwd: ROOT,
    exclude: (p) => p.includes('node_modules') || p.includes('/dist/') || p.includes('.test.'),
  }).filter((p) => p.startsWith('theme/') || p.startsWith('src/'))
}

describe('price rendering', () => {
  const rendering = sourceFiles()
    .map((path) => ({ path, src: readFileSync(resolve(ROOT, path), 'utf8') }))
    .filter(({ src }) => RENDERS_PRICE.some((re) => re.test(src)))

  it('finds the price-rendering surfaces', () => {
    expect(rendering.length).toBeGreaterThan(5)
    expect(rendering.map((f) => f.path)).toContain(
      'theme/modules/event-registration.module/module.html'
    )
    expect(rendering.map((f) => f.path)).toContain(
      'src/modules/member-command-centre/MemberCommandCentre.tsx'
    )
  })

  it('every one of them states the tax basis', () => {
    const silent = rendering.filter(({ src }) => !/gst/i.test(src)).map((f) => f.path)
    expect(silent).toEqual([])
  })
})

describe('the events registration widget', () => {
  const src = readFileSync(
    resolve(ROOT, 'theme/modules/event-registration.module/module.html'),
    'utf8'
  )

  it('labels a paid ticket ex GST', () => {
    expect(src).toMatch(/ex GST/)
  })

  it('leaves a free ticket unlabelled — there is no tax on nothing', () => {
    // The label sits inside the `price_dollars > 0` branch, ahead of the {% else %}.
    const label = src.indexOf('ex GST</span>')
    const free = src.indexOf('{% else %}Free{% endif %}')
    expect(label).toBeGreaterThan(-1)
    expect(free).toBeGreaterThan(label)
  })
})

/**
 * QA ref 36, round two (Nick, production). Membership fees are typed in as text
 * rather than formatted from a number, so the sweep above cannot see them. They
 * are ex GST (the retired fee is $72.73, which is $80 less its tenth; the payment
 * step adds the tax), and the card and the join page both say so.
 */
describe('membership fees', () => {
  const cards = readFileSync(
    resolve(ROOT, 'theme/modules/membership-options.module/module.html'),
    'utf8'
  )
  const join = readFileSync(resolve(ROOT, 'theme/modules/membership-join.module/module.html'), 'utf8')

  it('appends "ex GST" to a paid card fee that does not already say it', () => {
    expect(cards).toMatch(
      /\{%- if _mo_fee_amount > 0 and 'gst' not in \(_display_credit_label ~ ' ' ~ _display_credit_value ~ ' ' ~ _display_credit_sub\)\|lower -%\}/
    )
    expect(cards).toMatch(/_display_credit_sub ~ ', ex GST'/)
  })

  it('does it before the join link is built, so the join page inherits the words', () => {
    const label = cards.indexOf("_display_credit_sub ~ ', ex GST'")
    const link = cards.indexOf("'&price_sub=' ~ (_display_credit_sub|urlencode)")
    expect(label).toBeGreaterThan(-1)
    expect(link).toBeGreaterThan(label)
  })

  it('labels a fee the join page resolved from its own fields', () => {
    expect(join).toMatch(/\{%- if _join_fee_amount > 0 and 'gst' not in /)
    expect(join).toMatch(/selected_price_sub ~ ', ex GST'/)
  })
})

describe('the member portal course cards', () => {
  const src = readFileSync(
    resolve(ROOT, 'src/modules/member-command-centre/MemberCommandCentre.tsx'),
    'utf8'
  )

  it('labels the price a member pays ex GST', () => {
    expect(src).toMatch(/'ex GST \(member\)' : 'ex GST \(course fee\)'/)
  })
})

/**
 * Deliberately NOT swept: the technical resources for sale
 * (`resource-library`, `resource-detail`). Their prices are free-text labels in
 * the `member_label` / `non_member_label` HubDB columns ("$450"), with no
 * purchase flow behind them and nothing recording whether they include GST.
 * Labelling them ex GST without knowing would be a guess about money.
 */
