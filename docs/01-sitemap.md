# Weld Australia - Sitemap & Information Architecture

> Companion to `CLAUDE.md`. This file lists every page in scope for the Phase 1 launchpad, the URL pattern, the navigation it lives under, the content blocks/sections that compose it, and which custom modules from `docs/02-module-catalog.md` it uses.

---

## 1. Global Navigation

### 1.1 Primary nav (header)

```
About ▾                    Membership ▾              Training ▾                Certification ▾           Resources ▾              Find a Member        [Member Login]
  ├ About Weld Australia     ├ Why Become a Member     ├ Training Hub            ├ Certification Hub       ├ Resources Hub           (direct link)         (CTA button)
  ├ Team & Board             ├ Membership Tiers        ├ Course Timetable Hub    ├ Individual Cert         ├ Job Board                                     (logged in: avatar)
  ├ Advocacy                 ├ Corporate Membership    ├ Welding Inspection      ├ Company Cert (ISO 3834) ├ Events
  ├ Engineering Services     └ Apprentice Membership   ├ Welding Supervision     └ Cert Pathways           ├ News & Publications (Blog)
  └ Technology                                         ├ Welding Coordination                              └ Industry Standards
                                                       ├ Short Courses
                                                       ├ IIW Inspector
                                                       └ AS1796 Cert 10
```

### 1.2 Utility nav (top bar, above primary)

`Contact Us  •  Office Login (staff)  •  ☎ 1800 ...  •  📧 office@weldaustralia.com.au`

### 1.3 Footer nav

Four columns:

1. **About** - About Weld Australia, Team & Board, Advocacy, Annual Report
2. **Membership** - Why Become a Member, Tiers, Apprentice, Corporate, Member Wall (Log In)
3. **Training & Certification** - Training Hub, Course Timetable, Certification Hub, Find a Member, IIW Inspector, AS1796 Cert 10
4. **Resources & Contact** - Resources Hub, News & Publications, Job Board, Events, Contact Us, Newsletter signup

Plus footer base row: Copyright, ABN, Privacy Policy, Terms, Acknowledgement of Country, social icons (LinkedIn, YouTube, Facebook, X).

### 1.4 Member portal sub-nav (visible only when logged in, after primary nav)

```
Dashboard  •  My Profile  •  My Certifications  •  My Courses & Events  •  My Invoices  •  Manage My Team*  •  Log Out
                                                                                              (* admins only)
```

---

## 2. URL Map (full)

### Public

| URL | Template | Source data |
|---|---|---|
| `/` | `home.html` | HubL + page editor |
| `/about/` | `about.html` | Page editor + HubDB Table 3 (team) |
| `/about/advocacy/` | `advocacy.html` | Page editor |
| `/about/team/` | `about-team.html` | HubDB Table 3 (dynamic page parent) |
| `/about/team/{person-name}` | `about-team.html` (dynamic detail) | HubDB Table 3 row |
| `/about/engineering-services/` | `engineering.html` | Page editor |
| `/contact-us/` | `contact.html` | HubSpot form |
| `/membership/` | `membership.html` | Page editor |
| `/membership/corporate/` | `membership-corporate.html` | Page editor |
| `/membership/apprentice/` | `membership-apprentice.html` | Page editor |
| `/training/` | `training-hub.html` | Page editor. No course listing - links out to `/courses` (QA 106) |
| `/training/welding-inspection-courses/` | `training-category.html` | HubDB Table 1 filtered by training division. **Not yet created in HubSpot** - nothing links here; division links go to `/courses?category=<slug>#all-courses` (QA 226/227) |
| `/training/welding-supervision-courses/` | `training-category.html` | HubDB Table 1 |
| `/training/welding-coordination-courses/` | `training-category.html` | HubDB Table 1 |
| `/training/short-courses/` | `training-category.html` | HubDB Table 1 |
| `/courses/` | `course-timetable-hub.html` | HubDB Table 1 (all sessions) |
| `/courses/{course_slug}` | `course.html` (or `course-sales.html` for IIW + AS1796) | HubDB Table 1 dynamic page |
| `/certification/` | `certification.html` | Page editor |
| `/certification/individual/` | `certification-individual.html` | Page editor |
| `/certification/iso-3834/` | `certification-iso3834.html` | Page editor |
| `/resources/` | `resources.html` | HubDB Table 5 (resources) - gated |
| `/resources/{slug}` | `resource-detail.html` (HubDB dynamic) | HubDB Table 5 |
| `/news/` | `blog.html` (HubSpot blog) | HubSpot blog |
| `/news/{post_slug}` | `blog-post.html` | HubSpot blog |
| `/jobs/` | `jobs.html` | HubDB Table 6 (jobs) |
| `/jobs/{slug}` | `job-detail.html` | HubDB Table 6 |
| `/events/` | `events.html` | HubDB Table 7 (events) |
| `/events/{slug}` | `event-detail.html` | HubDB Table 7 |
| `/find-a-member/` | `find-a-member.html` | HubDB Table 2 |
| `/technology/` | `technology.html` | Page editor |
| `/technology/simulators/` | `technology.html` (anchor) | Page editor |
| `/technology/cobots/` | `technology.html` (anchor) | Page editor |
| `/technology/xiris-cameras/` | `technology.html` (anchor) | Page editor |

