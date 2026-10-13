/**
 * Seeds HubDB tables from JSON definitions in /hubdb against a chosen
 * HubSpot portal. Idempotent: re-runs add missing columns without
 * duplicating; columns that exist in the portal but not in the JSON are
 * left in place (warning only - never auto-deleted).
 *
 * Always syncs table-level settings on existing tables, including
 * `allowPublicApiAccess`. Changing that flag in hubdb/*.json alone does
 * not privatise an already-seeded table - this script must run (and
 * should run before any row seeder that populates sensitive columns).
 *
 * Usage:
 *   pnpm seed:hubdb --env=staging
 *   pnpm seed:hubdb --env=production
 *   pnpm seed:hubdb --env=staging --dry-run
 *
 * Credentials (first match wins):
 *   1. HUBSPOT_ACCESS_TOKEN_STAGING / _PRODUCTION (or HUBSPOT_ACCESS_TOKEN)
 *   2. CLI personal access key from hubspot.config.yml / ~/.hscli/config.yml
 */
import { Client } from '@hubspot/api-client'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { isOptionColumnType, mergeColumnOptions } from './lib/hubdb-options'
import { normaliseEnv, resolveHubSpotAccessToken, type HubSpotEnv } from './lib/hubspot-auth'

type ColumnDef = {
  name: string
  label: string
  type: string
  required?: boolean
  options?: Array<{ name: string; type: string }>
}

type TableDef = {
  name: string
  label: string
  useForPages?: boolean
  allowChildTables?: boolean
  enableChildTablePages?: boolean
  allowPublicApiAccess?: boolean
  dynamicPageUrlPattern?: string
  dynamicMetaTags?: Record<string, string>
  columns: ColumnDef[]
}

const args = process.argv.slice(2)
function flag(name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
}
const envRaw = flag('env') ?? 'staging'
const dryRun = args.includes('--dry-run')

const envParsed = normaliseEnv(envRaw)
if (!envParsed) {
  console.error(`[seed-hubdb] Unknown --env="${envRaw}". Must be staging or production.`)
  process.exit(1)
}
// Narrowed here rather than relied on at each use: TS does not carry the
// null check into the async main() that consumes it.
const env: HubSpotEnv = envParsed

const HUBDB_DIR = resolve(process.cwd(), 'hubdb')
let hubdb: any

