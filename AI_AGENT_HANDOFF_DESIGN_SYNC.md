# Weld Australia HubSpot Theme - Design Sync Handoff

Date: 2026-06-18
Workspace: `C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot`
HubSpot account: `weld-australia-staging`
Portal ID: `441838610`

---

## Current Status

The homepage is rendering in HubSpot. Work is ongoing to achieve visual parity against the supplied standalone design file:

`C:\Users\Melwyn\Downloads\Home Page Standalone (8).html`

(This file was also uploaded into the session as:
`C:\Users\Melwyn\AppData\Roaming\Claude\local-agent-mode-sessions\...\uploads\Home Page Standalone (8).html`)

Compare every section of the live HubSpot homepage against that file section by section.

---

## IMPORTANT - Build and Upload NOT Yet Run for Latest Changes

The previous agent made CSS and HTML changes to the CTA banner module but **could not run the build or upload** because the Linux sandbox has no outbound internet access and the Windows node_modules binaries cannot run in Linux.

**The next agent must run these commands first thing from Windows PowerShell:**

```powershell
cd "C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot"
corepack pnpm build
.\node_modules\.bin\hs.CMD cms upload theme weld-australia-theme --account=weld-australia-staging --config=hubspot.config.yml
```

Successful upload ends with:
```
[SUCCESS] Uploading files to "weld-australia-theme" in the Design Manager is complete
```

After uploading, hard-refresh the HubSpot preview (Ctrl+Shift+R) before verifying.

---

## Important Rules

- Do not revert existing fixes unless explicitly asked.
- Do not re-add `media_type="video"` to the homepage hero module.
- HubSpot saved page/module field values can override template defaults. If a module keeps rendering with an old layout after upload, add narrow fallback logic based on stable homepage text content rather than relying only on template field defaults.
- The user judges success by the HubSpot online portal/editor preview - not local build output.
- After every meaningful fix: build → upload → ask user to verify in HubSpot.

---

## Commands

Run all commands from:
```powershell
cd "C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot"
```

Build:
```powershell
corepack pnpm build
```

Upload:
```powershell
.\node_modules\.bin\hs.CMD cms upload theme weld-australia-theme --account=weld-australia-staging --config=hubspot.config.yml
```

Use the local `node_modules` hs.CMD. Do not use a global `hs` command.

---

## Sections Already Fixed (Do Not Revert)

### 1. Hero
Files: `theme/modules/hero.module/module.html`, `module.css`

- Heading font/size matched to standalone design
- Hero text alignment and subheading colour adjusted
- Arrow icon styling added to primary CTA buttons
- Eyebrow text visibility restored
- Small yellow line added before eyebrow text
- `media_type="video"` was explicitly removed - do not add it back

### 2. Split Feature / Image Callout
Files: `theme/modules/split-feature.module/module.html`, `module.css`

- H2 heading colour and body copy styles adjusted
- Image callout title and sub-text styling adjusted
- Button arrow icons added

### 3. Card Grid / Service Cards / News Cards
Files: `theme/modules/card-grid.module/module.html`, `module.css`

- Section headings under overline text changed to left alignment
- Card colours, typography, and spacing partially synced with standalone

### 4. Stat Band
Files: `theme/modules/stat-band.module/module.html`, `module.css`

- "Building a stronger welding industry" heading no longer forced to centre under overline
- Stat tiles updated to match boxed stat structure in standalone

### 5. Membership Tiers
Files: `theme/modules/tiers.module/module.html`, `module.css`, `fields.json`

- Layout: text on left, tier cards on right
- Image/badge support added per tier
- Editable "Learn more" button fields added per tier with button style choices
- Fixed invisible link colour bug when a URL is added to "Learn more"
- Badge assets: `theme/assets/img/member-logo-gold.png`, `member-logo-silver.png`, `member-logo-bronze.png`, `member-logo-individual.png`

### 6. Icon Grid / Why Join Section
Files: `theme/modules/icon-grid.module/module.html`, `module.css`, `theme/templates/pages/home.html`

- Module uses `container-wide`
- CTA button has arrow icon
- "Why join Weld Australia?" section renders left-aligned even if HubSpot saved field is set to centre (narrow fallback logic added)

### 7. CTA Banner - "Ready to advance your welding career?"
Files: `theme/modules/cta-banner.module/module.html`, `module.css`

**Status: Files edited. Build and upload NOT yet run - must do this first.**

