# Development workflow

Setup, the day-to-day loop, conventions, and the gates a change has to pass.
Deploying is a separate document: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

---

## 1. One-time setup

```bash
nvm use 20              # .nvmrc pins 20
corepack enable         # pnpm 9.12.0 comes from packageManager
pnpm install
pnpm exec playwright install --with-deps chromium
```

HubSpot CLI auth, once per machine:

```bash
cp hubspot.config.example.yml hubspot.config.yml   # gitignored, never commit
hs auth --account=weld-australia-staging           # portal 443253065
hs auth --account=weld-australia                   # portal 441838610, the live site
```

The repo ships its own CLI (`@hubspot/cli` v6) in `node_modules/.bin/hs`.
`scripts/upload.ts` uses that binary deliberately, so a globally installed v7/v8
does not change deploy behaviour.

Portals:

| `--env` | Portal | CLI account name | Notes |
|---|---|---|---|
| `staging` | 443253065 | `weld-australia-staging` | Prove changes here first |
| `production` | 441838610 | `weld-australia` | The live weldaustralia.com.au site |

`--env=sandbox` is accepted as the old name for staging: it warns and resolves
to 443253065.

There is **no fallback between the two portals**, in `scripts/upload.ts` or in
the HubDB scripts. An unauthenticated staging portal is a hard error telling you
to run `hs auth`, not a silent redirect to the live site - which is exactly what
it used to be, until `upload:staging` was found deploying to production.
`scripts/lib/hubspot-portals.test.ts` fails the build if the ids and names drift
apart again. See [15-hubdb-reference.md](./15-hubdb-reference.md) § 8.

---

## 2. The loop

```bash
pnpm dev            # Vite on :5173, HMR for React islands + a11y fixtures
pnpm watch          # hs watch: pushes theme file changes to the portal
```

Two modes, and they answer different questions:

- **`pnpm dev`** is for island logic and CSS. It serves the static fixtures in
  `a11y/*.html` at `/a11y/<name>.html`, so you can drive a component with fixed
  props and no portal round trip. Use it for anything you can express as props.
- **`pnpm watch`** is for HubL. HubL only runs on the portal, so anything
  involving `hubdb_table_rows`, `request_contact`, `crm_object` or macros must be
  exercised there.

`pnpm watch` pushes source files as-is; it does **not** run the build. If you
change an island's TypeScript, run `pnpm build` before the upload or you are
looking at the previous bundle.

---

## 3. Where a change goes

| Change | Files |
|---|---|
| New static section | `theme/modules/<name>.module/` (fields, meta, html, css) |
| New interactive UI | `src/modules/<name>/index.tsx` + `theme/modules/<name>.module/`, then add the name to `HUBSPOT_STANDALONE_MODULES` in `scripts/build.ts` |
| New page | `theme/templates/pages/<name>.html`, then create the page in HubSpot by hand |
| New design token | `theme/assets/css/tokens.css`, plus `src/shared/design-tokens.ts` if islands need it |
| New brand-kit control | `theme/fields.json` + the `:root` override block in `theme/templates/partials/_head.html` |
| New HubDB column | `hubdb/<table>.json`, then `pnpm seed:hubdb` per environment |
| New course division | `config/course-categories.json`, then `pnpm build`, then create the page in HubSpot |
| New header nav item | `config/header-menu.json` (fallback menu), then `pnpm build` |
| Pricing rule | Both `theme/templates/partials/_member-pricing.html` and `src/shared/utils/memberPricing.ts` |

Detail: [13-templates-and-modules.md](./13-templates-and-modules.md),
[15-hubdb-reference.md](./15-hubdb-reference.md),
[16-membership-and-pricing.md](./16-membership-and-pricing.md).

---

## 4. Quality gates

Run all of these before you push. They are the same gates CI runs, so a local
pass means a green PR.

```bash
pnpm validate     # HubSpot spec compliance: field types, categories, content_types,
                  # meta.json, theme.json, asset-reference integrity
pnpm typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
pnpm test         # vitest run, then playwright (starts Vite itself)
pnpm build        # islands + generated files + validate + 80 KB gzip budget
```

Faster subsets while iterating:

