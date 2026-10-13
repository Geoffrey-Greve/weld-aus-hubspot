/**
 * Audits whether a visitor who clicks a course card reaches that course, for
 * one portal.
 *
 * The problem it solves
 * ---------------------
 * A course is identified by two different columns and nothing keeps them in
 * step. The /courses directory dedupes sessions by `course_slug` and links each
 * card to `/courses/<slug>`; HubSpot serves that path from the one row whose
 * page path matches; the course page then derives its entire schedule, its
 * module list, its fees panel and its title from THAT row's `course_id`.
 *
 * When a slug spans more than one `course_id`, the page shows one of them and
 * every other session under that slug is unreachable from the URL its own card
 * points at. That is QA ref 86, symptom for symptom: a Mackay session
 * advertised as open, whose page renders a Maryborough schedule, the wrong
 * modules, and "no courses available".
 *
 * None of it is visible from a page. The card renders, the link works, the page
 * renders, and each row looks right in the HubDB UI - only the relationship
 * between them is wrong. Reading it off the site means opening every course
 * page and cross-checking it against the table by hand.
 *
 * READ-ONLY. No write path, no publish. Which sessions belong to which course
 * is an editorial call, never a script's.
 *
 * Usage:
 *   pnpm audit:course-routing -- --env=production
 *   pnpm audit:course-routing -- --env=production --slug=welding-supervisor
 *   pnpm audit:course-routing -- --env=production --draft
 *   pnpm audit:course-routing -- --env=production --json
 *   pnpm audit:course-routing -- --env=production --strict   # exit 1 on error/warn
 *
 * Flags:
 *   --env=staging|production   which portal (default staging). staging=443253065, production=441838610
 *   --slug=a,b                 limit to these course_slug values
 *   --draft                    audit draft rows instead of published (what's live)
 *   --json                     machine-readable output for CI
 *   --strict                   exit 1 when any error or warning is found
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 */
import { Client } from '@hubspot/api-client'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'
import { type HubDbRow } from './lib/event-engine-audit'
import {
  auditCourseRouting,
  type RoutingFinding,
  type RoutingResult
} from './lib/course-routing-audit'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

// pnpm may forward a literal "--" when invoked as `pnpm audit:course-routing -- --env=…`
const args = process.argv.slice(2).filter((a) => a !== '--')

function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  pnpm audit:course-routing -- --env=production
  pnpm audit:course-routing -- --env=production --slug=welding-supervisor
  pnpm audit:course-routing -- --env=production --draft
  pnpm audit:course-routing -- --env=production --strict

Flags:
  --env=staging|production   portal (default: staging). No fallback between portals.
  --slug=a,b                 limit to these course_slug values
  --draft                    audit draft rows instead of published
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
const asJson = args.includes('--json')
const strict = args.includes('--strict')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(
    `[audit-course-routing] Unknown --env="${envRaw}". Must be staging or production.\n`
  )
  printUsage()
}
const env: HubSpotEnv = envParsed

