/**
 * Additive reconciliation of SELECT / MULTISELECT options on a HubDB column.
 *
 * Why this exists
 * ---------------
 * seed-hubdb.ts only ever ADDED missing COLUMNS to an existing table. For a
 * column the portal already had it pushed the portal's own definition straight
 * back, so adding an option to `hubdb/*.json` changed nothing on the live
 * table and said nothing about it either. That is why a session in Mackay
 * could not be recorded as being in Mackay: `courses.city` is a SELECT, the
 * schema file is the documented way to change it (CLAUDE.md §11.4), and the
 * one script that reads that file was silently dropping the change on the
 * floor. Staff left the column on "Brisbane" and typed the real town into the
 * course name instead (QA 86).
 *
 * Rules - the same posture the column diff already takes:
 *   • An option in the JSON the portal does not hold is APPENDED. It is sent
 *     without an id; HubSpot mints one.
 *   • An option the portal holds is passed through UNTOUCHED, id included.
 *     Row cells store the option id, so re-sending an existing option without
 *     its id orphans every row already set to it.
 *   • An option the portal holds that the JSON does not is KEPT and reported,
 *     never deleted - identical to the rule for a column that only exists
 *     live. Deleting an option blanks the cells pointing at it.
 *   • Matching is by name, trimmed and case-insensitive: "mackay" added by
 *     hand in the portal UI is the same option as "Mackay" in the JSON, and
 *     appending a second one would split the timetable across two values that
 *     look identical on screen.
 */

export type HubDbOption = {
  id?: string | number
  name?: string
  label?: string
  type?: string
  [key: string]: unknown
}

export type OptionMerge = {
  /** The full option list to send, existing options first and unchanged. */
  options: HubDbOption[]
  /** Names appended from the JSON, in JSON order. */
  added: string[]
  /** Names the portal holds that the JSON does not - kept, reported only. */
  portalOnly: string[]
  /** True when `options` differs from what the portal already had. */
  changed: boolean
}

/** Option types HubDB stores as a fixed value list. */
const OPTION_COLUMN_TYPES = new Set(['SELECT', 'MULTISELECT'])

export function isOptionColumnType(type: unknown): boolean {
  return OPTION_COLUMN_TYPES.has(String(type ?? '').toUpperCase())
}

function optionKey(option: HubDbOption): string {
  const raw = option.name ?? option.label ?? ''
  return String(raw).trim().toLowerCase()
}

function optionLabel(option: HubDbOption): string {
  const raw = option.name ?? option.label ?? ''
  return String(raw).trim()
}

/**
 * Merges the JSON's option list into the portal's, additively.
 *
 * `portalOptions` is what the live column holds (each carrying its id);
 * `jsonOptions` is what `hubdb/<table>.json` declares.
 */
export function mergeColumnOptions(
  portalOptions: HubDbOption[] | undefined | null,
  jsonOptions: HubDbOption[] | undefined | null
): OptionMerge {
  const portal = (portalOptions ?? []).filter((o) => optionKey(o) !== '')
  const json = (jsonOptions ?? []).filter((o) => optionKey(o) !== '')

  const portalKeys = new Set(portal.map(optionKey))
  const jsonKeys = new Set(json.map(optionKey))

  const added: HubDbOption[] = []
  const addedNames: string[] = []
  const seen = new Set(portalKeys)

  for (const option of json) {
    const key = optionKey(option)
    // `seen` rather than `portalKeys` so a JSON file listing the same option
    // twice appends it once.
    if (seen.has(key)) continue
    seen.add(key)
    // Sent without an id on purpose - HubSpot mints one. Anything else the
    // JSON carries (type: "option") rides along.
    const { id: _ignoredId, ...rest } = option
    added.push({ ...rest, name: optionLabel(option) })
    addedNames.push(optionLabel(option))
  }

  const portalOnly = portal.filter((o) => !jsonKeys.has(optionKey(o))).map(optionLabel)

  return {
    options: [...portal, ...added],
    added: addedNames,
    portalOnly,
    changed: added.length > 0
  }
}
