/**
 * Wraps `hs upload` with environment switching. Usage:
 *   tsx scripts/upload.ts --env=staging
 *   tsx scripts/upload.ts --env=production
 *   tsx scripts/upload.ts --env=staging --dry-run
 *   tsx scripts/upload.ts --env=production --with-serverless
 *     (attempt corporate.functions; Content Hub Enterprise only)
 *
 * Auth sources (first match wins per account):
 *   1. hubspot.config.yml in the project root (gitignored, for @hubspot/cli)
 *   2. ~/.hscli/config.yml (global HubSpot CLI v7+/v8)
 *
 * Uses the local `node_modules/.bin/hs`. Modern HubSpot CLI versions expose
 * CMS uploads as `hs cms upload`; this script keeps the command explicit and
 * compatible with v8. Both local and global CLIs
 * block CMS upload when `hsproject.json` is present - this script briefly
 * renames that file for the duration of the CMS theme upload.
 *
 * Uploads run in small batches with retries because HubSpot's edge (Cloudflare)
 * returns empty 403s when the CLI's default concurrency (10) floods the API.
 */
import { spawnSync } from 'node:child_process'
import {
  readFileSync,
  existsSync,
  renameSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// Portal ids live in ONE place. This file used to keep its own copy, which is
// how `upload:staging` ended up deploying to production.
import { ACCOUNT_MAP, normaliseEnv, type HubSpotEnv } from './lib/hubspot-auth'

const THEME_SRC = 'theme'
const THEME_NAME = 'weld-australia-theme'
const PROJECT_CONFIG = 'hubspot.config.yml'
const HSPROJECT_FILE = 'hsproject.json'
const HSPROJECT_PARKED = 'hsproject.json.__upload_tmp'
const HSCLI_CONFIG = join(homedir(), '.hscli', 'config.yml')
const MAX_RETRIES = 4
const RETRY_BASE_MS = 2500
const BATCH_PAUSE_MS = 750


const args = process.argv.slice(2)
const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

function getFlag(name: string): string | undefined {
  const arg = args.find((a) => a.startsWith(`--${name}=`))
  return arg?.split('=')[1]
}

// Staging (443253065) and production (441838610) are DIFFERENT portals.
// `--env` names one of them and that is where the theme goes; there is no
// fallback from one to the other. An unauthenticated portal is a missing
// `hs auth`, and it used to be a silent redirect to the live site instead.
const rawEnv = getFlag('env') ?? 'staging'
const dryRun = args.includes('--dry-run')
// Design Manager `*.functions` folders require Content Hub Enterprise.
// Weld Aus is on Professional — uploading corporate.functions always fails with
// "does not have access to serverless functions" and used to abort the whole
// theme deploy after the theme had already uploaded. Skip unless explicitly
// requested (e.g. after an Enterprise upgrade).
const withServerless = args.includes('--with-serverless')

const env: HubSpotEnv | null = normaliseEnv(rawEnv)
if (!env) {
  console.error(`[upload] Unknown --env="${rawEnv}". Must be staging or production.`)
  process.exit(1)
}

type CliAccount = {
  name: string
  portalId: number
  personalAccessKey?: string
  source: 'project' | 'hscli'
  /**
   * Whether the entry carries the `auth.tokenInfo` block @hubspot/cli v8 reads
   * for personalaccesskey accounts. An entry without it makes every `hs cms
   * upload` die on "Cannot read properties of undefined (reading 'tokenInfo')",
   * so a config file holding one is not usable even though it parses.
   */
  hasTokenInfo: boolean
}

function parseAccountsFromYaml(text: string, source: CliAccount['source']): CliAccount[] {
  const accounts: CliAccount[] = []
  // Match both v6 (`portals` / `portalId`) and v8 (`accounts` / `accountId`) shapes.
  const blocks = text.split(/\n(?=\s*-\s+name:\s*)/)
  for (const block of blocks) {
    const name = block.match(/^\s*-?\s*name:\s*(.+)\s*$/m)?.[1]?.trim()
    if (!name) continue
    const portalRaw =
      block.match(/^\s*portalId:\s*(\d+)\s*$/m)?.[1] ??
      block.match(/^\s*accountId:\s*(\d+)\s*$/m)?.[1]
    if (!portalRaw) continue
    const keyMatch =
      block.match(/personalAccessKey:\s*>-?\s*\n\s+(.+)/) ??
      block.match(/personalAccessKey:\s*(\S+)/)
    accounts.push({
      name,
      portalId: Number(portalRaw),
      personalAccessKey: keyMatch?.[1]?.trim(),
      source,
      hasTokenInfo: /^\s*tokenInfo:\s*$/m.test(block),
    })
  }
  return accounts
}

function loadAllAccounts(): CliAccount[] {
  const found: CliAccount[] = []
  const projectConfigPath = resolve(projectRoot, PROJECT_CONFIG)
  if (existsSync(projectConfigPath)) {
    found.push(...parseAccountsFromYaml(readFileSync(projectConfigPath, 'utf-8'), 'project'))
  }
  if (existsSync(HSCLI_CONFIG)) {
    found.push(...parseAccountsFromYaml(readFileSync(HSCLI_CONFIG, 'utf-8'), 'hscli'))
  }
  return found
}

/**
 * Point `hs` at the config file the resolved account actually came from.
 *
 * Accounts are only ever read from hubspot.config.yml or ~/.hscli/config.yml,
 * so one of those two files always contains the account - there is nothing to
 * generate. This used to hand-write a minimal hubspot.config.yml instead, which
 * caused two separate failures:
 *
 *   1. The generated YAML had no `auth.tokenInfo` block. @hubspot/cli v8 reads
 *      that for personalaccesskey accounts, so every batch died on
 *      "Cannot read properties of undefined (reading 'tokenInfo')" - the whole
 *      upload, on a portal that was correctly authenticated.
 *   2. It OVERWROTE hubspot.config.yml with a single-portal file for whichever
 *      portal was being deployed to, silently destroying the other portal's
 *      credentials. That is how staging auth kept disappearing.
 *
 * Hand-rolling credentials to match an evolving CLI's internal shape is a losing
 * game. Use the file `hs auth` wrote.
 */
function resolveConfigPath(account: CliAccount): string {
  const projectConfigPath = resolve(projectRoot, PROJECT_CONFIG)

  // A project entry written by the old generator parses fine but has no
  // auth.tokenInfo, so the CLI crashes on it. Prefer ~/.hscli, which `hs auth`
  // maintains, rather than handing the CLI a file we know it cannot read.
  if (account.source === 'project' && existsSync(projectConfigPath)) {
    if (account.hasTokenInfo) return projectConfigPath
    const hscliMatch = existsSync(HSCLI_CONFIG)
      ? parseAccountsFromYaml(readFileSync(HSCLI_CONFIG, 'utf-8'), 'hscli').find(
          (a) => a.portalId === account.portalId && a.hasTokenInfo,
        )
      : undefined
    if (hscliMatch) {
      console.warn(
        `[upload] ${PROJECT_CONFIG} entry for ${account.portalId} has no auth.tokenInfo ` +
          `(the CLI cannot use it); using ~/.hscli/config.yml instead.`,
      )
      return HSCLI_CONFIG
    }
    console.error(
      `[upload] ${PROJECT_CONFIG} entry for "${account.name}" (${account.portalId}) has no\n` +
        `         auth.tokenInfo block, so \`hs\` will fail with\n` +
        `         "Cannot read properties of undefined (reading 'tokenInfo')".\n` +
        `         Re-authenticate this portal: hs auth --account=${account.name}`,
    )
    process.exit(1)
  }

  if (account.source === 'hscli' && existsSync(HSCLI_CONFIG)) {
    return HSCLI_CONFIG
  }

  console.error(
    `[upload] Could not locate a usable config file containing "${account.name}" ` +
      `(${account.portalId}).\n` +
      `         Run: hs auth`,
  )
  process.exit(1)
}

function resolveAccount(envName: HubSpotEnv): CliAccount {
  const target = ACCOUNT_MAP[envName]
  const all = loadAllAccounts()

  if (all.length === 0) {
    console.error(
      `[upload] No HubSpot auth found.\n` +
        `         Authenticate with: hs auth\n` +
        `         Or copy hubspot.config.example.yml → ${PROJECT_CONFIG} and add credentials.`,
    )
    process.exit(1)
  }

  const match =
    all.find((a) => a.portalId === target.portalId) ??
    all.find((a) => target.names.includes(a.name))

  if (match) return match

  const listed = all.map((a) => `${a.name} (${a.portalId})`).join(', ')
  console.error(
    `[upload] The ${envName} portal (${target.portalId}) is not authenticated.\n` +
      `         Looking for portalId ${target.portalId} or names: ${target.names.join(', ')}\n` +
      `         Authenticated: ${listed}\n` +
      `         Run \`hs auth\` and add portal ${target.portalId}.\n` +
      `         This will NOT fall back to the other portal - staging and production\n` +
      `         are different places.`,
  )
  process.exit(1)
}

function resolveHsBinary(): string {
  const local = resolve(projectRoot, 'node_modules', '.bin', 'hs')
  // On Windows neither npm shim can be spawned directly from Node's
  // spawnSync: the POSIX shim returns ENOENT and hs.CMD returns EINVAL.
  // Invoke HubSpot's JavaScript entrypoint through Node instead.
  const localScript = resolve(projectRoot, 'node_modules', '@hubspot', 'cli', 'bin', 'hs.js')
  if (process.platform === 'win32' && existsSync(localScript)) return localScript
  if (existsSync(local)) return local
  console.warn('[upload] Local @hubspot/cli not found; falling back to PATH `hs`.')
  return 'hs'
}

/** HubSpot CLI refuses `hs upload` when hsproject.json is present. Park it. */
function withParkedHsProject<T>(fn: () => T): T {
  const src = resolve(projectRoot, HSPROJECT_FILE)
  const parked = resolve(projectRoot, HSPROJECT_PARKED)
  const wasPresent = existsSync(src)

  if (wasPresent) {
    if (existsSync(parked)) {
      console.error(
        `[upload] Found leftover ${HSPROJECT_PARKED} from a previous interrupted upload.\n` +
          `         Restore or delete it, then retry.`,
      )
      process.exit(1)
    }
    renameSync(src, parked)
  }

  const restore = () => {
    if (!wasPresent) return
    if (existsSync(parked) && !existsSync(src)) {
      renameSync(parked, src)
    }
  }

  // `finally` covers a return or a throw, but not a Ctrl-C: a signal ends the
  // process with the file still parked, which deletes a tracked file from the
  // working tree AND makes the next upload refuse to start on the leftover.
  // That is what left `hsproject.json.__upload_tmp` behind on 18 Sep 2026.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const onSignal = (signal: NodeJS.Signals) => {
    restore()
    process.off('exit', restore)
    for (const s of signals) process.off(s, onSignal)
    process.kill(process.pid, signal)
  }
  process.on('exit', restore)
  for (const s of signals) process.on(s, onSignal)

  try {
    return fn()
  } finally {
    restore()
    process.off('exit', restore)
    for (const s of signals) process.off(s, onSignal)
  }
}

