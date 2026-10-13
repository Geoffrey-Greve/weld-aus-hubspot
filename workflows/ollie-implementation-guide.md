# HubSpot Implementation Guide - Weld Australia
### For: Olivier Maennel (Refuel Creative)
### Last updated: 2026-05-22 | Hard deadline: 30 June 2026

> **This is your one-stop setup checklist.** It covers every HubSpot configuration item the frontend depends on - properties, pipelines, association labels, HubDB tables, private content, active lists, custom behavioural events, and workflows - in the order they should be built. Ryan's frontend reads the exact internal names listed here. Do not rename anything without a conversation first.
>
> Cross-reference: `CLAUDE.md` is the master project brief. This doc distils the CRM/backend layer so you don't have to dig through the full brief.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Deal Pipelines](#2-deal-pipelines)
3. [Custom Properties - Contact](#3-custom-properties--contact)
4. [Custom Properties - Company](#4-custom-properties--company)
5. [Custom Properties - Deal](#5-custom-properties--deal)
6. [Association Labels](#6-association-labels)
7. [HubDB Tables](#7-hubdb-tables)
8. [Private Content - Member Wall](#8-private-content--member-wall)
9. [Active Lists for Member Wall Gating](#9-active-lists-for-member-wall-gating)
10. [Custom Behavioural Events](#10-custom-behavioural-events)
11. [Workflows to Build](#11-workflows-to-build)
12. [Integrations](#12-integrations)
13. [Open Decisions & Blockers](#13-open-decisions--blockers)

---

## 1. Prerequisites

- **HubSpot portal ID:** 4538263
- **Tier:** HubSpot Professional (Marketing/Sales/Service/Operations Pro + Content Hub)
- **No native Custom Objects available on Pro** - the entire membership data model uses standard objects + HubDB + Association Labels (see §2-7).
- Ryan's frontend reads contact properties from `request_contact.*` in HubL and fires client-side events via `window._hsq`. Every internal property name below is a hard dependency - agree on any changes before they're committed.
- **Recommended build order:** Pipelines → Properties → Association Labels → HubDB → Private Content → Lists → Events → Workflows → Integrations.

---

## 2. Deal Pipelines

Create these four pipelines. Stage names are important - `current_certification_step` on Contact mirrors the Certification pipeline stage names exactly.

### 2.1 Membership Pipeline

| Stage | Description |
|---|---|
| New Enquiry | Initial interest captured |
| Application Received | Membership form submitted |
| Under Review | Manual review in progress |
| Approved - Awaiting Payment | Invoice issued |
| Closed Won | Membership active - triggers onboarding workflow |
| Closed Lost | Not proceeding |
| Renewal - Due | Upcoming renewal (auto-enrolled 60 days before expiry) |
| Renewal - Lapsed | Membership expired |

### 2.2 Training & Exams Pipeline

| Stage | Description |
|---|---|
| Session Enquiry | Pre-registration interest |
| Registered | Paid and confirmed |
| Attended | Post-session confirmation |
| Passed | Exam result recorded |
| Failed | Exam result recorded |
| Closed Won | Course + exam complete |
| Cancelled | Cancelled by member or Weld Australia |

### 2.3 Certification Pipeline

Stage names here are copied verbatim onto `current_certification_step` on the Contact record. The certification-guidance module on the dashboard uses these to look up guidance text from HubDB Table 4.

| Stage | Description |
|---|---|
| Application Submitted | Initial application received |
| Pre-requisites Review | Checking eligibility |
| Training Enrolment | Enrolled in required courses |
| Work Evidence Submission | Logbook / evidence under review |
| Examination Booked | Exam scheduled |
| Examination Complete | Awaiting result |
| Certification Issued | Closed Won - cert active |
| Renewal Due | Cert approaching expiry |
| Certification Lapsed | Expired |
| Application Withdrawn | Closed Lost |

### 2.4 BD / Engineering Pipeline

Standard Refuel template - no custom stages required for the frontend. Confirm with Nick.

---

## 3. Custom Properties - Contact

Create these in **Settings → Properties → Contact properties**. Group them as shown - separate groups prevent accidental overwrites when workflows update one certification without touching another.

### Group: Membership

| Internal name | Label | Type | Options |
|---|---|---|---|
| `contact_membership_status` | Membership status | Dropdown | Active, Grace Period, Lapsed, Never Member |
| `contact_membership_expiry` | Membership expiry date | Date | - |
| `contact_membership_tier` | Membership tier | Dropdown | Individual, Apprentice, Reciprocal, Industry Supplier, Corporate Bronze, Corporate Silver, Corporate Gold |

### Group: Training (next upcoming)

| Internal name | Label | Type |
|---|---|---|
| `next_upcoming_course_name` | Next course name | Single-line text |
| `next_upcoming_course_date` | Next course date | Date |
| `next_upcoming_course_location` | Next course location | Single-line text |

> These are synced from the most recent Closed Won Training Deal. Workflow: Deal Closed Won (Training) → copy `session_location`, `session_start_date`, `course_name` fields to these Contact properties.

### Group: Certification - AS1796

| Internal name | Label | Type |
|---|---|---|
| `as1796_status` | AS1796 status | Dropdown (Active, Lapsed, Expired, Not held) |
| `as1796_expiry` | AS1796 expiry date | Date |
| `as1796_certificate_url` | AS1796 certificate URL | Single-line text (URL) |
| `as1796_current_step` | AS1796 certification step | Single-line text (mirrors pipeline stage name) |

### Group: Certification - IIW Inspector

| Internal name | Label | Type |
|---|---|---|
| `iiw_status` | IIW Inspector status | Dropdown (Active, Lapsed, Expired, Not held) |
| `iiw_expiry` | IIW Inspector expiry date | Date |
| `iiw_certificate_url` | IIW Inspector certificate URL | Single-line text (URL) |
| `iiw_current_step` | IIW Inspector step | Single-line text |

### Group: Certification - ISO 3834 (Individual)

| Internal name | Label | Type |
|---|---|---|
| `iso3834_individual_status` | ISO 3834 (individual) status | Dropdown (Active, Lapsed, Expired, Not held) |
| `iso3834_individual_expiry` | ISO 3834 (individual) expiry date | Date |
| `iso3834_individual_certificate_url` | ISO 3834 (individual) certificate URL | Single-line text (URL) |
| `iso3834_individual_current_step` | ISO 3834 (individual) step | Single-line text |

### Group: Certification - AS2980

| Internal name | Label | Type |
|---|---|---|
| `as2980_status` | AS2980 status | Dropdown (Active, Lapsed, Expired, Not held) |
| `as2980_expiry` | AS2980 expiry date | Date |
| `as2980_certificate_url` | AS2980 certificate URL | Single-line text |
| `as2980_current_step` | AS2980 step | Single-line text |

> Add further certification groups following the same naming pattern as new cert types are confirmed with Weld Australia. Each group = one cert type.

### Computed / synced fields (read by `current_certification_step`)

The dashboard `certification-guidance` tile reads `current_certification_step` to show the active guidance prompt. Set this property on the Contact record via a workflow whenever the Certification Deal stage changes.

| Internal name | Label | Type |
|---|---|---|
| `current_certification_step` | Current certification step | Single-line text |

---

## 4. Custom Properties - Company

Create in **Settings → Properties → Company properties**.

### Group: Membership

| Internal name | Label | Type | Options |
|---|---|---|---|
| `company_membership_status` | Membership status | Dropdown | Active, Grace Period, Lapsed |
| `company_membership_expiry` | Membership expiry date | Date | - |
| `company_membership_tier` | Membership tier | Dropdown | Corporate Gold, Corporate Silver, Corporate Bronze, Industry Supplier, Reciprocal |

### Group: Training Vouchers

| Internal name | Label | Type | Notes |
|---|---|---|---|
| `vouchers_total` | Total training vouchers | Number | Set manually or via workflow on Membership Closed Won |
| `vouchers_used` | Vouchers used | Calculated | Count of associated Closed Won Training Deals |
| `vouchers_remaining` | Vouchers remaining | Calculated | `vouchers_total − vouchers_used` |

> The Corporate Admin React tile displays a live progress bar of `vouchers_used / vouchers_total`. Ryan reads `vouchers_remaining` as well. Ensure the calculated properties update promptly after a Training Deal closes.

### Group: Directory (HubDB sync)

| Internal name | Label | Type | Notes |
|---|---|---|---|
| `directory_blurb` | Directory blurb | Rich text | Synced into HubDB `members` table `company_blurb` column |
| `directory_logo_url` | Directory logo URL | Single-line text | Synced into HubDB `members` table `company_logo` column |

> These two fields are the source of truth. A workflow keeps the HubDB row in sync (see §11 - Workflows).

---

## 5. Custom Properties - Deal

Create in **Settings → Properties → Deal properties**.

| Internal name | Label | Type | Options |
|---|---|---|---|
| `deal_type` | Deal type | Dropdown | Training Course, Exam, Individual Certification, Company Certification, Event Ticket, Membership |
| `course_category` | Course category | Dropdown | Welding Inspection, Welding Supervision, Welder Certification, ISO Certification |
| `session_location` | Session location | Dropdown | Sydney, Melbourne, Brisbane, Perth, Adelaide, Darwin, Hobart, Online |
| `session_start_date` | Session start date | Date | - |
| `session_end_date` | Session end date | Date | - |
| `certification_expiry_date` | Certification expiry date | Date | - |
| `audit_due_date` | Audit due date | Date | - |
| `certification_type` | Certification type | Dropdown | AS1796, IIW Inspector, ISO 3834, AS2980 |
| `xero_invoice_pdf_url` | Xero invoice PDF URL | Single-line text | Populated by Xero sync (see §12) |

---

## 6. Association Labels

Create custom association labels in **Settings → Objects → Associations**.

### Company ↔ Contact

| Label (display) | Internal use |
|---|---|
| Primary Admin | Identifies the corporate account admin - gates the Corporate Admin tile on the dashboard and the `/portal/team` page. |
| Employee | Standard corporate member employee association. |
| Apprentice | Apprentice member linked to a company. |
| Reciprocal Member | Reciprocal membership association. |

### Company ↔ Company

| Label (display) | Internal use |
|---|---|
| Parent (Head Office) | Links a state office back to the national head company. |
| Child (State Office) | Links the head office to each state office. |

> **Why this matters for the frontend:** The Corporate Admin React island reads the `Primary Admin` association label to decide who can see the "Manage My Team" panel. Ryan's code does this server-side via `request_contact.associations` in HubL. If the label name is different from what's listed here, the panel will not appear.

---

## 7. HubDB Tables

Ryan will seed these tables via `pnpm seed:hubdb --env=sandbox` (script at `scripts/seed-hubdb.ts`) which reads the JSON schemas in `hubdb/*.json`. Your job is to ensure the tables exist in the portal with the correct column configuration before the seed runs. After initial seeding, Weld Australia content editors populate the rows.

**Portal ID:** 4538263 - navigate to **Content → HubDB** to manage tables.

### Table 1 - `courses`

Used by: Course Timetable Hub, Course Filter (React island), Dynamic Course Pages.

Enable **Dynamic Pages** on this table. URL pattern: `/courses/{course_slug}`.

| Column name | Type | Notes |
|---|---|---|
| `course_name` | Text | e.g. "AS1796 Cert 10" |
| `course_id` | Text | Groups sessions under one course page |
| `course_slug` | Text | URL slug for dynamic page |
| `parent_template` | Select | `standard`, `sales` |
| `city` | Select | Sydney, Melbourne, Brisbane, Perth, Adelaide, Darwin, Hobart, Online |
| `start_date` | Date | Session start |
| `end_date` | Date | Session end |
| `price_member` | Number | AUD ex GST |
| `price_non_member` | Number | AUD ex GST |
| `registration_url` | URL | event.hapily / Zoom link |
| `status` | Select | Available, Sold Out, Cancelled |
| `seats_remaining` | Number | Optional social proof |
| `meta_description` | Text | Dynamic page meta |
| `page_title` | Text | Dynamic page `<title>` |
| `og_image` | Image | Dynamic page OG image |

**Dynamic page SEO mapping:** set `DESCRIPTION → meta_description`, `TITLE → page_title`, `FEATURED_IMAGE_URL → og_image` in the table's dynamic page settings.

### Table 2 - `members`

Used by: Find a Member (React island), Logo Strip (member mode). Synced from Company CRM records.

Default sort: `is_active = true` → `member_tier` (Gold first) → `company_name` A→Z.

| Column name | Type | Notes |
|---|---|---|
| `company_name` | Text | |
| `member_tier` | Select | Gold, Silver, Bronze, Reciprocal, Industry Supplier |
| `company_logo` | Image | Synced from `directory_logo_url` Company property |
| `company_blurb` | Rich Text | Synced from `directory_blurb` Company property |
| `website_url` | URL | |
| `contact_email` | Text | |
| `state_operation` | Multi-select | NSW, VIC, QLD, WA, SA, TAS, NT, ACT, National |
| `is_active` | Boolean | Flipping to `false` removes the row from Find a Member on next page load |
| `hubspot_company_id` | Number | Backref to the CRM Company record - used by the sync workflow |

**No dynamic pages** on this table.

### Table 3 - `team_and_board`

Used by: Team Grid module on About page.

| Column name | Type | Notes |
|---|---|---|
| `name` | Text | |
| `role` | Text | e.g. "Chief Executive Officer" |
| `category` | Select | Executive, Board, Engineering, Training, Q&C |
| `headshot` | Image | |
| `bio` | Rich Text | |
| `display_order` | Number | Manual sort |
| `is_active` | Boolean | |

### Table 4 - `certification_guidance`

Used by: Certification Guidance (React island) on the member dashboard. Edited by Weld Australia Q&C team - no code changes needed when guidance text changes.

| Column name | Type | Notes |
|---|---|---|
| `certification_type` | Select | AS1796, IIW Inspector, ISO 3834, AS2980 |
| `step` | Text | Must match the Certification pipeline stage names exactly (§2.3) |
| `guidance_text` | Rich Text | Displayed to the member |
| `evidence_checklist` | Rich Text | Bullet list of required documents |

### Table 5 - `resources`

Used by: Resource Library (React island) on Resources Hub. Gating (`required_tier`) is evaluated server-side in HubL - never expose this logic to client-side JS.

| Column name | Type | Notes |
|---|---|---|
| `title` | Text | |
| `slug` | Text | URL slug (for future `/resources/{slug}` dynamic pages) |
| `abstract` | Rich Text | Summary shown in card |
| `file_url` | URL | PDF link, video URL, or external link |
| `file_type` | Select | pdf, video, link |
| `category` | Select | technical, standards, case_study, report, webinar, template, advocacy |
| `required_tier` | Select | public, member, bronze, silver, gold |
| `preview_image` | Image | Card thumbnail |
| `published_date` | Date | |
| `is_active` | Boolean | |

**Tier mapping** (for your reference - same logic the HubL module uses):

| `required_tier` | Who can access |
|---|---|
| `public` (or empty) | Everyone |
| `member` | Any active member |
| `bronze` | Corporate Bronze, Silver, or Gold |
| `silver` | Corporate Silver or Gold |
| `gold` | Corporate Gold only |

### Table 6 - `events`

Used by: Events Listing (React island) on Events page.

| Column name | Type | Notes |
|---|---|---|
| `slug` | Text | URL slug |
| `event_name` | Text | |
| `event_type` | Select | webinar, in_person, hybrid, awards |
| `event_date` | Date | |
| `event_end_date` | Date | |
| `event_state` | Select | NSW, VIC, QLD, WA, SA, TAS, NT, ACT, National |
| `event_location` | Text | Venue name / address |
| `event_description` | Rich Text | |
| `event_image` | Image | |
| `registration_url` | URL | event.hapily or external |
| `is_featured` | Boolean | Promotes to homepage |
| `is_members_only` | Boolean | Gated to active members |

### Table 7 - `jobs`

Used by: Job Board (React island).

| Column name | Type | Notes |
|---|---|---|
| `slug` | Text | URL slug |
| `job_title` | Text | |
| `company_name` | Text | |
| `job_type` | Select | full_time, part_time, contract, apprenticeship |
| `job_state` | Select | NSW, VIC, etc. |
| `job_location` | Text | |
| `job_description` | Rich Text | |
| `application_url` | URL | |
| `closing_date` | Date | |
| `date_posted` | Date | |
| `is_active` | Boolean | |
| `is_featured` | Boolean | |

### Table 8 - `state_offices`

Used by: footer and Contact Us page state office display.

| Column name | Type | Notes |
|---|---|---|
| `state` | Select | NSW, VIC, QLD, WA, SA, TAS, NT, ACT |
| `office_name` | Text | |
| `address` | Text | |
| `phone` | Text | |
| `email` | Text | |
| `manager_contact_id` | Number | HubSpot Contact ID of the office manager |

---

## 8. Private Content - Member Wall

In **Settings → Website → Private Content**, configure:

1. **Enable Private Content** on the portal domain.
2. **Login page:** `/login/` (maps to `login.html` template).
3. **Registration page:** Not applicable - accounts are provisioned by Weld Australia on membership approval, not self-registered. The login page footer copy clarifies this.
4. **Password reset page:** `/login/reset/` (maps to `reset.html` template).
5. **Post-login redirect:** `/portal/` (the Member Dashboard).

**Portal pages that must be gated** (apply Private Content to each page):

| URL | Audience list |
|---|---|
| `/portal/` (dashboard) | Active Members |
| `/portal/profile/` | Active Members |
| `/portal/team/` | Primary Admin (more restrictive list) |
| `/portal/certifications/` | Active Members |
| `/portal/courses/` | Active Members |
| `/portal/events/` | Active Members |
| `/portal/invoices/` | Active Members |
| `/portal/checkout/` | Active Members (or guest checkout - see module settings) |

**Note on Resources Hub (`/resources/`):** This page is public. Gating is applied per-resource-card at render time via HubL tier logic (§7 Table 5), not via Private Content. A non-member can see the page but locked resources show an upgrade overlay instead of a download button.

---

## 9. Active Lists for Member Wall Gating

Create these active lists in **CRM → Lists**. The Member Wall Private Content configuration references these lists.

### List: Active Members

**Filter logic:**

```
Contact property: contact_membership_status = "Active" OR "Grace Period"
AND
Contact property: contact_membership_expiry > Today

OR

Associated Company property: company_membership_status = "Active" OR "Grace Period"
AND
Associated Company property: company_membership_expiry > Today
```

### List: Corporate Gold Members

```
Contact property: contact_membership_tier = "Corporate Gold"
AND
contact_membership_status = "Active"
```

### List: Corporate Silver Members

```
Contact property: contact_membership_tier = "Corporate Silver"
AND
contact_membership_status = "Active"
```

### List: Primary Admins

```
Contact has association label: "Primary Admin" (Company ↔ Contact)
AND
contact_membership_status = "Active" OR company_membership_status = "Active"
(via associated company)
```

> The Corporate Admin tile on the dashboard is conditionally rendered in HubL based on whether the logged-in contact is in the Primary Admin list. Ryan does this via `request_contact.list_memberships` - confirm the list ID once created and share with Ryan so he can hardcode the check (HubSpot does not expose list names in `request_contact`).

### List: Lapsed Members (for re-engagement)

```
Contact property: contact_membership_status = "Lapsed"
```

---

## 10. Custom Behavioural Events

Create these in **Settings → Tracking & Analytics → Events → Custom Behavioural Events**.

Events are fired from the browser via `window._hsq` (the HubSpot tracking queue). They appear on the contact's Activity timeline. All property values are sent as strings.

> **Full developer reference** (including workflow trigger suggestions): `workflows/behavioural-events.md` in the repo.

---

### Event 1 - `resource_downloaded`

**Fired when:** a user clicks Download on an unlocked resource card.

**Create the event with internal name:** `resource_downloaded`

**Properties to add (all type: Text):**

| Property internal name | Description | Example |
|---|---|---|
| `resource_id` | HubDB row ID (`hs_id`) | `"42"` |
| `resource_title` | Resource title | `"AS/NZS 1665:2022 Summary Guide"` |
| `member_tier_at_download` | `contact_membership_tier` at click time, or `"anonymous"` | `"Corporate Gold"` |
| `file_type` | `pdf`, `video`, or `link` | `"pdf"` |

**Suggested workflows to wire:**

| Trigger | Action |
|---|---|
| `resource_downloaded` + `member_tier_at_download = "anonymous"` | Enrol in "Join Weld Australia" nurture email sequence |
| `resource_downloaded` | +5 to Contact Score calculated property |
| `resource_downloaded` + `member_tier_at_download != "anonymous"` | Increment a download count property on the Contact |

---

### Event 2 - `resource_locked_view`

**Fired when:** a locked resource card enters the viewport (once per card per page load).

**Create the event with internal name:** `resource_locked_view`

**Properties to add (all type: Text):**

| Property internal name | Description | Example |
|---|---|---|
| `resource_id` | HubDB row ID of the locked resource | `"17"` |
| `category` | Resource category slug | `"standards"` |

**Suggested workflows:**

| Trigger | Action |
|---|---|
| `resource_locked_view` fired ≥ 3 times in 7 days | Send "Unlock all resources" upgrade email |

---

### Event 3 - `member_discount_applied`

**Fired when:** a logged-in member reaches Step 3 of the Checkout Tunnel and a member discount is shown.

**Create the event with internal name:** `member_discount_applied`

**Properties to add (all type: Text):**

| Property internal name | Description | Example |
|---|---|---|
| `session_id` | HubDB course session ID | `"course-123-syd-aug"` |
| `course_name` | Course title | `"AS1796 Cert 10"` |
| `member_tier` | Contact's membership tier | `"Corporate Silver"` |
| `discount_amount` | Discount in AUD (string) | `"150.00"` |

---

### Event 4 - `corporate_bulk_registration`

**Fired when:** a Corporate Admin submits the Bulk Register form in the Manage My Team panel. (Module not yet built - create the event now so it's ready.)

**Create the event with internal name:** `corporate_bulk_registration`

**Properties to add (all type: Text):**

| Property internal name | Description | Example |
|---|---|---|
| `company_id` | HubSpot Company ID | `"987654321"` |
| `session_id` | HubDB course session ID | `"course-456-mel-sep"` |
| `registrant_count` | Number of employees registered | `"5"` |

---

## 11. Workflows to Build

These are the key workflows the frontend depends on. Build them in the order listed - later workflows depend on properties populated by earlier ones.

### WF-01 - Membership Closed Won → Activate Contact

**Trigger:** Deal pipeline = Membership, stage moves to Closed Won.

**Actions:**
1. Set `contact_membership_status = "Active"` on associated Contact.
2. Set `contact_membership_expiry` = (deal close date + 1 year) on Contact.
3. Set `contact_membership_tier` from Deal's associated Company tier (or direct Contact tier for Individual/Apprentice members).
4. Enrol Contact in "Welcome to Weld Australia" email sequence.
5. If Company deal: set `company_membership_status = "Active"`, `company_membership_expiry`, `company_membership_tier`.
6. Set `vouchers_total` on Company based on tier (Corporate Gold = 10, Silver = 5, Bronze = 2 - confirm values with Weld Australia).

### WF-02 - Membership Expiry - Grace Period

**Trigger:** Contact property `contact_membership_expiry` = Today.

**Actions:**
1. Set `contact_membership_status = "Grace Period"`.
2. Send "Your membership has expired" email with renewal CTA.
3. If Corporate: mirror on associated Company record.

### WF-03 - Membership Expiry - Lapsed (14 days after grace)

**Trigger:** Contact property `contact_membership_expiry` = 14 days ago AND `contact_membership_status = "Grace Period"`.

**Actions:**
1. Set `contact_membership_status = "Lapsed"`.
2. Set `is_active = false` on the associated HubDB `members` table row (via HubDB API - may need custom code action or middleware; confirm feasibility).
3. If Corporate: mirror on Company.
4. Enrol in lapsed member re-engagement sequence.

> **Note:** Toggling `is_active` on HubDB Table 2 (`members`) is not natively supported by standard workflow actions. You may need a custom coded action (JavaScript in workflow) or a Zapier/Make step. Discuss with Ryan.

### WF-04 - Membership Renewal - 60-day Reminder

**Trigger:** Contact property `contact_membership_expiry` = 60 days from now.

**Actions:**
1. Send "Renew your membership" email.
2. Create a Renewal Deal in the Membership pipeline (stage = Renewal Due) associated to the Contact.

### WF-05 - Training Deal Closed Won → Update Contact

**Trigger:** Deal pipeline = Training & Exams, stage moves to Closed Won.

**Actions:**
1. Copy Deal's `session_location` → Contact `next_upcoming_course_location`.
2. Copy Deal's `session_start_date` → Contact `next_upcoming_course_date`.
3. Copy Deal's `deal_name` → Contact `next_upcoming_course_name`.
4. Increment Company `vouchers_used` by 1 (if this Deal is associated to a Company).

### WF-06 - Certification Stage Change → Update Contact

**Trigger:** Deal pipeline = Certification, stage changes to any stage.

**Actions:**
1. Copy new stage name → Contact `current_certification_step`.
2. If stage = Certification Issued:
   - Set the appropriate cert status property to "Active" (e.g. `as1796_status = "Active"`).
   - Set cert expiry from Deal's `certification_expiry_date`.
3. Trigger "Smart Alerts" check: if `current_certification_step` contains "Expiry" → set a flag for the dashboard.

### WF-07 - Directory Sync: Company → HubDB `members` table

**Trigger:** Company properties `directory_blurb` or `directory_logo_url` are updated, OR `company_membership_status` changes.

**Actions:**
1. Use a custom coded action to call the HubDB API and update the matching row in the `members` table where `hubspot_company_id = [Company ID]`.
2. If `company_membership_status = "Lapsed"`, set `is_active = false` on the HubDB row.
3. If newly Active, set `is_active = true` and update `member_tier` to match `company_membership_tier`.

> This workflow ensures the Find a Member directory reflects membership status changes within the session (HubDB has a short cache TTL).

### WF-08 - Smart Alerts: Certification Expiry Warning

**Trigger:** Contact property `as1796_expiry` (or other cert expiry) = 30 days from now.

**Actions:**
1. Set a transient flag property (e.g. `cert_expiry_alert = "true"`) on Contact.
2. Send email: "Your AS1796 certification expires in 30 days."

The Member Dashboard `SmartAlerts` tile reads this flag and renders a banner.

### WF-09 - Xero Invoice URL Sync (pending decision - see §13)

**Trigger:** Deal property `xero_invoice_pdf_url` is set/updated.

**Actions:**
1. Confirm URL is populated.
2. The Member Dashboard `InvoicesAndReceipts` tile reads this property directly - no further action needed from the frontend perspective. Ensure the Xero integration populates this field; if it does not, the tile displays "Receipt processing - check back shortly."

---

## 12. Integrations

### 12.1 Xero

**Decision pending** (see §13 - Q2). Two paths:

- **Path A (native integration):** Every invoiced person exists as a Xero Contact. Straightforward, clutters Xero. Native HubSpot-Xero integration populates `xero_invoice_pdf_url` on the Deal.
- **Path B (middleware):** Custom API service intercepts Closed Won Deals, posts to Xero against a generic contact, syncs the PDF URL back to HubSpot Deal `xero_invoice_pdf_url`.

**Frontend impact:** none - both paths populate the same property. The Member Dashboard receipt tile always reads `xero_invoice_pdf_url` and degrades gracefully if empty.

### 12.2 event.hapily + Zoom

1. Install the `event.hapily` app in the HubSpot App Marketplace (portal 4538263).
2. Configure event.hapily to create a Deal in the Training & Exams pipeline when a registration is completed.
3. Zoom join links should be written to the Contact record (confirm field name with event.hapily docs; Ryan will update the Registered Events tile to read it).
4. `registration_url` values in HubDB Table 1 (`courses`) should point to event.hapily-hosted checkout pages for standard registrations, or to the Weld Australia `/checkout/` tunnel for custom flows - confirm with Ryan which courses use which.

### 12.3 Google Tag Manager / GA4

**GTM container:** install via **Settings → Tracking & Analytics → Tracking Code** - add the GTM container ID as an additional script, or embed in the theme's `<head>` partial. Ryan handles this in `theme/templates/partials/_head.html`.

**Custom events that also fire to GA4** (handled client-side - no HubSpot action needed; listed for awareness):

| GA4 event name | HubSpot equivalent |
|---|---|
| `resource_download` | `resource_downloaded` |
| `resource_locked_view` | `resource_locked_view` |
| `member_discount_applied` | `member_discount_applied` |
| `corporate_bulk_registration` | `corporate_bulk_registration` |

---

## 13. Open Decisions & Blockers

These items are unresolved as of 2026-05-22. Do not start any downstream work blocked by them until resolved.

| # | Issue | Owner | Impact if unresolved |
|---|---|---|---|
| Q1 | **Xero sync model** - generic Xero contact (middleware) vs per-student contact (native)? | Weld Aus Finance via Danielle | WF-09 design; no frontend impact but middleware scope could affect timeline |
| Q2 | **Brand kit** - do Weld Aus brand guidelines exist, or do we extract tokens from the live site? | Danielle | Theme tokens; Ryan needs this before theming |
| Q3 | **Property mapping sheet** - Ollie's CRM property internal names must be confirmed with Ryan before any module that reads them is finalised | Ollie + Ryan | Dashboard, profile, and cert tiles break if names differ |
| Q4 | **Primary Admin list ID** - HubSpot doesn't expose list names in `request_contact.list_memberships`; Ryan needs the numeric list ID after the list is created | Ollie → Ryan | Corporate Admin tile doesn't appear for admins |
| Q5 | **HubDB `is_active` toggle via workflow** - does a standard workflow action support HubDB row updates, or do we need a custom coded action? | Ollie to confirm | Affects WF-03 and WF-07; if custom code needed, scope accordingly |
| Q6 | **Vouchers total per tier** - how many training session vouchers does each Corporate tier receive? | Weld Australia (via Danielle) | WF-01 cannot set `vouchers_total` without confirmed values |
| Q7 | **Payment processor for checkout** - Stripe via event.hapily or direct Stripe? | Ollie | Checkout Tunnel module config; affects `stripe_publishable_key` field |
| Q8 | **Event.hapily Zoom field name** - what property does event.hapily write the Zoom join URL to on the Contact? | Ollie (check hapily docs) | Registered Events tile on dashboard |
| R1 | **30 June deadline is hard** - CAMS/Dynamics decommission is contractual. All portal pages must be live by 13 June (17 days QA buffer). | Ryan + Nick | No buffer for scope creep |

---

*Generated from `CLAUDE.md`, `docs/02-module-catalog.md`, `hubdb/*.json`, and `workflows/behavioural-events.md`. Update this document whenever a decision in §13 is resolved.*
