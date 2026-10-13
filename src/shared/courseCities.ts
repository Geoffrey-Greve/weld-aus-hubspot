/**
 * Course session locations.
 *
 * ONE list, shared by both timetable islands, and it is a DISPLAY ORDER - not
 * a whitelist. `courses.city` is a HubDB SELECT whose options staff extend
 * (hubdb/courses.json → `pnpm seed:hubdb`), so any list compiled into a bundle
 * is out of date the moment they add a town. CourseFilter used to render this
 * list verbatim as its `<select>`: a session in a town that was not in it could
 * not be chosen, the "auto" default fell through to Sydney, and a course whose
 * only sessions were regional told every visitor there were none - the page
 * advertising an open Mackay course and then offering nothing to book (QA 86).
 *
 * So callers UNION this order with the cities actually present in their rows.
 * This file decides what comes first; the data decides what exists.
 *
 * courseCities.test.ts fails the build if this drifts from the option list in
 * hubdb/courses.json, because the order is only useful while it covers what the
 * table can hold.
 */

/** Canonical display order: capitals, regional centres, then Online last. */
export const CITY_ORDER = [
  'Sydney',
  'Melbourne',
  'Brisbane',
  'Perth',
  'Adelaide',
  'Canberra',
  'Darwin',
  'Hobart',
  'Newcastle',
  'Wollongong',
  'Geelong',
  'Mackay',
  'Maryborough',
  'Gladstone',
  'Townsville',
  'Online'
]

const CITY_RANK = new Map(CITY_ORDER.map((city, index) => [city.toLowerCase(), index]))

/**
 * Do these two names mean the same location?
 *
 * Case- and whitespace-insensitive, because the two sides genuinely disagree:
 * a selector option can carry the canonical spelling from CITY_ORDER while the
 * row it has to match carries whatever HubDB holds, and the HubDB option list
 * is allowed to contain a hand-added "mackay" (scripts/lib/hubdb-options.ts
 * treats it as the same option rather than appending a second one). Comparing
 * exactly meant the selector offered Mackay, the visitor chose it, and no row
 * matched - the same dead end this change exists to remove.
 */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  return (
    String(a ?? '')
      .trim()
      .toLowerCase() ===
    String(b ?? '')
      .trim()
      .toLowerCase()
  )
}

/**
 * Every city to offer, in display order: the canonical list, plus any city
 * present in the rows that is not in it (A→Z, after the known ones).
 *
 * `includeEmpty: false` drops canonical cities with no sessions - right for a
 * directory that filters what is on the page. CourseFilter keeps them, because
 * picking a city with nothing scheduled is how a visitor reaches the
 * expression-of-interest form.
 */
export function orderCitiesForRows(
  rows: Array<{ city?: string | null }>,
  opts: { includeEmpty?: boolean } = {}
): string[] {
  const { includeEmpty = true } = opts

  const present = new Set<string>()
  const extras = new Map<string, string>()
  for (const row of rows) {
    const city = String(row.city ?? '').trim()
    if (!city) continue
    present.add(city.toLowerCase())
    // Deduped by lower-cased name so three Mackay sessions add one option, and
    // a row saved as "mackay" does not sit beside "Mackay" as a second choice.
    if (!CITY_RANK.has(city.toLowerCase()) && !extras.has(city.toLowerCase())) {
      extras.set(city.toLowerCase(), city)
    }
  }

  const known = includeEmpty
    ? [...CITY_ORDER]
    : CITY_ORDER.filter((city) => present.has(city.toLowerCase()))

  return [...known, ...[...extras.values()].sort((a, b) => a.localeCompare(b))]
}
