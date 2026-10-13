import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pagination } from '@shared/components/Pagination'
import { debounce } from '@shared/utils/debounce'
import { trackCustomEvent } from '@shared/api/events'
import './ResourceLibrary.css'

export interface ResourceRow {
  id: number | string
  title: string
  slug?: string
  abstract: string
  file_url: string
  file_type: string
  category: string
  accent_tone?: string
  required_tier?: string
  member_label?: string
  non_member_label?: string
  preview_image_url: string
  preview_image_alt: string
  published_date: number | string | null
  locked: boolean
}

export interface ResourceLibraryProps {
  rows: ResourceRow[]
  section_heading: string
  intro: string
  categories_visible: string[]
  default_filter_category: string
  show_file_type_filter: boolean
  show_member_only_filter: boolean
  page_size: number
  locked_overlay_message: string
  locked_cta_label: string
  locked_cta_url: string
  member_tier?: string
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technical Notes',
  standards: 'Standards & Guidance',
  case_study: 'Case Studies',
  report: 'Industry Reports',
  webinar: 'Webinars',
  template: 'Templates & Tools',
  advocacy: 'Advocacy & Industry',
}

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  video: 'Video',
  link: 'Online resource',
}

const ACCESS_LEVELS = [
  { key: 'public', short: 'P', label: 'Public - open to everyone' },
  { key: 'member', short: 'M', label: 'All active members' },
  { key: 'bronze', short: 'B', label: 'Bronze members and above' },
  { key: 'silver', short: 'S', label: 'Silver members and above' },
  { key: 'gold', short: 'G', label: 'Gold members' },
]

const RESOURCE_PLACEHOLDER_IMAGE = 'https://441838610.fs1.hubspotusercontent-ap1.net/hubfs/441838610/placeholders/Stocked%20Images/iStock-1266644220%20(2).jpg'

function SearchIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4.4-4.4" /></svg>
}

function FilterIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
}
function DownloadIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
}

function LockIcon(): React.ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ')
}

function fileTypeLabel(fileType: string): string {
  return FILE_TYPE_LABELS[fileType] ?? fileType
}

function formatDate(value: number | string | null): string {
  if (!value) return ''
  const milliseconds = typeof value === 'number' ? (value > 1e10 ? value : value * 1000) : Date.parse(value)
  if (Number.isNaN(milliseconds)) return ''
  return new Date(milliseconds).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

/**
 * A price/CTA label counts as *paid* only when it actually reads like a price.
 *
 * `member_label` / `non_member_label` hold a mix of prices ("$450", "$--" for
 * price-on-application) and plain CTA copy ("Download PDF"), so "not free" is
 * not the same as "costs money" - treating CTA copy as a price sent free
 * resources down the enquiry path and labelled paid ones "free for everyone".
 */
function isPaidLabel(value?: string): boolean {
  const raw = (value ?? '').trim()
  if (!raw) return false
  if (/free|included|no charge|complimentary/i.test(raw)) return false

  const hasCurrency = /\$|\bAUD\b/i.test(raw)
  const numericOnly = /^[\d.,\s]+$/.test(raw)
  if (!hasCurrency && !numericOnly) return false

  const digits = raw.replace(/\D/g, '')
  // "$--" / "$POA" carry a currency marker but no amount - still paid.
  if (!digits) return hasCurrency
  return Number(digits) > 0
}

function priceLabel(value?: string): string {
  return isPaidLabel(value) ? (value ?? '').trim() : ''
}

/** Human-readable access summary that stays truthful when a resource is paid. */
function accessSummary(level: (typeof ACCESS_LEVELS)[number], memberPaid: boolean, nonMemberPaid: boolean): string {
  if (level.key !== 'public') {
    return memberPaid ? `${level.label} - paid resource` : level.label
  }
  if (!memberPaid && !nonMemberPaid) return 'Public - free for everyone'
  if (!memberPaid) return 'Public - free for members, paid for non-members'
  return 'Public - anyone can purchase'
}

function initialSearchQuery(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('q')?.trim() ?? ''
}

function accessLevel(row: ResourceRow): (typeof ACCESS_LEVELS)[number] {
  const key = row.required_tier || (row.locked ? 'member' : 'public')
  return ACCESS_LEVELS.find((level) => level.key === key) ?? ACCESS_LEVELS[0]!
}

function AccessBadge({ levelKey }: { levelKey: string }): React.ReactElement {
  const level = ACCESS_LEVELS.find((item) => item.key === levelKey) ?? ACCESS_LEVELS[0]!
  return <span className={`wa-rl__access-badge wa-rl__access-badge--${level.key}`} title={level.label}>{level.short}</span>
}

function useLockedViewEvent(id: number | string, locked: boolean, category: string): React.RefCallback<HTMLElement> {
  const hasFired = useRef(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const callbackRef = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!element || !locked || hasFired.current) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !hasFired.current) {
        hasFired.current = true
        trackCustomEvent({ name: 'resource_locked_view', properties: { resource_id: String(id), category } })
        observer.disconnect()
      }
    }, { threshold: 0.5 })

    observer.observe(element)
    observerRef.current = observer
  }, [id, locked, category])

  useEffect(() => () => observerRef.current?.disconnect(), [])
  return callbackRef
}

