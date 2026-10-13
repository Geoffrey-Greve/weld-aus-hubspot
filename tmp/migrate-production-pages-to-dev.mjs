/**
 * Controlled, one-way CMS page migration.
 *
 * Production is read only. Dev pages are created as DRAFTS only. The script
 * never publishes, updates, archives, or deletes a Production page.
 *
 * Usage:
 *   node tmp/migrate-production-pages-to-dev.mjs --dry-run
 *   node tmp/migrate-production-pages-to-dev.mjs --create-drafts
 *   node tmp/migrate-production-pages-to-dev.mjs --routes-dry-run
 *   node tmp/migrate-production-pages-to-dev.mjs --restore-production-routes
 *   node tmp/migrate-production-pages-to-dev.mjs --publish-dev-drafts
 */
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')

function readEnv(file, name) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8')
  const line = source.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`))
  if (!line) throw new Error(`${name} is missing from ${file}`)
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '')
}

const productionToken = readEnv('.env.production.local', 'HUBSPOT_PRODUCTION_SERVICE_KEY')
const devToken = readEnv('.env.dev.local', 'HUBSPOT_DEV_SERVICE_KEY')
const api = 'https://api.hubapi.com'

async function request(token, method, pathname, body) {
  const response = await fetch(`${api}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${text.slice(0, 600)}`)
  return text ? JSON.parse(text) : null
}

async function all(token, endpoint, archived = false) {
  const items = []
  let after = ''
  do {
    const query = `?limit=100&archived=${archived}${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const page = await request(token, 'GET', `${endpoint}${query}`)
    items.push(...(page.results ?? []))
    after = page.paging?.next?.after ?? ''
  } while (after)
  return items
}

function replaceFormIds(value, formIds) {
  if (typeof value === 'string') {
    let result = value
    for (const [productionId, devId] of formIds) {
      result = result.replaceAll(productionId, devId)
    }
    return result
  }
  if (Array.isArray(value)) return value.map((item) => replaceFormIds(item, formIds))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceFormIds(item, formIds)]))
  }
  return value
}

function sourceToDraft(source, formIds) {
  const allowed = [
    'templatePath',
    'layoutSections',
    'htmlTitle',
    'metaDescription',
    'featuredImage',
    'featuredImageAltText',
    'headHtml',
    'footerHtml',
    'linkRelCanonicalUrl',
    'pageExpiryEnabled',
    'pageExpiryRedirectUrl',
    'pageExpiryDate',
    'includeDefaultCustomCss',
    'publicAccessRulesEnabled',
    'publicAccessRules',
    'password',
    'publicAccessRules',
  ]
  const payload = {
    name: source.name,
    slug: source.slug ?? source.path ?? '',
    state: 'DRAFT',
  }
  for (const key of allowed) {
    if (source[key] !== undefined && source[key] !== null) payload[key] = source[key]
  }
  delete payload.password
  delete payload.publicAccessRules
  return replaceFormIds(payload, formIds)
}

const createDrafts = process.argv.includes('--create-drafts')
const dryRun = process.argv.includes('--dry-run')
const confirmedUiArchive = process.argv.includes('--confirmed-ui-archive')
const inventory = process.argv.includes('--inventory')
const routesDryRun = process.argv.includes('--routes-dry-run')
const restoreProductionRoutes = process.argv.includes('--restore-production-routes')
const publishDevDrafts = process.argv.includes('--publish-dev-drafts')
if (!createDrafts && !dryRun && !inventory && !routesDryRun && !restoreProductionRoutes && !publishDevDrafts) {
  throw new Error('Choose --inventory, --dry-run, --create-drafts, --routes-dry-run, --restore-production-routes, or --publish-dev-drafts')
}

const pagesEndpoint = '/cms/v3/pages/site-pages'
const formsEndpoint = '/marketing/v3/forms'
const [productionPages, devPages, productionForms, devForms] = await Promise.all([
  all(productionToken, pagesEndpoint),
  all(devToken, pagesEndpoint),
  all(productionToken, formsEndpoint),
  all(devToken, formsEndpoint),
])

const devByFormName = new Map(devForms.map((form) => [form.name, form.id]))
const formIds = new Map()
for (const form of productionForms) {
  const devId = devByFormName.get(form.name)
  if (devId) formIds.set(form.id, devId)
}

const report = {
  productionPages: productionPages.length,
  devPagesByState: Object.fromEntries(Object.entries(Object.groupBy(devPages, (page) => page.state ?? 'UNKNOWN')).map(([state, pages]) => [state, pages.length])),
  productionForms: productionForms.length,
  matchedDevForms: formIds.size,
  operation: createDrafts ? 'create-dev-drafts' : 'dry-run',
}

if (inventory) {
  console.log(JSON.stringify(devPages.map((page) => ({ id: page.id, name: page.name, slug: page.slug, createdAt: page.createdAt, updatedAt: page.updatedAt, state: page.state })), null, 2))
  process.exit(0)
}