function loadDefs(): TableDef[] {
  const files = readdirSync(HUBDB_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
  return files.map((f) => {
    const raw = readFileSync(join(HUBDB_DIR, f), 'utf-8')
    const def = JSON.parse(raw) as TableDef
    if (!def.name || !def.columns) {
      throw new Error(`[seed-hubdb] ${f} is missing required fields (name, columns).`)
    }
    return def
  })
}

function toColumnInput(c: ColumnDef): Record<string, unknown> {
  const input: Record<string, unknown> = {
    name: c.name,
    label: c.label,
    type: c.type,
  }
  if (c.options && c.options.length) input.options = c.options
  return input
}

/** Table-level settings that must sync on create AND update (incl. privacy). */
function tableSettingsPayload(def: TableDef): Record<string, unknown> {
  return {
    name: def.name,
    label: def.label,
    useForPages: def.useForPages ?? false,
    allowChildTables: def.allowChildTables ?? false,
    enableChildTablePages: def.enableChildTablePages ?? false,
    // Explicit false must win - jobs stores employer emails and must stay private.
    allowPublicApiAccess: def.allowPublicApiAccess ?? true,
  }
}

function is404(err: any): boolean {
  return err?.code === 404 || err?.statusCode === 404 || err?.response?.statusCode === 404
}

async function findExisting(name: string): Promise<any | null> {
  try {
    return await hubdb.getDraftTableDetailsById(name, undefined, true)
  } catch (err: any) {
    if (is404(err)) return null
    throw err
  }
}

type TableResult = {
  created: string[]
  updated: string[]
  /** "column: Option, Option" for each SELECT that grew new options. */
  optionsAdded: string[]
}

async function ensureTable(def: TableDef): Promise<TableResult> {
  console.log(`\n[seed-hubdb] → ${def.name}`)

  const existing = await findExisting(def.name)
  const desiredColumns = def.columns.map(toColumnInput)
  const settings = tableSettingsPayload(def)

  if (!existing) {
    console.log(`  not found - creating with ${desiredColumns.length} columns`)
    const columnNames = desiredColumns.map((c) => c.name as string)
    if (dryRun) {
      console.log(`  [dry-run] would create columns: ${columnNames.join(', ')}`)
      console.log(`  [dry-run] allowPublicApiAccess=${settings.allowPublicApiAccess}`)
      return { created: columnNames, updated: [], optionsAdded: [] }
    }
    const created: any = await hubdb.createTable({
      ...settings,
      columns: desiredColumns,
    })
    await applyDynamicMetaTags(def, created.id)
    await publish(created.id, def.name)
    return { created: columnNames, updated: [], optionsAdded: [] }
  }

  console.log(`  exists (id=${existing.id}) - diffing columns`)
  const existingByName: Record<string, any> = {}
  for (const c of existing.columns ?? []) existingByName[c.name] = c

  const toAdd: Record<string, unknown>[] = []
  // Existing columns, rebuilt so a SELECT can pick up options added to the JSON.
  // Keyed by name; anything not touched here is passed through as the portal
  // has it.
  const reconciledByName: Record<string, any> = {}
  const optionsAdded: string[] = []

  for (const c of desiredColumns) {
    const name = c.name as string
    const e = existingByName[name]
    if (!e) {
      toAdd.push(c)
      continue
    }
    if (String(e.type).toUpperCase() !== String(c.type).toUpperCase()) {
      console.warn(
        `  ⚠️  column "${name}" type mismatch: portal=${e.type} json=${c.type} ` +
          `(not changed automatically)`,
      )
      continue
    }

    // SELECT / MULTISELECT values are a list the JSON is allowed to grow.
    // Without this the schema file could declare an option forever and the
    // live column would never gain it - the "cannot add Mackay" fault.
    if (!isOptionColumnType(c.type)) continue

    const merge = mergeColumnOptions(e.options, c.options as any)
    if (merge.portalOnly.length) {
      console.warn(
        `  ⚠️  column "${name}" has option(s) in the portal but not in JSON: ` +
          `${merge.portalOnly.join(', ')} - leaving in place ` +
          `(rows point at option ids; refusing to delete automatically)`,
      )
    }
    if (merge.changed) {
      reconciledByName[name] = { ...e, options: merge.options }
      optionsAdded.push(`${name}: ${merge.added.join(', ')}`)
    }

    // Options on an existing column are deliberately left alone: Weld Aus adds
    // their own (a new course city, say) in the HubDB UI, and reconciling
    // against the JSON would delete them. Report the drift so a JSON option
    // that never reached the portal is visible rather than silent.
    const jsonOptions = ((c.options as Array<{ name: string }> | undefined) ?? []).map(
      (o) => o.name,
    )
    if (jsonOptions.length) {
      const portalOptions = new Set(
        ((e.options ?? []) as Array<{ name?: string; label?: string }>).flatMap((o) =>
          [o.name, o.label].filter(Boolean) as string[],
        ),
      )
      const missing = jsonOptions.filter((o) => !portalOptions.has(o))
      if (missing.length) {
        console.warn(
          `  ⚠️  column "${name}" is missing option(s) present in the JSON: ` +
            `${missing.join(', ')} - add them in HubDB (Marketing → HubDB → ` +
            `${def.label} → Edit column), this seed will not (it would delete ` +
            `options added in the UI)`,
        )
      }
    }
  }

  for (const eName of Object.keys(existingByName)) {
    if (!desiredColumns.some((c) => c.name === eName)) {
      console.warn(
        `  ⚠️  column "${eName}" exists in portal but not in JSON - leaving in place ` +
          `(refusing to delete automatically)`,
      )
    }
  }

  const addedNames = toAdd.map((c) => c.name as string)
  const privacyWas = existing.allowPublicApiAccess
  const privacyWanted = settings.allowPublicApiAccess as boolean
  const privacyChanged = Boolean(privacyWas) !== Boolean(privacyWanted)

  if (toAdd.length === 0) {
    console.log(`  no new columns to add`)
  } else {
    console.log(`  adding columns: ${addedNames.join(', ')}`)
  }

  for (const line of optionsAdded) {
    console.log(`  adding select options - ${line}`)
  }

  if (privacyChanged) {
    console.log(
      `  allowPublicApiAccess: ${privacyWas} → ${privacyWanted}` +
        (privacyWanted === false ? ' (locking public HubDB API)' : ''),
    )
  } else {
    console.log(`  allowPublicApiAccess: ${privacyWanted}`)
  }

  if (!dryRun) {
    // Always push table-level settings (esp. allowPublicApiAccess) on the
    // existing-table path. Changing hubdb/*.json alone does not flip privacy
    // on an already-seeded table unless updateDraftTable receives the flag.
    const mergedColumns = [
      ...(existing.columns ?? []).map((c: any) => reconciledByName[c.name] ?? c),
      ...toAdd,
    ]
    await hubdb.updateDraftTable(existing.id, {
      ...settings,
      columns: mergedColumns,
    })
    await applyDynamicMetaTags(def, existing.id)
    await publish(existing.id, def.name)
  }

  return { created: [], updated: addedNames, optionsAdded }
}

async function applyDynamicMetaTags(def: TableDef, tableId: string): Promise<void> {
  if (!def.useForPages || !def.dynamicMetaTags) return

  const draft: any = await hubdb.getDraftTableDetailsById(tableId, undefined, true)
  const byName: Record<string, number> = {}
  for (const c of draft.columns ?? []) byName[c.name] = Number(c.id)

  const resolved: Record<string, number> = {}
  for (const [metaTag, columnName] of Object.entries(def.dynamicMetaTags)) {
    const colId = byName[columnName]
    if (!colId) {
      console.warn(
        `  ⚠️  dynamicMetaTags: column "${columnName}" not found for ${metaTag} - skipping`,
      )
      continue
    }
    resolved[metaTag] = colId
  }

  if (Object.keys(resolved).length === 0) return

  // Re-assert table settings so a meta-tag-only update cannot leave a previously
  // public table readable after application_email (or similar) is added.
  await hubdb.updateDraftTable(tableId, {
    ...tableSettingsPayload(def),
    useForPages: true,
    dynamicMetaTags: resolved,
  })
  console.log(`  dynamicMetaTags set: ${JSON.stringify(resolved)}`)
}

async function publish(tableId: string, name: string): Promise<void> {
  await hubdb.publishDraftTable(tableId, undefined)
  console.log(`  published ✓ ${name}`)
}

async function main(): Promise<void> {
  const auth = await resolveHubSpotAccessToken(env, {
    logPrefix: '[seed-hubdb]',
  })
  const client = new Client({ accessToken: auth.accessToken })
  hubdb = client.cms.hubdb.tablesApi

  const defs = loadDefs()
  console.log(
    `[seed-hubdb] env=${env} portal=${auth.portalId} auth=${auth.source} ` +
      `dryRun=${dryRun} - ${defs.length} table(s): ` +
      defs.map((d) => d.name).join(', '),
  )

  const summary: Record<string, TableResult> = {}
  let failed = 0
  for (const def of defs) {
    try {
      summary[def.name] = await ensureTable(def)
    } catch (err) {
      failed++
      console.error(`[seed-hubdb] ✖ ${def.name} failed:`, err)
    }
  }

  console.log(`\n[seed-hubdb] summary:`)
  for (const [name, s] of Object.entries(summary)) {
    if (s.created.length) console.log(`  ${name}: created ${s.created.length} column(s)`)
    if (s.updated.length) console.log(`  ${name}: added ${s.updated.length} column(s)`)
    for (const line of s.optionsAdded) console.log(`  ${name}: added option(s) - ${line}`)
    if (!s.created.length && !s.updated.length && !s.optionsAdded.length) {
      console.log(`  ${name}: up to date`)
    }
  }

  if (failed) {
    console.error(`\n[seed-hubdb] done with ${failed} failure(s).`)
    process.exit(1)
  }
  console.log(`\n[seed-hubdb] done.`)
}

main().catch((err) => {
  console.error('[seed-hubdb] unexpected error:', err?.message ?? err)
  process.exit(1)
})
