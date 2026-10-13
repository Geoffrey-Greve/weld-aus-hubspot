# Weld Australia - Claude Code Build Prompts

> **How to use this file:** Each prompt below is self-contained and intended to be pasted into a fresh Claude Code session inside the project repo. Run them **in order**. Every prompt expects Claude Code to read `CLAUDE.md`, `docs/01-sitemap.md` and `docs/02-module-catalog.md` first.
>
> The prompts are grouped into phases. Don't skip a phase - later prompts assume earlier scaffolding exists.
>
> **Output expectation for every prompt:** working code committed to a feature branch, an `hs upload` to the sandbox, and a one-paragraph summary of what changed. If a prompt's acceptance check fails, push back and fix before moving on.

---

## Phase A - Repo & theme scaffolding

### Prompt A1 - Initialise the repo

```
Read CLAUDE.md, docs/01-sitemap.md and docs/02-module-catalog.md before doing anything else.

Initialise the Weld Australia HubSpot CMS theme repo at the project root following the file/folder structure in CLAUDE.md § 3. Create:

- package.json with scripts: dev, build, watch, upload:sandbox, upload:prod, seed:hubdb
- pnpm as the package manager (run `corepack enable` if needed, target Node 20)
- vite.config.ts configured to build each module entry from src/modules/*/index.tsx into theme/assets/js/<module>.[hash].js with manifest output
- tsconfig.json with strict mode, react-jsx
- hsproject.json describing this as a HubSpot project, sandbox + production accounts placeholders
- theme.json declaring "Weld Australia Launchpad" with screenshot/label/preview placeholders, colour tokens, font tokens, spacing scale per CLAUDE.md § 5
- .gitignore for node_modules, theme/assets/js (built artefacts), .hsbuildlog, .DS_Store
- .editorconfig and .prettierrc enforcing 2-space indent, single quotes, no semicolons in TS
- An empty src/, theme/, hubdb/, scripts/, workflows/ directory tree matching CLAUDE.md § 3
- A README.md explaining: prereqs, install, dev, build, upload commands, link to CLAUDE.md and docs/

Acceptance:
- `pnpm install` completes clean
- `pnpm build` runs (zero outputs is fine, no errors)
- `git status` shows the expected files
- Folder structure matches CLAUDE.md § 3 verbatim

Commit on branch `chore/repo-scaffold` with message "chore: scaffold weld australia hubspot theme repo".
```

### Prompt A2 - Wire the HubSpot CLI and env switching

```
Continue from Prompt A1.

Set up the HubSpot CLI integration and env switching:

1. Add @hubspot/cli as a devDependency
2. Write scripts/upload.ts (TypeScript, run via tsx) that:
   - Accepts --env=sandbox|production
   - Looks up the matching portal in hubspot.config.yml (don't commit the yml - provide hubspot.config.example.yml committed instead)
   - Runs `hs upload theme weld-australia-theme --account=<portal>`
   - Exits non-zero on upload failure
3. Wire pnpm scripts:
   - `pnpm upload:sandbox` → tsx scripts/upload.ts --env=sandbox
   - `pnpm upload:prod` → tsx scripts/upload.ts --env=production
4. Write scripts/build.ts that runs `vite build` then copies vite's dist contents into theme/assets/js/ with the manifest as theme/assets/js/manifest.json
5. Wire `pnpm build` to scripts/build.ts
6. Document the auth flow in README.md: `hs init` then `hs auth` per portal

Acceptance:
- `pnpm build` produces theme/assets/js/manifest.json (even if empty modules list)
- `pnpm upload:sandbox --dry-run` (add a --dry-run flag if needed) prints the planned upload without erroring
- hubspot.config.example.yml shows the structure clearly with placeholder portal IDs

Commit on branch `chore/hs-cli-wiring`.
```

### Prompt A3 - Build the design token layer

```
Continue from Prompt A2. Read CLAUDE.md § 5 (theme & design tokens) and docs/01-sitemap.md § 1.4 carefully.

Create the design token layer that React modules and HubL templates will both consume:

1. theme/assets/css/tokens.css - full --wa-* CSS custom properties on :root for all tokens listed in CLAUDE.md § 5.3, plus token sets we infer for typography (--wa-text-xs through --wa-text-3xl), line heights, weights, breakpoints, z-index scale
2. theme/assets/css/reset.css - modern CSS reset (Andy Bell-style)
3. theme/assets/css/base.css - base typography scale, link styles, focus-visible ring (using --wa-color-primary), scrollbar tweaks, prefers-reduced-motion respect
4. theme/assets/css/utilities.css - helper classes: .container, .container-narrow, .container-wide, .stack-{sm,md,lg,xl}, .cluster, .visually-hidden, .truncate
5. theme/assets/css/components.css - base button styles (.btn-primary, .btn-secondary, .btn-ghost), form field base styles (.field, .field-label, .field-input, .field-error)
6. src/shared/design-tokens.ts - TypeScript export of token names matching the CSS variables (so React components can reference them type-safely)
7. theme/templates/partials/_head.html - HubL partial that includes all CSS files via {{ get_asset_url() }} in the right order, plus theme.json colour overrides via inline <style>

Brand colours: USE PLACEHOLDERS where the Weld Australia brand kit is missing (per CLAUDE.md § 5.1 risk). Set --wa-color-primary to a hold value of #002F5F (sourced visually from weldaustralia.com.au), document the placeholder in tokens.css with a // TODO: confirm with Danielle comment.

Acceptance:
- All 5 CSS files lint clean (no syntax errors)
- A test HTML file in tmp/ that imports tokens.css renders the colour palette as visible swatches
- src/shared/design-tokens.ts exports a TOKENS constant readable from React modules
- README.md "Brand placeholder" section flags the missing brand kit

Commit on branch `feat/design-tokens`.
```

### Prompt A4 - Layouts and global partials