const slugFilter = (flag('slug') ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const SEVERITY_MARK = { error: '✗', warn: '⚠', info: 'ℹ' } as const

function log(...parts: unknown[]): void {
  if (!asJson) console.log(...parts)
}

function reportFinding(f: RoutingFinding, indent: string): void {
  log(`${indent}${SEVERITY_MARK[f.severity]} ${f.code}`)
  log(`${indent}    ${f.message}`)
  log(`${indent}    fix: ${f.remedy}`)
  log(`${indent}    rows: ${f.rowIds.join(', ')}`)
  log()
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // No cross-portal fallback exists: --env names one portal and that is the only
  // one this reads.
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[audit-course-routing]',
    // --json puts a document on stdout, so the auth banner goes to stderr or the
    // machine-readable mode is not machine-readable.
    logTo: asJson ? 'stderr' : 'stdout'
  })
  const client = new Client({ accessToken: auth.accessToken })
  const rowsApi = client.cms.hubdb.rowsApi

  log(
    `[audit-course-routing] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `rows=${draft ? 'draft' : 'published'}`
  )
  log('[audit-course-routing] read-only - no row is written or published\n')

  let courseRows: HubDbRow[]
  try {
    courseRows = await readAllRows(rowsApi, 'courses')
  } catch (err: any) {
    console.error(`[audit-course-routing] could not read courses - ${err?.message ?? String(err)}`)
    process.exit(1)
  }

  // The modules half of ref 86. A portal without the table is a portal that does
  // not list modules, which is a shape rather than a fault - but "we did not
  // look" must never read as "nothing found", so it is said on stderr (which
  // --json does not swallow) and carried in the document itself.
  let moduleRows: HubDbRow[] | undefined
  let moduleCheckSkipped: string | null = null
  try {
    moduleRows = await readAllRows(rowsApi, 'course_modules')
  } catch (err: any) {
    moduleCheckSkipped = err?.message ?? String(err)
    console.error(
      `[audit-course-routing] could not read course_modules - the orphaned-module check was ` +
        `NOT run (${moduleCheckSkipped})`
    )
    log('')
  }

  // The filter scopes the REPORT, not the rows. Filtering the rows would shrink
  // the set of known course ids and report every other course's modules as
  // orphaned - the universe stays whole, as it does in audit:course-modules.
  const result: RoutingResult = auditCourseRouting(courseRows, {
    moduleRows,
    slugs: slugFilter.length ? slugFilter : undefined
  })

  log(`  ${courseRows.length} course row(s) read, ${result.summary.slugs} slug(s) in scope`)
  log(
    `  ${result.summary.slugsWithUnreachableSessions} slug(s) advertise a session their own page ` +
      'cannot show'
  )
  // Coverage of the product-id join, up front: it decides whether the orphans
  // below are sixteen row edits somebody types or a backfill worth writing.
  const orphans = result.summary.orphanedModules
  if (orphans && orphans.rows > 0) {
    log(
      `  ${orphans.rows} orphaned module row(s), ${orphans.resolvable} of which this report ` +
        'names the parent for'
    )
  }
  log()

  for (const report of result.slugs) {
    if (report.findings.length === 0) continue
    log(
      `/courses/${report.slug}  (${report.rowCount} row(s), course_id: ` +
        `${report.courseIds.join(', ') || 'none'}${
          report.servedCourseId ? `, served: ${report.servedCourseId}` : ', served: unknown'
        })`
    )
    for (const finding of report.findings) reportFinding(finding, '  ')
  }

  // Findings that are about the table rather than one slug.
  const slugScoped = new Set(result.slugs.flatMap((s) => s.findings))
  const tableFindings = result.findings.filter((f) => !slugScoped.has(f))
  if (tableFindings.length > 0) {
    log('Table-wide')
    for (const finding of tableFindings) reportFinding(finding, '  ')
  }

  const errors = result.summary.errors
  const warnings = result.summary.warnings

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          env,
          portalId: auth.portalId,
          rows: draft ? 'draft' : 'published',
          slugFilter: slugFilter.length ? slugFilter : null,
          moduleCheckSkipped,
          totals: { errors, warnings },
          summary: result.summary,
          slugs: result.slugs,
          findings: result.findings
        },
        null,
        2
      )
    )
  } else {
    log(`  ${errors} error(s), ${warnings} warning(s)`)
    if (errors || warnings) {
      log()
      log('  Nothing here is fixed by a theme deploy - these are HubDB edits. The usual one is')
      log('  a session whose course_id does not match the rest of its course, which makes it')
      log('  unreachable from the page its own card links to. Re-run after editing; this reads')
      log('  published rows unless --draft.')
    }
  }

  if (strict && (errors || warnings)) process.exitCode = 1
}

main().catch((err) => {
  console.error(`[audit-course-routing] ${err?.message ?? String(err)}`)
  process.exit(1)
})
