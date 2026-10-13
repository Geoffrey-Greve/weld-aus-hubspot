/**
 * Audits what the "Course modules" section on each course page can actually
 * sell, for one portal.
 *
 * The problem it solves
 * ---------------------
 * `course_modules` holds a name, an order and a booking URL. Every fact that
 * decides whether a buyer can book a module - its dates, its price, its ticket
 * types, whether it is even on sale - lives on the `courses` or `events` row
 * that booking URL names, joined by an id somebody typed by hand. When the join
 * fails the page degrades quietly and correctly: an unresolvable module keeps
 * its own booking link, and a module with no URL falls back to a `mailto:`.
 *
 * Degrading well is what made Ref 46 unreadable on production. 27 modules
 * across 9 course pages all rendered "Contact to book", which was reported as
 * the module booking feature never having been deployed - when the template was
 * current and it was the rows that were empty. Nothing in that state is fixed
 * by a deploy, and the sweep that found it was 12 pages read by hand.
 *
 * READ-ONLY. No write path, no publish. Which session a module should book is
 * an editorial call, never a script's.
 *
 * Usage:
 *   pnpm audit:course-modules -- --env=production
 *   pnpm audit:course-modules -- --env=production --course=iwe
 *   pnpm audit:course-modules -- --env=staging --draft
 *   pnpm audit:course-modules -- --env=production --json
 *   pnpm audit:course-modules -- --env=production --strict   # exit 1 on error/warn
 *
 * Flags:
 *   --env=staging|production   which portal (default staging). staging=443253065, production=441838610
 *   --course=<course_id>       audit one course's modules (repeatable, comma-separated)
 *   --draft                    audit draft rows instead of published (what's live)
 *   --include-hidden           also audit rows with Show on Website unticked
 *   --json                     machine-readable output for CI
 *   --strict                   exit 1 when any error or warning is found
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 */
import { Client } from '@hubspot/api-client'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'
import { type HubDbRow } from './lib/event-engine-audit'
import {
  auditCourseModules,
  type ModuleAuditResult,
  type ModuleFinding
} from './lib/course-module-audit'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

// pnpm may forward a literal "--" when invoked as `pnpm audit:course-modules -- --env=…`
const args = process.argv.slice(2).filter((a) => a !== '--')

function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  pnpm audit:course-modules -- --env=production
  pnpm audit:course-modules -- --env=production --course=iwe
  pnpm audit:course-modules -- --env=production --draft --include-hidden
  pnpm audit:course-modules -- --env=production --strict

Flags:
  --env=staging|production   portal (default: staging). No fallback between portals.
  --course=a,b               limit to these parent_course_id values
  --draft                    audit draft rows instead of published
  --include-hidden           also audit rows with Show on Website unticked
  --json                     machine-readable output
  --strict                   exit 1 when any error or warning is found

Read-only: this never writes or publishes a row.

