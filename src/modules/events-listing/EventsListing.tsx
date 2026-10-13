import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { Pagination } from '@shared/components/Pagination'
import { EmptyState } from '@shared/components/EmptyState'
import { hubdbStatusToSessionStatus, statusPresentation } from '@shared/status/sessionStatus'
import './EventsListing.css'

// ---------------------------------------------------------------------------
// Types (mirrors HubDB events table)
// ---------------------------------------------------------------------------

export interface EventRow {
  id: number | string
  slug?: string
  detail_path?: string
  event_name: string
  event_type: string      // 'Webinar' | 'In-Person' | 'Hybrid' | 'Awards'
  event_type_key: string  // 'webinar' | 'in_person' | 'hybrid' | 'awards'
  event_date: string      // ISO date string YYYY-MM-DD
  event_end_date: string  // ISO date string YYYY-MM-DD (may be empty)
  event_state: string     // 'NSW' | 'VIC' | etc.
  event_state_key: string // 'nsw' | 'vic' | etc.
  event_city?: string
  event_location: string
  event_location_label?: string
  event_location_key?: string
  event_delivery_key?: string
  event_price_type?: string
  event_price_key?: string
  event_description: string // rich text HTML
  event_image_url: string
  event_image_alt: string
  registration_url: string
  registration_href?: string
  registration_new_tab?: boolean
  use_event_engine?: boolean
  worker_event_id?: string
  is_featured: boolean
  is_members_only: boolean
  /**
   * The events table's own `status` column (Ref 74c Phase 3). Blank on a row nobody has
   * set - and on every row until the column exists - which the shared mapper reads as
   * `available`, so this is optional by construction.
   */
  status?: string
}

export interface EventsListingProps {
  rows: EventRow[]           // upcoming events (pre-filtered by default filters server-side)
  past_rows: EventRow[]      // past events
  section_heading: string
  default_state_filter: string
  default_type_filter: string
  page_size: number
  show_past_events_toggle: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_OPTIONS = [
  { value: 'webinar', label: 'Webinar' },
  { value: 'in_person', label: 'In-Person' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'awards', label: 'Awards' },
]

const DELIVERY_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'in_person', label: 'In-person' },
]

const PRICE_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
]

// Canonical Australian states/territories (+ National). The Location filter is
// state-only, so options are restricted to this whitelist - see deriveLocationOptions.
const STATE_OPTIONS = [
  { value: 'nsw', label: 'NSW' },
  { value: 'vic', label: 'VIC' },
  { value: 'qld', label: 'QLD' },
  { value: 'wa', label: 'WA' },
  { value: 'sa', label: 'SA' },
  { value: 'tas', label: 'TAS' },
  { value: 'nt', label: 'NT' },
  { value: 'act', label: 'ACT' },
  { value: 'national', label: 'National' },
]

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

