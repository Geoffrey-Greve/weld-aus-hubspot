import React, { useState, useMemo } from 'react'
import { submitHubSpotForm } from '@shared/api/forms'
import { CITY_ORDER, orderCitiesForRows, sameCity } from '@shared/courseCities'
import { type AvailabilityResponse, applyAvailability } from '@shared/api/eventEngine'
import { useLiveAvailability } from '@shared/api/useLiveAvailability'
import { type HubdbStatus, statusPresentation } from '@shared/status/sessionStatus'
import { formatCurrencyDollars } from '@shared/utils/formatCurrency'
import { formatDateRange } from '@shared/utils/formatDate'
import { buildRegistrationUrl } from '@shared/utils/registration'
import { resolveMemberPrice } from '@shared/utils/memberPricing'
import { saveCheckoutPricingHandoff } from '@shared/utils/checkoutPricingHandoff'
import './CourseFilter.css'

// ---------------------------------------------------------------------------
// Types (mirrors HubDB Table 1 - courses, per CLAUDE.md §7.1)
// ---------------------------------------------------------------------------

export interface CourseRow {
  id: number | string
  course_name: string
  city: string
  category?: string
  delivery_mode?: string
  duration?: string
  photo_url?: string
  photo_alt?: string
  start_date: string // ISO 'YYYY-MM-DD'
  end_date: string // ISO 'YYYY-MM-DD'
  price_member: number
  price_individual?: number
  price_student?: number
  price_bronze?: number
  price_silver?: number
  price_gold?: number
  price_non_member: number
  registration_url: string
  /** The HubDB `status` column, slugged by HubL. `closed` is Ref 74c. */
  status: HubdbStatus
  seats_remaining?: number | null
  seats_remaining_is_set?: boolean
  /** When true, registration flows through the Event Engine checkout tunnel
   *  (/checkout/?session_id=) instead of the external hapily URL. */
  use_event_engine?: boolean
  /** Event Engine event id, used to read live seat availability for this session. */
  worker_event_id?: string
}

export interface CourseFilterProps {
  rows: CourseRow[]
  /** Explicit entitlement flag supplied by HubL for the logged-in visitor. */
  member_is_member?: boolean
  /** Membership tier used for the external registration handoff when available. */
  member_tier: string
  /** 'any' shows every session across all locations; 'auto' selects the first city that has sessions; any city name pre-selects it. */
  default_city: string
  /** 'any' shows all delivery modes; a mode name pre-selects it. */
  default_delivery_mode: string
  show_pricing: boolean
  show_seats_remaining: boolean
  register_cta_label: string
  contact_cta_label?: string
  eoi_form_id: string
  eoi_heading: string
  /** Raw HTML from HubSpot richtext field - safe to render via dangerouslySetInnerHTML. */
  eoi_message: string
  portal_id: string
  /**
   * Event Engine worker. Blank on a page that has not been configured for it, which is a
   * supported state: every card falls back to the HubDB row.
   */
  worker_base_url?: string
  worker_portal_id?: string
}

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------
//
// The selector offers the canonical order (@shared/courseCities) UNION every
// city these sessions are actually in. Both halves are load-bearing:
//
//   • the canonical half keeps a city with nothing scheduled selectable, which
//     is the only way a visitor reaches the expression-of-interest form;
//   • the rows half is what lets a session in a town the bundle has never heard
//     of be chosen at all. `courses.city` is a HubDB SELECT staff extend, so a
//     compiled-in list is a whitelist that goes stale - it hid every Mackay
//     session, then opened on Sydney and reported no sessions (QA 86).

// 'any' - no city filter - is the same token and the same behaviour as the
// /courses timetable (course-timetable-filter), down to the "All locations"
// label the selector shows. Every session for the course is listed, started
// ones included: they render as "Registrations closed" rather than vanishing,
// so the page never looks emptier than the course's actual history.
const ANY_CITY = 'any'

function isAnyCity(city: string | undefined): boolean {
  return (city ?? '').trim().toLowerCase() === ANY_CITY
}

