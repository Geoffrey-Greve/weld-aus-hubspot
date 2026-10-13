/**
 * Fills the `state` column on the `courses` HubDB table (Courses - Timetable &
 * Locations) from each row's `city`.
 *
 * Why the column exists
 * ---------------------
 * The member dashboard's geo-localised course tile used to map city → state in
 * HubL against a hard-coded list, so a session in a city nobody had coded for
 * (Mackay, say) fell through to "National" and never surfaced for a member
 * filtering by QLD. `state` is now a HubDB column: Weld Aus picks the state
 * when they add the session, and the theme reads it. This script is the
 * one-off catch-up for rows created before the column existed.
 *
 * Safety - additive by default
 * ----------------------------
 *   • Only blank `state` values are filled. A row someone has already set keeps
 *     its value, so re-runs are no-ops.
 *   • Only `values.state` is sent. The row PATCH is a partial update, so no
 *     other column can be touched.
 *   • A city the map doesn't know is reported, never guessed - set those by
 *     hand in HubDB.
 *   • It never creates or deletes rows.
 *   • `--dry-run` prints the exact diff and writes nothing.
 *   • `--force` opts into overwriting a state that is already set (needed if a
 *     city was mis-tagged) - always preview it with `--dry-run` first.
 *   • No credential fallback between portals: reaching production means typing
 *     `--env=production`.
 *
 * Usage:
 *   pnpm backfill:course-state -- --env=production --dry-run
 *   pnpm backfill:course-state -- --env=production
 *
 * Flags:
 *   --env=staging|production   which portal (default staging)
 *   --table=<name>             HubDB table (default "courses")
 *   --dry-run                  report only, write nothing
 *   --no-publish               leave the table in draft after writing
 *   --force                    also rewrite rows that already have a state
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 */
import { Client } from '@hubspot/api-client'
import { encodeStateOption, planCourseState, type StateRow } from './lib/course-state'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'

// pnpm may forward a literal "--" when invoked as `pnpm backfill:course-state -- --env=…`
const args = process.argv.slice(2).filter((a) => a !== '--')

function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  pnpm backfill:course-state -- --env=production --dry-run
  pnpm backfill:course-state -- --env=production

Flags:
  --env=staging|production   portal (default: staging)
  --table=<name>             HubDB table (default: courses)
  --dry-run                  report only, write nothing
  --no-publish               leave the table in draft after writing
  --force                    also rewrite rows that already have a state