Credentials: CLI personal access key (hs auth / hubspot.config.yml), or
  HUBSPOT_ACCESS_TOKEN_PRODUCTION / HUBSPOT_ACCESS_TOKEN_STAGING.`)
  process.exit(exitCode)
}

if (args.includes('--help') || args.includes('-h')) printUsage(0)

const envRaw = flag('env') ?? 'staging'
const draft = args.includes('--draft')
const includeHidden = args.includes('--include-hidden')
const asJson = args.includes('--json')
const strict = args.includes('--strict')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(
    `[audit-course-modules] Unknown --env="${envRaw}". Must be staging or production.\n`
  )
  printUsage()
}
// Narrowed here rather than relied on at each use: TS does not carry the null
// check into the async main() that consumes it.
const env: HubSpotEnv = envParsed

const courseFilter = (flag('course') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/**
 * The site each portal serves, for the cross-portal URL check.
 *
 * A module row copied from one portal to the other keeps its absolute URL, and
 * the ids ride the query string - so it resolves, prices and dates correctly
 * here while "Book this module" sends the buyer to the other site. That is
 * exactly the shape of the Dev fixtures added alongside this feature.
 */
const SITE_HOST: Record<HubSpotEnv, string> = {
  staging: 'weldaustralia.dev',
  production: 'weldaustralia.com.au'
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const SEVERITY_MARK = { error: '✗', warn: '⚠', info: 'ℹ' } as const

function log(...parts: unknown[]): void {
  if (!asJson) console.log(...parts)
}

function reportFindings(findings: ModuleFinding[], indent: string): void {
  for (const f of findings) {
    log(`${indent}${SEVERITY_MARK[f.severity]} ${f.label}`)
    log(`${indent}    ${f.code}: ${f.detail}`)
    log(`${indent}    fix: ${f.fix}`)
    log()
  }
}

// ---------------------------------------------------------------------------
// HubDB reads
// ---------------------------------------------------------------------------

/**
 * Reads every row of a table, published or draft.
 *
 * Published is the default because it is what visitors actually get: a fix
 * sitting unpublished in draft has not reached a single buyer yet.
 */
async function readAllRows(rowsApi: any, table: string): Promise<HubDbRow[]> {
  const rows: HubDbRow[] = []
  let after: string | undefined
  while (true) {
    const page: any = draft
      ? await rowsApi.readDraftTableRows(
          table,
          undefined,
          after,
          1000,
          undefined,
          undefined,
          undefined
        )
      : await rowsApi.getTableRows(table, undefined, after, 1000, undefined, undefined, undefined)
    for (const row of page.results ?? []) rows.push(row)
    after = page.paging?.next?.after
    if (!after) break
  }
  return rows
}

/**
 * The column names the portal's table actually has, or undefined when they
 * cannot be read.
 *
 * Undefined is NOT "the column is missing": a schema read that failed tells us
 * nothing about the schema, and reporting a missing column on that basis would
 * send somebody re-seeding a table that is already right.
 */
async function readColumnNames(tablesApi: any, table: string): Promise<string[] | undefined> {
  try {
    const details: any = draft
      ? await tablesApi.getDraftTableDetailsById(table, undefined, true)
      : await tablesApi.getTableDetails(table, undefined, true)
    const columns = details?.columns
    if (!Array.isArray(columns)) return undefined
    return columns.map((c: any) => String(c?.name ?? '')).filter(Boolean)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // No cross-portal fallback exists: --env names one portal and that is the only
  // one this reads. Reporting on the wrong portal's rows is its own bug, and
  // this audit exists because two portals were confused for one another.
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[audit-course-modules]',
    // --json puts a document on stdout, so the auth banner has to go to stderr
    // or the machine-readable mode is not machine-readable.
    logTo: asJson ? 'stderr' : 'stdout'
  })
  const client = new Client({ accessToken: auth.accessToken })
  const rowsApi = client.cms.hubdb.rowsApi
  const tablesApi = client.cms.hubdb.tablesApi

  log(
    `[audit-course-modules] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `rows=${draft ? 'draft' : 'published'} includeHidden=${includeHidden}`
  )
  log('[audit-course-modules] read-only - no row is written or published\n')

  let moduleRows: HubDbRow[]
  let courseRows: HubDbRow[]
  try {
    ;[moduleRows, courseRows] = await Promise.all([
      readAllRows(rowsApi, 'course_modules'),
      readAllRows(rowsApi, 'courses')
    ])
  } catch (err: any) {
    console.error(`[audit-course-modules] could not read rows - ${err?.message ?? String(err)}`)
    process.exit(1)
  }

  // A portal with no events table is a portal whose modules all resolve through
  // `courses`, which is a normal shape rather than a fault.
  let eventRows: HubDbRow[] = []
  try {
    eventRows = await readAllRows(rowsApi, 'events')
  } catch {
    log('  (no events table on this portal - resolving modules against courses only)\n')
  }

  const moduleColumns = await readColumnNames(tablesApi, 'course_modules')
  const courseColumns = await readColumnNames(tablesApi, 'courses')

  const result: ModuleAuditResult = auditCourseModules({
    moduleRows: courseFilter.length
      ? moduleRows.filter((row) =>
          courseFilter.includes(String((row.values ?? {}).parent_course_id ?? '').trim())
        )
      : moduleRows,
    courseRows,
    eventRows,
    moduleColumns,
    courseColumns,
    siteHost: SITE_HOST[env],
    includeHidden
  })

  log(
    `  ${moduleRows.length} module row(s) read, ${courseRows.length} course row(s), ` +
      `${eventRows.length} event row(s)`
  )
  log(
    `  ${result.summary.courses} course(s) with modules: ${result.summary.modules} module(s), ` +
      `${result.summary.resolved} resolve to a session, ${result.summary.selectable} bookable online\n`
  )

  const tableFindings = result.findings.filter((f) => f.scope === 'table')
  if (tableFindings.length) reportFindings(tableFindings, '    ')

  for (const course of result.courses) {
    const courseFindings = result.findings.filter(
      (f) => f.scope !== 'table' && f.courseId === course.courseId
    )
    const bookable =
      course.selectable > 0 ? `${course.selectable} bookable online` : 'NONE bookable online'
    log(
      `  ${course.courseName}: ${course.modules} module(s), ${course.resolved} resolved, ${bookable} ` +
        `(engine-ready course rows: ${course.parentEngineReady}/${course.parentRows})`
    )
    if (!courseFindings.length) {
      log('    ✓ nothing to fix\n')
      continue
    }
    log()
    reportFindings(courseFindings, '    ')
  }

  const { errors, warnings, infos } = result.summary

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          env,
          portalId: auth.portalId,
          rows: draft ? 'draft' : 'published',
          includeHidden,
          totals: { errors, warnings, infos },
          summary: result.summary,
          courses: result.courses,
          findings: result.findings
        },
        null,
        2
      )
    )
  } else {
    log(`  ${errors} error(s), ${warnings} warning(s), ${infos} note(s)`)
    if (errors || warnings) {
      log()
      log('  Nothing here is fixed by a theme deploy - these are HubDB edits (and, for a')
      log('  missing column, a seed run). Re-run after editing; this reads published rows')
      log('  unless --draft.')
    }
  }

  if (strict && (errors || warnings)) process.exitCode = 1
}

main().catch((err) => {
  console.error(`[audit-course-modules] ${err?.message ?? String(err)}`)
  process.exit(1)
})
