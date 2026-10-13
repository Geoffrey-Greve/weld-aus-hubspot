import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Filter } from '@shared/components/Filter'
import { Pagination } from '@shared/components/Pagination'
import { debounce } from '@shared/utils/debounce'
import './FindAMember.css'

// ---------------------------------------------------------------------------
// Types (normalised from HubSpot CRM Company membership fields in HubL)
// ---------------------------------------------------------------------------

export interface MemberRow {
  id: number | string
  company_name: string
  member_tier: string       // 'Gold' | 'Silver' | 'Bronze' | 'Reciprocal' | 'Industry Supplier'
  tier_order: number        // 1-5, computed in HubL
  company_logo_url: string
  company_logo_alt: string
  company_blurb: string     // escaped CRM text with line breaks normalised in HubL
  website_url: string
  contact_email: string
  state_operation: string[] // e.g. ['NSW', 'VIC']
}

export interface FindAMemberProps {
  rows: MemberRow[]
  section_heading: string
  intro: string             // rich text HTML
  default_sort: 'tier' | 'name_asc' | 'state'
  tiers_visible: string[]   // module field values: 'gold'|'silver'|'bronze'|'reciprocal'|'industry_supplier'
  page_size: number
  show_state_filter: boolean
  show_search: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps module field keys (lowercase) to display tier labels. */
const TIER_KEY_TO_LABEL: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  reciprocal: 'Reciprocal',
  industry_supplier: 'Industry Supplier',
}

const KNOWN_TIER_LABELS = new Set(Object.values(TIER_KEY_TO_LABEL))

/** Maps tier label to a CSS modifier slug. */
function tierToCssSlug(tier: string): string {
  return tier.toLowerCase().replace(/\s+/g, '-')
}

/**
 * Reads the initial search term from the page URL's `?q=` param. The hero
 * search module GETs to this page with `?q=<term>`, so on landing we pre-fill
 * the search box and filter the directory. Guarded for non-browser contexts.
 */
function getInitialQuery(): string {
  if (typeof window === 'undefined') return ''
  try {
    return new URLSearchParams(window.location.search).get('q')?.trim() ?? ''
  } catch {
    return ''
  }
}

const SORT_OPTIONS: { value: 'tier' | 'name_asc' | 'state'; label: string }[] = [
  { value: 'tier', label: 'By tier' },
  { value: 'name_asc', label: 'Name A→Z' },
  { value: 'state', label: 'By state' },
]

// ---------------------------------------------------------------------------
// Sorting helper
//
// Sorting rules:
//   - By tier: Gold(1) > Silver(2) > Bronze(3) > Reciprocal(4) > Industry Supplier(5).
//   - Name A-Z and State: sort the complete filtered result set, regardless of tier.
// ---------------------------------------------------------------------------

function sortRows(
  rows: MemberRow[],
  sort: 'tier' | 'name_asc' | 'state'
): MemberRow[] {
  return [...rows].sort((a, b) => {
    const nameDiff = a.company_name.localeCompare(b.company_name)

    if (sort === 'state') {
      const stateA = (a.state_operation[0] ?? '').toLowerCase()
      const stateB = (b.state_operation[0] ?? '').toLowerCase()
      const stateDiff = stateA.localeCompare(stateB)
      if (stateDiff !== 0) return stateDiff
      if (nameDiff !== 0) return nameDiff
      return (a.tier_order || 99) - (b.tier_order || 99)
    }

    if (sort === 'name_asc') {
      if (nameDiff !== 0) return nameDiff
      return (a.tier_order || 99) - (b.tier_order || 99)
    }

    const tierDiff = (a.tier_order || 99) - (b.tier_order || 99)
    if (tierDiff !== 0) return tierDiff
    return nameDiff
  })
}

// ---------------------------------------------------------------------------
// MemberCard sub-component
// ---------------------------------------------------------------------------

