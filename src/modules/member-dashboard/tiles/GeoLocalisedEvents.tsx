import React, { useState } from 'react'
import type { GeoEvent } from '../types'

interface GeoLocalisedEventsProps {
  events: GeoEvent[]
  memberState: string
}

const STATE_LABELS: Record<string, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'ACT',
  National: 'National',
}

// Reverse lookup: full state name (lower-cased) → canonical abbreviation.
// Lets us accept contact.state stored either as an abbreviation ("NSW") or a
// full name ("New South Wales"), in any case.
const STATE_ABBREVIATIONS: Record<string, string> = Object.entries(STATE_LABELS).reduce(
  (acc, [abbr, label]) => {
    acc[abbr.toLowerCase()] = abbr
    acc[label.toLowerCase()] = abbr
    return acc
  },
  {} as Record<string, string>
)

/**
 * Normalise a raw member-state value (abbreviation, full name, mixed case) to
 * its canonical abbreviation. Returns '' for empty/unknown input.
 */
function normaliseState(raw: string): string {
  if (!raw) return ''
  return STATE_ABBREVIATIONS[raw.trim().toLowerCase()] ?? ''
}

function formatDate(value: string | number | null): string {
  if (!value) return ''
  let ms: number
  if (typeof value === 'number') {
    ms = value > 1e10 ? value : value * 1000
  } else {
    ms = Date.parse(value)
  }
  if (isNaN(ms)) return String(value)
  return new Date(ms).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function GeoEventCard({ event }: { event: GeoEvent }): React.ReactElement {
  const dateStr = formatDate(event.event_date)

  return (
    <article className="wa-geo-event-card" aria-label={event.event_name}>
      <h3 className="wa-geo-event-card__name">{event.event_name}</h3>
      <p className="wa-geo-event-card__meta">
        {event.event_type && <span>{event.event_type}</span>}
        {dateStr && <span>{dateStr}</span>}
        {event.event_location && <span>{event.event_location}</span>}
        {event.event_state && event.event_state !== 'National' && (
          <span>{event.event_state}</span>
        )}
      </p>
      {event.is_members_only && (
        <p className="wa-geo-event-card__badges">
          <span className="wa-members-only-badge">Members only</span>
        </p>
      )}
      {event.registration_url && (
        <div className="wa-dash-card__actions">
          <a
            href={event.registration_url}
            className="wa-dash-card__action wa-dash-card__action--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Register
          </a>
        </div>
      )}
    </article>
  )
}

export function GeoLocalisedEvents({ events, memberState }: GeoLocalisedEventsProps): React.ReactElement {
  // National toggle: when true, show all events; when false show state-specific + national
  const [showNational, setShowNational] = useState(false)

  // Canonical abbreviation for the member's home state. 'National' and empty
  // are NOT distinct home states - there is nothing to filter against national,
  // so the toggle is meaningless and must not render (otherwise both options
  // read "National").
  const normalizedState = normaliseState(memberState)
  const hasLocalState = normalizedState !== '' && normalizedState !== 'National'
  const stateLabel = hasLocalState ? STATE_LABELS[normalizedState] : null

  const displayed = hasLocalState && !showNational
    ? events.filter(
        (e) => e.event_state === normalizedState || e.event_state === 'National'
      )
    : events

  if (events.length === 0) {
    return (
      <div className="wa-tile-empty">
        <div className="wa-tile-empty__icon" aria-hidden="true">📍</div>
        <p className="wa-tile-empty__message">
          No upcoming events in your area.{' '}
          <a href="/events/" className="wa-link">
            View all events
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="wa-geo-events">
      {hasLocalState && (
        <div className="wa-geo-events__controls">
          {!showNational ? (
            <p className="wa-geo-events__location">
              Showing events in <strong>{stateLabel}</strong> and national
            </p>
          ) : (
            <p className="wa-geo-events__location">
              Showing all national events
            </p>
          )}
          <button
            type="button"
            className="wa-geo-events__toggle"
            onClick={() => setShowNational((prev) => !prev)}
            aria-pressed={showNational}
          >
            {showNational ? `Show ${stateLabel} only` : 'Show all states'}
          </button>
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="wa-tile-empty">
          <p className="wa-tile-empty__message">
            No events match your current filter.
          </p>
        </div>
      ) : (
        <div className="wa-geo-events__list">
          {displayed.map((ev) => (
            <GeoEventCard key={ev.id} event={ev} />
          ))}
        </div>
      )}

      <a href="/events/" className="wa-link" style={{ fontSize: '0.875rem' }}>
        View all events →
      </a>
    </div>
  )
}
