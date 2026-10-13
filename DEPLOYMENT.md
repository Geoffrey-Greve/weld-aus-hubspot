# Deployment Guide - Weld Australia HubSpot Theme

How to get this repo built and live on HubSpot, what you need installed, and the
non-obvious traps that make "the code is merged" **not** the same as "the change is live."

Read this alongside [`README.md`](./README.md) (project overview, design tokens) and
[`CLAUDE.md`](./CLAUDE.md) (full technical brief).

---

## TL;DR - the one thing to understand

**There is no automatic deployment on merge.** Merging a PR to `main` does **not** push
anything to HubSpot. CI on every PR and push runs `validate.yml` (`pnpm validate`) and
`build.yml` (typecheck, full build, tests, build-idempotency) - neither uploads anything.
Deploying is `deploy.yml`, which is `workflow_dispatch` only: it requires the confirmation
text `deploy` **and** the `main` ref (see § 12). Everything below is the equivalent manual
path, and the one to use for the sandbox or for a partial upload.

Getting code live is a **manual, two-part job every time:**

1. **Build** the React islands and CSS locally (`pnpm build`) - the compiled output is
   *not* committed to git, so it must be regenerated before every upload.
2. **Upload** the `theme/` folder to the HubSpot portal with the HubSpot CLI, then do the
   **HubSpot-side configuration** that an upload can't do (create/assign pages, publish
   HubDB, set Private Content).

Skip the build and you ship stale/missing interactive modules. Skip the HubSpot-side steps
and you get 404s and "old data" even though the upload "succeeded."

---

## 1. Dependencies

| Requirement | Version | Notes |
|---|---|---|
| Node.js | `>=22` | `engines.node` in `package.json`. Use `nvm use 22`. Required by pnpm 11. |
| pnpm | `11.27.0` | Pinned via `packageManager`. Enable with `corepack enable`. |
| HubSpot CLI | **local `@hubspot/cli` 8.15.x** (a devDependency in `node_modules`) | **Do not use a globally-installed CLI for uploads** - see §4.1. |
| A HubSpot Personal Access Key | per developer | Written into a gitignored `hubspot.config.yml`. |

Install everything:

```bash
nvm use 22
corepack enable
pnpm install          # also installs the local hs CLI into node_modules/.bin
```

---

## 2. HubSpot portals - get these right first

