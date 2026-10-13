/* Dev-only: replace the copied Production host on the course listing/detail pages. */
import fs from 'node:fs'
const env = fs.readFileSync('.env.dev.local', 'utf8')
const token = env.match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const targets = [
  ['375363321311', 'https://443253065.hs-sites-ap1.com/course-detail'],
  ['375363321313', 'https://443253065.hs-sites-ap1.com/courses'],
]
for (const [id, url] of targets) {
  const response = await fetch(`https://api.hubapi.com/cms/v3/pages/site-pages/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ url }) })
  if (!response.ok) throw new Error(`${id}: ${response.status} ${await response.text()}`)
  const page = await response.json()
  console.log(JSON.stringify({ id, name: page.name, url: page.url, state: page.state }))
}
