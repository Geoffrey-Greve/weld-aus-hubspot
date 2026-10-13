import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GeoLocalisedEvents } from './GeoLocalisedEvents'
import type { GeoEvent } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NSW_EVENT: GeoEvent = {
  id: 1,
  event_name: 'Weld Australia Gala & Industry Awards 2026',
  event_type: 'Awards',
  event_date: '2026-09-10',
  event_end_date: null,
  event_state: 'NSW',
  event_location: 'Sydney',
  registration_url: 'https://event.hapily.com/reg/nsw',
  is_members_only: false,
}

const VIC_EVENT: GeoEvent = {
  id: 2,
  event_name: 'Advanced Welding Supervision Workshop',
  event_type: 'In-Person',
  event_date: '2026-10-01',
  event_end_date: null,
  event_state: 'VIC',
  event_location: 'Melbourne',
  registration_url: 'https://event.hapily.com/reg/vic',
  is_members_only: false,
}

const NATIONAL_EVENT: GeoEvent = {
  id: 3,
  event_name: 'Welding Inspection Fundamentals - Webinar',
  event_type: 'Webinar',
  event_date: '2026-08-15',
  event_end_date: null,
  event_state: 'National',
  event_location: 'Online',
  registration_url: 'https://event.hapily.com/reg/national',
  is_members_only: false,
}

const ALL_EVENTS = [NSW_EVENT, VIC_EVENT, NATIONAL_EVENT]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeoLocalisedEvents', () => {
  it('shows a distinct home-state label - never "National" twice - for a real state', () => {
    render(<GeoLocalisedEvents events={ALL_EVENTS} memberState="NSW" />)

    const location = screen.getByText(/showing events in/i)
    expect(location.textContent).toContain('New South Wales')
    // The location line must not read "National and national".
    expect(location.textContent).not.toMatch(/national\s+and\s+national/i)

    // Toggle offers the two distinct options.
    expect(
      screen.getByRole('button', { name: /show all states/i })
    ).toBeInTheDocument()

    // State-specific view: NSW + National, but not VIC.
    expect(screen.getByText(NSW_EVENT.event_name)).toBeInTheDocument()
    expect(screen.getByText(NATIONAL_EVENT.event_name)).toBeInTheDocument()
    expect(screen.queryByText(VIC_EVENT.event_name)).not.toBeInTheDocument()
  })

  it('toggles between the member state and all national events with distinct labels', () => {
    render(<GeoLocalisedEvents events={ALL_EVENTS} memberState="NSW" />)

    fireEvent.click(screen.getByRole('button', { name: /show all states/i }))

    expect(screen.getByText(/showing all national events/i)).toBeInTheDocument()
    // Toggle label now names the member's real state, not "National".
    const backButton = screen.getByRole('button', {
      name: /show new south wales only/i,
    })
    expect(backButton).toBeInTheDocument()
    expect(backButton.textContent).not.toMatch(/show national only/i)

    // All events (including VIC) are visible.
    expect(screen.getByText(VIC_EVENT.event_name)).toBeInTheDocument()
  })

  it('renders no location filter when the member state is "National"', () => {
    render(<GeoLocalisedEvents events={ALL_EVENTS} memberState="National" />)

    // No toggle and no "National and national" duplication.
    expect(screen.queryByRole('button', { name: /show all states/i })).toBeNull()
    expect(screen.queryByText(/showing events in/i)).toBeNull()
    // Every event is listed.
    expect(screen.getByText(NSW_EVENT.event_name)).toBeInTheDocument()
    expect(screen.getByText(NATIONAL_EVENT.event_name)).toBeInTheDocument()
  })

  it('renders no location filter when the member has no state set', () => {
    render(<GeoLocalisedEvents events={ALL_EVENTS} memberState="" />)

    expect(screen.queryByRole('button', { name: /show all states/i })).toBeNull()
    expect(screen.queryByText(/showing events in/i)).toBeNull()
    expect(screen.getByText(VIC_EVENT.event_name)).toBeInTheDocument()
  })

  it('normalises a full state name and behaves like the abbreviation', () => {
    render(
      <GeoLocalisedEvents events={ALL_EVENTS} memberState="New South Wales" />
    )

    const location = screen.getByText(/showing events in/i)
    expect(location.textContent).toContain('New South Wales')
    expect(screen.queryByText(VIC_EVENT.event_name)).not.toBeInTheDocument()
    expect(screen.getByText(NSW_EVENT.event_name)).toBeInTheDocument()
  })

  it('shows the empty state when there are no events', () => {
    render(<GeoLocalisedEvents events={[]} memberState="NSW" />)

    expect(screen.getByText(/no upcoming events in your area/i)).toBeInTheDocument()
  })
})
