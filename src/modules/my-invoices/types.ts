export interface InvoiceItem {
  deal_id: string
  deal_name: string
  deal_type: string
  invoice_date: string | number | null
  amount: string | number | null
  status: string
  pdf_url: string | null
  /**
   * HubSpot's hosted, payable invoice page (`hs_invoice_link`). Present only on
   * HubSpot invoice rows - Xero receipt rows sourced from Deals have no payable
   * link, only a PDF. Issue 34.
   */
  pay_url?: string | null
  /** `hs_balance_due`. Non-null only while there is money still owing. */
  balance_due?: string | number | null
  /**
   * Which way round `amount` (and `balance_due`) is recorded, because the two
   * sources feeding this list disagree:
   *
   * - `inclusive` - a HubSpot Invoice row. `hs_amount_billed` is the invoice
   *   TOTAL, and HubSpot applies the portal's tax rate on top of the ex-tax
   *   line items, so the tax is already inside the figure.
   * - `exclusive` - a Deal row. Deal `amount` is ex GST (confirmed by Ollie),
   *   matching the ex-GST prices held in HubDB.
   *
   * Absent means `inclusive`: that is what every row was read as before this
   * field existed, so an unflagged row renders exactly as it did.
   */
  tax_basis?: 'inclusive' | 'exclusive'
  source?: string
}

export interface MyInvoicesProps {
  invoices: InvoiceItem[]
  finance_email: string
  support_email: string
}
