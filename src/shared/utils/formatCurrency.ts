/**
 * Currency formatting utilities for the Weld Australia theme.
 *
 * HubDB stores prices EX GST - the columns say so (`price_member` / `price_non_member`
 * are documented AUD ex GST, and the tiered columns are literally named
 * `price_gold_aud_ex_gst` and friends). Every course card on the site labels them
 * "ex GST" too. The checkout used to call the same number GST-inclusive and show
 * "GST (included)" as price/11, which understated both the tax and the total: a $585
 * ex-GST course was shown as $585 total with $53.18 of GST inside it, when the buyer
 * owes $585 + $58.50 = $643.50.
 *
 * So: `gstOnExclusiveDollars` / `totalIncGstDollars` are what a price off a HubDB row
 * goes through. `gstComponentDollars` splits the tax back out of an amount that really
 * is inclusive - a recorded invoice total, not a list price - and is not the checkout's
 * to use.
 */

const AUD_FORMATTER = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** Australian GST rate, applied to the ex-GST prices held in HubDB. */
export const GST_RATE = 0.1

/**
 * Format a value in cents as an AUD currency string.
 *
 * @example formatCurrency(19900) → "$199.00"
 */
export function formatCurrency(cents: number): string {
  return AUD_FORMATTER.format(cents / 100)
}

/**
 * Format a value already expressed in dollars as an AUD currency string.
 *
 * @example formatCurrencyDollars(199) → "$199.00"
 */
export function formatCurrencyDollars(dollars: number): string {
  return AUD_FORMATTER.format(dollars)
}

/**
 * A dollar amount as whole cents. Money is only ever charged in cents, and the reserve
 * body already sends `Math.round(price * 100)`, so this is the same rounding the Worker
 * is quoted against.
 */
function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/**
 * The GST payable ON TOP of a tax-exclusive amount. This is the checkout's GST line.
 *
 * Computed in integer cents, which is what makes the checkout's three lines add up.
 * It used to be a bare `dollars * 0.1`, rounded only by the formatter, while
 * `totalIncGstDollars` rounded the sum separately with `Math.round`. On any price whose
 * GST lands on a half cent the two roundings disagreed and the buyer read a subtotal, a
 * GST line and a total that were visibly one cent out: $500.65 + $50.07 = $550.71.
 * Rare, but it is the checkout, and arithmetic that does not add up costs more trust
 * than a cent is worth. Exhaustively checked over every price to $20,000 by
 * formatCurrency.test.ts.
 *
 * @example gstOnExclusiveDollars(585) → 58.5 (renders as "$58.50")
 */
export function gstOnExclusiveDollars(exclusiveDollars: number): number {
  return Math.round(toCents(exclusiveDollars) * GST_RATE) / 100
}

/**
 * A tax-exclusive amount plus its GST - the checkout's "Total (inc. GST)".
 *
 * Built by ADDING the two cent amounts above rather than re-deriving the total from
 * the original price, so the displayed total is the displayed fee plus the displayed
 * GST by construction rather than by luck.
 *
 * This is still an estimate of what HubSpot will invoice: HubSpot applies the portal's
 * own imported tax rate to the line item and the Worker holds no rate at all
 * (events-engine CLAUDE.md, "Stored prices are TAX-EXCLUSIVE"). It matches while that
 * rate is 10%.
 *
 * @example totalIncGstDollars(585) → 643.5 (renders as "$643.50")
 */
export function totalIncGstDollars(exclusiveDollars: number): number {
  const feeCents = toCents(exclusiveDollars)
  return (feeCents + Math.round(feeCents * GST_RATE)) / 100
}

/**
 * The GST component already contained within a GST-INCLUSIVE amount.
 *
 * For a tax-inclusive price the embedded GST is `amount / 11` (= amount × 0.1 / 1.1).
 * This does NOT add tax on top - it splits out the portion already included. Use it on
 * a recorded total (a paid invoice, a deal amount), never on a HubDB list price, which
 * is ex GST and needs `gstOnExclusiveDollars` instead.
 *
 * @example gstComponentDollars(643.50) → 58.50
 */
export function gstComponentDollars(inclusiveDollars: number): number {
  return inclusiveDollars / 11
}
