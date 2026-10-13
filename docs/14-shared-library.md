# `src/shared` reference

The shared library every React island imports from. Import from the alias, not a
relative path:

```ts
import { Card, Filter, formatDate, useMemberContext } from '@shared'
```

The barrel is `src/shared/index.ts`. Tree-shaking means only what you use lands
in the bundle, and the 80 KB gzip entry budget is per island, so an unnecessary
import has a real cost.

---

## 1. Mounting

### `mountReactIsland(name, Component)`

`src/shared/mount.ts`. The only entry point an island's `index.tsx` needs.

```tsx
import mountReactIsland from '@shared/mount'
mountReactIsland('course-filter', CourseFilter)
```

What it does:

- Finds every `[data-wa-module="<name>"]` element.
- Reads props from `dataset.props`, or from a child
  `<script type="application/json" data-props-json>`.
- `JSON.parse` failures are logged with the raw value and that element is
  skipped, so one bad blob does not take down the page.
- Mounts with React 18 `createRoot`, tracking roots in a `WeakMap`.
- Waits for `DOMContentLoaded` when the document is still loading.
- A `MutationObserver` watches `childList`, `subtree` and the `data-props`
  attribute: removed hosts are unmounted, added hosts are mounted, and a changed
  `data-props` re-renders.

That last behaviour is what keeps islands alive in the HubSpot page editor,
which mutates and clears DOM subtrees as the editor changes fields. An island
whose host was cleared by the editor is re-rendered rather than left blank.

---

## 2. Member context

`src/shared/api/memberContext.ts`. Typed access to the `window.__WELD_MEMBER__`
object `portal.html` injects. Read-only: never mutate it.

```ts
const ctx = useMemberContext()          // React hook, reads once on mount
const ctx = getMemberContext()          // imperative, returns null off-portal
isMember(ctx)                           // active | grace_period | honorary
isHonoraryMember(ctx)                   // honorary never lapses; suppress renewal CTAs
hasTier(ctx, 'corporate_gold')          // checks the contact AND its associations
```

Types: `WeldMemberContext`, `MemberContact`, `MemberAssociation`,
`MemberCertification`, `MemberEntitlements`, `MembershipTier`,
`MembershipStatus`.

`hasTier` deliberately checks associations too, so an Employee of a Corporate
Gold company passes `hasTier(ctx, 'corporate_gold')`.

`getMemberContext()` returns `null` on public pages and on a malformed object,
so every consumer must handle the null case. See
[16-membership-and-pricing.md](./16-membership-and-pricing.md).

---

## 3. API clients

### `fetchHubDbRows(tableId, params?)`

`src/shared/api/hubdb.ts`. HubDB v2 read client. Read-only; writes go through
workflows.

- 10 s timeout via `AbortController`
- 3 attempts, 500/1000/2000 ms backoff, retrying 5xx and network errors only
  (4xx fails immediately)
- Identical concurrent requests share one in-flight promise
- Returns `HubDbRow<T>[]`, where `values` is your typed column map

Most islands get their rows from HubL props instead. Use this only for data that
genuinely has to be fetched client-side.

### `submitHubSpotForm(portalId, formGuid, submission)`

`src/shared/api/forms.ts`. Forms API v3 submit. No retry, deliberately: form
submits are not idempotent. Throws on a non-2xx. `submission.context.hutk`
should carry the HubSpot tracking cookie so the submission attributes correctly.

### `trackCustomEvent({ name, properties })` and `pushDataLayer(name, params)`

`src/shared/api/events.ts`. Fires a HubSpot custom behavioural event (`_hsq`)
and the equivalent GTM `dataLayer` event, so both the contact timeline and GA4
receive it. The four instrumented events are `resource_locked_view`,
`resource_download`, `member_discount_applied` and
`corporate_bulk_registration` (CLAUDE.md § 10.3, `workflows/behavioural-events.md`).

### `validateMemberCompany(companyId)`

