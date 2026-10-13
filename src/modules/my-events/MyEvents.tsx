import React, { useState } from 'react'
import type { EventItem, MyEventsProps } from './types'

type Tab = 'upcoming' | 'past'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (isNaN(ms)) return iso
  return new Date(ms).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function downloadCalendar(event: EventItem): void {
  const start = event.event_date ? new Date(event.event_date) : new Date()
  const end = event.event_end_date
    ? new Date(event.event_end_date)
    : new Date(start.getTime() + 2 * 60 * 60 * 1000)

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Weld Australia//Member Portal//EN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${event.event_name}`,
    event.event_location ? `LOCATION:${event.event_location}` : '',
    event.zoom_url ? `URL:${event.zoom_url}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')

  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${event.event_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function isUpcoming(event: EventItem): boolean {
  if (!event.event_date) return true
  return Date.parse(event.event_date) >= Date.now()
}

function EventCard({ event, tab }: { event: EventItem; tab: Tab }): React.ReactElement {
  const dateStr = formatDate(event.event_date)

  return (
    <div className="wa-my-events__card">
      <div className="wa-my-events__card-body">
        <h3 className="wa-my-events__card-name">{event.event_name}</h3>
        <p className="wa-my-events__card-meta">
          {dateStr && <span>{dateStr}</span>}
          {event.event_location && <span>{event.event_location}</span>}
        </p>
      </div>
      <div className="wa-my-events__card-actions">
        {event.zoom_url && tab === 'upcoming' && (
          <a
            href={event.zoom_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join Zoom
          </a>
        )}
        {tab === 'upcoming' && (
          <button
            type="button"
            className="wa-btn wa-btn--sm wa-btn--secondary"
            onClick={() => downloadCalendar(event)}
            aria-label={`Add ${event.event_name} to calendar`}
          >
            Add to calendar
          </button>
        )}
      </div>
    </div>
  )
}

function EventRow({ event, tab }: { event: EventItem; tab: Tab }): React.ReactElement {
  const dateStr = formatDate(event.event_date)

  return (
    <tr className="wa-my-events__row">
      <td className="wa-my-events__cell">
        <span className="wa-my-events__name">{event.event_name}</span>
      </td>
      <td className="wa-my-events__cell">{dateStr || '-'}</td>
      <td className="wa-my-events__cell">{event.event_location || '-'}</td>
      <td className="wa-my-events__cell wa-my-events__cell--actions">
        {event.zoom_url && tab === 'upcoming' && (
          <a
            href={event.zoom_url}
            className="wa-btn wa-btn--sm wa-btn--primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join Zoom
          </a>
        )}
        {tab === 'upcoming' && (
          <button
            type="button"
            className="wa-btn wa-btn--sm wa-btn--secondary"
            onClick={() => downloadCalendar(event)}
            aria-label={`Add ${event.event_name} to calendar`}
          >
            Add to calendar
          </button>
        )}
      </td>
    </tr>
  )
}

function EmptyState({ tab, browseUrl }: { tab: Tab; browseUrl: string }): React.ReactElement {
  if (tab === 'upcoming') {
    return (
      <div className="wa-my-events__empty">
        <p className="wa-my-events__empty-message">
          No upcoming events registered.{' '}
          <a href={browseUrl} className="wa-link">
            Browse events
          </a>{' '}
          to register for your next one.
        </p>
      </div>
    )
  }
  return (
    <div className="wa-my-events__empty">
      <p className="wa-my-events__empty-message">No past events on record.</p>
    </div>
  )
}

export function MyEvents({
  events,
  empty_state_message,
  browse_url,
}: MyEventsProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('upcoming')

  const upcoming = events.filter(isUpcoming)
  const past = events.filter((e) => !isUpcoming(e))
  const visible = activeTab === 'upcoming' ? upcoming : past

  return (
    <div className="wa-my-events">
      <div className="wa-tab-switcher" role="tablist" aria-label="My Events">
        <button
          role="tab"
          aria-selected={activeTab === 'upcoming'}
          className={`wa-tab-switcher__tab${activeTab === 'upcoming' ? ' wa-tab-switcher__tab--active' : ''}`}
          onClick={() => setActiveTab('upcoming')}
        >
          Upcoming
          {upcoming.length > 0 && (
            <span className="wa-tab-switcher__count" aria-label={`${upcoming.length} upcoming`}>
              {upcoming.length}
            </span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'past'}
          className={`wa-tab-switcher__tab${activeTab === 'past' ? ' wa-tab-switcher__tab--active' : ''}`}
          onClick={() => setActiveTab('past')}
        >
          Past
          {past.length > 0 && (
            <span className="wa-tab-switcher__count" aria-label={`${past.length} past`}>
              {past.length}
            </span>
          )}
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState tab={activeTab} browseUrl={browse_url} />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="wa-my-events__cards" aria-label={`${activeTab} events`}>
            {visible.map((e) => (
              <EventCard key={e.deal_id} event={e} tab={activeTab} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="wa-my-events__table-wrap" aria-label={`${activeTab} events`}>
            <table className="wa-my-events__table">
              <thead>
                <tr>
                  <th scope="col" className="wa-my-events__th">Event</th>
                  <th scope="col" className="wa-my-events__th">Date</th>
                  <th scope="col" className="wa-my-events__th">Location</th>
                  <th scope="col" className="wa-my-events__th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <EventRow key={e.deal_id} event={e} tab={activeTab} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {empty_state_message && visible.length === 0 && (
        <p className="wa-my-events__footnote">{empty_state_message}</p>
      )}
    </div>
  )
}
