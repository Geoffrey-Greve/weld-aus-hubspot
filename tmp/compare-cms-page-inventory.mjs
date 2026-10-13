/* Read-only production/Dev CMS page inventory comparison. */
import fs from 'node:fs'
import path from 'node:path'
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const config = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, '.hscli', 'config.yml'), 'utf8'))
const account = (name) => config.accounts.find((entry) => entry.name === name)
const production = account('staging')
const dev = account('weld-australia-sandbox')

async function request(accountConfig, pathname) {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    headers: { Authorization: `Bearer ${accountConfig.auth.tokenInfo.accessToken}` },
  })
  if (response.status === 404) return { results: [] }
  if (!response.ok) throw new Error(`${pathname}: ${response.status}: ${await response.text()}`)
  return response.json()
}

async function allPages(accountConfig, endpoint) {
  const pages = []
  let after = ''
  do {
    const result = await request(accountConfig, `${endpoint}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
    pages.push(...(result.results ?? []))
    after = result.paging?.next?.after ?? ''
  } while (after)
  return pages
}

const types = [
  ['website pages', '/cms/v3/pages/site-pages'],
  ['landing pages', '/cms/v3/pages/landing-pages'],
]

const report = []
for (const [label, endpoint] of types) {
  const [live, sandbox] = await Promise.all([allPages(production, endpoint), allPages(dev, endpoint)])
  const devPaths = new Set(sandbox.map((page) => page.slug || page.path).filter(Boolean))
  report.push({
    type: label,
    productionCount: live.length,
    devCount: sandbox.length,
    productionPathsMissingFromDev: live.filter((page) => !devPaths.has(page.slug || page.path)).length,
    devPublished: sandbox.filter((page) => page.state === 'PUBLISHED').length,
  })
}
console.log(JSON.stringify(report, null, 2))
