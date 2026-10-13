# Event Engine API - Postman collection reference

Companion to `EVENT-ENGINE-HANDOVER.md`. Describes the Event Engine (Cloudflare
Worker) HTTP API as captured in the team's Postman collection, so an agent can call
it correctly.

**Raw Postman collection file:**
`C:\Projects\Clients\EdwardsGroup-EchoPark\Project-Related\Postman\Environments\Weld Australia.postman_collection.json`
(It's the "Weld Australia" collection → "Events Engine" folder. The path is under the
EdwardsGroup folder for historical reasons but it IS the Weld Event Engine collection.)

---

## Environments (collection variables)

The collection is built for **two environments** via `{{variables}}`:

**Local dev**
- `eventsengine_base_url` = `http://127.0.0.1:8787`
- `eventsengine_portal_id` = `99999999`
- `eventsengine_admin_key` = `dev-admin-key`
- `eventsengine_eventId`, `eventsengine_orderId`, `eventsengine_device_token`, `eventsengine_qrcode` = dev fixtures (seeded locally)

**Staging (use these for the real worker):**
- base URL = **`https://event-engine-staging.refuel-creative.workers.dev`**
- portal id = **`441838610`**
- admin key = the **real** `ADMIN_API_KEY_441838610` (value in `EVENT-ENGINE-HANDOVER.md` §4) - **NOT** `dev-admin-key` (that's local only)
- eventId / ticketTypeId / orderId / device token / qrcode = create via the staging API (e.g. demo event `984d5a9c-12df-4605-b270-ce4017bd6869`, ticket type `0888ae2d-0cc3-4442-aece-094b6a8e26a8`)

> The collection's `eventsengine_staging_*` vars were left blank/placeholder originally - fill them with the staging values above.

---

## Auth model (which header each group needs)

| Endpoint group | Auth |
|---|---|
| Health, Public (availability/reserve/order) | `X-Portal-Id` header (reserve also needs `Idempotency-Key`) |
| Manage (events, ticket types, onboarding) | `X-Portal-Id` **+ `X-Admin-Key`** (= `ADMIN_API_KEY_{portalId}`) |
| Check-in (manifest/stats/scan) | `Authorization: Bearer <device_token>` |
| Issue device token | `X-Portal-Id` + `X-Admin-Key` |
| Super-admin (tenant status) | `Authorization: Bearer <ADMIN_SECRET>` |
| Dev seed | none, local only (guarded by `DEV_SEED_ENABLED=true`) |

⚠️ In the public routes, `:slug` resolves to the Worker **`events.id` (UUID)**, not a page slug.

---

## Endpoints (by Postman folder)

**1 - Health**
- `GET {base}/health` → `{"ok":true}`

**2 - Public Registration (CMS)** - the booking flow the website uses
- `GET {base}/api/v1/events/{eventId}/availability` - `X-Portal-Id`. Live seat availability per ticket type.
- `POST {base}/api/v1/events/{eventId}/reserve` - `X-Portal-Id`, `Idempotency-Key`, `Content-Type: application/json`. Body:
  ```json
  { "buyer": { "name": "...", "email": "...", "abn": "optional" },
    "ticketTypeId": "tt_..."  // single seat
    // OR "attendees": [ { "name","email","ticketTypeId" }, ... ]  // group
    // Optional guest member unlock (CMS checkout):
    // "memberCompanyId": "123456",   // HubSpot company ID — re-validated server-side
    // "memberTier": "corporate_gold", // advisory; logged on price drift only
    // "expectedUnitCents": 70000      // advisory; logged on price drift only
  }
  ```
  Returns `confirmed` (free → ticket issued), `reserved` (paid → poll order for `paymentUrl`), `waitlisted`, or an error status (`members_only`, `membership_unverified`, `offer_expired`, …).
  Membership/pricing: resolved from the buyer email (contact → associated company → HubDB),
  then merged with a re-validated `memberCompanyId` when present so guest checkout that
  unlocked a member rate invoices at the tiered member price (not the standard ticket).
- `GET {base}/api/v1/orders/{orderId}` - `X-Portal-Id`. Poll until `paymentUrl` appears (paid path).

**3 - Check-in** (the QR scanner PWA uses these)
- `POST {base}/api/v1/checkin/device-token` - admin (`X-Portal-Id`+`X-Admin-Key`). Body `{ "eventId","deviceId" }` → returns a device token.
- `GET {base}/api/v1/checkin/manifest/{eventId}` - `Bearer <device_token>`. Offline manifest (verify key + ticket list).
- `GET {base}/api/v1/checkin/stats/{eventId}` - `Bearer`. `{registered, attended, notYetArrived}`.
- `POST {base}/api/v1/checkin` - `Bearer`. Body `{ "code": "<qr>", "scannedAt": "ISO" }`. Single scan.
- `POST {base}/api/v1/checkin/batch` - `Bearer`. Body `{ "scans": [ {code, scannedAt}, ... ] }`. Flush offline queue.

**4 - Manage / Events (Admin)** - `X-Portal-Id` + `X-Admin-Key`
- `GET {base}/api/v1/manage/events` - list events. `?hubspotEventId=...` to filter.
- `POST {base}/api/v1/manage/events` - create. Body `{ "hubspotEventId","title","startsAt","endsAt","capacity","location","allowOversell" }`. Returns the event (incl. `id` UUID).
- `PATCH {base}/api/v1/manage/events/{eventId}` - `{ capacity, location, allowOversell, title, startsAt, endsAt }`.
- `GET {base}/api/v1/manage/events/{eventId}/ticket-types` - list.
- `POST {base}/api/v1/manage/events/{eventId}/ticket-types` - create. Body `{ "name","priceCents","capacity","memberOnly","sortOrder" }` (priceCents = integer cents; 0 = free).
- `PATCH {base}/api/v1/manage/events/{eventId}/ticket-types/{ttId}` - `{ priceCents, capacity, memberOnly }`.
- `GET {base}/api/v1/manage/events/{eventId}/stats` - `{capacity, registered, attended, availableSeats}`.

**5 - Manage / Onboarding (Admin)** - tenant config (be careful; these mutate tenant settings)
- `GET /api/v1/manage/onboarding` - onboarding/billing state.
- `PATCH /api/v1/manage/onboarding/stripe` `{ connected }`
- `PATCH /api/v1/manage/onboarding/xero-gst` `{ xeroGstRateId }`
- `PATCH /api/v1/manage/onboarding/webinar-creds` `{ provider, tenantId, clientId, clientSecret }`
- `GET /api/v1/manage/onboarding/webinar-creds`, `GET /api/v1/manage/onboarding/connections`
- `PUT /api/v1/manage/onboarding/connections/on24` `{ clientId, tokenKey, tokenSecret }`
- `DELETE /api/v1/manage/onboarding/connections/{provider}`
- `PATCH /api/v1/manage/onboarding/dynamic-page` `{ domain }`

**6 - Admin (Super Admin)** - `Authorization: Bearer <ADMIN_SECRET>`
- `PATCH {base}/admin/tenants/{portalId}/status` `{ "status": "installed|active|past_due|cancelled" }`

**7 - Dev Only (local)** - only when `DEV_SEED_ENABLED=true`
- `POST {base}/dev/seed-ticket` `{ portalId, eventId, ticketTypeId, email, name }`

---

## Safe vs mutating (for an agent calling staging)

- **Read-only (safe):** all `GET` - health, availability, order, manage list/stats/ticket-types, onboarding GET.
- **Mutating (intended writes to the Worker's D1):** `POST/PATCH` create/update events + ticket types, reserve (creates a real reservation/order), check-in scans.
- **Tenant/config changing (be deliberate):** onboarding PATCH/PUT/DELETE, super-admin tenant status. Don't call these on staging unless that's the task.
- The Worker's **HubSpot write-back** (Deals/Invoices/Marketing-Event) only fires once `tenants.hs_access_token` is set (Ryan's OAuth app). Until then, reserves succeed in D1 but nothing appears in HubSpot.

## Local-dev note (from the collection's notes)
`.dev.vars` in `packages/worker`: `DEV_SEED_ENABLED=true`, `ADMIN_API_KEY_99999999=dev-admin-key`, `DEVICE_TOKEN_SECRET_99999999=dev-device-secret`, `TICKET_SIGNING_SECRET_99999999=dev-ticket-secret`, `HUBSPOT_WEBHOOK_SECRET=dev-webhook-secret`, `ADMIN_SECRET=dev-super-admin`. Run: `wrangler d1 migrations apply event-engine-db --local`, seed `migrations/seed_dev.sql`, then `pnpm.cmd dev` in `packages/worker` (and `packages/checkin-pwa`).
