/*
 * Dev-only IWE individual-module checkout binding.
 * Reads and writes Weld Australia Dev (443253065) only. Production is never called.
 */
import fs from 'node:fs'
import path from 'node:path'

const envText = fs.readFileSync(path.join(process.cwd(), '.env.dev.local'), 'utf8')
const token = envText.match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim()
if (!token) throw new Error('HUBSPOT_DEV_SERVICE_KEY is not configured')

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const checkoutBase = 'https://443253065.hs-sites-ap1.com/dev-checkout?event_id='
const modules = [
  ['IIW International Welding Engineer (IWE) Module 1 (Module)', 'dev-iwe-module-01', 'dev-iwe-m01-public', 'dev-iwe-m01-member', '2026-12-01'],
  ['IIW International Welding Engineer (IWE) Module 2 (Module)', 'dev-iwe-module-02', 'dev-iwe-m02-public', 'dev-iwe-m02-member', '2026-12-02'],
  ['IIW International Welding Engineer (IWE) Module 3 (Module)', 'dev-iwe-module-03', 'dev-iwe-m03-public', 'dev-iwe-m03-member', '2026-12-03'],
  ['IIW International Welding Engineer (IWE) Module 4 (Module)', 'dev-iwe-module-04', 'dev-iwe-m04-public', 'dev-iwe-m04-member', '2026-12-04'],
  ['2026 IWE Practical Training (Module)', 'dev-iwe-module-05', 'dev-iwe-m05-public', 'dev-iwe-m05-member', '2026-12-05'],
  ['IIW International Welding Engineer (IWE) Practical (Module)', 'dev-iwe-module-06', 'dev-iwe-m06-public', 'dev-iwe-m06-member', '2026-12-06'],
].map(([name, workerEventId, publicTicketId, memberTicketId, date], index) => ({ name, workerEventId, publicTicketId, memberTicketId, date, order: index + 1, slug: `dev-iwe-module-${index + 1}` }))

async function api(method, pathname, body) {
  const response = await fetch(`https://api.hubapi.com${pathname}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

const [courses, moduleRows, eventRows] = await Promise.all([
  api('GET', '/cms/v3/hubdb/tables/courses/rows/draft?limit=500'),
  api('GET', '/cms/v3/hubdb/tables/course_modules/rows/draft?limit=500'),
  api('GET', '/cms/v3/hubdb/tables/events/rows/draft?limit=500'),
])
const iwe = (courses.results ?? []).find((row) => row.values?.course_slug === 'iwe' || row.path === 'iwe')
if (!iwe) throw new Error('IWE course row is not present in Dev')
const courseId = String(iwe.values?.course_id ?? '')
if (!courseId) throw new Error('IWE course has no course_id')

const targetRows = new Map()
for (const module of modules) {
  const row = (moduleRows.results ?? []).find((candidate) => String(candidate.values?.parent_course_id) === courseId && candidate.values?.name === module.name)
  if (!row) {
    const available = (moduleRows.results ?? [])
      .filter((candidate) => String(candidate.values?.parent_course_id) === courseId)
      .map((candidate) => ({ id: candidate.id, name: candidate.values?.name, parent: candidate.values?.parent_course_id }))
    throw new Error(`IWE Dev module row not found: ${module.name}; available=${JSON.stringify(available)}`)
  }
  targetRows.set(module.workerEventId, row)
}

const eventRowIds = new Map()
for (const module of modules) {
  const current = (eventRows.results ?? []).find((row) => row.values?.slug === module.slug)
  const values = {
    slug: module.slug, event_name: `DEV TEST - ${module.name}`, event_type: { name: 'In-Person', type: 'option' }, event_date: Date.parse(`${module.date}T00:00:00Z`), event_end_date: Date.parse(`${module.date}T23:59:59Z`),
    event_state: { name: 'National', type: 'option' }, event_location: 'Development only', event_description: `<p>Dev-only individual-module checkout fixture for ${module.name}.</p>`,
    registration_url: '', use_event_engine: true, worker_event_id: module.workerEventId, price_type: { name: 'Paid', type: 'option' }, price_from: '$60', member_price: '50', non_member_price: '60',
    ticket_types_json: JSON.stringify([
      { worker_ticket_type_id: module.publicTicketId, price_dollars: 60, member_only: false },
      { worker_ticket_type_id: module.memberTicketId, price_dollars: 50, member_only: true },
    ]),
  }
  if (current) {
    await api('PATCH', `/cms/v3/hubdb/tables/events/rows/${current.id}/draft`, { values: { ...current.values, ...values } })
    eventRowIds.set(module.workerEventId, current.id)
  } else {
    const created = await api('POST', '/cms/v3/hubdb/tables/events/rows/draft/batch/create', { inputs: [{ name: values.event_name, path: module.slug, values }] })
    eventRowIds.set(module.workerEventId, created.results?.[0]?.id)
  }
}
if ([...eventRowIds.values()].some((id) => !id)) throw new Error('One or more Dev Event HubDB rows were not created')

for (const module of modules) {
  const row = targetRows.get(module.workerEventId)
  await api('PATCH', `/cms/v3/hubdb/tables/course_modules/rows/${row.id}/draft`, {
    values: { ...row.values, module_booking_url: `${checkoutBase}${eventRowIds.get(module.workerEventId)}` },
  })
}

await api('POST', '/cms/v3/hubdb/tables/events/draft/publish')
await api('POST', '/cms/v3/hubdb/tables/course_modules/draft/publish')
console.log(JSON.stringify({ portal: 'Weld Australia Dev', course: 'IWE', linkedModules: modules.map((module) => ({ name: module.name, workerEventId: module.workerEventId, eventRowId: eventRowIds.get(module.workerEventId) })) }, null, 2))