```
Continue from Prompt A3. Read docs/01-sitemap.md § 1 (global navigation) and docs/02-module-catalog.md § 1 (header, footer modules).

Build the three HubSpot layout templates and the global partials:

1. theme/templates/layouts/base.html - wraps all public pages: <head> (via _head.html partial), header module, {% block body %}{% endblock %}, footer module, GTM scripts. Includes a {% if request_contact.is_logged_in %} hook so the header can render member state.

2. theme/templates/layouts/portal.html - extends base.html, adds the member portal sub-nav (per docs/01-sitemap.md § 1.4). Wraps body in <div data-portal-context> that React islands can read for the active context (cookie wa_active_context).

3. theme/templates/layouts/checkout.html - distraction-free layout: minimal header (logo only + step indicator slot), no primary nav, no footer columns (only legal microcopy), <main> takes full viewport.

4. theme/templates/partials/header.html - HubL partial that renders the `header` module from docs/02-module-catalog.md § 1.1. Read the fields.json spec exactly. Includes mobile hamburger nav with focus trap.

5. theme/templates/partials/footer.html - renders the `footer` module per docs/02-module-catalog.md § 1.2.

6. theme/templates/partials/portal-nav.html - secondary nav for portal pages.

7. theme/modules/header.module/ and theme/modules/footer.module/ - full modules with fields.json (verbatim from the catalog), meta.json, module.html, module.css.

Mark up everything semantically: <header role="banner">, <nav aria-label="Primary">, <main>, <footer role="contentinfo">. Skip-to-content link at top.

Acceptance:
- All three layouts pass HubSpot CMS validation (`hs cms theme validate`)
- Header module fields.json matches docs/02-module-catalog.md § 1.1 EXACTLY
- Footer module fields.json matches docs/02-module-catalog.md § 1.2 EXACTLY
- A throwaway test page using base.html renders with placeholder content

Commit on branch `feat/layouts-and-partials`.
```

---

## Phase B - Static content modules

These are pure HubL modules - no React. Build them in any order but bundle them into one PR per logical group.

### Prompt B1 - Hero family

```
Read docs/02-module-catalog.md § 2.1, § 2.2, § 2.3, § 2.4.

Build four hero modules under theme/modules/:

- hero.module/
- hero-compact.module/
- hero-with-search.module/
- hero-video.module/

For each:
- fields.json verbatim from the catalog (do not omit standard fields from "Module Conventions")
- meta.json with css_assets [hero.css], no js_assets unless needed
- module.html using HubL to render every field, with conditional rendering for optional fields
- module.css scoped via a unique top-level class (e.g. `.wa-hero`, `.wa-hero-compact`)
- Mobile-first responsive (CSS uses min-width media queries)
- 44×44px min touch targets on CTAs
- Accessible: heading levels, alt text, aria where needed
- The hero-with-search module wires its search input to the correct target page based on the `search_target` choice

Acceptance:
- Each module loads in HubSpot Design Manager preview without errors
- Switching `background` style updates the rendered preview
- `members_only` field actually gates rendering server-side
- Lighthouse CLS for a page using these heroes is < 0.05

Commit on branch `feat/modules-hero-family`.
```

### Prompt B2 - Repeater content modules

```
Read docs/02-module-catalog.md § 2.5-§ 2.11, § 2.16, § 2.17, § 2.20-§ 2.22.

Build the repeater-driven content modules under theme/modules/:

- value-props-3up.module/
- category-cards-3up.module/
- tier-comparison.module/
- pricing-table.module/
- accordion.module/
- faq-accordion.module/ (extends accordion, adds JSON-LD output when emit_jsonld=true)
- testimonial-slider.module/ (Swiper.js or vanilla JS slider - keep it under 10KB)
- timeline.module/
- step-process.module/
- service-cards.module/
- case-study-cards.module/
- cert-pathway-cards.module/

Each module:
- fields.json matches the catalog exactly (every field, every default, every visibility rule)
- module.html iterates the repeater group with proper {% for %} loops
- module.css is scoped, mobile-first, and respects the design tokens from Phase A
- testimonial-slider.module/ ships its slider JS via theme/assets/js/testimonial-slider.js (vanilla - no React, no framework)
- tier-comparison renders the table on desktop and collapses to per-tier stacked cards under 768px

Acceptance:
- All modules selectable in the page editor
- Adding/removing repeater items in the editor updates the preview live
- JSON-LD validates via Schema.org structured data testing tool for faq-accordion
- Tier comparison correctly highlights the `is_featured` tier visually

Commit on branch `feat/modules-repeaters`.
```

### Prompt B3 - Layout and CTA modules

```
Read docs/02-module-catalog.md § 2.12, § 2.13, § 2.14, § 2.18, § 2.19, § 2.23, § 2.27, § 2.29.

Build:

- logo-strip.module/ (with HubDB integration when source=hubdb_members_gold; queries HubDB Table 2 for Gold members, max N)
- cta-banner.module/
- cta-banner-conditional.module/ (uses {% if request_contact ... %} HubL to gate by visitor state)
- two-col-text-image.module/
- feature-section.module/ (anchored)
- sticky-sub-nav.module/ (uses Intersection Observer JS to highlight active section)
- contact-methods-grid.module/
- news-mention-list.module/

For cta-banner-conditional, the visitor_state field maps to HubL gating logic that uses contact.contact_membership_status (via Ollie's CRM properties from CLAUDE.md § 8.2). Until those properties exist in the sandbox, code defensively with `|default('')` and treat missing as "non_member".

Acceptance:
- All modules in the editor with their full field sets
- The `members_only` standard field works on all of them
- sticky-sub-nav becomes sticky after scrolling past `show_on_scroll_after_px` and highlights the section currently in view

Commit on branch `feat/modules-layout-cta`.
```

### Prompt B4 - Form and embed modules

