# Weld Australia HubSpot Theme - AI Agent Handoff

**Date:** 2026-06-15  
**Workspace:** `C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot`

---

## Current Problem

The theme uploads to HubSpot successfully, but in the HubSpot page content editor the **page canvas is blank** except for a visible blue underlined "Skip to main content" link. The left sidebar correctly shows the DnD module/template structure.

This means:
- `base.html` is rendering (the skip link is output by it)
- Theme CSS (`critical.css`) is **not loading** - the skip link is visually visible instead of hidden
- Header and footer modules are **not rendering**
- DnD module areas are **not painting** in the canvas

---

## Confirmed Working Upload Command

Use the **local** node_modules CLI, not the global one. The global CLI v8.9.x blocks `hs upload` when `hsproject.json` is present in the directory:

```powershell
cd "C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot"
.\node_modules\.bin\hs.CMD cms upload theme weld-australia-theme --account=weld-australia-staging --config=hubspot.config.yml
```

This uploads the `theme/` directory to Design Manager as `weld-australia-theme` on portal `441838610`.

---

## Account & Auth Details

| Item | Value |
|---|---|
| Portal ID | `441838610` |
| Account name in config | `weld-australia-staging` |
| Config file | `hubspot.config.yml` (in project root - gitignored) |
| Token expiry | Refreshes each time you re-auth. If expired, run: `.\node_modules\.bin\hs.CMD auth --config=hubspot.config.yml` |
| CLI version (local) | `@hubspot/cli` v6.x (in `node_modules`) - use this, not global |
| CLI version (global) | 8.9.x - **do not use** for uploads (blocked by hsproject.json detection) |

---

## All Fixes Applied This Session (Do Not Revert)

### Session 1 (prior agent - from original handoff)
- Added `.hsignore` entries for local test HTML files
- Replaced reserved HubSpot field names: `body`→`body_text`, `label`→`label_text`, `value`→`value_text`, `name`→`name_text`
- Added required `default`/`occurrence` fixes to many `fields.json` files
- Fixed `contact-form.module/meta.json` content types (removed `ANY`)
- Removed unsupported HubDB date/comma filters in course/event modules
- Replaced invalid `{% redirect %}` in `portal.html` with client-side meta redirect fallback
- Changed page template extends from `./layouts/...` to `../layouts/...`
- Moved `{{ standard_header_includes }}` into `theme/templates/layouts/base.html`
- Removed `standard_header_includes` from `theme/templates/partials/_head.html`
- Fixed `theme/theme.json` responsive breakpoint schema (mobile only)
- Removed unsupported analytics text field group from `theme/fields.json`
- Removed invalid visibility dependency in `member-dashboard.module/fields.json`
- Patched `base.html` include paths: `./partials/` → `../partials/`
- Patched `_head.html` asset paths: `./assets/` → `../../assets/`
- Patched `header.html` module path: `./modules/header.module` → `../../modules/header.module`
- Patched `footer.html` module path: `./modules/footer.module` → `../../modules/footer.module`

### Session 2 (this session)
- Updated `hsproject.json` `platformVersion` from `2024.2` → `2026.03`
- Updated `hsproject.json` portal IDs: staging=`443253065`, production=`441838610`
- Updated `scripts/upload.ts`: removed dependency on local `hubspot.config.yml`, added `ACCOUNT_MAP`, fixed `shell: true`, fixed `cwd` to run from `theme/` subdirectory
- Fixed `theme/templates/layouts/portal.html`:
  - `{% extends "./layouts/base.html" %}` → `{% extends "./base.html" %}`
  - `{% include "./partials/portal-nav.html" %}` → `{% include "../partials/portal-nav.html" %}`
- Fixed `theme/templates/layouts/checkout.html`:
  - `{% extends "./layouts/base.html" %}` → `{% extends "./base.html" %}`
  - `get_asset_url('./assets/img/logo.svg')` → `get_asset_url('../../assets/img/logo-dark.svg')`
