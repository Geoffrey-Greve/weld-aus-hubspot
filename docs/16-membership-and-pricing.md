# Membership, gating and pricing

The single hardest part of this build to get right, and the source of most of
the QA defects. Read this before touching anything that decides whether a
visitor is a member or what they should pay.

---

## 1. The model

There is no single "is a member" flag. Entitlement can come from any of four
places, and a contact can hold several at once:

1. **The contact's own membership** - `individual_membership_status` and
   `individual_membership_type_2`.
2. **Their employer's corporate membership** - via `associatedcompanyid` to a
   Company with `corporate_membership_status` /
   `corporate_membership_level_2`, or the industry-supplier equivalents.
3. **The Find a Member directory** - an active row in `members` matching their
   email, used as a last-resort signal.
4. **A QA persona** - a Refuel plus-address matching an active
   `portal_test_profiles` row (never a real member).

A user can hold a free Apprentice individual membership **and** be an Employee
under a paid Corporate account, through one login. Entitlements are unioned;
pricing takes the strongest tier.

---

## 2. Two rules that cause most of the bugs

### 2.1 "No membership" is a string, not an empty value

HubSpot stores it as a dropdown label: `Not Applicable`, `Non Member`,
`Never Member`, `None`, `N/A`. A bare truthiness test therefore reads it as a
real individual membership and refuses to fall back to the employer's corporate
tier. That was defect 213: the same Gold-company employee was quoted
`price_gold` on `/courses/` and `price_member` on the timetable.

Use `theme/templates/partials/_member-tier.html`, the one implementation of the
rule:

```html
{% import "../../templates/partials/_member-tier.html" as wa_tier %}

{% set _is_real = wa_tier.is_real_tier(contact_tier)|trim %}   {# 'true' or '' #}
{% set _clean   = wa_tier.scrub(contact_tier)|trim %}          {# sentinels → '' #}
{% set _tier    = wa_tier.prefer_pricing_tier(contact_tier, company_tier)|trim %}
```

`prefer_pricing_tier` prefers a metal company tier (Gold, Silver, Bronze) over a
weaker contact tier, which matches the portal rule and
`pickBestMemberTier` in TypeScript.

The sentinel list is asserted by `src/shared/utils/memberPricingParity.test.ts`,
so adding a value to the macro without updating the test fails the build.

### 2.2 Always `|trim` a macro result

HubL macros emit surrounding whitespace, so `{% if wa_tier.is_real_tier(x) %}`
is **always** true. Assign the trimmed result to a variable and test that.

For the same reason, the macros in `_member-tier.html` and `_member-pricing.html`
are each self-contained and never call one another: HubL is a restricted Jinja2
and a cross-macro call inside an imported namespace fails server-side on upload,
where you find out late.

---

## 3. Resolving membership in HubL

Every surface that prices or gates does the same walk. `course-filter.module`
and `_resource-member-resolve.html` are the reference implementations. Copy one
rather than writing a shorter version.

```
1. Read individual_membership_type_2 / _status from request_contact, then contact.
2. If logged in, try crm_object('contact', <id>) across every candidate id
   (request_contact.id / hs_object_id / vid, then the contact equivalents),
   because the lightweight private-content contact object does not reliably
   expose both membership fields.
3. If none of those resolved, look the contact up by email with crm_objects().
4. If a company id resolved, read the Company's corporate or industry-supplier
   tier and status, scrub sentinels, and apply prefer_pricing_tier.
5. If still no tier, check the members directory by email (is_active only).
6. Scrub sentinels again, then classify status:
     active    → current, active, grace, grace_period, honorary
     inactive  → lapsed, expired, inactive, cancelled
7. Apply the QA persona override last, if one matches.
```

Two details worth calling out, both of them past bugs:

- **Do not wipe `associatedcompanyid` when `crm_object` returns a contact
  without one.** That broke the corporate tier fallback (defect 126).
- **Prefer the company's metal tier over a weaker contact tier**, rather than
  "use the company only when the contact is empty". Sentinels make "empty"
  unreliable.

`_resource-member-resolve.html` exposes the result as a `resource_member`
namespace (`logged_in`, `email`, `status_raw`, `tier`, `is_active`,
`tier_rank`), which resource listing and detail templates both use, so listing
and detail can never disagree about a lock.

