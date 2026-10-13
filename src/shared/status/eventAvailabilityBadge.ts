/**
 * The public availability badge for Event Engine-backed EVENTS.
 *
 * The logic lives here, away from the entry file, for a mechanical reason: the entry is
 * bundled as an IIFE, and an IIFE with named exports assigns them to its global name — which
 * would overwrite `window.WAEventAvailability` (the documented `refresh` hook) with a module
 * namespace. A side-effect-only entry plus a testable module avoids that entirely.
 *
 * This replaces a hand-rolled second implementation of availability that had drifted from
 * the shared client the course pages use. What it was getting wrong:
 *
 *   - it never read `registrationClosed`, `salesPaused` or `bookable`, so an event past its
 *     cutoff advertised places right up to the moment the buyer was refused at reserve;
 *   - an empty ticket list answered "Booking open", where every other surface says the
 *     session is not on sale yet;
 *   - it defaulted the Worker URL and portal id to a hardcoded deployment and portal
 *     whenever a template forgot to pass them, so a misconfigured page silently asked a
 *     Worker nobody had named for it.
 *
 * Still ADVISORY, and still fail-open. The Worker is authoritative at reserve, so an
 * optimistic badge can only ever send someone to a checkout that tells them the truth — a
 * badge that hid a sellable event because a fetch timed out would be the worse bug.
 *
 * Exact seat counts stay off public pages: bands only.
 */

import { type AvailabilityResponse, applyAvailability, fetchAvailability } from '../api/eventEngine'
import {
  type SessionStatus,
  hubdbStatusToSessionStatus,
  statusPresentation,
} from './sessionStatus'

/** Below this many seats the badge says "limited" rather than a number. */
const LOW_SEAT_THRESHOLD = 5

/**
 * `data-state` values, which are the CSS's vocabulary rather than the status module's:
 * `event-detail.css` has styled `available` / `limited` / `soldout` since before these
 * statuses existed, and renaming them would restyle every events page for no reason.
 */
const BADGE_STATE: Record<SessionStatus, string> = {
  available: 'available',
  sold_out: 'soldout',
  registration_closed: 'closed',
  sales_paused: 'paused',
  cancelled: 'cancelled',
  not_bookable: 'notbookable',
}

export interface BadgeResult {
  state: string
  label: string
}

/** What a badge says when nothing better is known. Also the fail-open answer. */
export const OPEN: BadgeResult = { state: 'available', label: 'Booking open' }

/**
 * The live read as a badge, folded over whatever the row itself says.
 *
 * `applyAvailability` decides the status — the same function, with the same precedence, that
 * the course cards and the checkout tunnel use. `hubdbStatus` is the events table's own
 * status column (Ref 74c Phase 3): staff closing registrations early on an event that still
 * has seats. It is OPTIONAL, and blank resolves to `available`, so a badge on a surface that
 * does not pass one behaves exactly as it did before the column existed.
 *
 * Both roads meet here: a manual "Closed" and the Worker's own cutoff resolve to
 * `registration_closed` and read the same sentence. And because the editorial decision is
 * settled inside `applyAvailability` BEFORE the live read, a Worker answering "seats
 * available" can never re-open a row staff closed by hand.
 */
