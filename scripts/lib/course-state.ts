/**
 * City → state mapping for the `courses` HubDB table.
 *
 * `state` is a real HubDB column so Weld Aus can schedule a session anywhere
 * (Mackay, Geelong, Bunbury) and have it filter correctly without a code
 * change. This map only exists to seed that column for rows that predate it,
 * and as the HubL fallback while the column is still blank - it is NOT the
 * source of truth, and a city missing from it is a row for someone to set the
 * state on by hand, not a bug to patch here.
 */

export const STATE_OPTIONS = [
  'NSW',
  'VIC',
  'QLD',
  'WA',
  'SA',
  'TAS',
  'NT',
  'ACT',
  'National',
] as const

export type StateOption = (typeof STATE_OPTIONS)[number]

/** Cities the theme has shipped with. Keys are compared case-insensitively. */
export const CITY_STATE: Record<string, StateOption> = {
  sydney: 'NSW',
  newcastle: 'NSW',
  wollongong: 'NSW',
  melbourne: 'VIC',
  geelong: 'VIC',
  brisbane: 'QLD',
  townsville: 'QLD',
  mackay: 'QLD',
  maryborough: 'QLD',
  cairns: 'QLD',
  gladstone: 'QLD',
  perth: 'WA',
  bunbury: 'WA',
  adelaide: 'SA',
  whyalla: 'SA',
  hobart: 'TAS',
  launceston: 'TAS',
  darwin: 'NT',
  canberra: 'ACT',
  // Not a place - an online session is available to the whole country.
  online: 'National',
}

/** The state for a city, or null when the city is one we don't know. */
export function stateForCity(city: string | undefined): StateOption | null {
  return CITY_STATE[(city || '').trim().toLowerCase()] ?? null
}

// ---------------------------------------------------------------------------
// Backfill planning (pure, so scripts/backfill-course-state.ts stays thin)
// ---------------------------------------------------------------------------

export interface StateRow {
  id: string
  name?: string
  values?: Record<string, any>
}

export interface PlannedStateUpdate {
  id: string
  label: string
  city: string
  from: string
  to: StateOption
}

export interface StatePlan {
  planned: PlannedStateUpdate[]
  /** Rows whose city is not in CITY_STATE - a human has to set these. */
  unknownCities: { label: string; city: string }[]
  /** Rows with no city at all. */
  cityless: string[]
  /** Rows already carrying a state (skipped unless --force). */
  untouched: number
}

/** Reads a HubDB SELECT value, which comes back as `{ name, id }` or a string. */
function selectName(value: any): string {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  return String(value.name ?? '').trim()
}

export function planCourseState(
  rows: StateRow[],
  { force = false }: { force?: boolean } = {}
): StatePlan {
  const planned: PlannedStateUpdate[] = []
  const unknownCities: { label: string; city: string }[] = []
  const cityless: string[] = []
  let untouched = 0

  for (const row of rows) {
    const values = row.values ?? {}
    const label = String(values.course_name ?? row.name ?? row.id)
    const city = selectName(values.city)
    const current = selectName(values.state)

    if (current && !force) {
      untouched += 1
      continue
    }

    if (!city) {
      cityless.push(label)
      continue
    }

    const state = stateForCity(city)
    if (!state) {
      unknownCities.push({ label, city })
      continue
    }

    if (state === current) {
      untouched += 1
      continue
    }

    planned.push({ id: row.id, label, city, from: current, to: state })
  }

  return { planned, unknownCities, cityless, untouched }
}

// ---------------------------------------------------------------------------
// HubDB SELECT encoding
// ---------------------------------------------------------------------------

export interface HubDbOption {
  id?: number | string
  name?: string
  label?: string
}

export interface HubDbSelectColumn {
  name?: string
  options?: HubDbOption[]
}

/**
 * A HubDB SELECT cell is written as the option object, not as its name - the
 * API rejects a bare string with "was of type STRING, but we're expecting MAP".
 * Returns null when the column has no matching option, which means the portal's
 * schema is behind `hubdb/courses.json` and needs a seed.
 */
export function encodeStateOption(
  column: HubDbSelectColumn | undefined,
  state: string
): { id?: number | string; name: string; type: 'option' } | null {
  const match = (column?.options ?? []).find(
    (o) => o.name === state || o.label === state
  )
  if (!match) return null
  return { id: match.id, name: String(match.name ?? state), type: 'option' }
}
