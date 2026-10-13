# Member Portal - "My Certifications" pages: HubSpot setup

**For:** Ollie (HubSpot CRM / portal config)
**Context:** The frontend fix for the `/portal/certifications/` 404 (PR #54) is done. It ships the **templates** and routing logic, but the actual **pages** (content records at each URL, with Private Content gating) must be created in the HubSpot portal - theme files alone don't create URLs. This doc is the checklist to do that.

Do it in **sandbox first**, verify, then repeat in **production**.

| Environment | Portal name | Portal ID |
|---|---|---|
| Sandbox | `weld-australia-sandbox` | 443253065 |
| Production | `weld-australia` | 441838610 |

---

## 1. Prerequisites

1. **Theme deployed** so the templates exist in the portal:
   ```bash
   pnpm build && pnpm upload:sandbox      # then pnpm upload:prod for production
   ```
   After upload, these two templates are available (labels set by their `templateType` annotations):
   - **Member Portal - My Certifications** → `certifications-list.html`
   - **Member Portal - Certification Guidance** → `certification-guidance.html`

2. **"Active Members" membership list** exists (Contacts → Lists). Current definition: `individual_membership_status` IN (Active, Grace Period). This is the audience used to gate every `/portal/*` page.

3. **Private Content / Memberships enabled** (Settings → Website → Private content). Other portal pages (Dashboard, Profile, etc.) already use it, so this should already be on.

---

## 2. Pages to create

Create these four Website Pages (**Content → Website Pages → Create → Website page**). All four are gated to the **Active Members** list.

| # | Template to choose | Page name | URL path (exact) |
|---|---|---|---|
| 1 | Member Portal - My Certifications | My Certifications | `/portal/certifications` |
| 2 | Member Portal - Certification Guidance | AS 1796 Certification | `/portal/certifications/as1796` |
| 3 | Member Portal - Certification Guidance | IIW Inspector Certification | `/portal/certifications/iiw_inspector` |
| 4 | Member Portal - Certification Guidance | ISO 3834 Certification | `/portal/certifications/iso3834` |

> A new certification type later = one more page using the **Member Portal - Certification Guidance** template, with URL `/portal/certifications/<slug>`.

### Per-page steps

For each row above:

1. **Create → Website page →** select the template from the table → set the page name.
2. Top bar → **Settings → Page URL**: set the path exactly as shown. Domain = the portal's primary domain; the **path** must match exactly (see §3).
3. **Settings → Audience access** ("Control audience access") → **Private - registration required** → add the **Active Members** list → Save.
4. **Publish.**

---

## 3. Why the URL slugs must be exact

The guidance template derives the certification type from the **last path segment** of the URL:

```hubl
{% for seg in request.path | split('/') %}{% if seg %}{% set ns.cert_type = seg %}{% endif %}{% endfor %}
```

So `/portal/certifications/as1796` → `as1796`, which maps to the cert's stage list and the HubDB `certification_guidance` lookup. The three valid slugs are exactly:

- `as1796`
- `iiw_inspector`
- `iso3834`

A typo in the slug means the island can't resolve the cert. (The overview page at `/portal/certifications` has no type segment and renders the list.)

---

## 4. Two backend dependencies for guidance content

These don't affect the 404 fix itself, but the per-cert guidance page needs them to show content and highlight progress correctly:

1. **HubDB `certification_guidance` table seeded** - `pnpm seed:hubdb:demo` loads demo rows; real content replaces them. Rows are keyed by `(certification_type, step)`.
2. **`*_cert_step` contact properties use the canonical stage vocabulary.** The progress bar and the HubDB lookup both match `currentStep` against the ordered `CERT_META` stages in `src/modules/certification-guidance/CertificationGuidance.tsx`. The `*_cert_step` value (mirrored from the Certification pipeline stage) must be one of those exact stage strings. **Please confirm the Certification pipeline stage names against `CERT_META`** - this is CLAUDE.md §13 Q4.

Canonical stages per cert type (from `CERT_META`):

- **AS 1796:** Application Submitted → Eligibility Review → Practical Assessment Scheduled → Practical Assessment Complete → Certification Issued → Annual Renewal Due
- **IIW Inspector:** Application Submitted → Eligibility Review → Training Enrolled → Examination Booked → Examination Complete → Certification Issued → Annual Renewal Due
- **ISO 3834:** Application Submitted → Documentation Review → On-Site Audit Scheduled → Audit Complete → Certification Issued → Surveillance Audit Due

---

## 5. Verify (with a test contact)

Log in as a member contact with `as1796_cert_status` set and `as1796_cert_step` = a canonical AS 1796 stage:

- `/portal/certifications/` - list renders with an AS 1796 card; "View progress" links to `/portal/certifications/as1796/` (no 404).
- `/portal/certifications/as1796/` - guidance island renders, title reads "AS 1796 Welder Certification Progress…", the progress bar highlights the current step, and guidance text + evidence checklist load from HubDB.
- Dashboard **My Certifications** tile and any cert-expiry alert deep-link to `/portal/certifications/<type>/`.
- Logged-out / non-member hitting any of these URLs → redirected to `/login/`.
