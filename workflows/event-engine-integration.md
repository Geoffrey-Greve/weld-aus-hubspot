# Event Engine Integration Contract

> **Status:** Frontend wired for courses and events. Membership signup handoff is
> built (`membership-options` → `membership-join`) but the per-tier payment links are
> not yet pointed at the Event Engine - pending the worker exposing membership checkout.

---

## Overview

Weld Australia uses its **own Event Engine** - a Cloudflare Worker
(`worker_base_url`, default `https://event-engine-staging.refuel-creative.workers.dev`)
fronted by the on-site checkout tunnel at `/checkout/` - as the registration and
payment processor for course sessions and events. The theme frontend does **not**
process payments itself; it collects context and hands off to the engine.

> **Naming note:** the shared handoff util was renamed `buildHapilyUrl` →
> `buildRegistrationUrl` (`src/shared/utils/registration.ts`). "hapily" now refers only
> to the **legacy external registration URL** path kept as a fallback for imported rows
> that predate the Event Engine; Weld Australia does not use event.hapily for new work.

---

## Course & event checkout (the reference flow)

- **Courses:** `CourseFilter` / `CourseTimetableFilter` send Event-Engine-backed sessions
  (HubDB `courses` row with `use_event_engine = true`) to `/checkout/?session_id=<row id>`.
  Rows without an engine flag but with a real external `registration_url` fall back to
  `buildRegistrationUrl(registration_url, tier)` (the legacy external handoff); rows with
  neither fall back to a `mailto:` to the training team.
- **Events:** routed to `/checkout/?event_id=<events row id>`.
- The `checkout-tunnel` module (`theme/modules/checkout-tunnel.module/module.html`) looks
  up the `courses` / `events` HubDB row, resolves logged-in member context (tier, status,
  company) from the CRM + members HubDB, and hands the interactive steps to the
  `checkout-tunnel` React island, which talks to the Event Engine worker.

### Member tier handoff (`wa_member_tier`)

`buildRegistrationUrl` appends `?wa_member_tier={tier}` to a registration/checkout URL for
logged-in members so the engine can resolve member pricing; it is a no-op for
guests/non-members. Tier values mirror the contact/company membership properties
(`individual`, `corporate_gold`, `corporate_silver`, `corporate_bronze`, `supplier_*`,
`reciprocal`, …; empty = non-member).

`buildRegistrationUrl` (`src/shared/utils/registration.ts`) is used in:

| Component | File |
|---|---|
| Course page session cards (legacy fallback) | `src/modules/course-filter/CourseFilter.tsx` |
| Timetable hub rows & cards (legacy fallback) | `src/modules/course-timetable-filter/CourseTimetableFilter.tsx` |
| Checkout tunnel redirect step | `src/modules/checkout-tunnel/CheckoutTunnel.tsx` |
| Membership join CTA | `theme/modules/membership-join.module/module.html` (HubL, server-side) |

---

## Membership signup

Membership uses a separate, simpler handoff (not the `/checkout/` tunnel):

```
membership.html (membership-options module, tabbed)
  └─ each tier CTA → /membership/join/?tier=<slug>&price_label=…&price_value=…&price_sub=…
        (the module rewrites any /contact-us CTA to this join route automatically)

membership-join.html (membership-join module)
  └─ resolves the tier from ?tier=
  └─ paid tiers → "Continue to secure payment" → per-tier payment link, if configured
  └─ free / by-agreement tiers (student-apprentice, reciprocal, tafe-rto) →
     per-tier theme form → HubSpot Forms API (issue 251 — Revenue Hub cannot check out $0)
  └─ otherwise → graceful "request payment/application" email fallback
```

**Connecting membership payment links (paid tiers):** the `membership-join` module
exposes one editable `link` field per paid tier - `individual_payment_link`,
`corporate_gold_payment_link`, `corporate_silver_payment_link`,
`corporate_bronze_payment_link`, `supplier_gold_payment_link`,
`supplier_silver_payment_link`, `supplier_bronze_payment_link`. Point each of these at the
**HubSpot payment link** for that tier (card auto-renew) or the Event Engine membership
checkout URL once that exists. Invoice-billing members renew from the portal by paying
their HubSpot invoice (`hs_invoice_link`), not by re-hitting the generic payment link.
For logged-in members the join CTA appends `?wa_member_tier=<tier>` to the configured link
(same mechanism as courses), so the engine can resolve pricing/entitlements.

**Free / by-agreement application forms (issue 251):** select
`student_apprentice_application_form`, `reciprocal_application_form`, and
`tafe_rto_application_form` on the same module. Do not use payment links for these
slugs — HubSpot cannot sell a $0 product through Revenue Hub checkout.

Until a paid tier's link (or free tier's form) is set, the module keeps its graceful
email fallback, so the page is safe to ship before the backend is ready.

Join slugs (from `membership-options`): `individual`, `student-apprentice`, `reciprocal`,
`tafe-rto`, `corporate-gold`, `corporate-silver`, `corporate-bronze`, `supplier-gold`,
`supplier-silver`, `supplier-bronze`.

---

## Engine → HubSpot sync (backend responsibility)

After a successful engine checkout, the Event Engine must sync back to HubSpot:

- **Course / event:** create/update the Contact, create a `Training & Exams` Deal
  (`deal_type = Training Course`, location, start date, `Closed Won`), associate it, and
  trigger the workflow that pushes `next_upcoming_course_*` to the Contact.
- **Membership:** create/update the Contact/Company, create a `Membership` Deal, and on
  Closed Won set `individual_membership_status` / `individual_membership_type_2` (and the
  company `corporate_membership_*` / `industry_supplier_membership_*` equivalents).

---

## Open dependency - membership checkout

Join / upgrade payment for **paid** tiers is **not live** until the HubSpot payment links
are pasted into the `membership-join` per-tier payment-link fields. Free tiers need the
three application forms selected on the same module (issue 251). Invoice renewals
need HubSpot invoices associated to the contact with `hs_invoice_link` + balance due —
the portal Pay now path is already wired.

See `docs/member-portal-config-handoffs.md` § Issue 34.

---

## Sandbox Verification Checklist

- [ ] Course sessions flagged `use_event_engine` open `/checkout/?session_id=`; events open `/checkout/?event_id=`.
- [ ] Legacy external `registration_url` sessions still hand off via `buildRegistrationUrl` with `?wa_member_tier=` for logged-in members.
- [ ] Non-member clicks do NOT append `?wa_member_tier=`.
- [ ] `membership-options` CTA → `/membership/join/?tier=<slug>`; `membership-join` renders the selected tier.
- [ ] With a tier payment link unset, the email fallback shows; with it set, a logged-in member's CTA href carries `?wa_member_tier=`.
- [ ] A completed engine checkout creates the matching Deal in HubSpot Closed Won and updates membership/course properties.
