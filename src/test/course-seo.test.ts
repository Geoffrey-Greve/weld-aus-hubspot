/**
 * Guards the SEO rules used by `pnpm backfill:course-seo`, because these strings
 * become the `<title>` and social-share card of every /courses/{slug} page.
 * Course names are taken from the real courses taxonomy (CLAUDE.md § 7.1/§ 7.5).
 */
import { describe, it, expect } from 'vitest'
import {
  baseCourseName,
  buildRowName,
  buildSeoTitle,
  formatSessionDate,
  planCourseSeo,
  readImageCell,
  TITLE_MAX_LENGTH
} from '../../scripts/lib/course-seo'

const DATE_2027_03_12 = Date.UTC(2027, 2, 12)

describe('buildSeoTitle', () => {
  it('brands the course name in the house format', () => {
    expect(buildSeoTitle('Welding Inspection Course')).toBe(
      'Welding Inspection Course | Weld Australia'
    )
  })

  it('adds "Course" when the name does not say what it is', () => {
    expect(buildSeoTitle('AS1796 Cert 10')).toBe('AS1796 Cert 10 Course | Weld Australia')
  })

  it('does not double up a kind word already in the name', () => {
    expect(buildSeoTitle('Welding Supervision Training')).toBe(
      'Welding Supervision Training | Weld Australia'
    )
    expect(buildSeoTitle('IIW Inspector Exam')).toBe('IIW Inspector Exam | Weld Australia')
    // Plural and mixed case both count.
    expect(buildSeoTitle('short courses')).toBe('short courses | Weld Australia')
  })

  it('drops the added kind word rather than the brand when the title gets long', () => {
    // "… Setup and Testing Course | Weld Australia" would overrun the budget.
    const name = 'Robotic Welding Cell Setup and Testing'
    expect(buildSeoTitle(name)).toBe(`${name} | Weld Australia`)
    expect(buildSeoTitle(name).length).toBeLessThanOrEqual(TITLE_MAX_LENGTH)
  })

  it('keeps titles inside the SERP budget when it can', () => {
    expect(buildSeoTitle('IIW International Welding Inspector').length).toBeLessThanOrEqual(
      TITLE_MAX_LENGTH
    )
  })

  it('never truncates mid-word - a long name keeps its brand and is flagged instead', () => {
    const long = 'Welding Coordination Personnel Qualification Pathway for ISO 14731'
    expect(buildSeoTitle(long)).toBe(`${long} | Weld Australia`)
  })

  it('does not repeat a brand suffix the course name already carries', () => {
    expect(buildSeoTitle('AS1796 Cert 10 - Weld Australia')).toBe(
      'AS1796 Cert 10 Course | Weld Australia'
    )
    expect(buildSeoTitle('AS1796 Cert 10 | Weld Australia')).toBe(
      'AS1796 Cert 10 Course | Weld Australia'
    )
  })

  it('normalises whitespace from imported rows', () => {
    expect(baseCourseName('  AS1796   Cert 10 ')).toBe('AS1796 Cert 10')
    expect(buildSeoTitle('  AS1796   Cert 10 ')).toBe('AS1796 Cert 10 Course | Weld Australia')
  })

  it('returns an empty string for a nameless row', () => {
    expect(buildSeoTitle('')).toBe('')
    expect(buildSeoTitle(null)).toBe('')
  })
})

describe('buildRowName', () => {
  it('uses the bare course name when it is unique', () => {
    expect(
      buildRowName(
        'AS1796 Cert 10',
        { city: 'Sydney', start_date: DATE_2027_03_12 },
        {
          disambiguate: false,
          id: '1'
        }
      )
    ).toBe('AS1796 Cert 10')
  })

  it('qualifies duplicate course names by city and start date', () => {
    expect(
      buildRowName(
        'AS1796 Cert 10',
        { city: 'Sydney', start_date: DATE_2027_03_12 },
        {
          disambiguate: true,
          id: '1'
        }
      )
    ).toBe('AS1796 Cert 10 - Sydney (2027-03-12)')
  })

  it('copes with a SELECT cell object for city', () => {
    expect(
      buildRowName(
        'AS1796 Cert 10',
        { city: { name: 'Online', type: 'option' } },
        {
          disambiguate: true,
          id: '1'
        }
      )
    ).toBe('AS1796 Cert 10 - Online')
  })

  it('falls back to the row id when there is nothing to qualify with', () => {
    expect(buildRowName('AS1796 Cert 10', {}, { disambiguate: true, id: '77' })).toBe(
      'AS1796 Cert 10 #77'
    )
  })
})

describe('formatSessionDate', () => {
  it('formats epoch-ms DATE cells as YYYY-MM-DD', () => {
    expect(formatSessionDate(DATE_2027_03_12)).toBe('2027-03-12')
  })

  it('accepts ISO strings and ignores unusable values', () => {
    expect(formatSessionDate('2027-03-12')).toBe('2027-03-12')
    expect(formatSessionDate('')).toBe('')
    expect(formatSessionDate(null)).toBe('')
    expect(formatSessionDate('not a date')).toBe('')
  })
})