function getInitialCity(rows: CourseRow[], defaultCity: string, cityOptions: string[]): string {
  const hasSessions = (city: string) => rows.some((r) => sameCity(r.city, city))

  if (isAnyCity(defaultCity)) return ANY_CITY

  if (defaultCity && defaultCity !== 'auto') {
    const match = cityOptions.find((c) => sameCity(c, defaultCity))
    if (match && hasSessions(match)) return match
  }

  // 'auto': the first city in display order that HAS sessions. Falling through
  // to cityOptions[0] only happens when nothing is scheduled anywhere, which is
  // the one case where an empty city is the honest answer.
  return cityOptions.find(hasSessions) ?? cityOptions[0] ?? CITY_ORDER[0] ?? 'Sydney'
}

function isUsableRegistrationUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed || trimmed === '#') return false

  try {
    const current = new URL(window.location.href)
    const parsed = new URL(trimmed, current.origin)
    const parsedPath = `${parsed.pathname.replace(/\/$/, '')}${parsed.search}`
    const currentPath = `${current.pathname.replace(/\/$/, '')}${current.search}`

    // A number of imported HubDB rows have a registration URL that points back
    // to the course detail page. Treat that as missing, otherwise the CTA opens
    // the same page in a new tab instead of starting enrolment.
    if (parsed.origin === current.origin && parsedPath === currentPath) {
      return false
    }

    return true
  } catch {
    return true
  }
}

