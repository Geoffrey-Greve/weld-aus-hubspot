/* Creates one clearly labelled Dev-only Course Modules row for render testing. */
import fs from 'node:fs'
import path from 'node:path'
import yaml from '../.tools/hubspot-cli/node_modules/js-yaml/index.js'

const config = yaml.load(fs.readFileSync(path.join(process.env.USERPROFILE, '.hscli', 'config.yml'), 'utf8'))
const dev = config.accounts.find((entry) => entry.name === 'weld-australia-sandbox')
const headers = { Authorization: `Bearer ${dev.auth.tokenInfo.accessToken}`, 'Content-Type': 'application/json' }

async function request(method, pathname, body) {
  const response = await fetch(`https://api.hubapi.com${pathname}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status}: ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

const table = 'course_modules'
const current = await request('GET', `/cms/v3/hubdb/tables/${table}/rows/draft?limit=100`)
const fixtureName = 'DEV TEST — Module display verification'
const existing = (current.results ?? []).find((row) => row.values?.name === fixtureName)
if (!existing) {
  await request('POST', `/cms/v3/hubdb/tables/${table}/rows/draft/batch/create`, {
    inputs: [{
      values: {
        name: fixtureName,
        parent_course_id: 'iwe',
        module_order: 999,
        show_on_website: 1,
      },
    }],
  })
} else if (existing.values?.show_on_website !== 1) {
  await request('PATCH', `/cms/v3/hubdb/tables/${table}/rows/${existing.id}/draft`, {
    values: { ...existing.values, show_on_website: 1 },
  })
}
await request('POST', `/cms/v3/hubdb/tables/${table}/draft/publish`)
console.log(JSON.stringify({ fixture: existing ? 'already-present' : 'created', tablePublished: true }, null, 2))
