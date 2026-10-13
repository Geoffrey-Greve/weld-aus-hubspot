import React from 'react'
import type { Invoice } from '../types'

interface InvoicesAndReceiptsProps {
  invoices: Invoice[]
  supportEmail: string
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return ''
  const ms = Date.parse(isoDate)
  if (isNaN(ms)) return ''
  return new Date(ms).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function InvoiceRow({ invoice }: { invoice: Invoice }): React.ReactElement {
  const dateStr = formatDate(invoice.invoice_date)

  return (
    <div className="wa-invoice-row">
      <div className="wa-invoice-row__info">
        <p className="wa-invoice-row__name" title={invoice.deal_name}>
          {invoice.deal_name}
        </p>
        {dateStr && <p className="wa-invoice-row__date">{dateStr}</p>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        {invoice.amount_display && (
          <span className="wa-invoice-row__amount">{invoice.amount_display}</span>
        )}
        {invoice.pdf_url ? (
          <a
            href={invoice.pdf_url}
            className="wa-btn wa-btn--sm wa-btn--secondary"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download receipt for ${invoice.deal_name}`}
          >
            Download PDF
          </a>
        ) : (
          // Issue 10: a Deal without a synced PDF is still a recorded payment -
          // show a terminal "Payment recorded" state instead of an open-ended
          // "processing" label that never resolves.
          <span
            className="wa-invoice-row__recorded"
            title="Receipt not yet available - contact the office if you need a copy."
          >
            Payment recorded
          </span>
        )}
      </div>
    </div>
  )
}

export function InvoicesAndReceipts({ invoices, supportEmail }: InvoicesAndReceiptsProps): React.ReactElement {
  if (invoices.length === 0) {
    return (
      <div className="wa-financial-placeholder">
        <div className="wa-tile-empty__icon" aria-hidden="true">🧾</div>
        <h3 className="wa-financial-placeholder__heading">Receipts coming soon</h3>
        <p className="wa-tile-empty__message">
          Downloadable receipts and invoices will appear here once the finance sync is connected.
        </p>
        <button className="wa-btn wa-btn--secondary" type="button" disabled aria-disabled="true">
          Download receipt
        </button>
        <p className="wa-financial-placeholder__support">
          Need a receipt now?{' '}
          <a href={`mailto:${supportEmail}`} className="wa-link">
            Contact support
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="wa-invoices">
      {invoices.map((inv) => (
        <InvoiceRow key={inv.deal_id} invoice={inv} />
      ))}
    </div>
  )
}