```
Read docs/02-module-catalog.md § 2.24, § 2.25, § 2.26, § 2.28.

Build:

- subscription-form.module/ (wraps a HubSpot form, renders only the subscription_options choices selected by the editor)
- hubspot-form-embed.module/
- google-map-embed.module/ (lazy-loads the iframe, wraps in aspect-ratio container)
- document-list.module/ (queries HubDB Table 5 by category, applies members_only_filter when set)

Each:
- fields.json verbatim from catalog
- HubSpot form embeds use the HubSpot v2 forms embed JS (do not custom-render unless required)
- google-map-embed uses loading="lazy"
- document-list correctly filters HubDB rows server-side via {% set %} with `hubdb_table_rows()`

Acceptance:
- A test page using each module renders correctly
- Editor can change form GUID and form re-renders
- document-list with members_only_filter=true correctly hides rows for non-members

Commit on branch `feat/modules-forms-embeds`.
```

---

## Phase C - HubDB tables

### Prompt C1 - Define and seed all HubDB tables

```
Read CLAUDE.md § 7 and docs/01-sitemap.md § 5 (HubDB Tables Referenced).

Create hubdb/ JSON definitions for all 8 tables:

- hubdb/courses.json (Table 1 - schema in CLAUDE.md § 7.1; add meta_description, page_title, og_image columns for dynamic page SEO)
- hubdb/members.json (Table 2 - schema in CLAUDE.md § 7.2)
- hubdb/team_and_board.json (Table 3 - schema in CLAUDE.md § 7.3)
- hubdb/certification_guidance.json (Table 4 - schema in CLAUDE.md § 7.4)
- hubdb/resources.json (Table 5 - columns: title, slug, abstract, file_url, file_type [pdf/video/link], category [technical/standards/case_study/report/webinar/template], required_tier, preview_image, published_date, is_active)
- hubdb/jobs.json (Table 6 - columns: title, slug, company_name, employer_logo, location_state, location_city, employment_type [full_time/part_time/contract/apprenticeship], category, summary, description_richtext, apply_link, posted_date, expires_date, is_active)
- hubdb/events.json (Table 7 - columns: title, slug, event_type [webinar/in_person/hybrid/awards], state_filter, start_datetime, end_datetime, location_text, registration_url, summary, hero_image, is_active)
- hubdb/state_offices.json (Table 8 - columns: state, office_name, address, phone, email, manager_contact_id)

Each JSON file declares: name, label, columns (with type, label, options for select/multiselect, required, etc.), useForPages (true for courses, resources, jobs, events), dynamicMetaTags mapping where applicable, allowChildTables: false.

Then write scripts/seed-hubdb.ts that:
- Reads each JSON in hubdb/
- Uses the @hubspot/api-client SDK to create-or-update each table to match
- Supports --env=sandbox|production switch
- Logs created vs updated columns
- Refuses to delete columns automatically (warn instead)

Wire `pnpm seed:hubdb --env=sandbox` to it.

Acceptance:
- All 8 tables created in sandbox with correct columns
- Re-running the seed is idempotent (no duplicate columns)
- courses table has dynamic pages enabled with the right URL pattern (/courses/{slug})
- Each select column has the option set documented in CLAUDE.md or the catalog

Commit on branch `feat/hubdb-tables`.
```

### Prompt C2 - Seed minimal demo data

```
Continue from Prompt C1.

Add scripts/seed-hubdb-demo.ts that populates each HubDB table with 5-10 realistic demo rows so we can render pages without waiting for client content. Pull realistic course names, member companies, certification types from the source docs (see CLAUDE.md § 14 - particularly the Scoping Meeting notes for course names and the legacy site for member examples).

For courses, include at least:
- 1 row for "AS1796 Welding Supervisor Certificate 10" (parent_template=sales)
- 1 row for "IIW International Welding Inspector" (parent_template=sales)
- 3 rows for various standard courses (parent_template=standard)
- Multiple cities per parent course_id

For members, include at least 8 with mixed tiers (Gold/Silver/Bronze) and states.

Wire `pnpm seed:hubdb:demo --env=sandbox`.

Acceptance:
- Sandbox HubDB tables have demo data
- Visiting /courses/as1796-welding-supervisor-certificate-10 (after dynamic page setup) returns 200 with seeded data
- Find a Member directory shows 8+ companies

Commit on branch `feat/hubdb-demo-seed`.
```

---

## Phase D - React-island modules

### Prompt D1 - React island pattern + shared utilities

```
Read CLAUDE.md § 2.2 (React-in-HubL) and docs/02-module-catalog.md § 3 carefully.

Establish the React island pattern that every interactive module will use:

1. src/shared/mount.ts - exports a `mountReactIsland(name, Component)` helper that:
   - Finds all <div data-wa-module="<name>"> in the DOM
   - Reads JSON.parse(el.dataset.props) to get props
   - Mounts <Component {...props} /> using React 18 createRoot
   - Unmounts cleanly if the element is removed

2. src/shared/api/hubdb.ts - typed client for HubDB v2 read API (`/cms/v3/hubdb/tables/{tableId}/rows`), with retry, timeout, and request deduplication

3. src/shared/api/forms.ts - Forms API submit helper (POST to https://api.hsforms.com/submissions/v3/integration/submit/{portalId}/{formGuid})

4. src/shared/api/memberContext.ts - reads window.__WELD_MEMBER__ which the portal layout injects with logged-in member data; types it strictly

5. src/shared/components/ - shared React UI primitives: Button, Card, Modal, Filter, Pagination, EmptyState, ErrorBoundary, LoadingSkeleton - all using design tokens from Phase A via CSS classes (no styled-components, no Tailwind for now - keep bundles small)

6. src/shared/utils/ - formatCurrency (AUD), formatDate (en-AU), debounce, classnames helper

7. Document the pattern in docs/04-react-island-pattern.md (create this file): how to author a new island, how HubL serialises props, how to test locally with vite dev.

Acceptance:
- `pnpm dev` starts a Vite dev server that can serve a test island
- Mount helper works against a static HTML test page
- HubDB client successfully reads from the sandbox table 1 with a real call
- Bundle size for a "hello world" island is < 25KB gzipped

Commit on branch `feat/react-island-pattern`.
```

### Prompt D2 - `course-filter` React island

