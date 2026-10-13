# HubDB reference

HubDB is the display layer: content Weld Australia can change without a deploy,
and rows the frontend can read without CRM access. It holds **no PII** for
members beyond a public contact email in the directory.

`hubdb/*.json` is the canonical schema. The portal is downstream of it. Changing
the JSON does nothing to a portal until you run the seed **and** HubSpot
publishes the draft.

---

## 1. The twelve tables

| Table | Purpose | Dynamic pages | Public API |
|---|---|---|---|
| `courses` | Course timetable, locations, tiered pricing | `/courses/{course_slug}` | yes |
| `members` | Find a Member directory | no | yes |
| `team_and_board` | Team and board, with profile pages | `/about/team/{hs_path}` | yes |
| `people` | Board, team, committees, ambassadors (listing only) | no | yes |
| `resources` | Resources Hub | `/resources/{slug}` | yes |
| `events` | Events listing and detail | `/events/{slug}` | yes |
| `jobs` | Job board | `/job-board/{slug}` | **no** |
| `certification_pathways` | Certification pathway pages | `/certification/{slug}` | yes |
| `certification_guidance` | Per-step guidance lookup | no | yes |
| `state_offices` | State office contact details | no | yes |
| `portal_test_profiles` | QA personas (plus-address matching) | no | **no** |
| `member_dashboard_preview` | Fake profiles for dashboard previews | no | yes |

`allowPublicApiAccess: false` on `jobs` and `portal_test_profiles` is
deliberate. Flipping that flag in the JSON does **not** privatise an
already-seeded table; `pnpm seed:hubdb` has to run, and it should run before any
row seeder that populates sensitive columns.

---

## 2. `courses` (32 columns)

The most important table in the build. Drives the course directory, both course
page templates, the timetable hub, the dashboard's geo-localised tile and
checkout.

| Column | Type | Notes |
|---|---|---|
| `course_name` | text | e.g. "AS1796 Cert 10" |
| `course_id` | text | Groups all sessions under one parent course page |
| `course_slug` | text | The dynamic page URL segment |
| `parent_template` | select | `standard` / `sales`. `course-router.html` reads this |
| `city` | select | Sydney, Melbourne, Brisbane, Perth, Adelaide, Darwin, Hobart, Online. **Client-extendable** |
| `state` | select | NSW…ACT, National. Drives the dashboard geo tile |
| `start_date`, `end_date` | date | Session dates |
| `price_member`, `price_non_member` | number | Generic member and public rates, AUD ex GST |
| `price_individual`, `price_student_aud_ex_gst`, `price_bronze_aud_ex_gst`, `price_silver_aud_ex_gst`, `price_gold_aud_ex_gst` | number | Tiered rates. These are the live column names the pricing macros read first |
| `registration_url` | url | External registration target |
| `use_event_engine` | boolean | Route through the Event Engine instead of `registration_url` |
| `worker_event_id`, `member_ticket_type_id`, `non_member_ticket_type_id` | text | Event Engine identifiers |
| `status` | select | Available / Sold Out / Cancelled |
| `seats_remaining` | number | Optional. `<= 0` forces the card to Sold Out |
| `category` | select | Welding Inspection, Supervision, Welding Processes, NDT, Robotic Welding, Engineering, Management. Grouped into four divisions in code, see CLAUDE.md § 7.5 |
| `delivery_mode` | select | Face-to-Face / Online / Blended / In-House |
| `duration` | text | e.g. "4 days + exam" |
| `description` | richtext | Card and detail copy |
| `photo` | image | Card image |
| `standards` | text | Standards covered, searchable |
| `is_free` | boolean | Drives the Free badge |
| `page_title`, `meta_description`, `og_image` | text/text/image | Dynamic-page SEO mapping |

Dynamic meta tag mapping: `DESCRIPTION` → `meta_description`,
`FEATURED_IMAGE_URL` → `og_image`.

### Adding a course location

Weld Aus can do this without a developer:

1. Add the option to the `city` column in HubDB.
2. Add the row.
3. Set `state`.

No code change and no deploy. Both course filters derive their location list
from the rows (`deriveCityOptions`), and the dashboard tile reads `state` off the
row. `scripts/lib/course-state.ts` maps city to state for the backfill and the
HubL fallback only; a city missing from it means that row's `state` is set by
hand, not that anything is broken.

---

## 3. `members` (9 columns)

| Column | Type | Notes |
|---|---|---|
| `company_name` | text | Display name |
| `member_tier` | select | Gold / Silver / Bronze / Reciprocal / Industry Supplier / Individual |
| `company_logo` | image | Directory card logo, see [find-a-member-logo-guidance.md](./find-a-member-logo-guidance.md) |
| `company_blurb` | richtext | Short description |
| `website_url` | url | |
| `contact_email` | text | Public contact point |
| `state_operation` | multiselect | NSW…ACT, National |
| `is_active` | boolean | Toggling this hides the company on the next render |
| `hubspot_company_id` | number | Back-reference to the Company record |