There are **three** portals referenced across this repo. Mixing them up is a common cause
of "I uploaded but nothing changed" (you uploaded to a portal you weren't looking at).

| Account name (CLI config) | Portal ID | `--env` | What it is |
|---|---|---|---|
| `weld-australia-staging` | **`443253065`** | `staging` | **The Weld Australia staging portal - prove changes here first.** |
| `weld-australia` | **`441838610`** | `production` | **The LIVE weldaustralia.com.au site.** |
| `refuelcreative` | `4538263` | — | Refuel Creative **agency** portal - **not** Weld Australia. |

> ⚠️ **Corrected 2026-09-18.** This repo previously documented and implemented
> "staging IS production (same portal, two names)", with `441838610` labelled
> staging and `443253065` labelled "sandbox". That was wrong, and it meant
> **`pnpm upload:staging` deployed to the live site.** Staging is `443253065`.
> Production is `441838610`. If you have old notes, a shell alias or a CI job
> that says otherwise, they are the ones that need updating.

> `README.md` and `hubspot.config.example.yml` also once listed `4538263` as the
> Weld "production" portal. That is the agency portal, not Weld's.

`hsproject.json` and `scripts/lib/hubspot-auth.ts` (`ACCOUNT_MAP`) are the source
of truth for portal IDs. `scripts/lib/hubspot-portals.test.ts` fails the build if
they disagree with each other or with the `pnpm upload:*` scripts.

```json
{ "accounts": {
  "staging":    { "name": "weld-australia-staging", "portalId": 443253065 },
  "production": { "name": "weld-australia",         "portalId": 441838610 }
}}
```

**No fallback between portals.** `--env` names one portal and that is the only
one touched. An unauthenticated staging portal is a hard error telling you to run
`hs auth` - it used to silently redirect the deploy to production instead.
`--env=sandbox` is accepted as the old name for staging: it warns, and resolves
to `443253065`.

---

## 3. Authenticate (once per machine)

`hubspot.config.yml` holds your access keys and is **gitignored - never commit it.**

```bash
cp hubspot.config.example.yml hubspot.config.yml
# Authenticate against the staging portal (opens a browser to mint a Personal Access Key):
./node_modules/.bin/hs auth --config=hubspot.config.yml
```

Make sure the account **name** in your `hubspot.config.yml` matches what you pass to
`--account=` at upload time (e.g. `weld-australia-staging`). Expected shape:

```yaml
defaultPortal: weld-australia-staging
portals:
  - name: weld-australia-staging
    portalId: 443253065
    authType: personalaccesskey
    personalAccessKey: pat-ap1-…
  - name: weld-australia
    portalId: 441838610
    authType: personalaccesskey
    personalAccessKey: pat-ap1-…
```

---

## 4. Build & upload the theme

### 4.1 The reliable path (use this)

```bash
# 1. Build React islands + CSS (regenerates gitignored output - required every time)
pnpm build

# 2. Upload the theme with the LOCAL CLI binary
#    macOS / Linux:
./node_modules/.bin/hs cms upload theme weld-australia-theme \
  --account=weld-australia-staging --config=hubspot.config.yml
```

On Windows (PowerShell), the equivalent verified command is:

```powershell
pnpm build
.\node_modules\.bin\hs.CMD cms upload theme weld-australia-theme --account=weld-australia-staging --config=hubspot.config.yml
```

> **Why the local binary?** HubSpot CLI 8 **refuses `hs cms upload` when an
> `hsproject.json` is present** — it wants `hs project upload` instead, which is a
> different (projects) deployment model this theme does not use. Use
> `node_modules/.bin/hs` (the pinned `@hubspot/cli@8.15.0`) and let
> `scripts/upload.ts` park `hsproject.json` for the duration of the Design-Manager
> theme upload.

### 4.2 The `pnpm` shortcuts - and their caveat

```bash
pnpm upload:staging   # = pnpm build && tsx scripts/upload.ts --env=staging      → 443253065
pnpm upload:prod      # = pnpm build && tsx scripts/upload.ts --env=production   → 441838610 (LIVE)
pnpm upload:sandbox   # legacy alias for upload:staging - warns, goes to 443253065
```

`scripts/upload.ts` prefers `node_modules/.bin/hs` (the pinned `@hubspot/cli@8.15.0`)
and parks `hsproject.json` during the upload so CLI 8 will still run `hs cms upload`.
If the local binary is missing it falls back to PATH `hs`, which can still hit the
§4.1 block. Prefer the `pnpm upload:*` scripts or the explicit local-binary command.
Both `--env` values require the matching portal name in `hubspot.config.yml`. Add
`--dry-run` to print the command without uploading.

> **⚠ A staging upload can no longer reach the live site.** Staging (443253065) and
> production (441838610) are different portals, and there is **no credential fallback
> between them**. If staging is not authenticated the upload fails and tells you to run
> `hs auth` - it does not redirect to production, which is what it used to do. Reaching the
> live site means typing `--env=production`.
> The uploader also **aborts on the first failed batch** (rather than continuing and
> publishing HTML that references a bundle whose upload failed); re-run to resume.

### 4.3 Full theme vs. focused upload

Historically deploys were done **per-module** (a single `module.html` + `critical.css`) to
save time. That is the main reason ~40 merged PRs never fully appeared: each focused upload
only carried the file it named. **Always upload the whole `theme/` directory** (the commands
above do) so every merged change lands together. Only reach for a single-file upload for a
quick hotfix, and follow it with a full upload.

### 4.4 Corporate team serverless (`corporate.functions/`)

Issue 8 (admin add/remove team members) is served by Design Manager serverless functions at
repo-root [`corporate.functions/`](./corporate.functions/). **Requires Content Hub
Enterprise** — Weld Aus is on Professional, so `pnpm upload:*` **skips** this folder by
default (HubSpot rejects `.functions` on Pro and used to abort the theme deploy). Pass
`--with-serverless` only after an Enterprise upgrade:

```bash
tsx scripts/upload.ts --env=production --with-serverless
```

On Enterprise, that upload lands at the **Design Manager root** (not inside the theme) so
endpoints resolve at:

- `POST /_hcms/api/corporate/add-employee`
- `POST /_hcms/api/corporate/remove-employee`

**One-time secret per portal** (required before add/remove succeed):

1. In HubSpot: **Development → Keys → Service Keys** → create a key with contacts +
   companies (+ associations) read/write scopes. Copy the key.
2. Store it as a Design Manager serverless secret (CLI — account name must match
   `hubspot.config.yml`, commonly `weld-australia`):

```bash
./node_modules/.bin/hs secrets add hubspot_service_key \
  --account=weld-australia --config=hubspot.config.yml
```

Paste the Service Key when prompted. Do **not** use a private app token. Full contract:
[`docs/corporate-team-management-api.md`](./docs/corporate-team-management-api.md).

Smoke-test after deploy: sign in as a corporate Admin → `/portal/team` → Add employee should
be an inline form (not a mailto link).

---

## 5. What the build actually does (`scripts/build.ts`)

`pnpm build` = `tsx scripts/build.ts && tsx scripts/validate-theme.ts && tsx scripts/check-bundle-size.ts`.
The build step:

1. **Generates `theme/assets/css/critical.css`** by concatenating, in cascade order,
   `tokens → reset → base → utilities → components` from `theme/assets/css/`.
   `_head.html` loads this single file. It is a **build artifact - gitignored, never
   committed or hand-edited**. Edit the five source files; the build regenerates it.
2. **Builds one self-contained standalone bundle per React island** with Vite from
   `src/modules/*/index.tsx` into `theme/assets/js/` as `<name>.standalone.js` /
   `assets/<name>.standalone.css`, and writes `theme/assets/js/manifest.json`.
   Filenames are **stable (un-hashed)** - HubSpot cache-busts `get_asset_url()` on
   upload, so committed `module.html` never carries a rotating hash (no per-build churn,
   no cross-branch conflicts on bundle tags). The 14 islands: `member-command-centre`,
   `member-dashboard`, `checkout-tunnel`, `checkout-confirmation`, `course-filter`,
   `course-timetable-filter`, `certification-guidance`, `corporate-admin`, `find-a-member`,
   `resource-library`, `jobs-listing`, `my-courses`, `my-events`, `my-invoices`.
3. **Patches the stable `<script>`/`<link>` tags** into each island's `module.html` (and
   the course-router / course-timetable-hub templates), replacing the `{# @bundle: <name> #}`
   placeholder (first build) or the previous tag (idempotent on rebuild).
