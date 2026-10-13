import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { submitHubSpotForm } from '@shared/api/forms'
import { orderCitiesForRows, sameCity } from '@shared/courseCities'
import { formatCurrencyDollars } from '@shared/utils/formatCurrency'
import { formatDateRange } from '@shared/utils/formatDate'
import { buildRegistrationUrl } from '@shared/utils/registration'
import { hasStartDatePassed } from '@shared/api/eventEngine'
import { resolveMemberPrice } from '@shared/utils/memberPricing'
import {
  type HubdbStatus,
  type SessionStatus,
  hubdbStatusToSessionStatus,
  statusPresentation,
} from '@shared/status/sessionStatus'
import {
  COURSE_CATEGORY_BUCKETS,
  bucketForCategory,
  bucketLabel,
  resolveBucketFromParam,
} from '@shared/courseTaxonomy'
import './CourseTimetableFilter.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CourseTimetableRow {
  id: number | string
  course_name: string
  course_category: string
  delivery_mode: string
  city: string
  start_date: string
  end_date: string
  price_member: number
  price_individual?: number
  price_student?: number
  price_bronze?: number
  price_silver?: number
  price_gold?: number
  price_non_member: number
  registration_url: string
  use_event_engine?: boolean
  /** Event Engine event id. Without it the checkout has nothing to reserve against. */
  worker_event_id?: string
  /** The HubDB `status` column, slugged by HubL. `closed` is Ref 74c. */
  status: HubdbStatus
  seats_remaining: number
}

export interface CourseTimetableFilterProps {
  rows: CourseTimetableRow[]
  member_tier: string
  default_city: string
  /**
   * Training division slug (see config/course-categories.json), or 'any'. A
   * `?category=` URL param takes precedence when it names a real division, so
   * the Training menu and the category landing pages can deep-link a filtered
   * view of the same module.
   */
  default_category: string
  default_delivery_mode: string
  show_seats_remaining: boolean
  page_size: number
  eoi_form_id: string
  eoi_message: string
  portal_id: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type DatePreset = 'any' | 'today' | 'this_week' | 'this_month' | 'custom'

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'any', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

type SortKey =
  | 'course_name'
  | 'city'
  | 'start_date'
  | 'price_member'
  | 'price_non_member'
type SortDir = 'asc' | 'desc'

// ---------------------------------------------------------------------------
// Date helpers (all arithmetic is date-only, no TZ conversion)
// ---------------------------------------------------------------------------

function parseIsoDate(iso: string): Date {
  const parts = iso.split('-').map(Number)
  const y = parts[0] ?? 0
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  return new Date(y, m - 1, d)
}

/**
 * Resolve the category the page should open on: a `?category=` URL param wins,
 * then the module's configured default, then 'any'. An unrecognised param falls
 * through to the default rather than filtering every course away.
 *
 * Mirrors resolveInitialFilter() in featured-courses.module - both read the same
 * taxonomy generated from config/course-categories.json.
 */
function getInitialCategory(defaultCategory: string): string {
  if (typeof window !== 'undefined') {
    try {
      const fromUrl = resolveBucketFromParam(
        new URLSearchParams(window.location.search).get('category')
      )
      if (fromUrl) return fromUrl
    } catch {
      // Malformed query string - fall through to the configured default.
    }
  }
  const fromDefault = resolveBucketFromParam(defaultCategory)
  return fromDefault || 'any'
}

function todayMidnight(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekStart(ref: Date): Date {
  const d = new Date(ref)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekEnd(ref: Date): Date {
  const start = getWeekStart(ref)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return end
}

function getMonthStart(ref: Date): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), 1)
}

