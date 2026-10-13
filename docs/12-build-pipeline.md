# Build pipeline

What `pnpm build` does, in order, and what each script guarantees.

```
pnpm build
  = tsx scripts/build.ts
  → tsx scripts/validate-theme.ts
  → tsx scripts/check-bundle-size.ts
```

Any of the three failing fails the build.

---

## 1. `scripts/build.ts`

### Step 0a - header fallback menu

Reads `config/header-menu.json` and regenerates two blocks inside
`theme/modules/header.module/module.html`, delimited by
`{# @generated-header-menu:desktop:start #}` / `:end` and the `mobile`
equivalent. A missing marker is a hard error.

This is the **fallback** menu, rendered when the module's HubSpot menu field is
empty. Absolute URLs are given `target="_blank" rel="noopener noreferrer"`
unless the host is one of the known Weld hosts (`weldaustralia.com.au`,
`staging-441838610.weldaustralia.com`, `441838610.hs-sites-ap1.com`).

### Step 0b - course taxonomy

Reads `config/course-categories.json` and generates:

- `theme/templates/partials/course-taxonomy.html` - HubL macros for the
  server-rendered course directories
- `src/shared/courseTaxonomy.ts` - the same taxonomy for React islands

Every bucket contributes a set of lookup keys: its slug, its label, each HubDB
`category` value it absorbs, and any hand-written aliases, all slugified to one
form so lookups ignore spaces, dashes and underscores. **A key claimed by two
buckets is a hard error.** Legacy aliases are how old links keep resolving.

`featured-courses.module` deliberately does not get a third copy: its host HubL
emits the taxonomy into a data attribute and its vanilla JS reads it from there.

Adding a division is three steps, and the third is manual:

1. Edit `config/course-categories.json`.
2. `pnpm build`.
3. Create the HubSpot page from `training-category.html` at a URL containing the
   new slug. Nothing in the build or the upload creates pages. A division with
   no page 404s every nav link to it, which is exactly how the four
   `/training/...-courses/` pages shipped as templates and 404ed the whole
   Training menu (QA 226/227).

### Step 0c - `critical.css`

Concatenates, in cascade order:

```
tokens.css → reset.css → base.css → utilities.css → components.css
           → modules/hero.module/module.css
```

into `theme/assets/css/critical.css`, so `_head.html` makes one blocking CSS
request instead of six. The file is gitignored and regenerated every build.

`fonts.css` is deliberately excluded: `@font-face` has to resolve through
`get_asset_url()` (see `_fonts.html`), and relative `../fonts/` URLs 404 on
HubSpot's CDN once the CSS is served from a hashed asset path.

### Step 1 - the main Vite build

Config: `vite.config.ts`. Entries are discovered automatically - every
`src/modules/*/index.tsx` becomes one. Output goes to `theme/assets/js`
(`emptyOutDir: true`), with a manifest, sourcemaps, a `vendor-react` chunk and a
`shared` chunk.

This build's primary product is the **manifest**, which
`check-bundle-size.ts` reads to enforce the per-entry budget, and which
`stabiliseCssOnlyModules()` uses to find hashed CSS. Vite's manifest is written
to `.vite/manifest.json` and copied to `theme/assets/js/manifest.json`.

### Step 2 - one standalone bundle per island

For each name in `HUBSPOT_STANDALONE_MODULES` (currently 14), `build.ts` runs a
second, isolated Vite build with `inlineDynamicImports: true` and stable
filenames:

```
theme/assets/js/<name>.standalone.js
theme/assets/js/assets/<name>.standalone.css   (when the island has CSS)
```

Then it patches the host `theme/modules/<name>.module/module.html`, replacing
either the `{# @bundle: <name> #}` placeholder (first build) or the previously
written tag block (every build after). It also rewrites any template host listed
in `STANDALONE_TEMPLATE_HOSTS` - `course-router.html` and
`course-timetable-hub.html` both load the `course-filter` bundle by URL.

Two decisions behind this:

- **Self-contained bundles.** Each island carries its own React copy rather than
  sharing a vendor chunk. A missing shared chunk during a deploy window would
  break every island at once; the cost is size, which the 80 KB budget bounds.
- **Stable filenames, not hashes.** `get_asset_url()` already appends HubSpot's
  content-based cache-buster, so a hash in the filename bought nothing and cost
  a rewritten `module.html` on every build, with the cross-branch conflicts that
  implies.

A module whose `module.html` contains neither the placeholder nor a recognisable
existing tag is a hard error, not a silent skip.

### Step 3 - CSS-only modules

`CSS_ONLY_MODULES` (currently `events-listing`) render server-side in HubL but
reuse a component's Vite-built CSS. Vite gives that file a rotating hash, so the
build copies it to a stable `assets/<name>.css` and rewrites the `<link>`.

### Step 4 - restore vanilla JS

Vite's `emptyOutDir` wipes `theme/assets/js`, so `src/vanilla/*.js` is copied
back in afterwards. Those files are un-ignored in `.gitignore`, committed under
`theme/assets/js/`, and uploaded like any other asset.

Current vanilla widgets: `testimonial-slider.js` (lazy, IntersectionObserver),
`news-articles-browser.js`, `event-availability.js` (advisory availability
bands; the Worker stays authoritative at checkout).

---

## 2. `scripts/validate-theme.ts`

A static HubSpot spec validator. It exists because HubSpot validates only
server-side during `hs upload`, and fails on the **first** error in the theme, so
authoring defects surface one upload at a time. This reports every violation in
one pass, then exits non-zero if any is an error.

Rules, by name:

