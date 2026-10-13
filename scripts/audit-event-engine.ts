/**
 * Audits Event Engine wiring on the HubDB tables that carry `use_event_engine`
 * (Courses - Timetable & Locations, and Events).
 *
 * The problem it solves
 * ---------------------
 * `use_event_engine` is the editorial opt-in that routes a row's Register CTA at
 * the on-site checkout tunnel. Nothing infers it from `worker_event_id`, and
 * that is deliberate - a row can hold stale Worker ids after being routed back
 * to a legacy flow, and the ids alone must not re-enable self-service booking.
 *
 * The cost is that a forgotten tickbox is silent. The session still renders, the
 * CTA still works, and it sends buyers to the legacy flow while
 * `/checkout/?session_id=<row>` stays transactable for anyone with the link.
 * This reports those rows, and the mirror-image faults where the box IS ticked
 * but the row cannot complete a booking.
 *
 * READ-ONLY. It has no write path, does not publish, and never changes a row -
 * whether a session should use the Event Engine is an editorial call.
 *
 * Usage:
 *   pnpm audit:event-engine -- --env=production
 *   pnpm audit:event-engine -- --env=production --table=events
 *   pnpm audit:event-engine -- --env=production --draft --include-past
 *   pnpm audit:event-engine -- --env=production --strict     # exit 1 on error/warn
 *
 * Flags:
 *   --env=staging|production   which portal (default staging). staging=443253065, production=441838610
 *   --table=courses,events     tables to audit (default both)
 *   --draft                    audit draft rows instead of published (what's live)
 *   --include-past             also audit sessions that have already finished
 *   --json                     machine-readable output for CI
 *   --strict                   exit 1 when any error or warning is found
 *
 * Credentials: same as scripts/seed-hubdb.ts (env token, else CLI personal access key).
 */
import { Client } from '@hubspot/api-client'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'
import {
  ADAPTERS,
  auditRows,
  type AuditFinding,
  type AuditResult,
  type HubDbRow
} from './lib/event-engine-audit'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

// pnpm may forward a literal "--" when invoked as `pnpm audit:event-engine -- --env=…`
const args = process.argv.slice(2).filter((a) => a !== '--')

function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}

const TABLE_NAMES = Object.keys(ADAPTERS)

function printUsage(exitCode = 1): never {
  console.error(`Usage:
  pnpm audit:event-engine -- --env=production
  pnpm audit:event-engine -- --env=production --table=events
  pnpm audit:event-engine -- --env=production --draft --include-past
  pnpm audit:event-engine -- --env=production --strict

Flags:
  --env=staging|production   portal (default: staging). No fallback between portals.
  --table=a,b                tables to audit, from: ${TABLE_NAMES.join(', ')} (default: all)
  --draft                    audit draft rows instead of published
  --include-past             also audit sessions that have already finished
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
const includePast = args.includes('--include-past')
const asJson = args.includes('--json')
const strict = args.includes('--strict')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(`[audit-event-engine] Unknown --env="${envRaw}". Must be staging or production.\n`)
  printUsage()
}
// Narrowed here rather than relied on at each use: TS does not carry the
// null check into the async main() that consumes it.
const env: HubSpotEnv = envParsed

const tableRaw = flag('table')
const tables = tableRaw
  ? tableRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : TABLE_NAMES

const unknownTables = tables.filter((t) => !TABLE_NAMES.includes(t))
if (unknownTables.length) {
  console.error(
    `[audit-event-engine] Unknown --table value(s): ${unknownTables.join(', ')}. ` +
      `Valid: ${TABLE_NAMES.join(', ')}\n`
  )
  printUsage()
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const SEVERITY_MARK = { error: '✗', warn: '⚠', info: 'ℹ' } as const

function log(...parts: unknown[]): void {
  if (!asJson) console.log(...parts)
}

function reportFindings(findings: AuditFinding[]): void {
  for (const f of findings) {
    log(`    ${SEVERITY_MARK[f.severity]} ${f.label}`)
    log(`        ${f.code}: ${f.detail}`)
    log(`        fix: ${f.fix}`)
    log()
  }
}

// ---------------------------------------------------------------------------
// HubDB read
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
  // No cross-portal fallback exists any more: --env names one portal and that
  // is the only one this reads. An unauthenticated portal is a missing
  // `hs auth`, and reporting on the wrong portal's rows is its own bug.
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[audit-event-engine]',
    // --json puts a document on stdout, so the auth banner has to go to stderr
    // or the machine-readable mode is not machine-readable.
    logTo: asJson ? 'stderr' : 'stdout'
  })
  const client = new Client({ accessToken: auth.accessToken })
  const rowsApi = client.cms.hubdb.rowsApi

  log(
    `[audit-event-engine] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `rows=${draft ? 'draft' : 'published'} tables=${tables.join(',')} ` +
      `includePast=${includePast}`
  )
  log('[audit-event-engine] read-only - no row is written or published\n')

  const results: Record<string, AuditResult> = {}
  const today = new Date().toISOString().slice(0, 10)

  for (const table of tables) {
    // Already validated against TABLE_NAMES during arg parsing; this narrows it.
    const adapter = ADAPTERS[table]
    if (!adapter) continue
    let rows: HubDbRow[]
    try {
      rows = await readAllRows(rowsApi, table)
    } catch (err: any) {
      // One unreadable table must not strand the other. A table that does not
      // exist in this portal is a real finding for the operator, not a crash.
      console.error(`  ✗ ${table}: could not read rows - ${err?.message ?? String(err)}\n`)
      process.exitCode = 1
      continue
    }

    const result = auditRows(rows, adapter, { includePast, today })
    results[table] = result

    const { summary } = result
    log(
      `  ${table}: ${rows.length} row(s) read, ${summary.examined} audited, ` +
        `${summary.skipped} skipped (cancelled or past), ${summary.clean} clean`
    )

    if (result.findings.length === 0) {
      log('    ✓ no wiring faults found\n')
      continue
    }
    log()
    reportFindings(result.findings)
  }

  const all = Object.values(results)
  const errors = all.reduce((n, r) => n + r.summary.errors, 0)
  const warnings = all.reduce((n, r) => n + r.summary.warnings, 0)
  const infos = all.reduce((n, r) => n + r.summary.infos, 0)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          env,
          portalId: auth.portalId,
          rows: draft ? 'draft' : 'published',
          includePast,
          totals: { errors, warnings, infos },
          tables: results
        },
        null,
        2
      )
    )
  } else {
    log(`  ${errors} error(s), ${warnings} warning(s), ${infos} note(s)`)
    if (errors || warnings) {
      log()
      log('  Nothing here is fixed by a deploy - these are HubDB row edits.')
      log('  Re-run after editing; the audit reads published rows unless --draft.')
    }
  }

  if (strict && (errors || warnings)) process.exitCode = 1
}

main().catch((err) => {
  console.error(`[audit-event-engine] ${err?.message ?? String(err)}`)
  process.exit(1)
})
