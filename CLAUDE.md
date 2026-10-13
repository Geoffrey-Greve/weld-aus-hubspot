# Weld Australia - HubSpot CMS Build (CLAUDE.md)

> **This is the master technical brief for Claude Code.** It is the single source of truth for the Weld Australia HubSpot Content Hub website and member portal build, including the custom theme and React-driven custom modules.
>
> **Compiled:** 2026-05-16 by Ryan Jones (Refuel Creative) from Slack threads + the Weld Australia Drive folder. See **§ 14 - Source Documents** for everything this synthesises.

---

## 0. Read This First (Project North Star)

**What we're building.** A custom HubSpot CMS Hub theme + a library of custom modules (built as React components, mounted into HubL) that together replace Weld Australia's legacy WordPress site and their Microsoft Dynamics-based CAMS membership system, consolidated into one HubSpot-hosted website with a single member portal.

The standalone **WeldQ** certification portal and the standalone **ISO 3834** directory site continue to operate on their own domains and credentials for now - they're explicitly out of scope for this Phase 1 launchpad and migrate in later phases.

**Companion docs in this repo (read these too):**

- `docs/01-sitemap.md` - full information architecture and per-page content blocks
- `docs/02-module-catalog.md` - every HubL/React module with its editor-facing `fields.json`
- `docs/03-build-prompts.md` - sequential Claude Code prompts to actually build the thing

**Hard deadline.** **30 June 2026** - CAMS/Dynamics is contractually being decommissioned. **All page builds must be complete by 13 June 2026** (the remaining 17 days are QA/UAT/cutover).

**Tier constraint.** Weld Australia is on **HubSpot Professional** (Marketing/Sales/Service/Operations Pro + Content Hub). This means **no native Custom Objects** - the entire membership/certification/training data model has to be expressed using standard objects (Contacts, Companies, Deals, Products, Tickets) plus HubDB and Association Labels. This is the single biggest constraint shaping the build.

**Build philosophy.** Growth-Driven Design (GDD) "Launchpad". Ship the high-impact 20% of pages that drive 80% of the revenue and member self-service. Wishlist anything else. Performance and mobile-first UX over visual maximalism - except for two bespoke conversion pages (IIW International Welding Inspector and AS1796 Cert 10).

**Who's doing what.**

