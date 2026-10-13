/**
 * Resolves a HubSpot API access token for HubDB scripts.
 *
 * Order:
 *   1. HUBSPOT_ACCESS_TOKEN_<ENV> or HUBSPOT_ACCESS_TOKEN (private-app token)
 *   2. Personal access key from hubspot.config.yml / ~/.hscli/config.yml,
 *      exchanged via HubSpot's localdevauth refresh endpoint (same path the CLI uses)
 *
 * Portal IDs match scripts/upload.ts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type HubSpotEnv = 'staging' | 'production'

export type ResolvedToken = {
  accessToken: string
  source: 'env' | 'cli'
  portalId: number
  accountName: string
  tokenEnvName: string
}

/**
 * The two Weld Australia portals. There are exactly two, they are DIFFERENT
 * places, and staging is not production.
 *
 *   staging     443253065   where changes are proved before the client sees them
 *   production  441838610   the live weldaustralia.com.au site
 *
 * This map is the single source of truth - scripts/upload.ts imports it rather
 * than keeping its own copy. Two copies is how the ids drifted apart from their
 * labels in the first place.
 *
 * `names` are the aliases these portals may carry across hubspot.config.yml and
 * ~/.hscli/config.yml. Note what is NOT in production's list: "weld-australia-
 * staging". It used to be, from when this file believed staging and production
 * were one portal under two names - so authenticating the real staging portal
 * under its obvious name resolved it to production and deployed there.
 */
export const ACCOUNT_MAP: Record<
  HubSpotEnv,
  { portalId: number; preferredName: string; names: string[] }
> = {
  staging: {
    portalId: 443253065,
    preferredName: 'weld-australia-staging',
    // 'weld-australia-dev' is what `hs auth` named this portal in practice.
    // Matching is by portalId first, so the list is a convenience, not a gate.
    names: ['weld-australia-staging', 'weld-australia-dev', 'weld-australia-sandbox']
  },
  production: {
    portalId: 441838610,
    preferredName: 'weld-australia',
    names: ['weld-australia', 'weld-australia-production']
  }
}

/**
 * `sandbox` was the old name for the staging portal. Accepted so existing
 * commands, CI jobs and muscle memory keep working, but it resolves to staging
 * and says so - it never reaches production.
 */
export function normaliseEnv(raw: string): HubSpotEnv | null {
  if (raw === 'staging' || raw === 'production') return raw
  if (raw === 'sandbox') {
    console.warn(
      '[hubspot-auth] --env=sandbox is the old name for the staging portal ' +
        `(${ACCOUNT_MAP.staging.portalId}); treating it as --env=staging.`
    )
    return 'staging'
  }
  return null
}

const HSCLI_CONFIG = join(homedir(), '.hscli', 'config.yml')
const LOCALDEVAUTH_REFRESH = 'https://api.hubapi.com/localdevauth/v1/auth/refresh'

type CliAccount = {
  name: string
  portalId: number
  personalAccessKey?: string
}

function projectRoot(): string {
  return resolve(process.cwd())
}

/**
 * Extract a YAML scalar that may be plain or a `>` / `>-` folded block.
 * Stops at the next key with the same indent so nested `auth.tokenInfo.accessToken`
 * is not glued onto `personalAccessKey`.
 */
