/**
 * check-bundle-size.ts
 *
 * Reads the Vite manifest from theme/assets/js/manifest.json, gzip-compresses
 * each entry-chunk file, and fails with exit code 1 if any entry chunk exceeds
 * BUDGET_BYTES when gzipped.
 *
 * Budget: 80 KB gzipped per entry chunk.
 *
 * Run standalone:  pnpm check:bundle
 * Called by:       pnpm build (after the Vite build completes)
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = process.cwd()
const OUT_DIR = resolve(ROOT, 'theme/assets/js')
const MANIFEST = join(OUT_DIR, 'manifest.json')
const BUDGET_BYTES = 80 * 1024 // 80 KB gzipped

if (!existsSync(MANIFEST)) {
  console.log('[bundle-size] No manifest found at theme/assets/js/manifest.json - skipping check.')
  process.exit(0)
}

type ViteManifestEntry = {
  file: string
  isEntry?: boolean
  imports?: string[]
  css?: string[]
}
type ViteManifest = Record<string, ViteManifestEntry>

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as ViteManifest

let hasViolations = false

type Row = { name: string; rawKB: string; gzipKB: string; over: boolean }
const rows: Row[] = []

for (const [key, entry] of Object.entries(manifest)) {
  if (!entry.isEntry) continue

  const filePath = join(OUT_DIR, entry.file)
  if (!existsSync(filePath)) {
    console.warn(`[bundle-size] Entry file not found on disk: ${entry.file}`)
    continue
  }

  const raw = readFileSync(filePath)
  const gzipped = gzipSync(raw, { level: 9 })
  const rawKB = (raw.byteLength / 1024).toFixed(1)
  const gzipKB = (gzipped.byteLength / 1024).toFixed(1)
  const over = gzipped.byteLength > BUDGET_BYTES

  if (over) hasViolations = true

  // Extract a readable module name from the entry key
  const match = key.match(/src\/modules\/([^/]+)\/index\.tsx$/)
  const name = (match ? match[1] : undefined) ?? key

  rows.push({ name, rawKB, gzipKB, over })
}

const COL_NAME = 42
const COL_NUM = 9
const DIVIDER = '─'.repeat(COL_NAME + COL_NUM * 2 + 18)

console.log('\nBundle Size Report  (entry chunks · gzip level 9)')
console.log(DIVIDER)
for (const row of rows.sort((a, b) => parseFloat(b.gzipKB) - parseFloat(a.gzipKB))) {
  const status = row.over ? '❌ OVER' : '✅ OK  '
  const name = row.name.padEnd(COL_NAME)
  const raw = `${row.rawKB} KB`.padStart(COL_NUM)
  const gz = `${row.gzipKB} KB gz`.padStart(COL_NUM + 3)
  console.log(`  ${status}  ${name}${raw}   ${gz}`)
}
console.log(DIVIDER)
console.log(`  Budget: ${BUDGET_BYTES / 1024} KB gzipped per entry chunk`)

if (rows.length === 0) {
  console.log('  (no entry chunks found in manifest)')
}

console.log()

if (hasViolations) {
  console.error('❌ Bundle size budget exceeded. Reduce imports or add manualChunks.\n')
  process.exit(1)
} else if (rows.length > 0) {
  console.log('✅ All entry chunks within the 80 KB gzip budget.\n')
}
