/**
 * Guards the slug rules used by `pnpm backfill:paths`, because these strings
 * become public URLs (/about/team/{slug}) and are effectively permanent once
 * live. Cases are taken from the real team_and_board export.
 */
import { describe, it, expect } from 'vitest'
import { slugify, planPaths } from '../../scripts/lib/hubdb-slug'

describe('slugify', () => {
  it('lower-cases and hyphenates a plain name', () => {
    expect(slugify('Geoff Crittenden')).toBe('geoff-crittenden')
    expect(slugify('Danielle Pennington')).toBe('danielle-pennington')
  })

  it('strips a leading honorific so URLs read as the person, not their title', () => {
    expect(slugify('Dr. Graham Hutt')).toBe('graham-hutt')
    expect(slugify('Dr Graham Hutt')).toBe('graham-hutt')
    expect(slugify('Prof. Ian Harris')).toBe('ian-harris')
    expect(slugify('Professor Madeleine du Toit')).toBe('madeleine-du-toit')
    expect(slugify('A/Prof Jane Doe')).toBe('jane-doe')
  })

  it('keeps an honorific that is actually part of the name', () => {
    // "Drew" starts with "dr" but is not an honorific - only whole words count.
    expect(slugify('Drew Mitchell')).toBe('drew-mitchell')
    expect(slugify('Missy Higgins')).toBe('missy-higgins')
  })

  it('drops apostrophes rather than turning them into hyphens', () => {
    expect(slugify("Ross O'Bryan")).toBe('ross-obryan')
    expect(slugify('Ross O’Bryan')).toBe('ross-obryan')
  })

  it('trims stray whitespace from imported data', () => {
    // The live export has a leading space on this row.
    expect(slugify(' Nigel Jervis')).toBe('nigel-jervis')
    expect(slugify('Marsha  Johnson-Howe ')).toBe('marsha-johnson-howe')
  })

  it('handles multi-part surnames and diacritics', () => {
    expect(slugify('Cornelis Van Niekerk')).toBe('cornelis-van-niekerk')
    expect(slugify('Renée Dubois')).toBe('renee-dubois')
    expect(slugify('Charlotte Prestifilippo')).toBe('charlotte-prestifilippo')
  })

  it('never emits leading, trailing or doubled hyphens', () => {
    expect(slugify('  --Odd  Name--  ')).toBe('odd-name')
    expect(slugify('Q&C Team')).toBe('q-and-c-team')
  })

  it('returns an empty string when there is nothing to slug', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})

describe('planPaths', () => {
  const opts = { sourceColumn: 'name' }
  const row = (id: string, name: string, path = '', rowName = '') => ({
    id,
    path,
    name: rowName,
    values: { name },
  })

  it('plans a path for every row that has none', () => {
    const plan = planPaths([row('1', 'Geoff Crittenden'), row('2', 'Bec Cameron')], opts)
    expect(plan.planned.map((p) => p.to)).toEqual(['geoff-crittenden', 'bec-cameron'])
    expect(plan.skipped).toHaveLength(0)
  })

  it('leaves rows that already have a path alone', () => {
    const plan = planPaths([row('1', 'Geoff Crittenden', 'custom-url'), row('2', 'Bec Cameron')], opts)
    expect(plan.planned.map((p) => p.to)).toEqual(['bec-cameron'])
    expect(plan.skipped).toEqual(['Geoff Crittenden (custom-url)'])
  })

  it('is a no-op once every row has a path', () => {
    const plan = planPaths([row('1', 'A', 'a'), row('2', 'B', 'b')], opts)
    expect(plan.planned).toHaveLength(0)
  })

  it('gives dual-role duplicates role/category suffixes, not -2', () => {
    // Live pattern: same person listed as CEO (Corporate) and again under Board.
    const plan = planPaths(
      [
        {
          id: '1',
          values: {
            name: 'Geoff Crittenden',
            role: 'Chief Executive Officer and Executive Director',
            category: { name: 'Corporate' },
          },
        },
        {
          id: '2',
          values: {
            name: 'Geoff Crittenden',
            role: 'Chief Executive Officer and Executive Director',
            category: { name: 'Board' },
          },
        },
      ],
      opts,
    )
    expect(plan.planned.map((p) => p.to)).toEqual([
      'geoff-crittenden-ceo',
      'geoff-crittenden-board',
    ])
    expect(plan.duplicateLabels).toEqual([{ label: 'Geoff Crittenden', count: 2 }])
  })

  it('never generates a path already held by a row it is skipping', () => {
    const plan = planPaths([row('1', 'Someone Else', 'geoff-crittenden'), row('2', 'Geoff Crittenden')], opts)
    expect(plan.planned.map((p) => p.to)).toEqual(['geoff-crittenden-2'])
  })

  it('reserves paths kept by unsluggable rows under --force-resync', () => {
    // Row 1 cannot be re-slugged (blank name) so it KEEPS "geoff-crittenden".
    // Row 2 would naturally generate that same path - it must not.
    const plan = planPaths(
      [row('1', '', 'geoff-crittenden'), row('2', 'Geoff Crittenden', 'stale-path')],
      { ...opts, forceResync: true },
    )
    expect(plan.unslugged).toEqual(['1 (keeps geoff-crittenden)'])
    expect(plan.planned.map((p) => p.to)).toEqual(['geoff-crittenden-2'])
  })

  it('rewrites existing paths under --force-resync without self-collision', () => {
    const plan = planPaths([row('1', 'Bec Cameron', 'bec-cameron')], { ...opts, forceResync: true })
    // Its own current path must not block it from keeping the same slug.
    expect(plan.planned.map((p) => p.to)).toEqual(['bec-cameron'])
  })

  it('never emits two rows with the same path', () => {
    const plan = planPaths(
      [
        row('1', 'Sam Smith'),
        row('2', 'Sam Smith'),
        row('3', 'Sam Smith'),
        row('4', 'Other', 'sam-smith-2'),
      ],
      opts,
    )
    const paths = plan.planned.map((p) => p.to)
    expect(new Set(paths).size).toBe(paths.length)
    // No role/category → bare name for the first, then -2 / -3 on that stem.
    // sam-smith-2 is already reserved by row 4, so the second Sam becomes -3.
    expect(paths).toEqual(['sam-smith', 'sam-smith-3', 'sam-smith-4'])
  })

  it('sets the row name only when the built-in name is blank', () => {
    const plan = planPaths([row('1', 'Bec Cameron'), row('2', 'Mick Cameron', '', 'Mick C')], opts)
    expect(plan.planned.map((p) => p.setName)).toEqual([true, false])
  })
})
