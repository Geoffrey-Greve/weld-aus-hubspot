/**
 * Slug rules for HubDB dynamic-page row paths.
 *
 * Kept in its own module (rather than inside backfill-hubdb-paths.ts) so it can
 * be unit-tested without executing that script's CLI. These strings become
 * public URLs and are effectively permanent once live, so they are covered by
 * src/test/hubdb-slugify.test.ts.
 */

// Stripped from the front of a person's name so paths read as /about/team/graham-hutt
// rather than /about/team/dr-graham-hutt. Longest forms first so "assoc prof"
// wins over "prof".
const HONORIFICS = [
  'associate professor',
  'assoc prof',
  'a/prof',
  'professor',
  'prof',
  'dr',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'sir',
  'dame',
]

export function slugify(input: string): string {
  let s = String(input ?? '')
    .normalize('NFKD')
    // Strip combining marks so "Renée" → "renee" rather than "rene".
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  // Drop a leading honorific, with or without a trailing dot. Matched as a whole
  // word followed by a space, so "Drew" and "Missy" are left alone.
  for (const h of HONORIFICS) {
    if (s.startsWith(`${h}. `)) {
      s = s.slice(h.length + 2)
      break
    }
    if (s.startsWith(`${h} `)) {
      s = s.slice(h.length + 1)
      break
    }
  }

  return s
    .replace(/['’]/g, '') // O'Bryan → obryan, not o-bryan
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Reads a HubDB cell as plain text, coping with SELECT/IMAGE object shapes. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.name === 'string') return o.name
    if (typeof o.label === 'string') return o.label
  }
  return ''
}

// ---------------------------------------------------------------------------
// Path planning
// ---------------------------------------------------------------------------

export type BackfillRow = {
  id: string | number
  /** Built-in row page path (hs_path). */
  path?: string | null
  /** Built-in row name (hs_name). */
  name?: string | null
  values?: Record<string, unknown>
}

export type PlannedPath = {
  id: string
  label: string
  from: string
  to: string
  setName: boolean
}

export type PathPlan = {
  planned: PlannedPath[]
  /** "label (path)" for rows left alone because they already have a path. */
  skipped: string[]
  /** Rows with nothing sluggable in the source column. */
  unslugged: string[]
  /** Source-column values that appear on more than one rewritten row. */
  duplicateLabels: { label: string; count: number }[]
}

/**
 * Short path suffix when the same person appears as more than one HubDB row
 * (e.g. CEO under Corporate + the same name under Board). Category wins for
 * Board so dual-role people get …-ceo and …-board rather than both resolving
 * to …-ceo from a shared job title.
 */
export function pathDisambiguator(values: Record<string, unknown> | undefined): string {
  const role = cellText(values?.role).toLowerCase()
  const category = slugify(cellText(values?.category))

  if (category === 'board') return 'board'
  if (/\bceo\b/.test(role) || /chief executive/.test(role)) return 'ceo'
  if (category) return category
  return ''
}

/**
 * Works out which rows need a page path and what it should be.
 *
 * Split out of backfill-hubdb-paths.ts and pure, so the collision rules can be
 * tested without a portal. Those rules are the fiddly part: hs_path is unique per
 * table, so a generated slug must not collide with a path retained by a row we are
 * NOT rewriting - including, under forceResync, rows we skip because their source
 * column is empty.
 *
 * When the same source-column label appears on more than one row being rewritten,
 * every colliding row gets a disambiguating suffix (role/category) - none keep the
 * bare name slug. That keeps dual-role people (CEO + Board) on distinct profile
 * URLs instead of minting a meaningless `-2`.
 */
export function planPaths(
  rows: BackfillRow[],
  opts: { sourceColumn: string; forceResync?: boolean },
): PathPlan {
  const { sourceColumn, forceResync = false } = opts

  type Candidate = {
    id: string
    label: string
    existingPath: string
    base: string
    setName: boolean
    values?: Record<string, unknown>
  }
  const rewrite: Candidate[] = []
  const skipped: string[] = []
  const unslugged: string[] = []

  for (const row of rows) {
    const id = String(row.id)
    const existingPath = String(row.path ?? '').trim()
    const label = cellText(row.values?.[sourceColumn]).trim()
    const base = slugify(label)

    if (existingPath && !forceResync) {
      skipped.push(`${label || id} (${existingPath})`)
      continue
    }
    if (!base) {
      unslugged.push(`${id}${existingPath ? ` (keeps ${existingPath})` : ''}`)
      continue
    }
    rewrite.push({
      id,
      label,
      existingPath,
      base,
      setName: !String(row.name ?? '').trim(),
      values: row.values,
    })
  }

  // Reserve paths held by every row we are not rewriting.
  const rewriteIds = new Set(rewrite.map((c) => c.id))
  const taken = new Set<string>()
  for (const row of rows) {
    if (rewriteIds.has(String(row.id))) continue
    const p = String(row.path ?? '').trim()
    if (p) taken.add(p)
  }

  const labelCounts = new Map<string, number>()
  for (const c of rewrite) {
    labelCounts.set(c.label, (labelCounts.get(c.label) ?? 0) + 1)
  }

  const planned: PlannedPath[] = []

  for (const c of rewrite) {
    const isDuplicate = (labelCounts.get(c.label) ?? 0) > 1
    const suffix = isDuplicate ? pathDisambiguator(c.values) : ''
    // Dual-role people: every colliding row gets a suffix - none keep the bare name.
    const preferred = suffix ? `${c.base}-${suffix}` : c.base

    // Same preferred stem already taken (identical role/category, or bare name vs a
    // reserved path) → -2, -3… on that stem.
    let candidate = preferred
    let n = 1
    while (taken.has(candidate)) {
      n += 1
      candidate = `${preferred}-${n}`
    }
    taken.add(candidate)
    planned.push({
      id: c.id,
      label: c.label || c.id,
      from: c.existingPath,
      to: candidate,
      setName: c.setName,
    })
  }

  return {
    planned,
    skipped,
    unslugged,
    duplicateLabels: [...labelCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([label, count]) => ({ label, count })),
  }
}
