import fs from 'node:fs'
const env = fs.readFileSync('.env.dev.local', 'utf8')
const token = env.match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim()
const headers = { Authorization: `Bearer ${token}` }
for (const id of ['375363321311', '375363321313']) {
  const response = await fetch(`https://api.hubapi.com/cms/v3/pages/site-pages/${id}`, { headers })
  if (!response.ok) throw new Error(`${id}: ${response.status} ${await response.text()}`)
  const page = await response.json()
  console.log(JSON.stringify({ id, name: page.name, url: page.url, absoluteUrl: page.absoluteUrl, state: page.state, dynamic: page.dynamicPageDataSourceId, domain: page.domain }, null, 2))
}
