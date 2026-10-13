/**
 * A React island's props are declared TWICE, and nothing held the two together.
 *
 * Every island is mounted the same way (CLAUDE.md § 2.2): the HubL module builds a dict
 * per HubDB row, serialises it into `data-props`, and the React component reads it back
 * through a TypeScript interface. So the key list exists once in `module.html` and once
 * in the `.tsx`, hand-maintained on both sides, with no build step and no type that spans
 * them.
 *
 * Rename or drop a key in HubL and TypeScript still says the field is there. The value is
 * `undefined` at runtime, and what that costs depends on the field: `photo_alt` is a
 * missing image caption, `price_member` is a member quoted the public rate. That second
 * one is the whole family of fault this brief keeps returning to - Ref 72 priced corporate
 * employees as non-members, Ref 109 had the Worker refuse the price this page had quoted,
 * and § 7.9 had one course showing four different numbers. None of them were a bug in the
 * arithmetic; each was two surfaces disagreeing about the same row.
 *
 * The six islands agreed exactly the day this was written, so this guard is preventative.
 * That is the point: it holds them there.
 *
 * The parity idiom is the repo's own - `src/shared/utils/memberPricingParity.test.ts`
 * parses the shipped HubL macro and RUNS it rather than grepping for keywords, on the
 * argument that agreement has to be checked and not inferred. Same here: the `row_data`
 * dict is parsed out of the shipped module and compared key by key.
 */
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')

interface Island {
  /** The HubL module that builds `row_data` and serialises it into `data-props`. */
  module: string
  /** The component that reads it back, relative to `src/modules/`. */
  component: string
  /** The interface in that component declaring one row. */
  row: string
  /**
   * Keys HubL emits that the island deliberately does not declare, with the reason.
   * Listed rather than ignored: an emitted key nobody reads is usually half a rename.
   */
  serverOnly?: Record<string, string>
}

/**
 * Every island that passes HubDB rows to React.
 *
 * A new one has to be added here, because the discovery test below fails otherwise. That
 * is deliberate, and the same shape as the explicit bare-path exceptions in
 * `contact-cta-anchors.test.ts`: a sweep that silently skips what it has not been told
 * about is a sweep that reports "nothing found" when it means "we did not look".
 */
const ISLANDS: Island[] = [
  {
    module: 'course-filter.module',
    component: 'course-filter/CourseFilter.tsx',
    row: 'CourseRow'
  },
  {
    module: 'course-timetable-filter.module',
    component: 'course-timetable-filter/CourseTimetableFilter.tsx',
    row: 'CourseTimetableRow'
  },
  {
    module: 'events-listing.module',
    component: 'events-listing/EventsListing.tsx',
    row: 'EventRow',
    serverOnly: {
      // The module server-renders its own list as well as mounting the island, and the
      // markup reads this one directly for the visible date and the search haystack.
      event_date_label: 'read by the module HTML, not by the island'
    }
  },
  {
    module: 'find-a-member.module',
    component: 'find-a-member/FindAMember.tsx',
    row: 'MemberRow'
  },
  {
    module: 'jobs-listing.module',
    component: 'jobs-listing/JobsListing.tsx',
    row: 'JobRow'
  },
  {
    module: 'resource-library.module',
    component: 'resource-library/ResourceLibrary.tsx',
    row: 'ResourceRow'
  }
]

/**
 * The keys of every `{% set row_data = { … } %}` in a module.
 *
 * Brace-matched rather than regexed to a closing `}`: several of these dicts hold a
 * ternary or a nested filter call, and cutting at the first `}` would silently return
 * half the keys - which on this check reads as HubL having dropped them.
 *
 * `events-listing` has two (the featured strip and the grid), so the keys are unioned:
 * both feed the same island, and a key on either is a key the island can see.
 */
function hublRowKeys(modulePath: string): Set<string> {
  const src = read(`theme/modules/${modulePath}/module.html`)
  const keys = new Set<string>()

  for (const match of src.matchAll(/\{%\s*set\s+row_data\s*=\s*\{/g)) {
    const open = src.indexOf('{', match.index + match[0].length - 1)
    let depth = 0
    let i = open
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      if (depth === 0) break
    }
    for (const key of src.slice(open, i + 1).matchAll(/'([A-Za-z_][\w]*)'\s*:/g)) {
      keys.add(key[1])
    }
  }

  return keys
}

interface Fields {
  required: string[]
  optional: string[]
}

/** The field names of one interface, split on whether TypeScript promises they are there. */
function interfaceFields(component: string, name: string): Fields {
  const src = read(`src/modules/${component}`)
  const match = new RegExp(`(?:export )?interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
  if (!match) throw new Error(`interface ${name} not found in src/modules/${component}`)

  const body = match[1]
  return {
    required: [...body.matchAll(/^\s*([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1]),
    optional: [...body.matchAll(/^\s*([A-Za-z_][\w]*)\?\s*:/gm)].map((m) => m[1])
  }
}

describe('HubL data-props and the island that reads them', () => {
  it('covers every module that builds row_data', () => {
    const building = globSync('theme/modules/*/module.html', { cwd: ROOT })
      .filter((path) => /\{%\s*set\s+row_data\s*=\s*\{/.test(read(path)))
      .map((path) => path.split('/')[2])
      .sort()

    // Sanity: this parses the shipped modules, so an empty sweep means the pattern stopped
    // matching, not that the theme stopped passing rows to React.
    expect(building.length).toBeGreaterThan(4)
    expect(building).toEqual(ISLANDS.map((island) => island.module).sort())
  })

  it.each(ISLANDS)('$row: HubL emits every field the island requires', (island) => {
    const emitted = hublRowKeys(island.module)
    const { required } = interfaceFields(island.component, island.row)

    // A required field HubL never emits is `undefined` at runtime while TypeScript says it
    // cannot be. On a price field that is a member charged the public rate.
    expect({ island: island.row, missing: required.filter((f) => !emitted.has(f)) }).toEqual({
      island: island.row,
      missing: []
    })
  })

  it.each(ISLANDS)('$row: emits nothing the island has no use for', (island) => {
    const emitted = hublRowKeys(island.module)
    const { required, optional } = interfaceFields(island.component, island.row)
    const declared = new Set([...required, ...optional])
    const allowed = new Set(Object.keys(island.serverOnly ?? {}))

    // The harmless direction, checked because it is the OTHER half of a rename: HubL moved
    // on, the island's old key is still declared, and the required-field test above catches
    // that only when the old key was required. Anything genuinely server-side belongs in
    // `serverOnly` with a reason.
    expect({
      island: island.row,
      undeclared: [...emitted].filter((key) => !declared.has(key) && !allowed.has(key)).sort()
    }).toEqual({ island: island.row, undeclared: [] })
  })

  it.each(ISLANDS)('$row: every serverOnly key is still emitted', (island) => {
    const emitted = hublRowKeys(island.module)

    // An exception nobody needs any more is a comment that has stopped being true.
    expect({
      island: island.row,
      stale: Object.keys(island.serverOnly ?? {}).filter((key) => !emitted.has(key))
    }).toEqual({ island: island.row, stale: [] })
  })
})
