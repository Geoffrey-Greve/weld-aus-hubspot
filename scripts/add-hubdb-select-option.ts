/**
 * Add an option to a HubDB SELECT column — safely.
 *
 * Ref 74c needs "Closed" on `courses.status`. Neither existing route is safe on its own:
 *
 *   `pnpm seed:hubdb` CANNOT do it. On an existing table it merges the PORTAL's columns
 *   verbatim (`seed-hubdb.ts`: `mergedColumns = [...existing.columns, ...toAdd]`) and only
 *   ever ADDS missing columns, so a changed `options` array in `hubdb/courses.json` is
 *   silently ignored — and it publishes the whole table anyway.
 *
 *   The HubSpot UI can do it, but drifts from `hubdb/*.json` (CLAUDE.md §11.4: never
 *   hand-edit production HubDB columns) and has no guard.
 *
 * And the thing both share: **HubDB has no schema-only publish.** `push-live` releases the
 * table's draft ROWS as well, so any schema change publishes whatever half-finished edits
 * staff have sitting in the table. Confirmed on Dev: there is no single-row publish.
 *
 * So this script does not try to avoid the publish. It makes it deliberate:
 *
 *   - **dry run by default.** It reads, diffs, and changes nothing.
 *   - **it refuses while unpublished row drafts exist**, naming them. That guard is the
 *     whole point: it is the difference between publishing a column and publishing
 *     somebody's unfinished row.
 *   - `--apply` writes the option to the DRAFT. Nothing is live yet.
 *   - `--publish` is a SEPARATE flag. Publishing is never implied by applying.
 *
 * Usage:
 *   pnpm tsx scripts/add-hubdb-select-option.ts --env=staging --table=courses \
 *     --column=status --option="Closed"                 # dry run: diff + draft report
 *   … --apply                                           # write to the draft only
 *   … --apply --publish                                 # write and push the table live
 *   … --allow-dirty-drafts                              # override the guard (say why)
 *
 * Keep `hubdb/*.json` in step in the same commit: this script changes a portal, the JSON
 * is what the repo knows.
 */
import { Client } from '@hubspot/api-client'
import { type HubSpotEnv, normaliseEnv, resolveHubSpotAccessToken } from './lib/hubspot-auth'
import { tableUpdatePayload } from './lib/hubdb-table-payload'

const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const withEquals = args.find((a) => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.split('=').slice(1).join('=')
  const index = args.indexOf(`--${name}`)
  if (index !== -1 && args[index + 1] && !args[index + 1]!.startsWith('--')) {
    return args[index + 1]
  }
  return undefined
}

function printUsage(code = 1): never {
  console.log(`
add-hubdb-select-option — add an option to a HubDB SELECT column

  --env=staging|production   Which portal (default: staging). staging=443253065, production=441838610
  --table=<name>             HubDB table (default: courses)
  --column=<name>            SELECT column (default: status)
  --option=<label>           Option to add, e.g. "Closed"
  --create-column            Create the column when it does not exist (SELECT only)
  --options=<a,b,c>          Options for --create-column, in order
  --label=<text>             Column label for --create-column (default: the column name)
  --apply                    Write to the table DRAFT
  --publish                  Publish the table (releases draft ROWS too — read the guard)
  --allow-dirty-drafts       Proceed even though rows have unpublished edits
  -h, --help                 This message

Dry run by default: with no --apply it reads and reports, and changes nothing.

Adding a column is the Ref 74c Phase 3 case (the events table has no status column at all):

  … --table=events --column=status --create-column \\
    --options="Available,Sold Out,Cancelled,Closed" --label="Status"

Existing rows are left BLANK on purpose. The site's shared vocabulary reads a blank status
as "available", so no backfill is needed — and a backfill would be row writes, which would
need a publish of their own.
`)
  process.exit(code)
}

if (args.includes('--help') || args.includes('-h')) printUsage(0)

