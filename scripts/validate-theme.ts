/**
 * validate-theme.ts
 *
 * Static HubSpot CMS spec-compliance validator. Scans the whole theme and
 * reports EVERY violation in one pass (never fail-fast), then exits non-zero
 * if any error is found.
 *
 * Why this exists: HubSpot has no local fields.json/theme validator. Validation
 * only happens server-side during `hs upload`, which fails fast on the FIRST
 * error in the theme - so latent authoring defects (e.g. an invalid field
 * `type` like `choicegroup`, or an invalid category like `PORTAL`) get
 * discovered one-upload-at-a-time. This script surfaces them all at once,
 * before upload, so a bad theme never ships.
 *
 * Enums below encode HubSpot's documented spec. When HubSpot changes the spec,
 * edit the constant blocks - see:
 *   https://developers.hubspot.com/docs/cms/reference/fields/module-theme-fields
 *   https://developers.hubspot.com/docs/cms/reference/modules/configuration
 *
 * Run standalone:  pnpm validate
 * Called by:       pnpm build (before `hs upload`)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'

const ROOT = process.cwd()
const THEME_BASE = resolve(ROOT, 'theme') // the directory `hs upload` actually pushes
const MODULES_DIR = resolve(THEME_BASE, 'modules')

// ── HubSpot spec enums ──────────────────────────────────────────────────────

/** Valid module/theme field `type` strings (exact HubSpot spellings). */
const VALID_FIELD_TYPES = new Set([
  'text', 'richtext', 'image', 'url', 'link', 'date', 'datetime', 'embed',
  'simplemenu', 'blog', 'crm_object', 'crm_object_property', 'cta', 'email',
  'file', 'followupemail', 'form', 'hubdbrow', 'hubdbtable', 'logo', 'meeting',
  'menu', 'page', 'tag', 'videoplayer', 'boolean', 'choice', 'number', 'color',
  'font', 'icon', 'gradient', 'spacing', 'backgroundimage', 'border',
  'alignment', 'textalignment', 'group', 'audio',
])

/** Valid meta.json `categories` values (case-insensitive, max 3 per module). */
const VALID_CATEGORIES = new Set([
  'blog', 'body_content', 'commerce', 'design', 'functionality',
  'forms_and_buttons', 'media', 'social',
])

/** Valid meta.json `content_types` values. Empty array [] is also valid. */
const VALID_CONTENT_TYPES = new Set([
  'SITE_PAGE', 'LANDING_PAGE', 'BLOG_POST', 'BLOG_LISTING', 'EMAIL',
  'KNOWLEDGE_BASE', 'QUOTE_TEMPLATE', 'CUSTOMER_PORTAL', 'WEB_INTERACTIVE',
  'SUBSCRIPTION', 'MEMBERSHIP',
])

/** Field `name` must be lowercase alphanumeric + underscore - no spaces/uppercase. */
const FIELD_NAME_RE = /^[a-z0-9_]+$/

/**
 * Valid `visibility.operator` values for conditional field display, per HubSpot's
 * own published types - @hubspot/cms-components/types/fields/fieldTypes.d.ts:
 *   operator?: 'NOT_EQUAL' | 'EQUAL' | 'EMPTY' | 'NOT_EMPTY' | 'MATCHES_REGEX' | null
 * Note there is no NOT_MATCHES_REGEX - it is a long-standing open request.
 */
const VALID_VISIBILITY_OPERATORS = new Set([
  'EQUAL', 'NOT_EQUAL', 'MATCHES_REGEX', 'EMPTY', 'NOT_EMPTY',
])

/**
 * Operators that compare `controlling_value_regex` as a LITERAL string despite
 * the field's name. Pairing one with a regex pattern silently hides the field
 * forever, because e.g. `media_type` is never literally `"^image$"`.
 */
const LITERAL_VISIBILITY_OPERATORS = new Set(['EQUAL', 'NOT_EQUAL'])

/** Regex metacharacters that betray a pattern written where a literal is required. */
const REGEX_METACHAR_RE = /[\^$|()[\]*+?]/

// ── Violation collection ────────────────────────────────────────────────────

type Severity = 'error' | 'warning'
interface Violation {
  file: string // path relative to repo root
  rule: string
  severity: Severity
  message: string
}
const violations: Violation[] = []

function rel(file: string): string {
  return relative(ROOT, file) || file
}
function add(
  file: string,
  rule: string,
  message: string,
  severity: Severity = 'error',
): void {
  violations.push({ file: rel(file), rule, severity, message })
}

