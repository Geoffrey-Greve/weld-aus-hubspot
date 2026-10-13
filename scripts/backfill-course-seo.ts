/**
 * Backfills SEO metadata on the `courses` HubDB table (Courses - Timetable &
 * Locations) from values the rows already carry. No new columns required.
 *
 * What it writes
 * --------------
 *   • **Page title** - the built-in row name (`hs_name`), what the HubDB UI
 *     calls "Page title" once dynamic pages are on. Derived from `course_name`;
 *     rows sharing a course name get a `- <city> (<date>)` suffix so sessions
 *     stay distinguishable in the row list.
 *   • **SEO page title** - the `page_title` column that `course-router.html`
 *     renders as `<title>`. `"<course name> Course | Weld Australia"`, kept
 *     inside the 60-character SERP budget (see scripts/lib/course-seo.ts).
 *   • **OG / social share image** - `og_image`, copied verbatim from the course
 *     `photo`.
 *
 * Safety - additive by default
 * ----------------------------
 *   • Only blank fields are filled. A row that already has a title or an
 *     og_image keeps it, so hand-tuned SEO survives and re-runs are no-ops.
 *   • Only `name` and the two SEO `values` keys are sent. The row PATCH is a
 *     partial update, so no other column can be touched - pricing, dates,
 *     registration URLs and `hs_path` are never in the payload.
 *   • It never creates or deletes rows.
 *   • `--dry-run` prints the exact diff and writes nothing.
 *   • `--force` opts into overwriting existing values (needed after a course
 *     rename) - always preview it with `--dry-run` first.
 *   • No staging→production credential fallback. `--env=staging` with an
 *     unauthenticated staging portal errors out rather than quietly writing to
 *     production; reaching production means typing `--env=production`.
 *
 * Usage:
 *   pnpm backfill:course-seo -- --env=production --dry-run
 *   pnpm backfill:course-seo -- --env=production
 *   pnpm backfill:course-seo -- --env=staging --only=og_image
 *
 * Flags:
 *   --env=staging|production   which portal (default staging). staging=443253065, production=441838610
 *   --table=<name>             HubDB table (default "courses")
 *   --only=a,b                 subset of: page_title, seo_title, og_image
 *                              (page_title = the built-in row name)
 *   --dry-run                  report only, write nothing
 *   --no-publish               leave the table in draft after writing
 *   --force                    also rewrite fields that already have a value
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 */
import { Client } from '@hubspot/api-client'
import { planCourseSeo, TITLE_MAX_LENGTH, type SeoRow } from './lib/course-seo'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

// pnpm may forward a literal "--" when invoked as `pnpm backfill:course-seo -- --env=…`
const args = process.argv.slice(2).filter((a) => a !== '--')

function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

const FIELD_KEYS = ['page_title', 'seo_title', 'og_image'] as const
type FieldKey = (typeof FIELD_KEYS)[number]

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  pnpm backfill:course-seo -- --env=production --dry-run
  pnpm backfill:course-seo -- --env=production
  pnpm backfill:course-seo -- --env=staging --only=og_image

Flags:
  --env=staging|production   portal (default: staging). No fallback between portals.
  --table=<name>             HubDB table (default: courses)
  --only=a,b                 subset of: ${FIELD_KEYS.join(', ')}
                             (page_title = the built-in row name / "Page title")
  --dry-run                  report only, write nothing
  --no-publish               leave the table in draft after writing
  --force                    also rewrite fields that already have a value