### Member portal (gated by HubSpot Private Content)

| URL | Template | Source data |
|---|---|---|
| `/login/` | `login.html` | HubSpot Membership |
| `/login/reset/` | `reset.html` | HubSpot Membership |
| `/portal/` | `dashboard.html` | Contact + associated Deals + HubDB |
| `/portal/profile/` | `profile.html` | Contact properties + Subscription Preferences |
| `/portal/certifications/` | `certifications-list.html` | Contact property groups |
| `/portal/certifications/{type}/` | `certification-guidance.html` | HubDB Table 4 + contact `current_certification_step` |
| `/portal/courses/` | `my-courses.html` | Contact's Won Training Deals |
| `/portal/events/` | `my-events.html` | Contact's Event Ticket Deals |
| `/portal/invoices/` | `my-invoices.html` | Contact's Deals with `xero_invoice_pdf_url` |
| `/portal/team/` | `team.html` | Company + child Companies + employee Contacts |
| `/checkout/` | `checkout.html` | `?session_id=` query, HubDB Table 1 |
| `/checkout/confirmation/` | `checkout-confirmation.html` | Created Deal |

### System

| URL | Template | Notes |
|---|---|---|
| `/404` | `error-404.html` | Themed 404 |
| `/500` | `error-500.html` | Themed 500 |
| `/search` | `search.html` | HubSpot site search |

---

## 3. Page-by-Page Content Blocks

For each page below:
- **Sections** = the vertical content blocks the page is composed of, top to bottom.
- **Modules used** = references into `docs/02-module-catalog.md`.

### 3.1 Home (`home.html`)

Sections:
1. **Hero** - full-bleed image, headline, sub-headline, primary CTA (Become a Member), secondary CTA (Find Training).
2. **Trust strip** - small horizontal logo bar of major partner/member logos (sourced from HubDB Table 2 Gold members).
3. **Three-up value props** - Membership / Training / Certification - short copy, icon, "Learn more" CTA.
4. **Featured courses** - three featured upcoming sessions from HubDB Table 1 with cards (date, location, member price).
5. **Resources teaser** - two latest gated resources from HubDB Table 5 with locked-state preview.
6. **Find a Member promo** - banner with directory CTA.
7. **News & insights** - three latest blog posts.
8. **Member testimonials** - rotating quote slider.
9. **Final CTA** - full-width "Join Weld Australia" with Membership and Contact links.

Modules used: `hero`, `logo-strip`, `value-props-3up`, `featured-courses`, `resource-teaser`, `cta-banner`, `blog-listing`, `testimonial-slider`, `cta-banner` (footer).

### 3.2 About (`about.html`)

