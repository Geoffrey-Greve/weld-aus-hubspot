import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResourceLibrary, type ResourceLibraryProps, type ResourceRow } from './ResourceLibrary'

// ---------------------------------------------------------------------------
// Mock the events API so tests don't rely on window._hsq
// ---------------------------------------------------------------------------

vi.mock('@shared/api/events', () => ({
  trackCustomEvent: vi.fn(),
}))

// Mock IntersectionObserver (jsdom doesn't implement it).
// Vitest 4 requires constructor mocks to be a class/function. observe() fires
// immediately so resource_locked_view events can be asserted synchronously.
class IntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(el: Element) {
    this.callback(
      [{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry],
      this,
    )
  }
  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PUBLIC_ROW: ResourceRow = {
  id: 1,
  title: 'Australian Welding Standards Overview',
  abstract: '<p>Guide to current welding standards.</p>',
  file_url: '/files/standards.pdf',
  file_type: 'pdf',
  category: 'standards',
  preview_image_url: '',
  preview_image_alt: '',
  published_date: '2024-07-01',
  locked: false,
}

const MEMBER_ROW: ResourceRow = {
  id: 2,
  title: 'Members Technical Bulletin',
  abstract: '<p>Technical guidance for members.</p>',
  file_url: '/files/bulletin.pdf',
  file_type: 'pdf',
  category: 'technical',
  preview_image_url: 'https://cdn.example.com/img.jpg',
  preview_image_alt: 'Bulletin cover',
  published_date: 1709251200,
  locked: true,
}

const VIDEO_ROW: ResourceRow = {
  id: 3,
  title: 'Welding Webinar Recording',
  abstract: '<p>Recorded webinar on robotic welding.</p>',
  file_url: '/files/webinar.mp4',
  file_type: 'video',
  category: 'webinar',
  preview_image_url: '',
  preview_image_alt: '',
  published_date: null,
  locked: false,
}

const ENQUIRY_ROW: ResourceRow = {
  id: 4,
  title: 'Premium Welding Guideline',
  abstract: '<p>Paid resource for non-members.</p>',
  file_url: '/files/premium-guideline.pdf',
  file_type: 'pdf',
  category: 'standards',
  member_label: 'Free',
  non_member_label: '$--',
  preview_image_url: '',
  preview_image_alt: '',
  published_date: null,
  locked: false,
}

const MEMBER_FREE_NON_MEMBER_PAID_ROW: ResourceRow = {
  id: 7,
  title: 'Member Free Technical Note',
  abstract: '<p>Free for active members, paid for non-members.</p>',
  file_url: '/files/member-free-technical-note.pdf',
  file_type: 'pdf',
  category: 'technical',
  required_tier: 'public',
  member_label: 'Free',
  non_member_label: '$40',
  preview_image_url: '',
  preview_image_alt: '',
  published_date: null,
  locked: false,
}

const PAID_PUBLIC_ROW: ResourceRow = {
  id: 5,
  title: 'Welding Handbook 2026',
  abstract: '<p>Paid handbook, no membership required.</p>',
  file_url: '/files/handbook.pdf',
  file_type: 'pdf',
  category: 'standards',
  required_tier: 'public',
  member_label: '$295',
  non_member_label: '$450',
  preview_image_url: '',
  preview_image_alt: '',
  published_date: null,
  locked: false,
}

const CTA_LABEL_ROW: ResourceRow = {
  id: 6,
  title: 'Free Fact Sheet',
  abstract: '<p>Free fact sheet with CTA-style labels.</p>',
  file_url: '/files/fact-sheet.pdf',
  file_type: 'pdf',
  category: 'standards',
  required_tier: 'public',
  member_label: 'Download PDF',
  non_member_label: 'Download PDF',
  preview_image_url: '',
  preview_image_alt: '',
  published_date: null,
  locked: false,
}

const DEFAULT_PROPS: ResourceLibraryProps = {
  rows: [PUBLIC_ROW, MEMBER_ROW, VIDEO_ROW],
  section_heading: 'Resources',
  intro: '<p>Browse our resource library.</p>',
  categories_visible: ['standards', 'technical', 'webinar'],
  default_filter_category: 'all',
  show_file_type_filter: true,
  show_member_only_filter: true,
  page_size: 18,
  locked_overlay_message: '<p>Available to Weld Australia members.</p>',
  locked_cta_label: 'Become a member',
  locked_cta_url: '/membership/',
  member_tier: '',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResourceLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing and shows result count', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 3 of 3 resources')
  })

  it('renders section heading and intro', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    expect(screen.getByText('Resources')).toBeTruthy()
    expect(document.querySelector('.wa-rl__intro')).toBeTruthy()
  })

  it('unlocked rows show a Download button', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const downloadLinks = document.querySelectorAll('.wa-rl__download-btn')
    // PUBLIC_ROW and VIDEO_ROW are unlocked
    expect(downloadLinks.length).toBe(2)
  })

  it('locked rows show the overlay with upgrade CTA', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const overlay = document.querySelector('.wa-rl__locked-overlay')
    expect(overlay).toBeTruthy()
    // CTA link points to membership URL
    const ctaLink = document.querySelector('.wa-rl__locked-cta')
    expect(ctaLink).toBeTruthy()
    expect(ctaLink?.getAttribute('href')).toBe('/membership/')
  })

  it('locked rows do NOT show a Download button', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[MEMBER_ROW]} />)
    expect(document.querySelector('.wa-rl__download-btn')).toBeNull()
  })

  it('uses the contact-us page for non-member paid resource enquiries', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[ENQUIRY_ROW]} />)

    const enquiryLink = screen.getByRole('link', { name: 'Enquire - $--' })
    expect(enquiryLink.getAttribute('href')).toBe('/contact-us?resource=Premium%20Welding%20Guideline')
  })

  it('a priced public resource is never described as free', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[PAID_PUBLIC_ROW]} />)

    const eligibility = document.querySelector('.wa-rl__eligibility-value')?.textContent
    expect(eligibility).toContain('anyone can purchase')
    expect(eligibility).not.toContain('free')

    // Price is shown for both audiences, and the file is not handed over free.
    const prices = document.querySelectorAll('.wa-rl__pricing strong')
    expect(Array.from(prices).map((node) => node.textContent)).toEqual(['$295', '$450'])
    expect(document.querySelector('.wa-rl__download-btn')).toBeNull()
    expect(screen.getByRole('link', { name: 'Enquire - $450' })).toBeTruthy()
  })

  it('a priced public resource that is free for members says so', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[{ ...PAID_PUBLIC_ROW, member_label: 'Free' }]} />)
    expect(document.querySelector('.wa-rl__eligibility-value')?.textContent)
      .toContain('free for members, paid for non-members')
  })

  it('members get the download on a resource that is only paid for non-members', () => {
    render(
      <ResourceLibrary
        {...DEFAULT_PROPS}
        rows={[{ ...PAID_PUBLIC_ROW, member_label: 'Free' }]}
        member_tier="Individual"
      />
    )
    expect(document.querySelector('.wa-rl__download-btn')).toBeTruthy()
  })

  it('silver members do not see the non-member $40 enquiry CTA when the member label is free', () => {
    render(
      <ResourceLibrary
        {...DEFAULT_PROPS}
        rows={[MEMBER_FREE_NON_MEMBER_PAID_ROW]}
        member_tier="Corporate Silver"
      />
    )

    expect(document.querySelector('.wa-rl__download-btn')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Enquire - $40' })).toBeNull()
  })

  it('anonymous visitors still see the $40 enquiry CTA for a member-free paid resource', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[MEMBER_FREE_NON_MEMBER_PAID_ROW]} />)

    expect(document.querySelector('.wa-rl__download-btn')).toBeNull()
    expect(screen.getByRole('link', { name: 'Enquire - $40' })).toBeTruthy()
  })

  it('a free public resource still reads "free for everyone"', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[PUBLIC_ROW]} />)
    expect(document.querySelector('.wa-rl__eligibility-value')?.textContent)
      .toContain('Public - free for everyone')
  })

  it('CTA-style labels are not mistaken for a price', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[CTA_LABEL_ROW]} />)
    expect(document.querySelector('.wa-rl__eligibility-value')?.textContent)
      .toContain('Public - free for everyone')
    expect(document.querySelector('.wa-rl__download-btn')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.wa-rl__pricing strong')).map((n) => n.textContent))
      .toEqual(['Free', 'Free'])
  })

  it('member-gated rows show "Members only" rather than a free non-member price', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[{ ...MEMBER_ROW, required_tier: 'member' }]} />)
    const prices = Array.from(document.querySelectorAll('.wa-rl__pricing strong')).map((n) => n.textContent)
    expect(prices).toEqual(['Free', 'Members only'])
  })

  it('locked overlay message renders as HTML', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const msg = document.querySelector('.wa-rl__locked-message')
    expect(msg?.innerHTML).toContain('Available to Weld Australia members')
  })

  it('category filter chip narrows results', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const techChip = screen.getByRole('button', { name: 'Technical Notes' })
    fireEvent.click(techChip)
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 1 of 1 resources')
  })

  it('file type filter chip narrows results', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const videoChip = screen.getByRole('button', { name: 'Video' })
    fireEvent.click(videoChip)
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 1 of 1 resources')
  })

  it('"Available to me" chip hides locked rows', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const memberChip = screen.getByRole('button', { name: 'Available to me' })
    fireEvent.click(memberChip)
    // PUBLIC_ROW and VIDEO_ROW are unlocked; MEMBER_ROW is locked
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 2 of 2 resources')
    expect(document.querySelector('.wa-rl__locked-overlay')).toBeNull()
  })

  it('keyword search filters by title (debounced 200ms)', () => {
    vi.useFakeTimers()
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'Welding Standards' } })
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 3 of 3 resources')
    act(() => { vi.advanceTimersByTime(200) })
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 1 of 1 resources')
    vi.useRealTimers()
  })

  it('keyword search also matches abstract text', () => {
    vi.useFakeTimers()
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'robotic welding' } })
    act(() => { vi.advanceTimersByTime(200) })
    // VIDEO_ROW abstract contains 'robotic welding'
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 1 of 1 resources')
    vi.useRealTimers()
  })

  it('empty state shown when no results match', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const techChip = screen.getByRole('button', { name: 'Technical Notes' })
    fireEvent.click(techChip)
    const videoChip = screen.getByRole('button', { name: 'Video' })
    fireEvent.click(videoChip)
    // Technical rows have no video type items
    expect(screen.getByText(/Try a different search term/)).toBeTruthy()
  })

  it('empty state without filters shows generic message', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[]} />)
    expect(screen.getByText('No resources are available yet.')).toBeTruthy()
  })

  it('pagination renders when items exceed page_size', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} page_size={1} />)
    expect(document.querySelector('.wa-pagination')).toBeTruthy()
  })

  it('pagination hidden when all items fit', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} page_size={18} />)
    expect(document.querySelector('.wa-pagination')).toBeNull()
  })

  it('default_filter_category pre-selects a category chip', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} default_filter_category="standards" />)
    // Should pre-filter to standards only (PUBLIC_ROW)
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 1 of 1 resources')
  })

  it('show_file_type_filter=false hides file type chips', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} show_file_type_filter={false} />)
    expect(screen.queryByRole('button', { name: 'PDF' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Video' })).toBeNull()
  })

  it('show_member_only_filter=false hides the "Available to me" chip', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} show_member_only_filter={false} />)
    expect(screen.queryByRole('button', { name: 'Available to me' })).toBeNull()
  })

  it('preview image renders when preview_image_url is set', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const img = document.querySelector('img[alt="Bulletin cover"]') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.src).toBe('https://cdn.example.com/img.jpg')
  })

  it('uses the HubSpot File Manager placeholder when a preview image is missing', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[PUBLIC_ROW]} />)
    const image = document.querySelector('.wa-rl__card-img') as HTMLImageElement | null

    expect(image).toBeTruthy()
    expect(image?.src).toContain('441838610.fs1.hubspotusercontent-ap1.net/hubfs/441838610/placeholders/')
  })

  it('tracks resource_downloaded event on download click', async () => {
    const { trackCustomEvent } = await import('@shared/api/events')
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const downloadLinks = document.querySelectorAll<HTMLAnchorElement>('.wa-rl__download-btn')
    fireEvent.click(downloadLinks[0]!)
    expect(trackCustomEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'resource_downloaded' })
    )
  })

  it('applies card--locked class to locked rows', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    expect(document.querySelector('.wa-rl__card--locked')).toBeTruthy()
    expect(document.querySelector('.wa-rl__card--unlocked')).toBeTruthy()
  })

  it('categories_visible empty derives categories from data', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} categories_visible={[]} />)
    // All three categories from the data should produce filter chips
    expect(screen.getByRole('button', { name: 'Standards & Guidance' })).toBeTruthy()
  })

  it('resource count is singular for exactly 1 result', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[PUBLIC_ROW]} />)
    expect(document.querySelector('.wa-rl__count')?.textContent).toContain('Showing 1 of 1 resources')
  })

  it('card aria-label includes "members only" for locked rows', () => {
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    const lockedCard = document.querySelector('article[aria-label*="members only"]')
    expect(lockedCard).toBeTruthy()
  })

  it('fires resource_locked_view when a locked card enters the viewport', async () => {
    const { trackCustomEvent } = await import('@shared/api/events')
    render(<ResourceLibrary {...DEFAULT_PROPS} />)
    // MEMBER_ROW (id 2) is locked; the IntersectionObserver mock fires immediately.
    expect(trackCustomEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'resource_locked_view',
        properties: expect.objectContaining({ resource_id: '2' }),
      })
    )
  })

  it('does not fire resource_locked_view for unlocked rows', async () => {
    const { trackCustomEvent } = await import('@shared/api/events')
    // Render with only unlocked rows - no locked card should trigger the event.
    render(<ResourceLibrary {...DEFAULT_PROPS} rows={[PUBLIC_ROW, VIDEO_ROW]} />)
    const lockedViewFired = vi.mocked(trackCustomEvent).mock.calls.some(
      ([payload]) => payload.name === 'resource_locked_view'
    )
    expect(lockedViewFired).toBe(false)
  })

  it('locked overlay message and CTA reflect editor field values', () => {
    const customMessage = '<p>Gold members only - upgrade now.</p>'
    const customLabel = 'Upgrade to Gold'
    const customUrl = '/membership/gold/'
    render(
      <ResourceLibrary
        {...DEFAULT_PROPS}
        locked_overlay_message={customMessage}
        locked_cta_label={customLabel}
        locked_cta_url={customUrl}
      />
    )
    const msg = document.querySelector('.wa-rl__locked-message')
    expect(msg?.innerHTML).toContain('Gold members only')
    expect(screen.getByRole('link', { name: 'Upgrade to Gold' })).toBeTruthy()
    const ctaLink = document.querySelector('.wa-rl__locked-cta') as HTMLAnchorElement | null
    expect(ctaLink?.href).toContain('/membership/gold/')
  })
})