4. **Stabilises CSS-only modules** (`events-listing`, server-rendered) so their reused
   component CSS is referenced by a stable name instead of a rotating hash.
5. **Restores hand-written vanilla JS** (`src/vanilla/*.js` → `theme/assets/js/`) that Vite's
   `emptyOutDir` would otherwise wipe (`news-articles-browser.js`, `testimonial-slider.js`).
6. **Bundles the vanilla TypeScript entries** (`src/vanilla/*.entry.ts` → `theme/assets/js/`,
   currently `event-availability.js`) as **IIFE**, un-hashed, so a non-React script can still
   import `@shared/…`. The events availability badge is built this way because it shares the
   Worker client and the status vocabulary with the course pages; a copied `.js` cannot
   import anything, which is how it came to carry its own drifting copy. The build fails if
   the output is not a classic script — the host templates load it without `type="module"`.
7. **Regenerates the header fallback menu** in `header.module/module.html` from
   `config/header-menu.json`. (Edit the JSON, not the generated block in `module.html`.)

Then `validate-theme.ts` runs the HubSpot spec checks **and an asset-reference
integrity gate**: every static `get_asset_url('…/assets/…')` must resolve on disk.
A dangling **JS/CSS** reference (stale bundle, or a theme uploaded without building)
is a hard error that fails the build; missing images/fonts are warnings.