interface ResourceCardProps {
  row: ResourceRow
  locked_overlay_message: string
  locked_cta_label: string
  locked_cta_url: string
  member_tier: string
}

function ResourceCard({ row, locked_overlay_message, locked_cta_label, locked_cta_url, member_tier }: ResourceCardProps): React.ReactElement {
  const lockedRef = useLockedViewEvent(row.id, row.locked, row.category)
  const level = accessLevel(row)
  const memberPrice = priceLabel(row.member_label)
  const nonMemberPrice = priceLabel(row.non_member_label)
  const gated = level.key !== 'public'
  const memberLabel = memberPrice || 'Free'
  const nonMemberLabel = nonMemberPrice || (gated ? 'Members only' : 'Free')
  const visitorPrice = member_tier ? memberPrice : nonMemberPrice
  const date = formatDate(row.published_date)
  const [thumbnailSrc, setThumbnailSrc] = useState(row.preview_image_url || RESOURCE_PLACEHOLDER_IMAGE)

  useEffect(() => {
    setThumbnailSrc(row.preview_image_url || RESOURCE_PLACEHOLDER_IMAGE)
  }, [row.preview_image_url])


  const handleDownload = useCallback(() => {
    trackCustomEvent({
      name: 'resource_downloaded',
      properties: {
        resource_id: String(row.id),
        resource_title: row.title,
        member_tier_at_download: member_tier || 'anonymous',
        file_type: row.file_type,
      },
    })
  }, [row.id, row.title, row.file_type, member_tier])

  const directActionLabel = row.file_type === 'video' ? 'Watch resource' : row.file_type === 'link' ? 'Open resource' : 'Download'
  const enquiryUrl = `/contact-us?resource=${encodeURIComponent(row.title)}`
  const thumbnailAlt = thumbnailSrc === row.preview_image_url ? (row.preview_image_alt || row.title) : ''

  return (
    <article ref={row.locked ? lockedRef : undefined} className={`wa-rl__card wa-rl__card--${row.locked ? 'locked' : 'unlocked'}`} aria-label={`${row.title}${row.locked ? ' - members only' : ''}`}>
      <div className={`wa-rl__card-media wa-rl__card-media--${row.accent_tone || 'navy'}`}>
        <img
          src={thumbnailSrc}
          alt={thumbnailAlt}
          className="wa-rl__card-img"
          loading="lazy"
          onError={() => setThumbnailSrc(RESOURCE_PLACEHOLDER_IMAGE)}
        />
        <span className="wa-rl__card-scrim" aria-hidden="true" />
        <div className="wa-rl__card-badges">
          <span className="wa-rl__category-tag">{categoryLabel(row.category)}</span>
          {level.key !== 'public' && (
            <span className="wa-rl__locked-badge">
              {row.locked && <LockIcon />} Member access
            </span>
          )}
        </div>
      </div>

      <div className="wa-rl__card-body">
        <div className="wa-rl__card-meta"><span>{fileTypeLabel(row.file_type)}</span>{date && <span>{date}</span>}</div>
        <h3 className="wa-rl__card-title">{row.title}</h3>
        {row.abstract && <div className="wa-rl__card-abstract" dangerouslySetInnerHTML={{ __html: row.abstract }} />}

        <div className="wa-rl__eligibility">
          <span className="wa-rl__eligibility-label">Available to</span>
          <span className="wa-rl__eligibility-value">
            <AccessBadge levelKey={level.key} /> {accessSummary(level, Boolean(memberPrice), Boolean(nonMemberPrice))}
          </span>
        </div>

        <div className="wa-rl__pricing" aria-label="Resource access and pricing">
          <div><span>Member</span><strong>{memberLabel}</strong></div>
          <div><span>Non-member</span><strong>{nonMemberLabel}</strong></div>
        </div>

        <div className="wa-rl__card-actions">
          {row.locked ? (
            <>
              <div className="wa-rl__locked-overlay">
                {locked_overlay_message && <div className="wa-rl__locked-message wa-visually-hidden" dangerouslySetInnerHTML={{ __html: locked_overlay_message }} />}
              </div>
              <a className="wa-rl__action wa-rl__action--outline wa-rl__locked-cta" href={locked_cta_url || '/membership/'}><LockIcon /> {locked_cta_label || 'Become a member to access'}</a>
            </>
          ) : row.file_url && !visitorPrice ? (
            <a className="wa-rl__action wa-rl__action--download wa-rl__download-btn" href={row.file_url} target="_blank" rel="noopener noreferrer" onClick={handleDownload}><DownloadIcon /> {directActionLabel}</a>
          ) : row.file_url ? (
            <a className="wa-rl__action wa-rl__action--primary" href={enquiryUrl}>Enquire - {visitorPrice}</a>
          ) : (
            <span className="wa-rl__action wa-rl__action--disabled">Coming soon</span>
          )}
        </div>
      </div>
    </article>
  )
}

