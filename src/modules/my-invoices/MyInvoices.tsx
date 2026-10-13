import React, { useMemo, useState } from 'react'
import {
  gstComponentDollars,
  gstOnExclusiveDollars,
  totalIncGstDollars
} from '@shared/utils/formatCurrency'
import type { InvoiceItem, MyInvoicesProps } from './types'

type TypeFilter = 'all' | string

function parseDateValue(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const text = value.trim()
  if (!text) return null

  if (/^\d+$/.test(text)) {
    const numericValue = Number(text)
    return Number.isFinite(numericValue) ? numericValue : null
  }

  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    const time = new Date(Number(year), Number(month) - 1, Number(day)).getTime()
    return Number.isNaN(time) ? null : time
  }

  const time = new Date(text).getTime()
  return Number.isNaN(time) ? null : time
}

function formatDate(value: string | number | null | undefined): string {
  const time = parseDateValue(value)
  if (time === null) return ''
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(time))
}

function numericValue(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function formatMoney(value: string | number | null | undefined): string {
  const amount = numericValue(value)
  if (amount <= 0) return 'Amount pending'
  return formatAmount(amount)
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount)
}

type TaxBasis = 'inclusive' | 'exclusive'

/**
 * Ref 214: GST must be shown separately on the invoice, not just at checkout.
 *
 * The two sources feeding this list record their money the opposite way round,
 * and reading both as tax-inclusive understated every Deal-sourced row:
 *
 * - A HubSpot Invoice row's `hs_amount_billed` IS the total. HubSpot applies the
 *   portal's tax rate on top of ex-tax line items, so the GST is already inside
 *   the figure and the component is total / 11.
 * - A Deal's `amount` is EX GST (confirmed by Ollie), like every HubDB course
 *   price on this site. A $585 course was shown as $585 paid with $53.18 of GST
 *   in it; the member was charged $585 + $58.50 = $643.50.
 *
 * So each row is grossed up to what was actually charged, and the card keeps one
 * headline number with the GST it contains - the same shape the checkout tunnel
 * lands on at step 5.
 */
export function taxBasisOf(invoice: Pick<InvoiceItem, 'tax_basis'>): TaxBasis {
  // Absent means inclusive: that is how every row was read before `tax_basis`
  // existed, so an unflagged row renders exactly as it did rather than jumping
  // 10% on a stale render.
  return invoice.tax_basis === 'exclusive' ? 'exclusive' : 'inclusive'
}

/** What the member was actually charged, whichever way the row records it. */
export function amountIncGst(value: string | number | null | undefined, basis: TaxBasis): number {
  const amount = numericValue(value)
  if (amount <= 0) return 0
  return basis === 'exclusive' ? totalIncGstDollars(amount) : amount
}

/** The GST inside that charged amount. */
export function gstOf(value: string | number | null | undefined, basis: TaxBasis): number {
  const amount = numericValue(value)
  if (amount <= 0) return 0
  return basis === 'exclusive' ? gstOnExclusiveDollars(amount) : gstComponentDollars(amount)
}

function Icon({ name }: { name: 'doc' | 'download' }) {
  return (
    <svg
      className="wa-my-invoices__icon-svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'download' ? (
        <>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </>
      )}
    </svg>
  )
}