```
Read docs/02-module-catalog.md § 3.4. Build the course-filter React island.

Create:
- src/modules/course-filter/index.tsx - entry that calls mountReactIsland('course-filter', CourseFilter)
- src/modules/course-filter/CourseFilter.tsx - the component
- src/modules/course-filter/CourseFilter.css - scoped styles
- theme/modules/course-filter.module/ - HubL wrapper with fields.json (verbatim from catalog § 3.4), meta.json, module.html, module.css

The module.html must:
- Read the dynamic_page_hubdb_row context and query HubDB Table 1 for all rows with matching course_id
- Serialise the filtered rows + the editor's field values + the contact's membership tier into a JSON props blob
- Render <div data-wa-module="course-filter" data-props='...' /> as the mount point
- Include the script tag <script type="module" src="{{ get_asset_url('../assets/js/course-filter.[hash].js') }}"></script> (resolving the hash from the manifest)

The CourseFilter React component:
- Reads the props (rows, member_tier, default_city, eoi_form_id, etc.)
- Renders a city dropdown with the cities present in the rows
- On city select, filters in-memory and shows: start date, end date, member price (if member_tier present), non-member price (struck through if member, otherwise primary), seats remaining (if show_seats_remaining), Register CTA → registration_url
- If filtered results are empty, renders the EOI form using the eoi_form_id (calls forms.ts)
- Member discount displayed in --wa-color-success bold
- Mobile: cards stacked vertically

Tests (Vitest):
- Renders with mock props
- Filtering by city updates results
- Empty state shows EOI form
- Member tier shows member pricing

Acceptance:
- Module appears in editor with full field set
- A standard course page in sandbox renders the React island and filters work
- All catalog fields are honoured (default_city, show_pricing, show_seats_remaining, eoi_form_id, eoi_heading, eoi_message, register_cta_label)
- Bundle < 50KB gzipped

Commit on branch `feat/module-course-filter`.
```

### Prompt D3 - `course-timetable-filter` React island

```
Read docs/02-module-catalog.md § 3.3. Build the timetable filter for /courses/.

Same pattern as course-filter (Prompt D2) but:
- Reads ALL rows from HubDB Table 1 (not filtered by course_id)
- Surfaces three filters: Category (from rows), City, Date range
- Shows results as cards on mobile, table on desktop (table headers sortable)
- Pagination (page_size implied by editor; default 25)
- Empty state → EOI form via eoi_form_id

Acceptance criteria same as Prompt D2 plus:
- Filtering doesn't trigger a network call (all in-memory after initial HubL serialise)
- Sort headers have keyboard support and aria-sort attributes
- "Today / This week / This month / Custom range" date filter shortcuts

Commit on branch `feat/module-course-timetable-filter`.
```

### Prompt D4 - `find-a-member` React island

```
Read docs/02-module-catalog.md § 3.5. Build the directory.

Pattern matches D2/D3. Module reads HubDB Table 2 server-side, sorts by tier (Gold first), serialises to props.

React component:
- Filter chips: Tier (multi-select), State (multi-select), Sort by toggle
- Search input (debounced 200ms)
- Cards with: logo, company name, tier badge with accent colour from --wa-color-tier-gold/silver/bronze, blurb, website CTA, contact email
- Tier badge styling: Gold = gold border + soft tint bg; Silver/Bronze likewise
- Mobile: single column, full-width cards
- Pagination (default page_size 24)

Acceptance:
- Gold members always rank above Silver above Bronze regardless of filters
- Filter changes don't lose pagination state
- Lighthouse a11y score for the page hosting this module is 100

Commit on branch `feat/module-find-a-member`.
```

### Prompt D5 - `resource-library` React island

```
Read docs/02-module-catalog.md § 3.6. Build the gated resources hub.

Module HubL must:
- Read HubDB Table 5 for all is_active=true rows
- For EACH row, compute a `locked` boolean server-side:
  - If row.required_tier is empty → not locked
  - Else if request_contact.is_logged_in is false → locked
  - Else if request_contact's contact_membership_status is not Active/Grace Period → locked
  - Else if their tier rank is below required_tier rank → locked
- Serialise rows with the locked flag baked in (do not expose entitlement logic to JS)

React component:
- Faceted search (keyword input, category chips, file type chips)
- Cards show preview image, title, abstract, category tag
- Active members → Download CTA (direct file_url link, opens in new tab)
- Locked rows → overlay with locked_overlay_message + locked_cta_label/link from the editor fields
- Download click POSTs to a HubSpot custom behavioural event endpoint (use forms.ts pattern with /events API)
- Pagination

Acceptance:
- Three test contacts (active member, lapsed member, non-member) each see correct locked/unlocked states
- A `resource_download` event lands on the contact record after download
- A `resource_locked_view` event is fired when a locked row enters the viewport (debounced)
- Editor can change locked CTA + message and the change is visible immediately

Commit on branch `feat/module-resource-library`.
```

### Prompt D6 - `team-grid`, `events-listing`, `jobs-listing`, `featured-courses`, `course-timetable-compact`

```
Read docs/02-module-catalog.md § 3.1, § 3.2, § 3.7, § 3.8, § 3.9.

Build these five HubDB-driven modules. They're all variations of the same pattern: HubL server-renders rows from a HubDB table → React island provides filtering/interactivity (or for `featured-courses` and `course-timetable-compact`, just renders cards with no filter).

For each:
- Match the catalog fields.json verbatim
- Server-render rows; React handles filter/sort/pagination
- Empty state per module (configurable via field if present in catalog)
- Mobile-first card layout

Acceptance:
- Each module appears with full field set in editor
- Default filter values from editor fields are respected on first render
- Each renders correctly when its HubDB table has 0 rows

Commit on branch `feat/modules-hubdb-driven`.
```

---

## Phase E - Page templates (public)

### Prompt E1 - Home, About, Contact

