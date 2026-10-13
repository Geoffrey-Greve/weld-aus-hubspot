/**
 * CorporateAdmin - Manage My Team panel for Primary Admin contacts.
 *
 * Renders inside the member portal's Manage my team panel
 * (`/portal#portal-team`).
 *
 * See CLAUDE.md §6.6 for the full spec.
 *
 * Auth note:
 *   Add/remove employee are CRM association writes and go through
 *   `postCorporateAction` — same-origin `/_hcms/api/corporate/*` Design Manager
 *   serverless (`credentials: 'same-origin'`) or a short-lived Worker-verifiable
 *   `corporate_action_token`. Caller-controlled contact/company IDs are never
 *   treated as authentication.
 *
 *   Bulk booking posts to the Event Engine corporate endpoint, which verifies
 *   the admin and selected employees server-side before reusing the same atomic
 *   reservation/payment flow as public checkout. Gated per-session on Event
 *   Engine configuration, not on the add/remove write proxy.
 */

import React, { useState, useCallback, useMemo } from 'react'
import { pushDataLayer } from '@shared/api/events'
import {
  pollOrder,
  getIdempotencyKey,
  clearIdempotencyKey,
  friendlyReserveError,
  isReservationExpired,
  RESERVATION_EXPIRED_MESSAGE,
  TRANSPORT_ERROR_STATUS,
  SERVER_ERROR_STATUS,
  type EventEngineConfig,
  type ReserveResponse,
} from '@shared/api/eventEngine'
import type { HubdbStatus } from '@shared/status/sessionStatus'
import { postCorporateAction } from './corporateApi'
import './CorporateAdmin.css'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Employee {
  id: string
  name: string
  email: string
  membership_tier: string
  /** True when this contact has the corporate Admin association for the company. */
  is_admin?: boolean
}

export interface CourseSession {
  id: string
  course_name: string
  city: string
  start_date: string
  /**
   * The HubDB status column, slugged by HubL. Every gate below is an ALLOW-LIST
   * (`=== 'available'`) rather than a deny-list, which is why Ref 74c's `closed` needed no
   * code change here to stop being bulk-bookable — and why a status this build has never
   * heard of can only ever make a session un-bookable, never bookable.
   */
  status: HubdbStatus
  /** HubDB `use_event_engine` — routes registration through the Event Engine. */
  use_event_engine?: boolean
  /** Event Engine event id. Its presence is what makes a session bulk-bookable. */
  worker_event_id?: string
  member_ticket_type_id?: string
  non_member_ticket_type_id?: string
}

/**
 * A session can be bulk-booked when the Event Engine can take the whole group:
 * an event id plus a ticket type to seat them on. Corporate employees book at
 * the member rate, falling back to the public ticket type only if a session was
 * configured without a member one.
 */
export function bulkTicketTypeFor(session: CourseSession | undefined): string {
  if (!session) return ''
  return session.member_ticket_type_id || session.non_member_ticket_type_id || ''
}

export function isBulkBookable(session: CourseSession | undefined): boolean {
  if (!session) return false
  if (session.status !== 'available') return false
  // `use_event_engine` is the editorial opt-in. A row can retain stale Worker and
  // ticket ids after being deliberately routed back to its legacy registration
  // flow, so the identifiers alone must not re-enable self-service booking.
  if (!session.use_event_engine) return false
  return Boolean(session.worker_event_id && bulkTicketTypeFor(session))
}

export interface CorporateAdminProps {
  portal_id: string
  /** Logged-in admin contact id from HubL — display/analytics only, never auth. */
  actor_contact_id: string
  /** Logged-in admin's name/email. Kept available from HubL for display/future use. */
  actor_name?: string
  actor_email?: string
  company_id: string
  company_name: string
  vouchers_total: number
  vouchers_used: number
  employees: Employee[]
  employees_capped?: boolean
  course_sessions: CourseSession[]
  add_employee_form_url: string
  team_page_url: string
  /** Office inbox that fulfils team-management requests until the backend exists. */
  office_email?: string
  /**
   * Event Engine worker base URL. Only used together with `corporate_action_token`
   * for authenticated Worker-direct writes. Unauthenticated browser→Worker calls
   * are not supported.
   */
  worker_base_url?: string
  /**
   * Short-lived Worker-verifiable token minted server-side for this admin session.
   * When set with `worker_base_url`, enables authenticated Worker-direct writes.
   */
  corporate_action_token?: string
  /**
   * Opt-in for same-origin `/_hcms/api/corporate/*` serverless writes.
   * When false (and no action token), the UI falls back to mailto.
   */
  corporate_writes_via_proxy?: boolean
}

const DEFAULT_OFFICE_EMAIL = 'office@weldaustralia.com.au'

