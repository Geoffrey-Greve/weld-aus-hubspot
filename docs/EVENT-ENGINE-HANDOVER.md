# Weld Australia - Event Engine + HubSpot Implementation - HANDOVER BRIEF

> ⚠️ **Portal naming (corrected 2026-09-18).** In this document "staging" means
> the Event Engine **Worker** (`event-engine-staging...`) and the HubSpot system
> domain `441838610.hs-sites-ap1.com`. Portal **441838610 is PRODUCTION**; the
> staging HubSpot portal is **443253065**. The Worker secrets, CORS origins and
> system domain below are all keyed to 441838610, i.e. the Event Engine was wired
> against the production portal. Re-keying it to 443253065 is an open task - see
> DEPLOYMENT.md §2. The facts below describe what is deployed today; they have
> not been rewritten.

**Date:** 2026-06-24 · **Author:** prior AI agent (for Melwyn, Refuel Creative)
**Purpose:** Full context so another agent can continue without re-discovery.

---

## 1. What this project is

Refuel Creative is building Weld Australia's new HubSpot CMS website + member portal,
including **events** and **training-course bookings**. Bookings are powered by an
in-house **Event Engine** ("Paddock") - a multi-tenant **Cloudflare Worker** backend
that HubSpot Pro can't replicate (atomic seat capacity, ticketing, check-in).

**Why a Worker:** HubSpot Pro has no atomic seat counting; the Worker owns capacity,
reservations, ticket issuance and check-in. HubSpot owns content, contacts, deals,
invoices, memberships.

**Deadlines:** Client must be off the legacy CAMS system by **2026-06-30**. A recorded
**training-session demo** is scheduled ~**Fri 26 / Mon 29 June** (may move to Wed - confirm
with Ryan/Nick). The training/events flow is the gating concern.

