import fs from 'node:fs'
const env = fs.readFileSync('.env.dev.local', 'utf8')
const token = env.match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim()
const response = await fetch('https://api.hubapi.com/cms/v3/hubdb/tables/events/draft', { headers: { Authorization: `Bearer ${token}` } })
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
const table = await response.json()
const selected = (table.columns ?? []).filter((column) => ['event_type', 'event_state', 'price_type'].includes(column.name))
console.log(JSON.stringify(selected, null, 2))
console.log(JSON.stringify((table.columns ?? []).map(({ name, type }) => ({ name, type })), null, 2))
const rowsResponse = await fetch('https://api.hubapi.com/cms/v3/hubdb/tables/events/rows/draft?limit=1', { headers: { Authorization: `Bearer ${token}` } })
if (!rowsResponse.ok) throw new Error(`${rowsResponse.status} ${await rowsResponse.text()}`)
const row = (await rowsResponse.json()).results?.[0]
console.log(JSON.stringify({ sample: { event_type: row?.values?.event_type, event_state: row?.values?.event_state } }, null, 2))
