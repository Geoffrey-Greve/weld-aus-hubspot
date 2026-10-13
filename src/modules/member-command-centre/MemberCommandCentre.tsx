import { useMemo, useRef, useState } from 'react'
import { resolveMemberPrice } from '@shared/utils/memberPricing'
import { hubdbStatusToSessionStatus } from '@shared/status/sessionStatus'
import './MemberCommandCentre.css'
import {
  financialItemIsPayable,
  getMembershipHeroAction,
  getOutstandingPayable,
  membershipRenewalUrl,
  membershipUpgradeUrl,
} from './membershipActions'
import type {
  CertStep,
  CertStepStatus,
  CourseItem,
  DashboardCardStyle,
  DashboardDensity,
  DashboardHeroStyle,
  DashboardLayoutVariant,
  DashboardSettings,
  EventItem,
  MemberCommandCentreProps,
  MembershipStatus,
  PreviewProfile,
  ResourceItem,
} from './types'

const STATUS_META: Record<MembershipStatus, { label: string; tone: string }> = {
  Active: { label: 'Active', tone: 'success' },
  'Grace period': { label: 'Grace period', tone: 'warning' },
  Lapsed: { label: 'Lapsed', tone: 'danger' },
}

const STATE_LABELS: Record<string, string> = {
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
  National: 'National',
}

const STATE_CODES = Object.keys(STATE_LABELS)
const STATE_CODES_BY_PRIORITY = STATE_CODES.filter((state) => state !== 'National')

function normaliseStateCode(value: unknown): string {
  if (!value) return 'National'

  if (Array.isArray(value)) {
    const firstSpecific = value
      .map((item) => normaliseStateCode(item))
      .find((state) => state && state !== 'National')
    return firstSpecific || 'National'
  }

  if (typeof value === 'object') {
    const option = value as Record<string, unknown>
    return normaliseStateCode(option.name ?? option.label ?? option.value)
  }

  const text = String(value).trim()
  if (!text) return 'National'

  if (STATE_LABELS[text]) return text

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return normaliseStateCode(JSON.parse(text))
    } catch {
      // Continue to loose matching below for HubL-safe stringified values.
    }
  }

  const upperText = text.toUpperCase()
  const foundCode = STATE_CODES_BY_PRIORITY.find((state) => {
    const pattern = new RegExp(`(^|[^A-Z])${state}([^A-Z]|$)`)
    return pattern.test(upperText)
  })

  if (foundCode) return foundCode
  if (upperText.includes('NATIONAL')) return 'National'

  return text
}

function profileStateCode(profile: PreviewProfile): string {
  const rawState = profile.state_raw ?? profile.state
  const state = normaliseStateCode(rawState)
  return STATE_LABELS[state] ? state : 'National'
}

const TIER_RANK: Record<string, number> = {
  public: 0,
  member: 1,
  individual: 1,
  apprentice: 1,
  'industry supplier': 1,
  bronze: 2,
  'bronze corporate': 2,
  silver: 3,
  'silver corporate': 3,
  gold: 4,
  'gold corporate': 4,
}

const DEFAULT_SETTINGS: DashboardSettings = {
  layoutVariant: 'two_column',
  cardStyle: 'elevated',
  density: 'comfortable',
  heroStyle: 'standard',
  showPreviewBar: false,
  showProfileSelector: false,
  showHeaderActions: true,
  showAlertBanner: true,
  showDataNote: false,
  tiles: {
    certification: true,
    coursesEvents: true,
    membership: true,
    financials: true,
    team: true,
    resources: true,
  },
}

function pickOption<T extends string>(value: unknown, fallback: T, options: readonly T[]): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

function normaliseSettings(settings: MemberCommandCentreProps['settings']): DashboardSettings {
  return {
    ...DEFAULT_SETTINGS,
    layoutVariant: pickOption<DashboardLayoutVariant>(settings?.layoutVariant, DEFAULT_SETTINGS.layoutVariant, [
      'two_column',
      'wide_main',
      'balanced',
      'single_column',
    ]),
    cardStyle: pickOption<DashboardCardStyle>(settings?.cardStyle, DEFAULT_SETTINGS.cardStyle, ['elevated', 'bordered', 'flat']),
    density: pickOption<DashboardDensity>(settings?.density, DEFAULT_SETTINGS.density, ['comfortable', 'compact']),
    heroStyle: pickOption<DashboardHeroStyle>(settings?.heroStyle, DEFAULT_SETTINGS.heroStyle, ['standard', 'compact']),
    showPreviewBar: settings?.showPreviewBar ?? DEFAULT_SETTINGS.showPreviewBar,
    showProfileSelector: settings?.showProfileSelector ?? DEFAULT_SETTINGS.showProfileSelector,
    showHeaderActions: settings?.showHeaderActions ?? DEFAULT_SETTINGS.showHeaderActions,
    showAlertBanner: settings?.showAlertBanner ?? DEFAULT_SETTINGS.showAlertBanner,
    showDataNote: settings?.showDataNote ?? DEFAULT_SETTINGS.showDataNote,
    tiles: {
      ...DEFAULT_SETTINGS.tiles,
      ...(settings?.tiles ?? {}),
    },
  }
}

type TierTheme = 'gold' | 'silver' | 'bronze' | 'member'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, JSX.Element> = {
    arrow: (
      <>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </>
    ),
    check: <polyline points="20 6 9 17 4 12" />,
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    doc: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </>
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </>
    ),
    lock: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
    map: (
      <>
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </>
    ),
    profile: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    shield: (
      <>
        <circle cx="12" cy="8" r="6" />
        <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
      </>
    ),
    team: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    upload: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </>
    ),
    warning: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
  }

  return (
    <svg
      className="wa-mcc__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name] ?? paths.doc}
    </svg>
  )
}

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

function formatDate(value: string | number | null | undefined, fallback = 'To be confirmed'): string {
  const time = parseDateValue(value)
  if (time === null) return fallback
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(time))
}

function formatDateShort(value: string | number | null | undefined, fallback = 'TBC'): string {
  const time = parseDateValue(value)
  if (time === null) return fallback
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(time))
}

