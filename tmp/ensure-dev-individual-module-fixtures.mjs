/*
 * Creates two isolated, clearly labelled Dev-only module checkout records.
 * It only calls the Weld Australia Dev HubSpot portal. It never reads or writes
 * production HubDB, staging, or real course/module rows.
 */
import fs from 'node:fs'
import path from 'node:path'
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const config = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, '.hscli', 'config.yml'), 'utf8'))
const dev = config.accounts.find((entry) => entry.name === 'weld-australia-sandbox')
if (!dev?.auth?.tokenInfo?.accessToken) throw new Error('No active Weld Australia Dev CLI token')

const headers = { Authorization: `Bearer ${dev.auth.tokenInfo.accessToken}`, 'Content-Type': 'application/json' }
const devCheckoutUrl = 'https://443253065.hs-sites-ap1.com/dev-checkout'
const modules = [
  { key: 'dev-test-module-1', name: 'DEV TEST — Module 1', workerEventId: 'devportal_module_dev_001', publicTicketId: 'devportal_module_dev_001_public', memberTicketId: 'devportal_module_dev_001_member', date: '2026-12-01', order: 1 },
  { key: 'dev-test-module-2', name: 'DEV TEST — Module 2', workerEventId: 'devportal_module_dev_002', publicTicketId: 'devportal_module_dev_002_public', memberTicketId: 'devportal_module_dev_002_member', date: '2026-12-08', order: 2 },
]

async function request(method, pathname, body) {
  const response = await fetch(`https://api.hubapi.com${pathname}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status}: ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

function copyColumn(column) {
  const copied = { name: column.name, label: column.label, type: column.type }
  if (Array.isArray(column.options) && column.options.length) copied.options = column.options.map(({ name, label, type }) => ({ name, label, type }))
  return copied
}

function tableInput(table, columns) {
  return { name: table.name, label: table.label, useForPages: Boolean(table.useForPages), allowChildTables: Boolean(table.allowChildTables), enableChildTablePages: Boolean(table.enableChildTablePages), allowPublicApiAccess: Boolean(table.allowPublicApiAccess), columns }
}

const eventRows = await request('GET', '/cms/v3/hubdb/tables/events/rows/draft?limit=500')
const eventIds = new Map()
for (const module of modules) {
  const existing = (eventRows.results ?? []).find((row) => row.values?.slug === module.key)
  const values = {
    slug: module.key, event_name: module.name, event_type: 'In-Person', event_date: module.date, event_end_date: module.date,
    event_state: 'National', event_location: 'Development only', event_description: `<p>Isolated development fixture for ${module.name}.</p>`,
    registration_url: '', use_event_engine: true, worker_event_id: module.workerEventId, price_type: 'Paid', price_from: '$60', member_price: '50', non_member_price: '60',
    ticket_types_json: JSON.stringify([
      { worker_ticket_type_id: module.publicTicketId, price_dollars: 60, member_only: false },
      { worker_ticket_type_id: module.memberTicketId, price_dollars: 50, member_only: true },
    ]),
  }
  if (existing) {
    await request('PATCH', `/cms/v3/hubdb/tables/events/rows/${existing.id}/draft`, { values: { ...existing.values, ...values } })
    eventIds.set(module.key, existing.id)
  } else {
    const created = await request('POST', '/cms/v3/hubdb/tables/events/rows/draft/batch/create', { inputs: [{ name: module.name, path: module.key, values }] })
    eventIds.set(module.key, created.results[0].id)
  }
}
await request('POST', '/cms/v3/hubdb/tables/events/draft/publish')

const moduleTable = await request('GET', '/cms/v3/hubdb/tables/course_modules/draft')
if (!moduleTable.columns.some((column) => column.name === 'module_booking_url')) {
  await request('PATCH', `/cms/v3/hubdb/tables/${moduleTable.id}/draft`, tableInput(moduleTable, [...moduleTable.columns.map(copyColumn), { name: 'module_booking_url', label: 'Individual module booking URL', type: 'URL' }]))
}

const moduleRows = await request('GET', '/cms/v3/hubdb/tables/course_modules/rows/draft?limit=500')
for (const module of modules) {
  const existing = (moduleRows.results ?? []).find((row) => row.values?.parent_course_id === 'dev-course-package' && row.values?.name === module.name)
  const values = { parent_course_id: 'dev-course-package', product_id: '', module_order: module.order, show_on_website: true, module_booking_url: `${devCheckoutUrl}?event_id=${eventIds.get(module.key)}` }
  if (existing) await request('PATCH', `/cms/v3/hubdb/tables/course_modules/rows/${existing.id}/draft`, { values: { ...existing.values, ...values } })
  else await request('POST', '/cms/v3/hubdb/tables/course_modules/rows/draft/batch/create', { inputs: [{ name: module.name, path: module.key, values }] })
}
await request('POST', '/cms/v3/hubdb/tables/course_modules/draft/publish')

console.log(JSON.stringify({ portal: 'Weld Australia Dev', fixtures: modules.map((module) => ({ module: module.name, checkoutUrl: `${devCheckoutUrl}?event_id=${eventIds.get(module.key)}`, memberPrice: 50, publicPrice: 60 })), published: true }, null, 2))
