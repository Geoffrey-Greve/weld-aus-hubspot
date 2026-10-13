/**
 * Backfills the built-in HubDB row **page path** (`hs_path`) - and the built-in
 * row **name** (`hs_name`) when blank - for tables that drive dynamic pages.
 *
 * Why this exists
 * ---------------
 * HubSpot routes `/<parent-page>/<segment>` by matching `<segment>` against a
 * row's `hs_path`, and only then hands the template `dynamic_page_hubdb_row`.
 * A row with a blank path has no child URL at all, so its detail page 404s no
 * matter what the template does - and listing grids that link via `hs_path`
 * silently render unlinked cards. Rows added through the HubSpot UI or a CSV
 * import get no path, which is exactly how that happens.
 *
 * `dynamicPageUrlPattern` in `hubdb/*.json` does NOT change this: it is never
 * sent to the API (see scripts/seed-hubdb.ts), and HubSpot always uses hs_path.
 *
 * Safety - this script is deliberately additive
 * ---------------------------------------------
 *   • It writes ONLY the row-level `path` and `name` fields. It never sends
 *     `values`, so no column content can be altered.
 *   • It skips any row that already has a path. Re-running is a no-op.
 *   • It never deletes or purges rows.
 *   • `--dry-run` prints exactly what would change and writes nothing.
 *
 * Usage:
 *   pnpm backfill:paths --env=production --table=team_and_board --dry-run
 *   pnpm backfill:paths --env=production --table=team_and_board
 *   pnpm backfill:paths --env=staging --table=events --source-column=slug
 *
 * Flags:
 *   --env=staging|production   which portal (default staging). staging=443253065, production=441838610
 *   --table=<name>             HubDB table name (required)
 *   --source-column=<name>     column to derive the slug from (default "name")
 *   --dry-run                  report only, write nothing
 *   --no-publish               leave the table in draft after writing
 *   --force-resync             ALSO rewrite rows that already have a path.
 *                              This CHANGES LIVE URLs and breaks inbound links -
 *                              only use on a table that is not yet public, and
 *                              add redirects if it is.
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 */
import { Client } from '@hubspot/api-client'
import { planPaths } from './lib/hubdb-slug'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

// pnpm may forward a literal "--" when invoked as `pnpm backfill:paths -- --env=…`
const args = process.argv.slice(2).filter((a) => a !== '--')

function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  pnpm backfill:paths -- --env=production --table=team_and_board --dry-run
  pnpm backfill:paths -- --env=production --table=team_and_board
  pnpm backfill:paths -- --env=staging --table=events --source-column=slug

Flags:
  --env=staging|production   portal (default: staging). No fallback between portals.
  --table=<name>             HubDB table name (required)
  --source-column=<name>     column to derive the slug from (default: name)
  --dry-run                  report only, write nothing
  --no-publish               leave the table in draft after writing
  --force-resync             also rewrite rows that already have a path (changes live URLs)