function sleepSync(ms: number): void {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
    stdio: 'ignore',
  })
}

type UploadBatch = {
  src: string
  dest: string
  label: string
  /** Failures warn and continue instead of aborting the theme deploy. */
  optional?: boolean
}

/** Permanent HubSpot rejection — retrying will never help. */
const SERVERLESS_DENIED_RE =
  /does not have\s*access to serverless functions|Folder name cannot end with \.functions/i

function buildBatches(): UploadBatch[] {
  const themeRoot = resolve(projectRoot, THEME_SRC)
  const batches: UploadBatch[] = []

  // assets first: hashed JS/CSS bundles must exist before the module/template
  // HTML that references their fingerprinted URLs goes live, or React islands
  // 404 during the deploy window.
  // templates before modules: modules that `{% import %}` theme partials fail
  // HubL validation if the partial is not yet on the portal (see
  // job-board-open-positions → _job-apply.html).
  const topLevelDirs = ['assets', 'global-content', 'sections', 'templates', 'modules']
  for (const dir of topLevelDirs) {
    const abs = join(themeRoot, dir)
    if (!existsSync(abs)) continue
    if (dir === 'templates') {
      // Upload templates file-by-file so one HubL validation error doesn't
      // fail the entire templates/ tree mid-batch.
      //
      // HubSpot validates `{% import %}` against files already on the portal,
      // not the rest of this deploy batch. Partials must land before any page
      // or layout that imports them (same reason templates precede modules).
      // Walk order: partials → layouts → everything else (email, pages, system).
      const walkFiles = (dirPath: string, into: string[]) => {
        for (const entry of readdirSync(dirPath).sort()) {
          if (entry.startsWith('.')) continue
          const full = join(dirPath, entry)
          const st = statSync(full)
          if (st.isDirectory()) {
            walkFiles(full, into)
            continue
          }
          into.push(full)
        }
      }
      const partialsFirst: string[] = []
      const layoutsNext: string[] = []
      const rest: string[] = []
      for (const entry of readdirSync(abs).sort()) {
        if (entry.startsWith('.')) continue
        const full = join(abs, entry)
        if (!statSync(full).isDirectory()) {
          rest.push(full)
          continue
        }
        if (entry === 'partials') walkFiles(full, partialsFirst)
        else if (entry === 'layouts') walkFiles(full, layoutsNext)
        else walkFiles(full, rest)
      }
      for (const full of [...partialsFirst, ...layoutsNext, ...rest]) {
        const rel = relative(projectRoot, full)
        const destRel = relative(themeRoot, full)
        batches.push({
          src: rel,
          dest: `${THEME_NAME}/${destRel}`,
          label: destRel,
        })
      }
      continue
    }
    if (dir === 'assets') {
      for (const assetDir of ['css', 'fonts', 'img']) {
        const assetAbs = join(abs, assetDir)
        if (!existsSync(assetAbs)) continue
        batches.push({
          src: relative(projectRoot, assetAbs),
          dest: `${THEME_NAME}/assets/${assetDir}`,
          label: `assets/${assetDir}`,
        })
      }
      // JS: split so Cloudflare is less likely to 403 the CLI's concurrency=10 flood.
      const jsRoot = join(abs, 'js')
      if (existsSync(jsRoot)) {
        const cssAssets = join(jsRoot, 'assets')
        if (existsSync(cssAssets)) {
          batches.push({
            src: relative(projectRoot, cssAssets),
            dest: `${THEME_NAME}/assets/js/assets`,
            label: 'assets/js/assets (css)',
          })
        }
        const chunks = join(jsRoot, 'chunks')
        if (existsSync(chunks)) {
          // Individual files - folder upload trips Cloudflare 403s (CLI concurrency=10).
          for (const file of readdirSync(chunks)) {
            const full = join(chunks, file)
            if (!statSync(full).isFile()) continue
            if (file.endsWith('.map')) continue
            batches.push({
              src: relative(projectRoot, full),
              dest: `${THEME_NAME}/assets/js/chunks/${file}`,
              label: `assets/js/chunks/${file}`,
            })
          }
        }
        // Remaining top-level JS files (entry + standalone) - upload individually.
        for (const file of readdirSync(jsRoot)) {
          const full = join(jsRoot, file)
          if (!statSync(full).isFile()) continue
          if (file.endsWith('.map')) continue
          if (file === 'manifest.json') {
            batches.push({
              src: relative(projectRoot, full),
              dest: `${THEME_NAME}/assets/js/manifest.json`,
              label: 'assets/js/manifest.json',
            })
            continue
          }
          if (!file.endsWith('.js')) continue
          batches.push({
            src: relative(projectRoot, full),
            dest: `${THEME_NAME}/assets/js/${file}`,
            label: `assets/js/${file}`,
          })
        }
      }
      continue
    }
    batches.push({
      src: relative(projectRoot, abs),
      dest: `${THEME_NAME}/${dir}`,
      label: dir,
    })
  }

  // Theme root files (theme.json, fields.json, etc.)
  for (const file of readdirSync(themeRoot)) {
    const full = join(themeRoot, file)
    if (!statSync(full).isFile()) continue
    batches.push({
      src: relative(projectRoot, full),
      dest: `${THEME_NAME}/${file}`,
      label: file,
    })
  }

  // Design Manager serverless (issue 8 corporate team writes). Lives at the
  // Design Manager root — not inside the theme — so endpoints resolve at
  // `/_hcms/api/corporate/*`. Content Hub Enterprise only — see --with-serverless.
  const functionsRoot = resolve(projectRoot, 'corporate.functions')
  if (existsSync(functionsRoot) && statSync(functionsRoot).isDirectory()) {
    if (withServerless) {
      batches.push({
        src: relative(projectRoot, functionsRoot),
        dest: 'corporate.functions',
        label: 'corporate.functions',
        optional: true,
      })
    } else {
      console.warn(
        '[upload] Skipping corporate.functions — Content Hub Professional cannot host ' +
          'Design Manager serverless (Enterprise only). Theme deploy continues; issue 8 ' +
          'add/remove stays on mailto / Worker token until Enterprise or --with-serverless.',
      )
    }
  }

  return batches
}