Credentials: CLI personal access key (hs auth / hubspot.config.yml), or
  HUBSPOT_ACCESS_TOKEN_PRODUCTION / HUBSPOT_ACCESS_TOKEN_STAGING.
  No fallback between portals: production requires --env=production.`)
  process.exit(exitCode)
}

if (args.includes('--help') || args.includes('-h')) printUsage(0)

const envRaw = flag('env') ?? 'staging'
const tableName = flag('table') ?? 'courses'
const dryRun = args.includes('--dry-run')
const noPublish = args.includes('--no-publish')
const force = args.includes('--force')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(
    `[backfill-course-state] Unknown --env="${envRaw}". Must be staging or production.\n`
  )
  printUsage()
}
// Narrowed here rather than at each use: TS does not carry the null check into
// the async main() that consumes it.
const env: HubSpotEnv = envParsed

let tablesApi: any
let rowsApi: any

/**
 * The HubSpot SDK stuffs the response headers into `err.message`, which turns
 * one bad row into a screenful. Pull out the API's own message when it's there.
 */
function apiMessage(err: any): string {
  const raw = err?.message ?? String(err)
  const body = /Body: (\{.*?\})\n/s.exec(raw)?.[1]
  if (body) {
    try {
      const parsed = JSON.parse(body)
      if (parsed?.message) return String(parsed.message)
    } catch {
      // fall through to the trimmed raw message
    }
  }
  return raw.split('\n').slice(0, 2).join(' ').trim()
}

async function readAllDraftRows(table: string): Promise<StateRow[]> {
  const rows: StateRow[] = []
  let after: string | undefined
  while (true) {
    const page: any = await rowsApi.readDraftTableRows(
      table,
      undefined,
      after,
      1000,
      undefined,
      undefined,
      undefined
    )
    for (const row of page.results ?? []) rows.push(row)
    after = page.paging?.next?.after
    if (!after) break
  }
  return rows
}

async function main(): Promise<void> {
  // `--env` names one portal and there is no fallback between them: an
  // unauthenticated staging portal is a hard error, not a write to the live
  // site. This script mutates rows, so that matters here more than most.
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[backfill-course-state]'
  })
  const client = new Client({ accessToken: auth.accessToken })
  tablesApi = client.cms.hubdb.tablesApi
  rowsApi = client.cms.hubdb.rowsApi

  console.log(
    `[backfill-course-state] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `table=${tableName} dryRun=${dryRun} force=${force}`
  )
  console.log('[backfill-course-state] writes values.state only - no other column is sent\n')

  const table: any = await tablesApi.getDraftTableDetailsById(tableName, undefined, true)
  if (!table) throw new Error(`table "${tableName}" not found in ${env}`)

  const columnNames = new Set((table.columns ?? []).map((c: any) => c.name))
  const missing = ['city', 'state'].filter((c) => !columnNames.has(c))
  if (missing.length) {
    console.error(
      `[backfill-course-state] "${tableName}" is missing column(s): ${missing.join(', ')}.\n` +
        `  Run \`pnpm seed:hubdb -- --env=${env}\` first (see CLAUDE.md § 11.4).`
    )
    process.exit(1)
  }

  // A SELECT cell is written as its option object, never as a bare string -
  // the API rejects that with "was of type STRING, but we're expecting MAP" -
  // so the options have to come from the live column, not from our own list.
  const stateColumn = (table.columns ?? []).find((c: any) => c.name === 'state')

  const rows = await readAllDraftRows(tableName)
  console.log(`  read ${rows.length} draft row(s)\n`)

  const { planned, unknownCities, cityless, untouched } = planCourseState(rows, { force })

  if (cityless.length) {
    console.warn(
      `  ⚠️  ${cityless.length} row(s) have no city and were left alone: ` +
        `${cityless.slice(0, 8).join(', ')}${cityless.length > 8 ? ', …' : ''}\n`
    )
  }

  if (unknownCities.length) {
    const byCity = [...new Set(unknownCities.map((u) => u.city))]
    console.warn(
      `  ⚠️  ${unknownCities.length} row(s) are in a city this script doesn't map ` +
        `(${byCity.join(', ')}) - set their state by hand in HubDB, or add the city to ` +
        `scripts/lib/course-state.ts if it's one we'll see often:`
    )
    for (const u of unknownCities.slice(0, 10)) console.warn(`    · ${u.label} (${u.city})`)
    if (unknownCities.length > 10) console.warn(`    · … and ${unknownCities.length - 10} more`)
    console.log()
  }

  if (untouched) console.log(`  ${untouched} row(s) already have a state - skipped\n`)

  if (planned.length === 0) {
    console.log('  nothing to do - every mappable row already has its state ✓')
    return
  }

  // Resolve every option up front: a state the portal's column doesn't offer
  // means the schema is behind the JSON, and that's a seed to run, not 19
  // identical row failures to read through.
  const encoded = new Map<string, ReturnType<typeof encodeStateOption>>()
  const unknownStates = new Set<string>()
  for (const p of planned) {
    if (encoded.has(p.to)) continue
    const option = encodeStateOption(stateColumn, p.to)
    if (!option) unknownStates.add(p.to)
    encoded.set(p.to, option)
  }

  if (unknownStates.size) {
    // Deliberately not "run pnpm seed:hubdb": on a column that already exists,
    // the seed adds columns, never options - it preserves the portal's own so
    // an option Weld Aus added in the UI survives. Adding one is a UI job.
    console.error(
      `[backfill-course-state] the "state" column in ${env} has no option for: ` +
        `${[...unknownStates].join(', ')}.\n` +
        `  Add the missing option(s) in HubDB (Marketing → HubDB → ` +
        `${table.label ?? tableName} → Edit the "State" column → Add option), ` +
        `publish the table, then re-run this.\n` +
        `  \`pnpm seed:hubdb\` will not do it: on an existing column it adds ` +
        `columns, not options (see CLAUDE.md § 11.4).`
    )
    process.exit(1)
  }

  console.log(`  ${dryRun ? '[dry-run] would update' : 'updating'} ${planned.length} row(s):`)
  for (const p of planned) {
    console.log(`    ${p.label} (${p.city})  state ${p.from || '(blank)'} → ${p.to}`)
  }
  console.log()

  if (dryRun) {
    console.log('  [dry-run] no changes written')
    return
  }

  let updated = 0
  const failures: { label: string; reason: string }[] = []
  for (const p of planned) {
    try {
      // PATCH semantics: only the keys sent are written, so every other column
      // on the row is left exactly as it is.
      await rowsApi.updateDraftTableRow(tableName, p.id, {
        values: { state: encoded.get(p.to) }
      })
      updated += 1
    } catch (err: any) {
      failures.push({ label: p.label, reason: apiMessage(err) })
    }
  }
  console.log(`  updated ${updated} row(s)`)

  if (failures.length) {
    console.error(`\n  ✗ ${failures.length} row(s) failed:`)
    for (const f of failures) console.error(`    · ${f.label}: ${f.reason}`)
    console.error('\n  Table left in draft. Fix the above and re-run - rows that')
    console.error('  succeeded already have their state and will be skipped.')
    process.exit(1)
  }

  if (noPublish) {
    console.log('  --no-publish set; table left in draft (changes are not live yet)')
  } else {
    await tablesApi.publishDraftTable(tableName, undefined)
    console.log(`  published ✓ ${tableName}`)
  }
}

main().catch((err: any) => {
  console.error('\n[backfill-course-state] failed:', err?.message ?? err)
  if (err?.body) console.error(JSON.stringify(err.body, null, 2))
  process.exit(1)
})
