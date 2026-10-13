import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isOptionColumnType, mergeColumnOptions } from './hubdb-options'

const portalOption = (id: string, name: string) => ({ id, name, type: 'option', order: 0 })
const jsonOption = (name: string) => ({ name, type: 'option' })

describe('mergeColumnOptions', () => {
  it('appends an option the JSON has and the portal does not', () => {
    const merge = mergeColumnOptions(
      [portalOption('3', 'Brisbane')],
      [jsonOption('Brisbane'), jsonOption('Mackay')]
    )
    expect(merge.added).toEqual(['Mackay'])
    expect(merge.changed).toBe(true)
    expect(merge.options.map((o) => o.name)).toEqual(['Brisbane', 'Mackay'])
  })

  // Rows store the option ID, not its label. Re-sending an existing option
  // without its id is how every cell already set to it gets orphaned.
  it('passes existing options through with their ids untouched', () => {
    const merge = mergeColumnOptions(
      [portalOption('3', 'Brisbane')],
      [jsonOption('Brisbane'), jsonOption('Mackay')]
    )
    expect(merge.options[0]).toEqual(portalOption('3', 'Brisbane'))
    expect(merge.options[1]).not.toHaveProperty('id')
  })

  it('reports nothing to do when the portal already holds every option', () => {
    const merge = mergeColumnOptions(
      [portalOption('1', 'Sydney'), portalOption('3', 'Brisbane')],
      [jsonOption('Sydney'), jsonOption('Brisbane')]
    )
    expect(merge.changed).toBe(false)
    expect(merge.added).toEqual([])
  })

  it('keeps and reports an option only the portal has, never removing it', () => {
    const merge = mergeColumnOptions(
      [portalOption('1', 'Sydney'), portalOption('9', 'Townsville')],
      [jsonOption('Sydney')]
    )
    expect(merge.portalOnly).toEqual(['Townsville'])
    expect(merge.options.map((o) => o.name)).toEqual(['Sydney', 'Townsville'])
    expect(merge.changed).toBe(false)
  })

  // "mackay" typed into the portal UI is the same option as "Mackay" here;
  // appending a second one splits the timetable across two identical-looking values.
  it('matches by name case-insensitively and trimmed', () => {
    const merge = mergeColumnOptions([portalOption('9', ' mackay ')], [jsonOption('Mackay')])
    expect(merge.added).toEqual([])
    expect(merge.changed).toBe(false)
  })

  it('appends a repeated JSON option once', () => {
    const merge = mergeColumnOptions([], [jsonOption('Mackay'), jsonOption('Mackay')])
    expect(merge.added).toEqual(['Mackay'])
  })

  it('handles a column the portal has no options on yet', () => {
    const merge = mergeColumnOptions(undefined, [jsonOption('Mackay')])
    expect(merge.options.map((o) => o.name)).toEqual(['Mackay'])
  })

  it('ignores nameless entries rather than sending a blank option', () => {
    const merge = mergeColumnOptions([], [jsonOption(''), jsonOption('Mackay')])
    expect(merge.added).toEqual(['Mackay'])
  })
})

describe('isOptionColumnType', () => {
  it('covers the two HubDB types that hold a value list', () => {
    expect(isOptionColumnType('SELECT')).toBe(true)
    expect(isOptionColumnType('multiselect')).toBe(true)
    expect(isOptionColumnType('TEXT')).toBe(false)
    expect(isOptionColumnType(undefined)).toBe(false)
  })
})

describe('courses.city', () => {
  // The whole point of the merge: this is the list staff edit to add a town,
  // and before it the seed read the file and changed nothing.
  it('declares the regional centres, so a seed run can add them', () => {
    const table = JSON.parse(
      readFileSync(resolve(__dirname, '../../hubdb/courses.json'), 'utf-8')
    ) as { columns: Array<{ name: string; type: string; options?: Array<{ name: string }> }> }
    const city = table.columns.find((c) => c.name === 'city')
    expect(city?.type).toBe('SELECT')
    expect(city?.options?.map((o) => o.name)).toContain('Mackay')
  })
})