- **Backend (HubSpot CRM, properties, workflows, pipelines, Xero sync, SSO config, data migration):** Olivier "Ollie" Maennel (Refuel) - already in flight.
- **Frontend (theme, modules, React components, HubDB-driven UI, portal pages):** Ryan Jones + Claude Code. (Yevhen from Business Jetpack was originally allocated but doesn't know HubSpot - Melwyn Anthony will support once free of Gisham.)
- **Project management:** Nick Morris (Refuel).
- **Client:** Danielle Pennington (Corporate Engagement Manager) is the comms lead. Ben Mitchell is the approval contact.

**Key risk flags** - see **§ 13 - Open Questions & Risks**:

1. **SSO is deferred to Phase 2.** The masterplan called for HubSpot to act as IdP for Moodle / WeldQ / ISO 3834 - Ryan resolved on 2026-05-16 that we are **not building SSO in Phase 1**. Members log into the HubSpot CMS portal with HubSpot Membership credentials only. WeldQ, Moodle, and ISO 3834 retain their separate logins until a later phase.
2. The native HubSpot-Xero integration **does not** support pushing invoices to a generic "Weld Australia Student" Xero contact. Every invoiced individual must exist in Xero, or we need a custom middleware. Decision pending with Weld Aus finance.
3. The masterplan references "Member Wall" via Active Lists - verify that HubSpot Pro Private Content gating actually filters HubDB rows on listing pages (it does for full pages; row-level needs HubL-side filtering).
4. **Brand kit gap** - no Weld Australia brand guidelines in our Drive folder as of 2026-05-16. Confirm with Danielle / Ben whether guidelines exist or treat the legacy site as the visual source of truth.

---

## 1. Project Objectives & Success Criteria

| # | Objective | How it's measured |
|---|-----------|-------------------|
| 1 | Decommission CAMS/Dynamics by 30 June 2026 | All membership, training, certification, events data live in HubSpot; CAMS turned off |
| 2 | Single member login on the new HubSpot site/portal | One HubSpot Membership credential grants access to all `/portal/*` pages and the gated Resources Hub. Cross-app SSO with WeldQ / Moodle / ISO 3834 is deferred to Phase 2. |
| 3 | Member self-service replaces admin overhead | Members can: see status, download certs/receipts, manage profile, register for courses/events, manage corporate team - without emailing the office |
| 4 | Mobile-first portal | All HubDB tables collapse to cards on mobile; 44×44px min touch targets; portal usable on phone in venue |
| 5 | Zero-friction member discounting | Logged-in members see member pricing applied automatically across the site and at checkout |
| 6 | Public directory always accurate | "Find a Member" page reflects active membership status within minutes of a deal closing/lapsing |
| 7 | Resources Hub drives recurring memberships | Replaces the legacy per-PDF micro-transaction model with gated content + upgrade CTAs |

---

## 2. Architecture Overview

### 2.1 The "Pseudo-Object" Strategy

Because we can't use native Custom Objects, the data model is:

```
COMPANY (parent records - the "live source of truth" for corporate access)
  ├── associated CONTACTS via Association Labels:
  │     • Primary Admin
  │     • Employee
  │     • Apprentice
  │     • Reciprocal Member
  ├── child COMPANIES (state-based offices) via parent/child association
  └── associated DEALS (membership transactions, ISO 3834 cert renewals)
CONTACT (individual records - the "live source of truth" for individual access)
  ├── associated DEALS (training, exams, individual certs, individual memberships)
  ├── property groups for status: as1796_status, iiw_status, etc.
  └── synced fields from won Deals: next course, cert step, expiry, tier
DEAL (transactional container)
  ├── pipelines: Membership, Training & Exams, Certification, BD/Engineering
  └── on Closed Won → workflow pushes data to Contact + Company
PRODUCT LIBRARY
  └── Course Modules as products → attached as line items on Training Deals
HUBDB (display layer, no PII)
  ├── Table 1: Course Timetable & Locations
  ├── Table 2: Find a Member directory
  └── Table 3: Team & Board
```

### 2.2 Frontend stack: React-in-HubL

HubSpot Pro doesn't ship a "React module" type the way Enterprise's JS Building Blocks does, so the pattern is:

1. **HubL module** declares fields (Drag&Drop in CMS) and renders a `<div>` mount point with a `data-props` JSON blob serialised from HubL → including HubDB rows, contact properties, and module field values.
2. **Vite** (or esbuild) compiles each React island to a single bundle, fingerprinted, dropped into the theme's `assets/js/` folder.
3. The HubL module emits a `<script type="module" src="{{ get_asset_url('../assets/js/<bundle>.js') }}"></script>`.
4. The React component reads its props off the mount node, renders the interactive UI (filters, switchers, dashboards, checkouts), and uses `fetch()` against HubSpot APIs (HubDB v2 read, Forms submit, Private Content API) for runtime data.

Where pure HubL is sufficient (static content blocks, hero, testimonials), use HubL modules - don't reach for React. **React is for the interactive surfaces:** the Course filter, the Find a Member directory, the Member Dashboard, the Profile Switcher, the Corporate Admin "Manage My Team" view, and the Checkout tunnel.

**Step 1 and step 4 are the same list of keys, written twice.** The `row_data` dict in
`module.html` and the row interface in the `.tsx` are hand-maintained mirrors: no build step
spans them and no type checks one against the other, so a key renamed or dropped on the HubL
side is `undefined` at runtime while TypeScript still promises it is there. What that costs
depends on the field - `photo_alt` is a missing caption, `price_member` is a member quoted
the public rate, which is Ref 72 and Ref 109 and § 7.9's four numbers for one course all
over again.

`tests/unit/data-props-parity.test.ts` parses the shipped `row_data` out of every island's
module and checks it against the interface both ways: a REQUIRED field HubL does not emit
fails, and a key HubL emits that the island does not declare fails unless it is listed as
`serverOnly` with a reason (`events-listing` has one, read by its own server-rendered
markup). A new island must be added to `ISLANDS` or the discovery test fails - a sweep that
silently skips what it was not told about reports "nothing found" when it means "we did not
look".

### 2.3 Deployment topology

```
Refuel dev sandbox (HubSpot CMS sandbox)
  ↓ HubSpot CLI (hs project upload / hs upload)
Weld Australia HubSpot portal (Production)
  ↓ Domain: weldaustralia.com.au (DNS cutover at go-live)
```

Source of truth lives in a Git repo. CI runs the React build then `hs upload` of the dist + theme files. Local dev uses `hs watch` for HubL files + `vite dev` for React HMR via a small dev-mode prop loader.

---

## 3. File / Folder Structure

```
weld-australia-theme/
├── CLAUDE.md                           ← this file
├── README.md                           ← short build/run instructions for humans
├── package.json
├── vite.config.ts
├── tsconfig.json
├── hsproject.json                      ← HubSpot CLI project descriptor
├── theme.json                          ← HubSpot theme manifest
├── src/                                ← React source (compiled to assets/js)
│   ├── shared/
│   │   ├── api/
│   │   │   ├── hubdb.ts               ← HubDB v2 read client
│   │   │   ├── forms.ts               ← Forms API submit
│   │   │   └── memberContext.ts       ← reads logged-in member state from window.__WELD_MEMBER__
│   │   ├── components/                 ← shared UI primitives (Card, Button, Modal, Filter)
│   │   ├── design-tokens.ts
│   │   └── utils/
│   ├── modules/                        ← one React entry per interactive module
│   │   ├── course-filter/
│   │   ├── find-a-member/
│   │   ├── resource-library/
│   │   ├── member-dashboard/
│   │   ├── profile-switcher/
│   │   ├── corporate-admin/
│   │   ├── checkout-tunnel/
│   │   └── certification-guidance/
│   └── styles/                         ← CSS/SCSS for both HubL and React
├── theme/                              ← HubSpot-shipped artefacts
│   ├── templates/
│   │   ├── layouts/                    ← base.html, portal.html (gated), checkout.html
│   │   ├── pages/                      ← home.html, about.html, course.html, etc.
│   │   └── partials/                   ← header.html, footer.html, nav.html
│   ├── modules/                        ← *.module folders (one per HubL custom module)
│   │   ├── hero.module/
│   │   ├── course-filter.module/       ← HubL wrapper that mounts the React island
│   │   ├── find-a-member.module/
│   │   ├── resource-library.module/
│   │   ├── member-dashboard.module/
│   │   └── ...
│   ├── sections/                       ← reusable section templates
│   ├── assets/
│   │   ├── js/                         ← built React bundles (Vite output)
│   │   ├── css/                        ← compiled theme CSS
│   │   ├── img/
│   │   └── fonts/
│   └── global-content/                 ← header, footer, microcopy partials
├── hubdb/                              ← HubDB table seed JSON (committed for reproducibility)
│   ├── courses.json
│   ├── members.json
│   └── team.json
├── workflows/                          ← documentation of expected workflows (Ollie owns build)
├── scripts/
│   ├── build.ts                        ← orchestrates Vite build + asset copy
│   ├── upload.ts                       ← wraps hs upload with env switching
│   └── seed-hubdb.ts
└── docs/                               ← additional reference (split out as build progresses)
```

> **Convention:** each `*.module` folder under `theme/modules/` has the standard HubSpot trio (`fields.json`, `meta.json`, `module.html`) plus a `module.css` and an optional `module.js`. For React-driven modules, `module.html` contains the mount node + the `<script>` tag pointing at the Vite-built bundle in `theme/assets/js/`.

---

## 4. Pages to Build (Scope)

Pulled from the Developer Brief and confirmed against the GA-driven priority analysis in the Scoping Meeting notes.

### 4.1 Public website - Batch 1 (build deadline 1 May 2026, content deadline 10 April)

| Page | Template | Notes |
|---|---|---|
| Home | `home.html` | High-traffic entry point. Conversion paths: Membership / Training / Resources / Find a Member |
| About (Introduction + Team merged) | `about.html` | Team grid driven by HubDB Table 3 |
| Contact Us | `contact.html` | Standard HubSpot form; route to `office@weldaustralia.com.au` |
| Resources Hub | `resources.html` | **Highest-traffic page in last 90 days (88,255 views).** Advanced filtering. Member Wall gating with "Preview" + "Upgrade to Download" overlay |
| Membership | `membership.html` | Tier comparison + join CTAs |
| Training Hub | `training-hub.html` | Landing for all educational offerings |
| Certification | `certification.html` | Info on professional welding certs, links into individual course pages |
| Advocacy | `advocacy.html` | Industry representation content |
| Engineering Services | `engineering.html` | Service-based info page |

### 4.2 Public website - Batch 2 (build deadline 22 May 2026, content deadline 1 May)

| Page | Template | Notes |
|---|---|---|
| Technology | `technology.html` | Simulators, cobots, Xiris cameras |
| Events | `events.html` | Listing of upcoming events; integrates event.hapily |
| Blog (News & Publications) | `blog.html` + `blog-post.html` | Standard HubSpot blog templates, themed |
| Job Board | `jobs.html` | Dynamic listing - assess if HubDB-driven (preferred) or HubSpot blog |
| Find a Member | `find-a-member.html` | **HubDB Table 2 driven, Gold-priority sort, React filter island** |
| Course Timetable Hub | `course-timetable-hub.html` | Master list of all upcoming sessions across all courses (HubDB Table 1) |
| Consolidated Course Page (Standard) | `course.html` | **One template, dynamic page driven by HubDB Table 1.** URL pattern `/courses/{slug}`. Location filter is a React island |
| Consolidated Course Page (High-Polish Sales) | `course-sales.html` | Bespoke layout for IIW International Welding Inspector + AS1796 Cert 10. Long-form, sticky sub-nav, trust signals, Member vs Non-Member pricing table |

### 4.3 Member Portal - Batch 3 (build deadline 13 June 2026)

All of these live behind HubSpot Private Content (Member Wall). Layout: `portal.html`.

| Page | Template | Notes |
|---|---|---|
| Log in / Sign in | `login.html` | Custom HubSpot Membership login. Phase 1 messaging: this account is for the Weld Australia member portal only. WeldQ / Moodle / ISO 3834 logins remain separate (unified in Phase 2). |
| Password Reset | `reset.html` | Frictionless flow. Resolves a known historical user pain point - verify wording with Danielle |
| Member Dashboard | `dashboard.html` | **The "Command Centre" - the most important React page in the build.** See § 6 |
| User Profile | `profile.html` | Edit name, contact details, comms preferences (granular subscriptions: Advocacy, Training, Membership) |
| Course Order / Checkout | `checkout.html` | Multi-step "tunnel" UI; integrates with event.hapily + Zoom |

### 4.4 Wishlist (intentionally **not** in Phase 1)

Per § 16 of the masterplan - **do not start these without explicit approval**:

- ISO 3834 Directory migration into the main site (Phase 3)
- AWCR (Australian Welder Certification Register) migration (Phase 4)
- ASIP Inspection Group (excluded entirely - separate identity)
- Engineering Field Management (Harvest/Zuper) (Phase 2)
- Interactive digital publications (post-launch)

---

## 5. The Custom Theme

### 5.1 Brand & design system

> **Asset gap to confirm.** A full Weld Australia brand kit (logo files, colour tokens, typography) is **not yet in our Drive folder** as of 2026-05-16. Before theme styling begins: confirm with Danielle / Ben that brand guidelines exist or we treat the legacy weldaustralia.com.au site as the visual source of truth and lift tokens via inspection.

### 5.2 Theme manifest expectations

`theme.json` should declare:

- Theme name: "Weld Australia Launchpad"
- Screenshot, label, preview path
- Global colours (primary, secondary, accent, surface, text, success, warning, danger)
- Fonts (heading family, body family, mono family)
- Spacing scale (4-based: 4, 8, 12, 16, 24, 32, 48, 64, 96)
- Container widths (mobile / tablet / desktop / wide)

### 5.3 Global tokens (CSS custom properties)

Expose every theme token as a `--wa-*` CSS variable on `:root` so React components and HubL templates share one design system:

```css
:root {
  --wa-color-primary: ...;
  --wa-color-on-primary: ...;
  --wa-color-surface: ...;
  --wa-color-text: ...;
  --wa-color-text-muted: ...;
  --wa-color-tier-gold: #C9A227;
  --wa-color-tier-silver: #A0A0A0;
  --wa-color-tier-bronze: #B27330;
  --wa-color-success: #1f8a4d;     /* member discount green per UX brief */
  --wa-radius-sm: 4px;
  --wa-radius-md: 8px;
  --wa-radius-lg: 16px;
  --wa-touch-min: 44px;            /* mandatory min touch target */
  --wa-shadow-card: ...;
  --wa-font-heading: ...;
  --wa-font-body: ...;
}
```

### 5.4 Global UX rules (mandatory, from UX brief)

1. **Mobile-first cards.** No horizontal data tables on mobile. Every HubDB-driven listing has a card layout below 768px. The Course Timetable, Find a Member, and Member Dashboard tile lists are the most affected.
2. **44×44px minimum touch targets** - applies to every clickable element including filter chips and table sort headers.
3. **"Locked" overlays must not feel like dead ends.** Resources behind the Member Wall show preview content + a high-visibility "Upgrade to Download" CTA, not a 403.
4. **Member discount must be highlighted in green/bold** at checkout to validate the value of membership during the transaction.
5. **State-specific content gets a manual "National Toggle"** so users can opt out of geo-localisation.
6. **Notification toasts/alert banners** for time-sensitive prompts (e.g. "Certification expiring in 30 days").
7. **An address or a phone number on the page is a link.** The Contact Us phone
   directory printed the department email addresses as plain text (QA ref 63):
   `phone` had always been a `tel:` link and there was no email field at all, so
   Weld typed the addresses into the "Extension / note" field, the one part of an
   entry rendered verbatim. `contact-methods-grid` now carries an `email` field per
   entry AND links an address already sitting in a note (`linkify_emails`), because
   the live page's addresses are in the note, not in the new field. Punctuation
   around a token is stripped from both the href and the link text - reconstructing
   what was stripped is not worth a second pass in a one-line note field.
   **That fix still failed on production** (23 Sep): it linked the note ALONE,
   by splitting on spaces, so an address in the department label, the callout,
   a card, or the FAQ lower on the same page (whose defaults say "emailing
   membership@weldaustralia.com.au") printed verbatim, and a non-breaking space
   or "Email:" defeated the split. `partials/_linkify-emails.html` now matches
   addresses by pattern (`text` for plain fields, `html` for rich text, which
   steps round anchors the editor already wrote and links the text either side
   of them - skipping any block holding a link left a card that also linked a
   form with its address unlinked), and every text field in
   `contact-methods-grid` and `faq-accordion` goes through it. RE2-safe: no
   lookarounds, no backslashes. `tests/unit/contact-directory-emails.test.ts`
   runs the shipped pattern, and fails if a module is added to the contact page
   without deciding about addresses.
8. **A rich text table's header row is always the theme's pair.** Editors colour
   header rows inline, and a dark blue row with black text reached a course page
   (Lara, 23 Sep). `.wa-richtext thead th` and a first-row `th` take
   `--wa-table-head-bg` / `--wa-table-head-text` with `!important` (the only way
   past an inline style), and their contents inherit the cell's colour.
   `tests/unit/richtext-table-header.test.ts`.

---

### 5.5 One `<title>`, one meta description, one canonical - and `_head.html` owns them

`base.html` renders three things into `<head>`, in this order:

1. `partials/_head.html` - the `<title>`, the meta description, og/twitter
2. `{{ standard_header_includes }}` - HubSpot's own canonical, and its own meta
3. `{% block extra_head %}` - whatever the page template adds

Around fifty page templates emitted their own `<title>` and description from
slot 3, so every public page shipped two or three of each. **Crawlers take the
first**, which is `_head.html`'s - and with no `page_title` set, `_head.html`
falls through to `content.html_title`, the HubSpot page or HubDB row name. That
is the whole of QA ref 26: `/courses/iwi-s` was titled "IIW Welding Inspector -
Standard (IWI-S) - Online (2026-08-12 to 2026-10-23)" because the row name won,
and the `/certification?pathway=` pages showed the generic certification title
because a query-param page has no other title to offer and its own was third in
the document. Eleven templates emitted a second `rel=canonical` beside HubSpot's,
which is ref 21, reported on exactly those pages.

**The contract.** A page sets its SEO variables ABOVE its `{% extends %}` and
emits no head tags of its own:

```hubl
{% set page_title_exact = 'Full <title> text, verbatim' %}
{% set page_description = '…' %}
{% extends "../layouts/base.html" %}
```

- `page_title` is rendered as `… - Weld Australia`; `page_title_exact` is
  rendered verbatim. The existing titles already carry their own brand suffix in
  three different shapes, so hoisting them all into `page_title` would have
  appended a second one to every page.
- **Above the extends, always.** `_head.html` is included by the LAYOUT, so a
  page's top-level assignment after its own extends tag runs after the layout
  has rendered the head. Four templates resolved their HubDB row down there and
  seven system templates (the error pages, the subscription pages, search
  results) set `page_title` down there and had never had any effect at all.
- **No canonical in a template.** `standard_header_includes` emits one per page.
- og:title / og:description / twitter:* are derived from the same two variables,
  so a shared course page stops carrying the session name too.

`tests/unit/head-tags.test.ts` fails the build if a template emits a title,
description, canonical or og/twitter title again, or sets its title below the
extends.

### 5.6 An enquiry CTA carries `#enquiry`, and usually a `?topic=`

`/contact-us` is a long page: hero, contact cards, phone directory, offices map,
then the form. A CTA that asks the visitor to START AN ENQUIRY and links at the bare
path lands them at the top of all that, which is QA ref 15 ("Enquire about / start
an enquiry buttons link to the map on the contact page rather than directly to the
form"). Four certification CTAs had been missed when the anchored pattern was
introduced, and the same slip was on training, membership, engineering and the job
board.

- **`#enquiry` is what scrolls**, and it works with JavaScript off. `?topic=<alias>`
  preselects the enquiry category, resolved by `CATEGORY_ALIASES` in
  `contact-form.module/module.js`. Three pre-existing `?topic=` links carried no
  anchor at all and scrolled only because the JS noticed the preselection.
- **A plain "Contact us" is left alone.** The directory and the map are a legitimate
  destination for a general contact CTA, and on a page with no single subject a wrong
  preselection is worse than none. The error pages keep the bare path.
- `tests/unit/contact-cta-anchors.test.ts` sweeps every `/contact-us` href in the
  templates, checks each `?topic=` alias against the ones the shipped JS actually
  resolves (an unknown alias silently preselects nothing and looks identical to a
  correct link), and keeps the bare-path exceptions explicit.

---

---

## 6. Custom Modules (React Islands)

Each section below is a complete spec for one React-driven HubL module. **Build them in this order** - earlier modules unblock later ones.

### 6.1 `course-filter` - Consolidated Course Page filter

**Where it lives:** `course.html` (the standard course template) and `course-sales.html` (the bespoke IIW/AS1796 layouts).

**HubL responsibility:**

- Server-renders the parent course content (title, description, syllabus).
- Server-renders all matching HubDB Table 1 rows for `course_id = {{ dynamic_page_hubdb_row.course_id }}` as a JSON blob in `data-rows`.
- Mounts `<div id="wa-course-filter" data-rows="…" data-member-tier="{{ contact.contact_membership_tier|default('') }}"></div>`.

**React responsibility:**

- Renders the `City` dropdown from the cities present in the rows HubL passed in (`deriveCityOptions` in `src/shared/utils/cityOptions.ts`, shared with `course-timetable-filter`) - a city with no session on this course is never offered. `CITY_ORDER` is display order only; any city HubDB carries beyond it still shows, appended last.
- On selection, filters rows in-memory and shows: start date, member price, non-member price (struck-through if member tier present), Register CTA → `registration_url`.
- If the city has zero rows → show the EOI form (HubSpot form embed via Forms API, configurable form GUID via module field).
- Member discount highlighted in `--wa-color-success` per § 5.4 rule 4.

**Acceptance criteria:**

- [ ] Page loads with default first-available city pre-selected.
- [ ] Switching city updates dates/prices/CTA without a page reload.
- [ ] A course with no sessions, or a delivery-mode filter that empties the selected city, renders the EOI form rather than an empty table (the city selector itself no longer offers empty cities).
- [ ] On mobile, sessions render as cards stacked vertically.
- [ ] Logged-in members see member pricing applied automatically.

### 6.2 `find-a-member` - Public directory

**Where it lives:** `find-a-member.html`.

**HubL responsibility:**

- Server-renders all `is_active = true` rows from HubDB Table 2 as `data-rows`.
- Pre-sorts by tier server-side (Gold → Silver → Bronze → Reciprocal → Industry Supplier).

**React responsibility:**

- Filter chips for State (multi-select), Member Tier, free-text search by company name.
- Cards display: logo, company name, tier badge (visual hierarchy: Gold = gold border accent + soft tint; Silver = silver border; Bronze = bronze border), short blurb, website CTA, contact email.
- Maintains Gold-priority within filtered results.
- "Sort by" toggle: Tier (default) | A→Z | State.

**Acceptance criteria:**

- [ ] Gold members appear at the top of every filtered view.
- [ ] Filtering is client-side, instantaneous.
- [ ] When a member's `is_active` toggles to false in HubDB, they disappear from the page on next load (HubDB cache TTL respected).
- [ ] Mobile view: single-column stacked cards.

### 6.3 `resource-library` - Resources Hub

**Where it lives:** `resources.html`.

**HubL responsibility:**

- Reads logged-in member's `contact_membership_tier` and certification statuses.
- Renders all resource rows with metadata + a `locked` boolean computed in HubL based on the member's entitlements.
- Mounts the React app with the full row set.

**React responsibility:**

- Faceted search: keyword, category, tier required, file type (PDF, video, link).
- Each card shows preview image + title + abstract + (Download CTA | "Member Only - Upgrade to Download" overlay).
- Logging: every download click POSTs an event to a HubSpot custom behavioural event so it lands on the contact record.

**Acceptance criteria:**

- [ ] Non-members see locked overlays with upgrade CTA - never a 403.
- [ ] Active members can download instantly without a second prompt.
- [ ] Lapsed members revert to locked state within the same session (gating evaluated server-side per request).
- [ ] Resource categories are configurable in HubDB; adding a new category does not require a code change.

### 6.4 `member-dashboard` - The "Command Centre"

**Where it lives:** `dashboard.html` (the portal landing page).

This is the most complex module. Build it as a small React app composed of independently rendered tiles:

| Tile | Data source | Notes |
|---|---|---|
| `WelcomeBanner` | `contact.firstname`, `contact.contact_membership_tier`, `contact.contact_membership_expiry` | Tier badge, expiry countdown |
| `SmartAlerts` | Computed from contact properties (cert expiring in 30 days, lapsed renewal, missing exam booking) | Toast or banner pattern per UX brief |
| `MembershipStatus` | Contact properties | Status, tier, expiry, "Renew" CTA if within 60 days |
| `Certifications` | Property groups (`as1796_status`, `iiw_status`, etc.) | Per-cert status + "Download Certificate" + `current_certification_step` guidance text |
| `UpcomingCourses` | Contact's `next_upcoming_course_*` properties | Course name, date, location, "View Details" link |
| `RegisteredEvents` | Contact's associated event Deals (Deal Type = Event Ticket) | List with date, location, calendar add |
| `InvoicesAndReceipts` | Contact's associated Deals with `xero_invoice_pdf_url` | "Download PDF Receipt" button per Deal |
| `GeoLocalisedEvents` | HubDB events filtered by contact's state, with National Toggle | Smart Block pattern from masterplan §14 |
| `CorporateAdminPanel` | Only renders if contact has Primary Admin association label | See § 6.6 |
| `ProfileSwitcher` | Only renders if contact has multiple active associations | See § 6.5 |

**Acceptance criteria:**

- [ ] Dashboard fully renders within 2s on 4G mobile.
- [ ] Tiles are reorderable in a future iteration (architect the component for this).
- [ ] Every tile has an empty/loading/error state.
- [ ] No tile blocks the others - failures degrade gracefully.

### 6.5 `profile-switcher`

**Where it lives:** Embedded inside `member-dashboard` and as a header utility on `portal.html` layout.

**Problem:** A user can hold a free Apprentice individual membership AND be linked as an Employee under a paid Corporate account. They must access combined benefits through one login without duplicate contact records.

**Logic:**

- Read `request_contact.list_memberships` and `request_contact.associations` server-side via HubL.
- Surface every active "context" the contact has (e.g. "Personal - Apprentice", "ABC Welding Pty Ltd - Employee").
- Default context = highest-tier corporate, fallback to individual.
- Switching writes a `wa_active_context` cookie (HttpOnly, scoped to portal pages) that subsequent dashboard renders read.
- The combined benefits pattern: regardless of selected context, the gating evaluator unions all entitlements (Apprentice content + Corporate Gold content both visible on the Resources Hub).

**Acceptance criteria:**

- [ ] User with one association sees no switcher.
- [ ] User with two+ associations sees a header dropdown.
- [ ] Switching context updates relevant tiles (membership status, registered events) without a full reload.
- [ ] Resources Hub shows the union of entitlements regardless of selected context.

### 6.6 `corporate-admin` - Manage My Team

**Where it lives:** Conditionally rendered tile inside `member-dashboard`; full-page version at `/portal/team`.

**Visible only to:** Contacts with `Primary Admin` association label on a Company.

**Functions:**

- List all employees (associated contacts) of the admin's company AND of all child companies.
- Add an employee: form that creates a Contact and applies the `Employee` association label to the company.
- Remove an employee: archive the association label (do not delete the contact - they may rejoin).
- Bulk register: select N employees + a course session → POST creates one Deal per employee in the Training pipeline + decrements `vouchers_used`.
- Voucher tracker: visual progress bar showing `vouchers_used / vouchers_total`, derived from Company calculated property.

**Acceptance criteria:**

- [ ] Admin sees only their own company hierarchy.
- [ ] Bulk register handles partial failures (some employees registered, some failed) and surfaces them clearly.
- [ ] Voucher counter updates within 30s of a bulk registration.
- [ ] Touch-friendly checkbox list on mobile.

### 6.7 `checkout-tunnel`

**Where it lives:** `checkout.html`.

A distraction-free multi-step checkout for course/event registration. Steps:

1. **Confirm session** (auto-populated from `?session_id=` query param, validated against HubDB Table 1).
2. **Identify** (logged-in: skip; logged-out: email lookup → existing contact resolves to login or guest checkout fork).
3. **Discount preview** - read `contact.contact_membership_tier`, apply member rate, show savings in `--wa-color-success` bold.
4. **Payment** - handoff to event.hapily / Stripe / whichever payment processor is wired (defer to Ollie's backend setup).
5. **Confirmation** - show receipt + Zoom join link if applicable + "Add to calendar" + "Back to dashboard" CTAs.

**Acceptance criteria:**

- [ ] Member discount visible from step 3 onwards.
- [ ] Logged-out flow does not require account creation but offers it post-purchase.
- [ ] Confirmation page includes all data the user needs immediately (no email-only).

**HubDB prices are EX GST, and the checkout adds the tax on top.** `price_member` /
`price_non_member` and the whole `price_*_aud_ex_gst` family are tax-exclusive - the column
names say so and every course card labels them "ex GST". Step 3 and step 4 therefore show
**Registration fee (ex GST) → GST → Total (inc. GST)**, where GST is 10% ON TOP.

- Until 2026-09-18 the tunnel called the same number GST-inclusive and printed
  "GST (included)" as price ÷ 11, so a $585 ex-GST course was quoted at $585 total with
  $53.18 of GST inside it. The buyer owes $585 + $58.50 = $643.50. `gstOnExclusiveDollars` /
  `totalIncGstDollars` in `src/shared/utils/formatCurrency.ts` are what a HubDB price goes
  through now; `gstComponentDollars` still splits tax back out of an amount that really is
  inclusive (a recorded invoice total) and is not the checkout's to use.
- **The Worker is quoted the EX-GST figure.** `expectedUnitCents` / `expectedTotalCents` on
  the reserve body stay at `basePrice`, because the Worker resolves its price from the same
  HubDB row. Sending the inc-GST total would read as price drift on every booking. GST is
  HubSpot's to add on the invoice - the Event Engine holds no tax rate of its own, so a
  portal on 15% GST or 20% VAT invoices correctly (events-engine CLAUDE.md, "Stored prices
  are TAX-EXCLUSIVE").
- **My Invoices mixes two sources recorded the opposite way round**, so it is not the same
  fix. Resolved with Ollie on 2026-09-18: **Deal `amount` is EX GST**, like the HubDB course
  columns, while a HubSpot Invoice row's `hs_amount_billed` is the invoice TOTAL, HubSpot
  having applied the portal's tax rate on top of the ex-tax line items. Reading both as
  inclusive showed a $585 Deal as $585 charged with $53.18 of GST in it, when the member paid
  $643.50. `my-invoices.module` now stamps `tax_basis` (`exclusive` on Deal rows, `inclusive`
  on Invoice rows) and `MyInvoices.tsx` grosses the exclusive ones up, so every card and the
  summary state what was actually charged. An unflagged row still reads as inclusive - the
  pre-`tax_basis` behaviour - so a stale render cannot jump 10%.

**GST is added once, by HubSpot, to the number this page displayed.** The two halves of
that sentence used to be sourced separately. This page quotes the buyer from the HubDB
row and adds 10% for display; the Worker invoices HubSpot, which adds the portal's own
rate. For a MEMBER both sides read the same HubDB row (events-engine migration 0035). For
a GUEST the Worker read `ticket_types.price_cents` out of its own D1 instead, a separately
maintained copy of the same course price - and the guest's quote travelled as
`quotedUnitCents`, which the Worker logs and does not enforce. So the two numbers were
free to disagree about whether they included tax, and when they did the buyer read
"$5,113.64 + $511.36 = $5,625.00" here and was invoiced $6,187.50. Neither side charged
GST twice; each charged it once, on a different base, and nothing compared them.

- The Worker prices a guest from the HubDB `nonMember` column now
  (`resolveHubDbStandardPrice`), falling back to `price_cents` only when the row cannot be
  read. One row, both buyers.
- A guest's price is sent as **`expectedUnitCents`**, not `quotedUnitCents`. The guard is
  directional - it refuses only an invoice that would land ABOVE the displayed price - so
  the worst it can now do is stop a booking it would otherwise have overcharged.
- **The Worker is still quoted the EX-GST figure**, as below. Sending the inc-GST total
  would refuse every booking, and a guard nobody can leave switched on is how this got
  through the first time.
- **The struck-through standard rate renders only when there is a saving.** Many Weld
  sessions carry one rate for everyone (`price_member` = `price_non_member`), and this
  line gated on `isMember` alone, so those sessions crossed out a figure identical to the
  one beside it - a discount of zero, and two prices to choose between on the screen where
  the buyer commits.

**A paid booking ENDS on the tunnel, and the invoice opens in a new tab.** The last step
used to be `window.location.href = order.paymentUrl`, which threw the buyer off the site
onto a HubSpot-hosted invoice with no way back and no record on screen of what they had
just booked - having committed to paying seconds earlier.

- **Auto-opening a tab instead does not fix it.** That handoff runs inside `pollOrder`'s
  async callback rather than a click handler, so `window.open` there is eaten by every
  popup blocker and the buyer is left on a tunnel with no invoice at all: worse than being
  stranded on one.
- So the tunnel renders a terminal **"Your place is held"** panel - the session, the total
  inc GST, and a **Pay invoice now** anchor carrying `target="_blank" rel="noopener"`. A
  click is a user gesture, so the new tab is never blocked, and the panel stays put so they
  can pay again later from the same link.
- **It does not claim the invoice was emailed**, because nothing emails it. The Worker opens
  the invoice and stores `hs_invoice_link`; opening publishes the link and does not send it,
  and no HubSpot workflow does either yet (events-engine CLAUDE.md, "HubSpot sends the
  registration confirmation; the worker only decides WHEN" - there is no equivalent for the
  invoice). Add the line when the workflow exists, not before.
- The receipt is still written to `sessionStorage` for the confirmation page, so a buyer who
  navigates there later still sees the booking.

**The checkout's member company resolution is a SECOND implementation, kept on purpose.**
The five course-pricing surfaces share `_member-company-resolve.html`; the checkout has its
own, because it is a superset - it also resolves the company's name, membership expiry and
membership number, and has four company-record lookup forms to the partial's one. Including
the partial here would add a fifth company read to the checkout; widening the partial to
match would put the checkout's full weight on `/courses`. What must not drift is the LADDER
(contact mirror → `associatedcompanyid` → association sweep, types 279 then 1, ids kept as
strings, both the corporate AND industry supplier property families), and
`tests/unit/member-company-resolution-parity.test.ts` fails the build if it does. A narrower
resolution on either side is what priced corporate employees as non-members (Ref 72) and
what made the Worker refuse the price this page had quoted (Ref 109).

**The Idempotency-Key is scoped to the SUBMISSION, not to the event.** The worker replays
a stored response verbatim for a repeated key, so an event-wide scope meant a buyer who
timed out on "your place is held", went back, typed a different email and submitted again
was handed the FIRST booking's invoice with their new details discarded - Ref 40 item 5,
"guest checkout with an existing email attaches to an existing invoice". `reservationScope`
fingerprints who is buying and what (buyer email, ticket type, module selection), and
deliberately not the buyer's name, their answers or the Turnstile token: correcting a typo
and resubmitting is the same booking, and a fresh key there would take a second seat.

**"Preparing your invoice" says how long it has been waiting.** HubSpot creates the invoice
asynchronously and `pollOrder` runs to two minutes; until Ref 40 item 6 the buyer watched
one unchanging line for all of it, having just committed to paying. `pollOrder`'s
`onAttempt` drives a counting message. The reason it used to run to the full two minutes and
resolve nothing was the worker's own (the invoice could not be opened, so no payment link
was ever written back); this is the part that is the CMS's.

**Custom registration questions.** Step 4 renders whatever the Event Engine's
`GET /api/v1/events/{id}/questions` returns, through
`src/shared/components/RegistrationQuestions.tsx`. Dietary requirements is a seeded row in
the worker, not a field hard-coded here, so the next thing Weld asks for (a coffee order, a
shirt size, a PO number) is a row in their admin rather than a code change.

- **`required` is enforced in the WORKER, not here.** The client check exists to save the
  buyer a round trip; it is not the gate. This is a module a marketer can edit, and the staff
  and corporate booking paths never render it at all.
- **A failed definitions read is never said out loud, and never blocks the button.** The
  worker answering `null` (could not read) is kept distinct from `[]` (this event asks
  nothing), but only so the submit can try once more on its way past: the buyer is told
  nothing and the booking goes through either way. Most events ask nothing at all, so a
  notice about "extra questions" names something the public has no way to recognise and
  cannot act on, and the version that blocked on it let the form look fine and then refused
  the registration with a red error over a fault the buyer could neither see nor fix. The
  worker is the gate, and its refusal names the question, so the ONE thing said here is
  `missing_required_answer` coming back, at which point the definitions are pulled in again
  and the named field is rendered to answer. `loadQuestions` returns the definitions rather
  than a flag because the submit's own closure still holds the stale empty set.
- Answers are **split by scope** before they are sent: `answers` carries the order-scoped ones
  (a PO number, asked once per booking) and `attendeeAnswers` the per-seat ones (dietary).
  The worker validates each against a different question set and rejects a key sent in the
  wrong one by name, so they cannot be one bag.
- A multiselect stores its values joined with `;` — HubSpot's own encoding, so the worker's
  write-back is a copy. Rendered as checkboxes, not a native multi-select listbox, which is
  close to unusable at phone width.
- **Prefill is not wired yet.** The worker hands an unauthenticated caller definitions only
  (answering `?email=` with someone's dietary requirements would be a data leak), so prefill
  has to come from HubL reading the logged-in visitor's own contact via the `hsProperty` each
  definition names. Capture works without it.

### 6.8 `certification-guidance`

**Where it lives:** Inside the Certifications tile of `member-dashboard`, and as a standalone `/portal/certifications/{type}` page.

**Logic:**

- Reads the contact's `current_certification_step` property (mirrors the live Deal stage in the Certification pipeline).
- Looks up the matching guidance text from a HubDB Table (small, ~10-20 rows) keyed by certification type + step.
- Renders the next-action prompt and the evidence checklist.

**Acceptance criteria:**

- [ ] Guidance text is editable by Weld Aus Q&C team via HubDB without code changes.
- [ ] Multiple concurrent certifications render side-by-side.

---

### 6.9 `event-registration` - the events widget, and why it is a second implementation

`theme/modules/event-registration.module` is the booking form on an event detail page.
It posts to the SAME `/reserve` endpoint as the checkout tunnel, in plain browser JS
with no build step, so it is a second independent implementation of one booking
contract - and the recurring failure is a fix reaching one of them. Two have already
happened: the Idempotency-Key scope (Ref 40 item 5, fixed in `reservationScope` and
never ported) and the attendee expansion below.

**The buyer takes seat one; every further seat is a named person.** The attendee rows
shipped as `type="hidden"` inputs inside a `hidden aria-hidden` fieldset, so nobody
could fill one and `buildBody` fell every row back to the buyer's own name and email.
Choosing two tickets therefore posted one booking listing the same address twice, which
the Worker refuses - so a first-time buyer with a brand-new address, on the module's
DEFAULT settings, was told "this attendee email is already registered for this event".
True of nothing, and nothing they could act on.

- `seatTicketIds()` is the one flattening of the chosen quantities, shared by the form
  rendering and the request builder. Two copies is how the rows on screen stopped
  matching the seats in the body.
- One seat still posts the `ticketTypeId` shorthand, not a one-entry `attendees` array:
  that is the shape the Worker carries `attendeeAnswers` through (events-engine
  CLAUDE.md, "`attendeeAnswers` is how the SINGLE-SEAT shorthand answers a per-seat
  question"), and a lone attendee row is only a way to disagree with yourself.
- **Group booking OFF caps the form at one seat**, in the qty input's `max` and again in
  `validate()`, because several ticket types each capped at one still add up. There is
  nowhere to name a second person on that form, and public unnamed seats do not exist:
  the Worker refuses them with `unnamed_seats_not_public` (they are staff-only, Ref 74b).
- `validate()` refuses a repeated address client-side to save a round trip. The Worker
  is the gate either way, and it now answers `duplicate_attendee_in_booking` - a
  different status and a different sentence from `duplicate_attendee`, which means
  somebody already holds a seat from an EARLIER booking. One sentence for both is how
  the wrong one reached that buyer.

**Ticket prices are labelled "ex GST"**, like every other price on the site. This was
the one price-rendering surface in the theme with no GST wording anywhere in it, so a
buyer read a bare figure here and an inc-GST total on the invoice - the rest of QA ref 36,
"wording needs to be consistent (ex GST) across all modules". A free ticket gets no label.
`tests/unit/gst-labelling.test.ts` sweeps every file that RENDERS a price (as opposed to
computing one) and fails the build if one stops stating its tax basis.
Nick's production pass (23 Sep) found three more: membership fees (typed as text, so
the sweep never saw them; `membership-options` and `membership-join` now append "ex GST"
to any paid fee that does not already say it), and the member portal's course cards
(`formatMoney`, now part of the sweep). **Technical resources for sale are NOT
labelled**: their prices are free-text HubDB labels with nothing saying whether GST is
in them, and Weld needs to say which before anyone writes it on the card.

`src/test/event-registration-attendees.test.ts` runs the shipped `module.js` against the
shipped `module.html` row template, so the markup and the request builder cannot drift
apart the way they did here.


### 6.10 `membership-options` - the downgrade guard

A Corporate or Industry Supplier member may stay at their level or move up,
never down (QA ref 44). **This could not be done in HubSpot**: the cards are
editor content with no per-card visibility rule, so removing a card under the
Gold smart-content rule removed it from the Default view as well.

- The visitor's level comes from their COMPANY tier through
  `_member-company-resolve.html` (§ 6.7's ladder), not `associatedcompanyid`
  alone, for the reason that resolver exists.
- A card is ranked off the `_join_slug` the module already computes, so the
  corporate and supplier tabs are one rule, and `individual`,
  `student-apprentice`, `reciprocal` and `tafe-rto` are untouched - a different
  KIND of membership is not a step down from a corporate one.
- **It fails open.** Only a tier positively recognised as gold or silver
  restricts anything. Of the two ways to be wrong, one shows a member a plan
  they cannot take and the other hides the plan a prospect came to buy.
- Nothing is hidden: a lower card keeps its price and benefits, because the
  comparison is the point of the page, and loses only its join link. The
  member's own level reads "Your current membership".

**Round two (retest failed, 23 Sep).** The visitor's rank now comes from
`partials/_membership-rank.html`, and two gaps are closed there:

- **A Refuel QA persona outranks the CRM**, as it already did on the portal and
  every pricing surface (`_qa-persona-resolve.html`). The first guard read the
  company tier alone, so a `+portal-qa-corporate-gold@` tester was Gold on the
  dashboard and nobody on /membership, and saw "Apply now" on all three corporate
  cards. QA test with those accounts.
- **A lapsed, expired or cancelled status is rank 0**: a member whose Gold ran out
  may rejoin at any level. "inactive" is matched exactly.

`tier-comparison` (the Bronze / Silver / Gold table on /membership/corporate) sells
the same levels and had no guard at all; it includes the same partial and applies
the same rule to both its desktop table and its mobile cards. The portal
dashboard's "Upgrade membership" is an outlined 44px button rather than 12px text.

`tests/unit/membership-downgrade-guard.test.ts` pins all of it.

### 6.11 The "Members only" tickbox is COMPANY-AWARE

Every content module carries a `members_only` field an editor can tick in the page
builder. Ten of them derived the answer locally, all the same wrong way:

```hubl
{% set _is_active_member = request_contact.individual_membership_status in ['Current'] %}
```

That is the contact's OWN membership and nothing else, so a corporate employee -
whose membership lives on their employer's company record and reaches them as the
mirrored `wa_company_membership_*` properties - is not a member by that rule. It is
Ref 72 in a different costume: same population, same cause (a resolution narrower
than the one beside it), different symptom. There it was the public price on a
course card; here it is member content that never renders.

**It was already live in one place.** `member-dashboard`'s resource lock used the
same test, so a corporate employee inside their own portal landed at tier rank 0 and
saw every member resource locked. The other nine were latent only because no shipped
page ticks the box - one tick away from being live on any page, with nothing to warn
whoever ticks it, because the page looks correct to them and to every member whose
own contact record happens to carry a status.

`theme/templates/partials/_member-content-gate.html` is the one derivation now, and
sets `wa_member_gate.is_member`.

- **Any positive signal on either record**, sentinels scrubbed through
  `_member-tier.html` first: an active status on the contact or the mirrored company,
  or a real tier on either. An explicitly lapsed / expired / cancelled status on
  either record is a hard no and outranks all of it, matching the worker's gate.
- **"inactive" is matched exactly, never as a substring.** It contains "active", so
  a substring test would read every lapsed member as current - in the one clause
  meant to outrank the rest.
- **A CAMS person id and a membership expiry date do not count.** Both say the
  contact was MIGRATED, not that they are a member, and counting them is exactly what
  "quoted every logged-in migrated contact a member rate they were then refused"
  (events-engine CLAUDE.md). A gate that says yes to every migrated contact is not a
  gate. `_resource-member-resolve.html` still counts a CAMS id, deliberately: it
  grants CONTENT, not a price, so it cannot produce a refused booking.
- **Mirror only - no `crm_object` call, no association sweep.** This runs on ordinary
  marketing pages where the tickbox is usually off. The deeper ladders
  (`_member-company-resolve.html` for pricing, `_resource-member-resolve.html` for the
  Resources wall) are paid for by surfaces that need a TIER, not a yes/no. Widen it
  only when a content gate must survive an employee with no mirrored company.
- `split-feature`'s homepage resource teaser is **not** on it: that one already fails
  open for any logged-in visitor, so the narrowness costs a Gold employee only the
  gold-only teaser rows. Left alone rather than widened into an unlock.

`tests/unit/member-content-gate.test.ts` fails the build if a module goes back to
deciding it locally.

---

---

## 7. HubDB Schemas

These tables are the contract between the React frontend and the CRM/operations team. **Do not change column names without coordination.**

### 7.1 Table 1 - `courses` (Course Timetable & Locations)

| Column | Type | Purpose |
|---|---|---|
| `course_name` | Text | e.g. "AS1796 Cert 10" |
| `course_id` | Foreign Key (or text slug) | Groups all sessions under one parent course page |
| `course_slug` | Text | URL slug for the dynamic page |
| `parent_template` | Select (`standard`, `sales`) | Drives whether the page uses `course.html` or `course-sales.html` |
| `city` | Select | Capitals + the regional centres Weld Australia trains in + Online. **Extensible - see § 7.8**, and never a whitelist in code |
| `state` | Select | NSW / VIC / QLD / WA / SA / TAS / NT / ACT / National. Drives the member dashboard's geo-localised course tile. Set it when adding a session; `pnpm backfill:course-state` fills blanks from `city`, and the dashboard falls back to its own city map when it is empty |
| `start_date` | Date | Session start |
| `end_date` | Date | Session end |
| `price_member` | Number | Member price (AUD **ex GST** - the checkout adds 10% on top, see § 6.7) |
| `price_non_member` | Number | Public price (AUD **ex GST**) |
| `registration_url` | URL | Unique event.hapily / Zoom link |
| `use_event_engine` | Boolean | Route registration through the Event Engine rather than `registration_url` |
| `worker_event_id` | Text | Event Engine event id. **Also what lets the card read live seats** — see § 7.6 |
| `member_ticket_type_id` | Text | Event Engine ticket type (member) |
| `non_member_ticket_type_id` | Text | Event Engine ticket type (non-member) |
| `is_module` | Boolean | **This row is a session of one MODULE, not a whole course.** It exists so the module selector can price it and so the Worker reads the same row. Excluded from every course sweep - see § 7.7 |
| `module_product_id` | Text | HubSpot Product ID of the module this session teaches. The join key to `course_modules.hubspot_product_id` - see § 7.7 |
| `status` | Select | Available / Sold Out / Cancelled / **Closed** (Ref 74c — registrations shut by hand on an UPCOMING session; see § 7.11) |
| `seats_remaining` | Number | **The session's CAPACITY for the Event Engine** (events-engine migration 0045): the Worker copies it into its own seat count, so this is where staff add or remove seats. Enter the TOTAL seats, not a running remainder - see § 7.6. On a row with no `worker_event_id` it is still only the display fallback for "Only N spots left" |
| `category` | Select | Welding Inspection / Supervision / Welding Processes / NDT / Robotic Welding / Engineering / Management. **Grouped into the four client-facing training divisions in code** - see § 7.5 |
| `delivery_mode` | Select | Face-to-Face / Online / Blended / In-House |
| `duration` | Text | e.g. "4 days + exam" |
| `description` | Rich Text | Card and detail-page copy |
| `photo` | Image | Card image |
| `standards` | Text | Standards covered, used in card search |
| `is_free` | Boolean | Drives the "Free" badge |
| `meta_description` / `page_title` / `og_image` | Text / Text / Image | Dynamic-page SEO mapping |

> **Reconciled with production 2026-09-20.** The tiered pricing columns
> (`price_individual`, `price_student_aud_ex_gst`, `price_bronze_aud_ex_gst`,
> `price_silver_aud_ex_gst`, `price_gold_aud_ex_gst`) and `price_non_member` are
> **CURRENCY** on the portal, not NUMBER, and the JSON now says so. `price_member`
> really is NUMBER on both sides - the two disagree with each other in production
> and nothing depends on it, since every surface runs the value through
> `format_currency` itself.
>
> The `city` SELECT gained **Gladstone** and **Townsville** (added by Weld in the
> portal, per § 7.8's "staff can add a town themselves"), and `category` gained
> **Welding Coordination**. That last one is a DIVISION name used as a category
> value, which `bucket_slug` already resolves to its own division, so it works -
> but see § 7.5: the divisions are a display grouping over the seven category
> values, and a category named after a division is a data smell worth raising with
> Weld rather than a fault.
>
> `course_modules` gained `name` (always on the portal, always read by
> `course-modules.html`, never in the seed file) and its `product_year` is NUMBER.
>
> `events.bronze_discount_` / `silver_discount_` / `gold_discount_` **are read now**
> (QA ref 73, see § 7.10). They were left out of the seed JSON on the reading that
> nothing read them and they should be deleted; the resolution went the other way,
> so they are part of the contract and belong in `hubdb/events.json`.

**Dynamic Pages:** Enable for this table. URL pattern: `weldaustralia.com.au/courses/{course_slug}`.

**SEO mapping:** Configure dynamic page meta_description, page_title, and og_image columns (extra columns to add: `meta_description`, `page_title`, `og_image`).

### 7.2 Table 2 - `members` (Find a Member directory)

| Column | Type | Purpose |
|---|---|---|
| `company_name` | Text | Primary display name |
| `member_tier` | Select | Gold / Silver / Bronze / Reciprocal / Industry Supplier |
| `company_logo` | Image | Logo for the directory card |
| `company_blurb` | Rich Text | Short description |
| `website_url` | URL | Member's own site |
| `contact_email` | Text | Public contact point |
| `state_operation` | Multi-select | NSW / VIC / QLD / WA / SA / TAS / NT / ACT / National |
| `is_active` | Boolean | Toggle visibility instantly when membership lapses |
| `hubspot_company_id` | Number | Backref to the HubSpot Company record (for sync workflows) |

**Sort order:** `is_active = true`, then `member_tier` (Gold first), then `company_name` A→Z.

### 7.3 Table 3 - `team_and_board`

| Column | Type | Purpose |
|---|---|---|
| `name` | Text |  |
| `role` | Text | e.g. "Chief Executive Officer" |
| `category` | Select | Executive / Board / Engineering / Training / Q&C |
| `headshot` | Image |  |
| `bio` | Rich Text |  |
| `display_order` | Number | Manual sort |
| `is_active` | Boolean |  |

### 7.4 Table 4 - `certification_guidance` (small lookup table)

| Column | Type | Purpose |
|---|---|---|
| `certification_type` | Select | AS1796 / IIW Inspector / ISO 3834 / etc. |
| `step` | Text | Mirrors Deal stage name |
| `guidance_text` | Rich Text | "Please submit your work evidence logbook…" |
| `evidence_checklist` | Rich Text | Bullet list |

### 7.5 Training divisions (course categorisation)

The client organises training around **four divisions**, which do not match the
seven `courses.category` options one-for-one. The grouping is a display layer in
code - **the HubDB values are not changed**, so no course rows need retagging.

| Division | Slug | Link target (`url` in the JSON) | HubDB `category` values |
|---|---|---|---|
| Welding Inspection | `welding-inspection` | `/courses?category=welding-inspection#all-courses` | Welding Inspection |
| Welding Supervision | `welding-supervision` | `/courses?category=welding-supervision#all-courses` | Supervision |
| Welding Coordination | `welding-coordination` | `/courses?category=welding-coordination#all-courses` | Engineering, Management |
| Short Courses | `short-courses` | `/courses?category=short-courses#all-courses` | Welding Processes, NDT, Robotic Welding |

> **Why the deep links and not `/training/<division>-courses/`?** QA 226/227
> found every "View X courses" link 404ing - `training-category.html` exists but
> the four pages have never been created in HubSpot. Division links now point at
> the `/courses` directory, which filters itself from `?category=`. Create the
> four pages from `training-category.html` (it derives its own filter from the
> page URL) and the links follow by changing `url` in
> `config/course-categories.json` and running `pnpm build`.

Welding Coordination maps to Engineering + Management because, under ISO 14731,
welding coordination personnel are the IIW IWE / IWT / IWS / IWP credentials.

**Single source of truth:** `config/course-categories.json`. `pnpm build`
generates `theme/templates/partials/course-taxonomy.html` (HubL macros) and
`src/shared/courseTaxonomy.ts` (React islands) from it - never edit those two by
hand. `src/shared/courseTaxonomy.test.ts` fails the build if a `category` option
in `hubdb/courses.json` has no division.

**Deep-linking:** course listings accept `?category=<division>` and open
pre-filtered, e.g. `/courses?category=welding-coordination#all-courses`. Legacy
slugs (`inspector`, `supervision`, `certification`, `appreciation`) and raw
HubDB values still resolve, so older links keep working.

**Adding a division:** edit the JSON, run `pnpm build`, then **create the HubSpot
page by hand** from `training-category.html` at a URL containing the new slug.
The page derives its filter, heading and meta description from the URL, so there
is no per-page setup - but neither `pnpm build` nor an upload creates it, and a
division with no page means every nav link to it 404s. Steps: DEPLOYMENT.md §7.1.

> This is exactly how the four `/training/…-courses/` pages were shipped as
> templates but never created, 404ing the whole Training menu.

### 7.6 `seats_remaining` is the FALLBACK, not the source

**`seats_remaining` is where staff change how many seats a session has** (Ryan,
2026-09-23: it is the field staff already treat as the course's capacity, and the one Weld
have populated). Until events-engine migration 0045 nothing read HubDB for capacity: the
Worker's number moved only through the app card, so changing it here (the answer everyone
gave on Ref 87) did nothing and the page kept advertising places the checkout refused. The
Worker now reads this column off the same row it prices from and copies a changed number
into its own capacity before it sells a seat. Mapped once per portal: `PATCH
/api/v1/manage/onboarding/hubdb-capacity` with `{"coursesCapacityColumn": "seats_remaining"}`.
The `events` table has no such column and stays unmapped.

- **Enter the TOTAL, never a running remainder.** The column's name says "remaining", and
  that is the trap: a course of 24 with 10 sold, updated to "14 remaining", becomes a
  14-seat course with 4 left to sell. The Worker counts sold seats itself; this number is
  only ever the size of the room. Relabel the column in the HubDB UI (the label only;
  never the internal name) to something like "Seats (total capacity)" so the next person
  typing into it is not misled.
- Lowering it below what has sold makes the session sold out and cancels nobody.
- Blank or 0 leaves the Worker's own number alone, so a row nobody has filled in changes
  nothing. (A 0 still reads as a soft "sold out" on a legacy row with no live read.)
- On an Event Engine row the PAGE shows the Worker's live remaining count, not this cell,
  so the displayed number stays right as seats sell even though the cell holds the total.

`courses.seats_remaining` is a number somebody types into HubDB by hand, so it goes stale the
moment a seat sells and stays stale until a human remembers the row. Every Event Engine-backed
session therefore reads the live count from the worker
(`GET /api/v1/events/{worker_event_id}/availability`) and falls back to the column only when
there is nothing better. The events listing already did this; the course pages did not, which
is why a sold-out course kept advertising places.

Shared client: `fetchAvailability` + `applyAvailability` in `src/shared/api/eventEngine.ts`,
batched per page by `useLiveAvailability`. Consumed by `course-filter` and `checkout-tunnel`
(step 1, so a buyer finds out before typing their details rather than after).

- **Advisory, always.** A failed read leaves the card exactly as HubDB rendered it. The worker
  is authoritative at reserve, so an optimistic page can only ever send someone to a checkout
  that tells them the truth — it can never oversell. A page that hid sellable courses because
  a fetch timed out would be a worse bug than the one this fixes.
- **The worker may only NARROW availability, never widen it.** Two values in the row are
  editorial decisions a person made, and the worker reverses neither: `status = Cancelled`
  (the worker has no concept of a cancelled session) and `status = Sold Out` (staff close a
  session for reasons the seat count cannot see — the trainer is sick, the room shrank, the
  last places are held for an apprentice intake). A live read saying "seats available" used
  to override a hand-set Sold Out and the page kept selling. Accepted cost: a refund no
  longer re-opens a hand-closed session, so someone has to clear the status column;
  `sales_paused` on the worker side is the reversible control for the cases where the seat
  count really is the whole story.
- **`seats_remaining` is not an editorial decision**, so a sold-out derived from it stays
  soft and the worker still overrides it. HubL hands the status column and the seat count to
  the island separately (`seats_remaining_is_set` distinguishes a blank cell from a 0):
  folding them together in HubL is what let a CSV import writing 0 into blank cells close a
  timetable permanently.
- **Five states, five sentences.** `sold_out` invites a waitlist, `registration_closed`
  (migration 0038's cutoff, defaulting to the session start) does not, `sales_paused` (staff
  stopped selling by hand) is worth checking back on, `cancelled` is final, and
  `not_bookable` means the worker answered with nothing the public may buy.
- **No public ticket types is `not_bookable`, never `sold_out`.** `[].every()` is true, so an
  empty `ticketTypes` array used to read as a sell-out: a session whose ticket types have not
  been added yet, or whose only types are internal or CAMS imports (the public availability
  read filters both out), was advertised as full. Nothing is full there; there is simply
  nothing on sale. The worker's own `isSoldOut` (`capacity-guard.ts`) has always returned
  false for zero types — this was the CMS disagreeing with it.
- **A session that has already STARTED is closed, and the CMS says so itself.** Nothing was
  time-bounded: a course that ran in August was still sold in September, on the course page,
  in the `/courses` timetable, through its modules, and at `/checkout/?session_id=`. That is
  the Worker's own default cutoff (`registration_closes_at` NULL resolves to `starts_at`,
  migration 0038) said one page earlier, for the rows the Worker never sees - a legacy row
  with no `worker_event_id` gets no live read at all, so the date on the row is the only
  thing that knows. `hasStartDatePassed` in `src/shared/api/eventEngine.ts` is the one
  definition for the React islands; `_module-session-resolve.html` and
  `pricing-table.module` repeat it in HubL because HubL cannot import TypeScript, and
  `course-from-price.test.ts` and `course-modules-combined-booking.test.ts` fail the build
  if the two drift.
  - **Soft, like `seats_remaining`, not editorial like Cancelled.** A live read outranks it
    in BOTH directions: a tenant who left a walk-up window open an hour past the start owns
    that decision in `registration_closes_at`, and the Worker is the side holding that
    column. Only Cancelled and Sold Out are beyond a live read's reach.
  - **The START date, not the end.** A course that began three weeks ago is not something
    the website should still be selling, and the end date would keep it on sale to its last
    day. A row with no date at all is left alone: "we cannot tell when this runs" is not
    evidence that it is over, and the safe direction is to keep offering it and let the
    Worker refuse at reserve.
  - **It is a LOCAL calendar day.** `hasStartDatePassed` builds today out of local date
    fields rather than `toISOString().slice(0, 10)`; at +09:30 the UTC date is yesterday
    until 9:30am, and a 9am course start with arrivals from 8:30 is the ordinary shape of
    Weld's timetable. Same reasoning as the worker's `timezone.ts`.
  - **Nothing is hidden while it is RUNNING.** A closed session still renders, badged
    "Registrations closed", which is a different sentence from "Sold out" for § 7.6's usual
    reason, and its Register button is disabled on the directory card too (it stayed live
    there until QA ref 87, 22 Sep, because only the HubDB status reached that gate).
  - **A FINISHED session leaves the website** (QA ref 120, Weld's training team, 22 Sep).
    `has_ended` in `_session-priceable.html` reads the END date, and every course listing
    (`featured-courses`, `course-filter`, `course-timetable-filter`,
    `course-timetable-compact`, `training-course-cards`) drops the row before it renders,
    so a course whose every sitting is over has no card at all. A row with NO end date
    never counts as ended: the rolling Online Welding Supervisor course starts in the past
    (ref 107), and "we cannot tell when this finishes" is not evidence that it has.
    `tests/unit/finished-sessions-hidden.test.ts` holds every listing to the rule. The
    course page itself still resolves (HubSpot serves the URL from its row); its session
    list simply omits the finished sitting.
  - **The `/courses` directory card badges it too**, off `has_started` in
    `_session-priceable.html` - the same rule `priceable` uses to decide whether a row may
    set the "From" price, exported so the badge and the price cannot disagree. The card had
    no notion of a finished session at all, so a course that ran in August listed in
    September as ordinary and bookable (QA ref 120), and the only escape was the "Starting
    from today" toggle - which is opt-in and which also hid a rolling all-year course whose
    start date is in the past (QA ref 107). The toggle is a convenience; the badge is the
    correctness mechanism. The card asks `has_started` rather than `priceable`, which also
    demands a way to buy: "every session has run" and "nothing is wired up to sell" are
    different states. A cancelled session is not evidence the course is still running, and a
    course with no dated session at all is left alone.
  - **The toggle itself is now gone** (QA ref 107). With the badge doing the
    correctness work its one remaining effect was the bug - hiding the rolling
    all-year Online Welding Supervisor course. Weld asked what benefit it added;
    the honest answer was none, so it was removed rather than relabelled, along
    with its browser-side `getLocalTodayIso` clock: whether a session has run is
    decided server-side by the shared macro, so there is no second definition free
    to disagree across a timezone boundary. The filter row it sat in now checks
    whether it has anything left to hold, since the toggle was the one control in
    it that always rendered.
- HubL has to forward `worker_event_id` and `worker_base_url` for any of this to happen. Drop
  either and every session silently goes back to the stale number — `memberPricingParity.test.ts`
  fails the build if the module stops passing them.

### 7.7 Table 5 - `course_modules`, and the module selector

`course_modules` carries `parent_course_id`, `name`, `module_order`,
`show_on_website`, `hubspot_product_id`, `sku`, `product_year`, `product_id` (empty
on every live row) and `module_booking_url` - no date, no price. The course page's
"Course modules" section (`theme/templates/partials/course-modules.html`) resolves
each module's real session through the shared `_module-session-resolve.html`, and
that is the only reason a module row can show dates, a location and the price this
visitor pays.

**The PRODUCT ID is the join; the booking URL is the override.** events-engine
migration 0031 says it outright - "The Course Modules HubDB table identifies a module
by its HubSpot Product ID" - and stores that id on the child event so a course page
can find the session "without inferring it from a title". The CMS ignored it for
months, so every module needed `/checkout/?session_id=<row>` typed by hand, and on
production **all 44 rows had none**: the entire selector rendered "Contact to book",
which QA read as the feature never having shipped.

The join is HubDB to HubDB, server-side: a `courses` row carrying the same
`module_product_id` IS the module's session. Nothing is fetched from the Worker.

- **It keeps ONE price.** The checkbox value stays a `courses` row id, so
  `/checkout/` resolves it unchanged and the Worker prices that same row through
  `hubdb-pricing.ts` (which finds it by `worker_event_id`, migration 0035). Reading
  the Worker's `ticket_types.price_cents` for display instead would put a SECOND
  price source back on the module path - the exact fault 0035 removed, and the
  family behind every `price_mismatch` on this project.
- **`hubspot_product_id`, not `product_id`.** Both columns exist; the live table
  fills the first and leaves the second empty on all 44 rows. Reading `product_id`
  alone resolves nothing at all.
- **A module taught twice matches two rows.** The soonest sitting still on sale
  wins; when none is, the soonest overall is kept so the row renders with its badge
  rather than vanishing. Letting the buyer CHOOSE between sittings is the
  parent-pickable problem below, and is deliberately not attempted.
- **`module_booking_url` still wins nothing and loses nothing**: it is reached only
  when no row claims the product id, so every pre-existing row keeps working.
- **Only an `is_module` row answers for a module.** On 21 Sep production's 19 parent
  course rows were given their full-course Product ID in `module_product_id`. Without
  the guard, any module sharing that id resolved to the PARENT session, and the
  selector sold the whole course, at the whole course's price, under the module's
  name - Nick's Dev finding on IWI-S Part 2 (Ref 46). The resolver and
  `course-module-audit.ts` both skip a candidate that is not `is_module`, so such a
  module reports `module_session_not_created`, which is the truth. Those parent-row
  values should still be cleared: they mean nothing on a course row.

**A module session row is not a course, and four sweeps had to learn that.**
`courses.is_module` marks it. `featured-courses.module` (`all_courses`,
`all_upcoming`, `all_manual`, `all_cat`), `training-course-cards.html` and
`course-filter.module` all read the table unfiltered, and `_session-priceable.html`
takes a minimum across it. Left in, a module row becomes a card in the directory
if it carries its own `course_id`, or - carrying its parent's - a bookable
"session" of the course AND the cheapest row feeding the "From" price, which is
the § 7.9 fault with a new cause.

- **The whole row is the control** - a `<label>` wrapping the checkbox, in a
  three-column grid (`44px | 1fr | auto`). The previous layout flexed three
  variable-width children with `justify-content: space-between`, so each tickbox
  landed wherever its module name happened to end, and the 22px checkbox was half
  the 44x44 target § 5.4 mandates. Alignment is now structural.
- **One CTA, not two.** Ticking rows accumulates a running total in a bar that is
  in flow until something is selected and pinned to the viewport bottom after
  (sticking from the start cost ~14% of a phone screen to hold a prompt and a
  disabled button). "Book this module" survives as the degraded path - and
  renders on **any** row that is not selectable, priced or not. A module can
  resolve a perfectly good price and still not be selectable (most often because
  the PARENT row is not Event Engine configured, which turns off every checkbox
  on the page), and a price with nothing to click is the dead end that link
  exists to prevent. A row with no booking URL at all gets the training team
  `mailto:` instead, the same fallback `CourseFilter` gives a session with no
  usable registration URL: Ref 46 round 2 found a module listed with no CTA of
  any kind, and a name with nothing to act on is exactly what this section
  exists to prevent. Every listed module ends in a checkbox, a link, or a badge
  saying why not.
- **Selectability is four conditions, each one the checkout requires of every
  selected module** - a row failing any of them would take the whole basket to a
  dead end, which is worse than the single dead link it replaced:
  1. a `worker_event_id`, or there is nothing to reserve against;
  2. a price above zero. The checkout sends each selected module's displayed
     price as `expectedUnitCents`, and the worker's per-module guard is the same
     DIRECTIONAL `comparePriceQuote` the single-session path uses: it refuses only
     a price resolving ABOVE what the page displayed, and honours a lower one at
     the lower figure. (It was strict equality once, which failed a booking for
     the buyer paying LESS than they were shown; the comment in `reserve.ts` records
     the change.) The rule survives the correction: a missing or zero page price is
     below any real resolved price, so it is still a hard `price_mismatch` 409 -
     and a page price that is too LOW is the only way to fail this guard;
  3. a ticket type THIS visitor may buy, resolved as `ticketTypeForSession()`
     does (a member falls back to the public ticket; a guest never falls back to
     a member-only one). Without it a guest facing a members-only row was handed
     a tickbox and then "not configured" at payment - the audit's
     `guest_ticket_missing` error reaching a buyer;
  4. a session that is on sale. `module_session.off_sale` is the resolved
     `courses` row's own `status` saying Cancelled, Sold Out or Closed (read through
     `session-status.html`'s `is_off_sale`, § 7.11), which § 7.6 makes
     an EDITORIAL decision nothing may reverse, OR the resolved session's start
     date having passed (§ 7.6 again). The date half applies to BOTH sources:
     `events` carries no status column, but every row has a date, and Ref 46
     round 2 found four IWI-S modules whose booking URLs all resolved to one
     August session, still ticked and sellable in September.
     `off_sale_label` carries which of the three it is, because the badge has to
     say it. Every other surface that offers a
     session honours it already - the corporate bulk booking panel excludes both,
     the course cards badge them - and this one did not, so a cancelled module
     kept its tickbox and joined the basket beside live ones. The badge says which
     of the two it is, because "Sold out" invites a waitlist enquiry and
     "Cancelled" does not, and an off-sale row gets no "Book this module" link
     either: sending a buyer to a cancelled session's own booking page is a dead
     end, not the cure for one. Read off the resolved SOURCE, not merely off a row
     that was looked up - an id present in both tables resolves to `events`, whose
     schema carries no status column at all.
- **Both routes into the checkout write the pricing handoff.** The module
  selection and the complete-course CTA each save
  `wa_checkout_pricing_handoff` before navigating, keyed on the PARENT row's
  `hs_id` (what `readCheckoutPricingHandoff(session.id)` compares against),
  exactly as `CourseFilter` already does. The checkout resolves membership from
  its own HubL context and falls back to public pricing when that context is
  lost, so without the handoff a member ticks $9,100 of modules here and is
  quoted $9,900 one page later. The HubL cannot import
  `src/shared/utils/checkoutPricingHandoff.ts`, so the key and TTL are
  duplicated and `course-modules-combined-booking.test.ts` fails the build if
  they drift.
- **The selection cap is the worker's**, not a UI preference: 1..12 modules
  (`too_many_selected_modules` above 12). The old UI required TWO ticks to submit,
  which hid a single bookable module behind a checkbox that could never submit.
- Per-module `bookable` gates on `worker_event_id` alone, matching the checkout's
  gate for a _selected_ module. `use_event_engine` is still required on the PARENT
  row, per § 11.5 - it routes a row's own Register CTA, and the selected-module
  checkout never reads it.
- Resolution is capped at 24 modules per render so a mis-tagged
  `parent_course_id` cannot turn one page into an unbounded run of HubDB reads.
- **The PARENT must be ON SALE, not merely Event Engine configured.**
  `/reserve-selected-modules` checks the parent course's own sales window before
  it looks at a single selected module, and migration 0038 closes registration at
  `starts_at` by default. The page is served by ONE `courses` row (§ 11.6), so a
  course whose page row ran in August rendered tickboxes, priced a basket,
  accepted a selection and was refused at reserve with "Registrations for this
  course have closed". `_parent_on_sale` folds the shared `has_started` macro and
  the off-sale statuses (Cancelled / Sold Out / Closed) into `_parent_engine_ready`, which also gates
  the complete-course CTA - it reserves against the same event and fails the same
  way. The registration-URL clause of `_session-priceable.html` is deliberately
  NOT carried over: a module selection can only go to the Event Engine checkout,
  so a legacy URL is not a way to buy it.

**The selection names sessions; the PARENT is the half nobody picks.**
Melwyn's multi-module checkout (`cf42eb4`, 9 Sep) and its pricing/UX pass
(`f55abe3`, 18 Sep) are exactly the per-module session picker: every tickbox
carries a resolved SESSION id as its `value`, and the row above it shows that
session's dates, city and this visitor's price. So "which session did I just
buy" is answered per module, by the row ticked. What is NOT picked anywhere on
the page is the parent.

- **The granularity is the ROW, not the module name.** A module's session is the
  id in its own `module_booking_url` - `_module-session-resolve.html` parses
  `?session_id=` (then `?event_id=`) out of it and looks it up in `courses`, then
  `events` - and one row carries one URL. `course_modules` has no date, city or
  capacity column of its own, so two sittings of one module are **two rows**, each
  resolving its own session and each rendering as its own tickable line with its
  own dates and price. Nothing dedupes by `name`, which is what makes that work.
  The failure mode is the opposite one: a module offered in two cities and given
  only ONE row silently sells whichever sitting the editor typed, and the page
  looks completely correct either way.
- **The PARENT session is `dynamic_page_hubdb_row.hs_id`** - the single `courses`
  row HubSpot serves `/courses/<slug>` from. Both CTAs hardcode it
  (`data-checkout-base="/checkout/?session_id={{ dynamic_page_hubdb_row.hs_id }}"`),
  so the complete-course price, the dates on the "Book the complete course" card
  and the parent event the selection reserves against are all that one row's -
  **not** the session the visitor chose in the `CourseFilter` island higher up the
  same page. The two surfaces are not wired together at all: `CourseFilter` builds
  its own per-session checkout links in React and never touches the selector, which
  is server-rendered once per page load. Changing the city dropdown changes nothing
  below it. This is § 11.6's coupling seen from the other end - one slug, one
  served row, and every other session under that slug unreachable from it.
- **So the buyer's route through the page is not an input.** `/checkout/` reads
  `?session_id=` and `?module_session_ids=` off the URL and re-resolves both from
  HubDB; the only thing the click contributes is WHICH modules, never which
  sitting of them. `wa_checkout_pricing_handoff` rides along too, and it carries
  membership only - the session id in it is the parent's, and is there to be
  compared against, not to choose anything.
- **The worker agrees, and checks.** `/reserve-selected-modules` takes the parent's
  `worker_event_id` as its `:slug` and each selection as `{eventId, ticketTypeId}`,
  and refuses any module whose event is not a registered component of that parent
  (`invalid_selected_module`). It cannot substitute a different sitting either: it
  has no notion that two events are the same module in two cities.
- **Two wrong sessions are therefore possible, and neither is visible on the page.**
  A module URL naming a session of a DIFFERENT course, and several modules of one
  course all naming the SAME session - the four IWI-S modules pointing at one
  August row. Both render perfectly: real dates, a real price, a live tickbox.
  `pnpm audit:course-modules` is how they are found (`module_session_other_course`,
  `module_session_shared`), and both are fixed by editing `module_booking_url` on
  the `course_modules` row, never in code.
- **A module's sittings must live under the SAME parent, or the basket 409s.**
  The worker's components are the events whose `parent_event_id` is the parent
  (`loadCourseComponents`), so a row whose session hangs off a different sitting
  of the course is refused as `invalid_selected_module` even though the page
  priced and rendered it perfectly. This is the ceiling on "one row per sitting":
  it gives the buyer a real choice between two dates of a MODULE, and it cannot
  give them a basket spanning two sittings of the COURSE, because there is one
  parent and the page never asks which.
- **Making the parent pickable is the open piece of work.** It means the
  complete-course CTA and `data-checkout-base` stop being `dynamic_page_hubdb_row`
  and start reading a session the visitor chose - which is `CourseFilter`'s
  selection, today held in React state that the server-rendered selector cannot
  see. Not a large change, but it is a real one: the parent id decides the
  complete-course price, the modules' eligibility above, and which sitting the
  order is attributed to.

**Degrading well makes an empty portal look like an undeployed one, so the rows
are audited rather than eyeballed.** Every fallback above is deliberate, and the
sum of them is a page that renders a full module list where none can be booked:
each row keeps its own link, or the training-team `mailto:` reading "Contact to
book". Production QA read exactly that page - 27 modules across 9 courses, all
"Contact to book" - as the module booking feature never having shipped, when the
template was current (production carried the `--static` list and the mailto,
which only the current template emits) and it was the DATA that was missing:
`module_booking_url` was added to `hubdb/course_modules.json` and populated as
Dev-only fixtures, and § 11.4's rule applies - uploading the theme creates no
HubDB column, so on a portal that was never seeded every row reads a field that
does not exist.

The audit follows the same order. `module_session_not_created` names a module
carrying a product id that no `courses` row claims, and its remedy is the row to
CREATE (`is_module`, `module_product_id`, dates, prices, `worker_event_id`) rather
than a URL to type - pointing somebody at the URL would undo the join. A missing
`courses.module_product_id` column is reported once as `product_id_column_missing`,
because with no column there is nothing to edit row by row and the fix is a seed run.

**A missing COURSE and an unticked BOX are different faults, and now different
codes.** Both used to report as `parent_not_engine_ready`, which on the first
production run buried the single genuine wiring finding (ISO9606, whose course
exists and is not Event Engine ready) under seventeen findings meaning something
else entirely - and left a `--json` consumer unable to separate them.
`parent_course_missing` is its own code: no `courses` row carries that
`parent_course_id` at all, so the modules hang off a page that does not exist and
never render anywhere. Its remedy is not "tick a box": either the id is a typo, or
the course was never migrated into `courses` and has to be created before its
modules can be wired.

**Production's state, 2026-09-20.** 44 modules, 0 resolving to a session, 0
bookable, and `module_product_id` does not exist on the portal at all. Two
populations behind that one number:

- **26 modules on real, engine-ready courses** (IWE, IWI-B, IWI-S, IWS, IWT,
  Welding Fundamentals, Welding Supervisor, Welding Technology Training
  Resources). Parent is fine, course is wired; they are waiting on the column and
  on module session rows. These come good with a seed plus data entry.
- **17 modules whose `parent_course_id` names a course that does not exist** -
  `metallurgy-1`, `fabrication-math-1`, `welding-symbols`, `wps-pqr-explained`,
  `structural-bolting-e-course` and the rest. These read as Weld's short courses
  and e-courses, which appear to have no `courses` row at all. Not a wiring gap:
  a content gap, and a question for Weld before anybody edits a cell.

The order matters and is not negotiable: **seed the column, create the sessions,
then fix the orphans.** Fixing `parent_course_id` first points modules at courses
that still cannot sell them, and the orphan remedies cannot even be computed until
the join has something to join to (§ 11.6).

`pnpm audit:course-modules -- --env=production` answers it in one command, per
course: how many modules resolve to a real session, how many a visitor can
actually book, and the row edit behind each gap. `scripts/lib/course-module-audit.ts`
mirrors `_module-session-resolve.html` and the selectability rules above, and is
pure and tested; the CLI is read-only like `audit:event-engine`, for the same
reason - which session a module should book is an editorial call. It also names
the two faults a page sweep cannot see: several modules resolving to the SAME
session, and a booking URL still pointing at the other portal's host (the ids
ride the query string, so it prices and dates correctly here and then sends the
buyer to the other site).

The selector's own JavaScript ships only when the page renders a control for it
to drive (`_combined_booking_enabled or _complete_course_available`). It ran
inert on every production course page during that QA - 0 checkboxes found - and
a page holding half a feature is what made the data fault read as a half
deployment.

### 7.8 Locations are DATA, and adding one is a JSON edit

`courses.city` is a SELECT, so the option list is the list of places Weld
Australia can say it trains in. Both halves of that used to be stuck.

**The schema file did not reach the portal.** `seed-hubdb.ts` only ever added
missing COLUMNS; for a column the portal already had it pushed the portal's own
definition straight back, so an option added to `hubdb/courses.json` changed
nothing and said nothing about it. `scripts/lib/hubdb-options.ts` now reconciles
SELECT / MULTISELECT options the same way the column diff works - additively:

- an option in the JSON the portal lacks is **appended** (sent without an id;
  HubSpot mints one);
- an existing option is passed through **with its id untouched** - rows store
  the option id, so re-sending one without its id orphans every cell set to it;
- an option only the portal has is **kept and reported**, never deleted;
- matching is by name, trimmed and case-insensitive, so "mackay" typed into the
  portal UI is not appended a second time beside "Mackay".

**The frontend treated the list as a whitelist.** `CourseFilter` rendered a
hard-coded array as its `<select>`, so a session in a town outside it could not
be chosen, `default_city="auto"` fell through to Sydney, and a course whose only
session was regional told every visitor there were none - the page advertising an
open Mackay course and then offering nothing to book (QA 86). Both islands now
call `orderCitiesForRows` in `src/shared/courseCities.ts`, which UNIONs the
canonical display order with the cities the rows actually use. `CITY_ORDER` sorts
the list; it never decides what exists. `courseCities.test.ts` fails the build if
it drifts from the option names in `hubdb/courses.json`.

The two selectors differ on empty cities, deliberately: the course page keeps a
capital with nothing scheduled (choosing it is how a visitor reaches the
expression-of-interest form), the `/courses` directory drops it (an option that
filters every course away is not a filter).

**To add a town:**

```bash
# 1. add the option to the `city` column in hubdb/courses.json
# 2. add it to CITY_ORDER in src/shared/courseCities.ts (the test enforces this)
pnpm seed:hubdb -- --env=staging      # appends the option to the live SELECT
pnpm build && pnpm upload:staging     # ships the display order
```

Also add it to the `city_states` map in `member-command-centre.module` if it is
not already there - an unmapped city resolves to "National" and drops out of a
member's own state filter on the dashboard. **This is the step that gets missed**:
Weld added Gladstone and Townsville in the portal, `scripts/lib/course-state.ts`
already knew both, and the dashboard map did not - so a Queensland member filtering
their own state saw neither. Nothing fails a build over it, because the map is HubL
and the city list is data; the only thing that catches it is the seed warning
naming an option the JSON lacks.

`courseCities.test.ts` demands CITY_ORDER and the JSON options match EXACTLY, so
adding a town is always both edits. Its unlisted-city fixture is deliberately a
name nobody will ever add (`Woop Woop`), guarded by its own assertion: the fixture
was Gladstone until Gladstone became real, at which point "sorts after the
canonical ones" inverted and the failure read `expected 13 to be greater than 15`.

Staff can then set it on a row. Nothing else is needed: a town the bundle has
never heard of still appears in the selector, because the rows decide.

### 7.9 The "From" price is drawn from PRICEABLE sessions only, by one shared rule

The course page's fees panel (`pricing-table.module`) takes the MINIMUM price across every
`courses` row sharing the page's `course_id`, and renders it as "From $X ex GST". It was
taking that minimum across rows nobody could buy, so the headline price was one no customer
could pay: Ref 46 round 2 found AS1796 Cert 10 advertising "From $4,950" against a single
bookable session at $6,000, and IWI-S "From $8,800" against $9,450, with the cheap rows in
both cases being sessions that had already run.

Ref 40 found the other half. The **/courses directory card** (`featured-courses.module`,
`selection_mode = all_courses`) showed the price of whichever row HubDB returned FIRST for
the course - arbitrary, and routinely a session that had already run or a test row - so one
course quoted a different number on its card, in the upcoming-sessions strip and in the fees
panel. AS1796 Cert 10's card advertised $18,786.36 / $17,281.82 over a course selling at
$6,000.

**The rule lives once, in `theme/templates/partials/_session-priceable.html`**, and both
surfaces call it. Two copies of "which rows may set a price" is what produced four numbers
for one course, so the card now shows the same "From" minimum, over the same rows, as the
panel on the page it links to. A row may set a price when it has not already STARTED
(§ 7.6), its `status` is not Cancelled, Sold Out or Closed, **and there is a way to buy it** -
the Event Engine pairing § 11.5 requires (`use_event_engine` AND `worker_event_id`) or a
registration URL that goes somewhere. That third condition is the one both surfaces were
missing: `/courses/iwe` advertised "Members save $10.00", member From $50.00, off a row
called "IWE Module 1 Test" badged "Online booking is not available for this session yet",
while its only bookable session sold at $18,786.36.

When nothing survives, both figures stay 0: the panel falls through to "Contact us" over a
"View sessions" link, which lands on the selector's expression-of-interest form, and the
card simply shows no price. That is the honest answer for a course with nothing bookable,
and it is the only place this can remove a price from a page.

`tests/unit/course-from-price.test.ts` fails the build if either surface stops gating its
minimum on the shared macro.

**A backwards date range is never published.** `formatDateRange` renders the START date
alone when the end date is missing, unparseable, or earlier than the start: Ref 40 found a
live session listed as "1 Dec - 1 Oct 2024". It also keeps the start's YEAR when the range
crosses one, which it never used to - a course running 28 December into 3 January rendered
"28 Dec - 3 Jan 2027", a year late.

**The savings line is per-row.** The member and standard minima are taken independently and
can land on different sessions, so differencing them advertised a discount no single session
offered. The largest per-row saving is kept instead, which is what "Members save up to $X on
current sessions" then literally means.

This does not make the panel and the checkout read one number: the panel is a "from" across
sessions and the checkout prices the one session chosen. What it does guarantee is that the
panel's number belongs to a session the selector below it will still sell.

### 7.10 An event's price lives in its own HubDB columns (QA ref 73)

Weld type `member_price`, `non_member_price` and `bronze_/silver_/gold_discount_` into
their `events` rows, exactly as they type `price_member` / `price_gold_aud_ex_gst` into
a `courses` row. **Nothing on either side read one.** The page priced an event from
`ticket_types_json` and the Worker priced it from `pricing_rules` in D1 - so the three
discount columns did nothing at all, and the two price columns were a fallback the page
reached only when the JSON was silent.

events-engine migration 0044 makes the events row a pricing SOURCE, alongside the
courses row that 0035 already made one. It is a second source, not a second code path:
nothing in the Worker's `hubdb-pricing.ts` was ever course-specific, so a tenant now
configures a LIST of tables and the resolver takes the first holding a row for the
event. The CMS half is here.

- **The row's own columns outrank `ticket_types_json`**, in `checkout-tunnel.module`
  (both the single-event branch and the selected-module one) and in
  `event-registration.module`. The Worker reads the columns and ignores its own
  `ticket_types.price_cents` copy, so a page still quoting the JSON puts the quote and
  the invoice back on two separately maintained numbers - which the reserve guard
  reports as "the course price changed before checkout" over a change nobody made. A
  blank column changes nothing: it resolves to nothing here and to null in the Worker,
  and both sides keep the ticket type's price.
- **A tier may be a PERCENTAGE.** `resolveMemberPrice` (and the HubL `member_price`
  macro) now run: the tier's own absolute column → the tier's own discount off
  `price_non_member` → member → individual → public. Off the NON-MEMBER price, settled
  with Ryan on 2026-09-20, which is what "Gold members get 20% off" means on a page
  showing one public figure. The discount sits ABOVE the generic member price because
  the tier is the more specific statement about the buyer - and it can resolve DEARER
  (5% off a $500 event is $475 against a $450 `member_price`), which is still right,
  because the page quotes the tier and the invoice must agree.
- **A percentage outside (0, 100) is ignored.** 0 is "nobody entered one", the state of
  most rows; 100 or more gives a seat away, and a fat-fingered cell is likelier than a
  tenant meaning it. A free seat is a 0 in the absolute column, where it is unambiguous.
- **The column families do not collide** (`price_non_member` vs `non_member_price`,
  `price_member` vs `member_price`), so one macro family reads both tables and a course
  row resolves exactly as it did before. That is the DRY answer: `_member-pricing.html`
  and `memberPricing.ts` stay the only two implementations, mirroring the Worker's.
- **The event widget is NOT tier-aware**, deliberately and for now. A member-only ticket
  there shows the generic member price, because the widget has no membership context and
  giving it one properly means extracting the contact-resolution preamble that five
  course-pricing surfaces already carry byte-identical (`_member-company-resolve.html`
  answers the company half only). That extraction is its own change. The understatement
  is in the buyer's favour, the checkout tunnel is tier-aware, the widget sends no
  `expectedUnitCents`, and the Worker is authoritative either way.
- **`pnpm audit:event-engine` names a row that states a price twice**
  (`price_columns_shadow_ticket_json`, info). Two figures on one row, only one of them
  paid, and no page shows that a second exists - the same shape as ref 121, and the same
  severity for the same reason: the row transacts correctly and consistently, and which
  number the tenant meant is an editorial call a script does not get to make.

**Deploy order.** Configure the Worker's events source FIRST
(`PATCH /api/v1/manage/onboarding/hubdb-pricing` with `eventsTable`,
`eventPriceColumns` and `eventDiscountColumns`), then upload the theme. In between, one
side reads the row and the other reads the ticket type, and where those disagree a
booking can be refused. Run the audit before either, and reconcile the rows it names.

```jsonc
// The body for Weld's portal. `courses*` keys are unchanged from 0035.
{
  "eventsTable": "events",
  "eventsEventIdColumn": "worker_event_id",
  "eventPriceColumns": { "member": "member_price", "nonMember": "non_member_price" },
  "eventDiscountColumns": {
    "gold": "gold_discount_",
    "silver": "silver_discount_",
    "bronze": "bronze_discount_"
  }
}
```

`src/shared/utils/memberPricingParity.test.ts` runs the shipped HubL discount expression
against the TypeScript one and fails the build if either surface stops reading the row
before the JSON.

### 7.11 One session-status vocabulary (Ref 74c)

Six statuses, six sentences, one source: `src/shared/status/sessionStatus.ts`. The React
islands import it; `scripts/build.ts` generates `theme/templates/partials/session-status.html`
from the same table so the server-rendered card partials say the same words. Never edit that
partial by hand — edit the TypeScript and run `pnpm build`.
`sessionStatusParity.test.ts` fails the build if the two come apart, or if a card partial
goes back to its own `{% if status_name == 'Sold Out' %}` ladder.

- **`status = Closed` is an UPCOMING session whose registrations staff have shut**, and it
  resolves to the same status the Worker's own cutoff produces (`registration_closed`,
  migration 0038): to a buyer, staff closing registrations and the clock running out are one
  fact, so they get one sentence and one badge. It is NOT for finished sessions — a past
  course is handled by its own dates, a withdrawn one by `Cancelled` — so a closed row stays
  in every listing and the eight `status__neq=Cancelled` queries are unchanged.
- **The Worker may only NARROW availability**, so `Closed` joins `Cancelled` and `Sold Out`
  as an editorial hard stop: `applyAvailability` settles it BEFORE the live read, and a
  Worker answering "six seats, bookable" can never re-open it. Asserted directly in
  `eventEngine.test.ts`.
- **Every CTA gate is an allow-list** (`bookable`), never a deny-list naming one status.
  `training-course-cards.html` tested for `'Sold Out'` alone, and its caller queries the
  courses table with no status filter at all — so a **Cancelled** row was being offered a
  working Register button. That is the failure mode a deny-list produces every time a status
  is added.
  It includes the course PAGE, not only the cards: the `/courses` directory card
  (`featured-courses.module`), the "From" price (`_session-priceable.html`), the module
  selector and complete-course CTA (`course-modules.html`) and each module's own session
  (`_module-session-resolve.html`) all read the shared vocabulary. Left on the old
  Cancelled / Sold Out lists, a Closed course advertised a price, a basket and a Register
  button that the checkout then refused at step 1. `_session-priceable.html` is a macro file
  and writes the off-sale key list out rather than importing it; `course-from-price.test.ts`
  holds that list to `HUBDB_STATUS_ALIASES`.
  **A directory card takes its status from every session it stands for**, never the
  representative row (which is whichever row HubDB returned first): any upcoming sitting on
  sale makes the course bookable, else an upcoming Sold Out, else an upcoming Closed, else
  Cancelled only when every row is. `course-card-closed-badge.test.ts` pins the order.
- Adding a status is one entry in `sessionStatus.ts` plus its CSS. Adding an OPTION to the
  HubDB column is a portal change: use `scripts/add-hubdb-select-option.ts`, and read § 11.8
  before you publish anything.

**Events carry the same column** (Phase 3), and need BOTH controls: the Worker's automatic
cutoff *and* a manual Closed staff can set to shut registrations early. They meet at one
sentence — `registration_closed` — because to a buyer they are one fact.

- **The manual status needs no Worker.** The badge closes a row on the column alone, so an
  event that was never wired to the Event Engine can still be closed. `data-hubdb-status` on
  the badge element is OPTIONAL: a surface that passes none behaves exactly as before the
  column existed, which is what makes shipping the code ahead of the column safe.
- **`checkout-tunnel.module` is the booking path, and it used to hardcode
  `'status': 'available'` for event rows.** A closed event stayed fully bookable to anyone
  holding a `/checkout/?event_id=` link, whatever every listing said. It reads the column
  now, defaulting to available so it stays inert until the column lands.
- **Cancelled/closed outranks the members-only upsell** on both event detail templates.
  Offering "Explore membership" on an event nobody can book reads as a bypass that does not
  exist. Branch order: not-bookable → members-only → Event Engine → legacy `registration_url`,
  asserted in `sessionStatusParity.test.ts`.
- **Existing rows stay BLANK.** Blank resolves to available, so the column needs no backfill
  — and a backfill would be row writes, which would need a publish of their own.
- `member-command-centre` event cards deliberately do NOT read it: their CTA is "View event",
  not a booking action.

---

## 8. CRM Data Model (Custom Properties)

Olivier owns building these. The frontend depends on these internal names - **lock them with him before coding any module that reads them**, and maintain a shared mapping sheet (current source: TBD - see § 13).

### 8.1 Deal properties

- `deal_type` (dropdown: Training Course, Exam, Individual Certification, Company Certification, Event Ticket, Membership)
- `course_category` (dropdown: Welding Inspection, Supervision, Certifications, etc.)
- `session_location` (dropdown: all Australian cities + Online)
- `session_start_date` (date)
- `certification_expiry_date` (date)
- `audit_due_date` (date)
- `certification_type` (dropdown: AS1796, IIW Inspector, ISO 3834, etc.)
- `xero_invoice_pdf_url` (text - synced from Xero)

### 8.2 Contact properties

- `contact_membership_status` (dropdown: Active, Grace Period, Lapsed, Never Member)
- `contact_membership_expiry` (date)
- `contact_membership_tier` (dropdown: Individual, Apprentice, Reciprocal, etc.)
- `next_upcoming_course_name` (text) - synced from Won Training Deal
- `next_upcoming_course_date` (date)
- `next_upcoming_course_location` (text)
- `current_certification_step` (dropdown - mirrors Cert pipeline stage names)
- Property groups (segregated to prevent overwrites): `as1796_status`, `iiw_status`, `iso3834_individual_status`, etc., each containing status / expiry / certificate URL / etc.

### 8.3 Company properties

- `company_membership_status` (dropdown: Active, Grace Period, Lapsed)
- `company_membership_expiry` (date)
- `company_membership_tier` (dropdown: Corporate Gold, Corporate Silver, Corporate Bronze, Industry Supplier, Reciprocal)
- `vouchers_total` (number)
- `vouchers_used` (calculated - count of associated Closed Won Training Deals)
- `vouchers_remaining` (calculated - total − used)
- `directory_blurb` (rich text - synced into HubDB Table 2)
- `directory_logo_url` (text - synced into HubDB Table 2)

### 8.4 Association Labels

Define on the Company ↔ Contact association:

- Primary Admin
- Employee
- Apprentice
- Reciprocal Member

Define on Company ↔ Company:

- Parent (Head Office)
- Child (State Office)

---

## 9. Authentication, Membership Wall & SSO

### 9.1 Private Content (the Member Wall)

The portal pages (§ 4.3) sit behind HubSpot CMS Private Content. Audience lists ("Member Wall" lists in the masterplan):

- **Active Members** - list filter: `contact_membership_status` IN (Active, Grace Period) AND `contact_membership_expiry` > today, OR contact is associated to a Company where the same is true.
- **Corporate Gold / Silver tier lists** - for tier-gated content.
- **Primary Admin list** - drives visibility of the Corporate Admin tile.

Workflow keeps these lists in sync - frontend doesn't mutate them.

### 9.2 SSO - deferred to Phase 2

Resolved on 2026-05-16: **cross-application SSO is not in scope for the Phase 1 launchpad.**

The masterplan called for HubSpot to act as the IdP for Moodle, WeldQ, and ISO 3834 via SAML/OIDC, but Ryan disputed in Slack on 2026-05-09 that HubSpot Pro can act as a third-party IdP. Rather than block the launchpad on validating this, the SSO architecture is being pushed to Phase 2.

**For Phase 1:**

- Members log into the HubSpot CMS portal with HubSpot Membership credentials only.
- WeldQ, Moodle, and ISO 3834 retain their own separate logins on their own domains.
- Portal UI copy must **not** promise a unified login - that's a Phase 2 message.
- Password reset flow only resets the HubSpot Membership password; do not architect for cross-app sync.

---

## 10. Integrations

### 10.1 Xero - ⚠️ open decision

Native HubSpot-Xero integration **does not** support the planned workaround of pushing all student invoices to one generic Xero contact. Per Ryan in Slack (2026-05-06):

> "the native HubSpot-Xero integration does not support this workaround. He stated that for an invoice to map correctly, the specific person being invoiced must exist in Xero."

**Two paths** - Weld Aus finance must choose:

1. **Accept** that every invoiced individual syncs to Xero as a contact (clutters Xero but works out of the box).
2. **Custom middleware** - build a small API service that intercepts won Deals and posts invoices to Xero against a generic contact, syncing the PDF URL back to HubSpot.

Frontend impact: option 2 changes how the `xero_invoice_pdf_url` property gets populated, but the dashboard's "Download PDF Receipt" tile reads the same property either way. **No frontend change required for this decision** - but the Member Dashboard receipt tile must gracefully handle a missing `xero_invoice_pdf_url` (show "Receipt processing - check back shortly" rather than a broken link).

### 10.2 event.hapily + Zoom

Backend installs the `event.hapily` HubSpot app. Frontend touch points:

- Course registration CTAs link out to event.hapily-hosted checkout URLs (`registration_url` in HubDB Table 1).
- The checkout-tunnel module is the customised UI wrapper around hapily where possible; if hapily forces its own checkout UI, the tunnel becomes a "preflight" that captures consent + tier before redirecting.
- Zoom join links arrive on the Contact via hapily and surface in the Registered Events tile.

### 10.3 Google Tag Manager / GA4

Standard HubSpot tracking + GTM container injected via theme `<head>`. Custom events to fire:

- `resource_locked_view` (fired when a non-member sees a locked resource)
- `resource_download` (fired on successful download)
- `member_discount_applied` (fired on checkout step 3)
- `corporate_bulk_registration` (fired on Manage My Team bulk registration success)

---

## 11. Build & Dev Workflow (for Claude Code)

### 11.1 Prereqs

```bash
# Node + pnpm
nvm use 22
corepack enable
pnpm install
# HubSpot CLI
npm i -g @hubspot/cli
hs init                 # set up portal credentials per environment
hs auth                 # add the Weld Australia portal
```

### 11.2 Per-environment portals

There are **two** Weld Australia portals and they are **different places**:

| `--env` | Portal ID | CLI account name | What it is |
|---|---|---|---|
| `staging` | **443253065** | `weld-australia-staging` | Prove changes here first |
| `production` | **441838610** | `weld-australia` | The LIVE weldaustralia.com.au site |

```
~/.hscli/config.yml
  defaultAccount: 443253065
  accounts:
    - name: weld-australia-staging
      accountId: 443253065
    - name: weld-australia
      accountId: 441838610
```

`--env` names one portal and that is the only one any script touches. **There is
no fallback between them** - an unauthenticated staging portal is a hard error
telling you to run `hs auth`, not a silent redirect to production. (It was
exactly that silent redirect until 2026-09-18, when `upload:staging` was found to
be deploying to the live site; `scripts/lib/hubspot-portals.test.ts` now fails the
build if the ids and names drift apart again.) `--env=sandbox` is accepted as the
old name for staging: it warns and resolves to 443253065.

#### The Event Engine Worker, and the hostname that no longer exists

The two environment ladders are separate. The Worker's used to be mislabelled - it
launched as `[env.staging]` and everyone learned to read `-staging` as production -
and **it has since been renamed**, which inverts every note written during that
period:

| Worker hostname | wrangler env | What it is |
|---|---|---|
| `event-engine.refuel-creative.workers.dev` | the default env | **PRODUCTION.** The live Worker. Real orders, real invoices |
| `event-engine-dev.refuel-creative.workers.dev` | `[env.dev]` | Development. Note `crons = []`, so no outbox or invoice reconciliation |
| `event-engine-staging.refuel-creative.workers.dev` | gone | The former name of the production Worker. **Does not resolve.** Anything still pointing at it takes checkout down |

`[env.staging]` no longer exists in `wrangler.toml`; its D1, KV and queue keep their
original Cloudflare `-staging` NAMES, which is why the bindings still read that way.
Both `pnpm deploy` and `pnpm deploy:staging` in events-engine target `--env=""`, so
they are the same production deploy.

**The theme field is `Production`.** `theme/fields.json` no longer offers the dead
hostname at all: the choice was removed rather than relabelled, because it was
already labelled "(not deployed yet)" and got selected anyway. Every module and page
fallback literal points at `event-engine` too, so a cleared theme setting degrades to
the live Worker instead of a host that is not there.

This table was wrong in the opposite direction for a while, and a `price_mismatch`
investigation on 2026-09-19 was sent chasing the wrong Worker by it. **Believe
`packages/worker/wrangler.toml`, not a hostname and not a comment.**

### 11.3 Common commands

```bash
# React HMR for the modules
pnpm dev
# One-shot React build (writes to theme/assets/js)
pnpm build
# Watch HubL + theme files and push to the staging portal
hs cms watch theme weld-australia-theme
# Push everything to STAGING (443253065) for QA
pnpm upload:staging
# Promote to PRODUCTION (441838610, the live site) after sign-off
pnpm upload:prod
```

**Both portals are deployed by hand** (Ryan, 2026-09-21).
`.github/workflows/deploy-staging.yml` is **manual dispatch only**: it fired on
every merge to main with `HUBSPOT_PERSONAL_ACCESS_KEY_STAGING` unset and failed
every time, and a check that is always red is how a check going red for a real
reason stops being noticed. Dispatch it from any branch to QA a change on a real
portal before it merges; restoring `push: branches: [main]` is one line, the day
the secret exists. Production stays manual, confirmation-gated and main-only
(`deploy.yml`).

**So staging holds whatever was last uploaded, not the latest merge.** That is the
cost being carried deliberately, and it is why a QA result from that portal is
worth pairing with the build it ran against - "we tested it on staging" does not
on its own name a build.

Each workflow writes its own `hubspot.config.yml` from a separate repository
secret: `HUBSPOT_PERSONAL_ACCESS_KEY` (441838610) and
`HUBSPOT_PERSONAL_ACCESS_KEY_STAGING` (443253065). A personal access key is
scoped to one portal, so these must be two different keys and neither job falls
back to the other.

### 11.4 HubDB seeding

`hubdb/*.json` is the canonical schema. Changing JSON in git does **nothing** to the live portal until you seed **and** HubSpot publishes the draft. Never hand-edit production HubDB columns - change the JSON, commit, run the seed.

The seed is **additive in both directions**: it adds columns the portal lacks, and
(since QA 86) options the portal lacks on a SELECT / MULTISELECT it already has.
It never deletes or renames either, and never changes a column's type. Existing
options keep their ids because rows point at the id, not the label - see § 7.8.

```bash
# Schema sync (add/update columns, privacy, dynamic meta tags):
pnpm seed:hubdb -- --env=staging
pnpm seed:hubdb -- --env=production

# Demo rows only (after schema exists). Flags: --dry-run --no-purge --only=<table>
pnpm seed:hubdb:demo -- --env=staging

# Fill blank dynamic-page paths (hs_path) after UI/CSV imports - dry-run first:
pnpm backfill:paths -- --env=production --table=team_and_board --dry-run
pnpm backfill:paths -- --env=production --table=team_and_board

# Fill blank course SEO metadata (row Page title, page_title, og_image ← photo):
pnpm backfill:course-seo -- --env=production --dry-run
pnpm backfill:course-seo -- --env=production

# Fill blank course state from city (needed once after the `state` column lands,
# and after any bulk import that leaves it empty):
pnpm backfill:course-state -- --env=production --dry-run
pnpm backfill:course-state -- --env=production
```

> **Adding a course location.** Weld Aus can add a city themselves: add the
> option to the `city` column in HubDB, add the row, set `state`. No code change
> and no deploy - both course filters derive their location list from the rows
> (`deriveCityOptions`), and the dashboard tile reads `state` off the row.
>
> **Select options on an existing column are a UI job, not a seed job.**
> `seed:hubdb` adds missing *columns*; on a column that already exists it passes
> the portal's own definition back untouched, options included. That is what
> stops a seed deleting the city Weld Aus just added - and it means an option
> added to `hubdb/*.json` never reaches an existing column. The seed warns when
> the two have drifted; add the option in HubDB by hand.
> `scripts/lib/course-state.ts` only maps city → state for the backfill and the
> HubL fallback; a city missing from it means the row's `state` gets set by hand,
> not that the site is broken.

Use `pnpm <script> -- --env=…` (note the `--`) so pnpm does not swallow `--env`.

**Auth — do not invent a private-app token ritual.** HubDB scripts
(`seed-hubdb`, `seed-hubdb-demo`, `backfill-hubdb-paths`, `backfill-course-seo`, `audit-event-engine`) resolve credentials via
`scripts/lib/hubspot-auth.ts` in this order:

1. `HUBSPOT_ACCESS_TOKEN_STAGING` / `HUBSPOT_ACCESS_TOKEN_PRODUCTION` (or `HUBSPOT_ACCESS_TOKEN`) if set. `HUBSPOT_ACCESS_TOKEN_SANDBOX` is still honoured for staging under its old name
2. Otherwise the same CLI personal access key used by `pnpm upload:*` — from `hubspot.config.yml` or `~/.hscli/config.yml`, exchanged through HubSpot localdevauth

If `hs auth` already works for uploads, **seed/backfill should work with no extra env vars.** A failure like `No access token found` means the CLI is not authenticated for that portal — run `hs auth`, do **not** stop and ask for a separate private-app token unless CLI auth is intentionally unavailable.

**Deploy order when theme code depends on new HubDB columns** (e.g. `team_and_board.quals` / `org`):

```bash
pnpm seed:hubdb -- --env=production          # columns must exist first
pnpm build && pnpm upload:prod               # then ship templates/modules
pnpm backfill:paths -- --env=production --table=team_and_board --dry-run
# show dry-run to Ryan, then apply without --dry-run
```

Uploading the theme alone will not create missing HubDB columns. Modules that read new columns stay blank (or fall back) until the seed has run against that portal.

### 11.5 Auditing Event Engine wiring

`use_event_engine` is the editorial opt-in that routes a HubDB row's Register CTA
at the on-site checkout tunnel. It is deliberately **not** inferred from
`worker_event_id`: a row can keep stale Worker and ticket ids after being routed
back to a legacy flow, and the ids alone must not re-enable self-service booking.

The cost of that is a forgotten tickbox being silent. The session still renders,
the CTA still works, and it quietly sends buyers to the legacy flow - while
`/checkout/?session_id=<row>` stays transactable for anyone holding the link,
because the checkout tunnel itself only needs `worker_event_id`. Two paths to the
same session, different outcomes.

**The tick alone never routes a buyer to the checkout.** `use_event_engine` AND
`worker_event_id` are both required, in `CourseFilter.tsx`,
`CourseTimetableFilter.tsx`, `events-listing.module` and `event-detail.html`
alike - the same pairing `isBulkBookable` and `course-modules.html` already
demanded. A row with the tick and no id degrades to its `registration_url` (then
to the training-team `mailto:`), because the checkout has nothing to reserve
against and could only tell the buyer online booking was not configured. The
audit is what surfaces that misconfiguration; a dead end in front of a customer
is not. `usesCheckout` in `event-engine-audit.ts` mirrors the gate, so the
report cannot describe a page that no longer exists.

```bash
# What the public site is doing right now (published rows, both tables):
pnpm audit:event-engine -- --env=production

# Unpublished edits, or one table, or sessions that have already run:
pnpm audit:event-engine -- --env=production --draft
pnpm audit:event-engine -- --env=production --table=events --include-past

# CI / scripted use:
pnpm audit:event-engine -- --env=production --json
pnpm audit:event-engine -- --env=production --strict   # exit 1 on error/warn
```

**Read-only.** It has no write path and never publishes. Whether a session
should use the Event Engine is an editorial call, so the script reports and
stops. Cancelled and already-finished sessions are skipped unless
`--include-past`.

| Code | Severity | What a visitor gets |
|---|---|---|
| `ticked_no_ticket_type` | error | Checkout loads, then dead-ends at the payment step for everyone. No fallback |
| `guest_ticket_missing` | error | Member ticket only on a row guests ARE offered, so logged-out visitors get the form and then "not configured" |
| `ticked_no_worker_id` | warn | Degrades to the legacy flow, so the Event Engine is not selling this session: no live seats, no bulk booking, no on-site checkout |
| `unticked_with_worker_id` | warn | **The forgotten tickbox.** Legacy CTA, stale `seats_remaining`, hidden from corporate bulk booking |
| `no_usable_registration_url` | warn | On the legacy flow with no working URL, so Register falls back to a `mailto:` to the training team |
| `members_only_ticket` | info | Member ticket only, on a row flagged members-only. Guests are gated before the form, so nothing to fix |
| `ticked_with_external_url` | info | Books on-site AND holds a working `registration_url`, which nothing will ever follow. QA ref 121 |
| `price_columns_shadow_ticket_json` | info | An events row states a price in its own column AND in `ticket_types_json`, and they disagree. The column is what the buyer pays. QA ref 73, see § 7.10 |

Severity is about the buyer, not about how wrong the row is: `error` means a dead
end with no fallback, `warn` means it still books but not the way the row asks
for. `no_usable_registration_url` keys off the real gate rather than the tick, so
a ticked-but-unwired row is held to the same standard as an unticked one.

**A member-only ticket list is only benign when the row SAYS members-only.**
`event-detail.html` gates guests on `is_members_only`
(`_engine_allowed = (not _is_members_only) or _contact_is_active`), never on the
ticket JSON, so with the flag off a logged-out visitor is handed the booking form
and then told booking is not configured. That is `guest_ticket_missing`, an
error. The courses table has no members-only column at all, so a course whose
only ticket is the member one is always that fault.

**`registration_url` and the tick can both be set, and only one of them wins.**
`_show_engine` in `event-detail.html` (and the same branch in `events-listing.module`)
prefers the on-site checkout whenever `use_event_engine` AND `worker_event_id` are
both present, so an external address on such a row is never reached and nothing said
so. Weld entered a TryBooking link on the SA Open Day row and Register Now kept
booking on-site - QA ref 121. Neither value is wrong on its own and both look right
in the HubDB UI, so like ref 86 only the relationship between them is the fault.

Answering the two questions Weld asked: `registration_url` IS wired, as the fallback
for a row that is not Event Engine configured; and yes, an event can register through
TryBooking while living in HubDB - untick `use_event_engine` and the CTA follows the
URL. `ticked_with_external_url` is **info**, not warn, because the row transacts
correctly either way and which one the tenant meant is an editorial call this script
does not get to make.

**A HubSpot-hosted hostname is the SITE.** `classifyRegistrationUrl` only knew
`weldaustralia.com.au`, so a URL on `<portalId>.hs-sites-<region>.com` - the address
staff copy out of the page editor, and the one the site is served on before DNS cutover -
read as somewhere else entirely. The 2026-09-20 production run reported three course rows
as `ticked_with_external_url` over
`https://441838610.hs-sites-ap1.com/checkout/?session_id=…`, the portal's own checkout.
Mislabelling it is not cosmetic: that finding's remedy says to untick `use_event_engine`
so the CTA follows the URL, which would send the buyer to the on-site checkout for
whatever `session_id` the link happens to carry - and on an UNTICKED row the same URL
reads as a working fallback, so `no_usable_registration_url` stays silent about a Register
button that goes nowhere useful. `isOwnSiteHost` covers the custom domain, `hs-sites` and
`hubspotpagebuilder`, each with or without a region suffix.

**`unticked_with_worker_id` varies its remedy with the ticket types**, because
"tick the box" is wrong advice for a row with no ticket - it would move every CTA
onto a checkout that dead-ends at payment, causing the fault the audit exists to
find. With no ticket it says to add one first.

**`--json` writes only the document to stdout.** The auth banner from
`resolveHubSpotAccessToken` goes to stderr in that mode (`logTo: 'stderr'`);
without it the CLI-personal-access-key path printed a line ahead of the JSON and
made the machine-readable mode unparseable for exactly the callers who asked for
it.

Rules live in `scripts/lib/event-engine-audit.ts`, which is pure and covered by
`scripts/lib/event-engine-audit.test.ts`. Adding a third table carrying the flag
is a new `TableAdapter` entry, not a new branch in the rules.

### 11.6 Auditing course page routing (ref 86)

A course is identified by **two different columns on the same table**, and
nothing keeps them in step:

```
/courses/<course_slug>                  ← what a directory card links to
   ↓ HubSpot serves that path from the ONE row whose page path matches
dynamic_page_hubdb_row
   ↓ .course_id
hubdb_table_rows('courses', 'course_id__eq=…')   ← the whole schedule
   ↓ parent_course_id
course_modules rows                     ← the module list
```

`featured-courses.module` links a card at `'/courses/' ~ course_slug`;
`course-router.html` and `course-filter.module` derive the schedule, the
modules, the fees panel and the title from `dynamic_page_hubdb_row.course_id`.
`courses` is a table of SESSIONS, so a course is many rows - and **when one
slug spans more than one `course_id`, the page shows one of them and every
other session under that slug is unreachable from the URL its own card points
at.**

That is QA ref 86, symptom for symptom: "Welding Supervisor Mackay (26 October)
shows as open but when you go to register, shows Maryborough training schedule
and no courses available. Course modules are wrong." One card, one click, a
different course's sessions and a different course's modules - because the card
and the page are keyed on different columns. (The city half of ref 86, a
regional session the filter could not offer, is § 7.8 and is already fixed.)

**None of it is visible from a page.** The card renders, the link works, the
page renders, and every row looks correct in the HubDB UI. Only the
relationship between them is wrong, so reading it off the site means opening
every course page and cross-checking it against the table by hand. Hence a
report.

```bash
# What the public site is doing right now:
pnpm audit:course-routing -- --env=production

# One course, unpublished edits, CI:
pnpm audit:course-routing -- --env=production --slug=welding-supervisor
pnpm audit:course-routing -- --env=production --draft
pnpm audit:course-routing -- --env=production --json
pnpm audit:course-routing -- --env=production --strict   # exit 1 on error/warn
```

| Code | Severity | What a visitor gets |
|---|---|---|
| `sessions_unreachable` | error | **The ref 86 finding.** A session advertised on `/courses` that its own card's page cannot show or sell |
| `slug_spans_course_ids` | error | The cause of the above: one slug, several `course_id` values, one page |
| `course_id_missing` | error | A page backed by that row queries an empty id and shows no sessions at all |
| `no_row_owns_path` | error | No row's page path is its slug, so which row backs the URL is HubSpot's choice |
| `slug_missing` | error | Sessions no card links to and no page shows |
| `course_id_spans_slugs` | warn | One course under several URLs, each rendering the same schedule, each with its own card |
| `path_slug_mismatch` | warn | Harmless while one row owns the path; it is why the directory picked a different row for the card |
| `modules_orphaned` | warn | A module naming a `parent_course_id` no course row carries, so it appears on no page. One finding per wrong VALUE, not per row |

**Read-only**, like `audit:event-engine` and `audit:course-modules`, and for
the same reason: which sessions belong to which course is an editorial call,
never a script's. **Nothing here is fixed by a deploy** - every finding is a
HubDB row edit.

**The dynamic page path is a ROW-LEVEL field, not a column.** `HubDbTableRowV3`
carries it as `path`; `courses` has no `hs_path` column and never will - that
name is only what the dynamic-page settings call it (`hubdb-slug.ts` reads the
same field). Reading it out of the column values was this audit's own first
bug: against real rows every slug answered `served: unknown`, two of the eight
codes could never fire, and the ref 86 remedy named a guessed `course_id`.

Where a slug spans several ids the report has to say which id wins. It prefers
the one on the row that owns the dynamic path, because that is the row HubSpot
actually serves. **When no row owns the path it withholds the instruction**:
`served: unknown`, and the remedy says to decide which row owns the URL first
rather than issuing a most-common guess as a bulk row edit. Fixing the path is
the first step anyway, and the id to standardise on follows from it.

A course is many session rows, so the fix for a path is **one row's page path
set by hand**, never `pnpm backfill:paths` - that mints a path for every row it
can slug, which on `courses` publishes a URL per session.

**`--slug` scopes the report, never the rows.** Filtering the rows would shrink
the set of known course ids and report every other course's modules as orphaned,
and would hide a `course_id` this course shares with a slug outside the filter.
The findings that are about the table rather than one slug (`slug_missing`,
`modules_orphaned`) are suppressed under a filter instead: they are not answers
to what was asked. Same shape as `audit:course-modules`, which scopes its
subject and keeps its universe whole.

A `course_modules` read that FAILS is announced on stderr and carried in the
`--json` document as `moduleCheckSkipped`, because "we did not look" must never
render as "nothing found" to a CI job reading the document.

**Orphaned modules are grouped by the VALUE they carry.** The first production
run returned seventeen row ids under one finding, which is not an edit anybody
can make. They are now one finding per distinct wrong `parent_course_id`,
naming it - and when that value is a real course's `course_slug`, the report
says so and gives the `course_id` to use, because keying a module on the slug
is the single likeliest way to be orphaned and the right value is readable
straight off the table.

**When the value matches no slug, the PRODUCT ID answers it.** Production's
sixteen orphans name their own module (`metallurgy-1`, `fabrication-math-1`,
`welding-symbols`), which is neither a `course_id` nor a `course_slug`, so
there is nothing in that column to resolve from and the report used to say
"decide which course it belongs to" and stop. The second key answers it: § 7.7,
`course_modules.hubspot_product_id` joins to `courses.module_product_id`, and
the `courses` row claiming that product id IS the module's session, whose
`course_id` is the value the orphan should carry. `resolveOrphanParent` is that
join, and it is the same one `_module-session-resolve.html` and
`audit:course-modules` already make.

It is EVIDENCE, not proof, and both ways it can mislead are reported rather
than papered over:

- **A module sitting may carry its OWN `course_id`** rather than its parent's -
  § 7.7 describes both shapes. Naming that id as the parent would move the
  orphan instead of fixing it, so a candidate counts only when a row that is
  NOT `is_module` carries it too: the course has real sessions of its own.
- **One product id claimed under several `course_id` values** is a data fault
  in itself, so the remedy goes per row rather than issuing one wrong bulk edit.
- Two modules sharing a wrong `parent_course_id` need not share a parent, so
  the group is resolved row by row and only speaks with one voice when every
  row agrees.
- `hubspot_product_id` first, `product_id` second: both columns exist and the
  live table fills only the first (§ 7.7).
- With **no** `courses` row carrying any `module_product_id`, the join cannot
  answer a single orphan, and that is ONE finding listing every value, not one
  per value. The first production run of this returned sixteen findings carrying
  an identical paragraph, which is the fault this section already names twice
  over - a reader cannot tell sixteen problems from one problem said sixteen
  times. The values and all their row ids ride inside the one finding, so the
  edit stays addressable; it is just not sixteen edits.
  **The SLUG reading is independent of the join**, so a value it can answer keeps
  its own finding and its own remedy however empty `module_product_id` is. Only
  the orphans nothing can answer collapse.
  That state means the module SESSION rows have not been created on this portal
  at all, so the remedy points at `pnpm audit:course-modules`, which is the report
  that distinguishes a missing COLUMN (a `seed:hubdb` run) from an empty one (rows
  to create). **Production is in exactly this state**: 19 course rows, 17 orphaned
  modules, 0 resolvable, no `module_product_id` anywhere. § 7.7's join has nothing
  to join to, which is the same finding Ref 46 hit from the page side.
- The remedy always names the product id it resolved through, so the reader can
  check the join themselves rather than taking a generated instruction on trust.

`summary.orphanedModules` carries `{ rows, resolvable }` and the CLI prints it
above the findings, because that ratio is what decides whether the orphans are
a few row edits somebody types or a backfill worth writing. It is **`null`**,
never `{rows: 0}`, when the module check did not run - no rows passed, or a
`--slug` filter suppressed it - for the same reason `moduleCheckSkipped` exists:
"we did not look" must never read as "nothing found".

Still read-only. A resolution is an argument for a row edit, not a licence to
make it: which course a module belongs to stays an editorial call, and the one
shape the join cannot see is a module whose course is missing from `courses`
altogether, which is the fault to fix first.

Rules live in `scripts/lib/course-routing-audit.ts`, which is pure and covered
by `scripts/lib/course-routing-audit.test.ts`; the CLI only reads rows and
prints.

### 11.7 Git conventions

- Trunk-based, short-lived feature branches: `feat/<module>`, `fix/<module>`, `chore/<thing>`.
- PR titles follow Conventional Commits.
- Each module merge requires: green build, screenshot of sandbox, link to the module's section in this CLAUDE.md.

### 11.8 Adding an option to a HubDB SELECT column

**There is no schema-only publish, and no single-row publish** (confirmed on Dev). Pushing a
column change live releases the table's draft ROWS with it — every half-finished edit staff
have open. `pnpm seed:hubdb` WILL append a missing option (§ 7.8, `mergeColumnOptions`), but
it publishes every table it touches straight away and never looks at what else is sitting
in draft, so on a table staff are actively editing it releases their unfinished rows too.

So for a live table, use `scripts/add-hubdb-select-option.ts`, which makes the publish
deliberate:

```bash
# Dry run: shows current vs proposed options AND every row with unpublished edits.
pnpm tsx scripts/add-hubdb-select-option.ts --env=sandbox --table=courses --column=status --option="Closed"
pnpm tsx scripts/add-hubdb-select-option.ts --env=sandbox ... --apply            # draft only
pnpm tsx scripts/add-hubdb-select-option.ts --env=sandbox ... --apply --publish  # releases the table
```

It **refuses to touch a table that has unpublished row drafts** unless you pass
`--allow-dirty-drafts`. That guard is the point: clear the drafts with whoever owns them,
then publish in a low-traffic window. Update `hubdb/*.json` in the same commit — the script
changes a portal, the JSON is what the repo knows.

The update REPLACES the table definition, so the script re-sends the portal's own `name`,
`label`, `useForPages`, `allowPublicApiAccess`, child-table flags and `dynamicMetaTags`
beside the new columns (`scripts/lib/hubdb-table-payload.ts`). Sending columns alone risks a
publish taking `courses` off its dynamic pages or shutting the public read the islands use.

**Ship the theme code first.** If the option exists before the code that understands it, a
staff member selecting it gets a row the site still reads as available, and it keeps selling.

---

## 12. Acceptance Criteria - Project-Level

The brief is "done" when:

1. ✅ Every page in § 4 (Batches 1, 2, 3) is live in production at the correct URL.
2. ✅ Every module in § 6 passes its module-level criteria.
3. ✅ HubDB Tables 1-4 are populated with real Weld Aus data (courses, members, team).
4. ✅ Member Wall correctly gates all `/portal/*` pages - verified with three test contacts (active member, lapsed member, non-member).
5. ✅ A new Won Training Deal in HubSpot causes the assigned contact's Member Dashboard to reflect the registration within 60s (workflow + sync engine working end-to-end).
6. ✅ `is_active = false` on a HubDB Table 2 row removes the company from Find a Member within the next page render (cache TTL respected).
7. ✅ Lighthouse score on Home, Resources, Course, Member Dashboard ≥ 85 mobile / 95 desktop.
8. ✅ All pages pass WCAG 2.1 AA contrast and keyboard navigation checks.
9. ✅ Profile Switcher correctly handles Ryan's test contact "Apprentice + Corporate Employee".
10. ✅ DNS cutover from legacy WordPress to HubSpot completes without 404s on the top-50 most-trafficked URLs (per GA4 last-90-days).

---

## 13. Open Questions & Risks

> **Don't start work blocked by these - flag them and route to the named owner.**

| # | Question / Risk | Owner | Status |
|---|---|---|---|
| Q1 | ~~Can HubSpot Pro act as IdP for Moodle / WeldQ / ISO 3834?~~ | Ryan | **Resolved 2026-05-16: SSO deferred to Phase 2; not built in Phase 1.** |
| Q2 | Xero sync model - generic contact (needs middleware) vs per-student contact (works natively but clutters Xero)? | Weld Aus Finance via Danielle | Awaiting decision |
| Q3 | Brand kit - do current Weld Aus brand guidelines exist or do we extract from the live site? | Danielle | Asset gap, not in our Drive folder |
| Q4 | Property mapping sheet - Ollie's internal property names must be documented before frontend uses them | Ollie | Not yet created (per Gemini analysis in Dev Brief) |
| Q5 | Job Board - HubDB-driven or HubSpot blog? Implications for moderator workflow | Nick + Ollie | Not specified |
| Q6 | Payment processor for checkout - Stripe via event.hapily or direct? | Ollie | Backend decision |
| Q7 | Are there "hidden" CAMS member statuses (per scoping notes Q) that we need to handle in gating? | Danielle | Discovery question from Phase 0 - confirm answered |
| Q8 | Page-build content deadlines - Batch 1 was 10 April, Batch 2 was 1 May. If overdue, Nick to escalate | Nick → Danielle | Verify content received before each batch start |
| R1 | June 30 deadline is **immovable** (CAMS contractual decommission). Any slippage in Batch 1 or 2 cascades into less QA time. | Ryan + Nick | Active risk |
| R2 | Yevhen (Business Jetpack dev) does not know HubSpot - relying on him would multiply scope risk. Plan: Ryan + Claude Code do the build, Melwyn supports once free of Gisham. | Ryan | Mitigation in motion |

---

## 14. Source Documents

Everything in this brief synthesises the following:

### Drive

- **Weld Australia HubSpot Implementation Masterplan** - Ollie, May 2026 - [Drive](https://docs.google.com/document/d/1i8ohSsoiwibQoyUiLMv-JIlIaLF9Zi2BuvBE6wC3lro/)
- **Developer Brief: Weld Australia (Internal)** - Ollie, May 2026 - [Drive](https://docs.google.com/document/d/1mCDL4qza9MVLx7UI6VzhFTS-rzHUCH-x5Lyjl2eFSes/)
- **UI & UX Design Brief: Weld Australia Launchpad** - Ollie + NotebookLM, May 2026 - [Drive](https://docs.google.com/document/d/1wmmyIJkMzKYdZsDHPAz96HGQJWltef3-UrJqRJ27Exo/)
- **Weld Australia Plan** - March 2026 - [Drive](https://docs.google.com/document/d/1hfOkXt4K0-R3Z7cTQyuywoGLDYVsIn8w2vj4HWJdg2Y/)
- **Weld Australia Project Brief v001** - Nick, January 2026 - [Drive](https://docs.google.com/document/d/1wFovPeLeB8vz7xn0b9oJ2LfNrD4UTvPw3mxC0qXP254/)
- **Weld Australia proposal - Expanded Phase 1** - January 2026 - [Drive](https://docs.google.com/document/d/1fO1Bw4uek3uT5g5pEnKFIdMg0YYsxN4pzKwCjSHKkEw/)
- **Project Timeline: Weld Australia** - March 2026 - [Drive](https://docs.google.com/document/d/1qrhGz4G83S_IeZAocOmZ1VpAWM-Yo2xDCffZjpTAPZw/)
- **Weld Australia Scoping Meeting notes (24 Feb 2026)** - [Drive](https://docs.google.com/document/d/1mLRl8G8-fLDj0-akO5ERQJKSVQFzFz7RD9E81Sm52mE/)
- **Phase 0 Workshop Agenda (via Gemini)** - [Drive](https://docs.google.com/document/d/10YNvvHUMEMfSquRgQQZTGgW9GtRy4bcfMnYM8AaPyB4/)
- **Seats for WeldAus staff** - Feb 2026 - [Drive](https://docs.google.com/spreadsheets/d/1bNWBKrBKw8vaeT0NyJZNbdQGvXHyTwbqqAz4QQYeP7Q/)
- **WeldQ - Software Architecture Document v2 (10 Jun 2024)** - [Drive](https://drive.google.com/file/d/19HLwQYu3jq2png4jW9v8m2y7Ptf6RnMI/view) (legacy reference for WeldQ - kept for context; WeldQ stays on its own platform in Phase 1)

### Slack

- **#weld-australia---hubspot-implementation** ([channel](https://refueldigital.slack.com/archives/C0A47T2H23X)) - primary build channel
- **#weld-australia-scoping-session** ([channel](https://refueldigital.slack.com/archives/C0A4996GGMC)) - Phase 0 channel
- Key threads:
  - Yevhen developer fit - [thread](https://refueldigital.slack.com/archives/C0A47T2H23X/p1778543423347609) (2026-05-12, Ryan: "essentially from scratch… Claude and I will be taking the heavy lifting")
  - Masterplan review - [thread](https://refueldigital.slack.com/archives/C0A47T2H23X/p1778214892941449) (2026-05-08, Ryan: "using hubspot as an idp - did you do the research on this? I don't believe this is possible")
  - Dev Brief sign-off + Xero issue - [thread](https://refueldigital.slack.com/archives/C0A47T2H23X/p1778026167147169) (2026-05-06)

### Live systems

- Legacy site: https://weldaustralia.com.au/
- Legacy ISO 3834 directory: https://iso3834.com.au/directory/
- Legacy WeldQ (to be replaced)
- HubSpot portal: 4538263

---

## 15. Definition of "Done" for Claude Code

When Claude Code picks up this brief in a fresh session, the first run-through should:

1. Read this CLAUDE.md top to bottom.
2. Verify the Drive sources still exist and review for any updates since 2026-05-16.
3. Check Slack `#weld-australia---hubspot-implementation` for messages since 2026-05-16 that may have changed scope.
4. Confirm with Ryan: which of § 13's open questions have been resolved.
5. Pick the next module from § 6 in declared order, scaffold it under the file structure in § 3, ship it to the sandbox, screenshot it, mark it off in § 12.
6. **Never** start a module that depends on an unresolved § 13 question without explicit Ryan sign-off.
7. When shipping HubDB schema changes: follow § 11.4 — seed the portal **before** theme upload if templates need new columns; use CLI auth via `scripts/lib/hubspot-auth.ts` (do not block on a missing private-app token when `hs auth` already works).

- end of brief -
