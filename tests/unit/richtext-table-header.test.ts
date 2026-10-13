import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A dates table in a course description rendered a dark blue header row with
 * black text (Lara, 23 Sep, /courses/iwi-b-session-22). Editors colour header
 * rows inline in the rich text editor, so the guard has to set background AND
 * text together and beat inline styles.
 */
const ROOT = resolve(__dirname, '../..')
const BASE = readFileSync(resolve(ROOT, 'theme/assets/css/base.css'), 'utf8')
const TOKENS = readFileSync(resolve(ROOT, 'theme/assets/css/tokens.css'), 'utf8')
const OVERVIEW = readFileSync(resolve(ROOT, 'theme/templates/partials/course-overview.html'), 'utf8')

function rule(selector: string): string {
  const at = BASE.indexOf(selector)
  expect(at, `${selector} in base.css`).toBeGreaterThan(-1)
  return BASE.slice(at, BASE.indexOf('}', at))
}

describe('rich text table header cells', () => {
  it('defines the header pair as tokens', () => {
    expect(TOKENS).toMatch(/--wa-table-head-bg:\s*var\(--wa-color-primary\)/)
    expect(TOKENS).toMatch(/--wa-table-head-text:\s*var\(--wa-color-on-primary\)/)
  })

  it('forces both halves of the pair onto thead and first-row header cells', () => {
    const r = rule('.wa-richtext thead th,\n.wa-richtext tr:first-child > th {')
    expect(r).toMatch(/background-color: var\(--wa-table-head-bg\) !important/)
    expect(r).toMatch(/color: var\(--wa-table-head-text\) !important/)
  })

  it("makes the cell's contents inherit its text colour", () => {
    // An inline <span style="color:…"> or a navy <strong> inside the cell is
    // what produced dark on dark.
    const r = rule('.wa-richtext thead th *,\n.wa-richtext tr:first-child > th * {')
    expect(r).toMatch(/color: inherit !important/)
  })

  it('applies to the course description', () => {
    expect(OVERVIEW).toMatch(/class="wa-course-overview__content wa-richtext"/)
  })
})
