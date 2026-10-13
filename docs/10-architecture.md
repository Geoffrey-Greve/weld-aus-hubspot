# Architecture

How the pieces fit together, and which layer owns what. For the commercial and
scope context, read [`../CLAUDE.md`](../CLAUDE.md) first.

---

## 1. The constraint that shapes everything

Weld Australia is on **HubSpot Content Hub Professional**. Two consequences run
through the whole build:

1. **No native Custom Objects.** Membership, training, certification and events
   are expressed with standard objects (Contacts, Companies, Deals, Products,
   Tickets) plus HubDB and Association Labels. See CLAUDE.md § 2.1 and § 8.
2. **No JS Building Blocks** (the Enterprise-only React module type) and **no
   Design Manager serverless functions**. Interactive UI is therefore a
   *React island*: HubL renders a mount point with server-serialised props and
   a plain `<script type="module">` loads the compiled bundle. Server-side
   writes that would need serverless (`corporate.functions/`) are staged in the
   repo but skipped on upload unless `--with-serverless` is passed.

Everything else follows from those two facts.

---

## 2. Layers

```
┌────────────────────────────────────────────────────────────────────────┐
│ Browser                                                                │
│   critical.css + per-page CSS   React islands (per-module bundles)     │
│   window.__WELD_MEMBER__        vanilla JS widgets (src/vanilla/)      │
└───────────────▲────────────────────────────────▲───────────────────────┘
                │ server-rendered HTML + props   │ fetch()
┌───────────────┴────────────────────────────────┴───────────────────────┐
│ HubSpot CMS (portal 441838610)                                         │
│   layouts  → base.html · portal.html · checkout-layout.html            │
│   pages    → theme/templates/pages/*.html (+ HubDB dynamic pages)      │
│   partials → header/footer, member-tier + member-pricing macros        │
│   modules  → 102 *.module folders (HubL only, or HubL + island)        │
└───────────────▲──────────────────▲─────────────────▲──────────────────┘
                │                  │                 │
     ┌──────────┴───────┐  ┌───────┴───────┐  ┌──────┴──────────────────┐
     │ CRM              │  │ HubDB         │  │ External               │
     │ Contacts         │  │ 12 tables     │  │ Event Engine (Worker)  │
     │ Companies        │  │ courses,      │  │ Xero (via HubSpot)     │
     │ Deals            │  │ members,      │  │ GTM / GA4              │
     │ Association      │  │ resources,    │  │ HubSpot Forms API      │
     │ Labels           │  │ events, jobs… │  │                        │
     └──────────────────┘  └───────────────┘  └────────────────────────┘
```

**Rule of thumb for where logic lives:**

| Concern | Owner | Why |
|---|---|---|
| Entitlement, tier resolution, gating | HubL (server) | The client can be tampered with, and gating must be evaluated per request |
| Price resolution | Both, kept in parity | HubL for server-rendered cards, TS for islands. See [16-membership-and-pricing.md](./16-membership-and-pricing.md) |
| Filtering, sorting, switching | React island (client) | Instant, no reload, data already in props |
| Content, static sections | HubL module | No bundle cost, editable in the page editor |
| Row data | HubDB | Editable by Weld Aus without a deploy |
| Member data | CRM, read-only from the frontend | Workflows own writes (Ollie) |

---

## 3. Request lifecycle

### 3.1 A public page

1. HubSpot resolves the URL to a page whose template is one of
   `theme/templates/pages/*.html`.
2. The template `{% extends "../layouts/base.html" %}` and fills `body`.
   `base.html` includes `_head.html` (title, OG tags, GTM, favicons, fonts,
   `critical.css`, brand-kit overrides from theme settings), the skip link, the
   header partial, `<main id="main-content">`, the brand accent line and the
   footer.
3. Content comes from one of three places, and this is the part that surprises
   people: most page templates carry their content **inline as `dnd_module`
   defaults** (see `theme/templates/pages/home.html`). The template supplies the
   first-load content; once a page is created in HubSpot, editors override those
   values and the template no longer dictates them.
4. HubDB-backed modules call `hubdb_table_rows(...)` at render time.
5. Interactive modules serialise their rows plus editor fields plus the
   visitor's resolved tier into `data-props` and emit the island's script tag.

### 3.2 A HubDB dynamic page

Five tables have `useForPages: true`, so one template serves many URLs:

| Table | URL pattern | Template |
|---|---|---|
| `courses` | `/courses/{course_slug}` | `course-router.html` → `course.html` or `course-sales.html` |
| `events` | `/events/{slug}` | `event-detail.html` |
| `resources` | `/resources/{slug}` | `resource-detail.html` |
| `jobs` | `/job-board/{slug}` | `job-detail.html` |
| `team_and_board` | `/about/team/{hs_path}` | `about-team.html` |
| `certification_pathways` | `/certification/{slug}` | `certification.html` |

The row is available as `dynamic_page_hubdb_row`. `course-router.html` reads
`parent_template` off the row and delegates, which is how one URL space carries
both the standard and the high-polish sales layout.

### 3.3 A portal page

1. `portal.html` extends `base.html`, adds `is-portal` to the body and injects
   `window.__WELD_MEMBER__` in `extra_head`.
2. The primary gate is the **page-level HubSpot Private Content audience**, set
   in HubSpot, not in code. The visible sign-in panel in `portal.html` is the
   fallback for a page whose audience was never configured.
3. Editor and preview contexts (`is_in_editor`, `hs_preview`,
   `?portal_preview=1`) get a hard-coded mock context so the page builder never
   renders a blank body. That mock reads no CRM data.