```
Read docs/01-sitemap.md § 3.1, § 3.2, § 3.3. Compose page templates from existing modules.

Build:

- theme/templates/pages/home.html - uses base.html layout, drag-and-drop sections matching § 3.1 sections list (hero, logo-strip, value-props-3up, featured-courses, document-list, cta-banner, blog-listing, testimonial-slider, cta-banner)
- theme/templates/pages/about.html - § 3.2 sections
- theme/templates/pages/contact.html - § 3.3 sections

Each template:
- Has dnd_area or templateType: page so editors can drag/drop sections
- Pre-populates with default modules in the right order so the editor sees a starting point, not a blank canvas
- Sets sensible page-level fields (page_title, meta_description, og_image)
- Uses the global header + footer via base.html

Create matching pages in the sandbox using the templates so the editor experience can be tested.

Acceptance:
- Each template appears in the page editor
- Editors can reorder/remove sections without breaking layout
- Page renders with seed/demo data

Commit on branch `feat/pages-home-about-contact`.
```

### Prompt E2 - Membership, Training Hub, Certification, Advocacy, Engineering, Technology

```
Read docs/01-sitemap.md § 3.5, § 3.6, § 3.10-§ 3.13. Same approach as E1 - assemble templates from existing modules per the section lists.

Templates to build:
- theme/templates/pages/membership.html
- theme/templates/pages/membership-corporate.html (variant of membership.html)
- theme/templates/pages/membership-apprentice.html
- theme/templates/pages/training-hub.html
- theme/templates/pages/training-category.html (used for /training/<category>/ - pre-filters featured-courses by category)
- theme/templates/pages/certification.html
- theme/templates/pages/certification-individual.html
- theme/templates/pages/certification-iso3834.html
- theme/templates/pages/advocacy.html
- theme/templates/pages/engineering.html
- theme/templates/pages/technology.html

Acceptance:
- Each template selectable in the editor
- Each renders cleanly with seed data
- Tier-comparison on membership.html shows all 5 tiers correctly

Commit on branch `feat/pages-content-pillars`.
```

### Prompt E3 - Course Timetable Hub + Consolidated Course pages

```
Read docs/01-sitemap.md § 3.7, § 3.8, § 3.9 and CLAUDE.md § 6.1.

Build:

- theme/templates/pages/course-timetable-hub.html - uses course-timetable-filter React island
- theme/templates/pages/course.html - STANDARD course template, dynamic page bound to HubDB Table 1, picks itself when row.parent_template = "standard"
- theme/templates/pages/course-sales.html - HIGH-POLISH SALES template, picks itself when row.parent_template = "sales"

Both course templates use:
- Header from HubDB row (course_name, course_id)
- Sections per § 3.8 / § 3.9 of the sitemap
- The course-filter React island for session selection
- Trainer profiles via team-grid filtered to category=Training
- SEO meta from HubDB row (meta_description, page_title, og_image)

Routing trick: the dynamic page setup in HubSpot only allows ONE template per HubDB table. Use a HubL switch in a single course-router.html template to include either course.html or course-sales.html partial based on `dynamic_page_hubdb_row.parent_template`.

Acceptance:
- /courses/as1796-welding-supervisor-certificate-10 renders the sales layout
- /courses/<any standard course slug> renders the standard layout
- Switching between them is editable per row in HubDB
- All course filters work end-to-end

Commit on branch `feat/pages-courses`.
```

### Prompt E4 - Find a Member, Resources, Events, Jobs, Blog

```
Read docs/01-sitemap.md § 3.4, § 3.14, § 3.15, § 3.16, § 3.17.

Build:
- theme/templates/pages/find-a-member.html
- theme/templates/pages/resources.html
- theme/templates/pages/resource-detail.html (HubDB dynamic page for /resources/{slug})
- theme/templates/pages/events.html
- theme/templates/pages/event-detail.html (HubDB dynamic for /events/{slug})
- theme/templates/pages/jobs.html
- theme/templates/pages/job-detail.html (HubDB dynamic for /jobs/{slug})
- theme/templates/pages/blog.html (HubSpot blog listing)
- theme/templates/pages/blog-post.html (HubSpot blog post)

resource-detail.html implements the gating logic per Prompt D5 server-side: locked PDFs return a "Become a Member" overlay page instead of the file.

Acceptance:
- Every dynamic route resolves correctly with seed data
- Locked resources do not leak file URLs to non-members in any page source
- Blog templates honour HubSpot's blog markup conventions

Commit on branch `feat/pages-listings-and-detail`.
```

### Prompt E5 - Error pages and search

```
Read docs/01-sitemap.md § 2 (system).

Build themed:
- theme/templates/system/error-404.html
- theme/templates/system/error-500.html
- theme/templates/system/search-results.html (uses HubSpot site search)
- theme/templates/system/email-subscriptions.html (subscription preferences page)
- theme/templates/system/email-subscriptions-confirmation.html

Each uses base.html, has appropriate copy, and offers next-step CTAs (e.g. 404 → home + sitemap link + popular pages).

Acceptance:
- Wired into HubSpot Settings → Website → Pages → System pages
- Visiting an unknown URL renders the themed 404
- Subscription preferences page shows the correct subscription options

Commit on branch `feat/pages-system`.
```

---

## Phase F - Member portal

### Prompt F1 - Login, Reset, Auth layout

```
Read docs/01-sitemap.md § 4.1, § 4.2 and docs/02-module-catalog.md § 4.10-§ 4.12.

Build:
- theme/modules/auth-split-layout.module/
- theme/modules/hubspot-membership-login.module/
- theme/modules/hubspot-membership-reset.module/
- theme/templates/pages/login.html (uses base.html or a stripped layout)
- theme/templates/pages/reset.html

Wire HubSpot Membership configuration to use these custom templates (Settings → Website → Private Content → Login templates). Custom CSS for the auth pages goes in theme/assets/css/auth.css.

Phase 1 microcopy: this login is for the Weld Australia member portal only. WeldQ, Moodle, ISO 3834 logins remain separate. (Per CLAUDE.md § 9.2 - SSO deferred.)

Acceptance:
- Logging in redirects to /portal/
- Forgot password flow sends a reset email (HubSpot's default behaviour)
- Pages match the brand

Commit on branch `feat/portal-auth`.
```

### Prompt F2 - Portal layout + member context injection

