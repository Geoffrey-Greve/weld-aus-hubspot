# Weld Australia HubSpot CMS Theme

Custom HubSpot Content Hub theme + React-island custom modules for the Weld Australia member portal and public site. Replaces the legacy WordPress site and the CAMS/Dynamics membership system.

> **Source of truth:** see [`CLAUDE.md`](./CLAUDE.md).
>
> **Developer documentation:** [`docs/README.md`](./docs/README.md) is the index.
> Start with [architecture](./docs/10-architecture.md),
> [development workflow](./docs/11-development-workflow.md) and the
> [build pipeline](./docs/12-build-pipeline.md).
>
> Companion docs:
> - [`docs/01-sitemap.md`](./docs/01-sitemap.md) - pages and information architecture
> - [`docs/02-module-catalog.md`](./docs/02-module-catalog.md) - every module with its `fields.json`
> - [`docs/03-prompts.md`](./docs/03-prompts.md) - sequential build prompts

## Prerequisites

- Node 22 (`nvm use 22`)
- pnpm via Corepack (`corepack enable`)
- HubSpot CLI installed globally: `npm i -g @hubspot/cli`

## Install

```bash
pnpm install
```

## HubSpot CLI auth

Each developer needs to run this **once per machine** to connect to the HubSpot portals.

**1. Create your local config file**

```bash
cp hubspot.config.example.yml hubspot.config.yml
```

`hubspot.config.yml` is gitignored - never commit it.

**2. Authenticate each portal**

```bash
# Initialise (creates/updates hubspot.config.yml with auth tokens):
hs init

# Or, to add a portal interactively (generates a Personal Access Key URL):
hs auth --account=weld-australia-staging
hs auth --account=weld-australia
```

Follow the CLI prompts: it opens HubSpot in your browser, you create a Private App or Personal Access Key, paste it back into the terminal. The key is written into `hubspot.config.yml`.

## Portals

There are **two** Weld Australia portals. They are different places.

| Env | Portal ID | CLI account name | What it is |
|---|---|---|---|
| `staging` | **443253065** | `weld-australia-staging` | Where changes are proved before the client sees them |
| `production` | **441838610** | `weld-australia` | The live weldaustralia.com.au site |

`--env` names one portal and that is the only one a script touches. There is **no
fallback between them**: if the staging portal is not authenticated, the command
fails and tells you to run `hs auth`. It does not quietly deploy to production
instead — which is what it used to do.

`--env=sandbox` is the old name for the staging portal. It still works, warns,
and resolves to staging.

**Expected `hubspot.config.yml` shape** (see `hubspot.config.example.yml` for the template):

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

> **Portal IDs:** staging is **443253065** and production - the live
> weldaustralia.com.au site - is **441838610**. They are different portals;
> `--env` names one of them and `scripts/upload.ts` never falls back between
> them. See [`docs/11-development-workflow.md`](./docs/11-development-workflow.md) § 1.

## Develop

```bash
# React HMR for the modules
pnpm dev

# Watch HubL + theme files and push to the staging portal
pnpm watch
```

## Build & upload

```bash
# One-shot React build → theme/assets/js
pnpm build

# Upload theme + built bundles to STAGING (443253065)
pnpm upload:staging

# Promote to PRODUCTION (441838610) - the live site, after sign-off
pnpm upload:prod
```

## Testing

Two suites: **Vitest** (unit / component) and **Playwright + axe-core** (WCAG 2.1 AA a11y). Run the full gate before uploading.

### Scripts

```bash
# Full suite — unit then a11y (Playwright starts Vite on :5173 automatically)
pnpm test

# Unit / component only (Vitest + jsdom + Testing Library)
pnpm test:unit
pnpm test:watch          # Vitest watch mode

# A11y only (Playwright + @axe-core/playwright)
pnpm test:a11y
pnpm test:a11y:ui        # Playwright UI mode

# Spec / type / size gates (also run as part of pnpm build where noted)
pnpm validate            # HubSpot theme/module field + manifest compliance
pnpm typecheck           # tsc --noEmit
pnpm check:bundle        # 80 KB gzip budget per React island entry
```

First time on a machine (or after upgrading Playwright), install the Chromium browser:

```bash
pnpm exec playwright install --with-deps chromium
```

### What each suite covers

| Suite | Location | Asserts |
|-------|----------|---------|
| Unit | `src/**/*.test.{ts,tsx}`, `tests/unit/` | React island behaviour, pricing helpers, HubDB/API clients, course taxonomy, contrast utilities |
| A11y | `tests/a11y/*.spec.ts` against fixtures in `a11y/` | axe WCAG 2A/2AA/2.1 AA (serious/critical = fail), landmarks, skip-link, keyboard/focus traps, 44×44 touch targets, mobile overflow |