4. Islands read the context with `useMemberContext()` and treat it as read-only.

Full detail: [16-membership-and-pricing.md](./16-membership-and-pricing.md).

---

## 4. Repo map

```
config/            Single-source-of-truth JSON that GENERATES code
  course-categories.json   → course-taxonomy.html + courseTaxonomy.ts
  header-menu.json         → the header module's fallback menu
hubdb/             HubDB table schemas (canonical; the portal is downstream)
src/
  modules/<name>/index.tsx   One React island entry per folder
  shared/          api clients, UI primitives, utils, design tokens, mount
  styles/          tokens.css source consumed by the TS side
  test/            Vitest suites that read theme source (regression guards)
  vanilla/         Non-React browser JS, copied into theme/assets/js
scripts/           build, upload, validate, bundle budget, seed, backfills
theme/             Exactly what `hs upload` pushes
  templates/{layouts,pages,partials,system,email}
  modules/*.module (102)
  assets/{css,js,img,fonts}
  data-queries/    GraphQL data query for the CRM-backed member directory
  theme.json, fields.json (theme settings = the brand kit)
tests/
  a11y/            Playwright + axe specs
  unit/            Vitest specs that are not colocated with a component
a11y/              Static fixtures the a11y specs load (served by Vite)
corporate.functions/  Design Manager serverless (Enterprise only, opt-in upload)
workflows/         Documentation of the HubSpot workflows the frontend needs
bugs/qa-log.md     The QA defect log
```

### 4.1 What is generated, and never hand-edited

`pnpm build` writes these. CI fails any PR where a clean build changes a
committed file, so hand edits are caught rather than silently reverted.

| Artefact | Generated from |
|---|---|
| `theme/assets/css/critical.css` | tokens, reset, base, utilities, components, hero module CSS (gitignored) |
| `theme/templates/partials/course-taxonomy.html` | `config/course-categories.json` |
| `src/shared/courseTaxonomy.ts` | `config/course-categories.json` |
| The fallback menu block in `theme/modules/header.module/module.html` | `config/header-menu.json` |
| The `<script>` / `<link>` tag in each island's `module.html` | the Vite standalone build |
| `theme/assets/js/**` | Vite (gitignored, except `src/vanilla` copies) |

Detail: [12-build-pipeline.md](./12-build-pipeline.md).

---

## 5. Data flow for the interactive surfaces

There are 14 React islands with their own bundles. Their data comes from HubL
props at render time, not from a client fetch, with three exceptions.

| Island | Props source | Client calls |
|---|---|---|
| `course-filter`, `course-timetable-filter` | `courses` rows + resolved tier | Event Engine availability (advisory) |
| `find-a-member` | `members` rows, pre-sorted by tier | none |
| `resource-library` | `resources` rows with `locked` computed in HubL | behavioural event on download |
| `member-dashboard`, `member-command-centre` | `window.__WELD_MEMBER__` + HubDB tiles | none |
| `my-courses`, `my-events`, `my-invoices` | portal props | none |
| `corporate-admin` | company + associated contacts | `corporate.functions` or Worker |
| `checkout-tunnel`, `checkout-confirmation` | session row + tier | Event Engine reserve/order polling |
| `certification-guidance` | `certification_guidance` rows | none |
| `jobs-listing` | `jobs` rows | none |

Server-rendered props are the default because they remove a round trip, keep the
first paint complete, and keep entitlement decisions server-side.

---

## 6. Deployment topology

```
Local           pnpm dev (Vite :5173) + hs watch
   │
   ├─ PR ──────► CI: validate.yml (spec) + build.yml (build, typecheck, test,
   │                 idempotency)
   │
   └─ main ────► deploy.yml (workflow_dispatch, type "deploy", main only)
                     └─► pnpm build → scripts/upload.ts --env=production
                            └─► portal 441838610 (weldaustralia.com.au)
```

Merging does not deploy. Staging (443253065) and production (441838610) are
**different portals**, and `--env` names exactly one of them: there is no
fallback between them, so an unauthenticated staging portal is a hard error
rather than a silent upload to the live site. See
[`../DEPLOYMENT.md`](../DEPLOYMENT.md).

---

## 7. Deliberate design decisions worth knowing

- **Stable bundle filenames, not content hashes.** `get_asset_url()` adds
  HubSpot's own cache-buster, so hashing in the filename only churned
  `module.html` on every build and caused cross-branch conflicts. Islands ship
  as `<name>.standalone.js`.
- **One self-contained bundle per island.** Islands do not share a runtime
  chunk on the portal, because a missing shared chunk during the deploy window
  breaks every island at once. The budget is 80 KB gzip per entry.
- **Pricing logic exists twice, guarded by a parity test.** HubL macros serve
  server-rendered cards; `src/shared/utils/memberPricing.ts` serves islands.
  `memberPricingParity.test.ts` fails the build if they drift.
- **Tier sentinels are scrubbed centrally.** HubSpot stores "no membership" as a
  label ("Not Applicable", "Non Member", …), not an empty string, so a bare
  truthiness test reads it as a real membership. `_member-tier.html` is the one
  implementation of that rule.
- **The theme validator runs locally.** HubSpot only validates on upload and
  fails on the first error, so `scripts/validate-theme.ts` reports every
  violation in one pass before you push.
- **Uploads are batched and ordered.** Partials before layouts before pages
  before modules, because HubSpot validates `{% import %}` against what is
  already on the portal. Assets go first so islands never 404 mid-deploy.
