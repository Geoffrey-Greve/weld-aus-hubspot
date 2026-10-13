import fs from 'node:fs'
import path from 'node:path'
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const config = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, '.hscli', 'config.yml'), 'utf8'))
const dev = config.accounts.find((entry) => entry.name === 'weld-australia-sandbox')
const response = await fetch('https://api.hubapi.com/cms/v3/hubdb/tables/courses/rows?limit=20', {
  headers: { Authorization: `Bearer ${dev.auth.tokenInfo.accessToken}` },
})
if (!response.ok) throw new Error(`Dev courses request failed: ${response.status}`)
const data = await response.json()
console.log(JSON.stringify((data.results ?? []).map((row) => ({ path: row.path, slug: row.values?.course_slug })).filter((row) => row.path || row.slug), null, 2))