Credentials: CLI personal access key (hs auth / hubspot.config.yml), or
  HUBSPOT_ACCESS_TOKEN_PRODUCTION / HUBSPOT_ACCESS_TOKEN_STAGING.
  No staging->production fallback: production requires --env=production.`)
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
  console.error(`[backfill-course-seo] Unknown --env="${envRaw}". Must be staging or production.\n`)
  printUsage()
}
// Narrowed here rather than relied on at each use: TS does not carry the
// null check into the async main() that consumes it.
const env: HubSpotEnv = envParsed

const onlyRaw = flag('only')
const only = onlyRaw
  ? onlyRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null

if (only) {
  const unknown = only.filter((f) => !FIELD_KEYS.includes(f as FieldKey))
  if (unknown.length) {
    console.error(
      `[backfill-course-seo] Unknown --only field(s): ${unknown.join(', ')}. ` +
        `Valid: ${FIELD_KEYS.join(', ')}\n`
    )
    printUsage()
  }
}

const fields = {
  rowName: !only || only.includes('page_title'),
  pageTitle: !only || only.includes('seo_title'),
  ogImage: !only || only.includes('og_image')
}

let tablesApi: any
let rowsApi: any

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readAllDraftRows(table: string): Promise<SeoRow[]> {
  const rows: SeoRow[] = []
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
      undefined
    )
    for (const row of page.results ?? []) rows.push(row)
    after = page.paging?.next?.after
    if (!after) break
  }
  return rows
}

/** Trims a value for single-line console output. */
function short(value: string, width = 46): string {
  const v = value || '(blank)'
  return v.length > width ? `${v.slice(0, width - 1)}…` : v
}

async function main(): Promise<void> {
  // This script mutates and publishes, so touching production must mean typing
  // --env=production. That is now guaranteed by hubspot-auth itself: the
  // staging→production credential fallback it used to guard against is gone.
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[backfill-course-seo]'
  })
  const client = new Client({ accessToken: auth.accessToken })
  tablesApi = client.cms.hubdb.tablesApi
  rowsApi = client.cms.hubdb.rowsApi

  const active = Object.entries(fields)
    .filter(([, on]) => on)
    .map(([k]) => k)
  console.log(
    `[backfill-course-seo] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `table=${tableName} fields=${active.join(',')} dryRun=${dryRun} force=${force}`
  )
  console.log(
    '[backfill-course-seo] writes row name + page_title/og_image only - ' +
      'no other column is sent\n'
  )

  const table: any = await tablesApi.getDraftTableDetailsById(tableName, undefined, true)
  if (!table) throw new Error(`table "${tableName}" not found in ${env}`)

  const columnNames = new Set((table.columns ?? []).map((c: any) => c.name))
  const required = [
    'course_name',
    ...(fields.pageTitle ? ['page_title'] : []),
    ...(fields.ogImage ? ['og_image', 'photo'] : [])
  ]
  const missing = required.filter((c) => !columnNames.has(c))
  if (missing.length) {
    console.error(
      `[backfill-course-seo] "${tableName}" is missing column(s): ${missing.join(', ')}.\n` +
        `  Run \`pnpm seed:hubdb -- --env=${env}\` first (see CLAUDE.md § 11.4).`
    )
    process.exit(1)
  }

  const rows = await readAllDraftRows(tableName)
  console.log(`  read ${rows.length} draft row(s)\n`)

  const { planned, unnamed, untouched, longTitles, missingPhotos } = planCourseSeo(rows, {
    force,
    fields
  })

  if (unnamed.length) {
    console.warn(
      `  ⚠️  ${unnamed.length} row(s) have a blank course_name and were left alone: ` +
        `${unnamed.join(', ')}\n`
    )
  }

  if (missingPhotos.length) {
    const unique = [...new Set(missingPhotos)]
    console.warn(
      `  ⚠️  ${missingPhotos.length} row(s) have neither photo nor og_image - social ` +
        `shares fall back to the site default: ${unique.slice(0, 8).join(', ')}` +
        `${unique.length > 8 ? `, … and ${unique.length - 8} more` : ''}\n`
    )
  }

  if (longTitles.length) {
    console.warn(
      `  ⚠️  ${longTitles.length} SEO title(s) exceed ${TITLE_MAX_LENGTH} chars and will be ` +
        `truncated in search results - shorten the course name to fix:`
    )
    for (const t of longTitles) console.warn(`    · ${t.length} chars: ${t.title}`)
    console.log()
  }

  if (untouched) {
    console.log(`  ${untouched} row(s) already complete - skipped\n`)
  }

  if (planned.length === 0) {
    console.log('  nothing to do - every row already has its SEO metadata ✓')
    return
  }

  console.log(`  ${dryRun ? '[dry-run] would update' : 'updating'} ${planned.length} row(s):`)
  for (const p of planned) {
    console.log(`    ${p.label}`)
    if (p.rowName) {
      console.log(`      page title      ${short(p.rowName.from)} → ${p.rowName.to}`)
    }
    if (p.pageTitle) {
      console.log(`      seo page title  ${short(p.pageTitle.from)} → ${p.pageTitle.to}`)
    }
    if (p.ogImage) {
      console.log(`      og image        ${short(p.ogImage.from)} → ${short(p.ogImage.to.url)}`)
    }
  }
  console.log()

  if (dryRun) {
    console.log('  [dry-run] no changes written')
    return
  }

  let updated = 0
  const failures: { label: string; reason: string }[] = []
  for (const p of planned) {
    // PATCH semantics: only the keys sent are written, so omitting a column
    // leaves it untouched. Deliberately no `path` key - URLs are the
    // backfill:paths script's job.
    const values: Record<string, unknown> = {}
    if (p.pageTitle) values.page_title = p.pageTitle.to
    if (p.ogImage) values.og_image = p.ogImage.to

    const payload: Record<string, unknown> = {}
    if (p.rowName) payload.name = p.rowName.to
    if (Object.keys(values).length) payload.values = values

    try {
      // Signature is (tableIdOrName, rowId, payload) - the table comes first.
      await rowsApi.updateDraftTableRow(tableName, p.id, payload)
      updated += 1
    } catch (err: any) {
      // Carry on rather than aborting: one bad row shouldn't strand the rest in
      // draft, and the summary below says exactly what still needs doing.
      failures.push({ label: p.label, reason: err?.message ?? String(err) })
    }
  }
  console.log(`  updated ${updated} row(s)`)

  if (failures.length) {
    console.error(`\n  ✗ ${failures.length} row(s) failed:`)
    for (const f of failures) console.error(`    · ${f.label}: ${f.reason}`)
    console.error('\n  Table left in draft. Fix the above and re-run - rows that')
    console.error('  succeeded already have their values and will be skipped.')
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
  console.error('\n[backfill-course-seo] failed:', err?.message ?? err)
  if (err?.body) console.error(JSON.stringify(err.body, null, 2))
  process.exit(1)
})