---

## 4. The member wall

### 4.1 Private Content

Portal pages sit behind HubSpot CMS Private Content. The audience list is
configured **in HubSpot**, per page, and workflows keep the lists in sync. The
frontend never mutates them.

Lists (CLAUDE.md § 9.1):

- **Active Members** - status in (Active, Grace Period) and expiry in the
  future, or associated to a Company for which the same holds.
- **Corporate Gold / Silver** - tier-gated content.
- **Primary Admin** - drives the Corporate Admin tile.

`portal.html`'s visible sign-in panel is the secondary gate, for a page whose
audience was never set. It is a fallback, not the protection.

### 4.2 `window.__WELD_MEMBER__`

`portal.html` injects this in `extra_head`. Shape (typed as
`WeldMemberContext`):

```js
{
  contact:        { id, firstName, lastName, email, membershipTier,
                    membershipStatus, membershipExpiry,
                    nextCourse: { name, date, location } },
  associations:   [{ companyId, companyName, roleLabel, tier }],
  activeContext:  'personal',            // cookie wa_active_context
  certifications: [{ type, status, expiry, certificateUrl, currentStep }],
  entitlements:   { canDownloadResources, isPrimaryAdmin }
}
```

Status normalisation happens in HubL before injection:

| CRM value | Injected as |
|---|---|
| honorary, honorary_member, honorary_membership | `honorary` |
| current, active | `active` |
| grace, grace_period | `grace_period` |
| lapsed, expired, inactive | `lapsed` |
| anything else | `never_member` |

`canDownloadResources` is true for active, grace period or honorary.
`isPrimaryAdmin` comes from `is_corporate_admin` (or the QA persona).

Read it with `useMemberContext()` and treat it as read-only. Certifications are
emitted per known type (`as1796`, `iiw_inspector`, `iso3834`) from separate
property groups, which is why those groups exist: it stops one certification's
workflow overwriting another's status.

### 4.3 Preview contexts

`is_in_editor`, `is_in_previewer`, `?portal_preview=1` and `?hs_preview` all get
a hard-coded mock context (Corporate Silver, active), so the HubSpot page
builder never renders a blank portal body. **The mock reads no CRM data.**

Anonymous non-preview visitors are not redirected from `extra_head`: a head
redirect blanks the builder iframe. They get the visible sign-in panel instead.

### 4.4 SSO is not in Phase 1

Members log in with HubSpot Membership credentials only. WeldQ, Moodle and
ISO 3834 keep their own logins on their own domains until Phase 2. Portal copy
must not promise a unified login, and the password reset flow resets the HubSpot
Membership password only. CLAUDE.md § 9.2.

---

## 5. QA personas

Testers need Gold, Silver, Bronze, lapsed and never-member behaviour without
fabricating CRM Deals. `portal_test_profiles` provides it, matched on a
plus-address:

```
nick+portal-qa-corporate-silver@… matches the row with profile_code
"portal-qa-corporate-silver"
```

Use the shared resolver, and set the email first because an include shares the
parent scope:

```html
{% set qa_persona_email = checkout_contact_email %}
{% include '../../templates/partials/_qa-persona-resolve.html' %}
{% if qa_persona.found and qa_persona.entitled %}
  {% set member_tier = qa_persona.pricing_tier %}
{% endif %}
```

`qa_persona` exposes `found`, `member_type`, `tier_key`, `status_key`,
`membership_status`, `company_name`, `entitled`, `pricing_tier`, `company_tier`.

Rules:

- Only an active row whose `profile_code` appears as `+<code>@` in the email can
  match. Real members never enter this branch.
- `never_member` and `lapsed` personas are **not** entitled, so the lapsed path
  is testable.
- `pricing_tier` prefers the human label ("Silver Corporate") because it
  contains the metal keyword the normalisers match on, falling back to
  `tier_key`.
- The table is `allowPublicApiAccess: false`.

The portal and the command centre used these first; course pricing and checkout
did not, so the same tester saw Silver rates in `/portal` and full price at
`/checkout`. Every pricing surface now resolves personas. If you add one, resolve
them there too.

---

## 6. Pricing

### 6.1 One rule, two implementations, one parity test

