import fs from 'node:fs'
const env = fs.readFileSync('.env.dev.local', 'utf8')
const token = env.match(/^HUBSPOT_DEV_SERVICE_KEY=(.+)$/m)?.[1]?.trim()
const response = await fetch('https://api.hubapi.com/cms/v3/domains?limit=500', { headers: { Authorization: `Bearer ${token}` } })
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
const domains = await response.json()
console.log(JSON.stringify((domains.results ?? []).map(({ domain, isResolving, isHttpsEnabled, isUsedForEmail, isUsedForSitePage, isUsedForLandingPage, isPrimaryEmail, isPrimarySitePage, expectedCname, correctCname }) => ({ domain, isResolving, isHttpsEnabled, isUsedForEmail, isUsedForSitePage, isUsedForLandingPage, isPrimaryEmail, isPrimarySitePage, expectedCname, correctCname })), null, 2))