function formatMoney(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount)
}

function numericValue(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

/**
 * Defect 213: the portal used to price every visitor, using `member_tier` - a
 * display label that falls back to "Member"/"Support needed". Those strings resolve
 * to different HubDB price columns than the empty tier /courses/ sends, so the two
 * surfaces quoted different numbers for the same person.
 *
 * Price off the dedicated pricing tier, and only for a visitor actually entitled to
 * a member rate. Falls back to the old fields so a portal page still rendering the
 * previous HubL props behaves sensibly rather than pricing off "Member".
 */
export function isPricingMember(profile: PreviewProfile): boolean {
  if (typeof profile.is_pricing_member === 'boolean') return profile.is_pricing_member
  return Boolean(profile.is_linked_member) && profile.membership_status !== 'Lapsed'
}

export function pricingTier(profile: PreviewProfile): string {
  if (!isPricingMember(profile)) return ''
  return (profile.pricing_member_tier ?? '').trim()
}

function memberRegistrationPrice(course: CourseItem, memberTier: string): number {
  return resolveMemberPrice(course, memberTier).price
}

function dateValue(value: string | number | null | undefined): number | null {
  return parseDateValue(value)
}

function isUpcomingOrUndated(value: string | number | null | undefined, todayMs: number): boolean {
  const time = dateValue(value)
  return time === null || time >= todayMs
}

function statFallback(value: string | number | null | undefined, fallback = 'Not available'): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

// Issue 31: honorary members have no expiry date by design. Detect them from
// the tier or status so "Valid until" can read "Does not expire" instead of a
// bare fallback that reads like missing data.
function isHonoraryProfile(profile: Pick<PreviewProfile, 'member_tier' | 'membership_status'>): boolean {
  return (
    /honou?rary/i.test(profile.member_tier || '') ||
    /honou?rary/i.test(String(profile.membership_status || ''))
  )
}

function plainText(html: string): string {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseSteps(raw: string): CertStep[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CertStep[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((step) => step && typeof step.label === 'string')
      .map((step) => ({
        label: step.label,
        note: step.note || '',
        status: (step.status || 'pending') as CertStepStatus,
      }))
  } catch {
    return []
  }
}

function tierRank(value: string): number {
  const key = (value || '').toLowerCase()
  return TIER_RANK[key] ?? TIER_RANK[key.replace('corporate ', '')] ?? 1
}

function requiredTierRank(value: string): number {
  const key = (value || 'public').toLowerCase()
  return TIER_RANK[key] ?? 0
}

function tierTheme(value: string): TierTheme {
  const tier = (value || '').toLowerCase()

  if (tier.includes('gold')) return 'gold'
  if (tier.includes('silver')) return 'silver'
  if (tier.includes('bronze')) return 'bronze'

  return 'member'
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function safeLink(value: string | undefined, fallback = '#'): string {
  return value && value.trim() ? value : fallback
}

function getProfileDisplayName(profile: PreviewProfile): string {
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return fullName || profile.company_name || 'member'
}

function getProfileOptionLabel(profile: PreviewProfile): string {
  const displayName = getProfileDisplayName(profile)
  const company = profile.company_name && profile.company_name !== displayName ? ` - ${profile.company_name}` : ''
  return `${displayName}${company} - ${profile.member_tier || 'Member'}`
}

function getMembershipTypeLabel(profile: PreviewProfile): string {
  const tier = (profile.member_tier || '').trim()
  const roleTitle = (profile.role_title || '').trim()
  const company = (profile.company_name || '').trim().toLowerCase()
  const roleKey = roleTitle.toLowerCase()
  const tierKey = tier.toLowerCase()
  const hasUsefulRoleTitle = roleTitle && roleKey !== company && roleKey !== tierKey

  if (tier && tierKey !== 'support needed') {
    return /member|membership/i.test(tier) ? tier : `${tier} membership`
  }

  return hasUsefulRoleTitle ? roleTitle : ''
}

function getProfileMeta(profile: PreviewProfile): string {
  const values = [getMembershipTypeLabel(profile), profile.company_name]
  const seen = new Set<string>()

  return values
    .map((value) => (value || '').trim())
    .filter((value) => {
      if (!value) return false
      const key = value.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(' · ')
}

function Html({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

function CertificationTile({ profile }: { profile: PreviewProfile }) {
  const steps = parseSteps(profile.cert_steps_json)
  const progress = Math.max(0, Math.min(100, Number(profile.cert_progress_percent || 0)))
  const hasCertificationData = Boolean(
    profile.certification_name ||
      profile.certification_meta ||
      steps.length > 0 ||
      profile.next_step_body ||
      profile.next_step_cta_url
  )

  if (!hasCertificationData) {
    return (
      <section className="wa-mcc__tile wa-mcc__tile--feature">
        <div className="wa-mcc__tile-head">
          <div className="wa-mcc__tile-title-group">
            <span className="wa-mcc__tile-icon wa-mcc__tile-icon--accent">
              <Icon name="shield" />
            </span>
            <h2 className="wa-mcc__tile-title">Certification pathway</h2>
          </div>
          <a className="wa-mcc__tile-link" href="#portal-certifications">
            Certification info <Icon name="arrow" size={12} />
          </a>
        </div>
        <div className="wa-mcc__empty-card">
          Your certification pathway will appear here once your records are available. In the meantime, you can review certification options and
          renewal requirements.
        </div>
      </section>
    )
  }

  return (
    <section className="wa-mcc__tile wa-mcc__tile--feature">
      <div className="wa-mcc__tile-head">
        <div className="wa-mcc__tile-title-group">
          <span className="wa-mcc__tile-icon wa-mcc__tile-icon--accent">
            <Icon name="shield" />
          </span>
          <h2 className="wa-mcc__tile-title">Certification pathway</h2>
        </div>
        <a className="wa-mcc__tile-link" href="#portal-certifications">
          Full record <Icon name="arrow" size={12} />
        </a>
      </div>

      <div className="wa-mcc__cert-top">
        <div>
          <div className="wa-mcc__cert-name">{profile.certification_name || 'Certification pathway'}</div>
          <div className="wa-mcc__cert-meta">{profile.certification_meta}</div>
        </div>
        <div className="wa-mcc__cert-pct">{progress}%</div>
      </div>

      <div className="wa-mcc__progress-track" aria-label={`Certification progress ${progress}%`}>
        <div className="wa-mcc__progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="wa-mcc__steps">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1
          return (
            <div className="wa-mcc__step" key={`${step.label}-${index}`}>
              <div className="wa-mcc__step-rail">
                <span className={cx('wa-mcc__step-dot', `wa-mcc__step-dot--${step.status}`)}>
                  {step.status === 'done' && <Icon name="check" size={13} />}
                  {step.status === 'current' && <span className="wa-mcc__step-current-dot" />}
                  {step.status === 'locked' && <Icon name="lock" size={11} />}
                </span>
                {!isLast && (
                  <span
                    className={cx(
                      'wa-mcc__step-line',
                      step.status === 'done' && 'wa-mcc__step-line--done'
                    )}
                  />
                )}
              </div>
              <div className="wa-mcc__step-body">
                <div className="wa-mcc__step-name-row">
                  <span className={cx('wa-mcc__step-name', `wa-mcc__step-name--${step.status}`)}>
                    {step.label}
                  </span>
                  {step.status === 'current' && <span className="wa-mcc__step-tag">In progress</span>}
                </div>
                <div className="wa-mcc__step-note">{step.note}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="wa-mcc__next-step">
        <div className="wa-mcc__next-step-head">
          <Icon name="upload" size={16} />
          <span>Your next step</span>
        </div>
        <p className="wa-mcc__next-step-body">
          <Html html={profile.next_step_body || '<span>You are up to date for now.</span>'} />
        </p>
        <a className="wa-mcc__btn wa-mcc__btn--gold wa-mcc__btn--sm" href={safeLink(profile.next_step_cta_url)}>
          {profile.next_step_cta_label || 'Continue'}
          <Icon name="arrow" size={13} />
        </a>
      </div>
    </section>
  )
}

function DashboardBanner({
  profile,
  dismissed,
  onDismiss,
}: {
  profile: PreviewProfile
  dismissed: boolean
  onDismiss: () => void
}) {
  if (dismissed || profile.banner_type === 'none') return null

  const isLapsed = profile.membership_status === 'Lapsed'
  const tone = isLapsed ? 'danger' : profile.banner_type === 'invoice' ? 'info' : profile.banner_type === 'event' ? 'accent' : 'warning'
  const icon = isLapsed ? 'warning' : profile.banner_type === 'invoice' ? 'card' : profile.banner_type === 'event' ? 'calendar' : 'shield'

  return (
    <div className={cx('wa-mcc__banner', `wa-mcc__banner--${tone}`)}>
      <span className="wa-mcc__banner-icon">
        <Icon name={icon} size={20} />
      </span>
      <div className="wa-mcc__banner-copy">
        <div className="wa-mcc__banner-title">{profile.banner_title}</div>
        <div className="wa-mcc__banner-body">
          <Html html={profile.banner_body} />
        </div>
      </div>
      <div className="wa-mcc__banner-actions">
        <a
          className={cx('wa-mcc__btn wa-mcc__btn--sm', isLapsed ? 'wa-mcc__btn--danger' : 'wa-mcc__btn--navy')}
          href={safeLink(profile.banner_cta_url)}
        >
          {profile.banner_cta_label || 'View'}
        </a>
        <button className="wa-mcc__banner-dismiss" type="button" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  )
}

function CoursesAndEventsTile({
  profile,
  courses,
  events,
}: {
  profile: PreviewProfile
  courses: CourseItem[]
  events: EventItem[]
}) {
  const profileState = profileStateCode(profile)
  // Issue 28: a two-button state/National toggle rendered "National" twice
  // whenever the member's own state was unknown/National. Use an explicit
  // location select instead - default to the member's state when known.
  const [locationFilter, setLocationFilter] = useState<string>(
    profileState !== 'National' ? profileState : 'all',
  )
  // When the profile selector switches to a member in another state, resync the
  // location filter to the new profile's state (adjust-state-during-render).
  const prevProfileStateRef = useRef(profileState)
  if (prevProfileStateRef.current !== profileState) {
    prevProfileStateRef.current = profileState
    setLocationFilter(profileState !== 'National' ? profileState : 'all')
  }

  const entitledToMemberRate = isPricingMember(profile)
  const profileTierForPricing = pricingTier(profile)

  const cards = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayMs = today.getTime()

    const courseCards = courses.map((course) => ({
      id: `course-${course.id}`,
      type: 'Course',
      title: course.name,
      city: course.city,
      state: normaliseStateCode(course.state || 'National'),
      date: course.start_date,
      status: course.status || 'Available',
      url: course.url || '/courses',
      memberPrice: entitledToMemberRate
        ? memberRegistrationPrice(course, profileTierForPricing)
        : 0,
      nonMemberPrice: numericValue(course.price_non_member),
      meta: course.delivery_mode || course.category || 'Training',
    }))

    const eventCards = events.map((event) => ({
      id: `event-${event.id}`,
      type: event.type || 'Event',
      title: event.name,
      city: event.location,
      state: normaliseStateCode(event.state || 'National'),
      date: event.date,
      status: event.members_only ? 'Members only' : 'Open',
      url: event.url || '/events',
      memberPrice: 0,
      nonMemberPrice: 0,
      meta: event.type || 'Event',
    }))

    return [...courseCards, ...eventCards]
      .filter((item) => {
        if (!isUpcomingOrUndated(item.date, todayMs)) return false
        if (locationFilter === 'all') return true
        return item.state === locationFilter || item.state === 'National'
      })
      .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
  }, [courses, events, locationFilter, profileState, entitledToMemberRate, profileTierForPricing])

  return (
    <section className="wa-mcc__tile" id="courses-events-near-you">
      <div className="wa-mcc__courses-head">
        <div className="wa-mcc__tile-title-group">
          <span className="wa-mcc__tile-icon wa-mcc__tile-icon--accent">
            <Icon name="calendar" />
          </span>
          <h2 className="wa-mcc__tile-title">Courses & events near you</h2>
        </div>
        <div className="wa-mcc__course-filter">
          <label className="wa-mcc__course-filter-label" htmlFor="wa-mcc-location-filter">
            <Icon name="map" size={13} />
            <span>Location</span>
          </label>
          <select
            id="wa-mcc-location-filter"
            className="wa-mcc__course-filter-select"
            value={locationFilter}
            onChange={(event) => setLocationFilter(event.target.value)}
          >
            <option value="all">All Australia</option>
            {STATE_CODES_BY_PRIORITY.map((code) => (
              <option key={code} value={code}>
                {STATE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="wa-mcc__courses-sub">
        <Icon name="map" size={13} />
        {locationFilter === 'all' ? (
          <>
            Showing <strong>{cards.length}</strong> upcoming courses and events across all locations.
          </>
        ) : (
          <>
            Showing <strong>{cards.length}</strong> upcoming courses and events in <strong>{STATE_LABELS[locationFilter]}</strong> or <strong>National</strong>.
          </>
        )}
      </div>

      {cards.length > 0 ? (
        <div className="wa-mcc__course-grid">
          {cards.map((item) => {
            // HubL hands this one the RAW option name ("Sold Out"), where the course
            // modules hand theirs a slug — which is why two hand-written spellings were
            // being compared here. One mapper reads every spelling.
            const soldOut = hubdbStatusToSessionStatus(item.status) === 'sold_out'
            const isEvent = item.id.startsWith('event-')
            const isWaitlistAction = isEvent && soldOut
            const hasMemberPrice = !isEvent && item.memberPrice > 0
            const hasMemberDiscount = hasMemberPrice && item.nonMemberPrice > item.memberPrice
            const courseActualPrice = hasMemberPrice ? item.memberPrice : item.nonMemberPrice
            return (
              <article className="wa-mcc__course-card" key={item.id}>
                <div className="wa-mcc__course-top">
                  <div>
                    <div className={cx('wa-mcc__course-type', isEvent ? 'wa-mcc__course-type--event' : 'wa-mcc__course-type--course')}>
                      {isEvent ? 'Event' : 'Course'}
                    </div>
                    <h3 className="wa-mcc__course-name">{item.title}</h3>
                  </div>
                  <span className={cx('wa-mcc__course-status', soldOut && 'wa-mcc__course-status--sold')}>
                    {item.status}
                  </span>
                </div>
                <div className="wa-mcc__course-meta">
                  <span>
                    <Icon name="map" size={12} />
                    {item.city || item.state}
                  </span>
                  <span>
                    <Icon name="calendar" size={12} />
                    {formatDateShort(item.date)}
                  </span>
                </div>
                <div className="wa-mcc__course-price">
                  {isEvent ? (
                    <>
                      <div className="wa-mcc__course-price-member">Member event</div>
                      <div className="wa-mcc__course-price-meta">{item.meta}</div>
                    </>
                  ) : (
                    <>
                      {hasMemberDiscount && (
                        <div className="wa-mcc__course-price-non">{formatMoney(item.nonMemberPrice)}</div>
                      )}
                      {courseActualPrice > 0 && (
                        <div className="wa-mcc__course-price-member">
                          {/* QA ref 36: HubDB course prices are ex GST (CLAUDE.md 7.1). */}
                          {formatMoney(courseActualPrice)}{' '}
                          <span>{hasMemberDiscount ? 'ex GST (member)' : 'ex GST (course fee)'}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="wa-mcc__course-actions">
                  <a
                    className={cx(
                      'wa-mcc__course-action',
                      isWaitlistAction ? 'wa-mcc__course-action--outline' : 'wa-mcc__course-action--primary',
                    )}
                    href={safeLink(item.url, isEvent ? '/events' : '/courses')}
                  >
                    {isWaitlistAction ? 'Join waitlist' : isEvent ? 'View event' : 'View details'}
                    {!isWaitlistAction && <Icon name="arrow" size={12} />}
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="wa-mcc__empty-card">
          No matching courses or events are currently available. <a href="/courses">Browse all training</a>.
        </div>
      )}
    </section>
  )
}

function FinancialsTile({ profile }: { profile: PreviewProfile }) {
  const outstanding = getOutstandingPayable(profile)
  const financialItems = useMemo(() => {
    return [...(profile.financial_items || [])]
      .filter(
        (item) =>
          item &&
          (item.name ||
            numericValue(item.amount) > 0 ||
            item.pdf_url ||
            financialItemIsPayable(item)),
      )
      .sort((a, b) => (dateValue(b.date) ?? 0) - (dateValue(a.date) ?? 0))
  }, [profile.financial_items])
  const hasFinancialItems = financialItems.length > 0
  const totalRecorded = financialItems.reduce((sum, item) => sum + numericValue(item.amount), 0)
  const totalOutstanding = financialItems.reduce(
    (sum, item) => sum + (financialItemIsPayable(item) ? numericValue(item.balance_due) : 0),
    0,
  )
  const isDue = Boolean(outstanding) || profile.invoice_status === 'Due' || profile.invoice_status === 'Overdue'
  const hasInvoiceData = Boolean(
    outstanding ||
      profile.invoice_number ||
      profile.invoice_pdf_url ||
      profile.invoice_pay_url ||
      profile.invoice_date ||
      Number(profile.invoice_amount || 0) > 0,
  )

  if (hasFinancialItems) {
    return (
      <section className="wa-mcc__tile">
        <div className="wa-mcc__tile-head">
          <div className="wa-mcc__tile-title-group">
            <span className="wa-mcc__tile-icon">
              <Icon name="card" />
            </span>
            <h2 className="wa-mcc__tile-title">Financials</h2>
          </div>
          <a href="#portal-invoices" className="wa-mcc__tile-link">
            View all <Icon name="arrow" size={12} />
          </a>
        </div>

        {outstanding && (
          <div
            className={cx(
              'wa-mcc__invoice-alert',
              outstanding.overdue ? 'wa-mcc__invoice-alert--overdue' : 'wa-mcc__invoice-alert--due',
            )}
          >
            <div className="wa-mcc__invoice-alert-top">
              <div>
                <div className="wa-mcc__invoice-alert-label">
                  {outstanding.overdue ? 'Overdue' : 'Due soon'}
                </div>
                <div className="wa-mcc__invoice-alert-name">
                  {outstanding.name}
                  {profile.member_tier ? ` · ${profile.member_tier} renewal` : ''}
                </div>
              </div>
              <div className="wa-mcc__invoice-alert-amount">{formatMoney(outstanding.balance_due)}</div>
            </div>
            <a
              className={cx(
                'wa-mcc__btn wa-mcc__btn--sm wa-mcc__btn--full',
                outstanding.overdue ? 'wa-mcc__btn--danger' : 'wa-mcc__btn--navy',
              )}
              href={safeLink(outstanding.pay_url)}
            >
              {outstanding.overdue ? 'Pay overdue invoice' : 'Pay invoice now'}{' '}
              <Icon name="arrow" size={13} />
            </a>
          </div>
        )}

        <div className="wa-mcc__financial-summary">
          <div>
            <span>Total recorded</span>
            <strong>{formatMoney(totalRecorded)}</strong>
          </div>
          <div>
            <span>{totalOutstanding > 0 ? 'Outstanding' : 'Payment records'}</span>
            <strong>{totalOutstanding > 0 ? formatMoney(totalOutstanding) : financialItems.length}</strong>
          </div>
        </div>

        <div className="wa-mcc__section-label">Recent payments</div>
        <div className="wa-mcc__finance-list">
          {financialItems.slice(0, 3).map((item) => {
            const hasPdf = Boolean(item.pdf_url)
            const canPay = financialItemIsPayable(item)
            const amount = numericValue(item.amount)
            const balance = numericValue(item.balance_due)
            const amountLabel =
              canPay && balance > 0
                ? `${formatMoney(balance)} due`
                : amount > 0
                  ? formatMoney(amount)
                  : 'Amount pending'
            return (
              <div className="wa-mcc__invoice-row" key={item.id || item.name}>
                <span className="wa-mcc__invoice-row-icon">
                  <Icon name={canPay ? 'card' : hasPdf ? 'download' : 'doc'} />
                </span>
                <div className="wa-mcc__invoice-row-copy">
                  <div className="wa-mcc__invoice-row-num">{item.name || 'Payment record'}</div>
                  <div className="wa-mcc__invoice-row-meta">
                    {amountLabel} · {item.status || 'Payment recorded'} {formatDateShort(item.date, '')}
                  </div>
                </div>
                <div className="wa-mcc__finance-actions">
                  {canPay && (
                    <a
                      className="wa-mcc__finance-action wa-mcc__finance-action--pay"
                      href={safeLink(item.pay_url)}
                      aria-label={`Pay ${formatMoney(balance)} for ${item.name}`}
                    >
                      Pay
                    </a>
                  )}
                  {hasPdf ? (
                    <a
                      className="wa-mcc__finance-action"
                      href={safeLink(item.pdf_url)}
                      aria-label={`Download receipt for ${item.name}`}
                    >
                      PDF
                    </a>
                  ) : (
                    !canPay && <span className="wa-mcc__paid-pill">Recorded</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {!outstanding && (
          <div className="wa-mcc__financials-footer wa-mcc__financials-footer--actions">
            <a className="wa-mcc__tile-link wa-mcc__tile-link--button" href={membershipUpgradeUrl(profile.member_tier)}>
              Upgrade membership <Icon name="arrow" size={12} />
            </a>
            {profile.membership_status === 'Lapsed' && (
              <a className="wa-mcc__tile-link" href={membershipRenewalUrl(profile.member_tier)}>
                Renew membership <Icon name="arrow" size={12} />
              </a>
            )}
          </div>
        )}
      </section>
    )
  }

  if (!hasInvoiceData) {
    return (
      <section className="wa-mcc__tile">
        <div className="wa-mcc__tile-head">
          <div className="wa-mcc__tile-title-group">
            <span className="wa-mcc__tile-icon">
              <Icon name="card" />
            </span>
            <h2 className="wa-mcc__tile-title">Financials</h2>
          </div>
          <span className="wa-mcc__sync-chip">No recent activity</span>
        </div>
        <div className="wa-mcc__empty-card">
          No recent invoices or receipts are available for this account yet.
        </div>
        <div className="wa-mcc__financials-footer wa-mcc__financials-footer--actions">
          <a className="wa-mcc__tile-link wa-mcc__tile-link--button" href={membershipUpgradeUrl(profile.member_tier)}>
            Upgrade membership <Icon name="arrow" size={12} />
          </a>
          {profile.membership_status === 'Lapsed' && (
            <a className="wa-mcc__tile-link" href={membershipRenewalUrl(profile.member_tier)}>
              Renew membership <Icon name="arrow" size={12} />
            </a>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="wa-mcc__tile">
      <div className="wa-mcc__tile-head">
        <div className="wa-mcc__tile-title-group">
          <span className="wa-mcc__tile-icon">
            <Icon name="card" />
          </span>
          <h2 className="wa-mcc__tile-title">Financials</h2>
        </div>
        <a href="#portal-invoices" className="wa-mcc__tile-link">
          View all <Icon name="arrow" size={12} />
        </a>
      </div>

      {isDue && outstanding && (
        <div
          className={cx(
            'wa-mcc__invoice-alert',
            outstanding.overdue ? 'wa-mcc__invoice-alert--overdue' : 'wa-mcc__invoice-alert--due',
          )}
        >
          <div className="wa-mcc__invoice-alert-top">
            <div>
              <div className="wa-mcc__invoice-alert-label">
                {outstanding.overdue ? 'Overdue' : 'Due soon'}
              </div>
              <div className="wa-mcc__invoice-alert-name">
                {outstanding.number || outstanding.name}
                {profile.member_tier ? ` · ${profile.member_tier} renewal` : ''}
              </div>
            </div>
            <div className="wa-mcc__invoice-alert-amount">{formatMoney(outstanding.balance_due)}</div>
          </div>
          <a
            className={cx(
              'wa-mcc__btn wa-mcc__btn--sm wa-mcc__btn--full',
              outstanding.overdue ? 'wa-mcc__btn--danger' : 'wa-mcc__btn--navy',
            )}
            href={safeLink(outstanding.pay_url)}
          >
            {outstanding.overdue ? 'Pay overdue invoice' : 'Pay invoice now'}{' '}
            <Icon name="arrow" size={13} />
          </a>
        </div>
      )}

      <div className="wa-mcc__section-label">Latest invoice</div>
      <div className="wa-mcc__invoice-row">
        <span className="wa-mcc__invoice-row-icon">
          <Icon name="doc" />
        </span>
        <div className="wa-mcc__invoice-row-copy">
          <div className="wa-mcc__invoice-row-num">{profile.invoice_number || 'No recent invoice'}</div>
          <div className="wa-mcc__invoice-row-meta">
            {formatMoney(profile.invoice_amount)} · {profile.invoice_status}{' '}
            {formatDateShort(profile.invoice_date, '')}
          </div>
        </div>
        <span className={cx('wa-mcc__paid-pill', profile.invoice_status !== 'Paid' && 'wa-mcc__paid-pill--due')}>
          {profile.invoice_status}
        </span>
      </div>

      {profile.invoice_pdf_url ? (
        <a className="wa-mcc__btn wa-mcc__btn--outline wa-mcc__btn--sm wa-mcc__btn--full" href={safeLink(profile.invoice_pdf_url)}>
          <Icon name="download" size={15} />
          Download latest invoice (PDF)
        </a>
      ) : null}
      <div className="wa-mcc__financials-footer">
        <span>Receipts & statement</span>
      </div>
    </section>
  )
}

function TeamTile({ profile, teamUrl }: { profile: PreviewProfile; teamUrl: string }) {
  if (!profile.is_primary_admin) return null

  const voucherRemaining = Math.max(0, (profile.training_vouchers_total || 0) - (profile.training_vouchers_used || 0))
  const ticketsRemaining = Math.max(0, (profile.summit_tickets_total || 0) - (profile.summit_tickets_used || 0))

  return (
    <section className="wa-mcc__tile">
      <div className="wa-mcc__tile-head">
        <div className="wa-mcc__tile-title-group">
          <span className="wa-mcc__tile-icon wa-mcc__tile-icon--accent">
            <Icon name="team" />
          </span>
          <h2 className="wa-mcc__tile-title">Manage my team</h2>
        </div>
        <span className="wa-mcc__badge-admin">Primary admin</span>
      </div>

      <div className="wa-mcc__team-stats">
        <div className="wa-mcc__team-stat">
          <div className="wa-mcc__team-stat-value">{profile.team_linked_employees || 0}</div>
          <div className="wa-mcc__team-stat-key">Linked employees</div>
          <div className="wa-mcc__team-stat-sub">{profile.team_active_members || 0} with active individual memberships</div>
        </div>
        <div className="wa-mcc__team-stat">
          <div className="wa-mcc__team-stat-value">
            {profile.training_vouchers_used || 0} / {profile.training_vouchers_total || 0}
          </div>
          <div className="wa-mcc__team-stat-key">Training vouchers</div>
          <div className="wa-mcc__team-stat-sub">{voucherRemaining} remaining this period</div>
        </div>
        <div className="wa-mcc__team-stat">
          <div className="wa-mcc__team-stat-value">
            {profile.summit_tickets_used || 0} / {profile.summit_tickets_total || 0}
          </div>
          <div className="wa-mcc__team-stat-key">Summit tickets</div>
          <div className="wa-mcc__team-stat-sub">{ticketsRemaining} unused in allocation</div>
        </div>
      </div>

      <a className="wa-mcc__btn wa-mcc__btn--navy wa-mcc__btn--sm wa-mcc__btn--full" href={teamUrl}>
        Open team management
        <Icon name="arrow" size={13} />
      </a>
    </section>
  )
}

function ResourceLibraryTile({
  profile,
  resources,
  resourcesUrl,
}: {
  profile: PreviewProfile
  resources: ResourceItem[]
  resourcesUrl: string
}) {
  const rank = !profile.is_linked_member || profile.membership_status === 'Lapsed' ? 0 : tierRank(profile.member_tier)
  const rows = resources.slice(0, 4)

  return (
    <section className="wa-mcc__tile">
      <div className="wa-mcc__tile-head">
        <div className="wa-mcc__tile-title-group">
          <span className="wa-mcc__tile-icon wa-mcc__tile-icon--accent">
            <Icon name="doc" />
          </span>
          <h2 className="wa-mcc__tile-title">Resource library</h2>
        </div>
        <a href={resourcesUrl} className="wa-mcc__tile-link">
          Browse all <Icon name="arrow" size={12} />
        </a>
      </div>

      {rows.length > 0 ? (
        <div className="wa-mcc__resource-list">
          {rows.map((resource) => {
            const reqRank = requiredTierRank(resource.required_tier)
            const locked = reqRank > rank
            return (
              <div className={cx('wa-mcc__resource-row', locked && 'wa-mcc__resource-row--locked')} key={resource.id}>
                <span className="wa-mcc__resource-row-icon">
                  <Icon name={locked ? 'lock' : 'doc'} size={16} />
                </span>
                <div className="wa-mcc__resource-row-copy">
                  <div className="wa-mcc__resource-row-name">{resource.title}</div>
                  <div className="wa-mcc__resource-row-meta">
                    {locked ? `${resource.required_tier || 'member'} tier required` : resource.file_type || resource.category || 'Resource'}
                  </div>
                </div>
                {locked ? (
                  <a href={membershipUpgradeUrl(profile.member_tier)} className="wa-mcc__resource-action">
                    Upgrade
                  </a>
                ) : (
                  <a href={safeLink(resource.file_url, resourcesUrl)} className="wa-mcc__resource-download" aria-label={`Open ${resource.title}`}>
                    <Icon name="download" size={17} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="wa-mcc__empty-mini">No member resources are available yet.</div>
      )}
    </section>
  )
}

function PreviewSelector({
  profiles,
  selectedKey,
  onChange,
  showStrip,
  showSelector,
}: {
  profiles: PreviewProfile[]
  selectedKey: string
  onChange: (key: string) => void
  showStrip: boolean
  showSelector: boolean
}) {
  if (!showStrip) return null

  if (profiles.length <= 1) {
    const profile = profiles[0]
    return (
      <div className="wa-mcc__preview-strip">
        <div>
          <strong>Private member dashboard</strong>
          <span>
            {profile?.is_linked_member
              ? 'Showing your Weld Australia member dashboard.'
              : 'Your member details are still being connected.'}
          </span>
        </div>
      </div>
    )
  }

  if (!showSelector) {
    return (
      <div className="wa-mcc__preview-strip">
        <div>
          <strong>Private member dashboard</strong>
          <span>More than one membership profile is available. The first profile is shown.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="wa-mcc__preview-strip">
      <div>
        <strong>Membership profiles</strong>
        <span>Select the profile you want to review.</span>
      </div>
      <label>
        <span>Member profile</span>
        <select value={selectedKey} onChange={(event) => onChange(event.target.value)}>
          {profiles.map((profile) => (
            <option value={profile.profile_key} key={profile.profile_key}>
              {getProfileOptionLabel(profile)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function MemberCommandCentre({
  profiles = [],
  courses = [],
  events = [],
  resources = [],
  settings,
  labels,
}: MemberCommandCentreProps) {
  const [selectedKey, setSelectedKey] = useState(profiles[0]?.profile_key ?? '')
  const [dismissedBannerKey, setDismissedBannerKey] = useState('')

  const profile = profiles.find((item) => item.profile_key === selectedKey) ?? profiles[0]
  const greeting = getGreeting()

  if (!profile) {
    return (
      <div className="wa-mcc wa-mcc--empty">
        <div className="wa-mcc__empty-state">
          <h2>We could not load your member dashboard</h2>
          <p>
            Please refresh the page or contact Weld Australia if this keeps happening.
          </p>
        </div>
      </div>
    )
  }

  const profileUrlCandidate = (labels?.profileUrl || '').trim()
  const profileUrl =
    profileUrlCandidate && !['/membership', '/member-preview-1', '/member-preview-1/'].includes(profileUrlCandidate)
      ? profileUrlCandidate
      : '#portal-profile'

  const dashboardLabels = {
    trainingUrl: labels?.trainingUrl || '/courses',
    profileUrl,
    membershipUrl: labels?.membershipUrl || '/membership',
    resourcesUrl: labels?.resourcesUrl || '/resources',
    teamUrl: labels?.teamUrl || '/membership',
    supportPhone: labels?.supportPhone || '1300 660 660',
    supportUrl: labels?.supportUrl || '/contact',
  }

  const accent = profile.accent || 'gold'
  const theme = profile.is_linked_member ? tierTheme(profile.member_tier) : 'gold'
  const bannerKey = `${profile.profile_key}-${profile.banner_title}`
  const bannerDismissed = dismissedBannerKey === bannerKey
  const displayName = getProfileDisplayName(profile)
  const profileMeta = getProfileMeta(profile)
  const statusMeta = STATUS_META[profile.membership_status] ?? STATUS_META.Active
  const heroMembershipType = getMembershipTypeLabel(profile) || profile.member_tier || 'Member'
  const heroStateCode = profileStateCode(profile)
  const heroStateLabel = STATE_LABELS[heroStateCode] ?? heroStateCode
  const heroValidUntil = isHonoraryProfile(profile)
    ? 'Does not expire'
    : formatDate(profile.renewal_date, 'To be confirmed')
  const heroMemberSince = formatDate(profile.member_since, 'To be confirmed')
  // Membership manage CTAs: outstanding HubSpot invoice → pay that invoice;
  // lapsed → renew via tier payment link; inside the 60-day window with no
  // open invoice → upgrade (card auto-renews; invoice members pay from Financials).
  const heroOutstanding = getOutstandingPayable(profile)
  const heroMembershipAction = isHonoraryProfile(profile)
    ? null
    : getMembershipHeroAction(profile, heroOutstanding)
  const heroMemberId = statFallback(profile.member_id, 'Not available')
  const heroLinkedSeats = numericValue(profile.linked_seats)
  const dashboardSettings = normaliseSettings(settings)
  const tiles = dashboardSettings.tiles
  const hasMainTiles = tiles.certification || tiles.coursesEvents
  const hasAsideTiles = tiles.financials || tiles.team || tiles.resources

  return (
    <div
      className={cx(
        'wa-mcc',
        `wa-mcc--${accent}`,
        `wa-mcc--tier-${theme}`,
        `wa-mcc--layout-${dashboardSettings.layoutVariant}`,
        `wa-mcc--cards-${dashboardSettings.cardStyle}`,
        `wa-mcc--density-${dashboardSettings.density}`,
        `wa-mcc--hero-${dashboardSettings.heroStyle}`,
        profile.membership_status === 'Lapsed' && 'wa-mcc--lapsed',
      )}
    >
      <PreviewSelector
        profiles={profiles}
        selectedKey={profile.profile_key}
        showStrip={dashboardSettings.showPreviewBar}
        showSelector={dashboardSettings.showProfileSelector}
        onChange={(key) => {
          setSelectedKey(key)
          setDismissedBannerKey('')
        }}
      />

      <div className="wa-mcc__app">
        <main className="wa-mcc__main">
          <section className="wa-mcc__hero" aria-labelledby="wa-mcc-hero-heading">
            <div className="wa-mcc__hero-inner">
              <div className="wa-mcc__hero-copy">
                <div className="wa-overline wa-overline--light wa-mcc__hero-eyebrow">
                  <span className="wa-overline__text">Member Command Centre</span>
                </div>
                <h1 id="wa-mcc-hero-heading">{greeting}, {displayName}.</h1>
                {profileMeta && <p className="wa-mcc__hero-meta">{profileMeta}</p>}
                <p className="wa-mcc__hero-lead">
                  Manage your Weld Australia membership, training, events, resources and payment records from one secure place.
                </p>
                {dashboardSettings.showHeaderActions && (
                  <div className="wa-mcc__hero-actions">
                    <a className="wa-mcc__btn wa-mcc__btn--outline" href={dashboardLabels.trainingUrl}>
                      Book a course <Icon name="arrow" size={13} />
                    </a>
                    <a className="wa-mcc__btn wa-mcc__btn--navy" href={dashboardLabels.profileUrl}>
                      Update my details <Icon name="arrow" size={13} />
                    </a>
                  </div>
                )}
              </div>

              <aside className={cx('wa-mcc__hero-card', `wa-mcc__hero-card--${theme}`)} aria-label="Membership summary">
                <div className="wa-mcc__hero-card-top">
                  <span className="wa-mcc__hero-card-icon">
                    <Icon name="shield" />
                  </span>
                  <span className={cx('wa-mcc__hero-status', `wa-mcc__hero-status--${statusMeta.tone}`)}>
                    {statusMeta.label}
                  </span>
                </div>
                <div className="wa-mcc__hero-card-title">{heroMembershipType}</div>
                {profile.company_name && <div className="wa-mcc__hero-card-company">{profile.company_name}</div>}
                <dl className="wa-mcc__hero-facts">
                  <div>
                    <dt>Member ID</dt>
                    <dd>{heroMemberId}</dd>
                  </div>
                  <div>
                    <dt>Member since</dt>
                    <dd>{heroMemberSince}</dd>
                  </div>
                  <div>
                    <dt>Location</dt>
                    <dd>{heroStateLabel}</dd>
                  </div>
                  <div>
                    <dt>Valid until</dt>
                    <dd>{heroValidUntil}</dd>
                  </div>
                </dl>
                {heroMembershipAction && (
                  <div className="wa-mcc__hero-renew-wrap">
                    <a
                      className={cx(
                        'wa-mcc__btn wa-mcc__btn--sm wa-mcc__btn--full wa-mcc__hero-renew',
                        heroMembershipAction.danger ? 'wa-mcc__btn--danger' : 'wa-mcc__btn--navy',
                      )}
                      href={safeLink(heroMembershipAction.href)}
                    >
                      {heroMembershipAction.label}
                      <Icon name="arrow" size={13} />
                    </a>
                    {heroMembershipAction.note && (
                      <p className="wa-mcc__hero-renew-note">{heroMembershipAction.note}</p>
                    )}
                    {heroMembershipAction.kind === 'pay_invoice' && (
                      <a
                        className="wa-mcc__hero-renew-secondary"
                        href={membershipUpgradeUrl(profile.member_tier)}
                      >
                        Or upgrade membership <Icon name="arrow" size={12} />
                      </a>
                    )}
                    {heroMembershipAction.kind === 'renew' && (
                      <a
                        className="wa-mcc__hero-renew-secondary"
                        href={membershipUpgradeUrl(profile.member_tier)}
                      >
                        Or upgrade instead <Icon name="arrow" size={12} />
                      </a>
                    )}
                  </div>
                )}
                {heroLinkedSeats > 0 && (
                  <div className="wa-mcc__hero-seats">
                    <div className="wa-mcc__hero-seats-copy">
                      <span className="wa-mcc__hero-seats-value">
                        Linked seats: <strong>{heroLinkedSeats}</strong>
                      </span>
                      <span className="wa-mcc__hero-seats-help">
                        Team members linked to your corporate membership.
                      </span>
                    </div>
                    {profile.is_primary_admin && (
                      <a className="wa-mcc__hero-seats-link" href={dashboardLabels.teamUrl}>
                        Manage team <Icon name="arrow" size={12} />
                      </a>
                    )}
                  </div>
                )}
              </aside>
            </div>
            <span className="wa-mcc__hero-accent" aria-hidden="true" />
          </section>

          <div className="wa-mcc__dashboard-shell">
            {dashboardSettings.showAlertBanner && (
              <DashboardBanner
                profile={profile}
                dismissed={bannerDismissed}
                onDismiss={() => setDismissedBannerKey(bannerKey)}
              />
            )}

            <div className="wa-mcc__dash-grid">
              {hasMainTiles && (
                <div className="wa-mcc__col-main">
                  {tiles.certification && <CertificationTile profile={profile} />}
                  {tiles.coursesEvents && <CoursesAndEventsTile profile={profile} courses={courses} events={events} />}
                </div>
              )}
              {hasAsideTiles && (
                <aside className="wa-mcc__col-aside">
                  {tiles.financials && <FinancialsTile profile={profile} />}
                  {tiles.team && <TeamTile profile={profile} teamUrl={dashboardLabels.teamUrl} />}
                  {tiles.resources && <ResourceLibraryTile profile={profile} resources={resources} resourcesUrl={dashboardLabels.resourcesUrl} />}
                </aside>
              )}
            </div>

            {dashboardSettings.showDataNote && (
              <p className="wa-mcc__data-note">
                {profile.is_linked_member ? (
                  <>
                    Your dashboard is personalised from your Weld Australia member profile. Some sections may appear when new membership, training or
                    finance details become available.
                  </>
                ) : (
                  <>
                    {/* Issue 30: this used to be the whole message - a statement
                        of the problem with nothing the member could do about it.
                        Most people who land here are employees of a member
                        company whose contact record was never associated, and
                        they can resolve it themselves from the profile page. */}
                    Your login is active, but your membership details still need to be connected before member-specific benefits can appear.{' '}
                    <a className="wa-mcc__data-note-link" href={dashboardLabels.profileUrl}>
                      Connect your company
                    </a>{' '}
                    to have member pricing applied to your training and event bookings.
                  </>
                )}
                {plainText(profile.banner_body) ? '' : ''}
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
