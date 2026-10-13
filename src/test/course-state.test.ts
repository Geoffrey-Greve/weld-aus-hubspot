/**
 * Guards the city → state mapping used by `pnpm backfill:course-state` and, as
 * a fallback, by the member dashboard's geo-localised course tile. Getting a
 * state wrong here hides a session from the members it is meant for.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CITY_STATE,
  STATE_OPTIONS,
  encodeStateOption,
  planCourseState,
  stateForCity
} from '../../scripts/lib/course-state'

function row(id: string, values: Record<string, unknown>) {
  return { id, values }
}

describe('stateForCity', () => {
  it('maps the cities the theme ships with', () => {
    expect(stateForCity('Sydney')).toBe('NSW')
    expect(stateForCity('Melbourne')).toBe('VIC')
    expect(stateForCity('Brisbane')).toBe('QLD')
    expect(stateForCity('Perth')).toBe('WA')
    expect(stateForCity('Adelaide')).toBe('SA')
    expect(stateForCity('Hobart')).toBe('TAS')
    expect(stateForCity('Darwin')).toBe('NT')
  })

  it('maps regional cities Weld Aus schedules into', () => {
    // The case that started this: a Mackay session used to fall through to
    // "National" and never reached QLD members.
    expect(stateForCity('Mackay')).toBe('QLD')
    expect(stateForCity('Geelong')).toBe('VIC')
    expect(stateForCity('Newcastle')).toBe('NSW')
    expect(stateForCity('Bunbury')).toBe('WA')
  })

  it('treats an online session as National', () => {
    expect(stateForCity('Online')).toBe('National')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(stateForCity('  mACKAY ')).toBe('QLD')
  })

  it('returns null rather than guessing an unknown city', () => {
    expect(stateForCity('Broken Hill')).toBeNull()
    expect(stateForCity('')).toBeNull()
    expect(stateForCity(undefined)).toBeNull()
  })

  it('only ever produces a state the HubDB column accepts', () => {
    const columns = JSON.parse(
      readFileSync(resolve(process.cwd(), 'hubdb/courses.json'), 'utf-8')
    ).columns
    const stateColumn = columns.find((c: any) => c.name === 'state')
    expect(stateColumn).toBeDefined()
    const allowed = stateColumn.options.map((o: any) => o.name)
    expect(allowed).toEqual([...STATE_OPTIONS])
    for (const state of Object.values(CITY_STATE)) {
      expect(allowed).toContain(state)
    }
  })

  it('covers every city option in the HubDB schema', () => {
    const columns = JSON.parse(
      readFileSync(resolve(process.cwd(), 'hubdb/courses.json'), 'utf-8')
    ).columns
    const cities = columns
      .find((c: any) => c.name === 'city')
      .options.map((o: any) => o.name)
    for (const city of cities) {
      expect(stateForCity(city), `${city} has no state`).not.toBeNull()
    }
  })
})

describe('planCourseState', () => {
  it('fills a blank state from the city', () => {
    const plan = planCourseState([row('1', { course_name: 'VWI', city: { name: 'Mackay' } })])
    expect(plan.planned).toEqual([
      { id: '1', label: 'VWI', city: 'Mackay', from: '', to: 'QLD' }
    ])
  })

  it('leaves a state someone has already set', () => {
    const plan = planCourseState([
      row('1', { course_name: 'VWI', city: { name: 'Mackay' }, state: { name: 'National' } })
    ])
    expect(plan.planned).toHaveLength(0)
    expect(plan.untouched).toBe(1)
  })

  it('rewrites an existing state only under force', () => {
    const rows = [
      row('1', { course_name: 'VWI', city: { name: 'Mackay' }, state: { name: 'National' } })
    ]
    const plan = planCourseState(rows, { force: true })
    expect(plan.planned).toEqual([
      { id: '1', label: 'VWI', city: 'Mackay', from: 'National', to: 'QLD' }
    ])
  })

  it('is a no-op under force when the state already matches', () => {
    const plan = planCourseState(
      [row('1', { course_name: 'VWI', city: { name: 'Mackay' }, state: { name: 'QLD' } })],
      { force: true }
    )
    expect(plan.planned).toHaveLength(0)
    expect(plan.untouched).toBe(1)
  })

  it('reports an unknown city instead of guessing', () => {
    const plan = planCourseState([
      row('1', { course_name: 'VWI', city: { name: 'Broken Hill' } })
    ])
    expect(plan.planned).toHaveLength(0)
    expect(plan.unknownCities).toEqual([{ label: 'VWI', city: 'Broken Hill' }])
  })

  it('reports a row with no city at all', () => {
    const plan = planCourseState([row('1', { course_name: 'VWI' })])
    expect(plan.planned).toHaveLength(0)
    expect(plan.cityless).toEqual(['VWI'])
  })

  it('accepts a plain-string select value', () => {
    const plan = planCourseState([row('1', { course_name: 'VWI', city: 'Perth' })])
    expect(plan.planned[0]?.to).toBe('WA')
  })
})

describe('encodeStateOption', () => {
  // Production rejected a bare string on every row: "the value {type=string,
  // value=QLD} for column state was of type STRING, but we're expecting MAP".
  const column = {
    name: 'state',
    options: [
      { id: 1, name: 'NSW' },
      { id: 2, name: 'QLD' },
      { id: 3, name: 'National' }
    ]
  }

  it('encodes a state as the column option object, never a bare string', () => {
    expect(encodeStateOption(column, 'QLD')).toEqual({
      id: 2,
      name: 'QLD',
      type: 'option'
    })
  })

  it('matches on the option label when that is what the portal carries', () => {
    expect(
      encodeStateOption({ options: [{ id: 9, name: 'qld', label: 'QLD' }] }, 'QLD')
    ).toEqual({ id: 9, name: 'qld', type: 'option' })
  })

  it('returns null when the portal column has no such option', () => {
    expect(encodeStateOption(column, 'VIC')).toBeNull()
  })

  it('returns null for a column that is missing or has no options', () => {
    expect(encodeStateOption(undefined, 'QLD')).toBeNull()
    expect(encodeStateOption({ name: 'state' }, 'QLD')).toBeNull()
  })
})
