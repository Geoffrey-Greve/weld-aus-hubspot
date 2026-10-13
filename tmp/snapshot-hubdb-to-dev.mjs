/*
 * Controlled, one-way HubDB snapshot for the isolated Weld Australia Dev portal.
 *
 * Production access is GET-only. --apply writes only to the Dev portal.
 * The deliberately limited table set excludes CRM-linked directory/contact data.
 *
 * Usage:
 *   node tmp/snapshot-hubdb-to-dev.mjs --dry-run
 *   node tmp/snapshot-hubdb-to-dev.mjs --apply
 */
import fs from 'node:fs'
import path from 'node:path'
// The project-local HubSpot CLI owns this dependency; keeping the script
// self-contained avoids changing the application dependency graph.
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const APPLY = process.argv.includes('--apply')
const REPAIR_SCHEMA = process.argv.includes('--repair-schema')
const VERIFY = process.argv.includes('--verify')
const INSPECT = process.argv.includes('--inspect')
const SCHEMAS = process.argv.includes('--schemas')
const CORE_TABLES = [
  'courses',
  'events',
  'course_modules',
  'resources',
  'jobs',
  'certification_pathways',
  'team_and_board',
  'people',
]
const REMAINING_TABLES = [
  'members',
  'state_offices',
  'portal_test_profiles',
  'member_dashboard_preview',
  'certification_guidance',
]
const TABLES = process.argv.includes('--remaining-only')
  ? REMAINING_TABLES
  : [...CORE_TABLES, ...(process.argv.includes('--all-tables') ? REMAINING_TABLES : [])]

const configPath = path.join(process.env.USERPROFILE, '.hscli', 'config.yml')
const config = yaml.load(fs.readFileSync(configPath, 'utf8'))
const account = (name) => {
  const value = config.accounts.find((item) => item.name === name)
  if (!value?.auth?.tokenInfo?.accessToken) throw new Error(`No active token for ${name}`)
  return value
}

const production = account('staging')
const dev = account('weld-australia-sandbox')
const headers = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

async function request(accountConfig, method, pathname, body) {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method,
    headers: headers(accountConfig.auth.tokenInfo.accessToken),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${method} ${pathname} failed (${response.status}): ${await response.text()}`)
  if (response.status === 204) return null
  return response.json()
}

async function allRows(accountConfig, tableName, draft = false) {
  const rows = []
  let after = ''
  do {
    const suffix = `${draft ? '/draft' : ''}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const page = await request(accountConfig, 'GET', `/cms/v3/hubdb/tables/${tableName}/rows${suffix}`)
    rows.push(...(page?.results ?? []))
    after = page?.paging?.next?.after ?? ''
  } while (after)
  return rows
}

function columnInput(column) {
  const result = { name: column.name, label: column.label, type: column.type }
  if (Array.isArray(column.options) && column.options.length) {
    result.options = column.options.map(({ name, label, type }) => ({ name, label, type }))
  }
  return result
}

function tableInput(table, columns) {
  return {
    name: table.name,
    label: table.label,
    useForPages: Boolean(table.useForPages),
    allowChildTables: Boolean(table.allowChildTables),
    enableChildTablePages: Boolean(table.enableChildTablePages),
    allowPublicApiAccess: Boolean(table.allowPublicApiAccess),
    columns,
  }
}

function devSafeRow(tableName, row) {
  const values = { ...(row.values ?? {}) }
  if (tableName === 'courses' || tableName === 'events') {
    values.use_event_engine = false
    delete values.registration_url
    delete values.worker_event_id
    delete values.member_ticket_type_id
    delete values.non_member_ticket_type_id
    delete values.ticket_types_json
  }
  if (tableName === 'course_modules') delete values.hubspot_product_id
  if (tableName === 'members') {
    // Keep public-facing organisation data and membership scenarios, but break
    // every link to a production CRM contact or company record.
    values.contact_email = `dev-member-${row.id}@example.invalid`
    delete values.hubspot_company_id
  }
  if (tableName === 'state_offices') {
    // The office layout remains testable without carrying real contact details
    // or a production HubSpot contact ID into the Dev portal.
    values.phone = '0000 000 000'
    values.email = `dev-office-${row.id}@example.invalid`
    delete values.manager_contact_id
  }
  if (tableName === 'member_dashboard_preview') {
    // Preserve the display scenarios but remove identifiers and invoice links.
    values.first_name = 'Dev'
    values.last_name = 'Tester'
    values.initials = 'DT'
    values.member_id = `DEV-${row.id}`
    values.invoice_number = `DEV-INVOICE-${row.id}`
    delete values.invoice_pdf_url
  }
  return {
    values,
    ...(row.name ? { name: row.name } : {}),
    ...(row.path ? { path: row.path } : {}),
  }
}

