import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  CourseTimetableFilter,
  type CourseTimetableFilterProps,
} from './CourseTimetableFilter'

vi.mock('@shared/api/forms', () => ({
  submitHubSpotForm: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The rows below are dated, and a session that has already started now renders as
// "Registrations closed" rather than with a Register button (Ref 46 round 2). The date
// presets read the clock too. Freezing it keeps this suite about the code instead of about
// how long ago it was written; only Date is faked, so real timers still run.
const NOW = new Date('2026-05-01T09:00:00+09:30')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterAll(() => {
  vi.useRealTimers()
})

function makeRow(
  overrides: Partial<CourseTimetableFilterProps['rows'][number]> = {}
): CourseTimetableFilterProps['rows'][number] {
  return {
    id: Math.random(),
    course_name: 'AS1796 Cert 10',
    course_category: 'Supervision',
    delivery_mode: 'Face-to-Face',
    city: 'Sydney',
    start_date: '2026-06-01',
    end_date: '2026-06-05',
    price_member: 800,
    price_non_member: 1200,
    registration_url: 'https://event.hapily.com/reg/1',
    status: 'available',
    seats_remaining: 8,
    ...overrides,
  }
}

const SYDNEY_ROW = makeRow({ id: 1 })
const MELBOURNE_ROW = makeRow({
  id: 2,
  city: 'Melbourne',
  start_date: '2026-07-01',
  end_date: '2026-07-05',
  course_category: 'Welding Inspection',
  delivery_mode: 'Online',
})
const INSPECTION_ROW = makeRow({
  id: 3,
  city: 'Brisbane',
  course_category: 'Welding Inspection',
  delivery_mode: 'Online',
  start_date: '2026-06-15',
  end_date: '2026-06-16',
})

const DEFAULT_PROPS: CourseTimetableFilterProps = {
  rows: [SYDNEY_ROW, MELBOURNE_ROW, INSPECTION_ROW],
  member_tier: '',
  default_city: 'any',
  default_category: 'any',
  default_delivery_mode: 'any',
  show_seats_remaining: true,
  page_size: 25,
  eoi_form_id: 'abc123-form-guid',
  eoi_message:
    '<p>We do not have a session scheduled for these filters yet.</p>',
  portal_id: '4538263',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tableRows() {
  return document.querySelectorAll('.wa-ctf__tr')
}

function mobileCards() {
  return document.querySelectorAll('.wa-ctf__card')
}

function sortHeader(label: string) {
  return screen.getByRole('columnheader', { name: new RegExp(label, 'i') })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CourseTimetableFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // getInitialCategory() reads the query string, so reset it between tests.
    window.history.replaceState({}, '', '/courses')
  })

  // ── Render ──────────────────────────────────────────────────────────────

  it('renders without crashing and shows all rows initially', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(tableRows()).toHaveLength(3)
    expect(mobileCards()).toHaveLength(3)
  })

  it('renders course-type chips, delivery chips and a location menu', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Welding Supervision' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Welding Inspection' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Online' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Face-to-Face' })).toBeTruthy()
    expect(screen.getByLabelText('Filter by location')).toBeTruthy()
  })

  it('renders all date preset buttons', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(screen.getByRole('button', { name: 'Any date' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'This week' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'This month' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Custom range' })).toBeTruthy()
  })

  // ── City filter ─────────────────────────────────────────────────────────

  it('filters by city without a network call', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByLabelText('Filter by location'))
    fireEvent.click(screen.getByRole('button', { name: 'Sydney' }))
    expect(tableRows()).toHaveLength(1)
    expect(mobileCards()).toHaveLength(1)
  })

  it('shows EOI form when no rows match the combined filters', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Welding Supervision' }))
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    expect(screen.getByText('No sessions match your filters')).toBeTruthy()
    expect(tableRows()).toHaveLength(0)
  })

  // ── Category filter ─────────────────────────────────────────────────────

  it('filters by course type (category)', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Welding Inspection' }))
    expect(tableRows()).toHaveLength(2)
  })

  it('groups HubDB categories into the training divisions', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    // The HubDB value is 'Supervision'; the chip shows the division name.
    expect(screen.getByRole('button', { name: 'Welding Supervision' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Supervision' })).toBeNull()
  })

  it('shows EOI form when course-type + city filter yields no rows', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Welding Supervision' }))
    fireEvent.click(screen.getByLabelText('Filter by location'))
    fireEvent.click(screen.getByRole('button', { name: 'Melbourne' }))
    expect(screen.getByText('No sessions match your filters')).toBeTruthy()
  })

  // ── Delivery-type filter ──────────────────────────────────────────────────

  it('filters by delivery type', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    expect(tableRows()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Face-to-Face' }))
    expect(tableRows()).toHaveLength(1)
  })

  it('only lists delivery modes present in the data', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(screen.getByRole('button', { name: 'Face-to-Face' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Online' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Blended' })).toBeNull()
  })

  it('combines delivery-type and course-type filters', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    fireEvent.click(screen.getByRole('button', { name: 'Welding Inspection' }))
    expect(tableRows()).toHaveLength(2)
  })

  // ── Clear filters ──────────────────────────────────────────────────────────

  it('hides the Clear filters button until a filter is active', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Online' }))
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })

  it('restores all rows when Clear filters is clicked', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Face-to-Face' }))
    fireEvent.click(screen.getByLabelText('Filter by location'))
    fireEvent.click(screen.getByRole('button', { name: 'Sydney' }))
    expect(tableRows()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(tableRows()).toHaveLength(3)
    expect(
      screen.getByRole('button', { name: 'Face-to-Face' }).getAttribute('aria-pressed')
    ).toBe('false')
    expect(screen.getByLabelText('Filter by location').textContent).toContain(
      'All locations'
    )
  })

  // ── Date preset: custom range ────────────────────────────────────────────

  it('shows custom date inputs when Custom range is selected', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    expect(screen.getByLabelText('From')).toBeTruthy()
    expect(screen.getByLabelText('To')).toBeTruthy()
  })

  it('filters by custom date range', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    // Only SYDNEY_ROW (2026-06-01) should pass this range
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-06-01' },
    })
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-06-10' },
    })
    expect(tableRows()).toHaveLength(1)
  })

  it('hides custom date inputs when switching away from Custom range', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom range' }))
    expect(screen.getByLabelText('From')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Any date' }))
    expect(screen.queryByLabelText('From')).toBeNull()
  })

  // ── Sort: mouse click ────────────────────────────────────────────────────

  it('sorts by course name ascending on header click', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(sortHeader('Course'))
    const rows = document.querySelectorAll('.wa-ctf__tr .wa-ctf__course-name')
    const names = Array.from(rows).map((r) => r.textContent ?? '')
    expect(names).toEqual([...names].sort())
  })

  it('reverses sort direction on second click', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(sortHeader('Course'))
    fireEvent.click(sortHeader('Course'))
    const header = sortHeader('Course')
    expect(header.getAttribute('aria-sort')).toBe('descending')
  })

  it('sets aria-sort="ascending" on active sorted column', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(sortHeader('Location'))
    expect(sortHeader('Location').getAttribute('aria-sort')).toBe('ascending')
  })

  it('sets aria-sort="none" on inactive columns', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(sortHeader('Location'))
    expect(sortHeader('Course').getAttribute('aria-sort')).toBe('none')
  })

  // ── Sort: keyboard ───────────────────────────────────────────────────────

  it('triggers sort on Enter key', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    // Course is not the default sort column, so first key activates ascending
    const header = sortHeader('Course')
    fireEvent.keyDown(header, { key: 'Enter' })
    expect(header.getAttribute('aria-sort')).toBe('ascending')
  })

  it('triggers sort on Space key', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    // Location is not the default sort column, so first key activates ascending
    const header = sortHeader('Location')
    fireEvent.keyDown(header, { key: ' ' })
    expect(header.getAttribute('aria-sort')).toBe('ascending')
  })

  it('does not trigger sort on other keys', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    // Date is the default sort column (ascending). One click toggles it to descending.
    const header = sortHeader('Date')
    fireEvent.click(header) // ascending → descending
    expect(header.getAttribute('aria-sort')).toBe('descending')
    fireEvent.keyDown(header, { key: 'Tab' }) // should not change
    expect(header.getAttribute('aria-sort')).toBe('descending')
  })

  it('sort headers are keyboard-focusable (tabIndex=0)', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    const header = sortHeader('Date')
    expect(header.getAttribute('tabIndex')).toBe('0')
  })

  // ── Pagination ───────────────────────────────────────────────────────────

  it('shows pagination when items exceed page_size', () => {
    const manyRows = Array.from({ length: 6 }, (_, i) =>
      makeRow({ id: i + 10 })
    )
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={manyRows} page_size={3} />)
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy()
    expect(tableRows()).toHaveLength(3)
  })

  it('advances to the next page on Next click', () => {
    const manyRows = Array.from({ length: 6 }, (_, i) =>
      makeRow({ id: i + 10, course_name: `Course ${i + 1}` })
    )
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={manyRows} page_size={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('2 / 2')).toBeTruthy()
    expect(tableRows()).toHaveLength(3)
  })

  it('disables Previous button on the first page', () => {
    const manyRows = Array.from({ length: 6 }, (_, i) => makeRow({ id: i + 10 }))
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={manyRows} page_size={3} />)
    const prevBtn = screen.getByRole('button', { name: 'Previous page' })
    expect(prevBtn).toBeTruthy()
    expect((prevBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not show pagination when items fit on one page', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(
      screen.queryByRole('navigation', { name: 'Pagination' })
    ).toBeNull()
  })

  it('resets to page 1 when a filter changes', () => {
    const manyRows = Array.from({ length: 6 }, (_, i) =>
      makeRow({ id: i + 10, city: 'Sydney' })
    )
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={manyRows} page_size={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('2 / 2')).toBeTruthy()
    // Change filter → should reset to page 1
    fireEvent.click(screen.getByRole('button', { name: 'Welding Supervision' }))
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  // ── Pricing ─────────────────────────────────────────────────────────────

  it('shows member price in success colour when member_tier is set', () => {
    const { container } = render(
      <CourseTimetableFilter {...DEFAULT_PROPS} member_tier="corporate_gold" />
    )
    expect(container.querySelector('.wa-ctf__price--member')).toBeTruthy()
  })

  it('strikes through non-member price for logged-in members', () => {
    const { container } = render(
      <CourseTimetableFilter {...DEFAULT_PROPS} member_tier="individual" />
    )
    expect(container.querySelector('.wa-ctf__price--struck')).toBeTruthy()
  })

  it('shows member price in success colour for non-members too (advertises the discount)', () => {
    const { container } = render(
      <CourseTimetableFilter {...DEFAULT_PROPS} member_tier="" />
    )
    // Member price is highlighted green for everyone...
    expect(container.querySelector('.wa-ctf__price--member')).toBeTruthy()
    // ...but the full price is not struck through for non-members (they pay it).
    expect(container.querySelector('.wa-ctf__price--struck')).toBeNull()
    expect(container.querySelector('.wa-ctf__price--public')).toBeTruthy()
  })

  // ── Seats remaining ──────────────────────────────────────────────────────

  it('shows seats warning when <= 5 seats remain', () => {
    const row = makeRow({ id: 99, seats_remaining: 3 })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[row]} />)
    expect(screen.getAllByText(/3 spots left/).length).toBeGreaterThan(0)
  })

  it('hides seats warning when > 5 seats remain', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    // Default rows have 8 seats - above threshold
    expect(screen.queryByText(/spots left/)).toBeNull()
  })

  it('hides seats warning when show_seats_remaining is false', () => {
    const row = makeRow({ id: 99, seats_remaining: 2 })
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        rows={[row]}
        show_seats_remaining={false}
      />
    )
    expect(screen.queryByText(/spots left/)).toBeNull()
  })

  // ── Status: sold-out / cancelled ────────────────────────────────────────

  it('shows Sold out badge for sold_out rows', () => {
    const row = makeRow({ id: 50, status: 'sold_out' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[row]} />)
    expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0)
  })

  it('shows Cancelled badge for cancelled rows', () => {
    const row = makeRow({ id: 51, status: 'cancelled' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[row]} />)
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
  })

  it('closes registrations on a session that has already started', () => {
    // Ref 46 round 2: the timetable kept a Register button on sessions that ran weeks
    // ago. NOW is 1 May 2026, so a 1 March session has been and gone.
    const row = makeRow({ id: 52, start_date: '2026-03-01', end_date: '2026-03-05' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[row]} />)

    expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Register' })).toBeNull()
    // Not "Sold out": there is no waitlist for a course that has finished.
    expect(screen.queryByText('Sold out')).toBeNull()
  })

  it('still sells a session starting today', () => {
    // The cutoff is the start of the day, not the moment: a course starting this morning
    // is still bookable at the door, and the Worker holds the real cutoff.
    const row = makeRow({ id: 53, start_date: '2026-05-01', end_date: '2026-05-03' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[row]} />)

    expect(screen.getAllByRole('link', { name: 'Register' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Registrations closed')).toBeNull()
  })

  it('shows a Registrations closed badge and no Register link for closed rows (Ref 74c)', () => {
    // The EDITORIAL half of the same sentence: an UPCOMING session (1 June, well after
    // the frozen NOW) that staff shut by hand. Both halves matter - the badge used to
    // render only for sold-out and cancelled, so a closed row showed nothing at all next
    // to a suppressed CTA.
    const row = makeRow({ id: 54, status: 'closed' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[row]} />)
    expect(screen.getAllByText('Registrations closed').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /register/i })).toBeNull()
  })

  // ── Mobile cards ─────────────────────────────────────────────────────────

  it('renders the same number of mobile cards as table rows', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(mobileCards()).toHaveLength(tableRows().length)
  })

  // ── Default filter state ─────────────────────────────────────────────────

  it('honours default_city prop', () => {
    render(
      <CourseTimetableFilter {...DEFAULT_PROPS} default_city="Melbourne" />
    )
    expect(screen.getByLabelText('Filter by location').textContent).toContain(
      'Melbourne'
    )
    expect(tableRows()).toHaveLength(1)
  })

  it('honours default_category prop', () => {
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        default_category="welding-inspection"
      />
    )
    expect(
      screen.getByRole('button', { name: 'Welding Inspection' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(tableRows()).toHaveLength(2)
  })

  it('accepts a raw HubDB category value as default_category', () => {
    // Pages saved before the division slugs existed still hold the HubDB value.
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        default_category="Welding Inspection"
      />
    )
    expect(tableRows()).toHaveLength(2)
  })

  // ── Deep-linking ──────────────────────────────────────────────────────────

  it('pre-applies the ?category= URL param', () => {
    window.history.replaceState({}, '', '/courses?category=welding-inspection')
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(
      screen.getByRole('button', { name: 'Welding Inspection' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(tableRows()).toHaveLength(2)
  })

  it('accepts legacy category slugs in the URL', () => {
    // /courses?category=inspector is still generated by certification.html.
    window.history.replaceState({}, '', '/courses?category=inspector')
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(tableRows()).toHaveLength(2)
  })

  it('lets the URL param override default_category', () => {
    window.history.replaceState({}, '', '/courses?category=welding-supervision')
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        default_category="welding-inspection"
      />
    )
    expect(
      screen.getByRole('button', { name: 'Welding Supervision' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(tableRows()).toHaveLength(1)
  })

  it('falls back to the default when the URL param names no division', () => {
    window.history.replaceState({}, '', '/courses?category=not-a-division')
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        default_category="welding-inspection"
      />
    )
    expect(tableRows()).toHaveLength(2)
  })

  it('shows every course when the URL param names no division and there is no default', () => {
    window.history.replaceState({}, '', '/courses?category=not-a-division')
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    expect(tableRows()).toHaveLength(3)
  })

  it('honours default_delivery_mode prop', () => {
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        default_delivery_mode="Online"
      />
    )
    expect(
      screen.getByRole('button', { name: 'Online' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(tableRows()).toHaveLength(2)
  })

  // ── EOI form ─────────────────────────────────────────────────────────────

  it('shows EOI fallback text when rows is empty and no eoi_form_id', () => {
    render(
      <CourseTimetableFilter
        {...DEFAULT_PROPS}
        rows={[]}
        eoi_form_id=""
      />
    )
    expect(
      screen.getByText(/No sessions are currently scheduled/)
    ).toBeTruthy()
  })

  it('shows EOI form when rows is empty and eoi_form_id is set', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[]} />)
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  // ── Event Engine routing ─────────────────────────────────────────────────

  it('routes a fully wired session to the on-site checkout, in the same tab', () => {
    const wired = makeRow({ id: 9, use_event_engine: true, worker_event_id: 'evt_1' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[wired]} />)
    const cta = screen.getAllByRole('link', { name: 'Register' })[0] as HTMLAnchorElement
    expect(cta.getAttribute('href')).toBe('/checkout/?session_id=9')
    expect(cta.getAttribute('target')).toBeNull()
  })

  it('falls back to the legacy registration URL when ticked without a worker event id', () => {
    // The tick is the editorial opt-in; the checkout cannot load without an
    // event to reserve against, so a half-wired row must not be sent there.
    const halfWired = makeRow({ id: 10, use_event_engine: true, worker_event_id: '' })
    render(<CourseTimetableFilter {...DEFAULT_PROPS} rows={[halfWired]} />)
    const cta = screen.getAllByRole('link', { name: 'Register' })[0] as HTMLAnchorElement
    expect(cta.getAttribute('href')).toContain('event.hapily.com')
    expect(cta.getAttribute('href')).not.toContain('/checkout/')
    expect(cta.getAttribute('target')).toBe('_blank')
  })

  // ── aria-pressed on date chip ────────────────────────────────────────────

  it('marks the active date chip with aria-pressed=true', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    const todayBtn = screen.getByRole('button', { name: 'Today' })
    fireEvent.click(todayBtn)
    expect(todayBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('removes aria-pressed from inactive date chips', () => {
    render(<CourseTimetableFilter {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    const anyDate = screen.getByRole('button', { name: 'Any date' })
    expect(anyDate.getAttribute('aria-pressed')).toBe('false')
  })
})