**Demo backbone (per Ollie's readiness doc):** `login → member dashboard → course page →
enrolment that flows to the portal`. Almost all front-end load is Session 1 (Q&C &
Training). Events are a Session-2 "nice to show".

---

## 2. The two systems / two databases (critical mental model)

| Layer | System | Holds |
|------|--------|-------|
| **Content** | HubSpot **HubDB** | Event/course listing + detail page data |
| **Capacity/booking** | **Cloudflare Worker + D1 (SQLite) + Durable Objects + Queues + KV** | events, ticket_types, reservations, orders, registrations, tickets, outbox |
| **Money** | HubSpot **Deals + Invoices** (+ Stripe) | Paid bookings → HubSpot invoice → payment link |
| **Participation** | HubSpot **Marketing Events** | Attendance/registration per contact |

There are **two `events` tables** - the HubSpot **HubDB** `events` table (page content) and
the Worker's **D1** `events` table (booking ledger). Don't confuse them. The page reads
content from HubDB; the booking form/tunnel calls the Worker, which reads/writes D1.

---

## 3. Repos, branch, local paths

- **Theme:** `C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot` - GitHub `Refuel-Creative/weld-aus-hubspot`. HubSpot CMS theme; React-in-HubL islands via Vite.
- **Engine:** `C:\Projects\Clients\Weld-Australia\Github\events-engine` - GitHub `Refuel-Creative/events-engine`. pnpm monorepo: `packages/worker` (Hono, the API), `checkin-pwa`, `hubspot`, `shared`.
- **Branch:** `Event-Engine-implementation-in-Hubspot` (in the theme repo). **Local only - NOT pushed.** The user has asked **not to push**. Commit locally; do not `git push` without explicit instruction.
- Prior commits this phase (newest first): `96bd16e` membership rename, `8e6c7dd` portal editor guard, `3386b0c` course-detail CTA fix, `1e9a7e5` course-page publish unblockers, `33fda0d` template annotations + checkout block fix, `6a3d01c` member-gate property + status doc. Earlier: `120bb5a` "Add Event Engine booking to checkout tunnel" (parallel work - the React checkout-tunnel + `eventEngine.ts`), `b7d1c53` setup.

---

## 4. Key identifiers, URLs, access

**HubSpot (staging):**
- Portal / Hub ID: **441838610** (region AP1)
- System domain: **https://441838610.hs-sites-ap1.com**
- Theme name in Design Manager: **weld-australia-theme**
- CLI config: `hubspot.config.yml` (account name `weld-australia`, portalId 441838610 - **production**; the name `weld-australia-staging` now belongs to portal 443253065). The CLI Personal Access Key token is read from this file. **Scopes:** CRM read (`crm.objects.contacts.read`, `crm.schemas.contacts.read`, deals read), `cms.source_code.read/write`, `cms.pages.*.read`, `hubdb`. **NOT** `cms.pages.site_pages.write` → **cannot create/publish Pages via API** (page creation must be done in the HubSpot UI). CRM is **read-only** (no write scopes) - keep it that way unless told otherwise.
- HubDB tables: **events** id `2371045861` (HubDB name `events`, 128 rows); **courses** id `2371045860` (HubDB name `courses`, label "Courses Timetable & Locations", 106 session rows across **16 distinct `course_slug`s**).

**Event Engine (Cloudflare):**
- **LIVE Worker:** **https://event-engine-staging.refuel-creative.workers.dev** (health → `{"ok":true}`; CORS already allows `https://441838610.hs-sites-ap1.com`). The app launched on this host and it was never renamed, so the `-staging` in the hostname is a naming accident: **this is production**. It is `[env.staging]` in `wrangler.toml`, so `pnpm deploy:staging` is the production deploy.
- `https://event-engine.refuel-creative.workers.dev` — **reserved, never deployed.** The default (unnamed) wrangler env still carries placeholder resource ids, so nothing has ever been published there. Pointing the theme at it takes checkout down. It becomes real only as part of a deliberate rename.
- **Staging D1:** name **`event-engine-db-staging`**, id **`94f2d139-a4f6-41cd-9e16-f4bf81af6827`**. ⚠️ The committed `wrangler.toml [env.staging]` has a **placeholder** D1 id (`...0002`) and queue/KV placeholders - so target the DB **by name** (`wrangler d1 execute event-engine-db-staging --remote …`), not via `--env staging`.
- Staging KV id: `34a86a748dd6446eba89d31136a3f90b`.
- `wrangler` is authenticated on this machine (Cloudflare access). Melwyn has Cloudflare + repo + HubSpot access.

**Secrets set on staging Worker (by prior agent):**
- `ADMIN_API_KEY_441838610` = `wa-stg-admin-f9374fbca98749498b22094c0f5f48f6`
- `TICKET_SIGNING_SECRET_441838610` = `791de8c7b24c47f4abcb58cf8c536be8d06859e64c9c4e9ca505fb1e76cc820f`
- (Also saved to `%TEMP%\weld-staging-secrets.txt`.) Give these to Ryan to canonicalise.
- ⚠️ Set secrets via **`wrangler secret bulk <json> --env staging`** - piping a value into `wrangler secret put` in PowerShell appends a newline, and the Worker compares secrets **exactly** (no trim) → causes 401s.

**Demo data created in staging D1 (by prior agent):**
- `tenants` row for portal `441838610` (status `active`) - required by FKs; OAuth install normally creates it.
- Demo event: `events.id` = **`984d5a9c-12df-4605-b270-ce4017bd6869`** (`hubspot_event_id` `gala-awards-2026`, free, capacity 100).
- Free ticket type: `ticket_types.id` = **`0888ae2d-0cc3-4442-aece-094b6a8e26a8`** (General admission, price 0).
- One test registration ("Demo Buyer") from a verified reserve (`status: confirmed`).

---

## 5. Worker API contract

Public (browser-facing, CORS-gated by `CMS_ALLOWED_ORIGIN`):
- `GET  /api/v1/events/{slug}/availability` - header `X-Portal-Id`
- `POST /api/v1/events/{slug}/reserve` - headers `X-Portal-Id` + `Idempotency-Key`; body `{ buyer:{name,email,abn?}, ticketTypeId? | attendees:[{name,email,ticketTypeId}], memberCompanyId?, memberTier?, expectedUnitCents? }`; returns `confirmed` (free → ticket issued), `reserved` (paid → poll order for `paymentUrl`), `waitlisted`, or an error status (`members_only`, `membership_unverified`, …). `memberCompanyId` is re-validated server-side (CRM company + HubDB members directory) and merged into membership so guest checkout member pricing lands on the invoice; `memberTier` / `expectedUnitCents` remain advisory (price-drift logs only).
- `GET  /api/v1/orders/{id}` - header `X-Portal-Id`; poll until `paymentUrl`.

⚠️ **`:slug` resolves on `events.id` (the UUID)** - see `loadEvent` in `packages/worker/src/db.ts` (`WHERE portal_id=? AND id=?`). So the HubDB row's `worker_event_id` must be the Worker event **UUID**, not the page slug.

Admin/management:
- `/api/v1/manage/*` - auth via header **`X-Admin-Key` = `ADMIN_API_KEY_{portalId}`** (+ `X-Portal-Id`). Create events: `POST /api/v1/manage/events` (body `{hubspotEventId,title,startsAt,endsAt,capacity,location}`); ticket types: `POST /api/v1/manage/events/{id}/ticket-types` (`{name,priceCents,capacity,memberOnly,sortOrder}`). These do plain D1 inserts - **but `events.portal_id` has an FK to `tenants`**, so a `tenants` row must exist first.
- `/admin/provision/:portalId` - **DON'T use.** It requires a stored HubSpot OAuth token and *creates new HubDB tables in the portal* (not what we want).
- Membership at reserve time is read via secret `HUBSPOT_API_KEY_{portalId}`; if absent it returns `membership_unverified` gracefully (free non-member tickets are unaffected).

**The Worker's HubSpot write-back** (Marketing Event registration, Deal, Invoice) reads an **OAuth token stored encrypted in D1 `tenants.hs_access_token`** (auto-refreshing) - set via Ryan's HubSpot OAuth app + install flow, **NOT** a plain secret. Until that's set, bookings confirm in D1 but the HubSpot sync silently fails (queued, retried). **Free bookings work without it; paid/invoice does not.**

---

## 6. Build / upload / deploy workflow (SOP - follow exactly)

Working dir: the theme repo. Before any upload:
```
corepack pnpm build      # runs build + validate-theme + bundle-size; must pass
```
Upload only changed files (avoid full-theme upload):
```
.\node_modules\.bin\hs.CMD cms upload <localpath> weld-australia-theme/<dest> --account=weld-australia-staging --config=hubspot.config.yml
```
e.g. `theme\templates\pages\event-detail.html` → `weld-australia-theme/templates/pages/event-detail.html`.
- **Do not** upload to sandbox; target **staging**.
- `corepack pnpm validate` checks fields.json/meta only - **HubL syntax errors surface only on upload** (server-side), so watch upload output.
- Token in `hubspot.config.yml` expires (~hours); any `hs` command refreshes it. To read CRM/HubDB/Pages via API, extract the refreshed `accessToken` from the yml after running an `hs` command.

**Vanilla modules** (e.g. `event-registration.module`) auto-include `module.js`/`module.css` - no Vite entry needed. React-island modules (checkout-tunnel, member-dashboard, course-filter, etc.) build to hashed bundles via `pnpm build`.

---

## 7. What's been done (this phase)

**Events booking (proven end-to-end on staging):**
- Built `theme/modules/event-registration.module/` (vanilla JS, ported from `events-engine/packages/hubspot`), styled with `--wa-*` tokens. Reads the HubDB event row, emits a `[data-evt-config]` JSON block; `module.js` does availability → reserve → poll → redirect.
- Wired into `theme/templates/pages/event-detail.html`. **Demo is gated on one slug** (`pipeline-repair-hot-tapping-in-service-welding-two-day-course`) + worker config + a free ticket passed via the module tag, because the live HubDB `events` table does **not** have the `use_event_engine`/`worker_event_id`/`ticket_types_json` columns yet (adding columns via API 500'd; deferred). `hubdb/events.json` (repo schema) *does* define them.
- Created the **`events-detail`** dynamic page (bound to HubDB events table) - reserve verified returning `confirmed`.

**Course/portal pages (publishing on staging):**
- Added `<!-- templateType: page / isAvailableForNewContent: true -->` to `course-router`, `course-timetable-hub`, `dashboard`, `checkout` (and `event-detail`) so they appear in the page picker.
- Fixed publish blockers: made `eoi_form_id` optional in `course-filter` + `course-timetable-filter`; fixed `cta-banner` field-name mismatches in `course-timetable-hub`, `course`, `course-sales` (templates passed `sub_headline`/`primary_cta_label`/`primary_cta_link` but the module fields are `body_text`/`cta_label`/`cta_link` (link type)); fixed a `{# #}` comment placed *inside* a `{% module %}` tag in `checkout.html` (broke parsing).
- `portal.html` login redirect to `/login/` wrapped in `{% if not is_in_editor %}` (was breaking the page editor with a "Redirect Error").

**HubDB `hs_path` (dynamic detail routing):** Detail pages route by each row's `hs_path` (empty by default → 404). Filled via API: **events** 120/127 rows (`hs_path = slug`; 7 skipped - duplicate slugs, e.g. two `test-event` rows, need unique slugs); **courses** 16 rows (one per distinct `course_slug`, `hs_path = course_slug`) - the other ~90 are session rows the `course-filter` module queries by `course_id`.

**Membership rename (theme-wide, commit `96bd16e`):** Renamed `contact_membership_status/tier/expiry` → `individual_membership_status` / `individual_membership_type_2` / `individual_membership_expiry_date_2` and active-value comparisons `Active`/`Grace Period` → `Current` across **32 templates/modules** (incl. `portal.html` member-context + dashboard, contact-form, blog-listing, resource-library, course/checkout member-tier, etc.). All uploaded.

---

## 8. Current state of the demo backbone

| Item | State |
|------|-------|
| Events booking (`events-detail`) | ✅ works end-to-end (free reserve → `confirmed`). Currently published on the `weldaustralia.com.au` domain (see §10). |
| Course **timetable** (`/courses`, `course-timetable-hub`) | ✅ published |
| Course **detail** (`/course-detail/{course_slug}`, `course-router` → `course`/`course-sales`) | ✅ CTA fixed; should publish (was DRAFT). Bound to courses HubDB table. |
| **Checkout** (`/checkout`, checkout-tunnel) | ⚠️ page published but **renders empty** - island + bundle present, but `session_id` isn't serialised into props, so the tunnel has no session to show. Needs fix + an engine-backed session (Task B). |
| **Dashboard** (`/portal`, `dashboard.html` → `portal.html`) | ✅ published; editor error fixed; membership wired. Shows real data **only when logged in as a member** (logged-out → redirect to `/login/`, which doesn't exist → 404). Course/cert tiles read unconfirmed properties (`next_upcoming_course_*`, `*_cert_*`) → empty until those exist + enrolment sync runs. |
| **Login** | ✅ HubSpot **Default login template** set (Settings → Content → Private content). The theme references `/login/` in places, which 404s - rely on HubSpot's native gate instead. |

**Pages created (HubSpot Pages):** `courses`, `course-detail` (was DRAFT), `checkout`, `portal` on the **hs-sites-ap1.com** system domain; `home(/)`, `about`, `advocacy`, `events`, `events-detail` were on **weldaustralia.com.au** (user is consolidating - see §10).

---

## 9. CRM / data-model facts (confirmed in the live staging portal)

- **Membership contact properties (real):** `individual_membership_status` (dropdown: **`Current`** = active, `Pending`, `Lapsed`, `Cancelled`); `individual_membership_type_2` (tier: Individual, Corporate, Associate Individual, Reciprocal, TAFE or Government RTO, Student, Apprentice, Industry Supplier, Honourary, Not Applicable); `individual_membership_expiry_date_2`. The theme's old `contact_membership_*` names **do not exist**. Membership status is **mostly unpopulated** on imported contacts (~16% fill) → set it manually on a test member for the demo.
- **Deal pipelines (live):** **two separate** - **"Events pipeline"** and **"Training pipeline"** (not one "Training & Events" as the older Masterplan said). Plus a Membership pipeline. A **Course custom object** exists but is empty (0% fill).
- **Workflows:** extensive Membership automation (update status to Current/Pending/Lapsed on Closed-Won-Deal). **No "enrolment → copy course details to contact" workflow exists yet** → the dashboard "upcoming/registered courses" data source is **not built**.
- **Design intent (Masterplan, may be partly superseded):** a booking/enrolment = a **Deal**; on Paid/Confirmed a workflow copies course details to contact properties (`next_upcoming_course_name/date/location`) which the portal reads; Deal Type "Event Ticket" for events.
- **Other portal properties not yet confirmed** (the rename only covered the 3 membership ones): `next_upcoming_course_*`, `is_corporate_admin`, `wa_company_role_label`, `wa_company_membership_tier`, `as1796_cert_*`, `iiw_cert_*`, `iso3834_cert_*`. Confirm real names with Ollie before relying on them.

---

## 10. Two booking implementations (reconciled - both intended)

Ryan's direction: **"Event Engine only"** (it replaced hapily). There are two complementary front-ends:
1. **Events pages** → vanilla `event-registration.module` (`module.js`) directly.
2. **Training courses** → React **`checkout-tunnel`** module + **`src/shared/api/eventEngine.ts`** (a typed Worker client, *ported from* `module.js`). Reached via a course session's "Register" CTA → `/checkout/?session_id=<courses_row_id>`. Multi-step UX (confirm → identify → pricing → payment). Member vs non-member = two ticket types chosen by membership tier.

`docs/event-engine-integration.md` (same folder) documents both in detail.

---

## 11. Domain split (active issue)

Pages are split across two domains: `weldaustralia.com.au` (home, about, events, events-detail) and `441838610.hs-sites-ap1.com` (courses, course-detail, checkout, portal). On the staging system domain, the `weldaustralia.com.au` pages **404**. This is a **per-page domain setting** (HubSpot Settings → Website → Domains & URLs, or each page's Settings → Domain), **not** caused by code. The user is consolidating onto the staging system domain. ⚠️ `weldaustralia.com.au` is the **production** domain - don't reassign the production homepage's domain without team agreement. For the demo, all demo pages should be on **one** domain (the staging system domain).

---

## 12. Gotchas / lessons (save yourself time)

- **HubSpot MCP is the WRONG portal** (Refuel Creative `4538263`, not Weld `441838610`). Don't use it for Weld. Use the `hs` CLI / direct API with the `hubspot.config.yml` token.
- **PAK can't grant `cms.pages.site_pages.write`** → cannot create Pages via API; the user must create pages in the HubSpot UI. ("Private Apps" moved to "Legacy Apps"/OAuth - heavier.)
- **HubDB dynamic detail pages** need a non-empty **`hs_path`** per row or they 404. Set it via the HubDB v3 API (`PATCH /cms/v3/hubdb/tables/{id}/rows/{rowId}/draft {path}` then `POST .../draft/publish`). `hs_path` must be unique per table.
- **`wrangler secret bulk`**, not piped `secret put` (newline → 401). Secrets are write-only + exact-compared.
- **Reserved module field name `name`** is rejected; required fields need a non-empty default; theme-level `theme/fields.json` disallows `text` field type (use module fields instead).
- **`cta-banner` module** fields are `headline` / `body_text` / `cta_label` / `cta_link` (link type) / `secondary_cta_*` - not `sub_headline`/`primary_cta_*`. Link fields need object form: `cta_link={ "url": { "type": "CONTENT", "href": "/x/" } }`.
- **Never put a `{# … #}` comment inside a `{% module %}` tag** - breaks parsing ("missing endblock").
- **Editor "Redirect Error":** wrap any JS/meta redirect in `{% if not is_in_editor %}`.
- **PowerShell `Get-Content`/`Out-File` mangle UTF-8 → mojibake.** For bulk file edits use `[IO.File]::ReadAllText` + `[IO.File]::WriteAllText($p,$s,(New-Object Text.UTF8Encoding $false))`.
- **Templates need `<!-- templateType: page / isAvailableForNewContent: true -->`** to appear in the page picker (don't add to `login.html` - it's a membership system template).
- Worker `:slug` = `events.id` UUID (not the page slug).
- `wrangler.toml [env.staging]` has placeholder D1/KV/queue ids → target D1 by **name** with `--remote`.

---

## 13. Remaining work (prioritised) + next steps

**A. (DONE) Membership rename** - complete.

**B. Course enrolment end-to-end (the spine - biggest remaining item):**
1. Provision **one course session** in the Worker: `POST /api/v1/manage/events` (use the course session's identity as `hubspotEventId`), then two ticket types (member + non-member) via `POST /api/v1/manage/events/{id}/ticket-types`. Capture the event UUID + ticket type ids.
2. On that **courses** HubDB row (id `2371045860`): set `use_event_engine=true`, `worker_event_id`=the Worker event UUID, and the member/non-member ticket type ids. (Add these columns to the live courses table first - they exist in `hubdb/courses.json` repo schema; the live table may need them added in the HubDB UI.)
3. **Fix the checkout-tunnel `session_id` reading** - `theme/modules/checkout-tunnel.module/module.html` must read `request.query_dict.session_id` (or equivalent), look up the courses row, and serialise it (worker_event_id, ticket ids, member tier) into the island props. Currently no session prop is emitted, so the tunnel renders empty. Inspect `src/modules/checkout-tunnel/CheckoutTunnel.tsx` + its `module.html`.
4. Verify: course detail → "Register" → `/checkout/?session_id=…` → tunnel reserves via Worker → `confirmed` (free) or invoice redirect (paid; needs Ryan's token).

**C. Test member + Private Content (so the dashboard demo is real):** create a test contact with `individual_membership_status=Current`, `individual_membership_type_2=Individual`, future `individual_membership_expiry_date_2`; enable HubSpot **Memberships/Private Content** with that member; gate `/portal`; log in → dashboard membership tile populates.

**D. Domain consolidation:** put all demo pages on one domain (staging system domain) - UI, with care re: production domain.

**E. Make events generalisable:** add `use_event_engine`/`worker_event_id`/`ticket_types_json` columns to the **live events HubDB table** (id `2371045861`), then remove the demo slug-gate in `event-detail.html` (search `_is_demo_engine`). Adding columns via the table-PATCH API 500'd before - do it in the HubDB UI or debug the column payload.

**F. Cleanup/data:** 7 duplicate event slugs need unique slugs (Ollie); confirm the unconfirmed portal property names (§9).

---

## 14. Dependencies from Ryan / Ollie

**Ryan (Worker / Cloudflare):**
- `HUBSPOT_ACCESS_TOKEN` via his HubSpot OAuth app + install (for HubSpot write-back: Marketing Event reg, Deal, Invoice, paid/Stripe). Free demo works without it.
- Confirm/canonicalise the staging secrets the prior agent set.
- The course→Worker-event model (how a training session maps to a Worker event + member/non-member ticket types).
- Confirm the actual demo date.

**Ollie (CRM / data):**
- The **enrolment → contact** sync workflow + how registered/upcoming courses are stored on the contact (so the dashboard tiles populate) - **not built yet**.
- Populate `individual_membership_status` on contacts (mostly empty).
- Confirm the unconfirmed portal property names (`next_upcoming_course_*`, cert props, `is_corporate_admin`, `wa_company_*`).
- Unique slugs for the duplicate event rows.

---

## 15. Hard constraints (respect these)

- **CRM is read-only** - do not write/modify contacts, deals, properties, pipelines, or workflows in HubSpot. (HubDB content edits + page creation are allowed; the user has been editing HubDB rows/columns.)
- **Do not `git push`** - commit locally on `Event-Engine-implementation-in-Hubspot` only.
- **Do not use `/admin/provision`** on the Worker.
- Upload only changed files to **staging**; never sandbox; run `corepack pnpm build` first.
- `weldaustralia.com.au` is the **production** domain - don't make changes that could affect the live site.

---

*Companion docs in this repo: `docs/event-engine-integration.md` (detailed integration + backend deps). Worker source of truth: `events-engine/packages/worker/src/` (`routes/reserve.ts`, `routes/manage.ts`, `db.ts`, `checkin.ts`, `config.ts`, `provision.ts`).*
