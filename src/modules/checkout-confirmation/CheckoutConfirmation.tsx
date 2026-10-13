/**
 * CheckoutConfirmation - post-payment receipt page.
 *
 * Reads checkout receipt data from sessionStorage (written by CheckoutTunnel
 * before the payment redirect) and presents:
 *   • Receipt summary (course, dates, location, amount paid)
 *   • Add to calendar (.ics download, generated client-side)
 *   • Zoom join link (if present in the receipt)
 *   • Next step CTA (editor-configured)
 *
 * See CLAUDE.md §6.7 and docs/02-module-catalog.md §4.9 for spec.
 */

import React, { useEffect, useState } from 'react'
import { formatCurrencyDollars } from '@shared/utils/formatCurrency'
import { formatDateRange } from '@shared/utils/formatDate'
import { CHECKOUT_STORAGE_KEY, type CheckoutReceipt } from '../checkout-tunnel/checkoutReceipt'
import './CheckoutConfirmation.css'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckoutConfirmationProps {
  heading: string
  body: string
  show_calendar_buttons: boolean
  show_zoom_link: boolean
  next_step_cta_label: string
  next_step_cta_link: string
}

function getReceiptType(receipt: CheckoutReceipt): 'course' | 'event' {
  return receipt.registration_type === 'event' ? 'event' : 'course'
}

function getReceiptLabel(receipt: CheckoutReceipt): string {
  return getReceiptType(receipt) === 'event' ? 'Event' : 'Course'
}

// ─── ICS generation ──────────────────────────────────────────────────────────

function toICSDate(isoString: string): string {
  // Convert 'YYYY-MM-DD' → 'YYYYMMDD' for ICS all-day event
  return isoString.replace(/-/g, '')
}

function addOneDay(isoDate: string): string {
  const next = new Date(new Date(isoDate).getTime() + 86400000).toISOString().split('T')[0]
  return next ?? isoDate
}

function generateICS(receipt: CheckoutReceipt): string {
  const now = new Date()
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

  const summary = receipt.course_name
  const location = receipt.city
  const startDate = toICSDate(receipt.start_date)
  // ICS all-day DTEND is exclusive, so add one day
  const endDate = toICSDate(addOneDay(receipt.end_date))

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Weld Australia//Checkout//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:wa-checkout-${stamp}@weldaustralia.com.au`,
    `DTSTAMP:${stamp}Z`,
    `DTSTART;VALUE=DATE:${startDate}`,
    `DTEND;VALUE=DATE:${endDate}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:Your registration for ${summary} in ${location}.`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.join('\r\n')
}

function downloadICS(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ─── Google Calendar URL helper ───────────────────────────────────────────────

function buildGoogleCalendarUrl(receipt: CheckoutReceipt): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: receipt.course_name,
    dates: `${toICSDate(receipt.start_date)}/${toICSDate(addOneDay(receipt.end_date))}`,
    details: `Your registration for ${receipt.course_name} in ${receipt.city}.`,
    location: receipt.city,
  })
  return `https://www.google.com/calendar/render?${params.toString()}`
}

// ─── Receipt card ─────────────────────────────────────────────────────────────

function ReceiptCard({ receipt }: { receipt: CheckoutReceipt }): React.ReactElement {
  return (
    <div className="wa-confirmation-receipt">
      <dl className="wa-confirmation-receipt__details">
        <div className="wa-confirmation-receipt__row">
          <dt>{getReceiptLabel(receipt)}</dt>
          <dd>{receipt.course_name}</dd>
        </div>
        <div className="wa-confirmation-receipt__row">
          <dt>Location</dt>
          <dd>{receipt.city}</dd>
        </div>
        <div className="wa-confirmation-receipt__row">
          <dt>Dates</dt>
          <dd>{formatDateRange(receipt.start_date, receipt.end_date)}</dd>
        </div>
        <div className="wa-confirmation-receipt__row">
          <dt>Registered as</dt>
          <dd>
            {receipt.purchaser_name}
            {receipt.purchaser_email && ` (${receipt.purchaser_email})`}
          </dd>
        </div>
        <div className="wa-confirmation-receipt__row wa-confirmation-receipt__row--total">
          <dt>Amount paid</dt>
          <dd>
            {formatCurrencyDollars(receipt.amount_paid)} ex GST
            {receipt.is_member_price && (
              <span className="wa-confirmation-receipt__member-badge">Member rate</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}

// ─── Calendar buttons ─────────────────────────────────────────────────────────

function CalendarButtons({ receipt }: { receipt: CheckoutReceipt }): React.ReactElement {
  function handleICSDownload() {
    const filename = `${receipt.course_name.replace(/\s+/g, '-').toLowerCase()}.ics`
    downloadICS(filename, generateICS(receipt))
  }

  return (
    <div className="wa-confirmation-calendar">
      <p className="wa-confirmation-calendar__label">Add to your calendar</p>
      <div className="wa-confirmation-calendar__buttons">
        <button
          type="button"
          className="wa-btn wa-btn--secondary"
          onClick={handleICSDownload}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Apple / Outlook (.ics)
        </button>
        <a
          href={buildGoogleCalendarUrl(receipt)}
          target="_blank"
          rel="noopener noreferrer"
          className="wa-btn wa-btn--secondary"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          Google Calendar
        </a>
      </div>
    </div>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

export function CheckoutConfirmation({
  heading,
  body,
  show_calendar_buttons,
  show_zoom_link,
  next_step_cta_label,
  next_step_cta_link,
}: CheckoutConfirmationProps): React.ReactElement {
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CHECKOUT_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as CheckoutReceipt
        setReceipt(parsed)
        // Clear after reading so a page refresh shows the same data once
        // but a new checkout starts fresh
      }
    } catch {
      // sessionStorage unavailable or corrupt - render with editor content only
    }
  }, [])

  return (
    <div className="wa-confirmation container">
      <div className="wa-confirmation__inner">
        {/* Success icon */}
        <div className="wa-confirmation__icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <h1 className="wa-confirmation__heading">{heading || "You're registered"}</h1>

        {body && (
          <div
            className="wa-confirmation__body"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}

        {receipt && <ReceiptCard receipt={receipt} />}

        {show_zoom_link && receipt?.zoom_link && (
          <div className="wa-confirmation-zoom">
            <p className="wa-confirmation-zoom__label">Join online</p>
            <a
              href={receipt.zoom_link}
              target="_blank"
              rel="noopener noreferrer"
              className="wa-btn wa-btn--primary"
            >
              Join Zoom session
            </a>
            <p className="wa-confirmation-zoom__note">
              This link will also be emailed to you.
            </p>
          </div>
        )}

        {show_calendar_buttons && receipt && <CalendarButtons receipt={receipt} />}

        {next_step_cta_link && (
          <div className="wa-confirmation__cta">
            <a href={next_step_cta_link} className="wa-btn wa-btn--secondary">
              {next_step_cta_label || 'Back to dashboard'}
            </a>
          </div>
        )}

        {!receipt && (
          <p className="wa-confirmation__no-receipt">
            A confirmation email has been sent to your inbox with full registration details.
          </p>
        )}
      </div>
    </div>
  )
}