describe('readImageCell', () => {
  it('keeps the dimensions and alt text HubDB returns, and always sets type', () => {
    expect(
      readImageCell({
        url: 'https://cdn/a.jpg',
        width: 1200,
        height: 630,
        altText: 'Welding',
        fileId: 99,
        type: 'image'
      })
    ).toEqual({
      url: 'https://cdn/a.jpg',
      type: 'image',
      width: 1200,
      height: 630,
      altText: 'Welding',
      fileId: 99
    })
  })

  it('accepts a bare URL string from a CSV import', () => {
    expect(readImageCell('https://cdn/a.jpg')).toEqual({ url: 'https://cdn/a.jpg', type: 'image' })
  })

  it('treats an empty cell as no image', () => {
    expect(readImageCell(null)).toBeNull()
    expect(readImageCell('')).toBeNull()
    expect(readImageCell({ url: '' })).toBeNull()
  })
})

describe('planCourseSeo', () => {
  const photo = { url: 'https://cdn/course.jpg', width: 1200, height: 630, type: 'image' }

  it('fills all three fields on a blank row', () => {
    const [plan] = planCourseSeo([
      { id: 1, name: '', values: { course_name: 'AS1796 Cert 10', photo } }
    ]).planned

    expect(plan!.rowName).toEqual({ from: '', to: 'AS1796 Cert 10' })
    expect(plan!.pageTitle).toEqual({ from: '', to: 'AS1796 Cert 10 Course | Weld Australia' })
    expect(plan!.ogImage?.to).toEqual({
      url: photo.url,
      type: 'image',
      width: 1200,
      height: 630
    })
  })

  it('leaves populated values alone so hand-tuned SEO survives a re-run', () => {
    const { planned, untouched } = planCourseSeo([
      {
        id: 1,
        name: 'AS1796 Cert 10 - Sydney',
        values: {
          course_name: 'AS1796 Cert 10',
          page_title: 'Become a Welding Supervisor | Weld Australia',
          og_image: { url: 'https://cdn/custom.jpg' },
          photo
        }
      }
    ])

    expect(planned).toEqual([])
    expect(untouched).toBe(1)
  })

  it('overwrites populated values under force', () => {
    const [plan] = planCourseSeo(
      [
        {
          id: 1,
          name: 'Old name',
          values: {
            course_name: 'AS1796 Cert 10',
            page_title: 'Old title',
            og_image: { url: 'https://cdn/old.jpg' },
            photo
          }
        }
      ],
      { force: true }
    ).planned

    expect(plan!.rowName?.to).toBe('AS1796 Cert 10')
    expect(plan!.pageTitle?.to).toBe('AS1796 Cert 10 Course | Weld Australia')
    expect(plan!.ogImage?.from).toBe('https://cdn/old.jpg')
    expect(plan!.ogImage?.to.url).toBe(photo.url)
  })

  it('distinguishes session rows that share a course name', () => {
    const { planned } = planCourseSeo([
      {
        id: 1,
        values: { course_name: 'AS1796 Cert 10', city: 'Sydney', start_date: DATE_2027_03_12 }
      },
      {
        id: 2,
        values: { course_name: 'AS1796 Cert 10', city: 'Perth', start_date: DATE_2027_03_12 }
      },
      { id: 3, values: { course_name: 'IIW Welding Inspector', city: 'Sydney' } }
    ])

    expect(planned.map((p) => p.rowName?.to)).toEqual([
      'AS1796 Cert 10 - Sydney (2027-03-12)',
      'AS1796 Cert 10 - Perth (2027-03-12)',
      // Unique name - no session suffix.
      'IIW Welding Inspector'
    ])
    // Sessions of one course share one dynamic page, so they share one SEO title.
    expect(planned[0]!.pageTitle?.to).toBe(planned[1]!.pageTitle?.to)
  })

  it('skips rows with no course name instead of inventing one', () => {
    const { planned, unnamed } = planCourseSeo([{ id: 9, values: { city: 'Sydney', photo } }])

    expect(planned).toEqual([])
    expect(unnamed).toEqual(['9'])
  })

  it('reports rows with no photo to copy and writes nothing for them', () => {
    const { planned, missingPhotos } = planCourseSeo([
      { id: 1, values: { course_name: 'AS1796 Cert 10' } }
    ])

    expect(missingPhotos).toEqual(['AS1796 Cert 10'])
    expect(planned[0]!.ogImage).toBeUndefined()
  })

  it('honours a --only subset', () => {
    const [plan] = planCourseSeo([{ id: 1, values: { course_name: 'AS1796 Cert 10', photo } }], {
      fields: { rowName: false, pageTitle: false, ogImage: true }
    }).planned

    expect(plan!.rowName).toBeUndefined()
    expect(plan!.pageTitle).toBeUndefined()
    expect(plan!.ogImage?.to.url).toBe(photo.url)
  })

  it('flags titles that will truncate in search results', () => {
    const { longTitles } = planCourseSeo([
      {
        id: 1,
        values: {
          course_name: 'Welding Coordination Personnel Qualification Pathway for ISO 14731'
        }
      }
    ])

    expect(longTitles).toHaveLength(1)
    expect(longTitles[0]!.length).toBeGreaterThan(TITLE_MAX_LENGTH)
  })
})