interface AddEmployeeFormState {
  firstName: string
  lastName: string
  email: string
  jobTitle: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mailtoHref(email: string, subject: string, bodyLines: string[]): string {
  const subjectPart = encodeURIComponent(subject)
  const bodyPart = encodeURIComponent(bodyLines.join('\n'))
  return `mailto:${email}?subject=${subjectPart}&body=${bodyPart}`
}

async function postCorporateBulkRegistration(
  cfg: EventEngineConfig,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<ReserveResponse> {
  const url = `${cfg.workerBaseUrl.replace(/\/$/, '')}/api/v1/corporate/bulk-register`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Id': cfg.portalId,
        'Idempotency-Key': idempotencyKey,
      },
      credentials: 'omit',
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      status: TRANSPORT_ERROR_STATUS,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const text = await response.text().catch(() => '')
  try {
    return JSON.parse(text) as ReserveResponse
  } catch {
    return {
      status: SERVER_ERROR_STATUS,
      httpStatus: response.status,
      rawBody: text.slice(0, 500),
    }
  }
}

// ─── VoucherTracker ───────────────────────────────────────────────────────────

function VoucherTracker({
  total,
  used,
}: {
  total: number
  used: number
}): React.ReactElement {
  if (total <= 0) {
    return (
      <div className="wa-ca__vouchers">
        <div className="wa-ca__vouchers-header">
          <span className="wa-ca__vouchers-label">Training vouchers</span>
          <span className="wa-ca__vouchers-count">
            <strong>On request</strong>
          </span>
        </div>
        <div
          className="wa-ca__vouchers-bar"
          role="progressbar"
          aria-valuenow={0}
          aria-valuemin={0}
          aria-valuemax={0}
          aria-label="Training vouchers are managed by arrangement"
        >
          <div className="wa-ca__vouchers-fill" style={{ width: '0%' }} />
        </div>
      </div>
    )
  }

  const remaining = Math.max(0, total - used)
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const isNearLimit = remaining <= 2 && total > 0

  return (
    <div className="wa-ca__vouchers">
      <div className="wa-ca__vouchers-header">
        <span className="wa-ca__vouchers-label">Training vouchers</span>
        <span className="wa-ca__vouchers-count">
          <strong>{remaining}</strong> of {total} remaining
        </span>
      </div>
      <div
        className="wa-ca__vouchers-bar"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${used} of ${total} vouchers used`}
      >
        <div
          className={[
            'wa-ca__vouchers-fill',
            isNearLimit ? 'wa-ca__vouchers-fill--warning' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isNearLimit && (
        <p className="wa-ca__vouchers-warning" role="status">
          {remaining === 0
            ? 'All vouchers have been used. Contact us to purchase more.'
            : `Only ${remaining} voucher${remaining === 1 ? '' : 's'} remaining.`}
        </p>
      )}
    </div>
  )
}

// ─── TeamMembersPanel ─────────────────────────────────────────────────────────
// Issue 8: view the company's linked team members and request removals.

interface TeamMembersPanelProps {
  companyName: string
  companyId: string
  employees: Employee[]
  employeesCapped: boolean
  officeEmail: string
  selfServiceEnabled: boolean
  removingEmployeeId: string
  onRemoveEmployee: (employee: Employee) => void
}

function TeamMembersPanel({
  companyName,
  companyId,
  employees,
  employeesCapped,
  officeEmail,
  selfServiceEnabled,
  removingEmployeeId,
  onRemoveEmployee,
}: TeamMembersPanelProps): React.ReactElement {
  return (
    <section id="team-members" className="wa-ca__team" aria-labelledby="wa-ca-team-heading">
      <h3 id="wa-ca-team-heading" className="wa-ca__section-heading">
        Team members ({employees.length})
      </h3>
      <p className="wa-ca__section-note">
        These are the contacts linked to your corporate membership. You can remove non-admin
        team members here and add employees directly from this page.
      </p>

      {employees.length === 0 ? (
        <p className="wa-ca__team-empty">No team members are linked to your account yet.</p>
      ) : (
        <ul className="wa-ca__team-list" role="list">
          {employees.map((emp) => (
            <li key={emp.id} className="wa-ca__team-row">
              <div className="wa-ca__team-info">
                <span className="wa-ca__team-name">{emp.name || emp.email}</span>
                <span className="wa-ca__team-email">{emp.email}</span>
                {emp.membership_tier && (
                  <span className="wa-ca__team-tier">{emp.membership_tier}</span>
                )}
                {emp.is_admin && <span className="wa-ca__team-admin-badge">Admin</span>}
              </div>
              {!emp.is_admin && (
                <button
                  type="button"
                  className="wa-btn wa-btn--ghost wa-btn--sm wa-ca__team-remove"
                onClick={() => {
                  if (selfServiceEnabled) {
                    onRemoveEmployee(emp)
                    return
                  }
                  window.location.href = mailtoHref(officeEmail, `Remove team member - ${companyName}`, [
                  `Company: ${companyName} (ID ${companyId})`,
                  `Please remove the following team member from our corporate membership:`,
                  `  • ${emp.name || 'Team member'} <${emp.email}>`,
                  '',
                  'We understand their contact record is retained in case they rejoin.',
                  ])
                }}
                disabled={removingEmployeeId === emp.id}
                aria-label={`Request removal of ${emp.name || emp.email}`}
              >
                {removingEmployeeId === emp.id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {employeesCapped && (
        <p className="wa-ca__team-capped" role="status">
          Showing the first 250 team members. If your team is larger, contact the office for a full list.
        </p>
      )}
    </section>
  )
}

interface AddEmployeePanelProps {
  values: AddEmployeeFormState
  error: string
  isSubmitting: boolean
  onChange: (field: keyof AddEmployeeFormState, value: string) => void
  onCancel: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}

function AddEmployeePanel({
  values,
  error,
  isSubmitting,
  onChange,
  onCancel,
  onSubmit,
}: AddEmployeePanelProps): React.ReactElement {
  return (
    <form className="wa-ca__add-panel" onSubmit={onSubmit} noValidate>
      <div className="wa-ca__add-panel-header">
        <div>
          <h3 className="wa-ca__section-heading">Add team member</h3>
          <p className="wa-ca__section-note">
            Add an employee directly to this corporate membership. If the email already exists in
            Weld Australia records, we’ll link that existing contact instead of creating a duplicate.
          </p>
        </div>
        <button
          type="button"
          className="wa-ca__icon-button"
          onClick={onCancel}
          aria-label="Close add employee form"
          disabled={isSubmitting}
        >
          ×
        </button>
      </div>

      <div className="wa-ca__add-grid">
        <div className="wa-field">
          <label htmlFor="wa-ca-add-first-name">First name</label>
          <input
            id="wa-ca-add-first-name"
            type="text"
            value={values.firstName}
            onChange={(event) => onChange('firstName', event.target.value)}
            autoComplete="given-name"
            required
          />
        </div>
        <div className="wa-field">
          <label htmlFor="wa-ca-add-last-name">Last name</label>
          <input
            id="wa-ca-add-last-name"
            type="text"
            value={values.lastName}
            onChange={(event) => onChange('lastName', event.target.value)}
            autoComplete="family-name"
            required
          />
        </div>
        <div className="wa-field">
          <label htmlFor="wa-ca-add-email">Email address</label>
          <input
            id="wa-ca-add-email"
            type="email"
            value={values.email}
            onChange={(event) => onChange('email', event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div className="wa-field">
          <label htmlFor="wa-ca-add-job-title">Job title <span>(optional)</span></label>
          <input
            id="wa-ca-add-job-title"
            type="text"
            value={values.jobTitle}
            onChange={(event) => onChange('jobTitle', event.target.value)}
            autoComplete="organization-title"
          />
        </div>
      </div>

      {error && (
        <p className="wa-ca__error" role="alert">{error}</p>
      )}

      <div className="wa-ca__add-actions">
        <button
          type="button"
          className="wa-btn wa-btn--ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button type="submit" className="wa-btn wa-btn--primary" disabled={isSubmitting}>
          {isSubmitting ? 'Adding…' : 'Add employee'}
        </button>
      </div>
    </form>
  )
}

// ─── BulkRegisterPanel ────────────────────────────────────────────────────────

interface BulkRegisterPanelProps {
  portalId: string
  companyId: string
  companyName: string
  actorContactId: string
  employees: Employee[]
  sessions: CourseSession[]
  vouchersRemaining: number
  vouchersMetered: boolean
  officeEmail: string
  workerBaseUrl?: string
  onRegistered: (result: {
    sessionId: string
    registeredCount: number
    failedCount: number
    vouchersUsed?: number
  }) => void
}

function BulkRegisterPanel({
  portalId,
  companyId,
  companyName,
  actorContactId,
  employees,
  sessions,
  vouchersRemaining,
  vouchersMetered,
  officeEmail,
  workerBaseUrl,
  onRegistered,
}: BulkRegisterPanelProps): React.ReactElement {
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paymentUrl, setPaymentUrl] = useState('')
  /**
   * Outcomes that are neither a failure nor a completed-and-payable booking:
   * waitlisted, or reserved-but-the-invoice-is-still-settling. Kept apart from
   * `error` so they are not styled or announced as failures.
   */
  const [infoMessage, setInfoMessage] = useState('')

  const availableSessions = sessions.filter((s) => s.status === 'available')
  const selectedSession = availableSessions.find((s) => s.id === selectedSessionId)

  /**
   * Self-service booking is decided per session, not globally: it needs an Event
   * Engine event + ticket type, a verified admin contact id, and a Worker to call.
   * Anything else keeps the mailto fallback.
   */
  const canBookSelected = Boolean(
    workerBaseUrl && actorContactId && portalId && isBulkBookable(selectedSession)
  )
  const anySessionBookable = Boolean(
    workerBaseUrl && actorContactId && portalId && availableSessions.some(isBulkBookable)
  )

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    setSelectedEmployeeIds((prev) =>
      prev.size === employees.length ? new Set() : new Set(employees.map((e) => e.id))
    )
  }

  const exceedsVouchers = vouchersMetered && selectedEmployeeIds.size > vouchersRemaining

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setPaymentUrl('')
    setInfoMessage('')

    if (!selectedSessionId) {
      setError('Please select a course session.')
      return
    }
    if (selectedEmployeeIds.size === 0) {
      setError('Please select at least one employee.')
      return
    }
    if (exceedsVouchers) {
      setError(`You only have ${vouchersRemaining} voucher${vouchersRemaining === 1 ? '' : 's'} available.`)
      return
    }
    if (!canBookSelected) {
      setError(
        'This session is not set up for self-service booking yet. Please email the Weld Australia office to register your team.'
      )
      return
    }

    const session = selectedSession as CourseSession
    const eventId = session.worker_event_id as string
    const ticketTypeId = bulkTicketTypeFor(session)
    const selected = employees.filter((emp) => selectedEmployeeIds.has(emp.id))

    // An employee with no email cannot be seated — the Worker keys registrations
    // on it. Surface them up front rather than letting the whole batch 400.
    const missingEmail = selected.filter((emp) => !emp.email)
    if (missingEmail.length > 0) {
      setError(
        `${missingEmail.map((emp) => emp.name || 'A team member').join(', ')} ` +
          `${missingEmail.length === 1 ? 'has' : 'have'} no email address on file and cannot be booked. ` +
          'Please email the Weld Australia office to add one.'
      )
      return
    }

    const config: EventEngineConfig = { workerBaseUrl: workerBaseUrl as string, portalId }
    const selectedIds = Array.from(selectedEmployeeIds).sort()
    // One stable key per event + selected employees, so a double-click or a retry
    // of the SAME logical submission cannot create a second group order.
    const idempotencyScope = `${eventId}:corporate:${selectedIds.join(',')}`
    const idempotencyKey = getIdempotencyKey(idempotencyScope)
    setIsSubmitting(true)

    try {
      const result = await postCorporateBulkRegistration(
        config,
        {
          portalId,
          companyId,
          actorContactId,
          sessionId: selectedSessionId,
          workerEventId: eventId,
          ticketTypeId,
          employeeIds: selectedIds,
          session: {
            courseName: session.course_name,
            city: session.city,
            startDate: session.start_date,
          },
        },
        idempotencyKey
      )

      const registeredCount = selected.length
      // Every terminal outcome clears the selection so the form cannot be
      // resubmitted into a duplicate booking.
      const finish = (): void => {
        setSelectedEmployeeIds(new Set())
        setSelectedSessionId('')
      }

      switch ((result.status || '').toLowerCase()) {
        case 'reserved': {
          // Paid: the Worker is raising an invoice asynchronously. Mirrors
          // checkout-tunnel's reserved branch — the distinctions below are the
          // difference between "booked" and "we lost your order".
          const orderId = result.orderId || (result.pollUrl || '').split('/').pop() || ''
          if (!orderId) {
            clearIdempotencyKey(idempotencyScope)
            setError(
              'Your team is reserved, but we lost track of the order. Please contact the Weld Australia office before booking again.'
            )
            return
          }

          // Bounded tighter than checkout's default (~30s, not ~2min): the seats
          // are already held, so a slow invoice should not hold the button.
          const order = await pollOrder(config, orderId, { maxAttempts: 10 })

          if (order.paymentUrl) {
            clearIdempotencyKey(idempotencyScope)
            setPaymentUrl(order.paymentUrl)
            finish()
            onRegistered({ sessionId: selectedSessionId, registeredCount, failedCount: 0 })
            return
          }

          if (isReservationExpired(order)) {
            // The hold lapsed before the invoice was raised — nothing is booked,
            // so this must not be reported as a registration.
            clearIdempotencyKey(idempotencyScope)
            setError(RESERVATION_EXPIRED_MESSAGE)
            return
          }

          // Timed out while settling. The hold stands and the invoice email
          // follows, so the booking is real — but there is no payment link to
          // show yet, so say that rather than claiming a completed registration.
          clearIdempotencyKey(idempotencyScope)
          finish()
          setInfoMessage(
            `Your team's place is held. We'll email the invoice for ${registeredCount} ` +
              `booking${registeredCount === 1 ? '' : 's'} shortly.`
          )
          return
        }

        case 'confirmed': {
          // Free session — seats issued immediately, no invoice.
          clearIdempotencyKey(idempotencyScope)
          finish()
          onRegistered({ sessionId: selectedSessionId, registeredCount, failedCount: 0 })
          return
        }

        case 'waitlisted': {
          // A successful terminal outcome, not a failure: the group IS on the
          // waitlist. Clear the selection so an admin reading the notice as an
          // error cannot resubmit into a duplicate waitlist entry.
          clearIdempotencyKey(idempotencyScope)
          finish()
          setInfoMessage(
            'This session is full. Your team has been added to the waitlist and the office will be in touch as places open up.'
          )
          return
        }

        default: {
          // transport_error and server_error are AMBIGUOUS: the POST may have
          // committed and we simply lost the answer. Keep the idempotency key so
          // a retry replays the Worker's stored response instead of minting a
          // second group hold, Deal and invoice. Only a definite Worker rejection
          // means nothing was created and the key can be retired.
          // (Same reasoning as checkout-tunnel's default branch.)
          const outcomeAmbiguous =
            result.status === TRANSPORT_ERROR_STATUS || result.status === SERVER_ERROR_STATUS

          if (outcomeAmbiguous) {
            console.error('[corporate-admin] bulk reserve failed', {
              reason: result.status,
              httpStatus: result.httpStatus,
              rawBody: result.rawBody,
              message: result.message,
              eventId,
              attendeeCount: registeredCount,
            })
          } else {
            clearIdempotencyKey(idempotencyScope)
          }

          setError(friendlyReserveError(result))
          return
        }
      }
    } catch (submitError) {
      // The bulk API helper and pollOrder do not throw, so reaching here means one of our
      // own success-path calls failed. Keep the cause rather than discarding it.
      console.error('[corporate-admin] bulk reserve failed', {
        reason: 'unexpected_client_error',
        eventId,
        error: submitError,
      })
      setError('Something went wrong completing this booking. Please try again.')
      return
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form id="bulk-booking" className="wa-ca__bulk-form" onSubmit={handleSubmit} noValidate>
      <h3 className="wa-ca__bulk-heading">Bulk register employees</h3>
      <p className="wa-ca__section-note">
        {anySessionBookable
          ? 'Select a session and the team members to book. We’ll register everyone in one booking and send a single invoice for the group.'
          : 'Select a session and the team members to book, then email the Weld Australia office to complete registration.'}
      </p>

      {/* Session selector */}
      <div className="wa-field">
        <label htmlFor="wa-ca-session">Course session</label>
        <select
          id="wa-ca-session"
          value={selectedSessionId}
          onChange={(e) => setSelectedSessionId(e.target.value)}
          disabled={isSubmitting}
          required
        >
          <option value="">Select a session…</option>
          {availableSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.course_name} - {s.city} ({s.start_date})
            </option>
          ))}
        </select>
        {availableSessions.length === 0 && (
          <p className="wa-field__hint">No sessions are currently available.</p>
        )}
      </div>

      {/* Employee checkboxes */}
      <fieldset className="wa-ca__employee-select">
        <legend>Select employees to register</legend>
        <div className="wa-ca__employee-select-all">
          <label>
            <input
              type="checkbox"
              checked={selectedEmployeeIds.size === employees.length && employees.length > 0}
              onChange={toggleAll}
              disabled={employees.length === 0 || isSubmitting}
            />
            {' '}Select all ({employees.length})
          </label>
        </div>
        <ul className="wa-ca__employee-list" role="list">
          {employees.map((emp) => (
            <li key={emp.id} className="wa-ca__employee-item">
              <label className="wa-ca__employee-label">
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.has(emp.id)}
                  onChange={() => toggleEmployee(emp.id)}
                  disabled={isSubmitting}
                />
                <span className="wa-ca__employee-name">{emp.name}</span>
                <span className="wa-ca__employee-email">{emp.email}</span>
                {emp.membership_tier && (
                  <span className="wa-ca__employee-tier">{emp.membership_tier}</span>
                )}
              </label>
            </li>
          ))}
          {employees.length === 0 && (
            <li className="wa-ca__employee-empty">
              No employees on your account yet.
            </li>
          )}
        </ul>
      </fieldset>

      {selectedEmployeeIds.size > 0 && (
        <p className="wa-ca__selection-summary" role="status" aria-live="polite">
          {selectedEmployeeIds.size} employee{selectedEmployeeIds.size === 1 ? '' : 's'} selected
          {vouchersMetered && exceedsVouchers && (
            <span className="wa-ca__selection-warning">
              {' '}- exceeds available vouchers ({vouchersRemaining})
            </span>
          )}
        </p>
      )}

      {error && (
        <p className="wa-ca__error" role="alert">{error}</p>
      )}

      {paymentUrl && (
        <p className="wa-ca__success" role="status" aria-live="polite">
          Your team is booked.{' '}
          <a href={paymentUrl} target="_blank" rel="noopener noreferrer">
            Pay the invoice for this booking
          </a>
          .
        </p>
      )}

      {infoMessage && (
        <p className="wa-ca__success" role="status" aria-live="polite">
          {infoMessage}
        </p>
      )}

      {/*
        Before a session is picked we show the self-service button whenever ANY
        session supports it, so the CTA doesn't start as "Email office" and flip
        mid-flow. Picking a session narrows it to that session's real capability;
        handleSubmit re-checks and explains if the chosen one can't be booked.
      */}
      <div className="wa-ca__bulk-actions">
        {canBookSelected || (!selectedSessionId && anySessionBookable) ? (
          <button
            type="submit"
            className="wa-btn wa-btn--primary"
            disabled={isSubmitting || selectedEmployeeIds.size === 0 || exceedsVouchers}
          >
            {isSubmitting
              ? 'Registering…'
              : `Register selected${selectedEmployeeIds.size > 0 ? ` (${selectedEmployeeIds.size})` : ''}`}
          </button>
        ) : (
          <a
            className="wa-btn wa-btn--primary"
            href={mailtoHref(
              officeEmail,
              `Bulk course registration - ${companyName}`,
              [
                `Company: ${companyName} (ID ${companyId})`,
                `Session ID: ${selectedSessionId || '(please choose a session on the portal first)'}`,
                'Please register the following team members:',
                ...employees
                  .filter((emp) => selectedEmployeeIds.has(emp.id))
                  .map((emp) => `  • ${emp.name || 'Team member'} <${emp.email}>`),
              ]
            )}
            aria-disabled={selectedEmployeeIds.size === 0 || !selectedSessionId || exceedsVouchers}
            onClick={(event) => {
              if (selectedEmployeeIds.size === 0 || !selectedSessionId || exceedsVouchers) {
                event.preventDefault()
                setError(
                  !selectedSessionId
                    ? 'Please select a course session.'
                    : selectedEmployeeIds.size === 0
                      ? 'Please select at least one employee.'
                      : `You only have ${vouchersRemaining} voucher${vouchersRemaining === 1 ? '' : 's'} available.`
                )
              }
            }}
          >
            Email office to register
            {selectedEmployeeIds.size > 0 ? ` (${selectedEmployeeIds.size})` : ''}
          </a>
        )}
      </div>
    </form>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

export function CorporateAdmin({
  portal_id,
  actor_contact_id,
  company_id,
  company_name,
  vouchers_total,
  vouchers_used,
  employees,
  employees_capped = false,
  course_sessions,
  add_employee_form_url,
  office_email,
  worker_base_url,
  corporate_action_token,
  corporate_writes_via_proxy = false,
}: CorporateAdminProps): React.ReactElement {
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [teamEmployees, setTeamEmployees] = useState<Employee[]>(employees)
  const [removingEmployeeId, setRemovingEmployeeId] = useState('')
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [addEmployeeForm, setAddEmployeeForm] = useState<AddEmployeeFormState>({
    firstName: '',
    lastName: '',
    email: '',
    jobTitle: '',
  })
  const [addEmployeeError, setAddEmployeeError] = useState('')
  const [isAddingEmployee, setIsAddingEmployee] = useState(false)
  const [voucherUsage, setVoucherUsage] = useState(vouchers_used)

  const officeEmail = office_email || DEFAULT_OFFICE_EMAIL
  const workerBaseUrl = (worker_base_url || '').replace(/\/$/, '')
  const actionToken = (corporate_action_token || '').trim()
  const signedWorkerWrites = Boolean(actionToken && workerBaseUrl)
  /**
   * Add/remove employee require the serverless proxy (or a signed Worker token).
   * Bulk booking is deliberately NOT gated on this — it uses the Event Engine
   * corporate bulk endpoint and performs its own server-side team checks.
   */
  const selfServiceRemoveEnabled = Boolean(
    portal_id && company_id && (signedWorkerWrites || corporate_writes_via_proxy)
  )
  const selfServiceAddEnabled = selfServiceRemoveEnabled
  const vouchersMetered = vouchers_total > 0
  const writeConfig = useMemo(
    () => ({
      portalId: portal_id,
      actorContactId: actor_contact_id,
      actionToken: actionToken || undefined,
      workerBaseUrl: workerBaseUrl || undefined,
    }),
    [actionToken, actor_contact_id, portal_id, signedWorkerWrites, workerBaseUrl]
  )

  const vouchersRemaining = useMemo(
    () => (vouchersMetered ? Math.max(0, vouchers_total - voucherUsage) : Number.POSITIVE_INFINITY),
    [vouchersMetered, vouchers_total, voucherUsage]
  )

  // Add employee: use a configured routable form URL if one was supplied;
  // otherwise fall back to an office request (the default `/portal/team/add-employee`
  // route does not exist yet - issue 8).
  const addEmployeeHref = useMemo(() => {
    const configured = (add_employee_form_url || '').trim()
    const isPlaceholder = !configured || configured === '/portal/team/add-employee'
    if (!isPlaceholder) return configured
    return mailtoHref(officeEmail, `Add a team member - ${company_name}`, [
      `Company: ${company_name} (ID ${company_id})`,
      'Please add the following person to our corporate membership:',
      '  • Name:',
      '  • Email:',
      '  • Job title (optional):',
    ])
  }, [add_employee_form_url, officeEmail, company_name, company_id])

  const employeeCount = teamEmployees.length
  const availableSessionCount = course_sessions.filter((session) => session.status === 'available').length

  const handleAddFormChange = useCallback(
    (field: keyof AddEmployeeFormState, value: string) => {
      setAddEmployeeError('')
      setAddEmployeeForm((current) => ({ ...current, [field]: value }))
    },
    []
  )

  const handleCancelAddEmployee = useCallback(() => {
    if (isAddingEmployee) return
    setShowAddEmployee(false)
    setAddEmployeeError('')
  }, [isAddingEmployee])

  const handleAddEmployee = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!selfServiceAddEnabled || isAddingEmployee) return

      const firstName = addEmployeeForm.firstName.trim()
      const lastName = addEmployeeForm.lastName.trim()
      const email = addEmployeeForm.email.trim().toLowerCase()
      const jobTitle = addEmployeeForm.jobTitle.trim()

      if (!firstName || !lastName || !email) {
        setAddEmployeeError('Please enter the employee name and email address.')
        return
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setAddEmployeeError('Please enter a valid email address.')
        return
      }

      setErrorMessage('')
      setSuccessMessage('')
      setAddEmployeeError('')
      setIsAddingEmployee(true)

      try {
        const { ok, data } = await postCorporateAction<{
          ok?: boolean
          status?: string
          message?: string
          employee?: Employee
        }>(
          'add-employee',
          {
            companyId: company_id,
            firstName,
            lastName,
            email,
            jobTitle,
          },
          writeConfig
        )

        if (!ok || data?.ok === false || !data?.employee) {
          throw new Error(data?.message || 'Unable to add this team member right now.')
        }

        const addedEmployee = data.employee
        setTeamEmployees((current) => {
          const existingIndex = current.findIndex(
            (item) => item.id === addedEmployee.id || item.email.toLowerCase() === addedEmployee.email.toLowerCase()
          )
          if (existingIndex >= 0) {
            return current.map((item, index) => (index === existingIndex ? { ...item, ...addedEmployee } : item))
          }
          return [...current, addedEmployee].sort((a, b) =>
            (a.name || a.email).localeCompare(b.name || b.email)
          )
        })

        pushDataLayer('corporate_team_member_added', {
          company_id,
          contact_id: addedEmployee.id,
          status: data.status || 'linked',
        })

        setAddEmployeeForm({ firstName: '', lastName: '', email: '', jobTitle: '' })
        setShowAddEmployee(false)
        setSuccessMessage(
          data.status === 'already_linked'
            ? `${addedEmployee.name || addedEmployee.email} is already linked to this team.`
            : `${addedEmployee.name || addedEmployee.email} has been added to this team.`
        )
        setTimeout(() => setSuccessMessage(''), 8000)
      } catch (error) {
        setAddEmployeeError(
          error instanceof Error
            ? error.message
            : 'Unable to add this team member right now.'
        )
      } finally {
        setIsAddingEmployee(false)
      }
    },
    [
      addEmployeeForm.email,
      addEmployeeForm.firstName,
      addEmployeeForm.jobTitle,
      addEmployeeForm.lastName,
      company_id,
      isAddingEmployee,
      selfServiceAddEnabled,
      writeConfig,
    ]
  )

  const handleRemoveEmployee = useCallback(
    async (employee: Employee) => {
      if (!selfServiceRemoveEnabled || removingEmployeeId) return

      const confirmed = window.confirm(
        `Remove ${employee.name || employee.email} from ${company_name}?\n\n` +
          'Their contact record will stay in HubSpot, but they will no longer be linked to this corporate team.'
      )
      if (!confirmed) return

      setErrorMessage('')
      setSuccessMessage('')
      setRemovingEmployeeId(employee.id)

      try {
        const { ok, data } = await postCorporateAction<{ ok?: boolean; message?: string }>(
          'remove-employee',
          {
            companyId: company_id,
            employeeId: employee.id,
          },
          writeConfig
        )

        if (!ok || data?.ok === false) {
          throw new Error(data?.message || 'Unable to remove this team member right now.')
        }

        setTeamEmployees((current) => current.filter((item) => item.id !== employee.id))
        setSuccessMessage(`${employee.name || employee.email} has been removed from this team.`)
        setTimeout(() => setSuccessMessage(''), 8000)
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to remove this team member right now.'
        )
      } finally {
        setRemovingEmployeeId('')
      }
    },
    [
      company_id,
      company_name,
      removingEmployeeId,
      selfServiceRemoveEnabled,
      writeConfig,
    ]
  )

  const handleBulkRegistered = useCallback(
    (result: {
      sessionId: string
      registeredCount: number
      failedCount: number
      vouchersUsed?: number
    }) => {
      if (typeof result.vouchersUsed === 'number') {
        setVoucherUsage(result.vouchersUsed)
      } else {
        setVoucherUsage((current) => current + result.registeredCount)
      }
      // Fire GTM event per CLAUDE.md §10.3
      pushDataLayer('corporate_bulk_registration', {
        company_id,
        course_id: result.sessionId,
        employee_count: result.registeredCount,
        failed_count: result.failedCount,
      })

      setSuccessMessage(
        result.failedCount > 0
          ? `${result.registeredCount} employee${result.registeredCount === 1 ? '' : 's'} registered. ` +
              `${result.failedCount} could not be registered.`
          : `${result.registeredCount} employee${result.registeredCount === 1 ? '' : 's'} registered successfully.`
      )

      // Clear message after 10s
      setTimeout(() => setSuccessMessage(''), 10000)
    },
    [company_id]
  )

  return (
    <div className="wa-ca">
      <div className="wa-ca__overview-grid" aria-label="Corporate team summary">
        <article className="wa-ca__overview-card wa-ca__overview-card--team">
          <span className="wa-ca__overview-kicker">Team members</span>
          <strong>{employeeCount}</strong>
          <p>Contacts currently linked to your corporate membership.</p>
        </article>

        <article className="wa-ca__overview-card wa-ca__overview-card--vouchers">
          <span className="wa-ca__overview-kicker">Training vouchers</span>
          <strong>
            {vouchersMetered ? `${vouchersRemaining}/${vouchers_total}` : 'On request'}
          </strong>
          <p>Available balance for team training requests.</p>
        </article>

        <article className="wa-ca__overview-card wa-ca__overview-card--courses">
          <span className="wa-ca__overview-kicker">Available sessions</span>
          <strong>{availableSessionCount}</strong>
          <p>Upcoming course sessions available for bulk booking.</p>
        </article>
      </div>

      <div className="wa-ca__company-card">
        <div className="wa-ca__header">
          <div>
            <span className="wa-ca__label">Corporate account</span>
            <h2 className="wa-ca__company-name">{company_name}</h2>
          </div>
          {selfServiceAddEnabled ? (
            <button
              type="button"
              className="wa-btn wa-btn--secondary wa-ca__add-btn"
              onClick={() => {
                setShowAddEmployee((current) => !current)
                setAddEmployeeError('')
              }}
              aria-expanded={showAddEmployee}
            >
              + Add employee
            </button>
          ) : (
            <a href={addEmployeeHref} className="wa-btn wa-btn--secondary wa-ca__add-btn">
              + Add employee
            </a>
          )}
        </div>

        <VoucherTracker total={vouchers_total} used={voucherUsage} />
      </div>

      {showAddEmployee && selfServiceAddEnabled && (
        <AddEmployeePanel
          values={addEmployeeForm}
          error={addEmployeeError}
          isSubmitting={isAddingEmployee}
          onChange={handleAddFormChange}
          onCancel={handleCancelAddEmployee}
          onSubmit={handleAddEmployee}
        />
      )}

      {successMessage && (
        <div className="wa-ca__success" role="status" aria-live="polite">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="wa-ca__error wa-ca__error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      <TeamMembersPanel
        companyName={company_name}
        companyId={company_id}
        employees={teamEmployees}
        employeesCapped={employees_capped}
        officeEmail={officeEmail}
        selfServiceEnabled={selfServiceRemoveEnabled}
        removingEmployeeId={removingEmployeeId}
        onRemoveEmployee={handleRemoveEmployee}
      />

      {/*
        workerBaseUrl is passed unconditionally here, unlike the add/remove
        write config: group reserve is a public Event Engine endpoint and needs
        no action token, so it must not be withheld when signedWorkerWrites is
        false (which it always is today).
      */}
      <BulkRegisterPanel
        portalId={portal_id}
        companyId={company_id}
        companyName={company_name}
        actorContactId={actor_contact_id}
        employees={teamEmployees}
        sessions={course_sessions}
        vouchersRemaining={vouchersRemaining}
        vouchersMetered={vouchersMetered}
        officeEmail={officeEmail}
        workerBaseUrl={workerBaseUrl || undefined}
        onRegistered={handleBulkRegistered}
      />
    </div>
  )
}

export default CorporateAdmin
