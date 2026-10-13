/**
 * SEO metadata rules for the `courses` HubDB table (Courses - Timetable &
 * Locations).
 *
 * Three things get derived from data the rows already carry:
 *
 *   1. **Page title** - the built-in row name (`hs_name`). This is what the
 *      HubDB UI labels "Page title" once dynamic pages are enabled, and what
 *      HubSpot lists the dynamic page under. Derived from `course_name`.
 *   2. **SEO page title** - the `page_title` column, read by
 *      `course-router.html` for `<title>` and by the card partials. Derived
 *      from `course_name` + the "| Weld Australia" house convention used in
 *      `partials/_head.html`.
 *   3. **OG / social share image** - the `og_image` column, copied verbatim
 *      from `photo` (the course card image) when it is blank.
 *
 * Kept pure and separate from the CLI so the title rules can be unit-tested
 * without a portal - same split as `hubdb-slug.ts` / `backfill-hubdb-paths.ts`.
 * See `src/test/course-seo.test.ts`.
 */
import { cellText } from './hubdb-slug'

const BRAND = 'Weld Australia'
const SEPARATOR = ' | '

/**
 * Practical `<title>` budget before Google truncates in the SERP. Titles that
 * cannot fit inside it fall back to a shorter form rather than being cut
 * mid-word.
 */
export const TITLE_MAX_LENGTH = 60

/**
 * Course names that already say what kind of thing they are don't get " Course"
 * bolted on - "Welding Inspection Course Course" helps nobody.
 */
const KIND_WORDS =
  /\b(courses?|training|workshop|masterclass|exam|examination|program|programme|seminar|webinar|conference|qualification|certificate|certification|diploma|apprenticeship)\b/i

/** Brand suffixes already baked into a course name, so we don't double them up. */
const TRAILING_BRAND = /\s*[|\-–—:]\s*weld\s*australia\s*$/i

/** Collapses whitespace and trims - HubDB text arrives with stray spacing. */
export function normaliseText(input: unknown): string {
  return cellText(input).replace(/\s+/g, ' ').trim()
}

/** The course name with any trailing "- Weld Australia" style suffix removed. */
export function baseCourseName(input: unknown): string {
  return normaliseText(input).replace(TRAILING_BRAND, '').trim()
}

/**
 * Builds the SEO `<title>` for a course.
 *
 * The brand suffix is always kept - that is the house convention in
 * `partials/_head.html` and the `course-router.html` fallback, and a
 * course page with no brand in its title reads as a different site. The only
 * thing that flexes is the added kind word:
 *
 *   1. `AS1796 Cert 10 Course | Weld Australia`  (adds the missing kind word)
 *   2. `AS1796 Cert 10 | Weld Australia`         (when 1 blows the budget)
 *
 * A name long enough that even form 2 overruns {@link TITLE_MAX_LENGTH} is
 * reported by {@link planCourseSeo} as a long title - the fix is a shorter
 * course name, not a truncated title.
 */
export function buildSeoTitle(courseName: unknown): string {
  const name = baseCourseName(courseName)
  if (!name) return ''

  const branded = `${name}${SEPARATOR}${BRAND}`
  if (KIND_WORDS.test(name)) return branded

  const withKindWord = `${name} Course${SEPARATOR}${BRAND}`
  return withKindWord.length <= TITLE_MAX_LENGTH ? withKindWord : branded
}

// ---------------------------------------------------------------------------
// Row name (the built-in "Page title")
// ---------------------------------------------------------------------------

/** Formats a HubDB DATE cell (epoch ms, or an ISO string) as `YYYY-MM-DD`. */
export function formatSessionDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const ms = typeof value === 'number' ? value : Date.parse(String(value))
  if (!Number.isFinite(ms)) return ''
  // HubDB DATE values are UTC midnight; toISOString keeps them on the intended day.
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Rows are *sessions*, so several rows share one `course_name`. A bare name
 * would leave them indistinguishable in the HubDB row list, so duplicates -
 * and only duplicates - pick up a city, then a start date, then the row id.
 */
export function buildRowName(
  courseName: string,
  values: Record<string, unknown> | undefined,
  opts: { disambiguate: boolean; id: string }
): string {
  if (!opts.disambiguate) return courseName

  const city = normaliseText(values?.city)
  const date = formatSessionDate(values?.start_date)

  let name = city ? `${courseName} - ${city}` : courseName
  if (date) name = `${name} (${date})`
  if (!city && !date) name = `${courseName} #${opts.id}`
  return name
}

// ---------------------------------------------------------------------------
// Image cells
// ---------------------------------------------------------------------------

export type HubDbImage = {
  url: string
  type: 'image'
  width?: number
  height?: number
  altText?: string
  fileId?: number
}

