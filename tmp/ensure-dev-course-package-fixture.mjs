/*
 * Creates or repairs one isolated HubDB course row for package-checkout testing.
 * It only calls the Weld Australia Dev portal and never reads or writes production.
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const config = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, '.hscli', 'config.yml'), 'utf8'))
const dev = config.accounts.find((entry) => entry.name === 'weld-australia-sandbox')
if (!dev?.auth?.tokenInfo?.accessToken) throw new Error('No active Weld Australia Dev CLI token')

const headers = { Authorization: `Bearer ${dev.auth.tokenInfo.accessToken}`, 'Content-Type': 'application/json' }
const tableName = 'courses'
const fixtureCourseId = 'dev-course-package'

async function request(method, pathname, body) {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status}: ${await response.text()}`)
  return response.status === 204 ? null : response.json()
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

const table = await request('GET', `/cms/v3/hubdb/tables/${tableName}/draft`)
let addedColumn = false
if (!table.columns.some((column) => column.name === 'course_package_booking')) {
  await request('PATCH', `/cms/v3/hubdb/tables/${table.id}/draft`, tableInput(table, [
    ...table.columns.map(columnInput),
    { name: 'course_package_booking', label: 'Book complete course package', type: 'BOOLEAN' },
  ]))
  addedColumn = true
}

const rows = await request('GET', `/cms/v3/hubdb/tables/${tableName}/rows/draft?limit=100`)
const existing = (rows.results ?? []).find((row) => row.values?.course_id === fixtureCourseId)
const values = {
  course_name: 'DEV TEST — Complete Course Package',
  course_id: fixtureCourseId,
  course_slug: fixtureCourseId,
  duration: '2 weeks',
  description: '<p>Isolated development fixture for complete-course package checkout.</p>',
  is_free: false,
  price_member: 100,
  price_individual: 120,
  price_non_member: 120,
  use_event_engine: true,
  course_package_booking: true,
  worker_event_id: 'devportal_course_dev_001',
  member_ticket_type_id: 'devportal_course_dev_package',
  non_member_ticket_type_id: 'devportal_course_dev_package',
}

if (existing) {
  await request('PATCH', `/cms/v3/hubdb/tables/${tableName}/rows/${existing.id}/draft`, {
    values: { ...existing.values, ...values },
  })
} else {
  await request('POST', `/cms/v3/hubdb/tables/${tableName}/rows/draft/batch/create`, {
    inputs: [{
      name: 'DEV TEST — Complete Course Package',
      path: fixtureCourseId,
      values,
    }],
  })
}

await request('POST', `/cms/v3/hubdb/tables/${tableName}/draft/publish`)
console.log(JSON.stringify({
  portal: 'Weld Australia Dev',
  fixture: existing ? 'updated' : 'created',
  packageFlagColumn: addedColumn ? 'added' : 'already-present',
  published: true,
}, null, 2))