function uniqueByName(pages, label) {
  const grouped = Object.groupBy(pages, (page) => page.name ?? '')
  const duplicates = Object.entries(grouped).filter(([, entries]) => entries.length !== 1)
  if (duplicates.length) {
    throw new Error(`${label} has duplicate page names: ${duplicates.map(([name]) => name || '<untitled>').join(', ')}`)
  }
  return new Map(pages.map((page) => [page.name ?? '', page]))
}

if (routesDryRun || restoreProductionRoutes) {
  const migrationStartedAt = new Date('2026-09-07T02:11:00Z').getTime()
  const newDevDrafts = devPages.filter((page) => {
    const createdAt = Date.parse(page.createdAt ?? '')
    return page.state === 'DRAFT' && Number.isFinite(createdAt) && createdAt >= migrationStartedAt
  })
  if (productionPages.length !== 43 || newDevDrafts.length !== productionPages.length) {
    throw new Error(`Refusing route update: expected 43 Production pages and 43 new Dev drafts; found ${productionPages.length} and ${newDevDrafts.length}`)
  }
  const sourceByName = uniqueByName(productionPages, 'Production inventory')
  const devByName = uniqueByName(newDevDrafts, 'New Dev drafts')
  const missingInDev = [...sourceByName.keys()].filter((name) => !devByName.has(name))
  const unexpectedInDev = [...devByName.keys()].filter((name) => !sourceByName.has(name))
  if (missingInDev.length || unexpectedInDev.length) {
    throw new Error(`Refusing route update: missing in Dev=${JSON.stringify(missingInDev)}, unexpected in Dev=${JSON.stringify(unexpectedInDev)}`)
  }
  const updates = productionPages.map((source) => {
    const dev = devByName.get(source.name ?? '')
    return {
      id: dev.id,
      name: source.name,
      from: dev.slug ?? '',
      to: source.slug ?? source.path ?? '',
    }
  }).filter((item) => item.from !== item.to)

  if (routesDryRun) {
    console.log(JSON.stringify({ productionPages: productionPages.length, newDevDrafts: newDevDrafts.length, routeUpdatesNeeded: updates.length, updates }, null, 2))
    process.exit(0)
  }

  const restored = []
  for (const update of updates) {
    const page = await request(devToken, 'PATCH', `${pagesEndpoint}/${update.id}`, { slug: update.to })
    if ((page.slug ?? '') !== update.to || page.state !== 'DRAFT') {
      throw new Error(`Route verification failed for ${update.name}`)
    }
    restored.push({ name: update.name, slug: page.slug ?? '' })
  }
  console.log(JSON.stringify({ restored: restored.length, routes: restored }, null, 2))
  process.exit(0)
}

if (publishDevDrafts) {
  const migrationStartedAt = new Date('2026-09-07T02:11:00Z').getTime()
  const newDevDrafts = devPages.filter((page) => {
    const createdAt = Date.parse(page.createdAt ?? '')
    return page.state === 'DRAFT' && Number.isFinite(createdAt) && createdAt >= migrationStartedAt
  })
  if (newDevDrafts.length !== 43 || productionPages.length !== 43) {
    throw new Error(`Refusing publish: expected exactly 43 Production-derived Dev drafts; found ${newDevDrafts.length}`)
  }
  const published = []
  for (const page of newDevDrafts) {
    const result = await request(devToken, 'POST', `${pagesEndpoint}/${page.id}/publish`)
    published.push({ name: page.name, slug: result.slug ?? page.slug ?? '', state: result.state ?? 'PUBLISHED' })
  }
  console.log(JSON.stringify({ published: published.length, pages: published }, null, 2))
  process.exit(0)
}

const activeDevPages = devPages.filter((page) => page.state !== 'ARCHIVED')
if (activeDevPages.length && !confirmedUiArchive) {
  const sample = activeDevPages.slice(0, 3).map((page) => ({ name: page.name, state: page.state, archived: page.archived, isArchived: page.isArchived, deletedAt: page.deletedAt }))
  throw new Error(`Refusing to create drafts: Dev still has ${activeDevPages.length} non-archived website pages. Sample: ${JSON.stringify(sample)}`)
}

if (dryRun) {
  const requiredMissing = productionForms.filter((form) => !formIds.has(form.id)).map((form) => form.name)
  console.log(JSON.stringify({ ...report, apiPagesRetainedAfterUiArchive: activeDevPages.length, missingDevFormCopies: requiredMissing }, null, 2))
  process.exit(0)
}

const created = []
for (const summary of productionPages) {
  const source = await request(productionToken, 'GET', `${pagesEndpoint}/${summary.id}`)
  const payload = sourceToDraft(source, formIds)
  const draft = await request(devToken, 'POST', pagesEndpoint, payload)
  created.push({ name: draft.name, slug: draft.slug, state: draft.state })
}

console.log(JSON.stringify({ ...report, created: created.length, drafts: created }, null, 2))
