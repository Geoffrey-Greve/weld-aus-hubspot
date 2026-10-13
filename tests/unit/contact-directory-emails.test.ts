import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * QA ref 63: the department email addresses in the Contact Us phone directory
 * rendered as plain text.
 *
 * `phone` has always been wrapped in a `tel:` link and there was no email field
 * at all, so Weld typed the addresses into `extension_text` - the one part of a
 * directory entry printed verbatim.
 *
 * Round one added an `email` field and linked an address in the note alone, by
 * splitting it on spaces. Production still failed: an address in any other field
 * (and in the FAQ on the same page) printed verbatim, and a non-breaking space or
 * a colon defeated the split. Round two matches addresses by pattern through the
 * shared `_linkify-emails.html`, and every text field on the page goes through it.
 */
const ROOT = resolve(__dirname, '../..')
const MODULE = 'theme/modules/contact-methods-grid.module'
const SRC = readFileSync(resolve(ROOT, MODULE, 'module.html'), 'utf8')
const CSS = readFileSync(resolve(ROOT, MODULE, 'module.css'), 'utf8')
const FIELDS = JSON.parse(readFileSync(resolve(ROOT, MODULE, 'fields.json'), 'utf8')) as {
  name: string
  children?: { name: string; type: string }[]
}[]

describe('the directory entry', () => {
  it('offers an email field an editor can fill', () => {
    const entries = FIELDS.find((f) => f.name === 'entries')
    const email = entries?.children?.find((c) => c.name === 'email')
    expect(email).toBeDefined()
    expect(email?.type).toBe('text')
  })

  it('renders that address as a mailto link', () => {
    expect(SRC).toMatch(/<a href="mailto:\{\{ entry_email \| escape_attr \}\}"/)
  })

  it.each([
    ['the department label', /\{\{ wa_email\.text\(entry\.department, /],
    ['the note', /\{\{ wa_email\.text\(entry\.extension_text, /],
    ['the intro', /\{\{ wa_email\.html\(module\.intro\) \}\}/],
    ['the directory callout', /\{\{ wa_email\.html\(module\.directory_cta\.body_text\) \}\}/],
    ['a feature card', /\{\{ wa_email\.html\(_card_body_text\) \}\}/],
    ['the legacy grid', /\{\{ wa_email\.text\(method\.value_text\) \}\}/]
  ])('links an address typed into %s', (_field, pattern) => {
    // Round two of ref 63: the first fix linked the note alone, and every other
    // field on the page still printed an address verbatim.
    expect(SRC).toMatch(pattern)
  })

  it('prints no text field raw', () => {
    expect(SRC).not.toMatch(/entry-dept">\{\{ entry\.department \}\}/)
    expect(SRC).not.toMatch(/entry-ext">\{\{ entry\.extension_text \}\}/)
    expect(SRC).not.toMatch(/card-text">\{\{ _card_body_text \}\}/)
    expect(SRC).not.toMatch(/directory-cta-body">\{\{ module\.directory_cta\.body_text \}\}/)
  })

  it('treats an address typed into the phone field as an email, not a tel: link', () => {
    expect(SRC).toMatch(/\{% if '@' in entry_phone %\}/)
    expect(SRC).not.toMatch(/href="tel:\{\{ entry\.phone/)
  })

  it('gives the email link the same treatment as the phone number', () => {
    expect(CSS).toMatch(/\.wa-contact-cards__entry-email \{/)
    expect(CSS).toMatch(/\.is-contact-page .+\.wa-contact-cards__entry-email \{/s)
  })

  it('renders an entry that carries only an email', () => {
    // The row wrapper used to gate on `phone or extension_text`, so an entry with
    // an address and nothing else would have rendered no meta line at all.
    expect(SRC).toMatch(
      /\{% if entry_phone or entry_email or entry_phone_email or entry\.extension_text %\}/
    )
  })
})

/**
 * The shared macro, exercised with the pattern and replacement the shipped
 * partial actually carries: RE2 and JavaScript agree on this syntax (no
 * lookarounds, no backslashes), so editing the partial moves this test with it.
 */
describe('_linkify-emails.html', () => {
  const PARTIAL = readFileSync(resolve(ROOT, 'theme/templates/partials/_linkify-emails.html'), 'utf8')
  const call = PARTIAL.match(/regex_replace\('([^']+)', '([^']*)' ~ cls ~ '([^']*)'\)/)

  it('found the pattern in the shipped partial', () => {
    expect(call).not.toBeNull()
  })

  const pattern = new RegExp(call?.[1] ?? 'x^', 'g')
  const replacement = (cls: string) => `${call?.[2]}${cls}${call?.[3]}`

  /** HubL's `text` macro. */
  function text(raw: string, cls = ''): string {
    return raw.replace(pattern, replacement(cls))
  }

  /**
   * HubL's `html` macro, step for step: split on `<a`, keep each anchor verbatim,
   * link the text either side of it.
   */
  function html(raw: string, cls = ''): string {
    const pieces = raw.split('<a')
    return pieces
      .map((piece, i) => {
        if (i === 0) return text(piece, cls)
        const close = piece.indexOf('</a>')
        if (close === -1) return `<a${text(piece, cls)}`
        return `<a${piece.slice(0, close)}</a>${text(piece.slice(close + 4), cls)}`
      })
      .join('')
  }

  it('the shipped html macro steps round anchors rather than skipping the block', () => {
    expect(PARTIAL).toMatch(/\|split\('<a'\)/)
    expect(PARTIAL).toMatch(/'<\/a>' in _piece/)
    expect(PARTIAL).not.toMatch(/if '<a ' in _lower/)
  })

  it('carries no lookaround, which HubSpot regex engine refuses', () => {
    expect(call?.[1]).not.toMatch(/\(\?[=!<]/)
    expect(call?.[1]).not.toContain('\\')
  })

  it.each([
    ['training@weldaustralia.com.au', 'training@weldaustralia.com.au'],
    ['Email training@weldaustralia.com.au.', 'training@weldaustralia.com.au'],
    ['select option 1 or training@weldaustralia.com.au,', 'training@weldaustralia.com.au'],
    ['(training@weldaustralia.com.au)', 'training@weldaustralia.com.au'],
    ['Email:membership@weldaustralia.com.au', 'membership@weldaustralia.com.au'],
    ['Email membership@weldaustralia.com.au', 'membership@weldaustralia.com.au'],
    ['<p>emailing membership@weldaustralia.com.au.</p>', 'membership@weldaustralia.com.au'],
    ['Membership<br>membership@weldaustralia.com.au', 'membership@weldaustralia.com.au'],
    ['first.last+events@weld-aus.com.au', 'first.last+events@weld-aus.com.au']
  ])('links the address in %j', (raw, address) => {
    const out = text(raw)
    expect(out).toContain(`<a href="mailto:${address}" class="wa-email-link `)
    expect(out).toContain(`>${address}</a>`)
    expect(out.match(/<a /g)?.length).toBe(1)
  })

  it('links every address in a field, not just the first', () => {
    const out = text('training@weldaustralia.com.au/membership@weldaustralia.com.au')
    expect(out.match(/href="mailto:/g)?.length).toBe(2)
  })

  it('keeps the full stop ending a sentence outside the link', () => {
    expect(text('write to info@weldaustralia.com.au.')).toMatch(/<\/a>\.$/)
  })

  it('carries the caller class', () => {
    expect(text('a@b.com', 'wa-contact-cards__entry-email')).toContain(
      'class="wa-email-link wa-contact-cards__entry-email"'
    )
  })

  it.each(['select option 5', '1800 189 900', 'weldaustralia.com.au', '@weldaustralia', 'a@b'])(
    'leaves %j alone',
    (raw) => {
      expect(text(raw)).toBe(raw)
    }
  )

  it('leaves a rich text block the editor already linked exactly as written', () => {
    const linked = '<p>Email <a href="mailto:membership@weldaustralia.com.au">membership@weldaustralia.com.au</a></p>'
    expect(html(linked)).toBe(linked)
  })

  it('still links a bare address in a block that also links somewhere else', () => {
    const out = html('<p><a href="/forms/enquiry">Enquire</a> or email info@weldaustralia.com.au</p>')
    expect(out).toContain('<a href="/forms/enquiry">Enquire</a>')
    expect(out).toContain('href="mailto:info@weldaustralia.com.au"')
  })

  it('does not read <abbr> or <aside> as an existing link', () => {
    expect(html('<aside>a@b.com</aside>')).toContain('href="mailto:a@b.com"')
  })
})

describe('the rest of the Contact Us page', () => {
  it('links the FAQ answers, whose own defaults carry the membership address', () => {
    const faq = readFileSync(resolve(ROOT, 'theme/modules/faq-accordion.module/module.html'), 'utf8')
    expect(faq).toMatch(/import "\.\.\/\.\.\/templates\/partials\/_linkify-emails\.html" as wa_email/)
    expect(faq).toMatch(/\{\{ wa_email\.html\(_item_body_text\) \}\}/)
    expect(faq).not.toMatch(/__body">\{\{ _item_body_text \}\}/)
  })

  it('has no email-bearing module the sweep does not cover', () => {
    // A module added to the page later has to decide about addresses too.
    const page = readFileSync(resolve(ROOT, 'theme/templates/pages/contact.html'), 'utf8')
    const modules = [...page.matchAll(/path="\.\.\/\.\.\/modules\/([a-z-]+)"/g)].map((m) => m[1])
    const covered = ['contact-methods-grid', 'faq-accordion']
    // Headings, a map and a form: not where an editor types a department address.
    const noFreeText = ['hero', 'locations', 'contact-form', 'cta-banner']
    for (const m of modules) expect([...covered, ...noFreeText]).toContain(m)
  })
})

describe('an address typed into the phone field', () => {
  const GRID = readFileSync(
    resolve(ROOT, 'theme/modules/contact-methods-grid.module/module.html'),
    'utf8'
  )

  it('goes through the shared pattern, never straight into an href', () => {
    // "Email:membership@..." copied whole into mailto: produced a link to nowhere.
    expect(GRID).toMatch(/wa_email\.text\(entry_phone_email,/)
    expect(GRID).not.toMatch(/set entry_email = entry_phone/)
  })
})
