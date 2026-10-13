# Event Engine integration - frontend wiring + backend dependencies

> ⚠️ **Portal naming (corrected 2026-09-18).** In this document "staging" means
> the Event Engine **Worker** (`event-engine-staging...`) and the HubSpot system
> domain `441838610.hs-sites-ap1.com`. Portal **441838610 is PRODUCTION**; the
> staging HubSpot portal is **443253065**. The Worker secrets, CORS origins and
> system domain below are all keyed to 441838610, i.e. the Event Engine was wired
> against the production portal. Re-keying it to 443253065 is an open task - see
> DEPLOYMENT.md §2. The facts below describe what is deployed today; they have
> not been rewritten.

**Status:** Events booking proven end-to-end on **staging**. Course checkout + member portal pages are the remaining build.
**Date:** 2026-06-24
**Owners:** Frontend/theme - Melwyn · Backend/HubSpot data - Ollie · Event Engine (Worker) - Ryan

---

## 0. Current state (2026-06-24, staging)

**Live + verified on `event-engine-staging.refuel-creative.workers.dev` / portal 441838610:**
- Worker healthy; **CORS already allows** `https://441838610.hs-sites-ap1.com`.
- Staging secrets set: `ADMIN_API_KEY_441838610`, `TICKET_SIGNING_SECRET_441838610` (values in `%TEMP%\weld-staging-secrets.txt` - give to Ryan to canonicalise).
- Weld **tenant row** inserted in D1; a demo **event** (`984d5a9c-…`) + **free ticket type** (`0888ae2d-…`) created via the manage API.
- **Reserve verified → `status: confirmed`**, ticket minted. One test registration ("Demo Buyer") exists.
- **`events-detail` dynamic page** published (course-router-style), bound to the events HubDB table; the booking form renders on a real event and books against the demo event.
- **`hs_path` filled:** events 120/127 rows (7 duplicate-slug rows skipped - need unique slugs), courses 16/16 (one per `course_slug`). Detail pages now resolve.

**Confirmed facts that differ from the original Masterplan:**
- Deal pipelines are **two separate** ones in the live portal: **"Events pipeline"** and **"Training pipeline"** (not one "Training & Events").
- Real membership contact properties: **`individual_membership_status`** (dropdown), **`individual_membership_type_2`** (tier), **`individual_membership_expiry_date_2`**. The theme's `contact_membership_*` names do **not** exist → gating was reading nothing.
- Membership status is **mostly unpopulated** on imported contacts (~16% fill) → for the demo, set it manually on a test member.
- No "enrolment → copy course details to contact" workflow exists yet → the dashboard "registered/upcoming courses" sync is **not built**.

