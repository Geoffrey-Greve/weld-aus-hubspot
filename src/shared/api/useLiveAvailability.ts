/**
 * Live seat availability for a set of Event Engine-backed sessions.
 *
 * The course pages rendered `seats_remaining`, a number someone types into HubDB by hand,
 * so a session that sold out on Monday kept advertising places until a human remembered to
 * edit the row. The events listing already read the Worker; the course side did not. This
 * hook is the shared read, so both sides answer the same way.
 *
 * Three properties it has to keep:
 *
 *   ADVISORY. Every failure resolves to `null` for that session and the caller falls back
 *   to the HubDB row. The Worker is authoritative at reserve time, so an optimistic page
 *   can only ever send someone to a checkout that tells them the truth — it can never
 *   oversell. A page that hid sellable courses because a fetch timed out would be a worse
 *   bug than the one this fixes.
 *
 *   ONE REQUEST PER SESSION, SHARED. A course page renders the same session in the filter
 *   and the card list, and a timetable renders dozens. The in-flight promise is cached by
 *   session id for the life of the page, so re-renders and repeated mounts do not fan out
 *   into a request per card.
 *
 *   NO FLASH OF WRONG STATE. Until a read lands, the caller keeps rendering the HubDB row
 *   rather than a spinner or an empty state — `null` means "nothing better than HubDB yet",
 *   and a card that is right most of the time should not blink on every page load.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type AvailabilityResponse,
  type EventEngineConfig,
  fetchAvailability
} from './eventEngine'

/** Keyed by `${workerBaseUrl}|${portalId}|${eventId}` so a config change is a fresh read. */
const inFlight = new Map<string, Promise<AvailabilityResponse | null>>()

function cacheKey(cfg: EventEngineConfig, eventId: string): string {
  return `${cfg.workerBaseUrl.replace(/\/$/, '')}|${cfg.portalId}|${eventId}`
}

function readOnce(
  cfg: EventEngineConfig,
  eventId: string
): Promise<AvailabilityResponse | null> {
  const key = cacheKey(cfg, eventId)
  const cached = inFlight.get(key)
  if (cached) return cached

  const promise = fetchAvailability(cfg, eventId)
  inFlight.set(key, promise)
  return promise
}

/** Exposed for tests: the module-level cache outlives a component, so it has to be clearable. */
export function resetAvailabilityCache(): void {
  inFlight.clear()
}

/**
 * Read availability for every supplied session id.
 *
 * Returns a map of session id → response, holding only the reads that succeeded. A missing
 * key means "no better answer than HubDB", whether because the read failed, the session is
 * not Event Engine-backed, or it simply has not landed yet.
 */
export function useLiveAvailability(
  workerBaseUrl: string | undefined,
  portalId: string | undefined,
  eventIds: string[]
): Record<string, AvailabilityResponse> {
  const [results, setResults] = useState<Record<string, AvailabilityResponse>>({})

  // Sorted + joined so a re-render with the same ids in a different order does not retrigger.
  const idKey = useMemo(
    () => Array.from(new Set(eventIds.filter(Boolean))).sort().join(','),
    [eventIds]
  )

  // A fetch that resolves after unmount must not set state — React logs it, and on a
  // course page the user has usually navigated away already.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!workerBaseUrl || !portalId || idKey === '') return
    const cfg: EventEngineConfig = { workerBaseUrl, portalId }

    for (const eventId of idKey.split(',')) {
      readOnce(cfg, eventId).then((data) => {
        if (!data || !mounted.current) return
        // One setState per resolved session rather than a Promise.all: the first answer
        // should correct its card immediately, not wait on the slowest of thirty.
        setResults((prev) => (prev[eventId] === data ? prev : { ...prev, [eventId]: data }))
      })
    }
  }, [workerBaseUrl, portalId, idKey])

  return results
}