// `normaliseEnv` still accepts the old `sandbox` spelling and says it means staging, so
// commands written before the portal was renamed keep working and never reach production.
const envRaw = flag('env') ?? 'staging'
const resolvedEnv = normaliseEnv(envRaw)
if (!resolvedEnv) {
  console.error(
    `[add-hubdb-select-option] Unknown --env="${envRaw}". Must be staging or production.\n`
  )
  printUsage()
}
// Bound once, non-null: the narrowing above does not reach into main().
const env: HubSpotEnv = resolvedEnv
const tableName = flag('table') ?? 'courses'
const columnName = flag('column') ?? 'status'
const optionName = flag('option')
const createColumn = args.includes('--create-column')
const columnLabel = flag('label') ?? columnName
const newOptions = (flag('options') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const apply = args.includes('--apply')
const publish = args.includes('--publish')
const allowDirtyDrafts = args.includes('--allow-dirty-drafts')

if (createColumn) {
  if (newOptions.length === 0) {
    console.error('[add-hubdb-select-option] --create-column needs --options="A,B,C".\n')
    printUsage()
  }
} else if (!optionName) {
  console.error('[add-hubdb-select-option] --option is required (or use --create-column).\n')
  printUsage()
}

interface HubDbOption {
  name: string
  type: string
  id?: number
}
interface HubDbColumn {
  name: string
  label?: string
  type: string
  options?: HubDbOption[]
}

let tablesApi: any
let rowsApi: any

/** Every row of a table, from one of the two endpoints, keyed by row id. */
async function readAll(which: 'draft' | 'published'): Promise<Map<string, unknown>> {
  const rows = new Map<string, unknown>()
  let after: string | undefined
  while (true) {
    const page: any =
      which === 'draft'
        ? await rowsApi.readDraftTableRows(tableName, undefined, after, 1000)
        : await rowsApi.getTableRows(tableName, undefined, after, 1000)
    for (const row of page.results ?? []) rows.set(String(row.id), row.values)
    after = page.paging?.next?.after
    if (!after) break
  }
  return rows
}

/**
 * Rows whose draft differs from what is published — i.e. exactly what a publish would
 * release alongside the column change.
 */
async function findDirtyDrafts(): Promise<string[]> {
  const [draft, live] = await Promise.all([readAll('draft'), readAll('published')])
  const dirty: string[] = []

  for (const [id, values] of draft) {
    if (!live.has(id)) {
      dirty.push(`${id} (new row, never published)`)
      continue
    }
    if (JSON.stringify(values) !== JSON.stringify(live.get(id))) {
      dirty.push(`${id} (edited since last publish)`)
    }
  }
  for (const id of live.keys()) {
    if (!draft.has(id)) dirty.push(`${id} (deleted in draft, still live)`)
  }
  return dirty
}

async function main(): Promise<void> {
  // There is no staging->production credential fallback any more (lib/hubspot-auth), which
  // is the same protection the old `allowSandboxFallback: false` bought: reaching production
  // means typing --env=production, and a schema mutation should cost exactly that.
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[add-hubdb-select-option]',
  })
  const client = new Client({ accessToken: auth.accessToken })
  tablesApi = client.cms.hubdb.tablesApi
  rowsApi = client.cms.hubdb.rowsApi

  console.log(
    `[add-hubdb-select-option] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `table=${tableName} column=${columnName} option="${optionName}" ` +
      `apply=${apply} publish=${publish}`
  )

  // The DRAFT, because the draft is what `updateDraftTable` replaces: reading the published
  // table would silently drop any schema edit already sitting in draft. Same call, same
  // arguments, as seed-hubdb.ts and the backfill scripts. (There is no
  // `getTableDetailsByName` on @hubspot/api-client 12 - that call threw before a byte was
  // read.)
  const table: any = await tablesApi.getDraftTableDetailsById(tableName, undefined, true)
  const column: HubDbColumn | undefined = (table.columns ?? []).find(
    (c: HubDbColumn) => c.name === columnName
  )

  // What the draft should end up holding for this column. Two shapes: a brand-new SELECT
  // column (Ref 74c Phase 3, the events table), or one more option on an existing one.
  let nextOptions: HubDbOption[]

  if (!column) {
    if (!createColumn) {
      throw new Error(
        `Column "${columnName}" not found on table "${tableName}". ` +
          `Pass --create-column --options="…" to create it.`
      )
    }
    console.log(`\n  column "${columnName}" does not exist — it would be CREATED as SELECT`)
    console.log(`  options:         ${newOptions.join(' | ')}`)
    console.log(
      `  existing rows:   left BLANK (the site reads a blank status as "available", so no\n` +
        `                   backfill is needed — and a backfill would be row writes)\n`
    )
    nextOptions = newOptions.map((name) => ({ name, type: 'option' }))
  } else {
    if (String(column.type).toUpperCase() !== 'SELECT') {
      throw new Error(`Column "${columnName}" is ${column.type}, not SELECT.`)
    }
    if (createColumn) {
      console.log(`\n  column "${columnName}" already exists — --create-column ignored`)
    }
    const current = column.options ?? []
    console.log(`\n  current options: ${current.map((o) => o.name).join(' | ') || '(none)'}`)

    if (!optionName) {
      console.log('  nothing to add (pass --option). Reporting only.')
      return
    }
    if (current.some((o) => o.name === optionName)) {
      console.log(`  "${optionName}" is already present — nothing to do.`)
      return
    }
    console.log(`  proposed:        ${[...current.map((o) => o.name), optionName].join(' | ')}\n`)
    nextOptions = [...current, { name: optionName, type: 'option' }]
  }

  // ---- The guard ---------------------------------------------------------
  const dirty = await findDirtyDrafts()
  if (dirty.length > 0) {
    console.log(`  ⚠️  ${dirty.length} row(s) have unpublished edits:`)
    for (const line of dirty.slice(0, 25)) console.log(`      - ${line}`)
    if (dirty.length > 25) console.log(`      … and ${dirty.length - 25} more`)
    console.log(
      `\n  Publishing this table would push those live too — HubDB has no schema-only\n` +
        `  publish and no single-row publish. Ask whoever owns them to finish or revert\n` +
        `  them first, then re-run.\n`
    )
    if (!allowDirtyDrafts) {
      if (apply || publish) {
        throw new Error(
          'Refusing to touch a table with unpublished row drafts. ' +
            'Clear them, or pass --allow-dirty-drafts if you know what they are.'
        )
      }
      console.log('  (dry run — stopping here.)')
      return
    }
    console.log('  --allow-dirty-drafts given: proceeding anyway.\n')
  } else {
    console.log('  ✅ no unpublished row drafts — a publish would release the column only.\n')
  }

  if (!apply) {
    console.log('  Dry run. Re-run with --apply to write the option to the draft.')
    return
  }

  const existingColumns: HubDbColumn[] = table.columns ?? []
  const nextColumns = column
    ? existingColumns.map((c) => (c.name === columnName ? { ...c, options: nextOptions } : c))
    : [
        ...existingColumns,
        { name: columnName, label: columnLabel, type: 'SELECT', options: nextOptions },
      ]

  // The update REPLACES the table definition, so everything that is not a column rides
  // along as the portal already has it. `name` and `label` are required by the request
  // type; the rest is what seed-hubdb.ts re-asserts on every update for the same reason -
  // left out, a publish could take `courses` off its dynamic pages (`useForPages`) or shut
  // the public read the React islands depend on (`allowPublicApiAccess`).
  await tablesApi.updateDraftTable(table.id, tableUpdatePayload(table, nextColumns))
  console.log(
    column
      ? `  ✅ draft updated: "${optionName}" added to ${tableName}.${columnName}`
      : `  ✅ draft updated: column ${tableName}.${columnName} created (SELECT)`
  )

  if (!publish) {
    console.log(
      '  Draft only — NOT published. The option is not selectable in the live table yet.\n' +
        '  Re-run with --apply --publish when you are ready to release it.'
    )
    return
  }

  await tablesApi.publishDraftTable(table.id, undefined)
  console.log(`  ✅ published ${tableName} — the option is live.`)
}

main().catch((err) => {
  console.error(`[add-hubdb-select-option] ${err?.message ?? err}`)
  process.exit(1)
})
