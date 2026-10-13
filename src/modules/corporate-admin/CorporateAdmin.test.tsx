import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CorporateAdmin,
  bulkTicketTypeFor,
  isBulkBookable,
  type CorporateAdminProps,
  type CourseSession,
  type Employee,
} from './CorporateAdmin'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPLOYEES: Employee[] = [
  { id: '111', name: 'Mel Anthony', email: 'mel@abc.com.au', membership_tier: 'Corporate' },
  { id: '222', name: 'Sam Rivers', email: 'sam@abc.com.au', membership_tier: 'Corporate' },
]

/** A session the Event Engine can take a group booking for. */
const BOOKABLE: CourseSession = {
  id: '42',
  course_name: 'AS1796 Cert 10',
  city: 'Online',
  start_date: '20 Aug 2026',
  status: 'available',
  use_event_engine: true,
  worker_event_id: 'evt_cert10_online',
  member_ticket_type_id: 'tt_member',
  non_member_ticket_type_id: 'tt_public',
}

/** Available, but never wired to the Event Engine — must stay on mailto. */
const UNWIRED: CourseSession = {
  id: '43',
  course_name: 'Welding Supervision',
  city: 'Sydney',
  start_date: '01 Sep 2026',
  status: 'available',
}

function baseProps(overrides: Partial<CorporateAdminProps> = {}): CorporateAdminProps {
  return {
    portal_id: '441838610',
    actor_contact_id: '999',
    actor_name: 'Dana Admin',
    actor_email: 'dana@abc.com.au',
    company_id: '1234567',
    company_name: 'ABC Welding Pty Ltd',
    vouchers_total: 10,
    vouchers_used: 4,
    employees: EMPLOYEES,
    course_sessions: [BOOKABLE],
    add_employee_form_url: '',
    team_page_url: '/portal#portal-team',
    worker_base_url: 'https://w.example.com',
    ...overrides,
  }
}

function selectSession(value: string): void {
  fireEvent.change(screen.getByLabelText(/course session/i), { target: { value } })
}

function selectEmployee(name: string): void {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(name, 'i') }))
}

function mockReserve(body: unknown, orderBody: unknown = {}) {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/bulk-register')) {
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(body)) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(orderBody) })
  })
}

// ---------------------------------------------------------------------------

describe('bulk booking capability helpers', () => {
  it('treats a session with an event id and a ticket type as bookable', () => {
    expect(isBulkBookable(BOOKABLE)).toBe(true)
    expect(bulkTicketTypeFor(BOOKABLE)).toBe('tt_member')
  })

  it('rejects a session with no Event Engine configuration', () => {
    expect(isBulkBookable(UNWIRED)).toBe(false)
    expect(bulkTicketTypeFor(UNWIRED)).toBe('')
  })

  it('rejects a session that is not available even when fully wired', () => {
    expect(isBulkBookable({ ...BOOKABLE, status: 'sold_out' })).toBe(false)
    expect(isBulkBookable({ ...BOOKABLE, status: 'cancelled' })).toBe(false)
    // Ref 74c. The gate is an ALLOW-LIST, so a new status is non-bookable the day it is
    // added rather than the day someone remembers to add it to a deny-list.
    expect(isBulkBookable({ ...BOOKABLE, status: 'closed' })).toBe(false)
  })

  it('rejects a session with an event id but no ticket type', () => {
    expect(
      isBulkBookable({
        ...BOOKABLE,
        member_ticket_type_id: '',
        non_member_ticket_type_id: '',
      })
    ).toBe(false)
  })

  it('honours the use_event_engine editorial switch over stale identifiers', () => {
    // A row routed back to its legacy registration flow can keep its Worker and
    // ticket ids — the switch, not the leftovers, decides.
    expect(isBulkBookable({ ...BOOKABLE, use_event_engine: false })).toBe(false)
    expect(isBulkBookable({ ...BOOKABLE, use_event_engine: undefined })).toBe(false)
  })

  it('falls back to the public ticket type when no member type is configured', () => {
    expect(bulkTicketTypeFor({ ...BOOKABLE, member_ticket_type_id: '' })).toBe('tt_public')
  })

  it('is safe on an undefined session', () => {
    expect(isBulkBookable(undefined)).toBe(false)
    expect(bulkTicketTypeFor(undefined)).toBe('')
  })
})

