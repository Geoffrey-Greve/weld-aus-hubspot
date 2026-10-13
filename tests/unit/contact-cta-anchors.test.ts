import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * QA ref 15: "Enquire about / start an enquiry" on the certification pages landed
 * at the top of /contact-us - the hero, the contact cards, the phone directory and
 * the offices map - rather than on the form. Four CTAs had been missed when the
 * anchored pattern was introduced; the same slip was on training, membership,
 * engineering and the job board.
 *
 * The contract: a CTA that asks the visitor to START AN ENQUIRY carries `#enquiry`
 * (which is what scrolls, and works with JS off) and, where the page has one
 * subject, a `?topic=` alias that preselects the enquiry category. A plain "Contact
 * us" that only offers the contact page is left as it is - the directory and the
 * map are a legitimate destination, and a wrong preselection is worse than none.
 *
 * `contact-form-deeplinks.test.ts` covers the JS that reads these; this covers the
 * links that produce them, and that every alias used is one the JS knows.
 */
const ROOT = resolve(__dirname, '../..')

const FORM_JS = readFileSync(
  resolve(ROOT, 'theme/modules/contact-form.module/module.js'),
  'utf8'
)

/** Every alias key `CATEGORY_ALIASES` in the shipped module.js accepts. */
const KNOWN_ALIASES = (() => {
  const block = FORM_JS.slice(
    FORM_JS.indexOf('var CATEGORY_ALIASES = {'),
    FORM_JS.indexOf('};', FORM_JS.indexOf('var CATEGORY_ALIASES = {'))
  )
  return new Set([...block.matchAll(/'([a-z0-9-]+)':/g)].map((m) => m[1] as string))
})()

function templateSources(): { path: string; src: string }[] {
  return globSync('theme/templates/**/*.html', { cwd: ROOT }).map((path) => ({
    path,
    src: readFileSync(resolve(ROOT, path), 'utf8')
  }))
}

/**
 * Every `/contact-us…` href in the theme's page and partial templates, in both
 * shapes: a module field's `"href": "…"` and a plain `<a href="…">`. Matching only
 * the first missed the raw anchor in job-detail-inactive.html.
 */
function contactLinks(): { path: string; href: string }[] {
  return templateSources().flatMap(({ path, src }) =>
    [...src.matchAll(/(?:"href":\s*|\bhref=)"(\/contact-us[^"]*)"/g)].map((m) => ({
      path,
      href: m[1] as string
    }))
  )
}

describe('enquiry CTAs land on the form', () => {
  const ENQUIRY_PAGES = [
    'theme/templates/pages/certification.html',
    'theme/templates/pages/certification-individual.html',
    'theme/templates/pages/certification-iso3834.html',
    'theme/templates/pages/training-hub.html',
    'theme/templates/pages/training-category.html',
    'theme/templates/pages/membership-corporate.html',
    'theme/templates/pages/engineering.html',
    'theme/templates/pages/job-board.html',
    'theme/templates/partials/course-training-conversion-sections.html'
  ]

  it.each(ENQUIRY_PAGES)('%s sends every contact CTA to #enquiry', (page) => {
    const links = contactLinks().filter((l) => l.path === page)
    expect(links.length).toBeGreaterThan(0)
    for (const { href } of links) {
      expect(href, `${page}: ${href}`).toMatch(/#enquiry$/)
    }
  })

  it('preselects the certification topic on all three certification pages', () => {
    for (const page of ENQUIRY_PAGES.slice(0, 3)) {
      const links = contactLinks().filter((l) => l.path === page)
      expect(links.some((l) => l.href.includes('topic=certification'))).toBe(true)
    }
  })

  it('only uses ?topic= aliases the form actually resolves', () => {
    // An unknown alias silently preselects nothing, which looks identical to a
    // correct link until someone checks the dropdown.
    const used = contactLinks()
      .map(({ href }) => /[?&]topic=([^&#]+)/.exec(href)?.[1])
      .filter((t): t is string => Boolean(t))
    expect(used.length).toBeGreaterThan(0)
    for (const alias of used) {
      expect(KNOWN_ALIASES.has(alias), `?topic=${alias} is not in CATEGORY_ALIASES`).toBe(true)
    }
  })

  it('anchors every parameterised contact link, not just the CTAs ref 15 named', () => {
    // A ?topic= link without the anchor only scrolls because the JS notices the
    // preselection (`didPreselect` in module.js). The anchor is what makes it work
    // without JS, and makes every enquiry link on the site one shape. Three
    // pre-existing job-board links were the ones missing it.
    const parameterised = contactLinks().filter(({ href }) => href.includes('?'))
    expect(parameterised.length).toBeGreaterThan(8)
    for (const { path, href } of parameterised) {
      expect(href, `${path}: ${href}`).toMatch(/#enquiry$/)
    }
  })

  it('anchors the job-board apply fallback the HubL macro builds', () => {
    const macro = readFileSync(
      resolve(ROOT, 'theme/templates/partials/_job-apply.html'),
      'utf8'
    )
    const body = macro.slice(macro.indexOf('{% macro contact_fallback_url('))
    expect(body).toMatch(/'\/contact-us\?topic=job-board&ref=' ~ route ~ '#enquiry'/)
    expect(body).toMatch(/'\/contact-us\?topic=job-board#enquiry'/)
  })

  it('leaves a plain "Contact us" pointing at the contact page', () => {
    // Deliberate: the phone directory and the offices map are the right answer for
    // a general contact CTA, and the error pages have nothing to preselect.
    const bare = contactLinks()
      .filter(({ href }) => href === '/contact-us' || href === '/contact-us/')
      .map((l) => l.path)
    expect(bare).toContain('theme/templates/system/error-403.html')
    expect(bare).toContain('theme/templates/system/error-500.html')
  })
})