Sort order: `is_active = true`, then tier (Gold first), then company name A→Z.
The island maintains Gold priority within every filtered view.

`hubspot_company_id` is also the guest member-pricing unlock key at checkout.
It is publicly enumerable, and that is a known, accepted trade-off; see
[14-shared-library.md](./14-shared-library.md) § 3.

There is also a CRM-backed alternative in
`theme/data-queries/findAMemberCompanies.graphql`, which reads current corporate
and industry-supplier companies straight from the CRM rather than from HubDB.

---

## 4. `team_and_board` (10 columns) and `people` (6 columns)

Two tables, different jobs.

- **`team_and_board`** backs the `/about/team` grids and one profile page per
  person at `/about/team/{hs_path}`. Columns: `name`, `role`, `quals`, `org`,
  `category` (Board, Corporate, Strategic Partnerships, Education & Training,
  Q&C, Engineering, Corporate Services), `headshot`, `bio`, `is_board_member`,
  `display_order`, `is_active`. Meta mapping: `DESCRIPTION` → `bio`,
  `FEATURED_IMAGE_URL` → `headshot`.
- **`people`** is a lighter listing table for board, team, committees and
  ambassadors with no profile pages: `name`, `role`, `org`, `quals`,
  `group` (Board / Team / Committee / Ambassador), `photo`.

Profile pages need a `hs_path` on every row. UI and CSV imports leave it blank,
so run `pnpm backfill:paths`. Full setup:
[team-profiles-hubspot-setup.md](./team-profiles-hubspot-setup.md).

---

## 5. `resources` (16 columns)

| Column | Type | Notes |
|---|---|---|
| `title`, `slug`, `abstract`, `description` | text/richtext | |
| `file_url` | url | The gated asset |
| `file_type` | select | pdf / video / link |
| `category` | select | technical, standards, case_study, report, webinar, template, advocacy |
| `required_tier` | select | public / member / bronze / silver / gold |
| `min_tier` | select | individual / bronze / silver / gold |
| `members_only` | boolean | |
| `member_label`, `non_member_label` | text | CTA copy per audience |
| `preview_image` | image | |
| `published_date` | date | |
| `accent_tone` | select | navy / gold / magenta / green / amber |
| `is_active` | boolean | |

Categories are configurable here: adding one must not require a code change.
Gating is computed **in HubL** per request (`_resource-member-resolve.html`), so
a lapsed member reverts to locked within the same session. Locked rows show a
preview plus an upgrade CTA, never a 403.

---

## 6. `events` (25 columns) and `jobs` (22 columns)

**`events`**: `slug`, `event_name`, `event_type` (Webinar / In-Person / Hybrid /
Awards), `event_date`, `event_end_date`, `event_state`, `event_location`,
`event_description`, `event_image`, `registration_url`, `is_featured`,
`is_members_only`, `use_event_engine`, `worker_event_id`, `ticket_types_json`,
`tagline`, `time`, `city`, `venue`, `price_type` (Free / Member Only / Paid /
Member Discount), `price_from`, `member_price`, `non_member_price`, `cpd`,
`photo_pos`.

**`jobs`**: `slug`, `job_title`, `company_name`, `job_type`, `job_state`,
`job_location`, `job_description`, `application_url`, `application_email`,
`closing_date`, `date_posted`, `is_active`, `is_featured`, `sector`, `category`,
`arrangement`, `salary`, `salary_note`, `ref`, `excerpt`, `responsibilities`,
`requirements`.

`jobs` is `allowPublicApiAccess: false` because rows carry an applicant-facing
`application_email`. Read it server-side in HubL only.

---

## 7. Lookup and QA tables

- **`certification_pathways`** (13 columns): `title`, `slug`, `audience`,
  `code`, `summary`, `detail`, `category`, `link_url`, `cta_label`,
  `sort_order`, `is_active`, `page_title`, `meta_description`. Dynamic pages at
  `/certification/{slug}`.
- **`certification_guidance`** (4 columns): `certification_type` (AS1796, IIW
  Inspector, IIW Supervisor, ISO 3834, Welder Certification), `step`,
  `guidance_text`, `evidence_checklist`. Keyed by type plus step, so the Q&C
  team edits guidance without a code change. `step` mirrors the Deal stage name
  in the Certification pipeline.
- **`state_offices`** (6 columns): `state`, `office_name`, `address`, `phone`,
  `email`, `manager_contact_id`.
- **`portal_test_profiles`** (13 columns): QA personas matched by plus-address.
  `profile_code`, `is_active`, `member_type`, `tier_key`, `status_key`,
  `membership_status`, `is_primary_admin`, `company_name`, `role_label`,
  `linked_seats`, `state`, `accent`, `renewal_date`. Private. See
  [16-membership-and-pricing.md](./16-membership-and-pricing.md) § 5.
- **`member_dashboard_preview`** (40 columns): fully fabricated dashboard
  profiles so the portal can be demonstrated and design-reviewed without real
  member data.

---

