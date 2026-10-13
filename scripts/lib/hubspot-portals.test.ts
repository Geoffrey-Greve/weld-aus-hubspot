/**
 * The portal mapping is load-bearing and was wrong in production: `pnpm
 * upload:staging` deployed to the LIVE portal for as long as the repo believed
 * "staging IS production (same portal, two names)". These tests pin the ids to
 * their names so that belief cannot quietly return.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_MAP, normaliseEnv } from './hubspot-auth'

const STAGING = 443253065
const PRODUCTION = 441838610

const root = resolve(__dirname, '..', '..')
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'))

describe('portal mapping', () => {
  it('points staging and production at different portals', () => {
    expect(ACCOUNT_MAP.staging.portalId).toBe(STAGING)
    expect(ACCOUNT_MAP.production.portalId).toBe(PRODUCTION)
    expect(ACCOUNT_MAP.staging.portalId).not.toBe(ACCOUNT_MAP.production.portalId)
  })

  it('never lets a staging alias resolve to the production account', () => {
    // "weld-australia-staging" used to be listed under production, so
    // authenticating the real staging portal under its obvious name sent the
    // deploy to the live site.
    for (const name of ACCOUNT_MAP.staging.names) {
      expect(ACCOUNT_MAP.production.names).not.toContain(name)
    }
    expect(ACCOUNT_MAP.production.names).not.toContain('weld-australia-staging')
  })
})

describe('config entries the CLI cannot read', () => {
  // The old upload.ts generated a hubspot.config.yml with no auth.tokenInfo.
  // It parsed, so the uploader used it, and every batch died on
  // "Cannot read properties of undefined (reading 'tokenInfo')".
  const generated = [
    'defaultPortal: weld-australia-dev',
    '',
    'portals:',
    '  - name: weld-australia-dev',
    '    portalId: 443253065',
    '    authType: personalaccesskey',
    '    personalAccessKey: abc123',
  ].join('\n')

  const authWritten = [
    'portals:',
    '  - name: weld-australia-dev',
    '    portalId: 443253065',
    '    authType: personalaccesskey',
    '    personalAccessKey: abc123',
    '    auth:',
    '      tokenInfo:',
    "        expiresAt: '2026-09-18T00:56:28.791Z'",
  ].join('\n')

  it('distinguishes a generated entry from one hs auth wrote', () => {
    expect(/^\s*tokenInfo:\s*$/m.test(generated)).toBe(false)
    expect(/^\s*tokenInfo:\s*$/m.test(authWritten)).toBe(true)
  })
})

describe('normaliseEnv', () => {
  it('accepts the two real environments', () => {
    expect(normaliseEnv('staging')).toBe('staging')
    expect(normaliseEnv('production')).toBe('production')
  })

  it('maps the legacy "sandbox" name onto staging, never production', () => {
    expect(normaliseEnv('sandbox')).toBe('staging')
  })

  it('knows the name hs auth actually gave the staging portal', () => {
    expect(ACCOUNT_MAP.staging.names).toContain('weld-australia-dev')
  })

  it('rejects anything else rather than guessing', () => {
    for (const bad of ['prod', 'stage', 'live', '']) {
      expect(normaliseEnv(bad)).toBeNull()
    }
  })
})

describe('the deploy commands agree with the mapping', () => {
  const pkg = readJson('package.json')

  it('sends upload:staging to staging and upload:prod to production', () => {
    expect(pkg.scripts['upload:staging']).toContain('--env=staging')
    expect(pkg.scripts['upload:staging']).not.toContain('--env=production')
    expect(pkg.scripts['upload:prod']).toContain('--env=production')
  })

  it('keeps the legacy upload:sandbox alias on staging', () => {
    expect(pkg.scripts['upload:sandbox']).toContain('--env=staging')
  })

  it('matches hsproject.json when the repo carries one', () => {
    // The file was removed on main (dc34e7c) because the CLI refuses `hs upload`
    // while it exists, so `scripts/upload.ts` had to park and restore it around
    // every deploy. The assertion outlived it and took CI red on main and on every
    // branch cut from it. It stays CONDITIONAL rather than deleted: `upload.ts`
    // still parks the file if it reappears, and if it does its portal ids have to
    // agree with ACCOUNT_MAP for the same reason they always did.
    if (!existsSync(resolve(root, 'hsproject.json'))) return
    const accounts = readJson('hsproject.json').accounts
    expect(accounts.staging.portalId).toBe(STAGING)
    expect(accounts.production.portalId).toBe(PRODUCTION)
  })
})