/** Parse JSON, recording a violation instead of throwing on failure. */
function loadJson(file: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    add(file, 'invalid_json', (e as Error).message)
    return undefined
  }
}

// ── Field visibility validation ─────────────────────────────────────────────

/**
 * HubSpot only evaluates `controlling_value_regex` as a regular expression under
 * MATCHES_REGEX / NOT_MATCHES_REGEX. Under EQUAL / NOT_EQUAL it is an exact
 * string comparison, so an anchored pattern like "^image$" can never match and
 * the field is hidden in the editor forever - with no upload-time error to
 * catch it. That defect shipped across three modules once; this rule stops it.
 */
function validateVisibility(visibility: unknown, file: string, here: string): void {
  if (typeof visibility !== 'object' || visibility === null) return
  const v = visibility as Record<string, unknown>

  const operator = v.operator
  if (typeof operator !== 'string' || !VALID_VISIBILITY_OPERATORS.has(operator)) {
    add(file, 'invalid_visibility_operator', `field "${here}": visibility operator "${String(operator)}" is not one of ${[...VALID_VISIBILITY_OPERATORS].join(', ')}`)
    return
  }

  // A condition needs something to read - either key is accepted by HubSpot.
  if (typeof v.controlling_field_path !== 'string' && typeof v.controlling_field !== 'string') {
    add(file, 'missing_controlling_field', `field "${here}": visibility needs "controlling_field_path" (or legacy "controlling_field")`)
  }

  const value = v.controlling_value_regex
  if (typeof value === 'string' && LITERAL_VISIBILITY_OPERATORS.has(operator) && REGEX_METACHAR_RE.test(value)) {
    add(file, 'visibility_operator_mismatch', `field "${here}": operator ${operator} compares "controlling_value_regex" literally, but "${value}" is a regex pattern - the field will never show. Drop the pattern characters (e.g. "image") or switch the operator to MATCHES_REGEX.`)
  }
}

// ── Field validation (recurses into group children) ─────────────────────────

function validateFields(fields: unknown, file: string, pathPrefix: string): void {
  if (!Array.isArray(fields)) {
    add(file, 'invalid_fields', `expected an array of fields at ${pathPrefix}`)
    return
  }
  for (const f of fields as Record<string, unknown>[]) {
    const name = typeof f.name === 'string' ? f.name : '?'
    const here = `${pathPrefix}/${name}`
    const type = f.type

    // Field type must be a known HubSpot type.
    if (typeof type !== 'string' || !VALID_FIELD_TYPES.has(type)) {
      add(file, 'invalid_field_type', `field "${here}": type "${String(type)}" is not a valid HubSpot field type`)
    }

    // Field name rule - ONLY the field's own `name`, never default.name (a label).
    if (typeof f.name !== 'string' || !FIELD_NAME_RE.test(f.name)) {
      add(file, 'invalid_field_name', `field "${here}": name "${String(f.name)}" must match ^[a-z0-9_]+$ (lowercase, no spaces)`)
    }

    // Multi-select choice should use display:"checkbox" + multiple:true (the
    // choicegroup→choice migration pattern). Warn, don't hard-fail.
    if (type === 'choice') {
      const looksMulti = Array.isArray(f.default) || f.multiple === true
      const correct = f.display === 'checkbox' && f.multiple === true
      if (looksMulti && !correct) {
        add(file, 'choice_multi_pattern', `field "${here}": multi-select choice should set "display":"checkbox" and "multiple":true`, 'warning')
      }
    }

    // Conditional display rules.
    validateVisibility(f.visibility, file, here)

    // Recurse into group children. Do NOT descend into menu/image defaults.
    if (type === 'group' && Array.isArray(f.children)) {
      validateFields(f.children, file, here)
    }
  }
}

// ── meta.json validation ─────────────────────────────────────────────────────