describe('BulkRegisterPanel — self-service booking', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage?.clear()
  })

  it('books the whole group through the corporate bulk endpoint', async () => {
    const fetchMock = mockReserve(
      { status: 'reserved', orderId: 'o1' },
      { paymentUrl: 'https://invoice.example/pay/1' }
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    selectEmployee('Sam Rivers')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const reserveCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/bulk-register'))!
    expect(reserveCall[0]).toBe('https://w.example.com/api/v1/corporate/bulk-register')
    expect(reserveCall[1].headers['X-Portal-Id']).toBe('441838610')
    expect(reserveCall[1].headers['Idempotency-Key']).toBeTruthy()

    const sent = JSON.parse(reserveCall[1].body)
    // The browser sends IDs only; the Worker re-reads HubSpot to verify
    // admin authority and turn the selected employees into attendees.
    expect(sent.portalId).toBe('441838610')
    expect(sent.companyId).toBe('1234567')
    expect(sent.actorContactId).toBe('999')
    expect(sent.sessionId).toBe('42')
    expect(sent.workerEventId).toBe('evt_cert10_online')
    expect(sent.ticketTypeId).toBe('tt_member')
    expect(sent.employeeIds).toEqual(['111', '222'])
  })

  it('surfaces the group invoice link once the order settles', async () => {
    vi.stubGlobal(
      'fetch',
      mockReserve({ status: 'reserved', orderId: 'o1' }, { paymentUrl: 'https://invoice.example/pay/1' })
    )

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    const link = await screen.findByRole('link', { name: /pay the invoice/i })
    expect(link).toHaveAttribute('href', 'https://invoice.example/pay/1')
  })

  it('fires the corporate_bulk_registration GTM event on success (CLAUDE.md §10.3)', async () => {
    vi.stubGlobal('fetch', mockReserve({ status: 'confirmed', orderId: 'o2' }))
    const dataLayer: Array<Record<string, unknown>> = []
    ;(window as unknown as { dataLayer: unknown[] }).dataLayer = dataLayer

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    selectEmployee('Sam Rivers')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    await waitFor(() =>
      expect(dataLayer.some((e) => e.event === 'corporate_bulk_registration')).toBe(true)
    )
    const pushed = dataLayer.find((e) => e.event === 'corporate_bulk_registration')!
    expect(pushed).toMatchObject({
      company_id: '1234567',
      course_id: '42',
      employee_count: 2,
      failed_count: 0,
    })
  })

  it('does not poll for an invoice on a free (confirmed) booking', async () => {
    const fetchMock = mockReserve({ status: 'confirmed', orderId: 'o2' })
    vi.stubGlobal('fetch', fetchMock)

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/orders/'))).toHaveLength(0)
  })

  it('treats waitlisting as a terminal success and clears the selection', async () => {
    vi.stubGlobal('fetch', mockReserve({ status: 'waitlisted' }))

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    // The group IS on the waitlist — that is an outcome, not a failure, so it
    // must not render in the error region.
    expect(await screen.findByText(/added to the waitlist/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Selection cleared, so reading the notice as a failure cannot produce a
    // duplicate waitlist entry on resubmit.
    expect(screen.getByRole('checkbox', { name: /Mel Anthony/i })).not.toBeChecked()
  })

  it('does not claim success when a paid reservation comes back without an order id', async () => {
    vi.stubGlobal('fetch', mockReserve({ status: 'reserved' }))

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/lost track of the order/i)
  })

  it('reports an expired hold as a failure, not a registration', async () => {
    vi.stubGlobal(
      'fetch',
      mockReserve({ status: 'reserved', orderId: 'o1' }, { status: 'expired' })
    )

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i)
    expect(screen.queryByRole('link', { name: /pay the invoice/i })).not.toBeInTheDocument()
  })

  it('says the place is held when the invoice is still settling', async () => {
    // Order resolves with neither a paymentUrl nor an expiry — the hold stands,
    // but there is nothing to pay yet. The poll exhausts its bounded attempts,
    // so drive it with fake timers rather than waiting ~30s of real time.
    vi.stubGlobal('fetch', mockReserve({ status: 'reserved', orderId: 'o1' }, { status: 'pending' }))
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      render(<CorporateAdmin {...baseProps()} />)
      selectSession('42')
      selectEmployee('Mel Anthony')
      fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

      // 10 attempts at 3s.
      await vi.advanceTimersByTimeAsync(35_000)

      expect(screen.getByText(/place is held/i)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the idempotency key after an ambiguous transport failure', async () => {
    // The POST may have committed before the response was lost. Reusing the key
    // makes the Worker replay its stored answer instead of double-booking.
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))
    await screen.findByRole('alert')

    const firstKey = fetchMock.mock.calls[0]![1].headers['Idempotency-Key']
    expect(firstKey).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![1].headers['Idempotency-Key']).toBe(firstKey)
  })

  it('retires the idempotency key after a definite Worker rejection', async () => {
    const fetchMock = mockReserve({ status: 'members_only' })
    vi.stubGlobal('fetch', fetchMock)

    render(<CorporateAdmin {...baseProps()} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))
    await screen.findByRole('alert')

    const firstKey = fetchMock.mock.calls[0]![1].headers['Idempotency-Key']

    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    // Nothing was created, so the retry is a genuinely new submission.
    expect(fetchMock.mock.calls[1]![1].headers['Idempotency-Key']).not.toBe(firstKey)
  })

  it('blocks a booking that would exceed the voucher allocation', async () => {
    const fetchMock = mockReserve({ status: 'reserved', orderId: 'o1' })
    vi.stubGlobal('fetch', fetchMock)

    // 1 voucher left, 2 employees selected.
    render(<CorporateAdmin {...baseProps({ vouchers_total: 10, vouchers_used: 9 })} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    selectEmployee('Sam Rivers')

    // The over-allocation is refused at the control, not after a round trip:
    // the submit button is disabled and the shortfall is named inline.
    const submit = screen.getByRole('button', { name: /register selected/i })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/exceeds available vouchers/i)).toHaveTextContent(/\(1\)/)

    fireEvent.click(submit)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a booking that exactly consumes the remaining vouchers', () => {
    render(<CorporateAdmin {...baseProps({ vouchers_total: 10, vouchers_used: 8 })} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    selectEmployee('Sam Rivers')

    expect(screen.getByRole('button', { name: /register selected/i })).not.toBeDisabled()
  })

  it('does not meter bookings when no voucher allocation is configured', () => {
    render(<CorporateAdmin {...baseProps({ vouchers_total: 0, vouchers_used: 0 })} />)
    selectSession('42')
    selectEmployee('Mel Anthony')
    selectEmployee('Sam Rivers')

    expect(screen.getByRole('button', { name: /register selected/i })).not.toBeDisabled()
  })

  it('refuses to book an employee with no email rather than failing the batch', async () => {
    const fetchMock = mockReserve({ status: 'reserved', orderId: 'o1' })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <CorporateAdmin
        {...baseProps({
          employees: [{ id: '333', name: 'No Email', email: '', membership_tier: '' }],
        })}
      />
    )
    selectSession('42')
    selectEmployee('No Email')
    fireEvent.click(screen.getByRole('button', { name: /register selected/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no email address/i))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('BulkRegisterPanel — mailto fallback', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('falls back to emailing the office when no session is Event-Engine-backed', () => {
    render(<CorporateAdmin {...baseProps({ course_sessions: [UNWIRED] })} />)
    expect(screen.getByRole('link', { name: /email office to register/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /register selected/i })).not.toBeInTheDocument()
  })

  it('falls back when the theme has no Worker base URL configured', () => {
    render(<CorporateAdmin {...baseProps({ worker_base_url: '' })} />)
    expect(screen.getByRole('link', { name: /email office to register/i })).toBeInTheDocument()
  })

  it('still offers self-service when HubL cannot serialise the admin email', () => {
    render(<CorporateAdmin {...baseProps({ actor_email: '' })} />)
    expect(screen.getByRole('button', { name: /register selected/i })).toBeInTheDocument()
  })

  it('explains itself when a bookable session exists but an unwired one is chosen', async () => {
    const fetchMock = mockReserve({ status: 'reserved', orderId: 'o1' })
    vi.stubGlobal('fetch', fetchMock)

    render(<CorporateAdmin {...baseProps({ course_sessions: [BOOKABLE, UNWIRED] })} />)
    selectSession('43')
    selectEmployee('Mel Anthony')
    fireEvent.click(screen.getByRole('link', { name: /email office to register/i }))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('write gating is independent of bulk booking', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('hides remove actions for corporate admin contacts', () => {
    render(
      <CorporateAdmin
        {...baseProps({
          employees: [
            {
              id: '999',
              name: 'Dana Admin',
              email: 'dana@abc.com.au',
              membership_tier: 'Corporate',
              is_admin: true,
            },
            EMPLOYEES[1]!,
          ],
        })}
      />
    )

    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request removal of dana admin/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /request removal of sam rivers/i })).toBeInTheDocument()
  })

  it('keeps add/remove on mailto while bulk booking is self-service', () => {
    // Without corporate_writes_via_proxy / action token, add/remove stay on
    // mailto — but bulk booking must still be self-service (independent gates).
    render(<CorporateAdmin {...baseProps()} />)

    expect(screen.getByRole('button', { name: /register selected/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^add employee$/i })).not.toBeInTheDocument()
  })
})