Sections:
1. **Hero (compact)** - page title, intro paragraph.
2. **Our mission** - two-column rich text with image.
3. **Our history** - timeline (years + milestones).
4. **By the numbers** - stat tiles (members, certifications issued, courses delivered, years in operation).
5. **Team & Board** - `board-grid` (rows flagged `is_board_member`) and `team-grid` (everything outside category Board), both driven by HubDB Table 3 and filterable by category (Executive / Board / Engineering / Training / Q&C). Every card links to that person's profile page at `/about/team/{person-name}`.
6. **Advocacy CTA** - link to `/about/advocacy/`.
7. **Final CTA** - Become a Member.

Modules used: `hero`, `two-col-text-image`, `timeline`, `stat-tiles`, `team-grid`, `cta-banner`.

### 3.3 Contact Us (`contact.html`)

Sections:
1. **Hero (compact)** - title, intro.
2. **Contact methods grid** - phone / email / postal address per state office, sourced from HubDB Table 8 (offices) or page editor.
3. **Contact form** - HubSpot form embed (form GUID configurable per page).
4. **Map** - embedded Google Map of head office.

Modules used: `hero`, `contact-methods-grid`, `hubspot-form-embed`, `google-map-embed`.

### 3.4 Resources Hub (`resources.html`)

Sections:
1. **Hero with search** - page title, intro, prominent search input that wires into the React filter.
2. **Resource library** - `resource-library` React island; faceted by category, tier required, file type.
3. **Become a Member promo** - context-aware banner that only renders if current visitor is not an active member.

Modules used: `hero-with-search`, `resource-library`, `cta-banner-conditional`.

### 3.5 Membership (`membership.html`)

Sections:
1. **Hero** - value-led headline, "Join now" CTA.
2. **Why become a member** - three-up benefits.
3. **Tier comparison table** - `tier-comparison` module with Individual / Apprentice / Corporate Bronze / Silver / Gold columns and ✓/✗ rows for benefits. Mobile collapses each tier to a card.
4. **How membership works** - three-step "Apply / Pay / Activate" flow.
5. **Member testimonials** - slider.
6. **FAQ accordion** - `faq-accordion` module.
7. **Final CTA** - Become a Member.

Modules used: `hero`, `value-props-3up`, `tier-comparison`, `three-step`, `testimonial-slider`, `faq-accordion`, `cta-banner`.

### 3.6 Training Hub (`training-hub.html`)

Sections:
1. **Hero** - title, intro, search jump to course timetable.
2. **Training categories** - four division cards (Welding Inspection / Welding Supervision / Welding Coordination / Short Courses), each linking to its `/training/<division>-courses/` page.
3. **Featured courses** - module showing IIW Inspector + AS1796 Cert 10 prominently.
4. **Course timetable embed** - compact list of next 10 upcoming sessions across all courses, with "View full timetable" CTA.
5. **Why train with Weld Australia** - three-up value props.
6. **Corporate training CTA** - banner targeted at company decision-makers.

Modules used: `hero`, `category-cards-3up`, `featured-courses`, `course-timetable-compact`, `value-props-3up`, `cta-banner`.

### 3.7 Course Timetable Hub (`/courses/`)

Sections:
1. **Hero (compact)** - title, intro, followed by a "View by category" card row linking to the four division pages.
2. **Filter bar** - `course-timetable-filter` React island with filters: Category, City, Date range, Member price toggle.
3. **Sessions table/grid** - full HubDB Table 1 list, paginated. Mobile: cards.
4. **EOI fallback** - if filters return empty, show the EOI form.

Modules used: `hero`, `courses-proof-cards`, `card-grid` (view by category), `featured-courses`, `courses-upcoming-sessions`, `courses-membership-cards`.

### 3.8 Consolidated Course Page - Standard (`course.html`)

Dynamic page driven by HubDB Table 1 via `course_slug`.