interface SidebarProps {
  categoryOptions: { value: string; label: string }[]
  fileTypeOptions: { value: string; label: string }[]
  selectedCategories: string[]
  selectedFileTypes: string[]
  showFileTypes: boolean
  showAvailable: boolean
  availableOnly: boolean
  resultCount: number
  onCategoryToggle: (value: string) => void
  onFileTypeToggle: (value: string) => void
  onAvailableToggle: () => void
  onReset: () => void
}

function FilterSidebar({
  categoryOptions,
  fileTypeOptions,
  selectedCategories,
  selectedFileTypes,
  showFileTypes,
  showAvailable,
  availableOnly,
  resultCount,
  onCategoryToggle,
  onFileTypeToggle,
  onAvailableToggle,
  onReset,
}: SidebarProps): React.ReactElement {
  const hasSelection = selectedCategories.length > 0 || selectedFileTypes.length > 0 || availableOnly

  const optionButton = (value: string, label: string, active: boolean, onClick: (value: string) => void) => (
    <button key={value} type="button" className="wa-rl__filter-option" aria-pressed={active} onClick={() => onClick(value)}>
      <span className="wa-rl__filter-check" aria-hidden="true">{active ? '✓' : ''}</span>
      <span>{label}</span>
    </button>
  )

  return (
    <aside className="wa-rl__sidebar" aria-label="Filter resources">
      <div className="wa-rl__sidebar-heading">
        <span><FilterIcon /> Filter resources</span>
        {hasSelection && <button type="button" onClick={onReset}>Clear</button>}
      </div>

      <fieldset className="wa-rl__filter-group">
        <legend>Category</legend>
        {categoryOptions.map((option) => optionButton(option.value, option.label, selectedCategories.includes(option.value), onCategoryToggle))}
      </fieldset>

      {showFileTypes && fileTypeOptions.length > 1 && (
        <fieldset className="wa-rl__filter-group">
          <legend>Resource type</legend>
          {fileTypeOptions.map((option) => optionButton(option.value, option.label, selectedFileTypes.includes(option.value), onFileTypeToggle))}
        </fieldset>
      )}

      {showAvailable && (
        <button type="button" className="wa-rl__available-toggle" aria-pressed={availableOnly} onClick={onAvailableToggle}>
          <span className="wa-rl__filter-check" aria-hidden="true">{availableOnly ? '✓' : ''}</span>
          Available to me
        </button>
      )}

      <p className="wa-rl__sidebar-count"><strong>{resultCount}</strong> resource{resultCount === 1 ? '' : 's'} shown</p>
    </aside>
  )
}