function validateMeta(meta: unknown, file: string): void {
  if (typeof meta !== 'object' || meta === null) {
    add(file, 'invalid_meta', 'meta.json must be a JSON object')
    return
  }
  const m = meta as Record<string, unknown>

  if (m.categories !== undefined) {
    if (!Array.isArray(m.categories)) {
      add(file, 'invalid_categories', '`categories` must be an array')
    } else {
      if (m.categories.length > 3) {
        add(file, 'invalid_categories', `a module may have at most 3 categories (found ${m.categories.length})`)
      }
      for (const c of m.categories) {
        if (typeof c !== 'string' || !VALID_CATEGORIES.has(c.toLowerCase())) {
          add(file, 'invalid_category', `"${String(c)}" is not a valid HubSpot module category`)
        }
      }
    }
  }

  if (m.content_types !== undefined) {
    if (!Array.isArray(m.content_types)) {
      add(file, 'invalid_content_types', '`content_types` must be an array (use [] for "available nowhere")')
    } else {
      for (const ct of m.content_types) {
        if (typeof ct !== 'string' || !VALID_CONTENT_TYPES.has(ct)) {
          add(file, 'invalid_content_type', `"${String(ct)}" is not a valid content_type value`)
        }
      }
    }
  }

  if (m.host_template_types !== undefined) {
    add(file, 'deprecated_host_template_types', '`host_template_types` is deprecated - use `content_types` instead', 'warning')
  }
}

// ── theme.json validation ────────────────────────────────────────────────────

function validateThemeJson(): void {
  const canonical = join(THEME_BASE, 'theme.json')
  const stray = join(ROOT, 'theme.json')

  if (existsSync(stray) && !existsSync(canonical)) {
    add(stray, 'misplaced_theme_json', 'theme.json must live at theme/theme.json (inside the upload root), not at the repo root - otherwise it is never uploaded with the theme')
  }

  const themeJsonPath = existsSync(canonical) ? canonical : (existsSync(stray) ? stray : undefined)
  if (!themeJsonPath) {
    add(canonical, 'missing_theme_json', 'no theme.json found at theme/theme.json')
    return
  }

  const theme = loadJson(themeJsonPath)
  if (typeof theme !== 'object' || theme === null) return
  const t = theme as Record<string, unknown>

  // Asset paths resolve relative to the manifest's directory.
  const base = themeJsonPath === canonical ? THEME_BASE : ROOT
  const assetPaths: string[] = []
  for (const key of ['preview_path', 'screenshot_path', 'global_settings_path']) {
    if (typeof t[key] === 'string') assetPaths.push(t[key] as string)
  }
  const opts = t.theme_options as Record<string, unknown> | undefined
  if (opts) {
    if (typeof opts.default_module_icon === 'string') assetPaths.push(opts.default_module_icon)
    const labelPaths = opts.label_paths as Record<string, unknown> | undefined
    if (labelPaths) {
      for (const v of Object.values(labelPaths)) {
        if (typeof v === 'string') assetPaths.push(v)
      }
    }
  }
  for (const p of assetPaths) {
    if (!existsSync(resolve(base, p))) {
      add(themeJsonPath, 'missing_theme_asset', `referenced asset "${p}" does not exist`)
    }
  }
}

// ── Asset reference integrity ────────────────────────────────────────────────
// Every static get_asset_url('…/assets/…') in the theme must resolve to a real
// file on disk. This is the gate that catches the two failure modes behind the
// recent regressions: a stale/hashed bundle reference that no longer exists, and
// an "uploaded without building" theme whose gitignored bundles/critical.css are
// missing. Only runs when build output is present (js/css are build artifacts);
// pure-HubL/dynamic get_asset_url() calls (containing {{ }}, ~ concatenation) are
// skipped - only fully-static literal paths are checkable.

const ASSET_EXT_RE = /\.(js|css|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|otf|eot|mp4|webm|pdf)$/i

function walkHtml(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'assets' || entry.startsWith('.')) continue // don't scan built assets
      walkHtml(full, out)
    } else if (entry.endsWith('.html') || entry.endsWith('.css')) {
      out.push(full)
    }
  }
}

function validateAssetReferences(): void {
  // js + critical.css are build artifacts; only meaningful once a build has run.
  if (!existsSync(join(THEME_BASE, 'assets', 'js', 'manifest.json'))) {
    add(
      join(THEME_BASE, 'assets', 'js'),
      'asset_refs_skipped',
      'no build output found (theme/assets/js/manifest.json missing) - run `pnpm build` before validating asset references',
      'warning',
    )
    return
  }

  const files: string[] = []
  walkHtml(THEME_BASE, files)
  // Static get_asset_url('literal') / "literal" only - no HubL interpolation.
  const refRe = /get_asset_url\(\s*['"]([^'"{}~+]+?)['"]\s*\)/g

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = refRe.exec(text)) !== null) {
      const raw = m[1]!.split('?')[0]!.trim()
      if (!raw.includes('assets/') || !ASSET_EXT_RE.test(raw)) continue
      const resolved = resolve(dirname(file), raw)
      if (!existsSync(resolved)) {
        // JS/CSS dangling refs are the regression class (broken React islands,
        // unstyled pages) - hard error. Missing images/fonts degrade gracefully
        // - warn so they're surfaced without blocking a deploy.
        const severity: Severity = /\.(js|css)$/i.test(raw) ? 'error' : 'warning'
        add(
          file,
          'dangling_asset_ref',
          `get_asset_url('${raw}') → ${rel(resolved)} does not exist (stale reference, or build was skipped before upload)`,
          severity,
        )
      }
    }
  }
}