function runHsUpload(
  hsBin: string,
  configPath: string,
  accountName: string,
  src: string,
  dest: string,
): { code: number; output: string } {
  // Pipe + relay so we can detect permanent errors (e.g. serverless denied)
  // without losing the CLI's output.
  const isNodeScript = hsBin.endsWith('.js')
  const result = spawnSync(
    isNodeScript ? process.execPath : hsBin,
    [
      ...(isNodeScript ? [hsBin] : []),
      'cms',
      'upload',
      src,
      dest,
      `--account=${accountName}`,
      `--config=${configPath}`,
    ],
    {
      encoding: 'utf8',
      shell: false,
      cwd: projectRoot,
      env: process.env,
    },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) {
    console.error(`[upload] Failed to launch hs CLI: ${result.error.message}`)
    return { code: 1, output: `${output}${result.error.message}` }
  }
  return { code: result.status ?? 1, output }
}

function uploadBatchWithRetry(
  hsBin: string,
  configPath: string,
  accountName: string,
  batch: UploadBatch,
): boolean {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[upload] → ${batch.label}${attempt > 1 ? ` (retry ${attempt}/${MAX_RETRIES})` : ''}`)
    const { code, output } = runHsUpload(hsBin, configPath, accountName, batch.src, batch.dest)
    if (code === 0) return true

    if (SERVERLESS_DENIED_RE.test(output)) {
      const msg =
        `[upload] ${batch.label}: this portal has no Design Manager serverless ` +
        `(Content Hub Enterprise required).`
      if (batch.optional) {
        console.warn(`${msg} Optional batch skipped; theme deploy continues.`)
        return true
      }
      console.error(msg)
      return false
    }

    if (attempt < MAX_RETRIES) {
      const wait = RETRY_BASE_MS * attempt
      console.warn(`[upload] Batch failed (exit ${code}). Waiting ${wait}ms before retry…`)
      sleepSync(wait)
    }
  }
  if (batch.optional) {
    console.warn(
      `[upload] Optional batch ${batch.label} failed after ${MAX_RETRIES} attempts; continuing.`,
    )
    return true
  }
  console.error(`[upload] Giving up on ${batch.label} after ${MAX_RETRIES} attempts`)
  return false
}

const account = resolveAccount(env)
const configPath = resolveConfigPath(account)
const hsBin = resolveHsBinary()
const batches = buildBatches()

if (dryRun) {
  console.log(`[upload] dry-run - would upload ${batches.length} batches to ${account.name} (${account.portalId}):`)
  for (const b of batches) {
    console.log(`         ${b.src} → ${b.dest}`)
  }
  console.log(`         (hsproject.json briefly parked during upload)`)
  process.exit(0)
}

console.log(
  `[upload] Uploading theme to ${account.name} (${account.portalId}, env=${env}) in ${batches.length} batches…`,
)

// Batches are ordered assets-first so hashed bundles exist before the module/
// template HTML that references them goes live. If a batch fails all its
// retries, ABORT immediately rather than continuing: uploading the referencing
// HTML on top of a missing/half-uploaded asset is exactly the half-deployed,
// broken-island state we want to avoid. Better a stopped deploy than a live
// broken one - re-run to resume.
let aborted: string | null = null
const code = withParkedHsProject(() => {
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    const ok = uploadBatchWithRetry(hsBin, configPath, account.name, batch)
    if (!ok) {
      aborted = batch.label
      return 1
    }
    if (i < batches.length - 1) sleepSync(BATCH_PAUSE_MS)
  }
  return 0
})

if (aborted) {
  console.error(
    `[upload] ABORTED after "${aborted}" failed all ${MAX_RETRIES} retries.\n` +
      `         The theme is PARTIALLY uploaded. Because bundle filenames are stable,\n` +
      `         new JS/CSS may now be paired with not-yet-uploaded module/template HTML,\n` +
      `         so live islands can be briefly mismatched until the deploy completes.\n` +
      `         Re-run this upload NOW to finish (hs upload is idempotent - completed\n` +
      `         batches are simply re-sent). The cause is often a Cloudflare 403 under\n` +
      `         load; waiting a minute before the re-run usually clears it.`,
  )
} else {
  console.log(`[upload] Theme upload complete → ${THEME_NAME} on portal ${account.portalId}`)
}

process.exit(code)