function InvoiceCard({ invoice }: { invoice: InvoiceItem }): React.ReactElement {
  const hasPdf = Boolean(invoice.pdf_url)
  const dateStr = formatDate(invoice.invoice_date)
  const basis = taxBasisOf(invoice)
  const invoiceAmount = amountIncGst(invoice.amount, basis)
  const gstAmount = gstOf(invoice.amount, basis)
  const amountLabel = invoiceAmount > 0 ? formatMoney(invoiceAmount) : 'View invoice'
  const gstLabel = gstAmount > 0 ? formatAmount(gstAmount) : null
  const statusLabel = invoice.status || (hasPdf ? 'Receipt available' : 'Receipt processing')
  const downloadLabel = `Download invoice or receipt for ${invoice.deal_name || 'invoice record'}`

  // Issue 34: members could see an invoice but never pay it from the portal.
  // Offer "Pay now" only when HubSpot gives us a payable link AND there is a
  // balance outstanding - a settled invoice keeps its link, and showing "Pay
  // now" against a paid invoice would be worse than showing nothing.
  const balanceDue = amountIncGst(invoice.balance_due, basis)
  const canPay = Boolean(invoice.pay_url) && balanceDue > 0
  const payLabel = `Pay ${formatMoney(balanceDue)} for ${invoice.deal_name || 'invoice record'}`
  // HubSpot does not always have a PDF rendered yet, but it always has a hosted
  // invoice page. Without a balance there is nothing to pay, so offer that page
  // as a plain "View invoice" rather than dead-ending on "Processing". It is
  // deliberately NOT surfaced as a download - it is a web page, not a PDF.
  const canView = Boolean(invoice.pay_url) && !hasPdf && !canPay
  const viewLabel = `View invoice ${invoice.deal_name || 'record'} on HubSpot`

  return (
    <article className="wa-my-invoices__card">
      {/* Issue 209: the download icon must actually trigger the download, not
          just decorate the row. When a PDF exists the icon is the download
          link; otherwise it stays a plain document glyph. */}
      {hasPdf ? (
        <a
          className="wa-my-invoices__card-icon wa-my-invoices__card-icon--link"
          href={invoice.pdf_url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          download
          aria-label={downloadLabel}
        >
          <Icon name="download" />
        </a>
      ) : (
        <span className="wa-my-invoices__card-icon">
          <Icon name="doc" />
        </span>
      )}
      <div className="wa-my-invoices__card-copy">
        <div className="wa-my-invoices__card-topline">
          {invoice.deal_type && <span className="wa-my-invoices__type-badge">{invoice.deal_type}</span>}
          {invoice.source && <span className="wa-my-invoices__source">{invoice.source}</span>}
        </div>
        <h2 className="wa-my-invoices__card-name">{invoice.deal_name || 'Invoice / receipt'}</h2>
        <p className="wa-my-invoices__card-meta">
          <span>{amountLabel}</span>
          {gstLabel && (
            <>
              <span aria-hidden="true">·</span>
              <span className="wa-my-invoices__gst">GST (included) {gstLabel}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{statusLabel}</span>
          {canPay && (
            <>
              <span aria-hidden="true">·</span>
              <span className="wa-my-invoices__balance">
                {formatMoney(balanceDue)} outstanding
              </span>
            </>
          )}
          {dateStr && (
            <>
              <span aria-hidden="true">·</span>
              <span>{dateStr}</span>
            </>
          )}
        </p>
      </div>
      <div className="wa-my-invoices__card-actions">
        {canPay && (
          <a
            href={invoice.pay_url || undefined}
            className="wa-my-invoices__action wa-my-invoices__action--pay"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={payLabel}
          >
            <span>Pay now</span>
          </a>
        )}
        {hasPdf ? (
          <a
            href={invoice.pdf_url || undefined}
            className={
              canPay
                ? 'wa-my-invoices__action wa-my-invoices__action--secondary'
                : 'wa-my-invoices__action'
            }
            target="_blank"
            rel="noopener noreferrer"
            download
            aria-label={downloadLabel}
          >
            <Icon name="download" />
            <span>Download</span>
          </a>
        ) : canView ? (
          <a
            href={invoice.pay_url || undefined}
            className="wa-my-invoices__action wa-my-invoices__action--secondary"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={viewLabel}
          >
            <span>View invoice</span>
          </a>
        ) : (
          !canPay && <span className="wa-my-invoices__paid-pill">Processing</span>
        )}
      </div>
    </article>
  )
}

export function MyInvoices({
  invoices,
  finance_email,
  support_email,
}: MyInvoicesProps): React.ReactElement {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const sortedInvoices = useMemo(() => {
    return [...(invoices || [])]
      .filter((invoice) => invoice && (invoice.pdf_url || invoice.pay_url))
      .sort((a, b) => (parseDateValue(b.invoice_date) ?? 0) - (parseDateValue(a.invoice_date) ?? 0))
  }, [invoices])

  const typeOptions = useMemo(() => {
    return Array.from(new Set(sortedInvoices.map((invoice) => invoice.deal_type).filter(Boolean))).sort()
  }, [sortedInvoices])

  const filtered = useMemo(() => {
    const fromTime = dateFrom ? parseDateValue(dateFrom) : null
    const toTime = dateTo ? parseDateValue(`${dateTo}T23:59:59`) : null

    return sortedInvoices.filter((invoice) => {
      if (typeFilter !== 'all' && invoice.deal_type !== typeFilter) return false

      const invoiceTime = parseDateValue(invoice.invoice_date)
      if (fromTime !== null && invoiceTime !== null && invoiceTime < fromTime) return false
      if (toTime !== null && invoiceTime !== null && invoiceTime > toTime) return false

      return true
    })
  }, [sortedInvoices, typeFilter, dateFrom, dateTo])

  // Summed row by row rather than off one pooled figure: the list mixes
  // tax-inclusive HubSpot invoices with ex-GST Deals, so there is no single
  // divisor that would give the right GST across both.
  const totalRecorded = sortedInvoices.reduce(
    (sum, invoice) => sum + amountIncGst(invoice.amount, taxBasisOf(invoice)),
    0
  )
  const totalGst = sortedInvoices.reduce(
    (sum, invoice) => sum + gstOf(invoice.amount, taxBasisOf(invoice)),
    0
  )
  return (
    <div className="wa-my-invoices">
      <div className="wa-my-invoices__summary" aria-label="Invoice summary">
        <div>
          <span>Available invoices</span>
          <strong>{sortedInvoices.length}</strong>
        </div>
        <div>
          <span>Recorded total</span>
          <strong>{formatMoney(totalRecorded)}</strong>
        </div>
        {totalRecorded > 0 && (
          <div>
            <span>GST (included)</span>
            <strong>{formatAmount(totalGst)}</strong>
          </div>
        )}
      </div>

      <div className="wa-my-invoices__filters" role="group" aria-label="Filter invoices">
        <div className="wa-my-invoices__filter-group">
          <label htmlFor="wa-invoice-type" className="wa-my-invoices__filter-label">
            Type
          </label>
          <select
            id="wa-invoice-type"
            className="wa-my-invoices__select"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="wa-my-invoices__filter-group">
          <label htmlFor="wa-invoice-from" className="wa-my-invoices__filter-label">
            From
          </label>
          <input
            id="wa-invoice-from"
            type="date"
            className="wa-my-invoices__date-input"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="Filter from date"
          />
        </div>

        <div className="wa-my-invoices__filter-group">
          <label htmlFor="wa-invoice-to" className="wa-my-invoices__filter-label">
            To
          </label>
          <input
            id="wa-invoice-to"
            type="date"
            className="wa-my-invoices__date-input"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="Filter to date"
          />
        </div>

        {(typeFilter !== 'all' || dateFrom || dateTo) && (
          <button
            type="button"
            className="wa-my-invoices__clear"
            onClick={() => {
              setTypeFilter('all')
              setDateFrom('')
              setDateTo('')
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {sortedInvoices.length === 0 ? (
        <div className="wa-my-invoices__empty">
          <p className="wa-my-invoices__empty-message">
            No invoices or receipts are available for this account yet. If you&apos;re expecting a
            renewal invoice,{' '}
            <a href={`mailto:${finance_email}`} className="wa-link">
              contact our finance team
            </a>
            .
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="wa-my-invoices__empty">
          <p className="wa-my-invoices__empty-message">No invoices match the current filters.</p>
        </div>
      ) : (
        <div className="wa-my-invoices__cards">
          {filtered.map((invoice) => (
            <InvoiceCard key={invoice.deal_id || invoice.deal_name} invoice={invoice} />
          ))}
        </div>
      )}

      <div className="wa-my-invoices__help">
        <p>
          <strong>Receipt missing?</strong> Contact finance at{' '}
          <a href={`mailto:${finance_email}`} className="wa-link">
            {finance_email}
          </a>{' '}
          or support at{' '}
          <a href={`mailto:${support_email}`} className="wa-link">
            {support_email}
          </a>
          .
        </p>
      </div>
    </div>
  )
}