```bash
pnpm test:unit          # Vitest only
pnpm test:watch         # Vitest watch
pnpm test:a11y          # Playwright only
pnpm test:a11y:ui       # Playwright UI mode
pnpm check:bundle       # bundle budget only, needs a prior build
pnpm format             # Prettier over the repo
```

### 4.1 The build must be idempotent

`pnpm build` rewrites committed files (module script tags, the generated
taxonomy partial, `courseTaxonomy.ts`, the header fallback menu). A clean
checkout plus a build must therefore leave `git diff` empty. `build.yml` asserts
exactly that and fails the PR otherwise.

If that step fails, someone hand-edited a generated block. Fix the source
(`config/*.json`, or the component the bundle comes from), rebuild, and commit
the generated output together with the source change.

---

## 5. CI

Three workflows, all in `.github/workflows/`.

| Workflow | Trigger | Does |
|---|---|---|
| `validate.yml` | every PR and push to main | `pnpm validate`. No build, no credentials. Fast spec gate |
| `build.yml` | every PR and push to main | typecheck, full build, Playwright install, `pnpm test`, then the idempotency check |
| `deploy.yml` | `workflow_dispatch` only | Requires the confirmation text `deploy` **and** `github.ref == main`. Writes `hubspot.config.yml` from the `HUBSPOT_PERSONAL_ACCESS_KEY` secret, builds, uploads the full theme, then deletes the config |

Deploys are manual on purpose: staging is production. Flipping `deploy.yml` to
run on push to main is a one-line change when the team is ready.

---

## 6. Git conventions

- Trunk-based, short-lived branches: `feat/<module>`, `fix/<module>`,
  `chore/<thing>`.
- Conventional Commits for PR titles and commit subjects
  (`fix(course-filter): derive location options from HubDB rows`).
- One concern per PR. The generated output belongs in the same commit as the
  source change that produced it.
- A module PR should carry: green CI, a screenshot from the portal, and a link
  to the relevant section of CLAUDE.md or a QA defect number.

---

## 7. Code style

Prettier owns formatting (`.prettierrc`): no semicolons, single quotes, 2-space
indent, no trailing commas, 100 columns. `.editorconfig` covers HubL and other
file types. Run `pnpm format` rather than arguing with it.

TypeScript is strict, with `noUncheckedIndexedAccess`, `noUnusedLocals` and
`noUnusedParameters` on. Indexing an array gives you `T | undefined`; handle it
rather than reaching for `!` on anything that can genuinely be absent.

Conventions that matter beyond formatting:

- **CSS class names are prefixed `wa-`** and scoped per module
  (`.wa-course-filter-shell__header`). Tokens are `--wa-*`.
- **Import shared code from `@shared`**, not by relative path. Aliases:
  `@shared`, `@modules`, `@styles`, declared in both `vite.config.ts` and
  `tsconfig.json` (and again in `vitest.config.ts`).
- **Comment the why, not the what.** The existing headers in `scripts/*.ts` and
  the HubL partials are the house style: they explain the defect a piece of code
  exists to prevent. That is why the code is still correct a month later, so
  keep it up when you change one.
- **Never mutate `window.__WELD_MEMBER__`.** It is a server-rendered read-only
  snapshot.

---

## 8. Things that will bite you

| Trap | Reality |
|---|---|
| Uploading without building | `theme/assets/js/` is gitignored. No build means no bundles on the portal |
| Hand-editing `critical.css` | Generated. Edit `tokens.css` / `base.css` / etc |
| Editing `course-taxonomy.html` or `courseTaxonomy.ts` | Generated from `config/course-categories.json` |
| Adding a select option to `hubdb/*.json` | The seed never changes options on an existing column. Add it in HubDB by hand |
| Expecting a new theme page to appear on the site | Templates are not pages. Someone has to create the page in HubSpot |
| Bare truthiness on a HubL macro result | Macros emit surrounding whitespace, so an untrimmed result is always truthy. Always `|trim` |
| Bare truthiness on a CRM tier | "Not Applicable" is a real string. Use `_member-tier.html` |
| Assuming an island bundle is hashed | Filenames are stable; HubSpot cache-busts `get_asset_url()` output |

More in [18-troubleshooting.md](./18-troubleshooting.md).