Playwright projects:

- **chromium** — desktop Chrome; all a11y specs except overflow
- **mobile-chrome** — Desktop Chrome at 375×812 (classic scrollbar); `overflow.spec.ts` only

### Pre-upload protocol

```bash
pnpm validate && pnpm typecheck && pnpm test
pnpm build               # regenerates islands, critical.css, re-runs validate + bundle budget
```

CI (`.github/workflows/build.yml` on every PR and push to `main`) runs `typecheck`, `build`, and `test` the same way. Merging does **not** deploy — see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## HubDB

```bash
# Create / update HubDB table schemas (columns, dynamic page mapping,
# allowPublicApiAccess). Required after flipping privacy on an existing table
# (e.g. jobs → private) - the JSON change alone does not update the portal.
pnpm seed:hubdb -- --env=sandbox

# Populate every table with realistic demo rows (idempotent -
# purges existing draft rows then re-inserts, then publishes).
# Re-asserts allowPublicApiAccess from hubdb/*.json before writing rows.
pnpm seed:hubdb:demo -- --env=sandbox
```

`hubdb/*.json` is the canonical schema. Never hand-edit production HubDB columns - change the JSON, commit, run the seed.

Demo data fixtures live inline in `scripts/seed-hubdb-demo.ts` and use
clearly fictional Australian company / person names; they exist only so
pages render before client content arrives. Replace with real data
before production cutover. Flags: `--dry-run`, `--no-purge`,
`--only=courses` (or any other table name).

## Design tokens

The design system lives in `theme/assets/css/`:

| File | Purpose |
|------|---------|
| `tokens.css` | All `--wa-*` CSS custom properties (colours, typography, spacing, z-index, etc.) |
| `reset.css` | Modern CSS reset (Andy Bell style) |
| `base.css` | Base typography, links, focus ring, scrollbar |
| `utilities.css` | Layout helpers: `.container`, `.stack-*`, `.cluster`, `.visually-hidden`, `.truncate` |
| `components.css` | Buttons (`.btn-primary/secondary/ghost`), form fields (`.field`, `.field-input`, `.field-error`), badges, alerts |

TypeScript token references are exported from `src/shared/design-tokens.ts`:

```ts
import { TOKENS, BREAKPOINTS } from '@shared/design-tokens'
// e.g.
<div style={{ color: TOKENS.color.success }}>Member saving</div>
```

### Viewing the token palette

Open `tmp/token-swatches.html` in a browser - it renders colour swatches, typography scale, spacing scale, and component previews using the live CSS files (no build step required).

### Brand kit

The palette and typeface were confirmed via the approved Home Page design
handoff (Claude Design, 2026-06-01) and supersede the earlier
visual-inspection placeholders. Current values in `tokens.css`:

- `--wa-color-primary`: `#1c1e4c` (navy/indigo)
- `--wa-color-primary-dark`: `#0f1030` (footer, membership band)
- `--wa-color-secondary`: `#1a5c9e` (industrial blue)
- `--wa-color-accent`: `#fecf05` (brand gold - primary CTAs, active states)
- `--wa-color-magenta`: `#ed128d` and `--wa-color-accent-orange`: `#f04828`
  (the logo flame gradient)
- Typeface: Poppins, served locally via `theme/templates/partials/_fonts.html`

Editors control these through **Theme settings → Brand colours / Typography**
(`theme/fields.json`), which `_head.html` writes into a `:root` override block.
`tokens.css` carries the same values as defaults, so the site renders correctly
before any override is set.

The vibrant brand colours fail WCAG 1.4.3 as text, so accessible text tones are
separate tokens: `--wa-color-magenta-text`, `--wa-color-magenta-on-dark`,
`--wa-color-gold-text`. Ratios are asserted in `src/test/wcag-contrast.test.ts`.
See [`docs/13-templates-and-modules.md`](./docs/13-templates-and-modules.md) § 8.

## Repo layout

See [`CLAUDE.md` § 3](./CLAUDE.md) for the canonical file/folder map.

```
src/        React source (compiled to theme/assets/js) + colocated *.test.*
tests/      Playwright a11y specs (tests/a11y) + extra unit tests
a11y/       Static fixtures served by Vite for a11y runs
theme/      HubSpot theme - templates, modules, sections, assets
hubdb/      HubDB table schemas + seed data
scripts/    Build, upload, seed, validate, bundle-size orchestration
workflows/  Documentation of expected HubSpot workflows
docs/       Developer documentation (see docs/README.md)
tmp/        Local development helpers (not deployed)
```