async function ensureDevSchema(sourceTable, devTable) {
  const sourceColumns = sourceTable.columns.map(columnInput)
  if (!devTable) {
    if (!APPLY) return { created: sourceColumns.map((column) => column.name), added: [] }
    const created = await request(dev, 'POST', '/cms/v3/hubdb/tables', tableInput(sourceTable, sourceColumns))
    return { table: created, created: sourceColumns.map((column) => column.name), added: [] }
  }

  const names = new Set((devTable.columns ?? []).map((column) => column.name))
  const conflicts = []
  for (const sourceColumn of sourceTable.columns ?? []) {
    const targetColumn = (devTable.columns ?? []).find((column) => column.name === sourceColumn.name)
    if (!targetColumn) continue
    if (targetColumn.type !== sourceColumn.type) {
      conflicts.push(`${sourceColumn.name}: type differs (${targetColumn.type} vs ${sourceColumn.type})`)
      continue
    }
    if (['SELECT', 'MULTISELECT'].includes(sourceColumn.type)) {
      const sourceOptions = new Set((sourceColumn.options ?? []).map((option) => option.name))
      const targetOptions = new Set((targetColumn.options ?? []).map((option) => option.name))
      const missing = [...sourceOptions].filter((option) => !targetOptions.has(option))
      if (missing.length) conflicts.push(`${sourceColumn.name}: missing Dev option(s) ${missing.join(', ')}`)
    }
  }
  const added = sourceColumns.filter((column) => !names.has(column.name))
  if (!APPLY || added.length === 0) return { table: devTable, created: [], added: added.map((column) => column.name), conflicts }

  const columns = [...(devTable.columns ?? []).map(columnInput), ...added]
  const updated = await request(dev, 'PATCH', `/cms/v3/hubdb/tables/${devTable.id}/draft`, tableInput(devTable, columns))
  return { table: updated, created: [], added: added.map((column) => column.name), conflicts }
}

async function purgeDraftRows(tableName, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    await request(dev, 'POST', `/cms/v3/hubdb/tables/${tableName}/rows/draft/batch/purge`, {
      inputs: rows.slice(index, index + 100).map((row) => String(row.id)),
    })
  }
}

async function createDraftRows(tableName, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    await request(dev, 'POST', `/cms/v3/hubdb/tables/${tableName}/rows/draft/batch/create`, {
      inputs: rows.slice(index, index + 100),
    })
  }
}

