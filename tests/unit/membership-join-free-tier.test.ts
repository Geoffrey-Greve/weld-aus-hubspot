import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Issue 251: free / by-agreement membership tiers cannot check out via Revenue Hub.
 * Pin the membership-join free-tier branch so paid payment links and per-tier
 * application forms stay wired correctly.
 */

const MODULE_HTML = readFileSync(
  resolve(__dirname, '../../theme/modules/membership-join.module/module.html'),
  'utf8',
)
const MODULE_JS = readFileSync(
  resolve(__dirname, '../../theme/modules/membership-join.module/module.js'),
  'utf8',
)
const MODULE_CSS = readFileSync(
  resolve(__dirname, '../../theme/modules/membership-join.module/module.css'),
  'utf8',
)
const FIELDS_JSON = readFileSync(
  resolve(__dirname, '../../theme/modules/membership-join.module/fields.json'),
  'utf8',
)

describe('membership-join free-tier application branch (issue 251)', () => {
  it('exposes one application form field per free / by-agreement tier with live GUIDs', () => {
    const fields = JSON.parse(FIELDS_JSON) as Array<{
      name: string
      type: string
      default?: { form_id?: string }
    }>
    const formFields = fields.filter((field) => field.type === 'form')
    expect(formFields.map((field) => field.name)).toEqual([
      'student_apprentice_application_form',
      'reciprocal_application_form',
      'tafe_rto_application_form',
    ])
    expect(formFields[0]?.default?.form_id).toBe('842ea403-aeec-4cea-b2f6-d0a22ce8db35')
    expect(formFields[1]?.default?.form_id).toBe('1c03846a-c399-4750-a58d-fb735a1b18d2')
    expect(formFields[2]?.default?.form_id).toBe('93662621-fb14-4fc1-ad52-79dd463c4c7e')
  })

  it('keeps the same GUIDs as hard fallbacks in module.html', () => {
    // The fallbacks became portal-conditional when the Dev portal landed
    // ('Prepare HubSpot development portal'), so the production GUID is now the `else`
    // branch rather than the whole assignment. Assert that shape: a bare toContain would
    // still pass if a future edit demoted production to the dev-portal side.
    expect(MODULE_HTML).toContain("else '842ea403-aeec-4cea-b2f6-d0a22ce8db35'")
    expect(MODULE_HTML).toContain("else '1c03846a-c399-4750-a58d-fb735a1b18d2'")
    expect(MODULE_HTML).toContain("else '93662621-fb14-4fc1-ad52-79dd463c4c7e'")
  })

  it('marks free / by-agreement slugs as application tiers, not payment checkouts', () => {
    for (const slug of ['student-apprentice', 'reciprocal', 'tafe-rto']) {
      expect(MODULE_HTML).toContain(`'slug': '${slug}'`)
    }
    expect(MODULE_HTML).toMatch(/'slug': 'student-apprentice'[\s\S]*?'is_free_application': true/)
    expect(MODULE_HTML).toMatch(/'slug': 'reciprocal'[\s\S]*?'is_free_application': true/)
    expect(MODULE_HTML).toMatch(/'slug': 'tafe-rto'[\s\S]*?'is_free_application': true/)
    expect(MODULE_HTML).toMatch(/'slug': 'individual'[\s\S]*?'is_free_application': false/)
  })

  it('uses a theme-owned form + Forms API (not a HubSpot iframe embed)', () => {
    expect(MODULE_HTML).toContain('data-wa-membership-application')
    expect(MODULE_HTML).toContain('name="firstname"')
    expect(MODULE_HTML).toContain('name="lastname"')
    expect(MODULE_HTML).toContain('name="email"')
    expect(MODULE_HTML).toContain('Complete application form')
    expect(MODULE_HTML).toContain('Continue to secure payment')
    expect(MODULE_HTML).toContain('Request application form')
    expect(MODULE_HTML).not.toContain('js.hsforms.net/forms/embed/v2.js')
    expect(MODULE_HTML).not.toContain('hbspt.forms.create')
    expect(MODULE_JS).toContain('api.hsforms.com/submissions/v3/integration/submit/')
    expect(MODULE_JS).toContain("name: 'firstname'")
    expect(MODULE_JS).toContain("name: 'mobilephone'")
    expect(MODULE_JS).toContain('FORM_HAS_RECAPTCHA_ENABLED')
  })
})

describe('membership-join application form theme CSS', () => {
  it('styles the theme-owned fields, not unreachable iframe --hsf-* vars', () => {
    expect(MODULE_CSS).toContain('.wa-mj-input')
    expect(MODULE_CSS).toContain('.wa-membership-join__form-submit')
    expect(MODULE_CSS).toContain('var(--wa-color-primary')
    expect(MODULE_CSS).toContain('var(--wa-touch-min')
    expect(MODULE_CSS).not.toContain('--hsf-button__background-color')
    expect(MODULE_CSS).not.toContain('.hsfc-Button')
  })
})