| Rule | Severity | Checks |
|---|---|---|
| `invalid_json`, `invalid_fields`, `invalid_meta` | error | Parseable JSON of the right shape |
| `missing_required_file` | error | Each `*.module` has its required trio |
| `invalid_field_type` | error | `type` is a real HubSpot field type |
| `invalid_field_name` | error | `^[a-z0-9_]+$` |
| `invalid_category` / `invalid_categories` | error | `meta.json` categories, max 3 |
| `invalid_content_type` / `invalid_content_types` | error | Valid `content_types` values |
| `deprecated_host_template_types` | warning | Use `content_types` |
| `invalid_visibility_operator`, `visibility_operator_mismatch`, `missing_controlling_field` | error | Conditional-visibility blocks that would hide a field in the editor forever, with no upload-time error |
| `choice_multi_pattern` | warning | Multi-select choice should set `display: "checkbox"` and `multiple: true` |
| `missing_theme_json` / `misplaced_theme_json` | error | `theme.json` at `theme/`, not the repo root |
| asset references | error for `.js`/`.css`, warning otherwise | Every static `get_asset_url('...')` path resolves on disk |

The asset-reference rule is the one that catches a dangling bundle reference
before it ships. Only fully literal paths are checkable; concatenated or
variable paths are skipped.

Run it alone with `pnpm validate`. `validate:marketplace` runs HubSpot's own
marketplace validator, which is stricter and not part of the gate.

---

## 3. `scripts/check-bundle-size.ts`

Reads `theme/assets/js/manifest.json`, gzips every entry chunk at level 9, and
fails if any exceeds **80 KB gzipped**. Prints a sorted report either way.

Over budget means one of: an accidental import of something large, a shared
utility pulled into an island that does not need it, or genuine feature growth
that needs splitting. `vendor-react` is exempt from Vite's own warning
(`chunkSizeWarningLimit: 500`) because the entry budget is the real gate.

---

## 4. `scripts/upload.ts`

Wraps `hs upload` with environment switching. `pnpm upload:sandbox`,
`upload:staging` and `upload:prod` all run `pnpm build` first.

```bash
tsx scripts/upload.ts --env=staging
tsx scripts/upload.ts --env=production
tsx scripts/upload.ts --env=production --dry-run
tsx scripts/upload.ts --env=production --with-serverless
```

What it handles that a bare `hs upload` does not:

- **Auth resolution.** `hubspot.config.yml` in the project root first, then
  `~/.hscli/config.yml`, matching several historical account names per portal.
- **`hsproject.json` parking.** Both CLI v6 and v8 refuse `hs upload` when that
  file is present, so it is renamed for the duration of the upload and restored
  afterwards.
- **Batching with retries.** The CLI's default concurrency of 10 makes
  Cloudflare return empty 403s, so uploads run in small batches with 4 retries
  and a 750 ms pause. JS files go up individually.
- **Ordering.** Assets first, so islands never 404 mid-deploy. Then templates,
  walked **partials → layouts → everything else**, because HubSpot validates
  `{% import %}` against what is already on the portal, not against the rest of
  the batch. Then modules, then theme root files.
- **File-by-file templates.** One HubL validation error fails one file instead
  of the whole `templates/` tree.
- **Permanent-error detection.** A serverless rejection is recognised and not
  retried. `corporate.functions/` is skipped unless `--with-serverless`, because
  Content Hub Professional cannot host Design Manager serverless.

A failed batch aborts the deploy rather than leaving half a theme live. Re-run
it; `hs upload` is idempotent.

---

## 5. HubDB and backfill scripts

These talk to the HubDB API directly, not through the theme. Full reference:
[15-hubdb-reference.md](./15-hubdb-reference.md).

| Script | Purpose |
|---|---|
| `pnpm seed:hubdb` | Sync table schemas from `hubdb/*.json`: add missing columns, table settings, the `dynamicMetaTags` mapping, `allowPublicApiAccess`. It does **not** push `dynamicPageUrlPattern` |
| `pnpm seed:hubdb:demo` | Populate demo rows (idempotent: purge draft rows, insert, publish) |
| `pnpm backfill:paths` | Fill blank `hs_path` values after UI or CSV imports |
| `pnpm backfill:course-seo` | Fill blank course row name, `page_title`, `og_image` |
| `pnpm backfill:course-state` | Fill blank `courses.state` from `city` |

All take `--env=staging|production` and most take `--dry-run`. Use
`pnpm <script> -- --env=…` so pnpm does not swallow the flag.

**Auth.** `scripts/lib/hubspot-auth.ts` resolves credentials in this order:

1. `HUBSPOT_ACCESS_TOKEN_SANDBOX` / `HUBSPOT_ACCESS_TOKEN_PRODUCTION`, or
   `HUBSPOT_ACCESS_TOKEN`
2. The same CLI personal access key `pnpm upload:*` uses, from
   `hubspot.config.yml` or `~/.hscli/config.yml`, exchanged through HubSpot's
   localdevauth refresh endpoint

If `hs auth` works for uploads, the seed and backfill scripts work with no extra
environment variables. `No access token found` means the CLI is not
authenticated for that portal: run `hs auth`. Do not go hunting for a
private-app token.

---

## 6. Why build before every upload

`theme/assets/js/` and `theme/assets/css/critical.css` are gitignored build
output. A checkout has neither. Uploading without building therefore ships:

- no island bundles at all on a fresh clone, or
- last build's bundles, with `module.html` referencing files that may not exist,
- and stale CSS that does not match `tokens.css`.

`deploy.yml` runs `pnpm build` as its own step for this reason, and `build.yml`
proves on every PR that the build is idempotent so the committed tags and the
built files cannot drift apart.