### Why you must build before every upload

`theme/assets/js/` is **gitignored** (only `testimonial-slider.js` is tracked). A fresh
clone has **no** React bundles and **no** `manifest.json`. If you upload without building:

- the module HTML references bundle filenames that don't exist on the portal → islands don't
  mount → the Member Dashboard, Events listing, Course filter, Find-a-Member, Resource
  Library, and Checkout render empty or fall back to old behaviour.

---

## 6. HubDB (the data layer behind Events, Training, Find-a-Member, Courses)

"Events shows old data" / "Training shows old categories" is almost always **HubDB**, not
theme code. The tables live in HubSpot; the repo only holds their schema + seed JSON in
`hubdb/*.json`. Changing the JSON does nothing until you seed **and publish**.

```bash
# Create / update table schemas (columns, dynamic-page mapping):
pnpm seed:hubdb --env=production

# Populate demo rows (idempotent: purges draft rows, re-inserts, publishes):
pnpm seed:hubdb:demo --env=production   # flags: --dry-run --no-purge --only=courses
```

Credentials resolve via `scripts/lib/hubspot-auth.ts`: env token
(`HUBSPOT_ACCESS_TOKEN_PRODUCTION` / `HUBSPOT_ACCESS_TOKEN`) **or**, if unset, the same
CLI personal access key used by `pnpm upload:*` (`hubspot.config.yml` /
`~/.hscli/config.yml`). If uploads already work, seed/backfill should too — do not invent a
separate private-app token ritual. Prefer `pnpm seed:hubdb -- --env=production` so pnpm
does not swallow `--env`.

When theme code depends on new columns, **seed before upload**. Never hand-edit production
HubDB columns - change `hubdb/*.json`, commit, re-seed. HubDB has draft vs published state
and a cache TTL; a change is only public once **published**.

---

## 7. HubSpot-side steps an upload can NOT do

A theme upload ships templates and modules. It does **not** create pages, wire routes, or
gate content. These are done once in the HubSpot UI and are why portal subpages, `/subscribe`
and the `/training/…-courses/` division pages 404 on a fresh portal:

1. **Create each page and assign its template.** Every portal template
   (`dashboard.html`, `profile.html`, `certifications-list.html`, `my-courses.html`,
   `my-events.html`, `my-invoices.html`, `team.html`, …) needs a HubSpot page created at its
   route (`/portal/`, `/portal/profile/`, …) with the template assigned. Each template's
   header comment states the exact route. (Note: the `/portal/team/` page uses `team.html`,
   not the `corporate-admin.html` name some docs still reference.)
2. **Create the four training division pages.** Easy to miss, because a *single* template -
   `training-category.html`, which derives its division from the page URL - serves all four.
   Nothing about the upload hints that four pages are missing, and every link below 404s
   until they exist:

   | URL | Template |
   |---|---|
   | `/training/welding-inspection-courses/` | `training-category.html` |
   | `/training/welding-supervision-courses/` | `training-category.html` |
   | `/training/welding-coordination-courses/` | `training-category.html` |
   | `/training/short-courses/` | `training-category.html` |
   | `/training/welding-safety-courses/` | `welding-safety-courses.html` |

   What breaks while they are absent: the **Training dropdown** in the header (desktop and
   mobile), the **Training column** in the footer, the four division cards on `/training/`,
   the four division cards on `/courses/`, and the Career Pathways "View all … courses"
   buttons on `/training/`.

   The division list is **`config/course-categories.json`** - the same file that generates
   `course-taxonomy.html`. **Adding a bucket there means adding a page here.** Neither
   `pnpm build` nor an upload creates it.
