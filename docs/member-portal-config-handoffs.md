# Member portal - configuration handoffs

Two portal defects are code-complete but cannot fully work until someone completes a
configuration step in HubSpot. Neither needs a further deploy once the config is in
place. This page is the checklist.

---

## Issue 30 - member company ID entry (needs Ollie)

**Status:** UI, verification and persistence are built and shipped, but the field is
**hidden until configured**. Nothing is broken in the meantime.

The portal profile page now has a "Member company ID" box that verifies the number
against the active rows of the `members` HubDB table (the same lookup the public
checkout uses, `validateMemberCompany` in `src/shared/api/members.ts`) and reports the
matched company and tier before the member saves.

### Why it is off by default

`profile-form.module` submits **every named input** to the HubSpot Forms API in one
request. HubSpot rejects a submission that carries a field the form does not define, so
if this box were live before the property and the form field existed, **every profile
save would fail**, not just this field. It stays hidden until both sides are ready.

### To switch it on

1. **Create the contact property.** Agree the internal name with Ollie (CLAUDE.md §8.2).
   Something like `wa_member_company_id`, single-line text.
2. **Add a field with that exact internal name** to the form selected in the module's
   "Profile update form" picker (currently `809fa5de-e922-45c5-8ec3-f43eabfd1e2f`).
3. **Set the module field** "Member company ID property" on the profile-form module to
   that same internal name. The field appears as soon as this is non-empty.
4. Optionally adjust "Member company ID help text".

### What it does and does not do

- It **records the member company the contact claims** and shows instant confirmation.
- It does **not** write a Company↔Contact association - that stays CRM/workflow-managed.
  Ollie's workflow should read the property and create the association, which is what
  actually drives the Member Wall lists and sitewide pricing.
- The typed ID remains a **non-binding preview**. `hubspot_company_id` is publicly
  enumerable through the Find a Member directory (accepted risk, signed off 2026-07 -
  see the header comment in `src/shared/api/members.ts`), so the binding check stays
  server-side at payment, where it already is.

---

## Issue 34 - membership renew / upgrade / pay (needs Weld Aus finance)

**Status:** portal routing is built. Remaining work is **pasting HubSpot payment
links** for paid tiers on `/membership/join/`, **selecting per-tier application
forms** for free/by-agreement tiers (issue 251), and confirming renewal invoices
are associated to the contact.

### How members manage membership in the portal

| Situation | Portal CTA | Destination |
|---|---|---|
| Open HubSpot invoice (`hs_invoice_link` + balance due) | **Pay invoice now** | That invoice's hosted pay page |
| Lapsed / grace period, no open invoice | **Renew membership** | `/membership/join/?tier=<current>` → payment link (paid) or application form (free) |
| Active, inside 60-day window, nothing owed | **Upgrade membership** | Next tier join URL (or comparison page). Note explains card auto-renew vs invoice pay |
| Locked resource | **Upgrade** | Same upgrade URL helper |
| My Invoices list | **Pay now** | Same `hs_invoice_link` when balance &gt; 0 (PDF no longer required to list the row) |

Card subscribers on auto-renew should see **Upgrade** (not "Renew early") when nothing is
owed — HubSpot already charges the card. Invoice subscribers renew by paying the
HubSpot invoice HubSpot generates for that billing cycle.

### Config step - paste payment links (paid tiers)

`membership-join.module` has one `*_payment_link` field per **paid** tier. When a
tier's link is empty the page shows "Request payment link" as a mailto to
`membership@weldaustralia.com.au`. Paste each HubSpot payment link into the matching
field on the `/membership/join/` page module — no code change, no deploy.

| `fields.json` name | `?tier=` slug |
|---|---|
| `individual_payment_link` | `individual` |
| `corporate_bronze_payment_link` | `corporate-bronze` |
| `corporate_silver_payment_link` | `corporate-silver` |
| `corporate_gold_payment_link` | `corporate-gold` |
| `supplier_bronze_payment_link` | `supplier-bronze` |
| `supplier_silver_payment_link` | `supplier-silver` |
| `supplier_gold_payment_link` | `supplier-gold` |

### Config step - free / by-agreement application forms (issue 251)

Revenue Hub cannot check out `$0` products, so free tiers use a **HubSpot form per
tier** instead of a payment link. Select each form on the same `/membership/join/`
module instance:

| `fields.json` name | `?tier=` slug | Form GUID (portal 441838610) |
|---|---|---|
| `student_apprentice_application_form` | `student-apprentice` | `842ea403-aeec-4cea-b2f6-d0a22ce8db35` |
| `reciprocal_application_form` | `reciprocal` | `1c03846a-c399-4750-a58d-fb735a1b18d2` |
| `tafe_rto_application_form` | `tafe-rto` | `93662621-fb14-4fc1-ad52-79dd463c4c7e` |

These GUIDs are the module field defaults and also hard fallbacks in
`membership-join.module/module.html`, so already-published join pages submit to
the correct form without a one-off editor re-save.

The join page renders a **theme-owned HTML form** (same pattern as
`contact-form`) and POSTs to the Forms API — HubSpot’s new form editor embeds
in a cross-origin iframe, so parent CSS cannot style them. Tier is identified by
which form GUID was submitted (and `?tier=` / page context). Do **not** auto-set
Active membership from the form alone — route for eligibility review, then
activate via the existing Membership Closed Won workflow.

**CAPTCHA must be off** on each of those three forms. HubSpot returns
`FORM_HAS_RECAPTCHA_ENABLED` and rejects API submissions when spam CAPTCHA is
enabled (Marketing → Forms → form → Options / spam prevention). Same constraint
as the theme `contact-form` module.

Legacy `student_apprentice_payment_link` / `reciprocal_payment_link` /
`tafe_rto_payment_link` fields remain on the module so existing instances do not
lose data, but the free-tier branch ignores them.

### Backend checks (Ollie / finance)

1. Renewal invoices for invoice-billing subscriptions are created in HubSpot and
   **associated to the contact** (Contact → Invoice association type 178).
2. `hs_invoice_link` and `hs_balance_due` populate — that is what drives Pay now.
3. Card auto-renew subscriptions should not also get a "please renew" join CTA pushed
   via email that implies a second purchase.
4. Free-tier form submissions create/update the Contact and a Membership Deal (or
   ticket) for eligibility review; on approve / Closed Won, activate
   `individual_membership_*` (or company equivalents) the same as paid joins.

---

## Open question raised by this work: are HubDB prices ex or inc GST?

Not a config step - a decision needed from Weld Australia before any code changes.

`hubdb/courses.json` labels every price column **"(AUD ex GST)"**. But
`src/shared/utils/formatCurrency.ts` documents them as **inc. GST** and
`gstComponentDollars()` divides by 11 to extract embedded GST, which the checkout
renders as "GST (included)" and "Total (inc. GST)".

Both cannot be true. If HubDB is correct, the checkout is under-collecting GST by ~10%
on every transaction. If `formatCurrency.ts` is correct, the HubDB column labels are
misleading to whoever maintains the table. Confirm which, then fix the other side.
