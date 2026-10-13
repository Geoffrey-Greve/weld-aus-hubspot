import { describe, expect, it } from 'vitest'
import {
  GST_RATE,
  formatCurrencyDollars,
  gstComponentDollars,
  gstOnExclusiveDollars,
  totalIncGstDollars
} from './formatCurrency'

/**
 * HubDB prices are EX GST. The checkout used to treat them as inclusive and show
 * "GST (included)" as price/11, which quoted a buyer $585 total on a $585 ex-GST
 * course - understating the tax by $5.32 and the total by $58.50.
 */
describe('GST on an ex-GST HubDB price', () => {
  it('adds the tax on top rather than splitting it out of the price', () => {
    expect(gstOnExclusiveDollars(585)).toBeCloseTo(58.5, 2)
    expect(totalIncGstDollars(585)).toBe(643.5)
    // What the old, inclusive reading produced, kept here so a revert is visible.
    expect(gstComponentDollars(585)).toBeCloseTo(53.18, 2)
  })

  it('renders a total that equals the two lines printed above it', () => {
    // A fee whose GST does not land on a whole cent: 333.33 × 10% = 33.333.
    const fee = 333.33
    const gst = gstOnExclusiveDollars(fee)
    const total = totalIncGstDollars(fee)
    expect(formatCurrencyDollars(fee)).toBe('$333.33')
    expect(formatCurrencyDollars(gst)).toBe('$33.33')
    expect(formatCurrencyDollars(total)).toBe('$366.66')
  })

  it('is a no-op on a free session', () => {
    expect(gstOnExclusiveDollars(0)).toBe(0)
    expect(totalIncGstDollars(0)).toBe(0)
  })

  it('round-trips: stripping the GST back out of the total returns the fee', () => {
    for (const fee of [0, 195, 585, 700, 1200, 4950]) {
      const total = totalIncGstDollars(fee)
      expect(gstComponentDollars(total)).toBeCloseTo(fee * GST_RATE, 6)
      expect(total - gstComponentDollars(total)).toBeCloseTo(fee, 6)
    }
  })
})

describe('the checkout GST lines always add up', () => {
  // Step 3 and step 4 print three lines: the fee ex GST, the GST, and the total inc
  // GST. A buyer reads them as a sum. They used to be rounded independently - the GST
  // by the formatter, the total by its own Math.round - so any price whose GST lands
  // on a half cent rendered one cent out ($500.65 + $50.07 = $550.71). Both are now
  // derived from the same integer-cent figure.
  const cents = (formatted: string) =>
    Math.round(Number.parseFloat(formatted.replace(/[^0-9.]/g, '')) * 100)

  function displayedLinesAddUp(price: number): boolean {
    return (
      cents(formatCurrencyDollars(price)) + cents(formatCurrencyDollars(gstOnExclusiveDollars(price))) ===
      cents(formatCurrencyDollars(totalIncGstDollars(price)))
    )
  }

  it('holds for the prices that used to be one cent out', () => {
    for (const price of [0.15, 2.15, 3.65, 4.35, 500.65, 500.95, 501.65, 501.75]) {
      expect(displayedLinesAddUp(price), `$${price}`).toBe(true)
    }
  })

  it('holds in cents for every price from $0.01 to $20,000.00', () => {
    // Exhaustive rather than sampled: the failures sat on isolated float boundaries
    // that no round number would have found. Done in arithmetic rather than through
    // the formatter, because two million Intl calls blow the test timeout - the
    // formatted check below covers the rounding step on a smaller range.
    const offenders: number[] = []
    for (let c = 1; c <= 2_000_000; c++) {
      const price = c / 100
      const feeCents = Math.round(price * 100)
      const gstCents = Math.round(gstOnExclusiveDollars(price) * 100)
      const totalCents = Math.round(totalIncGstDollars(price) * 100)
      if (feeCents + gstCents !== totalCents) {
        offenders.push(price)
        if (offenders.length >= 5) break
      }
    }
    expect(offenders).toEqual([])
  })

  it('holds as FORMATTED currency across the range Weld actually charges', () => {
    // What the buyer reads is the formatted string, so the rounding the formatter
    // itself does has to be covered too. $1 to $12,000 in 5c steps spans every course
    // price in HubDB and includes the .x5 endings the original fault lived on.
    const offenders: number[] = []
    for (let c = 100; c <= 1_200_000; c += 5) {
      if (!displayedLinesAddUp(c / 100)) {
        offenders.push(c / 100)
        if (offenders.length >= 5) break
      }
    }
    expect(offenders).toEqual([])
  })

  it('still adds 10% on top rather than splitting it out', () => {
    // The Ref-40 direction, unchanged: HubDB prices are ex GST.
    expect(gstOnExclusiveDollars(585)).toBe(58.5)
    expect(totalIncGstDollars(585)).toBe(643.5)
  })
})