3. **Enable dynamic pages on HubDB tables** that drive `/courses/{slug}`, `/events/{slug}`,
   `/about/team/{person-name}`, Find-a-Member, etc., and set the URL pattern + SEO columns.
   `scripts/seed-hubdb.ts` pushes `useForPages` and the `dynamicMetaTags` mapping, but **not**
   the URL pattern - that is always a manual step in the HubDB UI.
   - **Team & board profiles**: create the `/about/team/` page from `about-team.html`, then set
     it as the dynamic page for the `team_and_board` table.
   - **Every active row needs a Page path** — HubSpot only serves a detail URL for rows that
     have one, and rows added via the HubDB UI or a CSV import get none. Backfill them:
     ```bash
     pnpm backfill:paths -- --env=<env> --table=team_and_board --dry-run   # then without --dry-run
     ```
     Additive only: fills blank paths, writes no column values, never purges, no-op on re-run.
     The same script works for any dynamic table (`--table=events --source-column=slug`),
     replacing the one-off backfill described in docs/event-engine-integration.md.
   - The `/about` page's board and team modules must have their **Data source** set to HubDB in
     the page editor. `about.html` renders through a `dnd_area`, so the live page's module
     instances live in HubSpot - editing the template only affects newly created pages.
4. **Set Private Content (the Member Wall).** Portal pages must be gated to the "Active
   Members" audience list; otherwise a logged-out visitor is treated as not-logged-in and
   member-only UI (including the portal sub-nav on `dashboard.html`) is suppressed.
5. **`/subscribe`** has no page template - subscription is a module embedded in `events.html`.
   If a standalone `/subscribe/` URL is required, a page hosting the `subscription-form`
   module must be created (or the code added first).

### 7.1 Creating a training division page by hand

Do this once per portal - staging **443253065** and production **441838610** - if it is
used. Prerequisite: the theme has been uploaded, so `weld-australia-theme` exists in
Design Manager.

| # | Page name | URL path | Template |
|---|---|---|---|
| 1 | Welding Inspection Courses | `training/welding-inspection-courses` | Training Category |
| 2 | Welding Supervision Courses | `training/welding-supervision-courses` | Training Category |
| 3 | Welding Coordination Courses | `training/welding-coordination-courses` | Training Category |
| 4 | Short Courses | `training/short-courses` | Training Category |

1. Content → **Website Pages** → **Create → Website page**.
2. Template picker → `weld-australia-theme` → templates → pages → **Training Category**.
   The picker shows the template's `label:`, not the filename; it appears in the list
   because the template sets `isAvailableForNewContent: true`.
3. Internal page name → the **Page name** column above → **Create page**.
4. Editor → **Settings** → **Page URL**: set the path (no leading slash), and **confirm the
   domain dropdown is the domain serving the live `/training/` page**. On a multi-domain
   portal HubSpot defaults to the primary domain, which may not be it - this is the single
   most likely way to publish a page that still 404s.
5. **Page title / Meta description** are cosmetic here: `training-category.html` sets
   `page_title` / `page_description`, which outrank the editor fields in `_head.html`. Fill
   them anyway (e.g. `Welding Supervision Courses | Weld Australia`) so the page list and
   HubSpot's SEO tools read sensibly.
6. Content: **nothing is mandatory.** All five module instances carry division-derived
   defaults - hero, course grid, timetable, "Why this division", CTA.
7. **Publish.**
8. `/training/welding-safety-courses/` uses its own template (**Welding Safety Courses**).
   Check whether it already exists before creating it - if it does, it has real editor
   content that must not be duplicated.

Two things that make a just-published page still 404:

- an **archived page** already owns the slug (Website Pages → filter Archived), or
- a **URL redirect** already claims the path (Settings → Website → Domains & URLs →
  URL Redirects).

Verify all five resolve:

```bash
for u in welding-inspection-courses welding-supervision-courses \
         welding-coordination-courses short-courses welding-safety-courses; do
  printf '%-32s ' "$u"
  curl -s -o /dev/null -w '%{http_code}\n' "https://<live-domain>/training/$u/"
done
```

A page that returns 200 but whose hero reads "Training Courses" rather than the division
name resolved no slug - the URL path does not contain one of the four division slugs.

### 7.2 Module booking is DATA, and a theme upload ships none of it

The "Course modules" section on a course page sells individual modules only when the rows
behind it say it can. `course_modules` carries a name, an order and a booking URL; every
fact that decides whether a module is bookable - its dates, its price, its ticket types,
whether it is on sale - lives on the `courses` or `events` row that booking URL names,
joined by an id typed in by hand.

When that join is not there the page degrades on purpose: an unresolvable module keeps its
own "Book this module" link, and a module with no URL at all falls back to a `mailto:` to
the training team reading **"Contact to book"**. A listed module with nothing to act on is
the outcome the section exists to prevent, so nothing is ever hidden.

**A portal where the join has failed for every row therefore looks exactly like a portal
where module booking was never deployed.** That is what Ref 46 found on production: 27
modules across 9 course pages, every one of them "Contact to book", reported as a missing
deploy when the template was current and it was the rows that were empty. Three things,
each of which produces that page on its own:

1. **The `module_booking_url` column was never seeded into the portal.** Uploading the
   theme does not create a HubDB column (§ 6), so every row reads a field the portal does
   not have. Fix: `pnpm seed:hubdb -- --env=<env>`.
2. **The column exists and the rows are blank.** Fix: set Individual Module Booking URL per
   module row, to `/checkout/?session_id=<the module's own session row id>`.
3. **The parent course row is not Event Engine ready.** Without `use_event_engine` AND
   `worker_event_id` on the course row (§ 11.5 of CLAUDE.md) every tickbox on the page is
   switched off however well each module is wired, and the "Book the complete course" card
   does not render either.

Do not audit this by reading pages. Ask the portal:

```bash
pnpm audit:course-modules -- --env=production            # what the live rows can sell
pnpm audit:course-modules -- --env=production --draft    # unpublished edits
pnpm audit:course-modules -- --env=production --json     # CI
```

It prints, per course, how many modules resolve to a real session and how many a visitor
can actually book, then names each fault and the row edit that fixes it. Read-only: it
never writes or publishes a row, because which session a module should book is an
editorial call.

It also catches the two faults a page sweep cannot see: several modules resolving to the
**same** session (four IWI-S modules once shared one, so booking any of them booked that
one), and a booking URL still pointing at the **other portal** - a row copied between
staging and production keeps its absolute URL, resolves fine here because the ids ride the
query string, and then sends the buyer to the other site.

---

---

## 8. "It uploaded but the page still looks old" - the stale-state traps

Even a correct full upload can look like it did nothing:

- **HubSpot keeps a page's saved module field values.** Changing a module's *defaults* in
  code does not repopulate a page that already has saved (often empty) layout sections. Open
  the page in the editor and reset/re-save the affected module, or recreate the page.
- **`critical.css` returning 404** makes pages render unstyled (the classic symptom: a
  visible blue "Skip to main content" link, blank canvas). Check DevTools → Network for
  `critical.css` = 200. Root cause is usually a wrong `get_asset_url()` path or an upload
  that didn't include the built CSS. (History: see `AI_AGENT_HANDOFF_HUBSPOT_UPLOAD.md`.)
- **CDN / browser cache.** Give it a minute and hard-refresh; HubDB changes also respect a
  cache TTL.
- **A saved module instance outranks the template's `path=`.** If you repoint a
  `{% module "some_id" path="../../modules/new" %}` tag at a different module but keep the
  instance id, a published page that already has saved values on `some_id` stays bound to the
  *old* module - the saved widget carries the binding it was created with. Symptom: the page
  editor still names the retired module and there is no way to swap it when the template has
  no `dnd_area`. Fix: give the instance a new id (see `advocacy.html`, which was stuck on
  `page-header` from 31 Jul to 1 Aug). Cost: the old instance's editor overrides are dropped,
  so the template defaults must carry the intended copy.