Sections:
1. **Hero** - course title (from `course_name`), short description, badges (duration, level, accreditation).
2. **Course overview** - rich text (parent course copy from HubDB row or page editor).
3. **Learning outcomes** - bullet list.
4. **Who this course is for** - short audience description.
5. **Session selector** - `course-filter` React island (city dropdown → dates + prices + Register CTA, falls back to EOI form).
6. **Pricing panel** - `pricing-table` module showing Member vs Non-Member, member discount highlighted.
7. **Syllabus / modules** - accordion of sub-topics.
8. **Trainer profiles** - small cards for trainers (sourced from HubDB Table 3 by category=Training).
9. **Trust signals** - 3 testimonials + accreditation logos.
10. **FAQ accordion**.
11. **Related courses** - three-up cards.
12. **Final CTA** - Register / Express Interest.

Modules used: `hero`, `rich-text`, `bullet-list`, `course-filter`, `pricing-table`, `accordion`, `team-grid` (filtered), `testimonial-slider`, `logo-strip`, `faq-accordion`, `featured-courses`, `cta-banner`.

### 3.9 Consolidated Course Page - High-Polish Sales (`course-sales.html`)

Same dynamic data source as `course.html`, used only for IIW International Welding Inspector + AS1796 Cert 10. Long-form layout:

Sections:
1. **Sticky sub-nav** - anchor links: Overview / Outcomes / Pricing / Sessions / FAQ / Apply.
2. **Hero with video** - large headline, sub, trust badge row, embedded video.
3. **Stat strip** - "X graduates / Y years running / Z% pass rate".
4. **The opportunity** - long-form rich text (problem / solution).
5. **Course outcomes** - icon list with rich descriptions (10-14 outcomes).
6. **Detailed syllabus** - multi-week breakdown, expandable.
7. **Who this is for** - persona cards.
8. **Trainer spotlight** - large profile + bio + credentials.
9. **Pricing panel** - Member vs Non-Member, instalment options if any, payment plan.
10. **Session selector** - `course-filter` React island.
11. **Trust signals** - quote testimonials, accreditation logos, alumni outcomes.
12. **FAQ accordion** - extensive.
13. **Final CTA panel** - Apply now + "Talk to us" secondary.

Modules used: `sticky-sub-nav`, `hero-video`, `stat-strip`, `rich-text-long`, `icon-list`, `accordion`, `persona-cards`, `trainer-spotlight`, `pricing-table`, `course-filter`, `testimonial-slider`, `logo-strip`, `faq-accordion`, `cta-panel`.

### 3.10 Certification (`certification.html`)

Sections:
1. **Hero** - title, intro.
2. **Why get certified** - three-up benefits.
3. **Certification pathways** - `cert-pathway-cards` module, links to Individual + ISO 3834 + others.
4. **Process overview** - "Apply / Evidence / Audit / Certified" four-step.
5. **Find a Member promo** - directory CTA (certified members appear here).
6. **FAQ**.

Modules used: `hero`, `value-props-3up`, `cert-pathway-cards`, `step-process`, `cta-banner`, `faq-accordion`.

### 3.11 Advocacy (`advocacy.html`)

Sections:
1. **Hero** - bold positional statement.
2. **Position statements** - accordion of policy areas.
3. **Submissions & reports** - list of downloadable documents (HubDB Table 5 filtered to category=Advocacy).
4. **In the news** - links to media coverage.
5. **Subscribe to advocacy updates** - granular subscription form.

Modules used: `hero`, `accordion`, `document-list`, `news-mention-list`, `subscription-form`.

### 3.12 Engineering Services (`engineering.html`)

Sections:
1. **Hero** - service-led headline, "Request a quote" CTA.
2. **Services we provide** - three- or four-up service cards.
3. **Industries we serve** - logo strip.
4. **Project case studies** - three-up case study cards.
5. **Contact form** - engineering inquiry form (form GUID configurable).

Modules used: `hero`, `service-cards`, `logo-strip`, `case-study-cards`, `hubspot-form-embed`.

### 3.13 Technology (`technology.html`)

