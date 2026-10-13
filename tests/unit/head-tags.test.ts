/**
 * One <title>, one meta description, one canonical — per page.
 *
 * base.html renders three things into <head>, in this order:
 *   1. partials/_head.html        → <title>, <meta name="description">, og/twitter
 *   2. {{ standard_header_includes }} → HubSpot's own canonical (and its meta)
 *   3. {% block extra_head %}     → whatever the page template adds
 *
 * ~50 page templates emitted their own <title> and description from step 3, so
 * every public page shipped two or three of each. Crawlers take the FIRST, which
 * is _head.html's — and with no page_title set, _head.html falls through to
 * `content.html_title`, the HubSpot page/row name. That is why /courses/iwi-s was
 * titled "IIW Welding Inspector – Standard (IWI-S) - Online (2026-08-12 to
 * 2026-10-23)" instead of the course title, and why the /certification?pathway=
 * pages showed the generic certification title (QA ref 26). Eleven templates also
 * emitted a second <link rel="canonical"> beside HubSpot's own (QA ref 21).
 *
 * The contract now: a page sets `page_title` / `page_title_exact` /
 * `page_description` ABOVE its {% extends %}, and emits no head tags of its own.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const DIRS = ['theme/templates/pages', 'theme/templates/partials', 'theme/templates/system']

/** The one partial allowed to emit a title and description. */
const SOLE_EMITTER = 'theme/templates/partials/_head.html'

interface Template {
  path: string
  src: string
}

function templates(): Template[] {
  const out: Template[] = []
  for (const dir of DIRS) {
    for (const name of readdirSync(resolve(ROOT, dir))) {
      if (!name.endsWith('.html')) continue
      const path = `${dir}/${name}`
      out.push({ path, src: readFileSync(resolve(ROOT, path), 'utf8') })
    }
  }
  return out
}

/** Strip HubL comments so prose about <title> is not mistaken for a tag. */
function code(src: string): string {
  return src.replace(/\{#[\s\S]*?#\}/g, '')
}

const ALL = templates()

describe('head tags are emitted once, by _head.html', () => {
  it('finds the templates to check', () => {
    expect(ALL.length).toBeGreaterThan(40)
    expect(ALL.map((t) => t.path)).toContain(SOLE_EMITTER)
  })

  it.each([
    ['<title>', /<title>/i],
    ['<meta name="description">', /<meta\s+name=["']description["']/i],
  ])('no template but _head.html emits %s', (_label, pattern) => {
    const offenders = ALL.filter(
      (t) => t.path !== SOLE_EMITTER && pattern.test(code(t.src))
    ).map((t) => t.path)
    expect(offenders).toEqual([])
  })

  it('no template emits a canonical — standard_header_includes already does', () => {
    const offenders = ALL.filter((t) => /rel=["']canonical["']/i.test(code(t.src))).map(
      (t) => t.path
    )
    expect(offenders).toEqual([])
  })

  it('no template emits og:title / og:description / twitter:*, which _head.html derives', () => {
    const pattern =
      /<meta\s+(?:property|name)=["'](?:og:(?:title|description)|twitter:(?:title|description))["']/i
    const offenders = ALL.filter(
      (t) => t.path !== SOLE_EMITTER && pattern.test(code(t.src))
    ).map((t) => t.path)
    expect(offenders).toEqual([])
  })
})

describe('_head.html', () => {
  const head = ALL.find((t) => t.path === SOLE_EMITTER)!.src

  it('renders page_title_exact verbatim, ahead of the suffixed page_title', () => {
    // Existing titles already carry their own brand suffix, in several different
    // shapes ("| Weld Australia", "- Weld Australia", none at all). Hoisting them
    // into `page_title` would have appended a second one to every page.
    const exactAt = head.indexOf('page_title_exact')
    const suffixedAt = head.indexOf("page_title }} - Weld Australia")
    expect(exactAt).toBeGreaterThan(-1)
    expect(suffixedAt).toBeGreaterThan(-1)
    expect(exactAt).toBeLessThan(suffixedAt)
  })

  it('carries page_title_exact into og:title and twitter:title', () => {
    expect(head).toMatch(/_resolved_meta_title\s*=\s*page_title_exact/)
  })
})

describe('pages resolve their title above the extends', () => {
  // partials/_head.html is included by the LAYOUT, so a page's assignments after
  // its own {% extends %} run too late to reach it.
  it.each(
    ALL.map((t) => [t.path, code(t.src)] as const)
      .filter(([, src]) => /\{%-?\s*set\s+(page_title|page_title_exact|page_description)\b/.test(src))
      .filter(([, src]) => /\{%\s*extends\s/.test(src))
  )('%s', (_path, src) => {
    const extendsAt = src.search(/\{%\s*extends\s/)
    const firstSet = src.search(/\{%-?\s*set\s+(page_title|page_title_exact|page_description)\b/)
    expect(firstSet).toBeLessThan(extendsAt)
  })
})