interface MemberCardProps {
  row: MemberRow
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  const letters = words
    .map((w) => w[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
  return letters.toUpperCase()
}

function MemberCard({ row }: MemberCardProps): React.ReactElement {
  const tierSlug = tierToCssSlug(row.member_tier)

  // A logo URL can be present but dead (404 / removed CDN asset). Track load
  // failure so a broken image falls back to the same initials placeholder used
  // when no logo is set, instead of a browser broken-image icon.
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = Boolean(row.company_logo_url) && !logoFailed

  return (
    <article
      className={`wa-fam__card wa-fam__card--${tierSlug}`}
      aria-label={`${row.company_name} - ${row.member_tier} member`}
    >
      {/* Logo */}
      <div className="wa-fam__card-logo">
        {showLogo ? (
          <img
            src={row.company_logo_url}
            alt={row.company_logo_alt || row.company_name}
            className="wa-fam__logo-img"
            loading="lazy"
            width={80}
            height={80}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <div className="wa-fam__logo-initials" aria-hidden="true">
            {getInitials(row.company_name)}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="wa-fam__card-body">
        <div className="wa-fam__card-title-row">
          <h3 className="wa-fam__company-name">{row.company_name}</h3>
          <span className={`wa-fam__tier-badge wa-fam__tier-badge--${tierSlug}`}>
            {row.member_tier}
          </span>
        </div>

        {row.state_operation.length > 0 && (
          <p className="wa-fam__states">{row.state_operation.join(' · ')}</p>
        )}

        {row.company_blurb && (
          <div
            className="wa-fam__blurb"
            /* trusted, escaped CRM text with line breaks normalised in HubL */
            dangerouslySetInnerHTML={{ __html: row.company_blurb }}
          />
        )}

        {/* CTAs */}
        <div className="wa-fam__card-actions">
          {row.website_url && (
            <a
              href={row.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="wa-btn wa-btn--secondary wa-fam__cta"
            >
              Visit website
            </a>
          )}
          {row.contact_email && (
            <a
              href={`mailto:${row.contact_email}`}
              className="wa-fam__email-link"
            >
              {row.contact_email}
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function FindAMember({
  rows,
  section_heading,
  intro,
  default_sort,
  tiers_visible,
  page_size,
  show_state_filter,
  show_search,
}: FindAMemberProps): React.ReactElement {
  // Derive the set of visible tier labels from tiers_visible keys
  const visibleTierLabels = useMemo<Set<string>>(
    () =>
      new Set(
        tiers_visible
          .map((key) => TIER_KEY_TO_LABEL[key])
          .filter((label): label is string => Boolean(label))
      ),
    [tiers_visible]
  )

  // Eligible rows: configured tiers plus any current legacy CRM tier labels.
  const eligibleRows = useMemo<MemberRow[]>(
    () =>
      rows.filter(
        (r) =>
          visibleTierLabels.has(r.member_tier) ||
          !KNOWN_TIER_LABELS.has(r.member_tier)
      ),
    [rows, visibleTierLabels]
  )

  // Filter state
  const [selectedTiers, setSelectedTiers] = useState<string[]>([])
  const [selectedStates, setSelectedStates] = useState<string[]>([])
  const [sort, setSort] = useState<'tier' | 'name_asc' | 'state'>(default_sort)
  const [page, setPage] = useState(1)

  // Search: controlled input value + separate debounced query state.
  // Both seed from the URL `?q=` param so the hero search filters on landing.
  const [searchInput, setSearchInput] = useState(getInitialQuery)
  const [searchQuery, setSearchQuery] = useState(getInitialQuery)

  // Debounced setter for searchQuery
  const debouncedSetQuery = useRef(
    debounce((q: unknown) => {
      setSearchQuery(q as string)
      setPage(1)
    }, 200)
  )

  // Keep ref current across renders without recreating the debounced fn
  useEffect(() => {
    const fn = debouncedSetQuery.current
    return () => {
      fn.cancel()
    }
  }, [])

  // Derived: which tier options are actually present in eligible rows
  const tierOptionsPresent = useMemo(() => {
    const presentTiers = new Set(eligibleRows.map((r) => r.member_tier))
    // Return them in canonical tier_order
    const tierOrder: string[] = ['Gold', 'Silver', 'Bronze', 'Reciprocal', 'Industry Supplier']
    return tierOrder
      .filter((t) => presentTiers.has(t))
      .map((t) => ({ value: t, label: t }))
  }, [eligibleRows])

  // Derived: which state options are actually present in eligible rows
  const stateOptionsPresent = useMemo(() => {
    const stateSet = new Set<string>()
    for (const row of eligibleRows) {
      for (const s of row.state_operation) {
        stateSet.add(s)
      }
    }
    const australianStates = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT', 'National']
    const ordered = australianStates.filter((s) => stateSet.has(s))
    // Add any states not in the canonical list (just in case)
    for (const s of stateSet) {
      if (!ordered.includes(s)) ordered.push(s)
    }
    return ordered.map((s) => ({ value: s, label: s }))
  }, [eligibleRows])

  // Filtered + sorted rows
  const filteredRows = useMemo<MemberRow[]>(() => {
    let result = eligibleRows

    // Tier filter (empty = show all)
    if (selectedTiers.length > 0) {
      result = result.filter((r) => selectedTiers.includes(r.member_tier))
    }

    // State filter (empty = show all)
    if (selectedStates.length > 0) {
      result = result.filter((r) =>
        r.state_operation.some((s) => selectedStates.includes(s))
      )
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter((r) => r.company_name.toLowerCase().includes(q))
    }

    return sortRows(result, sort)
  }, [eligibleRows, selectedTiers, selectedStates, searchQuery, sort])

  // Pagination
  const effectivePageSize = page_size > 0 ? page_size : 24
  const totalPages = Math.ceil(filteredRows.length / effectivePageSize)
  const pagedRows = useMemo<MemberRow[]>(() => {
    const start = (page - 1) * effectivePageSize
    return filteredRows.slice(start, start + effectivePageSize)
  }, [filteredRows, page, effectivePageSize])

  // Ref for scroll-to-top on page change (passed to Pagination)
  const gridRef = useRef<HTMLUListElement>(null)

  // Handlers
  const handleTierChange = useCallback((tiers: string[]) => {
    setSelectedTiers(tiers)
    setPage(1)
  }, [])

  const handleStateChange = useCallback((states: string[]) => {
    setSelectedStates(states)
    setPage(1)
  }, [])

  const handleSortChange = useCallback((newSort: 'tier' | 'name_asc' | 'state') => {
    setSort(newSort)
    setPage(1)
  }, [])

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setSearchInput(val)
      debouncedSetQuery.current(val)
    },
    []
  )

  const hasFilters =
    selectedTiers.length > 0 || selectedStates.length > 0 || searchQuery.trim().length > 0

  // Result count text
  const countText =
    filteredRows.length === 1
      ? 'Showing 1 member'
      : `Showing ${filteredRows.length} members`

  return (
    <div className="wa-fam">
      {/* Header */}
      {(section_heading || intro) && (
        <div className="wa-fam__header">
          {section_heading && <h2 className="wa-fam__heading">{section_heading}</h2>}
          {intro && (
            <div
              className="wa-fam__intro"
              /* trusted CMS HTML from HubSpot richtext field */
              dangerouslySetInnerHTML={{ __html: intro }}
            />
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="wa-fam__toolbar">
        {show_search && (
          <div className="wa-fam__search-wrap">
            <label htmlFor="wa-fam-search" className="wa-visually-hidden">
              Search members
            </label>
            <input
              id="wa-fam-search"
              type="search"
              role="searchbox"
              className="wa-fam__search"
              placeholder="Search by company name…"
              value={searchInput}
              onChange={handleSearchChange}
              autoComplete="off"
            />
          </div>
        )}

        <div className="wa-fam__filters">
          {tierOptionsPresent.length > 1 && (
            <Filter
              label="Tier"
              options={tierOptionsPresent}
              value={selectedTiers}
              onChange={handleTierChange}
            />
          )}
          {show_state_filter && stateOptionsPresent.length > 1 && (
            <Filter
              label="State"
              options={stateOptionsPresent}
              value={selectedStates}
              onChange={handleStateChange}
            />
          )}
        </div>

        <div className="wa-fam__sort" role="group" aria-label="Sort order">
          <span className="wa-fam__sort-label">Sort:</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={[
                'wa-fam__sort-btn',
                sort === opt.value ? 'wa-fam__sort-btn--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={sort === opt.value}
              onClick={() => handleSortChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result count */}
      <p className="wa-fam__count" aria-live="polite" aria-atomic="true">
        {filteredRows.length > 0 ? countText : ''}
      </p>

      {/* Grid or empty state */}
      {filteredRows.length > 0 ? (
        <>
          <ul ref={gridRef} className="wa-fam__grid" role="list">
            {pagedRows.map((row) => (
              <li key={row.id} className="wa-fam__grid-item">
                <MemberCard row={row} />
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} scrollTargetRef={gridRef} />
        </>
      ) : (
        <div className="wa-fam__empty">
          <p>
            {hasFilters
              ? 'No members match your search. Try adjusting the filters.'
              : 'No members to display.'}
          </p>
        </div>
      )}
    </div>
  )
}

export default FindAMember