export function badgeFor(
  live: AvailabilityResponse | null,
  hubdbStatus?: string | null
): BadgeResult {
  // The row can close an event on its own — with no live read at all, and even on a row
  // that was never wired to the Worker.
  if (!live) {
    const editorial = statusPresentation(hubdbStatusToSessionStatus(hubdbStatus))
    return editorial.bookable
      ? OPEN
      : { state: BADGE_STATE[hubdbStatusToSessionStatus(hubdbStatus)], label: editorial.label }
  }

  const state = applyAvailability({ status: hubdbStatus ?? 'available', seatsRemaining: null }, live)

  if (state.status !== 'available') {
    // A sold-out event that can still take waitlist joins says so: "sold out" is an
    // invitation there, which is exactly why it is not the sentence for a closed one.
    const waitlist =
      state.status === 'sold_out' &&
      (live.ticketTypes ?? []).some((ticket) => ticket.waitlistAvailable === true)
    const { label } = statusPresentation(state.status)
    return {
      state: BADGE_STATE[state.status],
      label: waitlist ? `${label} - join waitlist` : label,
    }
  }

  // Open. The only band left is "nearly gone", and it is deliberately a count and not a
  // ratio: the availability endpoint returns no capacity, so the old ratio test could never
  // fire and reading one back in would be inventing a threshold nobody set.
  if (state.seatsRemaining !== null && state.seatsRemaining <= LOW_SEAT_THRESHOLD) {
    return { state: 'limited', label: 'Limited places remaining' }
  }
  return { state: 'available', label: 'Places available' }
}

function getConfigValue(el: Element, ownAttr: string, rootAttr: string): string {
  const ownValue = el.getAttribute(ownAttr)
  if (ownValue) return ownValue
  const root = el.closest(`[${rootAttr}]`)
  return root?.getAttribute(rootAttr) || ''
}

function setBadge(badge: HTMLElement, result: BadgeResult): void {
  badge.hidden = false
  badge.dataset.state = result.state
  badge.textContent = result.label
  badge.setAttribute('aria-label', result.label)
}

/** One in-flight request per event, shared by every badge on the page. */
const inFlight = new Map<string, Promise<AvailabilityResponse | null>>()

function readOnce(
  workerBaseUrl: string,
  portalId: string,
  workerEventId: string
): Promise<AvailabilityResponse | null> {
  const key = `${workerBaseUrl.replace(/\/$/, '')}|${portalId}|${workerEventId}`
  const cached = inFlight.get(key)
  if (cached) return cached
  const promise = fetchAvailability({ workerBaseUrl, portalId }, workerEventId)
  inFlight.set(key, promise)
  return promise
}

/** Exposed for tests: the module-level cache outlives a component. */
export function resetBadgeCache(): void {
  inFlight.clear()
}

export function initAvailability(root?: ParentNode): void {
  const scope = root ?? document
  const badges = scope.querySelectorAll<HTMLElement>(
    '[data-wa-availability-badge]:not([data-wa-availability-bound])'
  )

  badges.forEach((badge) => {
    const workerEventId = badge.getAttribute('data-worker-event-id') || ''
    const workerBaseUrl = getConfigValue(
      badge,
      'data-worker-base-url',
      'data-wa-availability-worker'
    )
    const portalId = getConfigValue(badge, 'data-portal-id', 'data-wa-availability-portal')
    // Ref 74c Phase 3. OPTIONAL: a surface that does not pass one keeps Phase 1 behaviour.
    const hubdbStatus = badge.getAttribute('data-hubdb-status') || ''

    badge.setAttribute('data-wa-availability-bound', 'true')

    // An event staff closed by hand needs no Worker at all to say so - and must say it even
    // on a row with no `worker_event_id`, which is the case the early return below covers.
    const editorial = hubdbStatusToSessionStatus(hubdbStatus)
    if (editorial !== 'available') {
      setBadge(badge, badgeFor(null, hubdbStatus))
      return
    }

    // All three host surfaces pass these explicitly, so a badge with no configuration is a
    // template fault — and hiding it is safer than asking a Worker nobody named.
    if (!workerEventId || !workerBaseUrl || !portalId) {
      badge.hidden = true
      return
    }

    readOnce(workerBaseUrl, portalId, workerEventId)
      .then((live) => {
        // `fetchAvailability` resolves null on any failure. Fail OPEN: never hide a
        // sellable event because the Worker was unreachable.
        setBadge(badge, badgeFor(live, hubdbStatus))
      })
      .catch(() => {
        setBadge(badge, OPEN)
      })
  })
}