/**
 * HubL comments and expressions do not nest inside a statement tag.
 *
 * `{% set x = { 'a': 1, {# note #} 'b': 2 } %}` looks harmless, but HubSpot's
 * lexer closes the `{%` at the comment, leaving an unclosed token - and the
 * error it reports is every *subsequent* if/for in the file "missing its end
 * tag", which points nowhere near the real line. Worse, the upload aborts
 * mid-batch, so the theme is left partially deployed with new bundles paired
 * against old module HTML.
 *
 * Cheap to check here, expensive to debug from HubSpot's error output.
 */
function validateNestedHubLTags(): void {
  const files: string[] = []
  walkHtml(THEME_BASE, files)
  const statementRe = /\{%([\s\S]*?)%\}/g

  for (const file of files) {
    if (!file.endsWith('.html')) continue
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = statementRe.exec(text)) !== null) {
      const body = m[1]!
      const nested = body.includes('{#') ? '{# … #}' : body.includes('{{') ? '{{ … }}' : ''
      if (!nested) continue
      const line = text.slice(0, m.index).split('\n').length
      add(
        file,
        'nested_hubl_tag',
        `line ${line}: ${nested} nested inside a {% … %} statement - HubSpot closes the statement at the nested tag and the upload fails with unrelated "missing end tag" errors. Move the comment above the statement.`,
        'error',
      )
    }
  }
}

// ── Discovery + run ──────────────────────────────────────────────────────────

function listModuleDirs(): string[] {
  if (!existsSync(MODULES_DIR)) return []
  return readdirSync(MODULES_DIR)
    .map((d) => join(MODULES_DIR, d))
    .filter((p) => p.endsWith('.module') && statSync(p).isDirectory())
}

function validateModule(dir: string): void {
  const fieldsPath = join(dir, 'fields.json')
  const metaPath = join(dir, 'meta.json')
  const htmlPath = join(dir, 'module.html')

  for (const required of [fieldsPath, metaPath, htmlPath]) {
    if (!existsSync(required)) {
      add(required, 'missing_required_file', `module is missing ${relative(dir, required)}`)
    }
  }

  if (existsSync(fieldsPath)) {
    const fields = loadJson(fieldsPath)
    if (fields !== undefined) validateFields(fields, fieldsPath, '')
  }
  if (existsSync(metaPath)) {
    const meta = loadJson(metaPath)
    if (meta !== undefined) validateMeta(meta, metaPath)
  }
}

// Theme-level global fields.
const themeFields = join(THEME_BASE, 'fields.json')
if (existsSync(themeFields)) {
  const fields = loadJson(themeFields)
  if (fields !== undefined) validateFields(fields, themeFields, '')
}

validateThemeJson()
for (const dir of listModuleDirs()) validateModule(dir)
validateAssetReferences()
validateNestedHubLTags()

// ── Report ───────────────────────────────────────────────────────────────────

const DIVIDER = '─'.repeat(72)
const errors = violations.filter((v) => v.severity === 'error')
const warnings = violations.filter((v) => v.severity === 'warning')

console.log('\nHubSpot Theme Spec Compliance Report')
console.log(DIVIDER)

if (violations.length === 0) {
  console.log('✅ No spec violations found.')
  console.log(DIVIDER + '\n')
  process.exit(0)
}

const byFile = new Map<string, Violation[]>()
for (const v of violations) {
  const arr = byFile.get(v.file) ?? []
  arr.push(v)
  byFile.set(v.file, arr)
}
for (const [file, vs] of [...byFile.entries()].sort()) {
  console.log(file)
  for (const v of vs) {
    const mark = v.severity === 'error' ? '✗' : '⚠'
    console.log(`  ${mark} ${v.rule.padEnd(28)} ${v.message}`)
  }
}

console.log(DIVIDER)
console.log(`  ${errors.length} error(s), ${warnings.length} warning(s) across ${byFile.size} file(s)\n`)

process.exit(errors.length > 0 ? 1 : 0)
