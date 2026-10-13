import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EventsListing, type EventsListingProps, type EventRow } from './EventsListing'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<EventRow>): EventRow {
  const state = overrides.event_state ?? 'National'
  const stateKey = overrides.event_state_key ?? 'national'
  return {
    id: 1,
    slug: 'sample-event',
    event_name: 'Sample Event',
    event_type: 'Webinar',
    event_type_key: 'webinar',
    event_date: '2026-06-10',
    event_end_date: '2026-06-10',
    event_state: state,
    event_state_key: stateKey,
    event_location: 'Online (Zoom)',
    // event_location_key mirrors what module.html now emits: the state key.
    event_location_key: stateKey,
    event_location_label: state,
    event_description: '<p>An event.</p>',
    event_image_url: '',
    event_image_alt: '',
    registration_url: 'https://events.weldaustralia.com.au/sample',
    is_featured: false,
    is_members_only: false,
    ...overrides,
  }
}

const NSW_EVENT = makeEvent({
  id: 1,
  event_name: 'NSW Networking Evening',
  event_type: 'In-Person',
  event_type_key: 'in_person',
  event_state: 'NSW',
  event_state_key: 'nsw',
  event_location: 'Sydney Olympic Park',
})

const NATIONAL_EVENT = makeEvent({
  id: 2,
  event_name: 'Welding Industry Forum',
  event_state: 'National',
  event_state_key: 'national',
})

// The reported scenario: an event held in Adelaide. Its city is "Adelaide" but its
// state is SA - the Location filter must group it under SA, never surface "Adelaide".
const ADELAIDE_CITY_EVENT = makeEvent({
  id: 3,
  event_name: 'Adelaide Fabrication Expo',
  event_type: 'In-Person',
  event_type_key: 'in_person',
  event_state: 'SA',
  event_state_key: 'sa',
  event_city: 'Adelaide',
  event_location: 'Adelaide Convention Centre',
})

// A row whose STATE field itself was mistakenly populated with a city. Its state key
// is empty (a city is not one of the nine states) so it must never become a Location
// option - but it should still appear in the listing.
const MISTAGGED_EVENT = makeEvent({
  id: 4,
  event_name: 'Mystery Location Workshop',
  event_type: 'In-Person',
  event_type_key: 'in_person',
  event_state: 'Adelaide',
  event_state_key: '',
  event_location_key: '',
  event_location_label: '',
})

const DEFAULT_PROPS: EventsListingProps = {
  rows: [NSW_EVENT, NATIONAL_EVENT, ADELAIDE_CITY_EVENT, MISTAGGED_EVENT],
  past_rows: [],
  section_heading: 'Upcoming events',
  default_state_filter: 'any',
  default_type_filter: 'any',
  page_size: 12,
  show_past_events_toggle: true,
}

const ALLOWED_STATE_LABELS = new Set([
  'NSW',
  'VIC',
  'QLD',
  'WA',
  'SA',
  'TAS',
  'NT',
  'ACT',
  'National',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Labels of the Location dropdown options, excluding the "All locations" entry.
 *  Each option renders as `{label} <span>{count}</span>`, so we strip the trailing count. */
function locationOptionLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.wa-event-location__option'))
    .map((btn) => (btn.textContent ?? '').replace(/\s*\d+\s*$/, '').trim())
    .filter((label) => label && label !== 'All locations')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventsListing - Location filter is state-only', () => {
  it('renders with mock props without crashing', () => {
    render(<EventsListing {...DEFAULT_PROPS} />)
    expect(screen.getByText('Upcoming events')).toBeTruthy()
  })

  it('renders the Location dropdown with the canonical states present in the data', () => {
    const { container } = render(<EventsListing {...DEFAULT_PROPS} />)
    const labels = locationOptionLabels(container)
    expect(labels).toContain('NSW')
    expect(labels).toContain('National')
    expect(labels).toContain('SA')
  })

  it('never renders a city value (e.g. "Adelaide") as a Location option', () => {
    const { container } = render(<EventsListing {...DEFAULT_PROPS} />)
    // The Adelaide event is grouped under its state (SA), not the city name.
    expect(locationOptionLabels(container)).not.toContain('Adelaide')
  })

  it('only ever shows whitelisted Australian state/territory labels as Location options', () => {
    const { container } = render(<EventsListing {...DEFAULT_PROPS} />)
    for (const label of locationOptionLabels(container)) {
      expect(ALLOWED_STATE_LABELS.has(label)).toBe(true)
    }
  })

  it('still lists events whose state is not a canonical value, even though they are not filterable by location', () => {
    render(<EventsListing {...DEFAULT_PROPS} />)
    expect(screen.getByText('Mystery Location Workshop')).toBeTruthy()
    expect(screen.getByText('Adelaide Fabrication Expo')).toBeTruthy()
  })
})

describe('EventsListing manual status (Ref 74c Phase 3)', () => {
  const OPEN_EVENT = makeEvent({
    id: 90,
    event_name: 'Open Networking Night',
    registration_url: 'https://events.weldaustralia.com.au/open',
  })
  const CLOSED_EVENT = makeEvent({
    id: 91,
    event_name: 'Closed Networking Night',
    registration_url: 'https://events.weldaustralia.com.au/closed',
    status: 'Closed',
  })

  function propsWith(rows: EventRow[]): EventsListingProps {
    return { ...DEFAULT_PROPS, rows }
  }

  it('offers Register now on an event with no status set', () => {
    // Blank is every row until the column exists, so this is the "nothing changed" case.
    render(<EventsListing {...propsWith([OPEN_EVENT])} />)
    expect(screen.getAllByText('Register now').length).toBeGreaterThan(0)
  })

  it('drops the Register CTA and says why when staff closed the event', () => {
    render(<EventsListing {...propsWith([CLOSED_EVENT])} />)
    expect(screen.getByText('Registrations closed')).toBeTruthy()
    expect(screen.queryByText('Register now')).toBeNull()
  })

  it('closes only the row that carries the status', () => {
    render(<EventsListing {...propsWith([OPEN_EVENT, CLOSED_EVENT])} />)
    expect(screen.getAllByText('Register now')).toHaveLength(1)
    expect(screen.getByText('Registrations closed')).toBeTruthy()
  })

  it('treats a cancelled event the same way', () => {
    render(<EventsListing {...propsWith([makeEvent({ id: 92, status: 'Cancelled' })])} />)
    expect(screen.getByText('Cancelled')).toBeTruthy()
    expect(screen.queryByText('Register now')).toBeNull()
  })
})