- **Bulk fixed all 34 page templates** under `theme/templates/pages/*.html`:
  - `path="./modules/` → `path="../../modules/`
  - `get_asset_url('./assets/` → `get_asset_url('../../assets/`
  - `get_asset_url("./assets/` → `get_asset_url("../../assets/`
  - `assets/img/logo.svg` → `assets/img/logo-dark.svg`
- Fixed `theme/modules/logo-strip.module/module.html`:
  - Removed `member_tier=gold` from HubDB query (HubSpot validated this option at upload time and rejected it - same class of bug as date/comma filters removed by prior agent)
  - Now fetches all active members and filters by `row.member_tier == 'Gold'` in HubL

---

## Current Status of Path Fixes

All remaining grep hits for bad paths are inside `{# ... #}` HubL comment blocks (documentation only) - confirmed by file inspection. No live HubL paths remain broken.

To verify:
```powershell
Select-String -Path theme\templates\layouts\*.html,theme\templates\pages\*.html -Pattern 'path="\.\/modules\/|get_asset_url\(''\.\/assets|extends "\.\/layouts|include "\.\/partials'
```
Expected: only matches inside comment blocks (lines ≤ 15 in layout files).

---

## Local Validation

Always run before uploading:
```powershell
.\node_modules\.bin\tsx.CMD scripts\validate-theme.ts
```
Currently: **✅ No spec violations found.**

---

## Diagnosis: Why the Canvas Is Still Blank

The skip link is rendered by `base.html` which means the template inheritance chain is working. The blank canvas is almost certainly one of these:

### Most Likely: CSS not loading

`base.html` includes `_head.html` which references `critical.css`. If the `get_asset_url()` path is resolving to a 404, all CSS (including `.skip-to-content { position: absolute; ... }`) fails to load and the skip link appears as a visible link.

**Check:** In the HubSpot editor or a preview, open browser DevTools → Network tab → filter by `.css`. See if `critical.css` returns 200 or 404.

### Second Likely: Module paths missing `.module` suffix

HubSpot DnD module `path=` attributes may require the full `.module` folder name:
```
path="../../modules/hero"
```
may need to be:
```
path="../../modules/hero.module"
```

**Test approach:** Edit `theme/templates/pages/about.html` only - change `path="../../modules/hero"` → `path="../../modules/hero.module"` for ALL modules in that one file. Upload and test `about.html` specifically before changing all pages.

### Third: Header/footer modules not found

`_head.html` is included from `base.html`. `header.html` and `footer.html` are included from `base.html`. If those partials reference modules by wrong path (with or without `.module` suffix), the entire page body above/below `{% block body %}` would fail silently.

Check `theme/templates/partials/header.html` - it should have:
```
{% module "site_header" path="../../modules/header.module" %}
```
If it still says `path="../../modules/header"` (without `.module`), add the suffix.

---

## Recommended Next Steps (in order)

### Step 1 - Verify CSS loading
Open the HubSpot page editor for the Home page. Open browser DevTools Network tab, reload the preview, filter by `.css`. Check if `critical.css` is loading. If 404 → the `get_asset_url` path is wrong.

### Step 2 - Test `.module` suffix on one page
Edit `theme/templates/pages/about.html`. Add `.module` suffix to ALL `path="../../modules/..."` entries on that page only:
```
path="../../modules/hero"  →  path="../../modules/hero.module"
```
Upload just that file:
```powershell
.\node_modules\.bin\hs.CMD cms upload theme/templates/pages/about.html weld-australia-theme/templates/pages/about.html --account=weld-australia-staging --config=hubspot.config.yml
```
Open the About page in the HubSpot editor and check if modules appear in the canvas.