`src/shared/api/members.ts`. Resolves a member discount for a buyer who is not
logged in, by matching a typed company ID against `hubspot_company_id` in the
public `members` table. Any active company, any tier, unlocks the member rate.

**Read the security note at the top of that file before you touch this.** The
unlock key is publicly enumerable by design: the directory is served with
`allowPublicApiAccess: true` and every row exposes `hubspot_company_id`. The
discount resolved here is a **non-binding preview**. Every paid path forwards the
company ID for server-side re-validation:

| Path | Forwarded as |
|---|---|
| Event Engine | `ReserveBody.memberCompanyId` + `expectedUnitCents` |
| Stripe | `member_company_id` in the payment-intent body |
| Redirect / hapily | `wa_member_company_id` + `wa_member_tier` query params |

Without that server-side check the preview is spoofable. That is an accepted
product trade-off (Ryan, 2026-07), not a bug to fix in the client.

### Event Engine client

`src/shared/api/eventEngine.ts`. Typed client for the Cloudflare Worker's three
endpoints:

```
GET  /api/v1/events/{slug}/availability     X-Portal-Id
POST /api/v1/events/{slug}/reserve          X-Portal-Id, Idempotency-Key
GET  /api/v1/orders/{id}                    X-Portal-Id, polled until paymentUrl
```

Handles idempotency keys per event (created, reused, cleared), expired
reservations, transport and server error statuses, `pollOrder()` with options,
and `friendlyReserveError()` for user-facing messages. Supports both the
single-seat path (`ticketTypeId`) and the group path (`attendees[]`, with
`hubspotContactId` so corporate bulk booking binds seats to existing contacts).

The Worker is authoritative for price and availability. Never trust client-side
seat counts. Contract detail: [EVENT-ENGINE-API.md](./EVENT-ENGINE-API.md).

---

## 4. UI primitives