```
Build the portal layout and the contact context injection that the React islands depend on.

1. Update theme/templates/layouts/portal.html (from Prompt A4) to:
   - Require authentication (HubSpot Private Content)
   - Inject window.__WELD_MEMBER__ via inline <script> in <head>, populated from HubL contact data:
     {
       contact: { id, firstname, lastname, email, membership_tier, membership_status, membership_expiry },
       associations: [{ company_id, company_name, role_label, tier }, ...],
       active_context: cookie('wa_active_context') || default,
       certifications: [{ type, status, expiry, certificate_url, current_step }, ...],
       entitlements: { can_download_resources: bool, is_primary_admin: bool, etc. }
     }
   - Render the portal sub-nav partial

2. theme/templates/partials/portal-nav.html - secondary nav per docs/01-sitemap.md § 1.4

3. src/shared/api/memberContext.ts (from Prompt D1) - refine the typing to match the injected shape, expose useMemberContext() hook for React components

Acceptance:
- Visiting /portal/ as a non-member redirects to login
- Visiting as a member exposes window.__WELD_MEMBER__ with all expected fields
- Portal nav shows correct active state per current URL

Commit on branch `feat/portal-layout`.
```

### Prompt F3 - `member-dashboard` React island

```
Read docs/02-module-catalog.md § 4.1 and CLAUDE.md § 6.4.

Build the dashboard module and React app:
- theme/modules/member-dashboard.module/ (fields.json verbatim from catalog § 4.1)
- src/modules/member-dashboard/index.tsx
- src/modules/member-dashboard/Dashboard.tsx - orchestrator that renders tiles in editor-configured order from props.tiles
- src/modules/member-dashboard/tiles/ - one component per tile_type:
  - WelcomeBanner.tsx
  - SmartAlerts.tsx
  - MembershipStatus.tsx
  - Certifications.tsx
  - UpcomingCourses.tsx
  - RegisteredEvents.tsx
  - InvoicesAndReceipts.tsx
  - GeoLocalisedEvents.tsx (with national toggle)
  - CorporateAdminEntry.tsx (only renders if memberContext.entitlements.is_primary_admin)
  - ResourcesForYou.tsx
  - CustomCta.tsx

Each tile:
- Has its own loading skeleton (LoadingSkeleton from shared/components)
- Has an empty state
- Has an error state (via ErrorBoundary)
- Reads data from useMemberContext() OR fetches from HubDB via shared/api/hubdb.ts
- Is independently rendered (one tile crashing doesn't crash the dashboard)

Build theme/templates/pages/dashboard.html using the portal layout and embedding member-dashboard module with sensible default tiles.

Acceptance:
- Dashboard renders within 2s on throttled 4G in Chrome devtools
- All tiles selectable in the editor; reordering changes display order
- Toggling tile_visible hides/shows the tile
- Tile heading override updates the rendered heading
- Three test contacts (active corporate gold admin, individual apprentice, lapsed member) each see appropriate tiles and content

Commit on branch `feat/module-member-dashboard`.
```

### Prompt F4 - `profile-form`, `subscription-preferences`, `linked-associations`

```
Read docs/02-module-catalog.md § 4.2, § 4.3, § 4.4. Build the My Profile page.

Build:
- theme/modules/profile-form.module/ (HubL + minimal JS - uses HubSpot Forms API to update the contact)
- theme/modules/subscription-preferences.module/ (wraps HubSpot's subscription preferences API)
- theme/modules/linked-associations.module/ (read-only HubL list of associations)
- theme/templates/pages/profile.html using portal layout

Profile form must:
- Pre-fill from current contact properties
- Only show fields editable per the editor's `editable_fields` config
- POST to HubSpot Forms API (or contact properties update API) on submit
- Show inline field validation + the editor-configured success message
- Honour the editor's `show_password_change_link` toggle

Subscription preferences:
- Render only the editor-selected `subscription_options`
- POST to /communication-preferences/v3 API
- Honour `show_unsubscribe_all`

Linked associations:
- Read all Company associations on the current contact
- Show role label per association
- "Request change" link goes to the editor-configured destination

Acceptance:
- Profile updates persist on the contact record
- Subscription toggle updates immediately reflect in HubSpot
- Linked associations shows all companies + role labels correctly

Commit on branch `feat/portal-profile`.
```

### Prompt F5 - `certifications-list`, `certification-guidance`

```
Read docs/02-module-catalog.md § 4.5, § 4.6. Build the certifications portal pages.

Build:
- theme/modules/certifications-list.module/ - reads contact's certification property groups (as1796_status, iiw_status, iso3834_individual_status, etc.), renders a card per certification with status, expiry, certificate download, "View progress" link
- theme/modules/certification-guidance.module/ (React island) - full guidance page per certification type
- theme/templates/pages/certifications-list.html
- theme/templates/pages/certification-guidance.html (dynamic page bound to URL pattern /portal/certifications/{type}/)

The guidance React component:
- Reads {certification_type} from the URL
- Reads the contact's current_certification_step for that cert from memberContext
- Fetches HubDB Table 4 row for (cert_type, step) → renders the guidance_text and evidence_checklist
- Renders a visual progress bar of pipeline stages
- Renders the evidence upload form using evidence_form_id from editor

Acceptance:
- A test contact with mock as1796_status renders the AS1796 guidance correctly
- Editing a HubDB Table 4 row updates the guidance text on the next page load
- Multiple concurrent certifications render side-by-side on certifications-list

Commit on branch `feat/portal-certifications`.
```

### Prompt F6 - My Courses, My Events, My Invoices

```
Read docs/01-sitemap.md § 4.6, § 4.7.

Build:
- theme/modules/my-courses.module/ (small specialisation of featured-courses showing only contact's Won Training Deals)
- theme/modules/my-events.module/ (similar for Event Ticket Deals)
- theme/modules/my-invoices.module/ (Deals with xero_invoice_pdf_url, downloadable receipts)
- theme/templates/pages/my-courses.html
- theme/templates/pages/my-events.html
- theme/templates/pages/my-invoices.html

Each module:
- Reads the contact's associated Deals via HubL (or the CRM Search API server-side rendered to JSON props)
- Filters by deal_type
- Tab switcher between Upcoming / Past
- Mobile: cards; desktop: table

Invoices module gracefully handles missing xero_invoice_pdf_url with "Receipt processing - check back shortly" per CLAUDE.md § 10.1.

Acceptance:
- All three pages render for a test contact with mock Deal data
- Calendar download works for upcoming events
- PDF receipt links open the actual Xero PDF
- Empty states show useful guidance + CTAs

Commit on branch `feat/portal-my-stuff`.
```

