import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FindAMember, type FindAMemberProps, type MemberRow } from './FindAMember'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOLD_ROW: MemberRow = {
  id: 1,
  company_name: 'Apex Welding',
  member_tier: 'Gold',
  tier_order: 1,
  company_logo_url: '',
  company_logo_alt: '',
  company_blurb: '<p>Premium welding services.</p>',
  website_url: 'https://apex.com.au',
  contact_email: 'info@apex.com.au',
  state_operation: ['NSW', 'VIC'],
}

const SILVER_ROW: MemberRow = {
  id: 2,
  company_name: 'Beta Welding',
  member_tier: 'Silver',
  tier_order: 2,
  company_logo_url: '',
  company_logo_alt: '',
  company_blurb: '',
  website_url: '',
  contact_email: '',
  state_operation: ['QLD'],
}

const BRONZE_ROW: MemberRow = {
  id: 3,
  company_name: 'Alpha Weld Co',
  member_tier: 'Bronze',
  tier_order: 3,
  company_logo_url: 'https://cdn.example.com/logo.png',
  company_logo_alt: 'Alpha logo',
  company_blurb: '',
  website_url: 'https://alpha.com.au',
  contact_email: '',
  state_operation: ['WA'],
}

const DEFAULT_PROPS: FindAMemberProps = {
  rows: [BRONZE_ROW, GOLD_ROW, SILVER_ROW], // intentionally out-of-tier order
  section_heading: 'Find a Member',
  intro: '<p>Browse our member directory.</p>',
  default_sort: 'tier',
  tiers_visible: ['gold', 'silver', 'bronze', 'reciprocal', 'industry_supplier'],
  page_size: 24,
  show_state_filter: true,
  show_search: true,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCardAriaLabels(): string[] {
  const articles = document.querySelectorAll('article[aria-label]')
  return Array.from(articles).map((el) => el.getAttribute('aria-label') ?? '')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindAMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the URL between tests so ?q= from one test doesn't leak into others.
    window.history.replaceState({}, '', '/find-a-member/')
  })

  it('renders without crashing and shows result count', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    expect(screen.getByText('Showing 3 members')).toBeTruthy()
  })

  it('Gold members appear first regardless of input order', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    const labels = getCardAriaLabels()
    expect(labels.length).toBeGreaterThan(0)
    expect(labels[0]).toContain('Gold')
  })

  it('Silver appears before Bronze', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    const labels = getCardAriaLabels()
    const silverIdx = labels.findIndex((l) => l.includes('Silver'))
    const bronzeIdx = labels.findIndex((l) => l.includes('Bronze'))
    expect(silverIdx).toBeGreaterThanOrEqual(0)
    expect(bronzeIdx).toBeGreaterThanOrEqual(0)
    expect(silverIdx).toBeLessThan(bronzeIdx)
  })

  it('tier filter chip narrows results', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    const goldChip = screen.getByRole('button', { name: 'Gold' })
    fireEvent.click(goldChip)
    expect(screen.getByText('Showing 1 member')).toBeTruthy()
  })

  it('state filter chip narrows results', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    const nswChip = screen.getByRole('button', { name: 'NSW' })
    fireEvent.click(nswChip)
    // Only GOLD_ROW has NSW in state_operation
    expect(screen.getByText('Showing 1 member')).toBeTruthy()
  })

  it('search input filters by company name (debounced 200ms)', () => {
    vi.useFakeTimers()
    render(<FindAMember {...DEFAULT_PROPS} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Apex' } })
    // Before debounce fires: all results still shown
    expect(screen.getByText('Showing 3 members')).toBeTruthy()
    // Wrap timer advance in act() so React flushes the state update
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByText('Showing 1 member')).toBeTruthy()
    vi.useRealTimers()
  })

  it('empty state shown when no results match', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    // Click Gold tier then QLD state - Gold is NSW/VIC so combination returns 0
    const goldChip = screen.getByRole('button', { name: 'Gold' })
    fireEvent.click(goldChip)
    const qldChip = screen.getByRole('button', { name: 'QLD' })
    fireEvent.click(qldChip)
    expect(screen.getByText(/No members match your search/)).toBeTruthy()
  })

  it('sort by Name A→Z orders the complete filtered result set regardless of tier', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    const nameBtn = screen.getByRole('button', { name: 'Name A→Z' })
    fireEvent.click(nameBtn)
    const labels = getCardAriaLabels()
    expect(labels).toEqual([
      expect.stringContaining('Alpha Weld Co'),
      expect.stringContaining('Apex Welding'),
      expect.stringContaining('Beta Welding'),
    ])
  })

  it('sort by State orders the complete filtered result set, then company name', () => {
    render(
      <FindAMember
        {...DEFAULT_PROPS}
        rows={[
          { ...GOLD_ROW, state_operation: ['WA'] },
          { ...SILVER_ROW, state_operation: ['QLD'] },
          { ...BRONZE_ROW, state_operation: ['NSW'] },
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'By state' }))
    const labels = getCardAriaLabels()
    expect(labels).toEqual([
      expect.stringContaining('Alpha Weld Co'),
      expect.stringContaining('Beta Welding'),
      expect.stringContaining('Apex Welding'),
    ])
  })

  it('shows logo img when url provided', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    // BRONZE_ROW has a logo URL
    const img = document.querySelector('img[alt="Alpha logo"]') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.src).toBe('https://cdn.example.com/logo.png')
  })

  it('shows initials when no logo url', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    // GOLD_ROW has no logo; company_name = 'Apex Welding' → initials 'AW'
    expect(screen.getByText('AW')).toBeTruthy()
  })

  it('falls back to initials when a logo url fails to load', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    // Only BRONZE_ROW ('Alpha Weld Co' → 'AW') has a logo; Gold already shows 'AW'.
    expect(screen.getAllByText('AW')).toHaveLength(1)
    const img = document.querySelector('img[alt="Alpha logo"]') as HTMLImageElement
    expect(img).toBeTruthy()
    fireEvent.error(img)
    // Broken logo swaps to initials - img gone, second 'AW' placeholder appears.
    expect(document.querySelector('img[alt="Alpha logo"]')).toBeNull()
    expect(screen.getAllByText('AW')).toHaveLength(2)
  })

  it('pre-fills search from the ?q= URL param on landing', () => {
    window.history.replaceState({}, '', '/find-a-member/?q=Apex')
    render(<FindAMember {...DEFAULT_PROPS} />)
    // Hero search GETs here with ?q=Apex → directory filtered to Apex Welding.
    expect(screen.getByText('Showing 1 member')).toBeTruthy()
    const input = screen.getByRole('searchbox') as HTMLInputElement
    expect(input.value).toBe('Apex')
  })

  it('pagination hides when all items fit on one page', () => {
    render(<FindAMember {...DEFAULT_PROPS} page_size={24} />)
    // With 3 rows and page_size=24, totalPages=1, Pagination returns null
    expect(document.querySelector('.wa-pagination')).toBeNull()
  })

  it('pagination shows when items exceed page_size', () => {
    render(<FindAMember {...DEFAULT_PROPS} page_size={1} />)
    // With 3 rows and page_size=1, totalPages=3 → pagination renders
    expect(document.querySelector('.wa-pagination')).toBeTruthy()
  })

  it('tiers_visible prop excludes unlisted tiers from display', () => {
    render(<FindAMember {...DEFAULT_PROPS} tiers_visible={['gold']} />)
    // Only Gold row should be visible
    expect(screen.getByText('Showing 1 member')).toBeTruthy()
    const labels = getCardAriaLabels()
    expect(labels.every((l) => l.includes('Gold'))).toBe(true)
  })

  it('section heading and intro are rendered', () => {
    render(<FindAMember {...DEFAULT_PROPS} />)
    expect(screen.getByText('Find a Member')).toBeTruthy()
    // intro is rendered as HTML
    expect(document.querySelector('.wa-fam__intro')).toBeTruthy()
  })
})
