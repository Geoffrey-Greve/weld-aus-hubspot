import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MyInvoices } from './MyInvoices'
import type { InvoiceItem } from './types'

/**
 * Ollie confirmed (2026-09-18) that Deal `amount` is EX GST, like every HubDB
 * course price. The list read every row as tax-inclusive, so a $585 course was
 * shown as $585 charged with $53.18 of GST in it when the member paid $643.50.
 *
 * HubSpot Invoice rows are the other way round - `hs_amount_billed` already has
 * the portal's tax rate on top of the ex-tax lines - so this is per row, not a
 * blanket flip.
 */
function invoice(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    deal_id: 'deal-1',
    deal_name: 'AS1796 Cert 10',
    deal_type: 'Training Course',
    invoice_date: '2026-06-24',
    amount: 585,
    status: 'Receipt available',
    pdf_url: 'https://example.test/receipt.pdf',
    ...overrides,
  }
}

function renderList(invoices: InvoiceItem[]) {
  return render(
    <MyInvoices
      invoices={invoices}
      finance_email="finance@weldaustralia.com.au"
      support_email="office@weldaustralia.com.au"
    />
  )
}

describe('My Invoices GST basis', () => {
  it('grosses an ex-GST Deal amount up to what the member was charged', () => {
    renderList([invoice({ tax_basis: 'exclusive', source: 'Invoice PDF' })])

    expect(screen.getAllByText('$643.50').length).toBeGreaterThan(0)
    expect(screen.getByText('GST (included) $58.50')).toBeInTheDocument()
    // The old, inclusive reading of a Deal amount.
    expect(screen.queryByText('GST (included) $53.18')).toBeNull()
  })

  it('leaves a HubSpot invoice total alone and splits its GST back out', () => {
    renderList([
      invoice({
        deal_id: 'invoice-1',
        deal_type: 'Invoice',
        source: 'HubSpot invoice',
        tax_basis: 'inclusive',
        amount: 643.5,
      }),
    ])

    expect(screen.getAllByText('$643.50').length).toBeGreaterThan(0)
    expect(screen.getByText('GST (included) $58.50')).toBeInTheDocument()
  })

  it('reads a row with no tax_basis as inclusive, exactly as it rendered before', () => {
    renderList([invoice({ amount: 643.5 })])

    expect(screen.getAllByText('$643.50').length).toBeGreaterThan(0)
    expect(screen.getByText('GST (included) $58.50')).toBeInTheDocument()
  })

  it('sums a mixed list row by row rather than off one divisor', () => {
    renderList([
      invoice({ deal_id: 'deal-1', tax_basis: 'exclusive', amount: 585 }),
      invoice({
        deal_id: 'invoice-1',
        tax_basis: 'inclusive',
        amount: 1100,
        pdf_url: null,
        pay_url: 'https://example.test/invoice',
      }),
    ])

    // 643.50 + 1100.00, with 58.50 + 100.00 of GST inside it.
    expect(screen.getByText('$1,743.50')).toBeInTheDocument()
    expect(screen.getByText('$158.50')).toBeInTheDocument()
  })

  it('offers an ex-GST balance at the amount that actually clears it', () => {
    renderList([
      invoice({
        deal_id: 'deal-2',
        tax_basis: 'exclusive',
        amount: 585,
        balance_due: 585,
        pdf_url: null,
        pay_url: 'https://example.test/pay',
      }),
    ])

    expect(screen.getByText('$643.50 outstanding')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Pay $643.50 for AS1796 Cert 10')
    ).toBeInTheDocument()
  })
})
