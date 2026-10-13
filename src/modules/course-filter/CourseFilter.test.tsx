import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { resetAvailabilityCache } from '@shared/api/useLiveAvailability'
import { CourseFilter, type CourseFilterProps } from './CourseFilter'
import { CHECKOUT_PRICING_HANDOFF_KEY } from '@shared/utils/checkoutPricingHandoff'

// Mock the HubSpot forms API so tests don't make real network calls.
vi.mock('@shared/api/forms', () => ({
  submitHubSpotForm: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------
//
// Every fixture below is dated, and a session that has already started now renders as
// "Registrations closed" (applyAvailability's start-date rule, Ref 46 round 2). Without a
// fixed clock this suite would pass until the fixture dates went by and then fail for a
// reason that has nothing to do with the code - which is exactly what it did.
//
// Only Date is faked. waitFor() needs real setTimeout to poll on.
const NOW = new Date('2026-05-01T09:00:00+09:30')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterAll(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYDNEY_ROW = {
  id: 1,
  course_name: 'AS1796 Cert 10',
  city: 'Sydney',
  delivery_mode: 'Face-to-Face',
  start_date: '2026-06-01',
  end_date: '2026-06-05',
  price_member: 800,
  price_non_member: 1200,
  registration_url: 'https://event.hapily.com/reg/1',
  status: 'available' as const,
  seats_remaining: 8,
}

const MELBOURNE_ROW = {
  id: 2,
  course_name: 'AS1796 Cert 10',
  city: 'Melbourne',
  delivery_mode: 'Face-to-Face',
  start_date: '2026-07-01',
  end_date: '2026-07-05',
  price_member: 800,
  price_non_member: 1200,
  registration_url: 'https://event.hapily.com/reg/2',
  status: 'available' as const,
  seats_remaining: 12,
}

const SOLD_OUT_ROW = {
  ...SYDNEY_ROW,
  id: 3,
  status: 'sold_out' as const,
  seats_remaining: 0,
}

const EXPLICIT_ZERO_SEATS_ROW = {
  ...SYDNEY_ROW,
  id: 4,
  status: 'available' as const,
  seats_remaining: 0,
  seats_remaining_is_set: true,
}

const DEFAULT_PROPS: CourseFilterProps = {
  rows: [SYDNEY_ROW, MELBOURNE_ROW],
  member_tier: '',
  default_city: 'auto',
  default_delivery_mode: 'any',
  show_pricing: true,
  show_seats_remaining: true,
  register_cta_label: 'Register now',
  eoi_form_id: 'abc123-form-guid',
  eoi_heading: 'Register your interest',
  eoi_message: '<p>No sessions scheduled yet. Let us know and we will be in touch.</p>',
  portal_id: '4538263',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cards() {
  return document.querySelectorAll('.wa-course-filter__card')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CourseFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    window.history.pushState({}, '', '/courses/as1796-cert-1-9')
    // The availability cache is module-level and outlives a component, so a read from one
    // test would otherwise decide the next one's cards.
    resetAvailabilityCache()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('renders with mock props without crashing', () => {
    render(<CourseFilter {...DEFAULT_PROPS} />)
    expect(screen.getByRole('combobox')).toBeTruthy()
    expect(screen.getByText('Register now')).toBeTruthy()
  })

  it('pre-selects the first city with sessions when default_city is auto', () => {
    render(<CourseFilter {...DEFAULT_PROPS} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    // Sydney comes before Melbourne in CITY_ORDER and has a session.
    expect(select.value).toBe('Sydney')
    expect(cards()).toHaveLength(1)
    expect([...select.options].map((o) => o.value)).not.toContain('any')
  })

  it('pre-selects All locations and shows every session, started ones included', () => {
    const pastSydney = { ...SYDNEY_ROW, id: 11, start_date: '2026-03-01', end_date: '2026-03-05' }
    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        default_city="any"
        rows={[pastSydney, SYDNEY_ROW, MELBOURNE_ROW]}
      />
    )
    const select = screen.getByLabelText('Select a location') as HTMLSelectElement
    expect(select.value).toBe('any')
    expect([...select.options].map((o) => o.textContent)).toContain('All locations')
    expect(cards()).toHaveLength(3)
    // The started one is listed, not hidden - it just cannot be booked.
    expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
  })

  it('still shows a started session when that city is chosen', () => {
    const pastSydney = { ...SYDNEY_ROW, id: 11, start_date: '2026-03-01', end_date: '2026-03-05' }
    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        default_city="any"
        rows={[pastSydney, MELBOURNE_ROW]}
      />
    )
    fireEvent.change(screen.getByLabelText('Select a location'), { target: { value: 'Sydney' } })
    expect(cards()).toHaveLength(1)
    expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
  })

  it('names the location on every session card', () => {
    render(<CourseFilter {...DEFAULT_PROPS} default_city="any" />)
    const locations = [...document.querySelectorAll('.wa-course-filter__session-location')].map(
      (el) => el.textContent
    )
    expect(locations).toEqual(['Location: Sydney', 'Location: Melbourne'])
  })

  it('does not repeat the city when the delivery pill already shows it', () => {
    render(
      <CourseFilter {...DEFAULT_PROPS} rows={[{ ...SYDNEY_ROW, delivery_mode: undefined }]} />
    )
    expect(document.querySelector('.wa-course-filter__delivery')?.textContent).toBe('Sydney')
    expect(document.querySelector('.wa-course-filter__session-location')).toBeNull()
  })

  it('returns to Any from a specific city', () => {
    render(<CourseFilter {...DEFAULT_PROPS} default_city="any" />)
    fireEvent.change(screen.getByLabelText('Select a location'), { target: { value: 'Sydney' } })
    expect(cards()).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Select a location'), { target: { value: 'any' } })
    expect(cards()).toHaveLength(2)
  })

  it('lists a course whose every session has already started', () => {
    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        default_city="any"
        eoi_form_id=""
        rows={[{ ...SYDNEY_ROW, start_date: '2026-03-01', end_date: '2026-03-05' }]}
      />
    )
    // No EOI here any more: 'any' shows the closed session rather than
    // claiming nothing is scheduled.
    expect(screen.queryByText('No sessions currently scheduled')).toBeNull()
    expect(cards()).toHaveLength(1)
    expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
  })

  it('shows the city-less EOI when the course has no sessions at all', () => {
    render(<CourseFilter {...DEFAULT_PROPS} default_city="any" eoi_form_id="" rows={[]} />)
    expect(screen.getByText('No sessions currently scheduled')).toBeTruthy()
    expect(screen.queryByText(/scheduled in /)).toBeNull()
    expect(cards()).toHaveLength(0)
  })

  it('hides the location selector when the course has no sessions', () => {
    render(<CourseFilter {...DEFAULT_PROPS} rows={[]} />)
    expect(screen.queryByLabelText('Select a location')).toBeNull()
  })

  it('drops a city-specific phrase from the EOI when there are no sessions', () => {
    // The island keeps its DOM node across an editor prop change, so this is
    // also the state a course lands in when its last session is removed.
    render(<CourseFilter {...DEFAULT_PROPS} rows={[]} eoi_form_id="" />)
    const eoi = document.querySelector('.wa-course-filter__eoi')
    expect(eoi?.textContent).toContain('No sessions currently scheduled')
    expect(eoi?.textContent).not.toContain('scheduled in ')
    expect(eoi?.textContent).not.toContain('Choose another location')
  })

  it('re-picks a city when a prop update drops the selected one', () => {
    // mountReactIsland re-renders the same React root when the HubSpot editor
    // changes data-props, so selectedCity survives a change of rows. A capital
    // is always offered, so the selection that can actually disappear is a
    // regional town the new rows no longer carry - leaving the selector showing
    // a city that is not in its own option list.
    const { rerender } = render(
      <CourseFilter {...DEFAULT_PROPS} rows={[{ ...SYDNEY_ROW, city: 'Bunbury' }]} />
    )
    const select = () => screen.getByLabelText('Select a location') as HTMLSelectElement
    expect(select().value).toBe('Bunbury')

    rerender(<CourseFilter {...DEFAULT_PROPS} rows={[MELBOURNE_ROW]} />)

    expect(select().value).toBe('Melbourne')
    expect(cards()).toHaveLength(1)
    expect(screen.queryByText('Register your interest')).toBeNull()
  })

  it('re-picks a delivery mode when a prop update drops the selected one', () => {
    const rows = [SYDNEY_ROW, { ...MELBOURNE_ROW, delivery_mode: 'Online' }]
    const { rerender } = render(<CourseFilter {...DEFAULT_PROPS} rows={rows} />)
    fireEvent.change(screen.getByLabelText('Select a delivery type'), {
      target: { value: 'Face-to-Face' },
    })

    // Every remaining session is Online, so the Face-to-Face selection has to
    // go. The survivor keeps the selected CITY, so the only thing that can
    // empty the list here is the delivery filter.
    rerender(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[{ ...SYDNEY_ROW, delivery_mode: 'Online' }]}
      />
    )
    expect(cards()).toHaveLength(1)
  })

  it('filtering by city updates the displayed sessions', () => {
    render(<CourseFilter {...DEFAULT_PROPS} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Melbourne' } })
    expect(cards()).toHaveLength(1)
  })

  it('renders the EOI form when the delivery filter empties the selected city', () => {
    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[SYDNEY_ROW, { ...MELBOURNE_ROW, delivery_mode: 'Online' }]}
      />
    )
    fireEvent.change(screen.getByLabelText('Select a delivery type'), {
      target: { value: 'Online' },
    })
    expect(screen.getByText('Register your interest')).toBeTruthy()
    expect(cards()).toHaveLength(0)
  })

  it('renders EOI form immediately when rows array is empty', () => {
    render(<CourseFilter {...DEFAULT_PROPS} rows={[]} />)
    expect(screen.getByText('Register your interest')).toBeTruthy()
  })

  // QA 86: a regional session was unreachable. The selector rendered a list
  // compiled into the bundle, so Mackay was not offered at all, 'auto' fell
  // through to Sydney, and the page told the visitor there were no sessions -
  // on a course whose only session was the one they had just clicked.
  describe('sessions in a city the bundle does not know about', () => {
    const MACKAY_ROW = {
      ...SYDNEY_ROW,
      id: 91,
      city: 'Mackay',
      start_date: '2026-10-26',
      end_date: '2026-10-30',
    }

    it('offers the city in the selector', () => {
      render(<CourseFilter {...DEFAULT_PROPS} rows={[MACKAY_ROW]} />)
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect([...select.options].map((o) => o.value)).toContain('Mackay')
    })

    it('opens on it rather than on an empty Sydney', () => {
      render(<CourseFilter {...DEFAULT_PROPS} rows={[MACKAY_ROW]} />)
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('Mackay')
      expect(cards()).toHaveLength(1)
      expect(screen.queryByText('Register your interest')).toBeNull()
    })

    it('offers a town no HubDB option list has ever held', () => {
      render(
        <CourseFilter {...DEFAULT_PROPS} rows={[{ ...MACKAY_ROW, city: 'Gladstone' }]} />
      )
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('Gladstone')
      expect(cards()).toHaveLength(1)
    })

    it('adds one option for a city several sessions share', () => {
      render(
        <CourseFilter
          {...DEFAULT_PROPS}
          rows={[MACKAY_ROW, { ...MACKAY_ROW, id: 92 }, { ...MACKAY_ROW, id: 93 }]}
        />
      )
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect([...select.options].filter((o) => o.value === 'Mackay')).toHaveLength(1)
      expect(cards()).toHaveLength(3)
    })

    it('still lists capitals with nothing scheduled, so the EOI form is reachable', () => {
      render(<CourseFilter {...DEFAULT_PROPS} rows={[MACKAY_ROW]} />)
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'Darwin' } })
      expect(screen.getByText('Register your interest')).toBeTruthy()
    })

    it('matches rows whose city differs only by case from the option offered', () => {
      // The selector offers the canonical "Mackay" while the row carries the
      // spelling someone typed into HubDB. Comparing exactly offered the city
      // and then matched nothing.
      render(<CourseFilter {...DEFAULT_PROPS} rows={[{ ...MACKAY_ROW, city: ' mackay ' }]} />)
      expect(cards()).toHaveLength(1)
      expect(screen.queryByText('Register your interest')).toBeNull()
    })

    it('honours a default_city the editor set to a regional town', () => {
      render(
        <CourseFilter {...DEFAULT_PROPS} rows={[SYDNEY_ROW, MACKAY_ROW]} default_city="Mackay" />
      )
      expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('Mackay')
    })
  })

  it('shows member pricing in the success colour class when member_tier is set', () => {
    const { container } = render(
      <CourseFilter {...DEFAULT_PROPS} member_tier="corporate_gold" />
    )
    expect(
      container.querySelector('.wa-course-filter__price--member')
    ).toBeTruthy()
  })

  it('shows member pricing when entitlement is verified but the tier is unavailable', () => {
    const { container } = render(
      <CourseFilter
        {...DEFAULT_PROPS}
        member_is_member={true}
        member_tier=""
      />
    )

    expect(
      container.querySelector('.wa-course-filter__price--member')
    ).toBeTruthy()
    expect(
      container.querySelector('.wa-course-filter__price--struck')
    ).toBeTruthy()
  })

  it('does not infer entitlement from a stale tier when HubL marks the visitor as a non-member', () => {
    const { container } = render(
      <CourseFilter
        {...DEFAULT_PROPS}
        member_is_member={false}
        member_tier="Silver"
      />
    )

    expect(
      container.querySelector('.wa-course-filter__price--member')
    ).toBeNull()
    expect(screen.getByText('$1,200.00')).toBeTruthy()
  })

  it('strikes through the non-member price for logged-in members', () => {
    const { container } = render(
      <CourseFilter {...DEFAULT_PROPS} member_tier="individual" />
    )
    expect(
      container.querySelector('.wa-course-filter__price--struck')
    ).toBeTruthy()
  })

  it('uses the exact silver tier price instead of the generic member fallback', () => {
    const silverRow = {
      ...SYDNEY_ROW,
      price_member: 2350,
      price_individual: 2350,
      price_bronze: 2300,
      price_silver: 2250,
      price_gold: 2170,
      price_non_member: 2555,
    }

    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[silverRow]}
        member_is_member={true}
        member_tier="Silver"
      />
    )

    expect(screen.getByText('$2,250.00')).toBeTruthy()
    expect(screen.queryByText('$2,350.00')).toBeNull()
  })

  it('does not render member-specific pricing elements for non-members', () => {
    const { container } = render(
      <CourseFilter {...DEFAULT_PROPS} member_tier="" />
    )
    expect(
      container.querySelector('.wa-course-filter__price--member')
    ).toBeNull()
    expect(
      container.querySelector('.wa-course-filter__price--struck')
    ).toBeNull()
  })

  it('falls back to public pricing when the member price is zero', () => {
    const zeroMemberPriceRow = { ...SYDNEY_ROW, price_member: 0 }
    const { container } = render(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[zeroMemberPriceRow]}
        member_tier="individual"
      />
    )

    expect(
      container.querySelector('.wa-course-filter__price--member')
    ).toBeNull()
    expect(screen.getByText('$1,200.00')).toBeTruthy()
  })

  it('hides pricing block entirely when show_pricing is false', () => {
    const { container } = render(
      <CourseFilter {...DEFAULT_PROPS} show_pricing={false} />
    )
    expect(container.querySelector('.wa-course-filter__pricing')).toBeNull()
  })

  it('shows seats-remaining warning when <= 5 seats available', () => {
    const fewSeats = { ...SYDNEY_ROW, seats_remaining: 3 }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[fewSeats]} />)
    expect(screen.getByText(/3 spots left/)).toBeTruthy()
  })

  it('suppresses seats-remaining warning when > 5 seats remain', () => {
    render(<CourseFilter {...DEFAULT_PROPS} />)
    // SYDNEY_ROW has 8 seats - above threshold.
    expect(screen.queryByText(/spots left/)).toBeNull()
  })

  it('hides seats-remaining when show_seats_remaining is false', () => {
    const fewSeats = { ...SYDNEY_ROW, seats_remaining: 2 }
    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[fewSeats]}
        show_seats_remaining={false}
      />
    )
    expect(screen.queryByText(/spots left/)).toBeNull()
  })

  it('marks sold-out sessions with a native disabled <button>', () => {
    render(<CourseFilter {...DEFAULT_PROPS} rows={[SOLD_OUT_ROW]} />)
    // Unavailable sessions now render a <button disabled> for proper AT semantics
    const cta = document.querySelector('button.wa-course-filter__cta') as HTMLButtonElement
    expect(cta).toBeTruthy()
    expect(cta.disabled).toBe(true)
    // Must not be rendered as an <a> with aria-disabled - that was the old (broken) pattern
    const anchor = document.querySelector('a.wa-course-filter__cta')
    expect(anchor).toBeNull()
  })

  it('treats an explicitly entered zero seats value as sold out', () => {
    render(<CourseFilter {...DEFAULT_PROPS} rows={[EXPLICIT_ZERO_SEATS_ROW]} />)

    expect(screen.getByRole('button', { name: /sold out/i })).toBeDisabled()
    expect(document.querySelector('a.wa-course-filter__cta')).toBeNull()
  })

  it('keeps blank or unknown seats bookable until status says sold out', () => {
    const unknownSeatsRow = {
      ...SYDNEY_ROW,
      seats_remaining: null,
      seats_remaining_is_set: false,
    }

    render(<CourseFilter {...DEFAULT_PROPS} rows={[unknownSeatsRow]} />)

    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta).toBeTruthy()
    expect(cta.textContent).toBe('Register now')
  })

  it('respects a specific default_city override', () => {
    render(<CourseFilter {...DEFAULT_PROPS} default_city="melbourne" />)
    const select = screen.getByLabelText('Select a location') as HTMLSelectElement
    expect(select.value).toBe('Melbourne')
  })

  it('falls back to the first city with sessions when default_city has none', () => {
    render(<CourseFilter {...DEFAULT_PROPS} default_city="Perth" />)
    const select = screen.getByLabelText('Select a location') as HTMLSelectElement
    expect(select.value).toBe('Sydney')
    expect(cards()).toHaveLength(1)
  })

  it('uses register_cta_label on available session buttons', () => {
    render(
      <CourseFilter {...DEFAULT_PROPS} register_cta_label="Enrol today" />
    )
    expect(screen.getByText('Enrol today')).toBeTruthy()
  })

  it('routes engine-backed sessions to the on-site checkout tunnel (same tab)', () => {
    const engineRow = { ...SYDNEY_ROW, use_event_engine: true, worker_event_id: 'evt_1' }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[engineRow]} />)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/checkout/?session_id=1')
    // On-site navigation - must not open a new tab.
    expect(cta.getAttribute('target')).toBeNull()
  })

  it('stores resolved member pricing for the checkout tunnel handoff', () => {
    const engineRow = { ...SYDNEY_ROW, use_event_engine: true, worker_event_id: 'evt_1' }
    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[engineRow]}
        member_is_member={true}
        member_tier="Silver Corporate"
      />
    )

    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    cta.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(cta)

    const handoff = JSON.parse(sessionStorage.getItem(CHECKOUT_PRICING_HANDOFF_KEY) || '{}')
    expect(handoff.sessionId).toBe('1')
    expect(handoff.isMember).toBe(true)
    expect(handoff.memberTier).toBe('Silver Corporate')
    expect(handoff.expiresAt).toBeGreaterThan(Date.now())
  })

  it('falls back to the legacy registration URL when ticked without a worker event id', () => {
    // The tick is the editorial opt-in; the checkout cannot load without an
    // event to reserve against. Sending the buyer there anyway produced a page
    // that could only say online booking was not configured, while a perfectly
    // good registration_url sat unused on the same row.
    const halfWired = {
      ...SYDNEY_ROW,
      use_event_engine: true,
      worker_event_id: '',
      registration_url: 'https://events.hapily.com/weld/as1796',
    }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[halfWired]} />)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('events.hapily.com')
    expect(cta.getAttribute('href')).not.toContain('/checkout/')
    expect(cta.getAttribute('target')).toBe('_blank')
  })

  it('falls back to the contact CTA when ticked with neither a worker event id nor a URL', () => {
    const stranded = {
      ...SYDNEY_ROW,
      use_event_engine: true,
      worker_event_id: '',
      registration_url: '',
    }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[stranded]} />)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('mailto:training@weldaustralia.com.au')
  })

  it('still displays non-engine sessions when a course also has engine-backed sessions', () => {
    const engineRow = { ...SYDNEY_ROW, use_event_engine: true, worker_event_id: 'evt_1' }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[engineRow, MELBOURNE_ROW]} />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Melbourne' } })

    expect(cards()).toHaveLength(1)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('hapily.com')
  })

  it('keeps the external hapily handoff for non-engine sessions', () => {
    render(<CourseFilter {...DEFAULT_PROPS} rows={[SYDNEY_ROW]} />)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('hapily.com')
    expect(cta.getAttribute('target')).toBe('_blank')
  })

  it('falls back to a training contact link when a non-engine session has no registration URL', () => {
    const noUrlRow = { ...SYDNEY_ROW, registration_url: '' }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[noUrlRow]} />)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('mailto:training@weldaustralia.com.au')
    expect(cta.textContent).toBe('Contact to book')
    expect(cta.getAttribute('target')).toBeNull()
    expect(screen.getByText(/Online booking is not available/)).toBeTruthy()
  })

  it('keeps the CTA as the last card element so buttons line up across cards', () => {
    // The card body flex-grows, which bottom-anchors the CTA. Anything after
    // the button knocks that card's CTA out of line with its neighbours.
    const noUrlRow = { ...SYDNEY_ROW, registration_url: '' }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[noUrlRow]} />)
    const card = document.querySelector('.wa-course-filter__card') as HTMLElement
    expect(card.lastElementChild?.classList.contains('wa-course-filter__cta')).toBe(true)
    const note = card.querySelector('.wa-course-filter__note') as HTMLElement
    expect(
      note.compareDocumentPosition(card.lastElementChild as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('falls back to a training contact link when the registration URL points to the current course page', () => {
    const selfUrlRow = { ...SYDNEY_ROW, registration_url: '/courses/as1796-cert-1-9' }
    render(<CourseFilter {...DEFAULT_PROPS} rows={[selfUrlRow]} />)
    const cta = document.querySelector('a.wa-course-filter__cta') as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('mailto:training@weldaustralia.com.au')
    expect(cta.textContent).toBe('Contact to book')
    expect(cta.getAttribute('target')).toBeNull()
  })

  // ── Delivery-type filter ──────────────────────────────────────────────────

  it('hides the delivery-type filter when the course has a single delivery mode', () => {
    // Both default rows are Face-to-Face → no delivery choice to make.
    render(<CourseFilter {...DEFAULT_PROPS} />)
    expect(screen.queryByLabelText('Select a delivery type')).toBeNull()
  })

  it('shows the delivery-type filter when a course offers multiple delivery modes', () => {
    const sydneyOnline = {
      ...SYDNEY_ROW,
      id: 10,
      delivery_mode: 'Online',
      registration_url: 'https://event.hapily.com/reg/10',
    }
    render(
      <CourseFilter {...DEFAULT_PROPS} rows={[SYDNEY_ROW, sydneyOnline]} />
    )
    expect(screen.getByLabelText('Select a delivery type')).toBeTruthy()
  })

  it('gives the delivery selector its own label class so it is not labelled as a location filter', () => {
    // The theme paints the eyebrow above each label with ::before. Sharing
    // __city-label printed "Filter by location" over the delivery selector.
    const sydneyOnline = {
      ...SYDNEY_ROW,
      id: 10,
      delivery_mode: 'Online',
      registration_url: 'https://event.hapily.com/reg/10',
    }
    render(
      <CourseFilter {...DEFAULT_PROPS} rows={[SYDNEY_ROW, sydneyOnline]} />
    )
    const deliveryLabel = document.querySelector(
      'label[for="wa-cf-delivery"]'
    ) as HTMLLabelElement
    expect(
      deliveryLabel.classList.contains('wa-course-filter__delivery-label')
    ).toBe(true)

    const cityLabel = document.querySelector(
      'label[for="wa-cf-city"]'
    ) as HTMLLabelElement
    expect(
      cityLabel.classList.contains('wa-course-filter__delivery-label')
    ).toBe(false)
  })

  it('ignores a default delivery mode this course does not offer (no dead-end EOI)', () => {
    // Editor set default_delivery_mode to a mode absent from the data. The
    // selector is hidden (single mode), so an honoured invalid default would
    // strand the visitor on the EOI state for a course that has sessions.
    render(
      <CourseFilter {...DEFAULT_PROPS} default_delivery_mode="Online" />
    )
    expect(screen.queryByLabelText('Select a delivery type')).toBeNull()
    expect(cards()).toHaveLength(1)
    expect(screen.queryByText('Register your interest')).toBeNull()
  })

  it('filters sessions by delivery mode within the selected city', () => {
    const sydneyOnline = {
      ...SYDNEY_ROW,
      id: 10,
      delivery_mode: 'Online',
      registration_url: 'https://event.hapily.com/reg/10',
    }
    render(
      <CourseFilter {...DEFAULT_PROPS} rows={[SYDNEY_ROW, sydneyOnline]} />
    )
    // Sydney auto-selected; both sessions are in Sydney.
    expect(cards()).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Select a delivery type'), {
      target: { value: 'Online' },
    })
    expect(cards()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Live seat availability (Event Engine)
// ---------------------------------------------------------------------------

/** A session the worker knows about, so the card is eligible for a live read. */
const LIVE_ROW = {
  ...SYDNEY_ROW,
  id: 20,
  use_event_engine: true,
  worker_event_id: 'evt_syd_jun',
}

function stubAvailability(body: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function liveProps(rows: CourseFilterProps['rows'] = [LIVE_ROW]): CourseFilterProps {
  return {
    ...DEFAULT_PROPS,
    rows,
    worker_base_url: 'https://worker.example.com',
    worker_portal_id: '441838610',
  }
}

describe('CourseFilter live availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    resetAvailabilityCache()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows the worker as sold out even though HubDB still advertises 8 places', async () => {
    // The defect this fixes: seats_remaining is hand-typed, so it keeps selling a full course.
    stubAvailability({
      status: 'ok',
      eventFull: true,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 0, soldOut: true, waitlistAvailable: true }],
    })

    render(<CourseFilter {...liveProps()} />)

    await waitFor(() => expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0))
    expect(screen.queryByText('Register now')).toBeNull()
  })

  it('says registrations have closed, not sold out, when the cutoff has passed', async () => {
    stubAvailability({
      status: 'ok',
      eventFull: false,
      registrationClosed: true,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 8, soldOut: false, waitlistAvailable: false }],
    })

    render(<CourseFilter {...liveProps()} />)

    await waitFor(() =>
      expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
    )
    expect(screen.queryByText('Sold out')).toBeNull()
  })

  it('closes a session that has already started, with no live read to ask', async () => {
    // Ref 46 round 2: a legacy row the Worker never sees kept its Register button long
    // after the course ran, and the same rows set the "from" price on the page above.
    // NOW is 1 May 2026, so a 1 March session has been and gone.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CourseFilter
        {...DEFAULT_PROPS}
        rows={[{ ...SYDNEY_ROW, start_date: '2026-03-01', end_date: '2026-03-05' }]}
      />
    )

    await waitFor(() =>
      expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
    )
    expect(screen.queryByText('Register now')).toBeNull()
    // Not "Sold out": there is no waitlist for a course that has finished.
    expect(screen.queryByText('Sold out')).toBeNull()
  })

  it('lets the worker re-open a started session it still sells', async () => {
    // The clock is a derived fact, not an editorial one. A tenant who left a walk-up
    // window open past the start owns that in registration_closes_at, and the Worker is
    // the side holding that column.
    stubAvailability({
      status: 'ok',
      eventFull: false,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 3, soldOut: false, waitlistAvailable: false }],
    })

    render(
      <CourseFilter
        {...liveProps([{ ...LIVE_ROW, start_date: '2026-03-01', end_date: '2026-03-05' }])}
      />
    )

    await waitFor(() => expect(screen.getByText('Register now')).toBeTruthy())
    expect(screen.queryByText('Registrations closed')).toBeNull()
  })

  it('honours a HubDB row marked Closed even when the worker has seats (Ref 74c)', async () => {
    // The EDITORIAL half of the same sentence. Ref 46 above closes a session because the
    // clock says so; this closes an UPCOMING one because staff said so. The seats are
    // still there and the Worker says so - the page must not sell them either way.
    stubAvailability({
      status: 'ok',
      eventFull: false,
      bookable: true,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 8, soldOut: false, waitlistAvailable: false }],
    })

    render(<CourseFilter {...liveProps([{ ...LIVE_ROW, status: 'closed' as const }])} />)

    await waitFor(() =>
      expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
    )
    expect(screen.queryByText('Register now')).toBeNull()
    expect(screen.queryByText('Sold out')).toBeNull()
  })


  it('says bookings are on hold when staff have paused sales', async () => {
    stubAvailability({
      status: 'ok',
      eventFull: false,
      salesPaused: true,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 8, soldOut: false, waitlistAvailable: false }],
    })

    render(<CourseFilter {...liveProps()} />)

    await waitFor(() => expect(screen.getAllByText('Bookings on hold').length).toBeGreaterThan(0))
  })

  it('keeps a session closed when staff set the status column to Sold Out', async () => {
    // Staff close a session for reasons the seat count cannot see. The worker reporting
    // three free seats used to override that and the card went back on sale.
    stubAvailability({
      status: 'ok',
      eventFull: false,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 3, soldOut: false, waitlistAvailable: false }],
    })

    render(
      <CourseFilter
        {...liveProps([{ ...LIVE_ROW, status: 'sold_out' as const, seats_remaining: 0 }])}
      />
    )

    await waitFor(() => expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0))
    expect(screen.queryByText('Register now')).toBeNull()
  })

  it('re-opens a session closed only by a stale seat count', async () => {
    // A 0 in seats_remaining is a hand-typed number or an import artefact, not a decision,
    // so the worker still overrides it.
    stubAvailability({
      status: 'ok',
      eventFull: false,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 3, soldOut: false, waitlistAvailable: false }],
    })

    render(
      <CourseFilter
        {...liveProps([
          { ...LIVE_ROW, status: 'available' as const, seats_remaining: 0, seats_remaining_is_set: true },
        ])}
      />
    )

    await waitFor(() => expect(screen.getByText('Register now')).toBeTruthy())
    expect(screen.getByText('Only 3 spots left')).toBeTruthy()
  })

  it('says booking is opening soon when the worker lists no public ticket types', async () => {
    // A session whose ticket types are not set up yet, or whose only types are internal or
    // CAMS imports. Nothing is full, so "Sold out" would cost a booking and bring in a
    // waitlist enquiry for seats that are all still there.
    stubAvailability({ status: 'ok', eventFull: false, ticketTypes: [] })

    render(<CourseFilter {...liveProps()} />)

    await waitFor(() =>
      expect(screen.getAllByText('Booking opening soon').length).toBeGreaterThan(0)
    )
    expect(screen.queryByText('Sold out')).toBeNull()
  })

  it('keeps the HubDB row when the read fails — a CDN hiccup cannot close a course', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    render(<CourseFilter {...liveProps()} />)

    // Still bookable, still on HubDB's numbers.
    expect(screen.getByText('Register now')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Register now')).toBeTruthy())
    expect(screen.queryByText('Sold out')).toBeNull()
  })

  it('never reads for a session that is not Event Engine-backed', async () => {
    const fetchMock = stubAvailability({ status: 'ok', eventFull: true, ticketTypes: [] })

    render(<CourseFilter {...liveProps([SYDNEY_ROW])} />)

    await waitFor(() => expect(screen.getByText('Register now')).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads once per session however many times the card re-renders', async () => {
    const fetchMock = stubAvailability({
      status: 'ok',
      eventFull: false,
      ticketTypes: [{ ticketTypeId: 'tt1', available: 5, soldOut: false, waitlistAvailable: false }],
    })

    const { rerender } = render(<CourseFilter {...liveProps()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender(<CourseFilter {...liveProps()} />)
    rerender(<CourseFilter {...liveProps()} />)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