| Side | File |
|---|---|
| HubL (server-rendered cards, course pages, timetables, pricing tables) | `theme/templates/partials/_member-pricing.html` |
| TypeScript (islands, checkout) | `src/shared/utils/memberPricing.ts` |
| The guard | `src/shared/utils/memberPricingParity.test.ts` |

The duplication is unavoidable: HubL cannot call TypeScript. The parity test is
what makes it safe. Change both, or the build fails.

```html
{% import "../../templates/partials/_member-pricing.html" as wa_price %}
{% set _tier_key = wa_price.member_tier_key(tier)|trim %}
{% set _member   = wa_price.member_price(row, tier)|trim|float %}
{% set _public   = wa_price.non_member_price(row)|trim|float %}
```

These macros answer "what would this tier pay", not "is this visitor a member".
Callers gate on membership themselves and pass `''` as the tier for a visitor
who is not entitled.

### 6.2 Tier to column

| Tier keyword | Column |
|---|---|
| gold | `price_gold_aud_ex_gst`, else `price_gold` |
| silver | `price_silver_aud_ex_gst`, else `price_silver` |
| bronze | `price_bronze_aud_ex_gst`, else `price_bronze` |
| apprentice, student | `price_student_aud_ex_gst`, else `price_student` |
| individual, reciprocal, associate, honorary, industry supplier, member | `price_individual` |
| empty or unknown | `price_member` |

The live HubDB columns carry the `_aud_ex_gst` suffix; the islands receive short
keys because HubL renames them when serialising props. The macros try the live
names first and fall back to the short names.

An empty tier resolves to `member`, **not** `individual`. That distinction is
the portal-versus-course-page mismatch in defect 213.

Fallback chain when the exact tier price is 0 or unset:
`price_member → price_individual → price_non_member`. `resolveMemberPrice`
reports `fallbackUsed` so a caller can tell a real rate from a fallback.

### 6.3 Presenting it

- The member saving is shown in `--wa-color-success`, bold, from step 3 of
  checkout onwards. That is a mandated UX rule: the discount validates the
  membership during the transaction.
- Non-member price is struck through when a member tier is present.
- Prices in HubDB are AUD ex GST. Whether every column truly is, is an open
  question, see [member-portal-config-handoffs.md](./member-portal-config-handoffs.md).

### 6.4 Guest member pricing

A logged-out buyer can type a member company ID at checkout.
`validateMemberCompany()` matches it against `hubspot_company_id` in the public
`members` table and unlocks the member rate.

**This is a non-binding preview.** The key is publicly enumerable by design, so
the backend must re-validate before charging. See
[14-shared-library.md](./14-shared-library.md) § 3 for the forwarding contract on
each payment path.

### 6.5 Keeping the quote stable across screens

`checkoutPricingHandoff` writes the resolved tier and price into
`sessionStorage` on the course page and reads it in the checkout tunnel, so the
number does not change between the two screens. The server still decides what is
charged.

---

## 7. Profile switching

A contact with more than one active context gets a switcher; a contact with one
sees nothing. Switching writes the `wa_active_context` cookie and reloads, and
the next render reflects it via `activeContext`.

The important rule: **entitlements are the union of all contexts, regardless of
which is selected.** An Apprentice who is also a Corporate Gold employee sees
both content sets on the Resources Hub. Only display and the membership-status
tile follow the selected context.

Phase 1 injects at most one association (the primary associated company). The
full multi-company list is Phase 2.

---

## 8. Checklist for a new gated or priced surface

- [ ] Resolve membership in HubL using the walk in § 3, not a shortcut.
- [ ] Scrub sentinels with `_member-tier.html`.
- [ ] Resolve price with `_member-pricing.html` or `memberPricing.ts`, never a
      hand-rolled chain.
- [ ] Resolve QA personas with `_qa-persona-resolve.html`.
- [ ] `|trim` every macro result.
- [ ] Show savings in `--wa-color-success`, bold.
- [ ] Locked content shows a preview and an upgrade CTA, never a 403.
- [ ] A missing `xero_invoice_pdf_url` shows "Receipt processing", not a broken
      link.
- [ ] Test as: active member, grace period, lapsed, never member, honorary,
      Gold-company employee with a weaker individual tier, and logged out.