**Open items (owner):**
- **Active value** of `individual_membership_status` (Current/Active?) - Melwyn to confirm from the property's dropdown options.
- **Backbone pages not created** (login, dashboard, course-router dynamic, course-timetable-hub, checkout, my-courses/-events/-invoices, profile) - see §5 checklist. Needs UI/content scope.
- **Theme-wide membership-property rename** to the real names (event-detail.html done; contact-form / blog-listing / contact-methods-grid modules + checkout-tunnel tier check still on old names).
- HubSpot **write-back OAuth token** (Ryan's app) - only needed for HubSpot sync + paid/invoice; free booking works without it.
- Per-event/-session provisioning in Worker D1 for real (non-demo) events/courses.

---

## 1. What was built (this repo)

A new HubSpot CMS module ports the tested `event-registration` widget from the
`events-engine` repo (`packages/hubspot`) into the Weld theme, restyled with the
`--wa-*` design tokens and wired into the existing event detail page.

| File | Purpose |
|------|---------|
| `theme/modules/event-registration.module/module.html` | Form skeleton + `[data-evt-config]` JSON block. Reads `dynamic_page_hubdb_row`. |
| `theme/modules/event-registration.module/module.js` | Ported, tenant-agnostic. Availability → reserve → poll order → redirect to invoice. |
| `theme/modules/event-registration.module/module.css` | Token-based styling (`wa-evt-reg`). |
| `theme/modules/event-registration.module/fields.json` | Worker URL/portal (module fields), fallback ticket types, options, copy. |
| `theme/modules/event-registration.module/meta.json` | `SITE_PAGE` + `LANDING_PAGE`. |
| `theme/templates/pages/event-detail.html` | Renders the booking form when an event is engine-backed; otherwise keeps the existing external `registration_url` CTA. Member gate preserved. Sets the Worker URL/portal once on the module tag. |
| `hubdb/events.json` | Added `use_event_engine` (BOOLEAN), `worker_event_id` (TEXT, optional), `ticket_types_json` (TEXT) columns. |

### How it behaves
- The Worker is consumed via 3 public endpoints (REST over a Cloudflare Worker / Hono):
  - `GET  /api/v1/events/{slug}/availability` - header `X-Portal-Id`
  - `POST /api/v1/events/{slug}/reserve` - headers `X-Portal-Id`, `Idempotency-Key`
  - `GET  /api/v1/orders/{id}` - header `X-Portal-Id` (polled until `paymentUrl`)
- **Event id = HubDB row `slug`** (the Worker keys events by slug). Override per row with the optional `worker_event_id` column.
- **Per-event ticket types come from the HubDB row's `ticket_types_json` column** - NOT module fields. The event detail page is a *dynamic* HubDB page (one template shared by every event), so module field values can't differ per event. The module-field ticket types are only a fallback for non-dynamic placements (single-event landing pages).
- **Worker URL/portal are shared** across all events, so they're set once on the module tag in `event-detail.html` (HubSpot theme `fields.json` doesn't allow `text` fields, so theme-level settings weren't an option).
- **Non-destructive:** events with `use_event_engine` false/absent keep the current external-link button, so the live site is unchanged until each event is opted in.
- **Defensive:** if availability can't be read, the buyer can still try (Worker is authoritative at reserve time); if the worker URL or ticket types are missing, the form shows a notice instead of erroring.

### `ticket_types_json` shape (per event row)
```json
[
  { "worker_ticket_type_id": "tt_abc123", "ticket_name": "Member", "price_dollars": 95, "member_only": true, "max_per_order": 5 },
  { "worker_ticket_type_id": "tt_def456", "ticket_name": "Non-member", "price_dollars": 145, "member_only": false, "max_per_order": 5 }
]
```

### Editor steps to turn on an event
1. The **Worker base URL** is already set: it resolves from Design Manager → Theme settings → Integrations → Event Engine worker, which must stay on `Live (production)` (the `-staging` hostname; see `theme/fields.json`). Only override it on a single module when you genuinely want that one module on a different Worker.
2. In the **events** HubDB table for the event: set `use_event_engine = true` and fill
   `ticket_types_json` with the array above (Worker ticket type ids from the Event Engine).
3. Publish the HubDB table. The booking form appears on that event's detail page.

---

## 1b. Training / courses (checkout tunnel)

Course/session registration reuses the existing **checkout-tunnel** React flow
(`/checkout/?session_id=<row_id>`) rather than the vanilla events module, so it keeps
the multi-step UX (confirm → identify → pricing → payment) and the confirmation page.

| File | Change |
|------|--------|
| `src/shared/api/eventEngine.ts` | **New.** Typed Worker client (reserve / pollOrder / idempotency / friendly errors), ported from the events `module.js`. Shared source of truth for the 3 endpoints. |
| `src/modules/checkout-tunnel/CheckoutTunnel.tsx` | New `event_engine` payment provider: Step 4 reserves a seat, polls the order, and redirects to the HubSpot invoice (`reserved`), or to the confirmation page (`confirmed`/free). Waitlist + error shapes shown inline. |
| `src/modules/course-filter/CourseFilter.tsx` | Engine-backed sessions' Register CTA links to `/checkout/?session_id=` (same tab); all others keep the external hapily handoff. |
| `theme/modules/checkout-tunnel.module/*` | Serialises the new per-session worker fields; adds the `event_engine` provider choice + `worker_base_url`/`worker_portal_id` fields. |
| `theme/modules/course-filter.module/module.html` | Adds `use_event_engine` to each serialised session row. |
| `theme/templates/pages/checkout.html` | Sets `payment_provider="event_engine"` + `worker_base_url` once on the module tag, resolved from the theme-wide Integrations setting. |
| `hubdb/courses.json` | Adds `use_event_engine` (BOOLEAN), `worker_event_id` (TEXT), `member_ticket_type_id` / `non_member_ticket_type_id` (TEXT). |

### How a course session maps to the Worker
- Each **session row** is a distinct bookable Worker event → `worker_event_id`.
- Member vs non-member = **two ticket types**; the tunnel picks `member_ticket_type_id`
  when the contact has a `contact_membership_tier`, else `non_member_ticket_type_id`.
- The Worker is authoritative for price/availability; HubDB `price_member`/`price_non_member`
  are display-only.

### Editor steps to turn on a session
1. Confirm `worker_base_url` on the `/checkout/` page (set once on the `checkout_tunnel` tag).
2. In the **courses** HubDB row: `use_event_engine = true`, fill `worker_event_id` and the
   two ticket type ids (from the Event Engine - ask Ollie/Ryan).
3. Publish the HubDB table. That session's Register CTA now routes through the tunnel.

### Backend dependencies (same owners as §3, courses-specific)
- Each engine-backed **session** provisioned in the Worker D1 with a matching event id and
  member + non-member ticket type ids.
- `CMS_ALLOWED_ORIGIN` must allow the Weld origin for `/checkout/` browser calls.

---

## 2. Validation done
- `pnpm validate` (HubSpot spec compliance) - **passing**.
- Full `pnpm build` intentionally not run: this is a vanilla module (no React/Vite
  entry) using HubSpot's auto-included `module.js`/`module.css`; running build would
  only rewrite unrelated React bundle hashes. Run `pnpm build && pnpm upload:sandbox`
  when ready to deploy.

---

## 3. Backend dependencies - needed for end-to-end booking (for Ollie / Ryan)

These are blockers; the frontend can't resolve them.

### 3.1 Worker base URL (staging + prod)
- Need the exact **staging** Worker URL (e.g. `https://event-engine-staging.<account>.workers.dev`) to put in **Settings → Theme → Event Engine → Worker base URL**.
- Confirm the **production** host - Slack/Swagger reference `https://api.fanzava.com` (Swagger at `api.fanzava.com/api-docs`). Confirm this is the Weld production host.

### 3.2 CORS - `CMS_ALLOWED_ORIGIN`
- The Worker gates `/api/v1/*` by the `CMS_ALLOWED_ORIGIN` env var. **Add the Weld site origin(s)** to the allowlist or browser calls fail:
  - `https://441838610.hs-sites-ap1.com` (current HubSpot domain)
  - the production custom domain (e.g. `https://weldaustralia.com.au`) once live
  - the staging/preview domain
- Allowed headers must include `X-Portal-Id`, `Content-Type`, `Idempotency-Key`. Methods `GET, POST, OPTIONS`. (Already in the Worker default - just confirm origins.)

### 3.3 X-Portal-Id
- Defaults to the HubSpot Hub ID **441838610** (Weld). Confirm the Worker tenant is keyed on this id; otherwise provide the correct portal id.

### 3.4 Event + ticket data provisioned in the Worker D1  ← **key unknown**
- The frontend sends the HubDB `slug` as the Worker event id. **Are Weld's events provisioned in the Worker's D1 with matching slugs?**
- For each event, we need the **ticket type ids** (D1 `ticket_types.id`, e.g. `tt_...`) to put in the event row's `ticket_types_json` column. Availability/price are enforced by the Worker; HubDB never carries counts.
- If not provisioned: that's the gap to close before any event can be switched on. Confirm the provisioning path (admin `POST /admin/provision/:portalId`, OAuth install flow, or manual seed).

### 3.5 HubSpot CRM object / property mappings (write-back)
- The Worker writes back to HubSpot via an outbox (deals, invoices, marketing-event registration, contact join-url). Confirm the **internal property names** and pipeline this maps to on Weld's portal - the Drive masterplan references a **"Training & Events" pipeline**, Deal Type = "Event Ticket", and contact props like `contact_membership_status`, `contact_membership_tier`. These internal names are owned by Ollie and not yet finalised.
- Member pricing/gating: the Worker verifies membership at reserve time. Confirm which contact property/association it reads for Weld.

### 3.6 Webhooks & secrets
- Worker secrets (Wrangler): `HUBSPOT_WEBHOOK_SECRET`, `TOKEN_ENCRYPTION_KEY`, `HUBSPOT_CLIENT_ID/SECRET`, `ADMIN_SECRET`, etc. These live in Cloudflare/1Password - confirm they're set for the Weld tenant in staging + prod.
- HubSpot webhook (`POST /webhooks/hubspot`) registration + signing secret for marketing-event/deal/invoice sync.

### 3.7 Payment
- Paid bookings return a HubSpot-hosted invoice `paymentUrl` (Stripe; AU). Confirm the invoice/payment workflow and Xero/tax (GST, ABN ≥ AUD 1,000) config are live for Weld.

### 3.8 Staging vs production differences
- Separate Worker, D1, KV, queue per environment (per `wrangler.toml [env.staging]`). Each needs its own provisioning, secrets, and CORS origins. Production changes go via PR to the staging branch.

---

## 4. ⚠️ Tooling note (not a code issue)
The HubSpot MCP connection used during review is pointed at **Refuel Creative's own
portal (4538263)**, **not Weld Australia (441838610)**. The HubSpot **CLI** (`hs`,
`hubspot.config.yml`) is correctly authed to **weld-australia-staging (441838610)** - its
token is scoped for CMS/HubDB/Pages (can read/write theme + HubDB) but **cannot create
Pages or read CRM** (needs a content/CRM-scoped token for those).

---

## 5. Backbone page-creation checklist (HubSpot UI, staging)

The templates exist in the theme but **no Pages are created from them** yet (only home,
about, advocacy, events, events-detail are published). Create + publish these from
Marketing → Website → Website Pages → Create:

| Page | Template | Slug | Type |
|------|----------|------|------|
| Course detail | `course-router` | `courses-detail` | **Dynamic → bind HubDB `courses` (2371045860)** |
| Course listing/timetable | `course-timetable-hub` | `courses` | Static |
| Checkout | `checkout` | `checkout` | Static (set `worker_base_url` on the module tag) |
| Dashboard (Command Centre) | `dashboard` | `portal` | Static, membership-gated |
| Login | `login` | `login` | Set as the membership login page (Settings → Content → Private content) |
| My Courses / Events / Invoices / Profile | `my-courses` / `my-events` / `my-invoices` / `profile` | per sitemap | membership-gated |

Dependencies for the gated pages: HubSpot **Private Content / Memberships** enabled + a
test member added, and the confirmed active `individual_membership_status` value.

Events detail (`events-detail`, dynamic, bound to events HubDB) is already published.