### Prompt F7 - `corporate-admin` React island

```
Read docs/02-module-catalog.md § 4.7 and CLAUDE.md § 6.6.

Build the Manage My Team experience:
- theme/modules/corporate-admin.module/
- src/modules/corporate-admin/ (React app)
- theme/templates/pages/corporate-admin.html (uses portal layout, page-level gate: only renders if memberContext.entitlements.is_primary_admin)

React app:
- Company hierarchy tree (parent + child companies the admin manages)
- Voucher tracker (visual progress bar) per company
- Employee list: searchable, sortable, bulk-selectable
- Add Employee modal (uses the editor-configured add_employee_form_id HubSpot form)
- Remove Employee action: archives the association label via API (does NOT delete the contact)
- Bulk Register modal: pick a session from HubDB Table 1 → POSTs N Deals (one per selected employee) into the Training pipeline → decrements voucher counter
- Activity log section: recent admin actions

Use the HubSpot CRM Search API for employee lookup via the contact's company associations.

Acceptance:
- Non-admin contact visiting /portal/team/ is redirected to /portal/
- Admin sees only their company hierarchy
- Adding an employee creates the contact and applies the Employee association label
- Bulk register handles partial failures and surfaces them clearly
- Voucher counter updates within 30s of bulk registration

Commit on branch `feat/module-corporate-admin`.
```

### Prompt F8 - `checkout-tunnel` React island

```
Read docs/02-module-catalog.md § 4.8 and CLAUDE.md § 6.7.

Build:
- theme/modules/checkout-tunnel.module/
- theme/modules/checkout-confirmation.module/
- src/modules/checkout-tunnel/
- theme/templates/pages/checkout.html (uses checkout.html LAYOUT - distraction-free)
- theme/templates/pages/checkout-confirmation.html

Steps in the React app per the catalog:
1. Confirm session (read ?session_id, validate against HubDB Table 1, show summary)
2. Identify (logged in: skip; logged out: email lookup → existing → login redirect, new → guest checkout fork OR sign up offer)
3. Discount preview (read memberContext.contact.membership_tier → apply member rate → show savings in --wa-color-success bold)
4. Payment (handoff per editor's payment_provider field: hapily redirect, Stripe inline using publishable_key, or generic external redirect)
5. On payment success, server creates the Deal in Training pipeline (use Forms API or webhook to Ollie's backend) and redirects to confirmation_redirect

Confirmation page module:
- Receipt summary (course, date, location, amount paid)
- Add to calendar (.ics file generation client-side)
- Zoom join link if event has one
- "Back to dashboard" or editor-configured next_step CTA

Fire `member_discount_applied` GA4 event when step 3 displays a discount.

Acceptance:
- Member discount visible from step 3 onwards
- Logged-out flow does not require account creation
- Confirmation page includes everything user needs immediately
- Editor can swap payment_provider and the flow adapts
- Step labels editable from page editor

Commit on branch `feat/module-checkout-tunnel`.
```

### Prompt F9 - `profile-switcher` (header utility on portal layout)

```
Read CLAUDE.md § 6.5.

Build:
- src/modules/profile-switcher/ (React island)
- theme/modules/profile-switcher.module/ (or fold it into header.module via an editor toggle - your choice; document the decision)

Wire it into the portal layout so it appears in the header utility nav for any logged-in user with 2+ associations.

Logic:
- Read memberContext.associations
- If length < 2 → render nothing
- Else → dropdown listing each context (e.g. "Personal - Apprentice", "ABC Welding Pty Ltd - Employee")
- Active context highlighted
- Selecting writes wa_active_context cookie + reloads relevant tiles via custom event "weld:context-changed" (dashboard tiles listen and refetch)

The Resources Hub gating evaluator must continue to UNION all entitlements regardless of selected context (per CLAUDE.md § 6.5).

Acceptance:
- User with one association sees no switcher
- User with multiple sees dropdown
- Switching context updates dashboard tiles without full reload
- Resources Hub access remains unioned across contexts

Commit on branch `feat/module-profile-switcher`.
```

---

## Phase G - Integration glue

### Prompt G1 - GA4 + GTM events

```
Read CLAUDE.md § 10.3.

Wire the editor-configurable GTM container into base.html and emit custom events for:
- resource_locked_view
- resource_download
- member_discount_applied
- corporate_bulk_registration

Each event should fire from the relevant React island via window.dataLayer.push().

Add a theme-level field on theme.json or a global content snippet for the GTM container ID so editors can configure it without code.

Acceptance:
- GTM container loads on every page
- All four custom events fire and appear in GTM Preview mode
- Events include relevant context properties (resource_id, course_id, savings_amount, employee_count)

Commit on branch `feat/analytics`.
```

### Prompt G2 - HubSpot Behavioural Events for resource downloads

```
Set up a HubSpot custom Behavioural Event "resource_downloaded" with properties: resource_id, resource_title, member_tier_at_download, file_type. Wire it in resource-library React island to fire on every download click.

Document the event schema in workflows/behavioural-events.md so Ollie can hook workflows off it.

Acceptance:
- Behavioural event appears on the contact's timeline after a download
- Properties populate correctly

Commit on branch `feat/behavioural-events`.
```

### Prompt G3 - event.hapily wiring