### Step 3 - If `.module` suffix fixes it, bulk apply to all pages
```powershell
$pages = Get-ChildItem "theme\templates\pages\*.html"
foreach ($file in $pages) {
    $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    $modified = $content -replace 'path="(\.\.\/\.\.\/modules\/[^"\.]+)"', 'path="$1.module"'
    if ($modified -ne $content) {
        [System.IO.File]::WriteAllText($file.FullName, $modified, [System.Text.Encoding]::UTF8)
        Write-Host "Updated: $($file.Name)"
    }
}
```
Then re-upload the full theme.

### Step 4 - Check header/footer partial module paths
```powershell
Select-String -Path theme\templates\partials\header.html,theme\templates\partials\footer.html -Pattern 'path='
```
Verify both show `../../modules/header.module` and `../../modules/footer.module` (with `.module` suffix).

### Step 5 - Check HubSpot Design Manager for runtime errors
In HubSpot portal → Marketing → Files and Templates → Design Manager → find `weld-australia-theme/templates/pages/home.html` → click to open. HubSpot sometimes shows template errors inline.

---

## File Structure Reference

```
theme/
├── theme.json                          ← theme manifest (uploaded)
├── templates/
│   ├── layouts/
│   │   ├── base.html                   ← PATCHED ✅ (correct ../partials/ paths)
│   │   ├── portal.html                 ← PATCHED ✅ (./base.html, ../partials/portal-nav)
│   │   └── checkout.html              ← PATCHED ✅ (./base.html, logo-dark.svg)
│   ├── partials/
│   │   ├── _head.html                  ← PATCHED ✅ (../../assets/ paths)
│   │   ├── header.html                 ← PATCHED ✅ (../../modules/header.module)
│   │   ├── footer.html                 ← PATCHED ✅ (../../modules/footer.module)
│   │   └── portal-nav.html             ← unchanged
│   └── pages/
│       └── *.html (34 files)           ← ALL PATCHED ✅ (../../modules/, ../../assets/)
├── modules/
│   └── *.module/                       ← validated clean
└── assets/
    ├── css/critical.css                ← built by pnpm build
    ├── js/                             ← built React bundles
    └── img/
        ├── logo-dark.svg               ← use this (logo.svg does not exist)
        └── logo-light.svg
```

---

## Available Logo Assets

- `theme/assets/img/logo-dark.svg` ← use on light backgrounds
- `theme/assets/img/logo-light.svg` ← use on dark backgrounds
- `theme/assets/img/logo-dark-alt.svg`
- `theme/assets/img/weld-australia-logo@2x.png`
- `theme/assets/img/logo.svg` - **does not exist**, all references have been replaced with `logo-dark.svg`

---

## Build Before Upload

Always build React assets before uploading:
```powershell
pnpm build
```
Then upload. Or use the all-in-one (note: this uses the `scripts/upload.ts` which now correctly targets `weld-australia` production account):
```powershell
pnpm upload:prod
```
But `pnpm upload:prod` uses the global CLI which is blocked by `hsproject.json`. **Use the manual command above instead.**

---

## HubSpot Accounts Reference

| Account name | Portal ID | Purpose |
|---|---|---|
| `weld-australia-staging` | `443253065` | **Staging portal** - deploy here first |
| `weld-australia` | `441838610` | **Production** - the live site |

> ⚠️ **Corrected 2026-09-18.** This table previously said `441838610` was
> "staging/production (use this)" and `443253065` was a sandbox. That was
> backwards, and `pnpm upload:staging` was deploying to the live site as a
> result. See DEPLOYMENT.md §2.
| `refuelcreative` | `4538263` | Refuel Creative agency portal |

---

## Project Context

Full project brief is in `CLAUDE.md` at the repo root. Key facts:
- HubSpot Content Hub Professional (no native Custom Objects)
- Hard deadline: **30 June 2026** (CAMS/Dynamics decommission)
- All page builds must be complete by **13 June 2026** (already overdue - prioritise)
- React islands compiled by Vite, mounted into HubL module HTML via `data-props` pattern
- HubDB tables are the display layer (courses, members, team, certification_guidance)
- SSO deferred to Phase 2 - portal uses HubSpot Membership credentials only
