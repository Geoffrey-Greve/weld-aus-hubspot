# Weld Australia HubSpot theme - developer documentation

Start here. This folder holds the reference documentation for the theme, its
React islands, its data layer and the deploy path. The project brief lives in
[`../CLAUDE.md`](../CLAUDE.md); the deploy runbook lives in
[`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## Where to look

| I want to... | Read |
|---|---|
| Understand how a request becomes a page | [10-architecture.md](./10-architecture.md) |
| Set up, branch, test, raise a PR | [11-development-workflow.md](./11-development-workflow.md) |
| Know what `pnpm build` generates and why | [12-build-pipeline.md](./12-build-pipeline.md) |
| Add or change a HubL module / template | [13-templates-and-modules.md](./13-templates-and-modules.md) |
| Add or change a React island | [04-react-island-pattern.md](./04-react-island-pattern.md) then [14-shared-library.md](./14-shared-library.md) |
| Add a HubDB column, table or row set | [15-hubdb-reference.md](./15-hubdb-reference.md) |
| Touch member gating, tiers or pricing | [16-membership-and-pricing.md](./16-membership-and-pricing.md) |
| Write or run tests | [17-testing.md](./17-testing.md) |
| Work out why something is broken | [18-troubleshooting.md](./18-troubleshooting.md) |
| Know where a QA defect ref actually stands | [19-qa-defect-reconciliation.md](./19-qa-defect-reconciliation.md) |
| Deploy | [../DEPLOYMENT.md](../DEPLOYMENT.md) |

## Full index

### Reference (start here)

- [10-architecture.md](./10-architecture.md) - layers, request lifecycle, repo map, generated-file contract
- [11-development-workflow.md](./11-development-workflow.md) - setup, day-to-day loop, conventions, quality gates, CI
- [12-build-pipeline.md](./12-build-pipeline.md) - every step of `pnpm build`, the validator, the upload script
- [13-templates-and-modules.md](./13-templates-and-modules.md) - layouts, partials, module anatomy, `fields.json` rules
- [14-shared-library.md](./14-shared-library.md) - the `src/shared` API surface
- [15-hubdb-reference.md](./15-hubdb-reference.md) - all twelve tables, seeding, backfills
- [16-membership-and-pricing.md](./16-membership-and-pricing.md) - the member wall, tier resolution, price parity
- [17-testing.md](./17-testing.md) - Vitest, Playwright/axe, source-level guards
- [18-troubleshooting.md](./18-troubleshooting.md) - symptom to cause to fix
- [19-qa-defect-reconciliation.md](./19-qa-defect-reconciliation.md) - the QA defect sheet reconciled against both repos, and what is blocking each open ref

### Build history and specification

- [01-sitemap.md](./01-sitemap.md) - information architecture, URL map, per-page content blocks
- [02-module-catalog.md](./02-module-catalog.md) - every module with its editor fields
- [03-prompts.md](./03-prompts.md) - the sequential build prompts the theme was built from
- [04-react-island-pattern.md](./04-react-island-pattern.md) - how to author an island
- [05-home-page-implementation.md](./05-home-page-implementation.md) - the 2026-06-01 home page design pass

### Integrations and handoffs

- [EVENT-ENGINE-HANDOVER.md](./EVENT-ENGINE-HANDOVER.md) - Event Engine mental model, state, remaining work
- [EVENT-ENGINE-API.md](./EVENT-ENGINE-API.md) - Worker endpoint reference
- [event-engine-integration.md](./event-engine-integration.md) - frontend wiring plus backend dependencies
- [corporate-team-management-api.md](./corporate-team-management-api.md) - bulk booking and add/remove employee contracts
- [member-portal-config-handoffs.md](./member-portal-config-handoffs.md) - portal config items owned by Ollie and Weld Aus finance

### HubSpot-side setup (things an upload cannot do)

- [team-profiles-hubspot-setup.md](./team-profiles-hubspot-setup.md)
- [portal-certifications-pages-setup.md](./portal-certifications-pages-setup.md)
- [page-editor-field-checks.md](./page-editor-field-checks.md)
- [find-a-member-logo-guidance.md](./find-a-member-logo-guidance.md)

### Elsewhere in the repo

- [`../CLAUDE.md`](../CLAUDE.md) - project brief, scope, CRM data model, open questions
- [`../DEPLOYMENT.md`](../DEPLOYMENT.md) - deploy runbook and the manual HubSpot steps
- [`../README.md`](../README.md) - prerequisites, auth, commands
- [`../workflows/`](../workflows/) - the HubSpot workflows the frontend depends on
- [`../bugs/qa-log.md`](../bugs/qa-log.md) - the QA defect log these docs keep referring to by number

## Conventions used in these docs

- Paths are repo-relative.
- "Defect NNN" or "QA NNN" refers to an entry in [`../bugs/qa-log.md`](../bugs/qa-log.md).
- Anything marked **generated** is written by `pnpm build`. Editing it by hand
  is reverted on the next build, and CI fails the PR for it.