Sections:
1. **Hero** - title, intro.
2. **Anchored sub-sections** for Simulators / Cobots / Xiris Cameras, each with image, copy, "Request demo" CTA.
3. **Camera booking promo** - banner linking to camera booking workflow ("Book a camera trial").
4. **Contact form**.

Modules used: `hero`, `feature-section` (×3, anchored), `cta-banner`, `hubspot-form-embed`.

### 3.14 Find a Member (`find-a-member.html`)

Sections:
1. **Hero with search** - title, intro, prominent search input.
2. **Filter bar** - Tier / State / Search.
3. **Directory grid** - `find-a-member` React island. Tier-prioritised cards.
4. **Become a member** - banner.

Modules used: `hero-with-search`, `find-a-member`, `cta-banner`.

### 3.15 Events (`events.html`)

Sections:
1. **Hero** - title, intro.
2. **Filter bar** - State / Date / Type.
3. **Events list** - `events-listing` React island reading HubDB Table 7.
4. **Subscribe to events updates** - form.

Modules used: `hero`, `events-listing`, `subscription-form`.

### 3.16 Job Board (`jobs.html`)

Sections:
1. **Hero** - title, intro, "Post a job" CTA for members.
2. **Filter bar** - State / Type (Full-time, Part-time, Contract) / Category.
3. **Jobs list** - `jobs-listing` React island reading HubDB Table 6.
4. **Become a member to post jobs** - context-aware CTA.

Modules used: `hero`, `jobs-listing`, `cta-banner-conditional`.

### 3.17 Blog (`blog.html`, `blog-post.html`)

Standard HubSpot blog templates, themed. Listing has filter chips for tag (Advocacy / Technical / Industry / Member News). Post template includes related posts, author bio, share buttons.

Modules used: `blog-listing`, `blog-post-body`, `author-bio`, `share-buttons`.

---

## 4. Member Portal Page-by-Page

### 4.1 Login (`login.html`)

Sections:
1. Brand panel left (logo, value statement, "Become a member" link).
2. Login form right (email + password + "Forgot password?" link + login CTA).
3. Footer microcopy: "This is your Weld Australia member portal login. WeldQ, Moodle and ISO 3834 logins remain separate." (No SSO promise in Phase 1.)

Modules used: `auth-split-layout`, `hubspot-membership-login`.

### 4.2 Password Reset (`reset.html`)

Two states (HubSpot Membership flow):
1. Request reset - email input + submit.
2. Success state - "Check your email" + resend link.

Modules used: `auth-split-layout`, `hubspot-membership-reset`.

### 4.3 Member Dashboard (`dashboard.html`)

Sections (all tiles in `member-dashboard` React app):
1. **Welcome banner** - "Hi {firstname}", tier badge, expiry countdown if <60 days.
2. **Smart alerts** - toast strip (cert expiring, missing exam, lapsed renewal warning).
3. **Profile switcher** - only if multiple associations.
4. **Membership status tile** - status, tier, expiry, Renew CTA.
5. **My certifications tile** - list per certification type with status + Download Certificate + "Next step" guidance.
6. **Upcoming courses tile** - next session(s) registered, location, calendar add.
7. **Registered events tile** - upcoming events with Zoom links if applicable.
8. **Invoices & receipts tile** - last 5 invoices with PDF download.
9. **Geo-localised events tile** - upcoming events in member's state, with National Toggle.
10. **Corporate admin entry tile** - only if Primary Admin label, links to `/portal/team/`.
11. **Resources for you tile** - three personalised resources from HubDB Table 5.

Modules used: `member-dashboard` (React; composed of tile sub-components - see `docs/02-module-catalog.md` for the editor-facing field set that controls tile order, visibility, and copy).

### 4.4 My Profile (`profile.html`)

Sections:
1. **Avatar + name** + tier badge.
2. **Personal details form** - name, email, phone, postal address, employer, job title.
3. **Communications preferences** - granular subscription toggles (Advocacy / Training / Membership / Events / Newsletter).
4. **Password change** (HubSpot Membership reset link).
5. **Linked associations** - list of companies the contact is associated with + role label, read-only with "Request change" link.