/**
 * HubDB IMAGE cells read back as `{ url, width, height, altText, type, fileId }`
 * but are sometimes a bare URL string (CSV imports). Returns a value safe to
 * write straight back into another IMAGE column, or null when there is no
 * image.
 *
 * Always sets `type: "image"` - HubSpot rejects IMAGE writes without it
 * (`INVALID_IMAGE_VARIANT_VALUE`).
 */
export function readImageCell(value: unknown): HubDbImage | null {
  if (!value) return null
  if (typeof value === 'string') {
    const url = value.trim()
    return url ? { url, type: 'image' } : null
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url.trim() : ''
    if (!url) return null
    const image: HubDbImage = { url, type: 'image' }
    if (typeof o.width === 'number') image.width = o.width
    if (typeof o.height === 'number') image.height = o.height
    if (typeof o.altText === 'string' && o.altText) image.altText = o.altText
    if (typeof o.fileId === 'number') image.fileId = o.fileId
    return image
  }
  return null
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type SeoRow = {
  id: string | number
  /** Built-in row name (hs_name) - the "Page title" in the HubDB UI. */
  name?: string | null
  values?: Record<string, unknown>
}

export type FieldChange<T = string> = { from: T | ''; to: T }

export type PlannedSeoRow = {
  id: string
  label: string
  /** Set when the built-in row name needs writing. */
  rowName?: FieldChange
  /** Set when the `page_title` column needs writing. */
  pageTitle?: FieldChange
  /** Set when `og_image` should be copied from `photo`. */
  ogImage?: { from: string; to: HubDbImage }
}

export type SeoPlan = {
  planned: PlannedSeoRow[]
  /** Rows with no usable `course_name` - nothing can be derived, left alone. */
  unnamed: string[]
  /** Rows already complete (nothing blank), reported so a re-run reads as a no-op. */
  untouched: number
  /** Rows whose `page_title` would exceed the SERP budget, for a warning. */
  longTitles: { label: string; title: string; length: number }[]
  /** Rows where `og_image` stays blank because there is no `photo` either. */
  missingPhotos: string[]
}

export type PlanOptions = {
  /** Rewrite values that are already populated instead of only filling blanks. */
  force?: boolean
  /** Fields to consider. Defaults to all three. */
  fields?: { rowName?: boolean; pageTitle?: boolean; ogImage?: boolean }
}

/**
 * Works out, per row, which of the three SEO fields need writing.
 *
 * Additive by default: a row keeps any value it already has, so re-running is a
 * no-op and hand-tuned titles survive. `force` opts into overwriting - which is
 * the only way to pick up a renamed course, and the reason the CLI shows a
 * dry-run diff first.
 */
export function planCourseSeo(rows: SeoRow[], opts: PlanOptions = {}): SeoPlan {
  const { force = false } = opts
  const want = {
    rowName: opts.fields?.rowName ?? true,
    pageTitle: opts.fields?.pageTitle ?? true,
    ogImage: opts.fields?.ogImage ?? true
  }

  const unnamed: string[] = []
  const longTitles: SeoPlan['longTitles'] = []
  const missingPhotos: string[] = []

  // Which course names appear on more than one row - drives session suffixes.
  const nameCounts = new Map<string, number>()
  for (const row of rows) {
    const name = baseCourseName(row.values?.course_name)
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  const planned: PlannedSeoRow[] = []
  let untouched = 0

  for (const row of rows) {
    const id = String(row.id)
    const courseName = baseCourseName(row.values?.course_name)
    if (!courseName) {
      unnamed.push(id)
      continue
    }

    const change: PlannedSeoRow = { id, label: courseName }

    if (want.rowName) {
      const existing = normaliseText(row.name)
      const next = buildRowName(courseName, row.values, {
        disambiguate: (nameCounts.get(courseName) ?? 0) > 1,
        id
      })
      if ((!existing || force) && next && next !== existing) {
        change.rowName = { from: existing, to: next }
      }
    }

    if (want.pageTitle) {
      const existing = normaliseText(row.values?.page_title)
      const next = buildSeoTitle(courseName)
      if ((!existing || force) && next && next !== existing) {
        change.pageTitle = { from: existing, to: next }
        if (next.length > TITLE_MAX_LENGTH) {
          longTitles.push({ label: courseName, title: next, length: next.length })
        }
      }
    }

    if (want.ogImage) {
      const existing = readImageCell(row.values?.og_image)
      const photo = readImageCell(row.values?.photo)
      if (!photo) {
        if (!existing) missingPhotos.push(courseName)
      } else if ((!existing || force) && existing?.url !== photo.url) {
        change.ogImage = { from: existing?.url ?? '', to: photo }
      }
    }

    if (change.rowName || change.pageTitle || change.ogImage) planned.push(change)
    else untouched += 1
  }

  return { planned, unnamed, untouched, longTitles, missingPhotos }
}