What was fixed in this session:

**Split layout forced for homepage CTA (previous session):**
- Narrow fallback: if `module.headline` stripped equals `Ready to advance your welding career?`, `_align` is forced to `split` regardless of HubSpot saved field value
- If body text is missing or contains old "join Australia..." copy, it is replaced with: `Find a course, earn a certification, or become a member today.`
- Container changed to `container-wide`
- Bottom magenta-to-gold gradient rule added

**Gap fix between headline and subtext (this session):**

Root cause: the previous CSS used `gap: 48px` on a CSS grid which applied the same large gap to both the row between headline/body AND the column between text/buttons.

Fix applied:
1. **HTML** (`module.html`): Wrapped `wa-cta-banner__headline` and `wa-cta-banner__body` in a new `<div class="wa-cta-banner__text">` element. This makes text a single flex child, with `wa-cta-banner__actions` as the sibling pushed right.

2. **CSS** (`module.css`): Changed split layout from grid to flex:
   - `.wa-cta-banner__content` is now `display: flex; flex-direction: row; justify-content: space-between; gap: 32px`
   - `.wa-cta-banner__text` wraps headline + body, `max-width: 560px`, `flex: 1 1 auto`
   - `.wa-cta-banner__headline` gets `margin-bottom: 16px` in split context (tight, matching standalone)
   - `.wa-cta-banner__actions` is `flex-shrink: 0` keeping buttons on the right

3. **Body text colour**: Changed from full white to `rgba(255, 255, 255, 0.6)` on dark/primary backgrounds, matching the standalone design's muted subtext.

After uploading, verify:
- Headline and subtext are tight together on the left (small gap, not 48px)
- Subtext appears in muted/dim white, not full bright white
- Buttons remain on the right, unchanged
- On mobile (<768px) it stacks correctly

---

## What Still Needs Work

The following sections have not been reviewed yet for visual parity. Compare each against the standalone HTML file:

- **Navigation / Header** - font, spacing, CTA button styling
- **News / Latest articles card section** - card layout, typography, image aspect ratio
- **Find a Member / directory teaser** - if present on homepage
- **Footer** - layout, link colours, column structure, social icons
- Any remaining spacing/padding differences between sections

Work through these section by section. For each fix: build → upload → ask user to verify.

---

## Standalone Design Reference

The standalone design is a React/JSX rendered HTML file. Key design values observed:

- **Font**: Poppins (heading and body)
- **Primary colour**: `#002f5f` (deep navy)
- **Accent/gold**: `#fecf05`
- **Magenta**: `#ed128d`
- **Body text on dark bg**: `rgba(255,255,255,0.6)` (muted)
- **Heading on dark bg**: `#fff`
- **CTA banner layout**: `display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 32px` with left text block `max-width: 560px` and `marginBottom: 8` on the h2

---

## Copy-Paste Prompt for the Next Agent

Please continue work on the Weld Australia HubSpot theme design sync.

Read this file completely before doing anything else:
`C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot\AI_AGENT_HANDOFF_DESIGN_SYNC.md`

Also read the project brief:
`C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot\CLAUDE.md`

Workspace: `C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot`

**IMPORTANT - do this first before anything else:**
The previous agent edited the CTA banner CSS and HTML but could not run the build or upload (sandbox had no internet access). You must run the build and upload immediately:

```powershell
cd "C:\Projects\Clients\Weld-Australia\Github\weld-aus-hubspot"
corepack pnpm build
.\node_modules\.bin\hs.CMD cms upload theme weld-australia-theme --account=weld-australia-staging --config=hubspot.config.yml
```

Then ask the user to hard-refresh the HubSpot preview and verify the "Ready to advance your welding career?" CTA section. It should show the headline and subtext tightly stacked on the left with the buttons on the right.

After confirming the CTA fix, continue the visual parity pass on the remaining homepage sections (navigation, news cards, footer, any spacing gaps) against the standalone design file:
`C:\Users\Melwyn\Downloads\Home Page Standalone (8).html`

Do not revert existing fixes. Do not re-add `media_type="video"` to the hero. Use narrow module-level fallback logic for known homepage sections when HubSpot saved field values override template defaults.

Use these commands after every set of changes:
```powershell
corepack pnpm build
.\node_modules\.bin\hs.CMD cms upload theme weld-australia-theme --account=weld-australia-staging --config=hubspot.config.yml
```
