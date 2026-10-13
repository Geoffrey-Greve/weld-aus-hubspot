import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CITY_ORDER, orderCitiesForRows, sameCity } from './courseCities'

/**
 * The HubDB SELECT is what staff can actually choose. CITY_ORDER only sorts
 * that list, so it is allowed to be a different shape from the schema in
 * exactly no way: a city in HubDB and not here sorts to the bottom as if it
 * were a typo, and a city here and not in HubDB is an option nobody can pick.
 */
function hubdbCityOptions(): string[] {
  const raw = readFileSync(resolve(__dirname, '../../hubdb/courses.json'), 'utf-8')
  const table = JSON.parse(raw) as {
    columns: Array<{ name: string; options?: Array<{ name: string }> }>
  }
  const city = table.columns.find((c) => c.name === 'city')
  if (!city?.options) throw new Error('hubdb/courses.json has no `city` SELECT options')
  return city.options.map((o) => o.name)
}

describe('course cities', () => {
  it('covers every option the courses.city SELECT can hold', () => {
    expect([...CITY_ORDER].sort()).toEqual([...hubdbCityOptions()].sort())
  })

  it('keeps Online last so it does not sort in among the capitals', () => {
    expect(CITY_ORDER[CITY_ORDER.length - 1]).toBe('Online')
  })

  /**
   * A town the rows carry and CITY_ORDER has never heard of - the case § 7.8
   * exists for, where staff add a location in HubDB before anyone ships a
   * display order for it.
   *
   * It has to be a name nobody will ever add for real. These tests used
   * Gladstone until Weld added Gladstone, at which point the fixture became
   * canonical and the "sorts after the canonical ones" assertion inverted. The
   * guard below fails loudly with the reason rather than leaving the next
   * person to work that out from `expected 13 to be greater than 15`.
   */
  const UNLISTED_CITY = 'Woop Woop'

  it('keeps the unlisted-city fixture unlisted', () => {
    expect(
      CITY_ORDER.map((c) => c.toLowerCase()),
      `${UNLISTED_CITY} is in CITY_ORDER now - pick a different fixture for the tests below`
    ).not.toContain(UNLISTED_CITY.toLowerCase())
  })

  it('offers a city the rows use even when it is not in the canonical order', () => {
    const cities = orderCitiesForRows([{ city: UNLISTED_CITY }])
    expect(cities).toContain(UNLISTED_CITY)
    // Unknown cities sort after the canonical ones rather than jumping the queue.
    expect(cities.indexOf(UNLISTED_CITY)).toBeGreaterThan(cities.indexOf('Online'))
  })

  it('adds one option for a city several sessions share', () => {
    const cities = orderCitiesForRows([
      { city: UNLISTED_CITY },
      { city: UNLISTED_CITY },
      { city: UNLISTED_CITY.toLowerCase() }
    ])
    expect(
      cities.filter((c) => c.toLowerCase() === UNLISTED_CITY.toLowerCase())
    ).toHaveLength(1)
  })

  it('drops empty canonical cities when the caller asks for present-only', () => {
    const cities = orderCitiesForRows([{ city: 'Mackay' }], { includeEmpty: false })
    expect(cities).toEqual(['Mackay'])
  })

  it('keeps empty canonical cities by default, so the EOI form stays reachable', () => {
    expect(orderCitiesForRows([{ city: 'Mackay' }])).toContain('Darwin')
  })

  it('matches a row whose city differs only by case or padding', () => {
    // hubdb-options.ts treats a hand-added "mackay" as the same option as
    // "Mackay", so the two spellings genuinely coexist and must compare equal.
    expect(sameCity('Mackay', ' mackay ')).toBe(true)
    expect(sameCity('Mackay', 'Maryborough')).toBe(false)
    expect(sameCity('', undefined)).toBe(true)
  })

  it('ignores blank and whitespace-only cities', () => {
    expect(orderCitiesForRows([{ city: '  ' }, { city: null }], { includeEmpty: false })).toEqual(
      []
    )
  })
})
