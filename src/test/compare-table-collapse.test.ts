/**
 * compare-table.module collapse regression guards (QA #60).
 *
 * The "Compare tiers" group headings on /membership are disclosure buttons.
 * They rendered a chevron that rotated but never hid any rows, because the
 * template built the row keys with `loop.parent.index` — a Jinja2 construct
 * HubL does not support, so it rendered as an empty string and the group
 * header key ("corporate-1") never matched the row key ("corporate-").
 *
 * These tests read the theme source directly and exercise module.js in jsdom,
 * so the defect cannot come back silently.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'

const root = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const MODULE_DIR = 'theme/modules/compare-table.module'
const html = read(`${MODULE_DIR}/module.html`)
const js = read(`${MODULE_DIR}/module.js`)

describe('compare-table HubL source', () => {
  it('does not use loop.parent — unsupported in HubL', () => {
    expect(html).not.toContain('loop.parent')
  })

  it('keys group header rows and feature rows off the same captured index', () => {
    expect(html).toContain('{%- set _group_index = loop.index -%}')
    expect(html).toContain('data-group-index="{{ _panel_key }}-{{ _group_index }}"')
    expect(html).toContain('data-group="{{ _panel_key }}-{{ _group_index }}"')
  })

  it('gives each feature row an id built from the same captured index', () => {
    expect(html).toContain(
      'id="wa-cmp-{{ _panel_key }}-group-{{ _group_index }}-row-{{ loop.index }}"',
    )
  })

  it('renders a chevron only inside the disclosure button, never on a static label', () => {
    // One chevron in the whole template: the one inside the <button>.
    expect((html.match(/wa-compare-table__chevron/g) ?? []).length).toBe(1)

    const staticBranch = html.slice(
      html.indexOf('wa-compare-table__group-static'),
      html.indexOf('</div>', html.indexOf('wa-compare-table__group-static')),
    )
    expect(staticBranch).not.toContain('svg')
  })
})

/** Builds the markup the template emits for one collapsible panel. */
function renderPanel(panelKey: string, rowKeySuffix: (groupIndex: number) => string): string {
  const groups = [1, 2]
    .map((g) => {
      const rows = [1, 2]
        .map(
          (r) => `
        <tr class="wa-compare-table__row"
            data-group="${panelKey}-${rowKeySuffix(g)}"
            id="wa-cmp-${panelKey}-group-${g}-row-${r}">
          <td class="wa-compare-table__feature-label">Feature ${g}.${r}</td>
          <td class="wa-compare-table__value">Yes</td>
        </tr>`,
        )
        .join('')

      return `
      <tr class="wa-compare-table__group-row" data-group-index="${panelKey}-${g}">
        <td colspan="2">
          <button class="wa-compare-table__group-btn" aria-expanded="true" type="button">
            <span>Group ${g}</span>
            <svg class="wa-compare-table__chevron"></svg>
          </button>
        </td>
      </tr>${rows}`
    })
    .join('')

  return `<table class="wa-compare-table wa-compare-table--collapsible" data-collapsible="true">
      <tbody>${groups}</tbody>
    </table>`
}

const runModuleJs = () => new Function(js)()

const rowsOf = (groupIndex: number) =>
  Array.from(
    document.querySelectorAll<HTMLTableRowElement>(
      `tr.wa-compare-table__row[id^="wa-cmp-corporate-group-${groupIndex}-"]`,
    ),
  )

const buttonOf = (groupIndex: number): HTMLButtonElement => {
  const btn = document.querySelectorAll<HTMLButtonElement>('.wa-compare-table__group-btn')[
    groupIndex - 1
  ]
  if (!btn) throw new Error(`No group button rendered at index ${groupIndex}`)
  return btn
}

describe('compare-table collapse behaviour', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('hides and re-shows a group’s rows when its heading is clicked', () => {
    document.body.innerHTML = renderPanel('corporate', (g) => String(g))
    runModuleJs()

    const btn = buttonOf(1)
    expect(rowsOf(1).every((r) => r.hidden)).toBe(false)

    btn.click()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(rowsOf(1).every((r) => r.hidden)).toBe(true)
    // Sibling group is untouched.
    expect(rowsOf(2).some((r) => r.hidden)).toBe(false)

    btn.click()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(rowsOf(1).some((r) => r.hidden)).toBe(false)
  })

  it('still toggles when the row keys are malformed (the QA #60 markup)', () => {
    // What loop.parent.index produced: "corporate-" with no index.
    document.body.innerHTML = renderPanel('corporate', () => '')
    runModuleJs()

    buttonOf(1).click()
    expect(rowsOf(1).every((r) => r.hidden)).toBe(true)
    expect(rowsOf(2).some((r) => r.hidden)).toBe(false)
  })
})
