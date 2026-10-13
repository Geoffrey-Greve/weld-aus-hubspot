/**
 * One vocabulary for "can this session be booked, and if not, why not".
 *
 * Five surfaces used to answer that question with five copies of the same ladder — the
 * course filter, the timetable, the checkout tunnel, the member command centre, and
 * (differently, and wrongly) the events availability badge. The badge was the proof that
 * copies drift: it never read the Worker's `registrationClosed` or `salesPaused` at all, so
 * a closed event advertised places right up to the moment the buyer was refused, and it
 * answered an empty ticket list with "Booking open" where every other surface says the
 * session is not on sale yet.
 *
 * What lives here is what was genuinely duplicated: the status set, the sentence each status
 * earns, and the one mapper from whatever HubDB happened to store. What deliberately does
 * NOT live here is each surface's CSS class vocabulary — `wa-course-filter__card--sold_out`,
 * `wa-ctf__badge--sold-out` and the badge's `data-state="soldout"` are three different
 * spellings of one idea, and unifying them is a visual change, not a consolidation. `slug`
 * is offered for new callers; existing ones keep their own spelling until someone decides to
 * change the CSS on purpose.
 */

/**
 * Why a session cannot be booked, in the order a buyer needs to hear it. These are distinct
 * because the sentences are: "sold out" invites a waitlist, "registrations have closed" does
 * not, and "temporarily on hold" is worth coming back for.
 */
export type SessionStatus =
  | 'available'
  | 'sold_out'
  | 'registration_closed'
  | 'sales_paused'
  | 'cancelled'
  /**
   * The Worker answered, and has nothing the public may buy: no ticket types, or every one
   * of them internal or a CAMS import. That is a session still being set up, not a session
   * that sold out, and saying "sold out" about it costs a booking and invites a waitlist
   * enquiry for seats that are all still there.
   */
  | 'not_bookable'

/** Every status, for exhaustiveness checks in tests. */
export const SESSION_STATUSES: readonly SessionStatus[] = [
  'available',
  'sold_out',
  'registration_closed',
  'sales_paused',
  'cancelled',
  'not_bookable',
] as const

export interface StatusPresentation {
  /**
   * Kebab-case, for a `data-` attribute or a new CSS class. Existing surfaces keep their own
   * spelling (see the file header) — this is for callers with no legacy to preserve.
   */
  slug: string
  /**
   * What a buyer is told. `available` carries a neutral word rather than a sentence, because
   * every surface that renders an open session says something of its own ("Places
   * available", a price, a Register button) and none of them want a label here.
   */
  label: string
  /** Whether a Register/Confirm control should be offered. Only `available` is bookable. */
  bookable: boolean
}

const PRESENTATION: Record<SessionStatus, StatusPresentation> = {
  available: { slug: 'available', label: 'Available', bookable: true },
  sold_out: { slug: 'sold-out', label: 'Sold out', bookable: false },
  registration_closed: {
    slug: 'closed',
    label: 'Registrations closed',
    bookable: false,
  },
  sales_paused: { slug: 'paused', label: 'Bookings on hold', bookable: false },
  cancelled: { slug: 'cancelled', label: 'Cancelled', bookable: false },
  not_bookable: {
    slug: 'not-bookable',
    label: 'Booking opening soon',
    bookable: false,
  },
}

/** The sentence and the slug a status earns. */
export function statusPresentation(status: SessionStatus): StatusPresentation {
  return PRESENTATION[status]
}

/**
 * The values the `courses.status` column can hold, slugged.
 *
 * `closed` is Ref 74c: an UPCOMING course whose registrations staff have shut by hand. It is
 * not a finished course — a past session is handled by its own dates, and a withdrawn one by
 * `cancelled` — so a closed row stays in every listing, with a badge and no Register button.
 */
export type HubdbStatus = 'available' | 'sold_out' | 'cancelled' | 'closed'

/**
 * Whatever HubDB stored, as a status.
 *
 * Three spellings are already in the codebase and all three reach React: the course modules
 * slug it in HubL (`row.status.name | lower | replace(' ', '_')`), the member command centre
 * passes the raw option name ("Sold Out"), and the card partials compare `.name` directly.
 * Normalising here rather than at five call sites is the point of this module.
 *
 * **"Closed" resolves to `registration_closed`, the same status the Worker's cutoff
 * produces** (migration 0038). One sentence, two causes: staff shutting registrations by
 * hand and the clock running out are the same fact to a buyer, and giving them separate
 * statuses would mean two sentences for one thing and a second badge to style.
 *
 * An unrecognised value resolves to `available`, which is what every caller already did with
 * a blank cell: HubDB is an editorial surface, and a status nobody taught this code about
 * must not take a sellable session off sale.
 */
export function hubdbStatusToSessionStatus(raw: string | null | undefined): SessionStatus {
  return HUBDB_STATUS_ALIASES[normaliseStatusKey(raw)] ?? 'available'
}

/** Lower-case, and one separator, so "Sold Out" / "sold-out" / "sold_out" are one key. */
export function normaliseStatusKey(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Normalised HubDB value → status, as DATA rather than a switch.
 *
 * `scripts/build.ts` generates the HubL macro partial (`session-status.html`) from this same
 * table, so a card partial rendered server-side and a React island rendered client-side
 * cannot disagree about what "Closed" means. Adding a spelling is one line here.
 */
export const HUBDB_STATUS_ALIASES: Readonly<Record<string, SessionStatus>> = {
  sold_out: 'sold_out',
  soldout: 'sold_out',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  closed: 'registration_closed',
  registration_closed: 'registration_closed',
  registrations_closed: 'registration_closed',
}