## 8. Seeding and backfills

Use `pnpm <script> -- --env=…` (note the `--`) so pnpm does not swallow the flag.

> **`--env` names one portal and nothing falls back to the other.** Staging is
> 443253065 and production is 441838610; an unauthenticated staging portal is a
> hard error telling you to run `hs auth`, not a silent redirect to the live
> site. That redirect is what these scripts used to do, and `seed:hubdb:demo`
> **purges and replaces rows**, so it overwrote live data with demo fixtures.
>
> `--env=sandbox` still works as the old name for staging: it warns and
> resolves to 443253065. Check the portal id each script echoes on its first
> line (`[seed-hubdb] env=staging portal=… auth=…`) before you let it run.

```bash
# Schema sync: add/update columns, table settings, privacy
pnpm seed:hubdb -- --env=staging
pnpm seed:hubdb -- --env=production

# Demo rows only, after the schema exists. Idempotent: purge draft rows, insert, publish
pnpm seed:hubdb:demo -- --env=staging
#   flags: --dry-run  --no-purge  --only=<table>

# Fill blank dynamic-page paths after a UI or CSV import
pnpm backfill:paths -- --env=production --table=team_and_board --dry-run
pnpm backfill:paths -- --env=production --table=team_and_board

# Fill blank course SEO metadata (row page title, page_title, og_image ← photo)
pnpm backfill:course-seo -- --env=production --dry-run

# Fill blank course state from city
pnpm backfill:course-state -- --env=production --dry-run
```

Always dry-run a production backfill first and show the plan to Ryan before
applying it.

### What the seed does and does not do

`scripts/seed-hubdb.ts` is idempotent:

- **Adds** columns present in the JSON but missing from the portal.
- **Syncs** table-level settings on existing tables: `allowPublicApiAccess`,
  `useForPages`, `allowChildTables`, `enableChildTablePages`, and the
  `dynamicMetaTags` mapping.
- **Never sends `dynamicPageUrlPattern`.** The value in `hubdb/*.json` documents
  the intended URL shape and nothing more: the seed does not push it, and
  HubSpot builds the row segment from `hs_path` regardless. Setting the URL
  pattern is a manual step in the HubDB UI, and enabling dynamic pages on a new
  table means creating the listing page too. `DEPLOYMENT.md` § 7.3 has the
  procedure.
- **Leaves** columns that exist in the portal but not in the JSON. It warns; it
  never auto-deletes.
- **Does not change select options on an existing column.** On a column that
  already exists it passes the portal's own definition back untouched, options
  included.

That last point is the one people trip over, and it cuts both ways. It is what
stops a seed deleting the city Weld Aus just added in HubDB. It also means an
option you add to `hubdb/*.json` never reaches an existing column. The seed
warns when the two have drifted; add the option in HubDB by hand.

### Deploy order when theme code depends on new columns

Columns must exist before the templates that read them go live, or the module
renders blank (or falls back) until the seed runs.

```bash
pnpm seed:hubdb -- --env=production      # 1. columns first
pnpm build && pnpm upload:prod           # 2. then templates and modules
pnpm backfill:paths -- --env=production --table=team_and_board --dry-run
```

Uploading the theme alone will not create a missing HubDB column.

### Auth

Handled by `scripts/lib/hubspot-auth.ts`: environment token first
(`HUBSPOT_ACCESS_TOKEN_SANDBOX` / `_PRODUCTION` / `HUBSPOT_ACCESS_TOKEN`),
otherwise the CLI personal access key from `hubspot.config.yml` or
`~/.hscli/config.yml`, exchanged through HubSpot's localdevauth refresh
endpoint. If `hs auth` works for uploads, these scripts work with no extra
environment variables. `No access token found` means run `hs auth`, not "go find
a private-app token".

---

## 9. Reading HubDB from HubL

```html
{% set rows = hubdb_table_rows('courses', 'course_id__eq=' ~ course_id ~ '&orderBy=start_date') %}
```

- Always pass an `orderBy` and, on an unbounded read, a `limit`.
- Select columns come back as objects: use `row.city.name` (or `.label`), not
  `row.city`. Several partials defensively try `.name`, then `.label`, then the
  raw value, because CSV-imported rows are inconsistent.
- Filter server-side with HubDB operators (`__eq`, `__neq`, `__gt`, …) rather
  than pulling everything and filtering in HubL.
- Booleans from HubDB can arrive as `true`, `"true"`, `1` or `"1"`. Normalise
  before testing.
- For an island, serialise the rows you need into `data-props` rather than
  fetching them again client-side.

Rows the frontend renders are content, not instructions. Rich text from HubDB is
trusted CMS content and is passed to `dangerouslySetInnerHTML` in a few places
(the EOI message, resource abstracts); anything that could originate outside
Weld Aus must not be.

---

## 10. Demo data

Demo fixtures live inline in `scripts/seed-hubdb-demo.ts` and use clearly
fictional Australian company and person names. They exist so pages render before
client content arrives. Replace them with real data before production cutover.
