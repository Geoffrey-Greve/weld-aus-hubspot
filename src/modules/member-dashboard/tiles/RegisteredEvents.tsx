import React from 'react'
import type { RegisteredEvent } from '../types'

interface RegisteredEventsProps {
  events: RegisteredEvent[]
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  const ms = Date.parse(isoDate)
  if (isNaN(ms)) return isoDate
  return new Date(ms).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function EventRow({ event }: { event: RegisteredEvent }): React.ReactElement {
  const dateStr = formatDate(event.event_date)

  return (
    <div className="wa-event-row">
      <h3 className="wa-event-row__name">{event.event_name}</h3>
      <p className="wa-event-row__meta">
        {dateStr && <span>{dateStr}</span>}
        {event.event_location && <span>{event.event_location}</span>}
      </p>
      <div className="wa-event-row__actions">
        {event.zoom_url && (
          <a
            href={event.zoom_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join Zoom
          </a>
        )}
        {event.ical_url && (
          <a
            href={event.ical_url}
            className="wa-btn wa-btn--sm wa-btn--secondary"
            download
            aria-label="Add to calendar"
          >
            Add to calendar
          </a>
        )}
      </div>
    </div>
  )
}

export function RegisteredEvents({ events }: RegisteredEventsProps): React.ReactElement {
  if (events.length === 0) {
    return (
      <div className="wa-tile-empty">
        <div className="wa-tile-empty__icon" aria-hidden="true">📅</div>
        <p className="wa-tile-empty__message">
          No upcoming events registered.{' '}
          <a href="/events/" className="wa-link">
            Browse events
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="wa-registered-events">
      {events.map((ev) => (
        <EventRow key={ev.deal_id} event={ev} />
      ))}
    </div>
  )
}
