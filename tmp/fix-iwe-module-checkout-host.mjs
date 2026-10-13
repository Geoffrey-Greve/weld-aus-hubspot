/* Dev-only repair: replace the temporary HubSpot host in IWE module links. */
import fs from 'node:fs'
import path from 'node:path'

const env = fs.readFileSync(path.join(process.cwd(), '.env.dev.local'), 'utf8')
const token = env.match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim()
if (!token) throw new Error('HUBSPOT_DEV_SERVICE_KEY is not configured')

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const request = async (method, pathname, body) => {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status}`)
  return response.status === 204 ? null : response.json()
}

const rows = await request('GET', '/cms/v3/hubdb/tables/course_modules/rows/draft?limit=500')
const staleHost = 'https://443253065.hs-sites-ap1.com/checkout?event_id='
const devHost = 'https://weldaustralia.dev/checkout?event_id='
const targets = (rows.results ?? []).filter((row) => String(row.values?.module_booking_url ?? '').startsWith(staleHost))

for (const row of targets) {
  const current = String(row.values.module_booking_url)
  await request('PATCH', `/cms/v3/hubdb/tables/course_modules/rows/${row.id}/draft`, {
    values: { ...row.values, module_booking_url: current.replace(staleHost, devHost) },
  })
}
if (targets.length) await request('POST', '/cms/v3/hubdb/tables/course_modules/draft/publish')
console.log(JSON.stringify({ portal: 'Weld Australia Dev', changedModuleLinks: targets.length }))