function getMonthEnd(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
  d.setHours(23, 59, 59, 999)
  return d
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function CourseTimetableFilter({
  rows,
  member_tier,
  default_city,
  default_category,
  default_delivery_mode,
  show_seats_remaining,
  page_size = 25,
  eoi_form_id,
  eoi_message,
  portal_id,
}: CourseTimetableFilterProps): React.ReactElement {
  const isMember = Boolean(member_tier)

  // Derive unique cities, categories and delivery modes from the data -------

  // Only cities these rows actually use - this selector filters what is on the
  // page, so an empty option would filter every course away. A city outside the
  // canonical order (a new regional town) still appears, once, however many
  // sessions share it: the old loop pushed one option per ROW.
  const cities = useMemo(() => orderCitiesForRows(rows, { includeEmpty: false }), [rows])

  // Categories are the client's training divisions, not the raw HubDB values -
  // kept in taxonomy display order and limited to divisions actually present.
  const categories = useMemo(() => {
    const present = new Set(rows.map((r) => bucketForCategory(r.course_category)))
    return COURSE_CATEGORY_BUCKETS.filter((b) => present.has(b.slug)).map((b) => ({
      slug: b.slug,
      label: b.label,
    }))
  }, [rows])

  const deliveryModes = useMemo(() => {
    const seen = new Set<string>()
    return rows
      .map((r) => r.delivery_mode)
      .filter((d) => d && !seen.has(d) && seen.add(d) as unknown as boolean)
  }, [rows])

  // Filter state -------------------------------------------------------------

  const [selectedCity, setSelectedCity] = useState(
    default_city && default_city !== 'any' ? default_city : 'any'
  )
  const [selectedCategory, setSelectedCategory] = useState(() =>
    getInitialCategory(default_category)
  )
  const [selectedDelivery, setSelectedDelivery] = useState(
    default_delivery_mode && default_delivery_mode !== 'any'
      ? default_delivery_mode
      : 'any'
  )
  const [datePreset, setDatePreset] = useState<DatePreset>('any')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Sort state ---------------------------------------------------------------

  const [sortKey, setSortKey] = useState<SortKey>('start_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Pagination ---------------------------------------------------------------

  const [page, setPage] = useState(1)
  const resetPage = useCallback(() => setPage(1), [])

  // Filtered + sorted + paginated -------------------------------------------

  const filtered = useMemo(() => {
    const today = todayMidnight()

    return rows.filter((row) => {
      if (selectedCity !== 'any' && !sameCity(row.city, selectedCity)) return false
      if (
        selectedCategory !== 'any' &&
        bucketForCategory(row.course_category) !== selectedCategory
      )
        return false
      if (selectedDelivery !== 'any' && row.delivery_mode !== selectedDelivery)
        return false

      const start = parseIsoDate(row.start_date)

      switch (datePreset) {
        case 'today': {
          const end = new Date(today)
          end.setHours(23, 59, 59, 999)
          if (start < today || start > end) return false
          break
        }
        case 'this_week': {
          if (start < getWeekStart(today) || start > getWeekEnd(today)) return false
          break
        }
        case 'this_month': {
          if (start < getMonthStart(today) || start > getMonthEnd(today)) return false
          break
        }
        case 'custom': {
          if (dateFrom && start < parseIsoDate(dateFrom)) return false
          if (dateTo) {
            const to = parseIsoDate(dateTo)
            to.setHours(23, 59, 59, 999)
            if (start > to) return false
          }
          break
        }
        default:
          break
      }

      return true
    })
  }, [
    rows,
    selectedCity,
    selectedCategory,
    selectedDelivery,
    datePreset,
    dateFrom,
    dateTo,
  ])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: string | number
      let vb: string | number

      if (sortKey === 'start_date') {
        va = parseIsoDate(a.start_date).getTime()
        vb = parseIsoDate(b.start_date).getTime()
      } else if (sortKey === 'price_member') {
        va = resolveMemberPrice(a, member_tier).price
        vb = resolveMemberPrice(b, member_tier).price
      } else {
        va = a[sortKey]
        vb = b[sortKey]
      }

      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }

      const sa = String(va).toLowerCase()
      const sb = String(vb).toLowerCase()
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
    })
  }, [filtered, sortKey, sortDir, member_tier])

  const totalPages = Math.max(1, Math.ceil(sorted.length / page_size))

  const paginated = useMemo(() => {
    const start = (page - 1) * page_size
    return sorted.slice(start, start + page_size)
  }, [sorted, page, page_size])

  // Sort handler -------------------------------------------------------------

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1)
  }

  function handleSortKeydown(e: React.KeyboardEvent, key: SortKey) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleSort(key)
    }
  }

  // Filter change helpers ----------------------------------------------------

  function handleCityChange(v: string) {
    setSelectedCity(v)
    resetPage()
  }

  function handleCategoryChange(v: string) {
    setSelectedCategory(v)
    resetPage()
  }

  function handleDeliveryChange(v: string) {
    setSelectedDelivery(v)
    resetPage()
  }

  const hasActiveFilters =
    selectedCity !== 'any' ||
    selectedCategory !== 'any' ||
    selectedDelivery !== 'any' ||
    datePreset !== 'any'

  function handleClearFilters() {
    setSelectedCity('any')
    setSelectedCategory('any')
    setSelectedDelivery('any')
    setDatePreset('any')
    setDateFrom('')
    setDateTo('')
    resetPage()
  }

  function handleDatePreset(preset: DatePreset) {
    setDatePreset(preset)
    if (preset !== 'custom') {
      setDateFrom('')
      setDateTo('')
    }
    resetPage()
  }

  // EOI form -----------------------------------------------------------------

  const [eoiName, setEoiName] = useState('')
  const [eoiEmail, setEoiEmail] = useState('')
  const [eoiSubmitting, setEoiSubmitting] = useState(false)
  const [eoiSuccess, setEoiSuccess] = useState(false)
  const [eoiError, setEoiError] = useState('')

  async function handleEoiSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!eoi_form_id) return
    setEoiSubmitting(true)
    setEoiError('')
    try {
      await submitHubSpotForm(portal_id, eoi_form_id, {
        fields: [
          { name: 'firstname', value: eoiName },
          { name: 'email', value: eoiEmail },
          {
            name: 'course_eoi_city',
            value: selectedCity !== 'any' ? selectedCity : '',
          },
          {
            name: 'course_eoi_category',
            value: selectedCategory !== 'any' ? bucketLabel(selectedCategory) : '',
          },
          {
            name: 'course_eoi_delivery',
            value: selectedDelivery !== 'any' ? selectedDelivery : '',
          },
        ],
        context: { pageUri: window.location.href, pageName: document.title },
      })
      setEoiSuccess(true)
    } catch {
      setEoiError(
        'Something went wrong - please try again or contact us directly.'
      )
    } finally {
      setEoiSubmitting(false)
    }
  }

  function ariaSortFor(key: SortKey): React.AriaAttributes['aria-sort'] {
    if (key !== sortKey) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  // Render ------------------------------------------------------------------

  return (
    <div className="wa-ctf">
      <FilterBar
        cities={cities}
        categories={categories}
        deliveryModes={deliveryModes}
        selectedCity={selectedCity}
        selectedCategory={selectedCategory}
        selectedDelivery={selectedDelivery}
        datePreset={datePreset}
        dateFrom={dateFrom}
        dateTo={dateTo}
        hasActiveFilters={hasActiveFilters}
        onCityChange={handleCityChange}
        onCategoryChange={handleCategoryChange}
        onDeliveryChange={handleDeliveryChange}
        onDatePreset={handleDatePreset}
        onDateFromChange={(v) => {
          setDateFrom(v)
          resetPage()
        }}
        onDateToChange={(v) => {
          setDateTo(v)
          resetPage()
        }}
        onClearFilters={handleClearFilters}
      />

      {paginated.length > 0 ? (
        <>
          {/* Desktop table - hidden on mobile via CSS */}
          <div className="wa-ctf__table-wrap" role="region" aria-label="Course sessions table">
            <table className="wa-ctf__table">
              <thead>
                <tr>
                  <SortableHeader
                    label="Course"
                    sortKey="course_name"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    ariaSortValue={ariaSortFor('course_name')}
                    onSort={handleSort}
                    onKeydown={handleSortKeydown}
                  />
                  <SortableHeader
                    label="Location"
                    sortKey="city"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    ariaSortValue={ariaSortFor('city')}
                    onSort={handleSort}
                    onKeydown={handleSortKeydown}
                  />
                  <SortableHeader
                    label="Date"
                    sortKey="start_date"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    ariaSortValue={ariaSortFor('start_date')}
                    onSort={handleSort}
                    onKeydown={handleSortKeydown}
                  />
                  <SortableHeader
                    label="Member price (ex GST)"
                    sortKey="price_member"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    ariaSortValue={ariaSortFor('price_member')}
                    onSort={handleSort}
                    onKeydown={handleSortKeydown}
                  />
                  <SortableHeader
                    label="Full price (ex GST)"
                    sortKey="price_non_member"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    ariaSortValue={ariaSortFor('price_non_member')}
                    onSort={handleSort}
                    onKeydown={handleSortKeydown}
                  />
                  <th className="wa-ctf__th wa-ctf__th--action" scope="col">
                    <span className="wa-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((row) => (
                  <TableRow
                    key={row.id}
                    row={row}
                    isMember={isMember}
                    memberTier={member_tier}
                    showSeatsRemaining={show_seats_remaining}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards - hidden on desktop via CSS */}
          <ul className="wa-ctf__cards" aria-label="Course sessions">
            {paginated.map((row) => (
              <li key={row.id} className="wa-ctf__cards-item">
                <MobileCard
                  row={row}
                  isMember={isMember}
                  memberTier={member_tier}
                  showSeatsRemaining={show_seats_remaining}
                />
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={sorted.length}
              pageSize={page_size}
              onPageChange={setPage}
            />
          )}
        </>
      ) : (
        <EoiForm
          message={eoi_message}
          name={eoiName}
          email={eoiEmail}
          submitting={eoiSubmitting}
          success={eoiSuccess}
          error={eoiError}
          hasFormId={Boolean(eoi_form_id)}
          onNameChange={setEoiName}
          onEmailChange={setEoiEmail}
          onSubmit={handleEoiSubmit}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  cities: string[]
  /** Training divisions present in the data, in taxonomy display order. */
  categories: Array<{ slug: string; label: string }>
  deliveryModes: string[]
  selectedCity: string
  selectedCategory: string
  selectedDelivery: string
  datePreset: DatePreset
  dateFrom: string
  dateTo: string
  hasActiveFilters: boolean
  onCityChange: (v: string) => void
  onCategoryChange: (v: string) => void
  onDeliveryChange: (v: string) => void
  onDatePreset: (v: DatePreset) => void
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  onClearFilters: () => void
}

function FilterBar({
  cities,
  categories,
  deliveryModes,
  selectedCity,
  selectedCategory,
  selectedDelivery,
  datePreset,
  dateFrom,
  dateTo,
  hasActiveFilters,
  onCityChange,
  onCategoryChange,
  onDeliveryChange,
  onDatePreset,
  onDateFromChange,
  onDateToChange,
  onClearFilters,
}: FilterBarProps): React.ReactElement {
  const [locationOpen, setLocationOpen] = useState(false)
  const locationRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!locationOpen) return
    function handlePointer(event: MouseEvent) {
      if (!locationRef.current || locationRef.current.contains(event.target as Node)) return
      setLocationOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setLocationOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [locationOpen])

  const locationLabel =
    selectedCity === 'any' ? 'All locations' : selectedCity

  return (
    <div className="wa-ctf__filters wa-ctf-filter" role="group" aria-label="Filter courses">
      {categories.length > 0 && (
        <div className="wa-ctf-filter__top" role="group" aria-label="Filter courses by type">
          <button
            type="button"
            className={[
              'wa-ctf__chip',
              selectedCategory === 'any' ? 'wa-ctf__chip--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={selectedCategory === 'any'}
            onClick={() => onCategoryChange('any')}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              className={[
                'wa-ctf__chip',
                selectedCategory === c.slug ? 'wa-ctf__chip--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={selectedCategory === c.slug}
              onClick={() => onCategoryChange(c.slug)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <span className="wa-ctf-filter__rule" aria-hidden="true" />

      <div className="wa-ctf-filter__bottom">
        {cities.length > 0 && (
          <div className="wa-ctf-location" ref={locationRef}>
            <button
              type="button"
              className="wa-ctf-location__toggle"
              aria-expanded={locationOpen}
              aria-label="Filter by location"
              onClick={() => setLocationOpen((open) => !open)}
            >
              <svg className="wa-ctf-location__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              <span>{locationLabel}</span>
              <svg className="wa-ctf-location__chevron" viewBox="0 0 20 20" aria-hidden="true">
                <path d="m5 7 5 5 5-5" />
              </svg>
            </button>
            {locationOpen && (
              <div className="wa-ctf-location__menu" role="listbox" aria-label="Locations">
                <button
                  type="button"
                  className="wa-ctf-location__option"
                  aria-pressed={selectedCity === 'any'}
                  onClick={() => {
                    onCityChange('any')
                    setLocationOpen(false)
                  }}
                >
                  All locations
                </button>
                {cities.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="wa-ctf-location__option"
                    aria-pressed={selectedCity === c}
                    onClick={() => {
                      onCityChange(c)
                      setLocationOpen(false)
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {cities.length > 0 && deliveryModes.length > 0 && (
          <span className="wa-ctf-filter__separator" aria-hidden="true" />
        )}

        {deliveryModes.length > 0 && (
          <div className="wa-ctf-filter__group" role="group" aria-label="Filter by delivery">
            {deliveryModes.map((d) => (
              <button
                key={d}
                type="button"
                className={[
                  'wa-ctf__chip',
                  'wa-ctf__chip--compact',
                  selectedDelivery === d ? 'wa-ctf__chip--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={selectedDelivery === d}
                onClick={() =>
                  onDeliveryChange(selectedDelivery === d ? 'any' : d)
                }
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {(cities.length > 0 || deliveryModes.length > 0) && (
          <span className="wa-ctf-filter__separator" aria-hidden="true" />
        )}

        <div
          className="wa-ctf-filter__group"
          role="group"
          aria-label="Filter by date"
        >
          {DATE_PRESETS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={[
                'wa-ctf__chip',
                'wa-ctf__chip--compact',
                datePreset === value ? 'wa-ctf__chip--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={datePreset === value}
              onClick={() => onDatePreset(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="wa-ctf__clear-btn"
            onClick={onClearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {datePreset === 'custom' && (
        <div className="wa-ctf__date-range">
          <div className="wa-ctf__filter-field">
            <label className="wa-ctf__filter-label" htmlFor="wa-ctf-date-from">
              From
            </label>
            <input
              id="wa-ctf-date-from"
              type="date"
              className="wa-ctf__date-input"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
            />
          </div>
          <div className="wa-ctf__filter-field">
            <label className="wa-ctf__filter-label" htmlFor="wa-ctf-date-to">
              To
            </label>
            <input
              id="wa-ctf-date-to"
              type="date"
              className="wa-ctf__date-input"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => onDateToChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SortableHeader
// ---------------------------------------------------------------------------

interface SortableHeaderProps {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  sortDir: SortDir
  ariaSortValue: React.AriaAttributes['aria-sort']
  onSort: (key: SortKey) => void
  onKeydown: (e: React.KeyboardEvent, key: SortKey) => void
}

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  ariaSortValue,
  onSort,
  onKeydown,
}: SortableHeaderProps): React.ReactElement {
  const isActive = sortKey === activeSortKey
  return (
    <th
      scope="col"
      className={[
        'wa-ctf__th',
        'wa-ctf__th--sortable',
        isActive ? 'wa-ctf__th--sorted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-sort={ariaSortValue}
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => onKeydown(e, sortKey)}
    >
      <span className="wa-ctf__th-inner">
        {label}
        <span className="wa-ctf__sort-icon" aria-hidden="true">
          {!isActive && '⇅'}
          {isActive && sortDir === 'asc' && '↑'}
          {isActive && sortDir === 'desc' && '↓'}
        </span>
      </span>
    </th>
  )
}

// ---------------------------------------------------------------------------
// TableRow (desktop)
// ---------------------------------------------------------------------------

interface RowProps {
  row: CourseTimetableRow
  isMember: boolean
  memberTier: string
  showSeatsRemaining: boolean
}

/**
 * `use_event_engine` is the editorial opt-in, but the checkout cannot load
 * without a `worker_event_id` to reserve against. A row carrying the tick and
 * not the id is treated as unticked so the buyer reaches the legacy
 * registration URL rather than a checkout that can only apologise.
 */
function usesCheckout(row: CourseTimetableRow): boolean {
  return Boolean(row.use_event_engine && row.worker_event_id)
}

function registrationHref(row: CourseTimetableRow, memberTier: string): string {
  return usesCheckout(row)
    ? `/checkout/?session_id=${encodeURIComponent(String(row.id))}`
    : buildRegistrationUrl(row.registration_url, memberTier)
}

/**
 * Why a row cannot be registered for, as a status from the shared vocabulary.
 *
 * TWO halves, and both close a session:
 *
 *   EDITORIAL - the status column, read through `hubdbStatusToSessionStatus` so every
 *   spelling HubL can produce lands on one status. `Closed` (Ref 74c) is staff shutting
 *   registrations on an UPCOMING session by hand; `Sold Out` and `Cancelled` are the
 *   decisions that were always there.
 *
 *   DERIVED - the start date. A session that has already begun is past the Worker's own
 *   default cutoff (registration_closes_at defaults to starts_at), and this listing has no
 *   live read to ask, so it says it from the row. Ref 46 round 2: sessions that ran in
 *   August were still offered with a Register button in September.
 *
 * The editorial half wins, because a person's decision outranks a derived one - a session
 * marked Cancelled should not read "Registrations closed" just because its date also
 * passed. Both halves end at the same six statuses and the same sentences
 * (`statusPresentation`), so the timetable, the course cards and the events badge cannot
 * word them differently. (CLAUDE.md § 7.6, § 7.11)
 */
function sessionStatusFor(row: CourseTimetableRow): SessionStatus {
  const editorial = hubdbStatusToSessionStatus(row.status)
  if (editorial !== 'available') return editorial
  if (hasStartDatePassed(row.start_date)) return 'registration_closed'
  return 'available'
}

function TableRow({ row, isMember, memberTier, showSeatsRemaining }: RowProps): React.ReactElement {
  // HubDB only - this module never calls the Worker - so the row answers for both halves:
  // the status column staff set, and a start date that has already passed.
  const presentation = statusPresentation(sessionStatusFor(row))
  const isUnavailable = !presentation.bookable
  const registerHref = registrationHref(row, memberTier)
  const memberPrice = resolveMemberPrice(row, memberTier).price

  return (
    <tr
      className={[
        'wa-ctf__tr',
        isUnavailable ? 'wa-ctf__tr--unavailable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <td className="wa-ctf__td">
        <span className="wa-ctf__course-name">{row.course_name}</span>
        {/* One badge, whatever the reason. Two hand-written branches is how `closed`
            arrived with a working "no Register" cell and no badge at all beside it. */}
        {isUnavailable && (
          <span className={`wa-ctf__badge wa-ctf__badge--${presentation.slug}`}>
            {presentation.label}
          </span>
        )}

      </td>
      <td className="wa-ctf__td">{row.city}</td>
      <td className="wa-ctf__td wa-ctf__td--date">
        {formatDateRange(row.start_date, row.end_date)}
        {showSeatsRemaining &&
          row.seats_remaining > 0 &&
          row.seats_remaining <= 5 && (
            <span className="wa-ctf__seats">
              {' '}
              &middot; Only {row.seats_remaining} spot
              {row.seats_remaining !== 1 ? 's' : ''} left
            </span>
          )}
      </td>
      <td className="wa-ctf__td wa-ctf__td--price">
        {/* Member price highlighted in green for every visitor to advertise
            the member discount (CLAUDE.md §5.4 rule 4). Uses the tier-resolved
            member price from resolveMemberPrice(). */}
        <span className="wa-ctf__price--member">
          {formatCurrencyDollars(memberPrice)}
        </span>
      </td>
      <td className="wa-ctf__td wa-ctf__td--price">
        <span
          className={
            isMember ? 'wa-ctf__price--struck' : 'wa-ctf__price--public'
          }
        >
          {formatCurrencyDollars(row.price_non_member)}
        </span>
      </td>
      <td className="wa-ctf__td wa-ctf__td--action">
        {!isUnavailable ? (
          <a
            href={registerHref}
            className="wa-btn wa-btn--primary wa-ctf__register-btn"
            rel={usesCheckout(row) ? undefined : 'noopener noreferrer'}
            target={usesCheckout(row) ? undefined : '_blank'}
          >
            Register
          </a>
        ) : (
          <span className="wa-ctf__unavailable-label">{presentation.label}</span>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// MobileCard
// ---------------------------------------------------------------------------

function MobileCard({ row, isMember, memberTier, showSeatsRemaining }: RowProps): React.ReactElement {
  // HubDB only, as TableRow above.
  const presentation = statusPresentation(sessionStatusFor(row))
  const isUnavailable = !presentation.bookable
  const registerHref = registrationHref(row, memberTier)
  const memberPrice = resolveMemberPrice(row, memberTier).price

  return (
    <div className={`wa-ctf__card wa-ctf__card--${row.status}`}>
      <div className="wa-ctf__card-header">
        <span className="wa-ctf__card-course">{row.course_name}</span>
        {isUnavailable && (
          <span className={`wa-ctf__badge wa-ctf__badge--${presentation.slug}`}>
            {presentation.label}
          </span>
        )}

      </div>

      <dl className="wa-ctf__card-meta">
        <div className="wa-ctf__card-meta-row">
          <dt>Location</dt>
          <dd>{row.city}</dd>
        </div>
        {row.delivery_mode && (
          <div className="wa-ctf__card-meta-row">
            <dt>Delivery</dt>
            <dd>{row.delivery_mode}</dd>
          </div>
        )}
        <div className="wa-ctf__card-meta-row">
          <dt>Date</dt>
          <dd>{formatDateRange(row.start_date, row.end_date)}</dd>
        </div>
        <div className="wa-ctf__card-meta-row">
          <dt>Member price (ex GST)</dt>
          <dd>
            {/* Member price highlighted in green for every visitor to advertise
                the member discount (CLAUDE.md §5.4 rule 4). Uses the
                tier-resolved member price from resolveMemberPrice(). */}
            <span className="wa-ctf__price--member">
              {formatCurrencyDollars(memberPrice)}
            </span>
          </dd>
        </div>
        <div className="wa-ctf__card-meta-row">
          <dt>Full price (ex GST)</dt>
          <dd>
            <span
              className={
                isMember ? 'wa-ctf__price--struck' : 'wa-ctf__price--public'
              }
            >
              {formatCurrencyDollars(row.price_non_member)}
            </span>
          </dd>
        </div>
      </dl>

      {showSeatsRemaining &&
        row.seats_remaining > 0 &&
        row.seats_remaining <= 5 && (
          <p className="wa-ctf__seats">
            Only {row.seats_remaining} spot
            {row.seats_remaining !== 1 ? 's' : ''} left
          </p>
        )}

      {!isUnavailable ? (
        <a
          href={registerHref}
          className="wa-btn wa-btn--primary wa-ctf__card-cta"
          rel={usesCheckout(row) ? undefined : 'noopener noreferrer'}
          target={usesCheckout(row) ? undefined : '_blank'}
        >
          Register
        </a>
      ) : (
        <span className="wa-ctf__unavailable-label">{presentation.label}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginationProps {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (p: number) => void
}

function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps): React.ReactElement {
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)

  return (
    <nav className="wa-ctf__pagination" aria-label="Pagination">
      <span className="wa-ctf__pagination-info">
        Showing {start}&ndash;{end} of {totalItems} sessions
      </span>
      <div className="wa-ctf__pagination-controls">
        <button
          type="button"
          className="wa-btn wa-btn--secondary wa-ctf__page-btn"
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => onPageChange(page - 1)}
        >
          &larr; Previous
        </button>
        <span className="wa-ctf__page-indicator" aria-current="page">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="wa-btn wa-btn--secondary wa-ctf__page-btn"
          disabled={page >= totalPages}
          aria-label="Next page"
          onClick={() => onPageChange(page + 1)}
        >
          Next &rarr;
        </button>
      </div>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// EoiForm
// ---------------------------------------------------------------------------

interface EoiFormProps {
  message: string
  name: string
  email: string
  submitting: boolean
  success: boolean
  error: string
  hasFormId: boolean
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}

function EoiForm({
  message,
  name,
  email,
  submitting,
  success,
  error,
  hasFormId,
  onNameChange,
  onEmailChange,
  onSubmit,
}: EoiFormProps): React.ReactElement {
  if (success) {
    return (
      <div className="wa-ctf__eoi wa-ctf__eoi--success">
        <p>Thanks &mdash; we&apos;ll let you know when a matching session is scheduled.</p>
      </div>
    )
  }

  return (
    <div className="wa-ctf__eoi">
      <h3 className="wa-ctf__eoi-heading">No sessions match your filters</h3>
      {message && (
        <div
          className="wa-ctf__eoi-message"
          /* eoi_message is rich text from a trusted HubSpot CMS editor */
          dangerouslySetInnerHTML={{ __html: message }}
        />
      )}

      {hasFormId ? (
        <form className="wa-ctf__eoi-form" onSubmit={onSubmit}>
          <div className="wa-ctf__eoi-field">
            <label htmlFor="wa-ctf-eoi-name">Name</label>
            <input
              id="wa-ctf-eoi-name"
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              required
              autoComplete="name"
            />
          </div>
          <div className="wa-ctf__eoi-field">
            <label htmlFor="wa-ctf-eoi-email">Email</label>
            <input
              id="wa-ctf-eoi-email"
              type="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          {error && (
            <p className="wa-ctf__eoi-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="wa-btn wa-btn--primary"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? 'Sending…' : 'Register interest'}
          </button>
        </form>
      ) : (
        <p className="wa-ctf__eoi-fallback">
          No sessions are currently scheduled for these filters. Please check back soon.
        </p>
      )}
    </div>
  )
}
