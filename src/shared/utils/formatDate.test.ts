import { describe, expect, it } from 'vitest'
import { formatDate, formatDateRange, formatDateShort } from './formatDate'

describe('formatDate', () => {
  it('renders an Australian long date', () => {
    expect(formatDate('2026-05-16')).toBe('16 May 2026')
  })

  it('abbreviates the month in the short form', () => {
    expect(formatDateShort('2026-05-16')).toBe('16 May 2026')
  })
})

describe('formatDateRange', () => {
  it('collapses a range inside one month', () => {
    expect(formatDateRange('2026-05-16', '2026-05-18')).toBe('16-18 May 2026')
  })

  it('names both months when the range crosses one', () => {
    expect(formatDateRange('2026-05-30', '2026-06-02')).toBe('30 May - 2 June 2026')
  })

  // A course running over New Year used to render "28 Dec - 3 Jan 2027", which reads as
  // starting in December 2027 - a year after it does.
  it('keeps the start year when the range crosses one', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 - 3 Jan 2027')
  })

  // Ref 40: /courses/iwe listed a live session as "1 Dec - 1 Oct 2024". A backwards range
  // is a typo being published, and the start date is the half a visitor can act on.
  it('renders the start alone when the end date precedes it', () => {
    expect(formatDateRange('2026-12-01', '2024-10-01')).toBe('1 December 2026')
  })

  it('renders the start alone when there is no usable end date', () => {
    expect(formatDateRange('2026-12-01', '')).toBe('1 December 2026')
    expect(formatDateRange('2026-12-01', 'not a date')).toBe('1 December 2026')
  })

  it('renders nothing when the start itself is unusable', () => {
    expect(formatDateRange('', '2026-12-01')).toBe('')
  })
})
