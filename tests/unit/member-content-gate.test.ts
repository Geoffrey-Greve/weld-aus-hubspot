import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The "Members only" tickbox on a content module is COMPANY-AWARE.
 *
 * Ten content modules each derived it themselves, all the same wrong way:
 *
 *   {% set _is_active_member = _member_status in ['Current'] %}
 *
 * which is the contact's OWN membership and nothing else. A corporate employee's
 * membership lives on their employer's company record and reaches them as the
 * mirrored `wa_company_membership_*` properties, so that test excludes exactly the
 * population Ref 72 was about - and the member-dashboard copy of it locked member
 * resources for those people inside their own portal.
 *
 * `_member-content-gate.html` is the one derivation now. This test fails the build
 * if a module goes back to deciding it locally.
 */
const ROOT = resolve(__dirname, '../..')
const GATE = 'theme/templates/partials/_member-content-gate.html'

/**
 * HubL comments stripped everywhere, because the gate and the modules now CARRY
 * the old expression in a comment explaining why it is gone. A sweep that cannot
 * tell code from prose fails on its own documentation.
 */
function stripHubLComments(src: string): string {
  return src.replace(/\{#-?[\s\S]*?-?#\}/g, '')
}

const GATE_SRC = stripHubLComments(readFileSync(resolve(ROOT, GATE), 'utf8'))

function moduleSources(): { path: string; src: string }[] {
  return globSync('theme/modules/*/module.html', { cwd: ROOT }).map((path) => ({
    path,
    src: stripHubLComments(readFileSync(resolve(ROOT, path), 'utf8'))
  }))
}

describe('the shared member content gate', () => {
  it('counts a mirrored COMPANY signal, not just the contact', () => {
    expect(GATE_SRC).toMatch(/request_contact\.wa_company_membership_status/)
    expect(GATE_SRC).toMatch(/request_contact\.wa_company_membership_tier/)
  })

  it('scrubs the CRM "no membership" sentinels before reading either record', () => {
    // Otherwise "Not Applicable" on the contact shadows the employer's Gold -
    // the failure _member-tier.html exists to stop.
    expect(GATE_SRC).toMatch(/wa_gate_tier\.scrub\(/)
    const scrubbed = GATE_SRC.match(/wa_gate_tier\.scrub\(/g) ?? []
    expect(scrubbed.length).toBe(4)
  })

  it('lets an explicitly lapsed status outrank every positive signal', () => {
    expect(GATE_SRC).toMatch(/wa_gate_inactive_keys = \['lapsed', 'expired', 'inactive', 'cancelled', 'canceled'\]/)
    expect(GATE_SRC).toMatch(/\(not wa_gate_inactive\) and \(/)
  })

  it('matches "inactive" exactly and never as a substring', () => {
    // "inactive" contains "active": a substring test would read every lapsed
    // member as current, in the one clause meant to outrank the rest.
    const inactiveClause = GATE_SRC.slice(
      GATE_SRC.indexOf('{% set wa_gate_inactive ='),
      GATE_SRC.indexOf('{% set wa_gate_contact_tier_real')
    )
    expect(inactiveClause).toMatch(/in wa_gate_inactive_keys/)
    expect(inactiveClause).not.toMatch(/ in wa_gate_(contact|company)_key/)
  })

  it('counts neither a CAMS person id nor a membership expiry date', () => {
    // Both say the contact was MIGRATED, not that they are a member. Counting
    // them is what quoted every migrated contact a member rate at checkout
    // (events-engine CLAUDE.md).
    expect(GATE_SRC).not.toMatch(/cams_person_id|cams__imem_person_id/)
    expect(GATE_SRC).not.toMatch(/membership_expiry/)
  })

  it('costs an anonymous visitor nothing', () => {
    // Mirror only. A crm_object call here would run on ordinary marketing pages
    // where the tickbox is usually off.
    expect(GATE_SRC).not.toMatch(/crm_object|crm_objects|hubdb_table_rows/)
    expect(GATE_SRC).toMatch(/\{% if wa_member_gate\.logged_in %\}/)
  })
})

describe('no module decides member visibility for itself', () => {
  it('has no module testing individual_membership_status against Current', () => {
    const offenders = moduleSources()
      .filter(({ src }) =>
        /individual_membership_status[^%]*==\s*'Current'/.test(src) ||
        /individual_membership_status[^%]*in \['Current'\]/.test(src)
      )
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('routes every members_only content module through the shared gate', () => {
    const gated = moduleSources().filter(({ src }) => /wa_member_gate\.is_member/.test(src))
    // The eight content modules plus member-dashboard's resource lock.
    expect(gated.length).toBeGreaterThanOrEqual(9)
    for (const { path, src } of gated) {
      expect(src, `${path} reads the gate without including it`).toMatch(
        /\{%-? include "\.\.\/\.\.\/templates\/partials\/_member-content-gate\.html" -?%\}/
      )
    }
  })
})