function extractYamlScalar(block: string, key: string): string | undefined {
  const keyRe = new RegExp(`^([ \\t]*)${key}:\\s*(.*)$`, 'm')
  const keyMatch = block.match(keyRe)
  if (!keyMatch) return undefined

  const indent = keyMatch[1] ?? ''
  const rest = (keyMatch[2] ?? '').trim()

  if (rest === '>' || rest === '>-' || rest === '|' || rest === '|-') {
    const afterIdx = block.indexOf(keyMatch[0]) + keyMatch[0].length
    const lines: string[] = []
    for (const line of block.slice(afterIdx).split('\n')) {
      if (line.trim() === '') {
        if (lines.length) break
        continue
      }
      // Same (or less) indent as the key → next sibling property / end of block.
      if (!line.startsWith(indent) || !/^[ \t]/.test(line.slice(indent.length))) break
      lines.push(line.trim())
    }
    return lines.length ? lines.join('') : undefined
  }

  if (rest) return rest.replace(/^['"]|['"]$/g, '')
  return undefined
}

function parseAccountsFromYaml(text: string): CliAccount[] {
  const accounts: CliAccount[] = []
  const blocks = text.split(/\n(?=\s*-\s+name:\s*)/)
  for (const block of blocks) {
    const name = block.match(/^\s*-?\s*name:\s*(.+)\s*$/m)?.[1]?.trim()
    if (!name) continue
    const portalRaw =
      block.match(/^\s*portalId:\s*(\d+)\s*$/m)?.[1] ??
      block.match(/^\s*accountId:\s*(\d+)\s*$/m)?.[1]
    if (!portalRaw) continue
    accounts.push({
      name,
      portalId: Number(portalRaw),
      personalAccessKey: extractYamlScalar(block, 'personalAccessKey')
    })
  }
  return accounts
}

function loadAllAccounts(): CliAccount[] {
  const found: CliAccount[] = []
  const projectConfig = resolve(projectRoot(), 'hubspot.config.yml')
  if (existsSync(projectConfig)) {
    found.push(...parseAccountsFromYaml(readFileSync(projectConfig, 'utf-8')))
  }
  if (existsSync(HSCLI_CONFIG)) {
    found.push(...parseAccountsFromYaml(readFileSync(HSCLI_CONFIG, 'utf-8')))
  }
  return found
}

function resolveCliAccount(env: HubSpotEnv): CliAccount | null {
  const target = ACCOUNT_MAP[env]
  const all = loadAllAccounts()
  if (all.length === 0) return null

  const match =
    all.find((a) => a.portalId === target.portalId) ??
    all.find((a) => target.names.includes(a.name) || a.name === target.preferredName)

  if (match?.personalAccessKey) {
    return match
  }

  // No cross-portal fallback. An unauthenticated staging portal is a missing
  // `hs auth`, not an invitation to write to the live site - the old fallback
  // silently pointed "let me test on staging" at production.
  return null
}

async function exchangePersonalAccessKey(personalAccessKey: string): Promise<string> {
  const res = await fetch(LOCALDEVAUTH_REFRESH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encodedOAuthRefreshToken: personalAccessKey })
  })
  const data = (await res.json()) as {
    oauthAccessToken?: string
    message?: string
    status?: string
  }
  if (!res.ok || !data.oauthAccessToken) {
    throw new Error(
      `CLI personal-access-key exchange failed (${res.status}): ${
        data.message ?? JSON.stringify(data)
      }`
    )
  }
  return data.oauthAccessToken
}

/**
 * Resolve an access token for the given env. Throws / process.exit is left to
 * the caller - this returns null only when nothing can be resolved.
 */
export async function resolveHubSpotAccessToken(
  env: HubSpotEnv,
  opts: {
    logPrefix?: string
    /**
     * Where the informational "using CLI personal access key" line goes.
     * Defaults to stdout, which is what every human-facing script wants. A
     * script whose stdout is a machine-readable document (audit-event-engine
     * --json) passes 'stderr', because a banner printed ahead of the document
     * makes it invalid JSON for exactly the callers who asked for JSON.
     */
    logTo?: 'stdout' | 'stderr'
  } = {}
): Promise<ResolvedToken> {
  const log = opts.logPrefix ?? '[hubspot-auth]'
  // Warnings already go to stderr; this only moves the info line.
  const info = opts.logTo === 'stderr' ? console.error : console.log
  const tokenEnvName = `HUBSPOT_ACCESS_TOKEN_${env.toUpperCase()}`
  // HUBSPOT_ACCESS_TOKEN_SANDBOX was this portal's variable before it was
  // called staging. Still honoured so a CI secret set under the old name keeps
  // working; nothing needs renaming in a hurry.
  const legacyEnvName = env === 'staging' ? 'HUBSPOT_ACCESS_TOKEN_SANDBOX' : null

  const fromEnv =
    process.env[tokenEnvName] ??
    (legacyEnvName ? process.env[legacyEnvName] : undefined) ??
    process.env.HUBSPOT_ACCESS_TOKEN
  if (fromEnv) {
    const target = ACCOUNT_MAP[env]
    return {
      accessToken: fromEnv,
      source: 'env',
      portalId: target.portalId,
      accountName: target.preferredName,
      tokenEnvName
    }
  }

  const resolved = resolveCliAccount(env)
  if (!resolved) {
    const target = ACCOUNT_MAP[env]
    throw new Error(
      `No HubSpot credentials found for ${env} (portal ${target.portalId}). ` +
        `Run \`hs auth\` and add that portal, or set ${tokenEnvName} / HUBSPOT_ACCESS_TOKEN. ` +
        `This will not fall back to the other portal.`
    )
  }

  const accessToken = await exchangePersonalAccessKey(resolved.personalAccessKey!)
  info(
    `${log} using CLI personal access key for ${resolved.name} ` +
      `(portal ${resolved.portalId})`
  )

  return {
    accessToken,
    source: 'cli',
    portalId: resolved.portalId,
    accountName: resolved.name,
    tokenEnvName
  }
}