```
Coordinate with Ollie to confirm event.hapily is installed in the sandbox. Then update the checkout-tunnel module's payment_provider=hapily flow to redirect to the actual hapily checkout URL (per HubDB Table 1 row's registration_url).

For each course session HubDB row, registration_url should already point at the hapily checkout for that session (Ollie owns populating this). Document the contract in workflows/hapily-integration.md.

Acceptance:
- Clicking Register in the course-filter or course-timetable-filter redirects to the correct hapily URL
- Hapily registration syncs back to HubSpot as a Training Deal (Ollie's workflow)
- Member tier is preserved through the checkout (URL parameter or cookie, document the approach)

Commit on branch `feat/hapily-wiring`.
```

---

## Phase H - Quality gates and launch

### Prompt H1 - Accessibility audit and fixes

```
Run a WCAG 2.1 AA audit on all public pages and member portal pages.

Use axe-core (via Playwright + @axe-core/playwright) to automate the audit. Write tests/a11y/*.spec.ts that visit each page and assert zero serious/critical violations.

Manually verify:
- Keyboard navigation works on every interactive element (course filter, find a member filter, dashboard tiles, checkout)
- Focus traps in modals (add employee, bulk register, resource detail modal)
- Skip-to-content link works
- Colour contrast passes for member tier badges (Gold on white, Silver on white, Bronze on white)
- 44×44px touch targets on all clickable elements

Fix every serious/critical violation. Document any remaining minor violations and rationale.

Acceptance:
- axe-core suite passes for all pages
- Manual keyboard test passes
- Lighthouse a11y score ≥ 95 on all pages

Commit on branch `chore/a11y-pass`.
```

### Prompt H2 - Performance pass

```
Run Lighthouse on Home, Resources, Course (standard), Course (sales), Member Dashboard. Target:
- Mobile performance ≥ 85
- Desktop performance ≥ 95
- LCP < 2.5s on mobile
- CLS < 0.1
- TBT < 200ms

Optimisations:
- Audit React island bundle sizes (each module < 80KB gzipped)
- Code-split where possible (lazy-load slider JS for testimonial-slider, lazy-load tile components in dashboard)
- Image: use HubSpot's image widget with responsive srcset, lazy loading, modern formats (WebP/AVIF)
- CSS: ensure tokens.css + base.css + utilities.css are critical-inlined for above-the-fold; everything else loads async
- Fonts: preload primary woff2 files, font-display: swap

Acceptance:
- All target Lighthouse scores met
- Bundle size budget tracked in scripts/check-bundle-size.ts (fails build if exceeded)

Commit on branch `perf/lighthouse-pass`.
```

### Prompt H3 - Cross-device + cross-browser QA

```
Run the full sandbox site through:
- Chrome latest (mac, windows)
- Safari latest (mac, ios)
- Firefox latest
- Edge latest
- iOS Safari on iPhone 12+ (real device)
- Android Chrome on a Pixel-class device (real device)

Test:
- Header nav (desktop + mobile hamburger)
- Course filter on a course page
- Find a Member filter and pagination
- Resource library locked vs unlocked states
- Login → dashboard → log out flow
- Profile edit + save
- Add employee + bulk register (corporate admin)
- Checkout end-to-end

Log every issue to bugs/qa-log.md with browser, device, severity, repro steps. Fix all P1/P2 before launch.

Acceptance:
- Zero P1 bugs
- < 3 P3 bugs documented for post-launch

Commit on branch `chore/qa-pass`.
```

### Prompt H4 - Content load + UAT

```
Coordinate with Danielle Pennington to load real Weld Australia content into the sandbox:
- Real course schedules (Ollie owns CRM data; populate HubDB Table 1)
- Real member directory (HubDB Table 2)
- Real team & board (HubDB Table 3)
- Real resources (HubDB Table 5)
- Real homepage hero, About copy, Membership tier copy, Training hub copy

Run UAT with the Weld Australia team (Danielle, Ben Mitchell, Q&C team for certification flows, Membership team for portal flows). Capture feedback in docs/uat-feedback.md.

Acceptance:
- Sandbox is fully populated with real content
- UAT signoff received from Ben Mitchell
- All UAT feedback either implemented or documented as wishlist post-launch

Commit on branch `chore/uat`.
```

### Prompt H5 - DNS cutover plan + go-live

```
Read CLAUDE.md § 12 acceptance criterion #10.

Prepare for the production cutover:

1. Pull GA4 last-90-days top-50 URLs from analytics
2. For each, verify a 1:1 mapping exists on the new HubSpot site OR a redirect is configured
3. Build a redirect map (/redirects.json or HubSpot's URL Mappings) covering:
   - Legacy WordPress URL → new HubSpot URL for each top-50 page
   - Common variants (trailing slash, .html, capitalisation)
4. Stage the cutover with the Weld Australia hosting/DNS provider:
   - Lower DNS TTL to 300s 24h before cutover
   - Configure HubSpot's CMS domain settings for weldaustralia.com.au + www
   - Verify SSL provisioning
5. Cutover window: schedule for low-traffic time, allow 2-hour window, have rollback plan documented in workflows/cutover-rollback.md

After cutover:
- Monitor 404s in HubSpot Settings → SEO and Crawler tools for 24h
- Monitor GA4 for traffic drops
- Verify CAMS decommissioning checklist complete

Acceptance:
- Cutover completes within window
- Zero 404s on top-50 URLs after 24h
- All Phase 1 launchpad acceptance criteria from CLAUDE.md § 12 met

Commit on branch `chore/cutover`.
```

---

## Quick-reference: which prompt to start with today

If you're picking this up cold:

1. **Prompt A1** - scaffold the repo (1-2 hours).
2. Then A2 → A3 → A4 in order (Phase A is foundational; everything else depends on it).
3. Phase B can be parallelised across multiple Claude Code sessions if needed (the modules don't depend on each other within a phase).
4. Phase C runs alongside Phase B (HubDB seeding doesn't block module dev).
5. Phase D depends on A1-A4 + C1.
6. Phase E depends on D (the React islands).
7. Phase F is self-contained per prompt but assumes Phase A + D.
8. Phases G + H come last.

If a prompt fails or produces something off-spec, **don't move on** - push back, fix, then continue. Each commit message should reference the prompt number (e.g. `[Prompt D2] feat: build course-filter react island`).

- end of build prompts -