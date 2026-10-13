import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Filter } from '@shared/components/Filter'
import { Pagination } from '@shared/components/Pagination'
import { EmptyState } from '@shared/components/EmptyState'
import { debounce } from '@shared/utils/debounce'
import './JobsListing.css'

// ---------------------------------------------------------------------------
// Types (mirrors HubDB jobs table)
// ---------------------------------------------------------------------------

export interface JobRow {
  id: number | string
  job_title: string
  company_name: string
  job_type: string      // 'Full-time' | 'Part-time' | 'Contract' | 'Apprenticeship'
  job_type_key: string  // 'full_time' | 'part_time' | 'contract' | 'apprenticeship'
  job_state: string     // 'NSW' | 'VIC' | etc.
  job_state_key: string // 'nsw' | 'vic' | etc.
  job_location: string  // city/suburb
  job_description: string // rich text HTML
  /**
   * Where the Apply CTA points for web-apply roles. For email-apply roles this
   * is a progressive-enhancement fallback (job detail #apply); the real mailto
   * is assembled on click from apply_email_u + apply_email_d (defect 68).
   */
  apply_href: string
  /** True only for genuine external application links. */
  apply_external: boolean
  /** Local part of the employer email (email-apply only). */
  apply_email_u?: string
  /** Domain part of the employer email (email-apply only). */
  apply_email_d?: string
  /** Optional mailto subject for email-apply roles. */
  apply_subject?: string
  closing_date: string  // ISO date YYYY-MM-DD (may be empty)
  date_posted: string   // ISO date YYYY-MM-DD (may be empty)
  is_featured: boolean
}

export interface JobsListingProps {
  rows: JobRow[]
  section_heading: string
  intro: string              // rich text HTML
  default_state_filter: string
  default_type_filter: string
  page_size: number
  post_a_job_label: string
  post_a_job_link_href: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_OPTIONS = [
  { value: 'nsw', label: 'NSW' },
  { value: 'vic', label: 'VIC' },
  { value: 'qld', label: 'QLD' },
  { value: 'wa', label: 'WA' },
  { value: 'sa', label: 'SA' },
  { value: 'tas', label: 'TAS' },
  { value: 'nt', label: 'NT' },
  { value: 'act', label: 'ACT' },
]

const TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'apprenticeship', label: 'Apprenticeship' },
]

// ---------------------------------------------------------------------------
// Date formatting helper
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(dateStr))
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// JobCard sub-component (list-style, not grid)
// ---------------------------------------------------------------------------

interface JobCardProps {
  job: JobRow
}