async function main() {
  const plan = []
  const backup = {}
  const sourceRowsByTable = {}
  const devTablesByTable = {}

  // Finish all GET-only discovery first. This makes a failed compatibility check
  // harmless: no Dev schema or row has changed yet.
  for (const tableName of TABLES) {
    const sourceTable = await request(production, 'GET', `/cms/v3/hubdb/tables/${tableName}`)
    if (!sourceTable) throw new Error(`Production table not found: ${tableName}`)
    // Some HubSpot tables have no separate draft representation until edited.
    // Fall back to the published definition so we never misclassify an existing
    // Dev table as missing and attempt to create a duplicate.
    let existingDevTable =
      (await request(dev, 'GET', `/cms/v3/hubdb/tables/${tableName}/draft`)) ??
      (await request(dev, 'GET', `/cms/v3/hubdb/tables/${tableName}`))
    if (!existingDevTable) {
      const devTableList = await request(dev, 'GET', '/cms/v3/hubdb/tables?limit=500')
      existingDevTable = (devTableList?.results ?? []).find(
        (candidate) => candidate.name === tableName || candidate.label === sourceTable.label,
      ) ?? null
    }
    const sourceRows = await allRows(production, tableName)
    const devRows = existingDevTable ? await allRows(dev, tableName, true) : []
    const schema = await ensureDevSchema(sourceTable, existingDevTable)
    sourceRowsByTable[tableName] = { sourceTable, sourceRows, devRows, schema }
    devTablesByTable[tableName] = existingDevTable
    backup[tableName] = { table: existingDevTable, rows: devRows }
    plan.push({
      table: tableName,
      sourceRows: sourceRows.length,
      devRowsToReplace: devRows.length,
      columnsCreated: schema.created,
      columnsAdded: schema.added,
      conflicts: schema.conflicts ?? [],
    })
  }

  if (SCHEMAS) {
    const schemas = Object.entries(sourceRowsByTable).map(([table, data]) => ({
      table,
      columns: (data.sourceTable.columns ?? []).map((column) => ({ name: column.name, type: column.type })),
    }))
    console.log(JSON.stringify({ mode: 'schemas', schemas }, null, 2))
    return
  }

  if (REPAIR_SCHEMA) {
    const backupDir = path.join(process.cwd(), 'tmp', 'dev-hubdb-backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const backupPath = path.join(backupDir, `before-dev-schema-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2))

    const repaired = []
    for (const item of plan.filter((entry) => entry.conflicts.length)) {
      const { sourceTable } = sourceRowsByTable[item.table]
      const devTable = devTablesByTable[item.table]
      if (!devTable) throw new Error(`Dev table unexpectedly missing: ${item.table}`)
      const sourceColumns = new Map((sourceTable.columns ?? []).map((column) => [column.name, columnInput(column)]))
      const mergedColumns = [
        ...(devTable.columns ?? []).filter((column) => !sourceColumns.has(column.name)).map(columnInput),
        ...sourceColumns.values(),
      ]
      const updated = await request(dev, 'PATCH', `/cms/v3/hubdb/tables/${devTable.id}/draft`, tableInput(devTable, mergedColumns))
      await request(dev, 'POST', `/cms/v3/hubdb/tables/${updated.id}/draft/publish`)
      repaired.push({ table: item.table, conflictsResolved: item.conflicts })
    }
    console.log(JSON.stringify({ mode: 'repair-schema', backupPath, repaired }, null, 2))
    return
  }

  if (INSPECT) {
    const coverage = (rows) => {
      const counts = {}
      for (const row of rows) {
        for (const [field, value] of Object.entries(row.values ?? {})) {
          if (value !== null && value !== undefined && value !== '') counts[field] = (counts[field] ?? 0) + 1
        }
      }
      return counts
    }
    const inspection = []
    for (const tableName of ['people', 'team_and_board']) {
      const productionRows = sourceRowsByTable[tableName].sourceRows
      const publishedDevRows = await allRows(dev, tableName)
      inspection.push({
        table: tableName,
        productionRows: productionRows.length,
        devRows: publishedDevRows.length,
        productionNonEmptyFields: coverage(productionRows),
        devNonEmptyFields: coverage(publishedDevRows),
      })
    }
    console.log(JSON.stringify({ mode: 'inspect', inspection }, null, 2))
    return
  }

  if (VERIFY) {
    const verification = []
    for (const tableName of TABLES) {
      const rows = await allRows(dev, tableName)
      const unsafeRows = rows.filter((row) => {
        const values = row.values ?? {}
        if (tableName === 'courses' || tableName === 'events') {
          return values.use_event_engine === true || values.use_event_engine === 'true' || Boolean(values.registration_url) || Boolean(values.worker_event_id) || Boolean(values.member_ticket_type_id) || Boolean(values.non_member_ticket_type_id) || Boolean(values.ticket_types_json)
        }
        if (tableName === 'course_modules') return Boolean(values.hubspot_product_id)
        if (tableName === 'members') return Boolean(values.hubspot_company_id) || !String(values.contact_email ?? '').endsWith('@example.invalid')
        if (tableName === 'state_offices') return Boolean(values.manager_contact_id) || !String(values.email ?? '').endsWith('@example.invalid')
        if (tableName === 'member_dashboard_preview') return Boolean(values.invoice_pdf_url) || values.first_name !== 'Dev' || values.last_name !== 'Tester'
        return false
      })
      verification.push({ table: tableName, publishedRows: rows.length, unsafeRows: unsafeRows.length })
    }
    console.log(JSON.stringify({ mode: 'verify', verification }, null, 2))
    return
  }

  if (!APPLY) {
    console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2))
    return
  }

  const conflicts = plan.filter((item) => item.conflicts.length)
  if (conflicts.length) {
    throw new Error(`No Dev data was changed. Resolve existing schema conflicts before applying: ${conflicts.map((item) => `${item.table} (${item.conflicts.join('; ')})`).join(' | ')}`)
  }

  // Persist a recovery snapshot before the first Dev write, never after it.
  const backupDir = path.join(process.cwd(), 'tmp', 'dev-hubdb-backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, `before-production-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2))

  for (const tableName of TABLES) {
    const { sourceTable, sourceRows, devRows, schema } = sourceRowsByTable[tableName]
    const existingDevTable = devTablesByTable[tableName]
    const appliedSchema = await ensureDevSchema(sourceTable, existingDevTable)
    await purgeDraftRows(tableName, devRows)
    await createDraftRows(tableName, sourceRows.map((row) => devSafeRow(tableName, row)))
    const resolvedTable = appliedSchema.table ?? await request(dev, 'GET', `/cms/v3/hubdb/tables/${tableName}/draft`)
    await request(dev, 'POST', `/cms/v3/hubdb/tables/${resolvedTable.id}/draft/publish`)
  }

  console.log(JSON.stringify({ mode: 'apply', backupPath, plan }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
