/**
 * Analytics event helpers - fires to both:
 *   - window.dataLayer  (GTM / GA4, loaded via theme GTM container)
 *   - window._hsq       (HubSpot custom behavioral event tracking)
 *
 * See CLAUDE.md §10.3 for the four required custom events and their properties.
 */

declare global {
  interface Window {
    _hsq?: Array<unknown[]>
    dataLayer?: Array<Record<string, unknown>>
  }
}

export interface CustomEventPayload {
  name: string
  properties?: Record<string, string | number | boolean>
}

/**
 * Push an event to GTM's dataLayer.
 * Queued events are replayed once GTM loads, so early calls are safe.
 */
export function pushDataLayer(
  eventName: string,
  params: Record<string, string | number | boolean> = {}
): void {
  const dl = (window.dataLayer = window.dataLayer || [])
  dl.push({ event: eventName, ...params })
}

/**
 * Fire a HubSpot custom behavioral event AND an equivalent GTM dataLayer event.
 * Use this for all four instrumented events so both the CRM contact timeline
 * and GA4 / Tag Manager receive the event.
 */
export function trackCustomEvent(payload: CustomEventPayload): void {
  const hsq = (window._hsq = window._hsq || [])
  hsq.push(['trackCustomBehavioralEvent', payload])

  pushDataLayer(payload.name, payload.properties ?? {})
}