function JobCard({ job }: JobCardProps): React.ReactElement {
  const closingText = job.closing_date
    ? `Applications close ${formatDate(job.closing_date)}`
    : ''

  return (
    <article
      className={[
        'wa-jl__card',
        job.is_featured ? 'wa-jl__card--featured' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`${job.job_title} at ${job.company_name}`}
    >
      <div className="wa-jl__card-main">
        {/* Title + company row */}
        <div className="wa-jl__card-header">
          <div className="wa-jl__card-titles">
            <h3 className="wa-jl__job-title">{job.job_title}</h3>
            {job.company_name && (
              <p className="wa-jl__company">{job.company_name}</p>
            )}
          </div>
          {job.is_featured && (
            <span className="wa-jl__featured-badge">Featured</span>
          )}
        </div>

        {/* Meta row: type, location + state, closing date */}
        <div className="wa-jl__meta">
          {job.job_type && (
            <span className={`wa-jl__type-badge wa-jl__type-badge--${job.job_type_key}`}>
              {job.job_type}
            </span>
          )}
          {(job.job_location || job.job_state) && (
            <span className="wa-jl__location">
              {[job.job_location, job.job_state].filter(Boolean).join(', ')}
            </span>
          )}
          {closingText && (
            <span className="wa-jl__closing">
              <time dateTime={job.closing_date}>{closingText}</time>
            </span>
          )}
        </div>

        {/* Description snippet */}
        {job.job_description && (
          <div
            className="wa-jl__description"
            dangerouslySetInnerHTML={{ __html: job.job_description }}
          />
        )}
      </div>

      {/* Apply CTA */}
      {(job.apply_email_u && job.apply_email_d) || job.apply_href ? (
        <div className="wa-jl__card-action">
          {job.apply_email_u && job.apply_email_d ? (
            <a
              href={job.apply_href || '#apply'}
              className="wa-btn wa-btn--primary wa-jl__apply-btn"
              data-job-apply=""
              data-job-apply-u={job.apply_email_u}
              data-job-apply-d={job.apply_email_d}
              {...(job.apply_subject
                ? { 'data-job-apply-subject': job.apply_subject }
                : {})}
            >
              Apply now
            </a>
          ) : (
            <a
              href={job.apply_href}
              className="wa-btn wa-btn--primary wa-jl__apply-btn"
              {...(job.apply_external
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
            >
              Apply now
            </a>
          )}
        </div>
      ) : null}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function JobsListing({
  rows,
  section_heading,
  intro,
  page_size,
  post_a_job_label,
  post_a_job_link_href,
}: JobsListingProps): React.ReactElement {
  const [selectedStates, setSelectedStates] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  // Debounced search
  const debouncedSetQuery = useRef(
    debounce((q: unknown) => {
      setSearchQuery(q as string)
      setPage(1)
    }, 200)
  )
  useEffect(() => {
    const fn = debouncedSetQuery.current
    return () => fn.cancel()
  }, [])

  // Derive filter options present in the dataset
  const stateOptions = useMemo(() => {
    const presentKeys = new Set(rows.map((r) => r.job_state_key).filter(Boolean))
    return STATE_OPTIONS.filter((o) => presentKeys.has(o.value))
  }, [rows])

  const typeOptions = useMemo(() => {
    const presentKeys = new Set(rows.map((r) => r.job_type_key).filter(Boolean))
    return TYPE_OPTIONS.filter((o) => presentKeys.has(o.value))
  }, [rows])

  // Filtered rows
  const filteredRows = useMemo<JobRow[]>(() => {
    let result = rows

    if (selectedStates.length > 0) {
      result = result.filter((r) => selectedStates.includes(r.job_state_key))
    }
    if (selectedTypes.length > 0) {
      result = result.filter((r) => selectedTypes.includes(r.job_type_key))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (r) =>
          r.job_title.toLowerCase().includes(q) ||
          r.company_name.toLowerCase().includes(q)
      )
    }

    return result
  }, [rows, selectedStates, selectedTypes, searchQuery])

  // Pagination
  const effectivePageSize = page_size > 0 ? Math.min(page_size, 10) : 10
  const totalPages = Math.ceil(filteredRows.length / effectivePageSize)
  const pagedRows = useMemo<JobRow[]>(() => {
    const start = (page - 1) * effectivePageSize
    return filteredRows.slice(start, start + effectivePageSize)
  }, [filteredRows, page, effectivePageSize])
  const visibleStart = filteredRows.length > 0 ? (page - 1) * effectivePageSize + 1 : 0
  const visibleEnd = Math.min(page * effectivePageSize, filteredRows.length)

  const handleStateChange = useCallback((states: string[]) => {
    setSelectedStates(states)
    setPage(1)
  }, [])

  const handleTypeChange = useCallback((types: string[]) => {
    setSelectedTypes(types)
    setPage(1)
  }, [])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchInput(val)
    debouncedSetQuery.current(val)
  }, [])

  const hasFilters =
    selectedStates.length > 0 || selectedTypes.length > 0 || searchQuery.trim().length > 0

  const clearFilters = useCallback(() => {
    setSelectedStates([])
    setSelectedTypes([])
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }, [])

  return (
    <div className="wa-jl">
      {/* Header */}
      {(section_heading || intro) && (
        <div className="wa-jl__header">
          {section_heading && <h2 className="wa-jl__heading">{section_heading}</h2>}
          {intro && (
            <div
              className="wa-jl__intro"
              dangerouslySetInnerHTML={{ __html: intro }}
            />
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="wa-jl__toolbar">
        {/* Search */}
        <div className="wa-jl__search-wrap">
          <label htmlFor="wa-jl-search" className="wa-visually-hidden">
            Search jobs
          </label>
          <input
            id="wa-jl-search"
            type="search"
            role="searchbox"
            className="wa-jl__search"
            placeholder="Search by job title or company…"
            value={searchInput}
            onChange={handleSearchChange}
            autoComplete="off"
          />
        </div>

        {/* Filters */}
        <div className="wa-jl__filters">
          {stateOptions.length > 0 && (
            <Filter
              label="State"
              options={stateOptions}
              value={selectedStates}
              onChange={handleStateChange}
            />
          )}
          {typeOptions.length > 0 && (
            <Filter
              label="Type"
              options={typeOptions}
              value={selectedTypes}
              onChange={handleTypeChange}
            />
          )}
        </div>

        {/* Actions */}
        <div className="wa-jl__toolbar-actions">
          {hasFilters && (
            <button
              type="button"
              className="wa-btn wa-btn--ghost wa-jl__clear-btn"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
          {post_a_job_link_href && (
            <a
              href={post_a_job_link_href}
              className="wa-btn wa-btn--secondary wa-jl__post-btn"
            >
              {post_a_job_label || 'Post a job (members only)'}
            </a>
          )}
        </div>
      </div>

      {/* Result count */}
      {filteredRows.length > 0 && (
        <p className="wa-jl__count" aria-live="polite" aria-atomic="true">
          {filteredRows.length === 1
            ? 'Showing 1 job'
            : `Showing ${visibleStart}-${visibleEnd} of ${filteredRows.length} jobs`}
        </p>
      )}

      {/* List */}
      {filteredRows.length > 0 ? (
        <>
          <ul className="wa-jl__list" role="list">
            {pagedRows.map((job) => (
              <li key={job.id} className="wa-jl__list-item">
                <JobCard job={job} />
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState
          heading={
            rows.length === 0
              ? 'No jobs listed currently.'
              : 'No jobs match your search.'
          }
          body={
            hasFilters && rows.length > 0
              ? 'Try adjusting your filters or clearing your search.'
              : undefined
          }
          action={
            hasFilters ? (
              <button
                type="button"
                className="wa-btn wa-btn--secondary"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}

export default JobsListing