Modules used: `profile-form`, `subscription-preferences`, `linked-associations`.

### 4.5 My Certifications (`certifications-list.html`, `certification-guidance.html`)

Listing:
1. Header + intro.
2. Cards per certification (status, expiry, certificate download, "View progress" → guidance page).

Detail (per certification type):
1. Header with certification type + current step badge.
2. **Step-by-step progress** - visual progress bar of pipeline stages.
3. **What's required next** - guidance text from HubDB Table 4 + evidence checklist.
4. **Upload evidence** - form (HubSpot form, file upload).
5. **Contact Q&C** - direct contact details.

Modules used: `certifications-list`, `certification-guidance`, `progress-bar`, `evidence-upload-form`.

### 4.6 My Courses & Events (`my-courses.html`, `my-events.html`)

Sections:
1. **Tab switcher** - Courses / Events.
2. **Upcoming list** - cards with date, location, "Add to calendar", join link if Zoom.
3. **Past list** - completed courses with completion certificate download.

Modules used: `tab-switcher`, `course-card-list`, `event-card-list`.

### 4.7 My Invoices (`my-invoices.html`)

Sections:
1. **Filter bar** - date range / type (Membership / Training / Event).
2. **Invoice list** - table on desktop, cards on mobile, with Download PDF.
3. **"Receipt missing?" help** - small contact link to finance.

Modules used: `invoice-list`.

### 4.8 Manage My Team (`team.html`)

Visible to Primary Admin only. Sections:
1. **Company hierarchy** - tree view of parent + child companies.
2. **Voucher tracker** - visual progress bar, vouchers used / total / remaining.
3. **Employee list** - searchable, sortable table with bulk select.
4. **Add employee** - modal form.
5. **Bulk register** - modal flow that picks a session and creates Deals for selected employees.
6. **Activity log** - recent actions (employee added/removed, bulk registration completed).

Modules used: `corporate-admin` (React).

### 4.9 Checkout (`checkout.html`, `checkout-confirmation.html`)

Sections (steps in `checkout-tunnel` React app):
1. Step indicator (1 of 4).
2. Confirm session.
3. Identify (logged in: skip; logged out: lookup or guest).
4. Discount preview.
5. Payment.
6. Confirmation page: receipt summary, Zoom join link if applicable, calendar download, "Back to dashboard" CTA.

Modules used: `checkout-tunnel`, `checkout-confirmation`.

---

## 5. HubDB Tables Referenced (summary)

| # | Table | Used by pages |
|---|---|---|
| 1 | `courses` | `/courses/`, `/courses/{slug}`, `/training/*`, home featured, dashboard upcoming |
| 2 | `members` | `/find-a-member/`, home logo strip |
| 3 | `team_and_board` | `/about/`, `/about/team/`, `/about/team/{person-name}`, course pages (trainer profiles) |
| 4 | `certification_guidance` | `/portal/certifications/{type}/`, dashboard guidance |
| 5 | `resources` | `/resources/`, `/resources/{slug}`, dashboard "Resources for you", advocacy submissions |
| 6 | `jobs` | `/jobs/`, `/jobs/{slug}` |
| 7 | `events` | `/events/`, `/events/{slug}`, dashboard geo-localised tile |
| 8 | `state_offices` | `/contact-us/` |

> Tables 5-8 are added beyond the masterplan's three - required by pages we're shipping. Confirm column schemas in `docs/02-module-catalog.md` before seeding.

---

## 6. Page Ownership / Editorial Workflow

Each page template will support content editing via standard HubSpot drag-and-drop with the modules in `docs/02-module-catalog.md`. **Every section listed above is a HubL module with editor-configurable fields** - content editors should be able to:

- Reorder sections within a page.
- Swap copy / images / CTAs without code changes.
- Toggle module visibility per device (mobile / tablet / desktop).
- Configure HubDB-driven listings via row count, filter defaults, and sort.

Conventions that apply to every module are documented in `docs/02-module-catalog.md` § "Module Conventions".

---

- end of sitemap -