Credentials: CLI personal access key (hs auth / hubspot.config.yml), or
  HUBSPOT_ACCESS_TOKEN_PRODUCTION / HUBSPOT_ACCESS_TOKEN_STAGING.`)
  process.exit(exitCode)
}

/** Reads a required flag, exiting with a usage message when it is missing. */
function requireFlag(name: string, example: string): string {
  const value = flag(name)
  if (!value) {
    console.error(`[backfill-paths] --${name}=<value> is required, e.g. --${name}=${example}\n`)
    printUsage()
  }
  return value
}

if (args.includes('--help') || args.includes('-h')) {
  printUsage(0)
}

const envRaw = flag('env') ?? 'staging'
const sourceColumn = flag('source-column') ?? 'name'
const dryRun = args.includes('--dry-run')
const noPublish = args.includes('--no-publish')
const forceResync = args.includes('--force-resync')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(`[backfill-paths] Unknown --env="${envRaw}". Must be staging or production.\n`)
  printUsage()
}
// Narrowed here rather than relied on at each use: TS does not carry the
// null check into the async main() that consumes it.
const env: HubSpotEnv = envParsed

const tableName = requireFlag('table', 'team_and_board')

let tablesApi: any
let rowsApi: any

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readAllDraftRows(table: string): Promise<any[]> {
  const rows: any[] = []
  let after: string | undefined
  // The draft endpoint paginates; loop until we've collected everything.
  while (true) {
    const page: any = await rowsApi.readDraftTableRows(
      table,
      undefined,
      after,
      1000,
      undefined,
      undefined,
      undefined,
    )
    for (const row of page.results ?? []) rows.push(row)
    after = page.paging?.next?.after
    if (!after) break
  }
  return rows
}

async function main(): Promise<void> {
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[backfill-paths]',
  })
  const client = new Client({ accessToken: auth.accessToken })
  tablesApi = client.cms.hubdb.tablesApi
  rowsApi = client.cms.hubdb.rowsApi

  console.log(
    `[backfill-paths] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `table=${tableName} source-column=${sourceColumn} ` +
      `dryRun=${dryRun} forceResync=${forceResync}`,
  )
  console.log('[backfill-paths] writes row path/name only - column values are never touched\n')

  const table: any = await tablesApi.getDraftTableDetailsById(tableName, undefined, true)
  if (!table) throw new Error(`table "${tableName}" not found in ${env}`)

  if (!table.useForPages) {
    console.warn(
      `  ⚠️  "${tableName}" does not have dynamic pages enabled. Paths will be stored but ` +
        `HubSpot will not serve detail URLs until you turn that on and publish the table.`,
    )
  }

  const hasSourceColumn = (table.columns ?? []).some((c: any) => c.name === sourceColumn)
  if (!hasSourceColumn) {
    console.error(
      `[backfill-paths] column "${sourceColumn}" does not exist on "${tableName}". ` +
        `Available: ${(table.columns ?? []).map((c: any) => c.name).join(', ')}`,
    )
    process.exit(1)
  }

  const rows = await readAllDraftRows(tableName)
  console.log(`  read ${rows.length} draft row(s)\n`)

  const { planned, skipped, unslugged, duplicateLabels } = planPaths(rows, {
    sourceColumn,
    forceResync,
  })

  if (skipped.length) {
    console.log(`  skipping ${skipped.length} row(s) that already have a path:`)
    for (const s of skipped.slice(0, 10)) console.log(`    · ${s}`)
    if (skipped.length > 10) console.log(`    · … and ${skipped.length - 10} more`)
    console.log()
  }

  if (unslugged.length) {
    console.warn(
      `  ⚠️  ${unslugged.length} row(s) have an empty or unsluggable "${sourceColumn}" and were ` +
        `left alone: ${unslugged.join(', ')}`,
    )
    console.log()
  }

  if (duplicateLabels.length) {
    console.warn(
      `  ⚠️  duplicate "${sourceColumn}" values - each row is a separate page, so these get ` +
        `separate URLs:`,
    )
    for (const d of duplicateLabels) console.warn(`    · ${d.label} × ${d.count}`)
    console.log()
  }

  if (planned.length === 0) {
    console.log('  nothing to do - every row already has a page path ✓')
    return
  }

  console.log(`  ${dryRun ? '[dry-run] would set' : 'setting'} ${planned.length} path(s):`)
  for (const p of planned) {
    console.log(
      `    ${p.label.padEnd(32).slice(0, 32)} ${p.from || '(blank)'} → ${p.to}` +
        (p.setName ? '   +name' : ''),
    )
  }
  console.log()

  // Pre-flight: prove the plan is internally consistent before touching anything.
  // A duplicate here would fail part-way through and leave the draft half-written.
  const clashes = new Map<string, string[]>()
  for (const p of planned) {
    clashes.set(p.to, [...(clashes.get(p.to) ?? []), p.label])
  }
  const collisions = [...clashes.entries()].filter(([, labels]) => labels.length > 1)
  if (collisions.length) {
    console.error('  ✗ refusing to write - the plan contains duplicate paths:')
    for (const [path, labels] of collisions) console.error(`    · ${path} ← ${labels.join(', ')}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log('  [dry-run] no changes written')
    return
  }

  let updated = 0
  const failures: { label: string; reason: string }[] = []
  for (const p of planned) {
    // Only `path` (and `name` when blank) - deliberately no `values` key, so
    // there is no way for this call to modify column content.
    const payload: Record<string, unknown> = { path: p.to }
    if (p.setName) payload.name = p.label
    try {
      // Signature is (tableIdOrName, rowId, payload) - the table comes first.
      await rowsApi.updateDraftTableRow(tableName, p.id, payload)
      updated += 1
    } catch (err: any) {
      // Carry on rather than aborting: a single bad row shouldn't strand the rest
      // in draft, and the summary below says exactly what still needs doing.
      failures.push({ label: p.label, reason: err?.message ?? String(err) })
    }
  }
  console.log(`  updated ${updated} row(s)`)

  if (failures.length) {
    console.error(`\n  ✗ ${failures.length} row(s) failed:`)
    for (const f of failures) console.error(`    · ${f.label}: ${f.reason}`)
    console.error('\n  Table left in draft. Fix the above and re-run - rows that')
    console.error('  succeeded already have a path and will be skipped.')
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
  console.error('\n[backfill-paths] failed:', err?.message ?? err)
  if (err?.body) console.error(JSON.stringify(err.body, null, 2))
  process.exit(1)
})
