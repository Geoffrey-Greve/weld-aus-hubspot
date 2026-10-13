/**
 * The Event Engine Worker hostname, and the one that no longer exists.
 *
 * The app launched on the Worker deployed as wrangler `[env.staging]`, so for a
 * long time `event-engine-staging.refuel-creative.workers.dev` WAS production and
 * `event-engine.refuel-creative.workers.dev` had never been deployed. These tests
 * existed to stop anyone "promoting" the `-staging` URL on the entirely reasonable
 * reading that the option labelled Production was production; commit 031a8ff did
 * exactly that on 17 Sep 2026 and took checkout down.
 *
 * That has since been REVERSED by a rename. The Worker is now `event-engine`,
 * `[env.staging]` is gone from `wrangler.toml`, and both `pnpm deploy` and
 * `pnpm deploy:staging` target `--env=""`. The `-staging` hostname no longer
 * resolves at all, so it is now the dead one - and every note, label and fallback
 * written during the old period said the opposite. A `price_mismatch` investigation
 * on 2026-09-19 was sent chasing the wrong Worker by exactly those notes.
 *
 * So the test survives, inverted: it pins which host is live and keeps the dead one
 * out of the theme entirely. When the Worker moves again, change LIVE_HOST here in
 * the same commit as the wrangler env and the theme field, deliberately.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LIVE_HOST = 'https://event-engine.refuel-creative.workers.dev'
/** The Worker's former name. Renamed, so this hostname does not resolve. */
const DEAD_HOST = 'https://event-engine-staging.refuel-creative.workers.dev'

const root = resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

interface ThemeField {
  name: string
  default?: string
  choices?: Array<[string, string]>
}
interface ThemeGroup {
  id: string
  children?: ThemeField[]
}

function workerField(): ThemeField {
  const groups = JSON.parse(read('theme/fields.json')) as ThemeGroup[]
  const field = groups
    .find((group) => group.id === 'integrations')
    ?.children?.find((child) => child.name === 'event_engine_worker_base_url')
  if (!field) throw new Error('theme/fields.json has no integrations.event_engine_worker_base_url')
  return field
}

describe('theme Event Engine worker field', () => {
  it('defaults to the live Worker, not the dead one', () => {
    expect(workerField().default).toBe(LIVE_HOST)
  })

  it('does not offer the dead host at all', () => {
    // Not relabelled: removed. It was already labelled "(not deployed yet)" and got
    // selected anyway, so a warning on the option is not the control it looked like.
    const dead = workerField().choices?.find(([value]) => value === DEAD_HOST)
    expect(dead).toBeUndefined()
  })

  it('labels the live host so an editor picks it on purpose', () => {
    // Asserts the MEANING, not a form of words. Successive sessions have fixed this
    // field and landed on different labels ("Live (production)", "Staging (currently
    // the LIVE worker)", "Production (the live worker)"); a test that dictates the
    // wording just makes the next honest edit look like a regression. What must
    // survive is that the option an editor should choose says it is live.
    const live = workerField().choices?.find(([value]) => value === LIVE_HOST)
    expect(live).toBeDefined()
    expect(live?.[1].toLowerCase()).toContain('live')
  })
})

describe('HubL worker fallbacks', () => {
  // Every surface that talks to the Worker carries a literal fallback for the
  // case where the theme setting is blank. They must all be the live host: a
  // blank setting is precisely when the fallback matters.
  const surfaces = [
    'theme/modules/checkout-tunnel.module/module.html',
    'theme/modules/course-filter.module/module.html',
    'theme/modules/corporate-admin.module/module.html',
    'theme/modules/events-listing.module/module.html',
    'theme/templates/pages/checkout.html',
    'theme/templates/pages/events.html',
    'theme/templates/pages/event-detail.html',
  ]

  for (const surface of surfaces) {
    it(`${surface} falls back to the live Worker`, () => {
      const source = read(surface)
      expect(source).toContain(LIVE_HOST)
    })

    it(`${surface} does not reference the dead Worker`, () => {
      // The two hostnames diverge at the hyphen, so neither contains the other and a
      // plain `includes` is exact here.
      const source = read(surface)
      expect(source.includes(DEAD_HOST)).toBe(false)
    })
  }

  /**
   * The events availability badge used to be an eighth surface on that list, and the one
   * that most needed it: `src/vanilla/event-availability.js` carried its own hardcoded
   * `DEFAULT_WORKER_BASE_URL`, so a template that forgot to pass one silently asked a
   * DIFFERENT environment - which is how it sat on the dead host on production pages.
   *
   * Ref 74c replaced it with `@shared/status/eventAvailabilityBadge`, which has no
   * hardcoded host at all: every host comes from the three templates above (all still
   * guarded), and a badge with no configuration HIDES rather than guessing. That is a
   * stronger guarantee than "the literal is the right one", so the guard follows it here
   * rather than being dropped.
   */
  it('the events badge hardcodes no Worker host at all', () => {
    for (const surface of [
      'src/shared/status/eventAvailabilityBadge.ts',
      'src/vanilla/event-availability.entry.ts',
    ]) {
      const source = read(surface)
      expect(source.includes(DEAD_HOST)).toBe(false)
      expect(source.includes(LIVE_HOST)).toBe(false)
      expect(source).not.toMatch(/workers\.dev/)
    }
  })
})