- **`hs cms upload` never deletes.** `scripts/upload.ts` runs `hs cms upload <src> <dest>` per batch -
  additive only. Deleting a module from git leaves it live in the portal's Design Manager
  forever, where stale page instances can keep binding to it. Pair every module deletion with
  `hs cms delete weld-australia-theme/modules/<name>.module --account=<account>` **on each
  portal** (staging 443253065 and production 441838610), and only after confirming no page
  still binds to it - removing a module a page still uses breaks that page.
  (`hs remove` was renamed to `hs cms delete` in HubSpot CLI 8.x.)

---

## 9. Validate & test before you upload

CI runs `pnpm validate` (validate.yml) plus typecheck, build and tests (build.yml). Run the
same set locally before deploying so you are not waiting on CI to find it:

```bash
pnpm validate      # HubSpot spec compliance (field types, categories, manifest) - also in CI
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest unit tests + Playwright a11y (starts Vite automatically)
pnpm test:unit     # vitest only
pnpm test:a11y     # Playwright a11y only
pnpm check:bundle  # bundle-size budget
```

`validate-theme.ts` catches most errors HubSpot would otherwise reject one-at-a-time during
a server-side upload - cheaper to fix locally.

---

## 10. Local development

```bash
pnpm dev            # Vite HMR for React islands
pnpm watch          # hs cms watch - pushes HubL/theme edits to the portal live
```

`pnpm watch` uses the CLI too, so the same local-binary / account-name rules from §4 apply.

---

## 11. End-to-end deploy checklist

```
[ ] git pull - confirm you're on the intended commit of main
[ ] pnpm install
[ ] pnpm validate && pnpm typecheck && pnpm test
[ ] pnpm build                      # regenerates critical.css, manifest, stable standalone bundles
[ ] Upload FULL theme to STAGING - pnpm upload:staging (443253065)          # §4.1
[ ] Verify on staging, then promote - pnpm upload:prod (441838610, LIVE)    # §4.2
[ ] Confirm corporate.functions uploaded + hubspot_service_key secret       # §4.4
[ ] Seed + publish HubDB if hubdb/*.json changed                            # §6
[ ] Create/assign any new pages, set Private Content, enable dynamic pages  # §7
[ ] Verify on the live portal:
      - /portal/ shows the sub-nav when logged in as a member
      - /portal/invoices/, /portal/profile/, etc. resolve (no 404)
      - /portal/team/ Add employee is inline (not mailto) for a corporate Admin
      - Events use the current registration flow + current HubDB data
      - Training shows current categories
      - critical.css returns 200 (page is styled)
```

---

## 12. CI/CD (closes the manual gap)

The recurring "merged but not live / regressed after upload" problem was structural. Two
GitHub Actions now cover it:

- **`.github/workflows/build.yml`** (every PR + push to `main`): runs `pnpm typecheck`,
  the full `pnpm build` (islands + `critical.css` + the asset-reference integrity gate +
  bundle-size budget), and `pnpm test`, then asserts the build is idempotent. A stale bundle
  reference, an unbuilt theme, a type error, or a failing test blocks the merge instead of
  surfacing only after upload.
- **`.github/workflows/deploy.yml`** (manual `workflow_dispatch`, type `deploy` to confirm):
  guarantees a full build + full-theme upload to the live portal in one action, removing the
  "forgot to build / uploaded one module / wrong portal / half-upload" classes. **Setup:**
  add repo secret `HUBSPOT_PERSONAL_ACCESS_KEY` for portal 441838610 (production).

Deploy is intentionally **manual** while the team stabilises defects; switching it to run on
`push: [main]` later is a one-line change. Neither Action performs the §7 HubSpot-UI steps -
those remain manual by nature. Treat §11 as the ritual for any local/manual deploy.