export function ResourceLibrary({
  rows,
  section_heading,
  intro,
  categories_visible,
  default_filter_category,
  show_file_type_filter,
  show_member_only_filter,
  page_size,
  locked_overlay_message,
  locked_cta_label,
  locked_cta_url,
  member_tier = '',
}: ResourceLibraryProps): React.ReactElement {
  const initialQuery = useMemo(initialSearchQuery, [])
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [searchQuery, setSearchQuery] = useState(initialQuery)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    default_filter_category && default_filter_category !== 'all' ? [default_filter_category] : []
  )
  const [selectedFileTypes, setSelectedFileTypes] = useState<string[]>([])
  const [availableOnly, setAvailableOnly] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)

  const debouncedSetQuery = useRef(debounce((query: unknown) => {
    setSearchQuery(String(query))
    setPage(1)
  }, 200))

  useEffect(() => {
    const debounced = debouncedSetQuery.current
    return () => debounced.cancel()
  }, [])

  const categoryOptions = useMemo(() => {
    const categories = categories_visible?.length
      ? categories_visible
      : Array.from(new Set(rows.map((row) => row.category).filter(Boolean)))
    return categories.map((category) => ({ value: category, label: categoryLabel(category) }))
  }, [categories_visible, rows])

  const fileTypeOptions = useMemo(() =>
    Array.from(new Set(rows.map((row) => row.file_type).filter(Boolean))).map((fileType) => ({
      value: fileType,
      label: fileTypeLabel(fileType),
    })), [rows])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return rows.filter((row) => {
      const matchesSearch = !query || row.title.toLowerCase().includes(query) || stripHtml(row.abstract).toLowerCase().includes(query) || categoryLabel(row.category).toLowerCase().includes(query)
      const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(row.category)
      const matchesFileType = selectedFileTypes.length === 0 || selectedFileTypes.includes(row.file_type)
      const matchesAvailability = !availableOnly || !row.locked
      return matchesSearch && matchesCategory && matchesFileType && matchesAvailability
    })
  }, [rows, searchQuery, selectedCategories, selectedFileTypes, availableOnly])

  const effectivePageSize = page_size > 0 ? page_size : 9
  const totalPages = Math.ceil(filteredRows.length / effectivePageSize)
  const safePage = Math.min(page, Math.max(totalPages, 1))
  const pagedRows = filteredRows.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize)
  const gridRef = useRef<HTMLUListElement>(null)

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])
    setPage(1)
  }, [])

  const toggleFileType = useCallback((fileType: string) => {
    setSelectedFileTypes((current) => current.includes(fileType) ? current.filter((item) => item !== fileType) : [...current, fileType])
    setPage(1)
  }, [])

  const resetFilters = useCallback(() => {
    setSelectedCategories([])
    setSelectedFileTypes([])
    setAvailableOnly(false)
    setPage(1)
  }, [])

  const clearAll = useCallback(() => {
    resetFilters()
    setSearchInput('')
    setSearchQuery('')
  }, [resetFilters])

  const hasFilters = selectedCategories.length > 0 || selectedFileTypes.length > 0 || availableOnly || searchQuery.trim().length > 0

  return (
    <div className="wa-rl">
      <section className="wa-rl__legend" aria-labelledby="wa-resource-access-heading">
        <div className="container wa-rl__legend-inner">
          <div className="wa-rl__legend-copy">
            <h2 id="wa-resource-access-heading">Who can access each resource?</h2>
            <p>Each badge shows who can access a resource. Public items are available without logging in. Most resources are free - where one is paid, the price is shown on the card.</p>
          </div>
          <div className="wa-rl__legend-items">
            {ACCESS_LEVELS.map((level) => <div key={level.key}><AccessBadge levelKey={level.key} /><span>{level.label}</span></div>)}
          </div>
        </div>
      </section>

      <section className="wa-rl__listing" id="resources-library" aria-labelledby="wa-resource-library-heading">
        <div className="container">
          <header className="wa-rl__header">
            <p className="wa-rl__eyebrow">Resource library</p>
            <h2 className="wa-rl__heading" id="wa-resource-library-heading">{section_heading || 'Browse resources'}</h2>
            {intro && <div className="wa-rl__intro" dangerouslySetInnerHTML={{ __html: intro }} />}
          </header>

          <div className="wa-rl__search-row">
            <label className="wa-rl__search-wrap" htmlFor="wa-rl-search">
              <span className="wa-visually-hidden">Search resources</span>
              <SearchIcon />
              <input
                id="wa-rl-search"
                type="search"
                role="searchbox"
                className="wa-rl__search"
                placeholder="Search by name or category…"
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value)
                  debouncedSetQuery.current(event.target.value)
                }}
                autoComplete="off"
              />
            </label>
            {hasFilters && <button type="button" className="wa-rl__clear-all" onClick={clearAll}>Clear all</button>}
          </div>

          <button type="button" className="wa-rl__mobile-filter-toggle" aria-expanded={filtersOpen} aria-controls="wa-resource-filters" onClick={() => setFiltersOpen((open) => !open)}>
            <FilterIcon /> {filtersOpen ? 'Hide filters' : 'Filter resources'}
          </button>

          <div className="wa-rl__layout">
            <div id="wa-resource-filters" className={filtersOpen ? 'wa-rl__filters wa-rl__filters--open' : 'wa-rl__filters'}>
              <FilterSidebar
                categoryOptions={categoryOptions}
                fileTypeOptions={fileTypeOptions}
                selectedCategories={selectedCategories}
                selectedFileTypes={selectedFileTypes}
                showFileTypes={show_file_type_filter}
                showAvailable={show_member_only_filter}
                availableOnly={availableOnly}
                resultCount={filteredRows.length}
                onCategoryToggle={toggleCategory}
                onFileTypeToggle={toggleFileType}
                onAvailableToggle={() => { setAvailableOnly((active) => !active); setPage(1) }}
                onReset={resetFilters}
              />
            </div>

            <div className="wa-rl__results">
              <p className="wa-rl__count" aria-live="polite" aria-atomic="true">Showing <strong>{pagedRows.length}</strong> of <strong>{filteredRows.length}</strong> resources</p>

              {filteredRows.length > 0 ? (
                <>
                  <ul ref={gridRef} className="wa-rl__grid" role="list">
                    {pagedRows.map((row) => (
                      <li key={row.id} className="wa-rl__grid-item">
                        <ResourceCard row={row} locked_overlay_message={locked_overlay_message} locked_cta_label={locked_cta_label} locked_cta_url={locked_cta_url} member_tier={member_tier} />
                      </li>
                    ))}
                  </ul>
                  {totalPages > 1 && <Pagination page={safePage} totalPages={totalPages} onChange={setPage} scrollTargetRef={gridRef} />}
                </>
              ) : (
                <div className="wa-rl__empty">
                  <h3>No resources found</h3>
                  <p>{hasFilters ? 'Try a different search term or clear your filters.' : 'No resources are available yet.'}</p>
                  {hasFilters && <button type="button" onClick={clearAll}>Reset filters</button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default ResourceLibrary
