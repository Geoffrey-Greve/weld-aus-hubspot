/**
 * A Corporate or Industry Supplier member may stay put or move up, never down.
 *
 * QA ref 44. The membership-options cards are editor content with no per-card
 * visibility rule, so the attempt to do this with HubSpot smart content could
 * only remove a card from the Default view as well - "if I remove a card under
 * the Gold rule, it removes it from Default too". It has to be in the template.
 *
 * The rule FAILS OPEN: only a company tier we positively recognise as gold or
 * silver restricts anything. A blank, unknown or individual tier leaves every
 * card as the editor wrote it, because of the two ways to be wrong, one shows a
 * member a plan they cannot take and the other hides the plan a prospect came
 * to buy.
 *
 * HubL cannot be executed here, so this reads the source.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(resolve(__dirname, '../../', path), 'utf8')

const MODULE = read('theme/modules/membership-options.module/module.html')
const CSS = read('theme/modules/membership-options.module/module.css')

const RANK = read('theme/templates/partials/_membership-rank.html')
const TIERS = read('theme/modules/tier-comparison.module/module.html')
const TIERS_CSS = read('theme/modules/tier-comparison.module/module.css')

describe('resolving the visitor’s level', () => {
  it('is one partial, shared by every surface selling the ranked levels', () => {
    for (const src of [MODULE, TIERS]) {
      expect(src).toContain('{% include "../../templates/partials/_membership-rank.html" %}')
    }
    expect(MODULE).toMatch(/_mo_member_rank = wa_membership_rank\.rank/)
    expect(TIERS).toMatch(/_tc_member_rank = wa_membership_rank\.rank/)
  })

  it('reads the company tier through the shared ladder, not associatedcompanyid alone', () => {
    // `associatedcompanyid` is only ever set for a PRIMARY association and much
    // of Weld's corporate membership has none - the same finding that fixed the
    // Worker's price_mismatch failures.
    expect(RANK).toContain('_member-company-resolve.html')
    expect(RANK).toMatch(/_wa_rank_tier = wa_member_company\.tier/)
  })

  it('lets a QA persona outrank the CRM, as the portal and pricing do', () => {
    // Ref 44 retest: a persona was Gold on the dashboard and nobody on
    // /membership, so every corporate card still said "Apply now".
    expect(RANK).toContain('_qa-persona-resolve.html')
    const persona = RANK.slice(RANK.indexOf('{% if qa_persona.found %}'))
    expect(persona).toMatch(/\{% if qa_persona\.entitled %\}\s*\{% set _wa_rank_tier = qa_persona\.company_tier %\}/)
    // A persona that is not entitled restricts nothing.
    expect(persona).toMatch(/\{% else %\}\s*\{% set _wa_rank_tier = '' %\}/)
    // And it is read AFTER the company, so it wins.
    expect(RANK.indexOf('_qa-persona-resolve.html" %}')).toBeGreaterThan(
      RANK.indexOf('_member-company-resolve.html" %}')
    )
  })

  it('does not rank a lapsed member, who may rejoin at any level', () => {
    expect(RANK).toMatch(/'lapsed' in _wa_rank_status_key/)
    expect(RANK).toMatch(/'expired' in _wa_rank_status_key/)
    expect(RANK).toMatch(/'cancel' in _wa_rank_status_key/)
    // "inactive" contains "active": matched exactly, never as a substring.
    expect(RANK).toMatch(/_wa_rank_status_key == 'inactive'/)
    expect(RANK).toMatch(/\{% if not _wa_rank_lapsed %\}/)
  })

  it('ranks gold above silver, and ranks nothing else', () => {
    expect(RANK).toMatch(/'gold' in _wa_rank_tier_key[\s\S]{0,80}wa_membership_rank\.rank = 3/)
    expect(RANK).toMatch(/'silver' in _wa_rank_tier_key[\s\S]{0,80}wa_membership_rank\.rank = 2/)
  })

  it('starts at rank 0, so an unrecognised tier restricts nothing', () => {
    expect(RANK).toMatch(/namespace\(rank=0, tier_label=''\)/)
    // Every branch that acts is guarded on a positive rank.
    expect(MODULE).toMatch(/_mo_is_current = _mo_member_rank > 0/)
    expect(MODULE).toMatch(/_mo_is_downgrade = _mo_member_rank > 0/)
  })

  it('asks nothing of an anonymous visitor', () => {
    expect(RANK).toMatch(/\{% if request_contact\.is_logged_in %\}/)
  })
})

describe('the corporate tier table on /membership/corporate', () => {
  it('replaces the join link on the member’s own tier and every tier below it', () => {
    expect(TIERS).toMatch(/_rank == _tc_member_rank -%\}\s*<p class="wa-tier-comparison__cta-note wa-tier-comparison__cta-note--current">Your current membership<\/p>/)
    expect(TIERS).toMatch(/_rank < _tc_member_rank -%\}\s*<p class="wa-tier-comparison__cta-note">Included in your \{\{ _tc_tier_label \}\} membership<\/p>/)
  })

  it('guards on a positive rank on both sides, so an unranked table is untouched', () => {
    expect(TIERS).toMatch(/_tc_member_rank > 0 and _rank > 0 and _rank == _tc_member_rank/)
    expect(TIERS).toMatch(/_tc_member_rank > 0 and _rank > 0 and _rank < _tc_member_rank/)
  })

  it('applies the guard to the desktop table AND the mobile cards', () => {
    expect(TIERS).toContain("{{ tc_cta(tier, 'wa-tier-comparison__cta') }}")
    expect(TIERS).toContain("{{ tc_cta(tier, 'wa-tier-comparison__mobile-cta') }}")
    // No join link rendered outside the guarded macro.
    expect(TIERS.match(/href="\{\{ tier\.cta_link\.url\.href \}\}"/g)?.length).toBe(1)
  })

  it('keeps the note at the button’s height', () => {
    expect(TIERS_CSS).toMatch(/\.wa-tier-comparison__cta-note\s*\{[\s\S]*?min-height: var\(--wa-touch-min/)
  })
})

describe('the portal dashboard upgrade link', () => {
  const MCC = read('src/modules/member-command-centre/MemberCommandCentre.tsx')
  const MCC_CSS = read('src/modules/member-command-centre/MemberCommandCentre.css')

  it('is a button, not a 12px footnote', () => {
    const upgrades = MCC.match(/className="([^"]+)" href=\{membershipUpgradeUrl\(profile\.member_tier\)\}>\s*Upgrade membership/g) ?? []
    expect(upgrades.length).toBe(2)
    for (const a of upgrades) expect(a).toContain('wa-mcc__tile-link--button')
    expect(MCC_CSS).toMatch(/\.wa-mcc \.wa-mcc__tile-link--button,[\s\S]*?min-height: var\(--wa-touch-min, 44px\)/)
  })
})

describe('ranking a card', () => {
  it('ranks the three levels in both the corporate and supplier tabs', () => {
    for (const [slugs, rank] of [
      [["'corporate-gold'", "'supplier-gold'"], 3],
      [["'corporate-silver'", "'supplier-silver'"], 2],
      [["'corporate-bronze'", "'supplier-bronze'"], 1],
    ] as const) {
      for (const slug of slugs) expect(MODULE).toContain(slug)
      expect(MODULE).toMatch(new RegExp(`_mo_card_rank = ${rank}`))
    }
  })

  it('leaves individual, student, reciprocal and TAFE/RTO cards unranked', () => {
    // A different KIND of membership is not a step down from a corporate one.
    const block = MODULE.slice(MODULE.indexOf('{%- set _mo_card_rank = 0 -%}'))
    const guard = block.slice(0, block.indexOf('_card_href'))
    for (const slug of ['individual', 'student-apprentice', 'reciprocal', 'tafe-rto']) {
      expect(guard).not.toContain(`'${slug}'`)
    }
  })
})

describe('what a card shows', () => {
  it('offers no join link below the member’s own level', () => {
    expect(MODULE).toMatch(/\{%\s*elif _mo_is_downgrade\s*%\}/)
    expect(MODULE).toContain('Included in your {{ _mo_tier_label }} membership')
  })

  it('names the member’s own level rather than offering to sell it again', () => {
    expect(MODULE).toMatch(/\{%\s*if _mo_is_current\s*%\}/)
    expect(MODULE).toContain('Your current membership')
  })

  it('keeps the join link for an upgrade, and for everyone unranked', () => {
    // The anchor is the final `elif`, so it still renders whenever neither
    // state applies - which includes every anonymous visitor.
    const cta = MODULE.slice(MODULE.indexOf('{% if _mo_is_current %}'))
    expect(cta).toMatch(/\{%\s*elif card\.cta_label\s*%\}[\s\S]{0,400}href="\{\{ _card_href \}\}"/)
  })

  it('still renders the card — price, benefits and all', () => {
    // Nothing gates the <article> on the guard; the comparison is the point of
    // the page. Only the CTA changes.
    const article = MODULE.slice(MODULE.indexOf('<article'), MODULE.indexOf('{% if _mo_is_current %}'))
    expect(article).not.toContain('_mo_is_downgrade')
    expect(MODULE).toContain('data-membership-card-state="below-current"')
  })

  it('keeps the note at the button’s height so the grid does not jump', () => {
    expect(CSS).toMatch(/\.wa-membership-options__cta-note\s*\{[\s\S]*?min-height: var\(--wa-touch-min/)
  })
})
