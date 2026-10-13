/**
 * event-availability — entry point for the public events availability badge.
 *
 * Built to `theme/assets/js/event-availability.js` as an IIFE (see scripts/build.ts): the
 * three host templates (`events.html`, `event-detail.html`, `events-listing.module`) load it
 * with a plain `<script src … defer>`, not `type="module"`.
 *
 * Deliberately side-effect-only, with NO exports. An IIFE bundle assigns its exports to the
 * global name, which would replace `window.WAEventAvailability` — the documented refresh
 * hook — with a module namespace. The logic (and the tests for it) live in
 * `@shared/status/eventAvailabilityBadge`.
 */

import { initAvailability } from '@shared/status/eventAvailabilityBadge'

declare global {
  interface Window {
    // Same shape `EventsListing.tsx` declares and calls — it re-runs `refresh` after the
    // listing re-filters, so badges on newly-rendered cards bind.
    WAEventAvailability?: {
      refresh?: (root?: ParentNode) => void
    }
  }
}

window.WAEventAvailability = window.WAEventAvailability || { refresh: initAvailability }
window.WAEventAvailability.refresh = initAvailability

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initAvailability(document))
} else {
  initAvailability(document)
}