`src/shared/components/`. BEM-ish `wa-*` classes, styled by theme CSS, no
runtime style injection.

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant` (primary, secondary, ghost, danger), `size`, `disabled`, `loading`, `href`, `onClick`, `type` | Renders `<a>` when `href` is set and it is neither disabled nor loading, otherwise `<button>` |
| `Card` | see `CardProps` | Listing card shell |
| `Filter` | `options`, `value: string[]`, `onChange`, `label` | Multi-select chip group. Chips are toggle buttons with `aria-pressed`; the 44px target is enforced by `.wa-filter-chip` |
| `Modal` | `open`, `onClose`, `title`, `size` | Portals into `document.body`, closes on backdrop and ESC, traps Tab/Shift+Tab, restores focus on close, `role="dialog"` + `aria-modal` + `aria-labelledby` |
| `EmptyState` | `EmptyStateProps` | Use for every "no results" branch |
| `LoadingSkeleton`, `SkeletonCard` | `LoadingSkeletonProps` | Loading placeholders |
| `Pagination` | `PaginationProps` | Keyboard accessible |
| `ErrorBoundary` | children | Wrap each dashboard tile so one failure degrades gracefully |

Every tile and listing needs an empty, loading and error state. The member
dashboard's acceptance criteria require that no tile blocks the others.

---

## 5. Pricing

`src/shared/utils/memberPricing.ts`. The TypeScript half of the pricing rule.
The HubL half is `theme/templates/partials/_member-pricing.html`, and
`memberPricingParity.test.ts` fails the build if they disagree.

```ts
normaliseMemberPriceTier(tier)        // any label or key → gold|silver|bronze|student|individual|member
resolveMemberPrice(item, tier)        // → { price, tierKey, label, fallbackUsed }
resolveRegistrationPrice(item, isMember, tier)
memberPriceTierRank(tier)             // gold 60 … member 10
pickBestMemberTier(...candidates)     // strongest non-empty candidate
```

Details that matter:

- An empty or unknown tier normalises to **`member`** (the generic
  `price_member` column), not to `individual`. That distinction was defect 213.
- Matching is substring-based on a normalised string, so "Corporate Gold",
  `corporate_gold` and "Gold Corporate" all resolve to `gold`.
- `individual` absorbs reciprocal, associate, honorary and industry supplier.
- `resolveMemberPrice` falls back `exact tier price → price_member →
  price_individual → price_non_member` and reports `fallbackUsed`.
- Numeric parsing strips `$`, commas and whitespace, so a string price from
  HubDB behaves.
- `pickBestMemberTier` is why checkout and the portal quote the same rate when a
  corporate employee also holds a weaker individual membership (defect 126).

**Prices in HubDB are AUD ex GST.** `formatCurrency` takes cents;
`formatCurrencyDollars` takes dollars; `gstComponentDollars` derives the GST
component of a GST-inclusive amount. There is an open question about whether
every HubDB price column is genuinely ex GST, see
[member-portal-config-handoffs.md](./member-portal-config-handoffs.md).

### `checkoutPricingHandoff`

`src/shared/utils/checkoutPricingHandoff.ts`. Passes the resolved tier and price
from a course page to the checkout tunnel through
`sessionStorage['wa_checkout_pricing_handoff']`, so the quote does not change
between the two screens. `saveCheckoutPricingHandoff` /
`readCheckoutPricingHandoff`. The backend still re-validates.

### `buildRegistrationUrl(...)`

`src/shared/utils/registration.ts`. Builds the outbound registration URL,
appending `wa_member_company_id` and `wa_member_tier` so a redirect-based
processor can re-validate the discount.

---

## 6. Course taxonomy

`src/shared/courseTaxonomy.ts` is **generated** from
`config/course-categories.json` by `pnpm build`. Do not edit it.

```ts
COURSE_CATEGORY_BUCKETS       // the four client-facing training divisions
bucketForCategory(raw)        // a HubDB category value → division slug
resolveBucketFromParam(param) // a ?category= value → division slug
bucketLabel(slug)             // → display label
normaliseCategoryKey(value)
COURSE_CATEGORY_FALLBACK_SLUG // 'uncategorised'
COURSE_CATEGORY_FALLBACK_LABEL// 'Other'
```

The four divisions do not map one-to-one onto the seven HubDB `category`
options; the grouping is a display layer so no course row needs retagging. See
CLAUDE.md § 7.5. `courseTaxonomy.test.ts` fails the build if a `category` option
in `hubdb/courses.json` has no division.

---

## 7. Utilities

| Export | Purpose |
|---|---|
| `formatCurrency(cents)` | AUD from cents |
| `formatCurrencyDollars(dollars)` | AUD from dollars |
| `gstComponentDollars(inclusive)` | GST component of a GST-inclusive amount |
| `formatDate`, `formatDateShort`, `formatDateRange` | en-AU date display |
| `deriveCityOptions(cities)`, `CITY_ORDER` | Location options derived from the rows themselves, so a city Weld Aus adds in HubDB appears with no code change. `CITY_ORDER` is display order only; unknown cities are appended alphabetically |
| `debounce(fn, ms)` | Search inputs |
| `cx(...)` | Conditional class names |
| `contrastRatio`, `meetsContrast`, `relativeLuminance`, `parseHexColor`, `readCssHexToken`, `WCAG_AA_NORMAL`, `WCAG_AA_LARGE` | Used by the contrast tests to assert token values meet AA |

`deriveCityOptions` is shared by `course-filter` and
`course-timetable-filter` on purpose: a city with no session on the current
course is never offered, which is what makes the empty-state EOI form
unreachable by accident.

---

## 8. Design tokens

`src/shared/design-tokens.ts` exports `TOKENS` and `BREAKPOINTS` as the
TypeScript view of `tokens.css`.

```tsx
import { TOKENS, BREAKPOINTS } from '@shared/design-tokens'
<span style={{ color: TOKENS.color.success }}>You save $240</span>
```

Prefer a CSS class in the island's stylesheet. Use `TOKENS` only where a value
genuinely has to be computed in JS. Both files are hand-maintained against each
other, so if you add a token that islands need, add it in both places.