function toBadgeSlug(value: string | undefined): string {
  return (
    (value || 'other')
      .toLowerCase()
      .trim()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'other'
  )
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function CourseFilter({
  rows,
  member_is_member,
  member_tier,
  default_city,
  default_delivery_mode,
  show_pricing,
  show_seats_remaining,
  register_cta_label,
  contact_cta_label = 'Contact to book',
  eoi_form_id,
  eoi_heading,
  eoi_message,
  portal_id,
  worker_base_url,
  worker_portal_id
}: CourseFilterProps): React.ReactElement {
  const isMember = member_is_member ?? Boolean(member_tier)

  // Live seats, read once per Event Engine-backed session on this page. Asked for EVERY
  // session rather than only the filtered ones: switching city must not make a card sit on
  // the stale HubDB count until a second request lands.
  const workerEventIds = useMemo(
    () => rows.filter((r) => r.use_event_engine).map((r) => r.worker_event_id ?? ''),
    [rows]
  )
  const live = useLiveAvailability(worker_base_url, worker_portal_id || portal_id, workerEventIds)

  const cityOptions = useMemo(() => orderCitiesForRows(rows), [rows])

  const [selectedCity, setSelectedCity] = useState<string>(() =>
    getInitialCity(rows, default_city, cityOptions)
  )

  // Distinct delivery modes present in this course's sessions.
  const deliveryModes = useMemo(() => {
    const seen = new Set<string>()
    return rows
      .map((r) => r.delivery_mode)
      .filter((d) => d && !seen.has(d) && (seen.add(d) as unknown as boolean))
  }, [rows])

  // Honour the editor's default delivery mode only when this course actually
  // offers it. An unmatched default (e.g. "Online" on a Face-to-Face-only
  // course) would otherwise filter every session out while the selector stays
  // hidden - a dead-end EOI state with no way to clear the filter.
  const [selectedDelivery, setSelectedDelivery] = useState<string>(() =>
    default_delivery_mode &&
    default_delivery_mode !== 'any' &&
    deliveryModes.includes(default_delivery_mode)
      ? default_delivery_mode
      : 'any'
  )

  // `mountReactIsland` re-renders this component in place when the HubSpot
  // editor changes data-props (src/shared/mount.ts), so hook state survives a
  // change of rows. A selection the new rows no longer offer would otherwise
  // filter everything out - fall back to a valid one for this render instead
  // of showing the EOI form next to a selector that disagrees with it.
  const activeCity = isAnyCity(selectedCity)
    ? ANY_CITY
    : (cityOptions.find((city) => sameCity(city, selectedCity)) ??
      getInitialCity(rows, default_city, cityOptions))

  // Nothing scheduled anywhere: no selector, and the EOI drops the city it
  // would otherwise name (see the render below).
  const hasSessions = rows.length > 0

  const activeDelivery =
    selectedDelivery === 'any' || deliveryModes.includes(selectedDelivery)
      ? selectedDelivery
      : 'any'

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (activeDelivery !== 'any' && r.delivery_mode !== activeDelivery) return false
        if (isAnyCity(activeCity)) return true
        return sameCity(r.city, activeCity)
      }),
    [rows, activeCity, activeDelivery]
  )

  // EOI form state
  const [eoiName, setEoiName] = useState('')
  const [eoiEmail, setEoiEmail] = useState('')
  const [eoiSubmitting, setEoiSubmitting] = useState(false)
  const [eoiSuccess, setEoiSuccess] = useState(false)
  const [eoiError, setEoiError] = useState('')

  async function handleEoiSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!eoi_form_id) return
    setEoiSubmitting(true)
    setEoiError('')
    try {
      await submitHubSpotForm(portal_id, eoi_form_id, {
        fields: [
          { name: 'firstname', value: eoiName },
          { name: 'email', value: eoiEmail },
          { name: 'course_eoi_city', value: isAnyCity(activeCity) ? '' : activeCity },
          {
            name: 'course_eoi_delivery',
            value: activeDelivery !== 'any' ? activeDelivery : ''
          }
        ],
        context: {
          pageUri: window.location.href,
          pageName: document.title
        }
      })
      setEoiSuccess(true)
    } catch {
      setEoiError('Something went wrong - please try again or contact us directly.')
    } finally {
      setEoiSubmitting(false)
    }
  }

  return (
    <div className="wa-course-filter">
      <div className="wa-course-filter__filters">
        {/* A course with no sessions at all has no location to choose between:
            the capitals are offered so a visitor whose own city has nothing
            scheduled can still reach the EOI form, and that argument does not
            survive an empty course. Picking Sydney there would only relabel
            the same form. */}
        {hasSessions && (
          <div className="wa-course-filter__field">
            <label className="wa-course-filter__city-label" htmlFor="wa-cf-city">
              Select a location
            </label>
            <select
              id="wa-cf-city"
              className="wa-course-filter__city-select"
              value={activeCity}
              onChange={(e) => {
                setSelectedCity(e.target.value)
                setEoiSuccess(false)
                setEoiError('')
              }}
            >
              {isAnyCity(default_city) && <option value={ANY_CITY}>All locations</option>}
              {cityOptions.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
        )}

        {deliveryModes.length > 1 && (
          <div className="wa-course-filter__field">
            {/* Own label class: the theme paints the small eyebrow above the
                label via ::before, so reusing __city-label here printed
                "Filter by location" over the delivery selector (defect 230). */}
            <label
              className="wa-course-filter__city-label wa-course-filter__delivery-label"
              htmlFor="wa-cf-delivery"
            >
              Select a delivery type
            </label>
            <select
              id="wa-cf-delivery"
              className="wa-course-filter__city-select"
              value={activeDelivery}
              onChange={(e) => {
                setSelectedDelivery(e.target.value)
                setEoiSuccess(false)
                setEoiError('')
              }}
            >
              <option value="any">All delivery types</option>
              {deliveryModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {filtered.length > 0 ? (
        <div className="wa-course-filter__sessions">
          {filtered.map((row) => (
            <SessionCard
              key={row.id}
              row={row}
              live={row.worker_event_id ? (live[row.worker_event_id] ?? null) : null}
              isMember={isMember}
              member_tier={member_tier}
              show_pricing={show_pricing}
              show_seats_remaining={show_seats_remaining}
              register_cta_label={register_cta_label}
              contact_cta_label={contact_cta_label}
            />
          ))}
        </div>
      ) : (
        <EoiForm
          heading={eoi_heading}
          message={eoi_message}
          city={hasSessions && !isAnyCity(activeCity) ? activeCity : ''}
          name={eoiName}
          email={eoiEmail}
          submitting={eoiSubmitting}
          success={eoiSuccess}
          error={eoiError}
          hasFormId={Boolean(eoi_form_id)}
          onNameChange={setEoiName}
          onEmailChange={setEoiEmail}
          onSubmit={handleEoiSubmit}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

interface SessionCardProps {
  row: CourseRow
  /** Live availability for this session, or null to keep rendering the HubDB row. */
  live: AvailabilityResponse | null
  isMember: boolean
  member_tier: string
  show_pricing: boolean
  show_seats_remaining: boolean
  register_cta_label: string
  contact_cta_label: string
}

function SessionCard({
  row,
  live,
  isMember,
  member_tier,
  show_pricing,
  show_seats_remaining,
  register_cta_label,
  contact_cta_label
}: SessionCardProps): React.ReactElement {
  const hasExplicitSeatsRemaining = row.seats_remaining_is_set === true
  const hubdbSeatsRemaining =
    typeof row.seats_remaining === 'number' && Number.isFinite(row.seats_remaining)
      ? row.seats_remaining
      : null
  // The Worker's answer where there is one, the HubDB row where there is not. The row's
  // status column and its seats_remaining are handed over separately and deliberately:
  // a hand-set Sold Out is final, a stale seat count is not.
  const state = applyAvailability(
    {
      status: row.status,
      seatsRemaining: hubdbSeatsRemaining,
      seatsRemainingIsSet: hasExplicitSeatsRemaining,
      startDate: row.start_date
    },
    live
  )
  const seatsRemaining = state.seatsRemaining
  // What the disabled button and the badge say. Five different reasons, five different
  // sentences: "sold out" invites a waitlist, "registrations closed" does not, "bookings
  // on hold" is worth coming back for, and a session still being set up has never been
  // on sale at all. The sentences live in @shared/status so the checkout tunnel, the
  // timetable and the events badge cannot word them differently.
  const presentation = statusPresentation(state.status)
  const isUnavailable = !presentation.bookable
  const unavailableLabel = presentation.label
  // The CARD modifier keeps the raw status spelling (`--sold_out`, `--cancelled`,
  // `--registration_closed`) because that is what CourseFilter.css has always matched on;
  // the BADGE uses the shared slug. Two vocabularies, deliberately, until someone decides
  // to rename the CSS on purpose.
  const isSoldOut = state.status === 'sold_out'
  const hasRegistrationUrl = isUsableRegistrationUrl(row.registration_url)
  // Only Event Engine-backed sessions should use the on-site checkout tunnel.
  // Older imported sessions can still be displayed, but if they do not have a
  // real external registration URL, send the user to the training team instead
  // of a checkout route that cannot complete for that row.
  //
  // `use_event_engine` alone is not enough: it is the editorial opt-in, and the
  // checkout cannot load without `worker_event_id` to reserve against. A row
  // carrying the tick but not the id sent the buyer to a checkout that could
  // only tell them online booking was not configured, with no way back to the
  // registration_url sitting on the same row. Treat it as unticked and let the
  // legacy fallbacks below do their job - `pnpm audit:event-engine` is what
  // surfaces the misconfiguration, not a dead end in front of a customer.
  const useCheckout = Boolean(row.use_event_engine && row.worker_event_id)
  const useContactFallback = !useCheckout && !hasRegistrationUrl
  const registerHref = isUnavailable
    ? undefined
    : useCheckout
      ? `/checkout/?session_id=${encodeURIComponent(String(row.id))}`
      : useContactFallback
        ? `mailto:training@weldaustralia.com.au?subject=${encodeURIComponent(`Course booking enquiry: ${row.course_name}`)}`
        : buildRegistrationUrl(row.registration_url, member_tier)
  const ctaLabel = useContactFallback ? contact_cta_label : register_cta_label
  const dateLabel = formatDateRange(row.start_date, row.end_date)
  const deliveryLabel = row.delivery_mode || row.city
  const deliverySlug = toBadgeSlug(deliveryLabel)
  const city = (row.city ?? '').trim()
  const locationLabel = city && !sameCity(city, deliveryLabel) ? city : ''
  const categoryLabel = row.category || 'Course session'
  const categorySlug = toBadgeSlug(categoryLabel)
  const memberPrice = resolveMemberPrice(row, member_tier).price
  const hasMemberDiscount =
    Number.isFinite(memberPrice) &&
    Number.isFinite(row.price_non_member) &&
    memberPrice > 0 &&
    row.price_non_member > memberPrice

  return (
    <div
      className={`wa-course-filter__card wa-course-filter__card--${isSoldOut ? 'sold_out' : state.status}`}
    >
      <div className="wa-course-filter__media">
        {row.photo_url ? (
          <img
            className="wa-course-filter__image"
            src={row.photo_url}
            alt={row.photo_alt || row.course_name}
            loading="lazy"
          />
        ) : (
          <span
            className="wa-course-filter__image wa-course-filter__image--placeholder"
            aria-hidden="true"
          />
        )}
        <span className="wa-course-filter__media-scrim" aria-hidden="true" />

        <div className="wa-course-filter__badges" aria-label="Session labels">
          <span className={`wa-course-filter__badge wa-course-filter__badge--${categorySlug}`}>
            {categoryLabel}
          </span>
          {isUnavailable && (
            <span
              className={`wa-course-filter__badge wa-course-filter__badge--${presentation.slug}`}
            >
              {unavailableLabel}
            </span>
          )}
        </div>
      </div>

      <div className="wa-course-filter__body">
        {deliveryLabel && (
          <span
            className={`wa-course-filter__delivery wa-course-filter__delivery--${deliverySlug}`}
          >
            {deliveryLabel}
          </span>
        )}
        <h3 className="wa-course-filter__title">{row.course_name}</h3>
        <p className="wa-course-filter__session-meta">
          {/* Every session of one course shares its name, photo and price, so on
              "All locations" the city is the only thing that tells two cards apart -
              without it a visitor cannot see which location they are booking. */}
          {locationLabel && (
            <span className="wa-course-filter__session-location">
              <svg
                className="wa-course-filter__session-meta-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
              <span className="visually-hidden">Location: </span>
              {locationLabel}
            </span>
          )}
          <span className="wa-course-filter__session-date">
            <svg
              className="wa-course-filter__session-meta-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {dateLabel}
          </span>
          {row.duration && (
            <span className="wa-course-filter__session-duration">{row.duration}</span>
          )}
        </p>
      </div>

      <div className="wa-course-filter__card-header">
        <span className="wa-course-filter__dates">
          {formatDateRange(row.start_date, row.end_date)}
        </span>
        {isUnavailable && (
          <span className={`wa-course-filter__badge wa-course-filter__badge--${presentation.slug}`}>
            {unavailableLabel}
          </span>
        )}
      </div>

      {show_pricing && (
        <div className="wa-course-filter__pricing" data-member-tier={member_tier || undefined}>
          {isMember && hasMemberDiscount ? (
            <>
              <span className="wa-course-filter__price wa-course-filter__price--member">
                {formatCurrencyDollars(memberPrice)}
                <span className="wa-course-filter__price-tag"> ex GST (member)</span>
              </span>
              <span className="wa-course-filter__price wa-course-filter__price--struck">
                {formatCurrencyDollars(row.price_non_member)}
              </span>
            </>
          ) : (
            <span className="wa-course-filter__price wa-course-filter__price--public">
              {formatCurrencyDollars(row.price_non_member)}
              <span className="wa-course-filter__price-tag"> ex GST</span>
            </span>
          )}
        </div>
      )}

      {show_seats_remaining &&
        seatsRemaining !== null &&
        seatsRemaining > 0 &&
        seatsRemaining <= 5 && (
          <p className="wa-course-filter__seats">
            Only {seatsRemaining} spot
            {seatsRemaining !== 1 ? 's' : ''} left
          </p>
        )}

      {/* The note sits above the CTA so the button stays the last element in
          every card. Cards are equal height and the body flex-grows, which
          bottom-anchors the CTA - anything rendered after it knocks that card's
          button out of line with its neighbours (defect 231). */}
      {useContactFallback && !isUnavailable && (
        <p className="wa-course-filter__note">
          Online booking is not available for this session yet.
        </p>
      )}
      {isUnavailable ? (
        // Use a disabled button so screen readers announce the unavailable state
        // correctly - an <a> without href is ambiguous to AT.
        <button
          type="button"
          disabled
          className="wa-btn wa-btn--primary wa-course-filter__cta wa-btn--disabled"
        >
          {unavailableLabel}
        </button>
      ) : (
        <a
          href={registerHref}
          className="wa-btn wa-btn--primary wa-course-filter__cta"
          onClick={() => {
            if (useCheckout) {
              saveCheckoutPricingHandoff({
                sessionId: row.id,
                isMember,
                memberTier: isMember ? member_tier : ''
              })
            }
          }}
          // The hapily handoff is external (new tab). Checkout and mailto
          // fallback actions stay in the same tab.
          {...(!useCheckout && !useContactFallback
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {ctaLabel}
        </a>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EOI form
// ---------------------------------------------------------------------------

interface EoiFormProps {
  heading: string
  message: string
  city: string
  name: string
  email: string
  submitting: boolean
  success: boolean
  error: string
  hasFormId: boolean
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
}

function EoiForm({
  heading,
  message,
  city,
  name,
  email,
  submitting,
  success,
  error,
  hasFormId,
  onNameChange,
  onEmailChange,
  onSubmit
}: EoiFormProps): React.ReactElement {
  // A course with no sessions at all has no city to name, and no location
  // selector on the page either - so the copy can't say "in <city>" or send
  // people back to a control that isn't there.
  if (success) {
    return (
      <div className="wa-course-filter__eoi wa-course-filter__eoi--success">
        <p>
          {city ? (
            <>
              Thanks! We&apos;ll be in touch when a session is scheduled in <strong>{city}</strong>.
            </>
          ) : (
            <>Thanks! We&apos;ll be in touch when the next session is scheduled.</>
          )}
        </p>
      </div>
    )
  }

  if (!hasFormId) {
    return (
      <div className="wa-course-filter__eoi">
        <h3 className="wa-course-filter__eoi-heading">
          {city ? `No sessions currently scheduled in ${city}` : 'No sessions currently scheduled'}
        </h3>
        <p className="wa-course-filter__eoi-fallback">
          {city ? 'Choose another location above or contact' : 'Contact'} our training team to
          discuss upcoming dates and delivery options.
        </p>
        <a className="wa-btn wa-btn--outline wa-course-filter__eoi-contact" href="/contact-us/">
          Contact the training team
        </a>
      </div>
    )
  }

  return (
    <div className="wa-course-filter__eoi">
      {heading && <h3 className="wa-course-filter__eoi-heading">{heading}</h3>}
      {message && (
        <div
          className="wa-course-filter__eoi-message"
          /* eoi_message is rich text from a trusted HubSpot CMS editor */
          dangerouslySetInnerHTML={{ __html: message }}
        />
      )}

      <form className="wa-course-filter__eoi-form" onSubmit={onSubmit}>
        <div className="wa-course-filter__eoi-field">
          <label htmlFor="wa-cf-eoi-name">Name</label>
          <input
            id="wa-cf-eoi-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            required
            autoComplete="name"
          />
        </div>
        <div className="wa-course-filter__eoi-field">
          <label htmlFor="wa-cf-eoi-email">Email</label>
          <input
            id="wa-cf-eoi-email"
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        {error && (
          <p className="wa-course-filter__eoi-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="wa-btn wa-btn--primary"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? 'Sending…' : 'Register interest'}
        </button>
      </form>
    </div>
  )
}