function formatEventDate(dateStr: string, endDateStr?: string): string {
  if (!dateStr) return ''
  const formatter = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  try {
    const start = new Date(dateStr)
    if (!endDateStr) return formatter.format(start)
    const end = new Date(endDateStr)
    if (
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate()
    ) {
      return formatter.format(start)
    }
    return `${formatter.format(start)} - ${formatter.format(end)}`
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// EventCard sub-component
// ---------------------------------------------------------------------------

interface EventCardProps {
  event: EventRow
}

function EventCard({ event }: EventCardProps): React.ReactElement {
  const dateText = formatEventDate(
    event.event_date,
    event.event_end_date || undefined
  )
  const detailPath = (event.detail_path || event.slug || '').replace(/^\/+/, '')
  const detailUrl = detailPath ? `/events/${detailPath}` : ''
  const registrationUrl =
    event.registration_href ||
    (event.use_event_engine ? `/checkout/?event_id=${event.id}` : '') ||
    detailUrl ||
    event.registration_url
  const registrationNewTab = Boolean(
    event.registration_new_tab || (!event.use_event_engine && !event.registration_href && !detailUrl)
  )
  // Ref 74c Phase 3. Staff closing an event early is an editorial decision, so it outranks
  // every booking route on the card - the Event Engine checkout, the legacy URL, all of it.
  // The badge below says WHY; this only decides whether a Register button exists.
  const presentation = statusPresentation(hubdbStatusToSessionStatus(event.status))

  return (
    <article
      className={[
        'wa-el__card',
        event.is_featured ? 'wa-el__card--featured' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={event.event_name}
    >
      <div className="wa-el__card-image">
        {event.event_image_url ? (
          <img
            src={event.event_image_url}
            alt={event.event_image_alt || event.event_name}
            className="wa-el__img"
            loading="lazy"
            width={400}
            height={225}
          />
        ) : (
          <div className="wa-el__img-placeholder" aria-hidden="true" />
        )}
        <span className="wa-el__media-scrim" aria-hidden="true" />

        <div className="wa-el__badges">
          {event.event_type && (
            <span className={`wa-el__badge wa-el__badge--type wa-el__badge--${event.event_type_key}`}>
              {event.event_type}
            </span>
          )}
          {event.is_featured && (
            <span className="wa-el__badge wa-el__badge--featured">Featured</span>
          )}
          {event.is_members_only && (
            <span className="wa-el__badge wa-el__badge--members">Members only</span>
          )}
        </div>

      </div>

      <div className="wa-el__card-body">
        <div className="wa-el__card-meta">
          {event.event_state && (
            <span className="wa-el__type-badge wa-el__type-badge--state">{event.event_state}</span>
          )}
          {event.event_location_label && event.event_location_label !== event.event_state && (
            <span className="wa-el__type-badge wa-el__type-badge--location">
              {event.event_location_label}
            </span>
          )}
        </div>

        <h3 className="wa-el__card-title">{event.event_name}</h3>

        {dateText && (
          <time className="wa-el__date" dateTime={event.event_date}>
            <svg className="wa-el__date-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M12 7v5l3 2"></path>
            </svg>
            {dateText}
          </time>
        )}

        {event.use_event_engine && event.worker_event_id && (
          <span
            className="wa-availability-badge wa-availability-badge--listing"
            data-wa-availability-badge
            data-worker-event-id={event.worker_event_id}
            data-hubdb-status={event.status || undefined}
            data-state="checking"
            aria-live="polite"
          >
            Checking places…
          </span>
        )}
        {/* A row closed by hand says so even with no Worker behind it - the badge above
            only renders for an Event Engine-backed event. */}
        {!presentation.bookable && !(event.use_event_engine && event.worker_event_id) && (
          <span
            className="wa-availability-badge wa-availability-badge--listing"
            data-state={presentation.slug}
          >
            {presentation.label}
          </span>
        )}

        {event.event_description && (
          <div
            className="wa-el__description"
            dangerouslySetInnerHTML={{ __html: event.event_description }}
          />
        )}
      </div>

      <div className="wa-el__actions">
        {detailUrl && (
          <a href={detailUrl} className="wa-el__action wa-el__action--outline">
            View details
          </a>
        )}
        {registrationUrl && presentation.bookable && (
          <a
            href={registrationUrl}
            className="wa-el__action wa-el__action--primary"
            target={registrationNewTab ? '_blank' : undefined}
            rel={registrationNewTab ? 'noopener noreferrer' : undefined}
          >
            Register now
          </a>
        )}
      </div>
    </article>
  )
}

declare global {
  interface Window {
    WAEventAvailability?: {
      refresh?: (root?: ParentNode) => void
    }
  }
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function filterEvents(
  events: EventRow[],
  selectedStates: string[],
  selectedTypes: string[],
  selectedLocations: string[],
  selectedDelivery: string[],
  selectedPrices: string[]
): EventRow[] {
  return events.filter((e) => {
    const stateMatch =
      selectedStates.length === 0 || selectedStates.includes(e.event_state_key)
    const typeMatch =
      selectedTypes.length === 0 || selectedTypes.includes(e.event_type_key)
    const locationMatch =
      selectedLocations.length === 0 ||
      selectedLocations.includes(e.event_location_key || '')
    const deliveryValues = (e.event_delivery_key || '').split(/\s+/).filter(Boolean)
    const deliveryMatch =
      selectedDelivery.length === 0 ||
      selectedDelivery.some((delivery) => deliveryValues.includes(delivery))
    const priceMatch =
      selectedPrices.length === 0 ||
      selectedPrices.includes(e.event_price_key || '')
    return stateMatch && typeMatch && locationMatch && deliveryMatch && priceMatch
  })
}

function deriveTypeOptions(events: EventRow[]) {
  return TYPE_OPTIONS
    .map((option) => ({
      ...option,
      count: events.filter((event) => event.event_type_key === option.value).length,
    }))
    .filter((option) => option.count > 0)
}

// The Location filter is intentionally state-only. Options are keyed off the
// canonical event_state_key and labelled from the STATE_OPTIONS whitelist, so a
// stray city or free-text location value (e.g. "Adelaide") can never surface as a
// filter option even if it leaks into the underlying data.
function deriveLocationOptions(events: EventRow[]) {
  return STATE_OPTIONS.map((option) => ({
    ...option,
    count: events.filter((event) => event.event_state_key === option.value).length,
  })).filter((option) => option.count > 0)
}

function deriveDeliveryOptions(events: EventRow[]) {
  return DELIVERY_OPTIONS
    .map((option) => ({
      ...option,
      count: events.filter((event) =>
        (event.event_delivery_key || '').split(/\s+/).includes(option.value)
      ).length,
    }))
    .filter((option) => option.count > 0)
}

function derivePriceOptions(events: EventRow[]) {
  return PRICE_OPTIONS
    .map((option) => ({
      ...option,
      count: events.filter((event) => event.event_price_key === option.value).length,
    }))
    .filter((option) => option.count > 0)
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function EventsListing({
  rows,
  past_rows,
  section_heading,
  page_size,
  show_past_events_toggle,
}: EventsListingProps): React.ReactElement {
  const [showingPast, setShowingPast] = useState(false)
  const [selectedStates, setSelectedStates] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [selectedDelivery, setSelectedDelivery] = useState<string[]>([])
  const [selectedPrices, setSelectedPrices] = useState<string[]>([])
  const [locationMenuOpen, setLocationMenuOpen] = useState(false)
  const [page, setPage] = useState(1)

  // Active dataset based on past/upcoming toggle
  const activeDataset = showingPast ? past_rows : rows

  // Derive filter options from the current dataset
  const typeOptions = useMemo(() => deriveTypeOptions(activeDataset), [activeDataset])
  const locationOptions = useMemo(() => deriveLocationOptions(activeDataset), [activeDataset])
  const deliveryOptions = useMemo(() => deriveDeliveryOptions(activeDataset), [activeDataset])
  const priceOptions = useMemo(() => derivePriceOptions(activeDataset), [activeDataset])

  // Filtered events
  const filteredEvents = useMemo(
    () => filterEvents(
      activeDataset,
      selectedStates,
      selectedTypes,
      selectedLocations,
      selectedDelivery,
      selectedPrices
    ),
    [activeDataset, selectedStates, selectedTypes, selectedLocations, selectedDelivery, selectedPrices]
  )

  // Pagination
  const effectivePageSize = page_size > 0 ? page_size : 12
  const totalPages = Math.ceil(filteredEvents.length / effectivePageSize)
  const pagedEvents = useMemo(() => {
    const start = (page - 1) * effectivePageSize
    return filteredEvents.slice(start, start + effectivePageSize)
  }, [filteredEvents, page, effectivePageSize])

  const handleTypeChange = useCallback((types: string[]) => {
    setSelectedTypes(types)
    setPage(1)
  }, [])

  const handleLocationChange = useCallback((locations: string[]) => {
    setSelectedLocations(locations)
    setLocationMenuOpen(false)
    setPage(1)
  }, [])

  const handleDeliveryChange = useCallback((delivery: string[]) => {
    setSelectedDelivery(delivery)
    setPage(1)
  }, [])

  const handlePriceChange = useCallback((prices: string[]) => {
    setSelectedPrices(prices)
    setPage(1)
  }, [])

  const handleTogglePast = useCallback(() => {
    setShowingPast((prev) => !prev)
    setSelectedStates([])
    setSelectedTypes([])
    setSelectedLocations([])
    setSelectedDelivery([])
    setSelectedPrices([])
    setLocationMenuOpen(false)
    setPage(1)
  }, [])

  const hasFilters =
    selectedStates.length > 0 ||
    selectedTypes.length > 0 ||
    selectedLocations.length > 0 ||
    selectedDelivery.length > 0 ||
    selectedPrices.length > 0

  const clearFilters = useCallback(() => {
    setSelectedStates([])
    setSelectedTypes([])
    setSelectedLocations([])
    setSelectedDelivery([])
    setSelectedPrices([])
    setLocationMenuOpen(false)
    setPage(1)
  }, [])

  const activeType = selectedTypes[0] || 'all'
  const activeLocation = selectedLocations[0] || 'all'
  const activeDelivery = selectedDelivery[0] || 'all'
  const activePrice = selectedPrices[0] || 'all'
  const activeLocationLabel =
    locationOptions.find((option) => option.value === activeLocation)?.label || 'All locations'

  useEffect(() => {
    window.WAEventAvailability?.refresh?.(document)
  }, [pagedEvents])

  return (
    <div className="wa-el">
      {/* Header */}
      {section_heading && (
        <div className="wa-el__header">
          <div className="wa-el__header-copy">
            <p className="wa-el__eyebrow">Events & networking</p>
            <h2 className="wa-el__heading">{section_heading}</h2>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="wa-el__toolbar wa-event-filter">
        <div className="wa-event-filter__top" role="group" aria-label="Filter events by type">
          <button
            type="button"
            className="wa-filter-chip wa-filter-chip--all"
            aria-pressed={activeType === 'all'}
            onClick={() => handleTypeChange([])}
          >
            All <span className="wa-filter-chip__count">{activeDataset.length}</span>
          </button>
          {typeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="wa-filter-chip"
              aria-pressed={activeType === option.value}
              onClick={() => handleTypeChange([option.value])}
            >
              <span
                className={`wa-filter-chip__dot wa-filter-chip__dot--${option.value.replace('_', '-')}`}
                aria-hidden="true"
              />
              {option.label}
              <span className="wa-filter-chip__count">{option.count}</span>
            </button>
          ))}
        </div>

        <span className="wa-event-filter__rule" aria-hidden="true" />

        <div className="wa-event-filter__bottom">
          {locationOptions.length > 1 && (
            <>
              <div className="wa-event-location">
                <button
                  type="button"
                  className="wa-location-select"
                  aria-expanded={locationMenuOpen}
                  onClick={() => setLocationMenuOpen((open) => !open)}
                >
                  <svg className="wa-location-select__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 21s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  <span>{activeLocationLabel}</span>
                  <svg className="wa-location-select__chevron" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m5 7 5 5 5-5" />
                  </svg>
                </button>
                <div className="wa-event-location__menu" hidden={!locationMenuOpen}>
                  <button
                    type="button"
                    className="wa-event-location__option"
                    aria-pressed={activeLocation === 'all'}
                    onClick={() => handleLocationChange([])}
                  >
                    All locations <span>{activeDataset.length}</span>
                  </button>
                  {locationOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="wa-event-location__option"
                      aria-pressed={activeLocation === option.value}
                      onClick={() => handleLocationChange([option.value])}
                    >
                      {option.label} <span>{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <span className="wa-event-filter__separator" aria-hidden="true" />
            </>
          )}

          <div className="wa-event-filter__group" role="group" aria-label="Filter events by delivery">
            {deliveryOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="wa-filter-chip wa-filter-chip--compact"
                aria-pressed={activeDelivery === option.value}
                onClick={() => handleDeliveryChange(activeDelivery === option.value ? [] : [option.value])}
              >
                {option.label}
              </button>
            ))}
          </div>

          {priceOptions.length > 0 && (
            <>
              <span className="wa-event-filter__separator" aria-hidden="true" />
              <div className="wa-event-filter__group" role="group" aria-label="Filter events by price">
                {priceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="wa-filter-chip wa-filter-chip--compact"
                    aria-pressed={activePrice === option.value}
                    onClick={() => handlePriceChange(activePrice === option.value ? [] : [option.value])}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="wa-el__toolbar-actions">
          {hasFilters && (
            <button
              type="button"
              className="wa-btn wa-btn--ghost wa-el__clear-btn"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
          {show_past_events_toggle && (
            <button
              type="button"
              className={[
                'wa-btn',
                showingPast ? 'wa-btn--secondary' : 'wa-btn--ghost',
                'wa-el__past-toggle',
              ].join(' ')}
              aria-pressed={showingPast}
              onClick={handleTogglePast}
            >
              {showingPast ? 'View upcoming' : 'View past events'}
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {filteredEvents.length > 0 ? (
        <>
          <ul className="wa-el__grid" role="list">
            {pagedEvents.map((event) => (
              <li key={event.id} className="wa-el__grid-item">
                <EventCard event={event} />
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      ) : (
        <EmptyState
          heading={
            showingPast
              ? 'No past events to display.'
              : 'No upcoming events. Check back soon.'
          }
          body={
            hasFilters
              ? 'Try adjusting your filters to see more results.'
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
            ) : !showingPast && show_past_events_toggle && past_rows.length > 0 ? (
              <button
                type="button"
                className="wa-btn wa-btn--secondary"
                onClick={handleTogglePast}
              >
                View past events
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}

export default EventsListing
