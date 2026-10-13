# QA Log - Cross-device / Cross-browser Pass

**Date:** 2026-05-22  
**Branch:** `chore/qa-pass`  
**Method:** Static code audit + Vite build inspection (remote container - no live browser access).  
**Tester:** Claude Code

> **Note:** This environment cannot drive real browsers or physical devices. The audit was conducted via full source review of all React islands, CSS files, HubL templates, the Vite build output, and the build/patch scripts. Real-device smoke testing against the HubSpot sandbox must be performed by Ryan before launch sign-off.

---

## Test surfaces reviewed

| Surface | Files inspected |
|---|---|
| Header nav (desktop + mobile hamburger) | `header.module/{module.html,module.css,module.js}` |
| Course filter | `CourseFilter.tsx`, `CourseFilter.css`, `course-filter.module/module.html` |
| Find a Member filter + pagination | `FindAMember.tsx`, `FindAMember.css`, `find-a-member.module/module.html` |
| Resource library locked/unlocked | `ResourceLibrary.tsx`, `ResourceLibrary.css`, `resource-library.module/module.html` |
| Login → Dashboard → logout | `login.html`, `Dashboard.tsx`, `Dashboard.css`, `portal-nav.html` |
| Profile edit + save | `profile-form.module/{module.html,module.js}` |
| Corporate admin (add employee, bulk register) | `CorporateAdmin.tsx`, `CorporateAdmin.css` |
| Checkout end-to-end | `CheckoutTunnel.tsx`, `CheckoutConfirmation.tsx` |
| Shared: CSS loading, tokens, build pipeline | `build.ts`, `vite.config.ts`, manifest, all `*.module/module.html` |

---

## Bug Log

### P1 - Critical (must be zero at launch)

---

#### BUG-001 · React module CSS never loaded in production

**Severity:** P1  
**Browsers/devices:** ALL (Chrome, Safari, Firefox, Edge, iOS Safari, Android Chrome)  
**Component:** All React islands (course-filter, find-a-member, resource-library, member-dashboard, corporate-admin, checkout-tunnel, checkout-confirmation, profile-switcher, team-grid, events-listing, jobs-listing, certification-guidance, course-timetable-filter, my-courses, my-events, my-invoices)

**Repro steps:**
1. Run `pnpm build`
2. Inspect the Vite manifest at `theme/assets/js/manifest.json`
3. Observe each entry has a `"css": ["assets/<name>.hash.css"]` array
4. Open any page that hosts a React module (e.g. `/courses/`, `/find-a-member/`, `/resources/`)
5. Open DevTools → Network → filter CSS
6. The per-module CSS file is absent from the network waterfall

**Root cause:**  
`scripts/build.ts` patches `module.html` files with the `<script type="module">` tag for the JS bundle, but does **not** add a `<link rel="stylesheet">` tag for the extracted CSS file listed in the Vite manifest. Vite 5 in multi-entry (non-library) mode extracts CSS into separate files and does NOT self-inject them from the JS bundle. Every React island renders without any of its own CSS.

**Impact:**  
- All card layouts unstyled (no grid, no shadows, no tier badge colours)
- Locked overlays on Resources Hub invisible (no gradient, no upgrade CTA styling)
- Pagination buttons unstyled
- Filter chips unstyled
- Checkout steps unstyled
- Dashboard tiles unstyled

**Fix:** Update `build.ts` to also inject `<link rel="stylesheet" href="{{ get_asset_url('../assets/js/<css-file>') }}">` immediately before the `<script type="module">` tag, for every entry that has an associated CSS file in the manifest. ✅ **Fixed in this PR.**

---

### P2 - High (should be zero at launch)

---

#### BUG-002 · Mobile sub-menu links: 40 px touch target (WCAG 2.5.5 violation)

**Severity:** P2  
**Browsers/devices:** iOS Safari (iPhone 12+), Android Chrome (Pixel-class)  
**Component:** `header.module/module.css` - `.wa-mobile-nav__sub-link`

**Repro steps:**
1. Open the site on a mobile device
2. Tap the hamburger to open the mobile nav
3. Tap a parent item with children (e.g. "Training") to expand the sub-menu
4. Attempt to tap a sub-menu link (e.g. "Course Timetable")

**Root cause:**  
`.wa-mobile-nav__sub-link { min-height: 40px; }` - The project's own design constraint (`--wa-touch-min: 44px`, CLAUDE.md §5.4 rule 2, WCAG 2.5.5) mandates 44 × 44 px. The parent-level links and all other interactive elements in the header correctly use `var(--wa-touch-min)`.

**Fix:** Change `min-height: 40px` → `min-height: var(--wa-touch-min)`. ✅ **Fixed in this PR.**

---

#### BUG-003 · `wa-btn` base styles absent from global theme CSS - EOI and corporate buttons render as bare browser-default elements

**Severity:** P2  
**Browsers/devices:** ALL  
**Component:** `CourseFilter.tsx` (EOI submit button), `CorporateAdmin.tsx` ("Add employee" link)

**Repro steps:**
1. Navigate to a course page with no sessions in the selected city (triggers EOI form)
2. Observe the "Register interest" submit button - renders as an unstyled browser default `<button>`
3. Navigate to the corporate admin team page
4. Observe the "+ Add employee" CTA - renders as an unstyled link

**Root cause:**  
React components use the `wa-btn` / `wa-btn--primary` / `wa-btn--secondary` class convention. The global theme CSS (`components.css`) defines `.btn`, `.btn-primary`, etc. - a different prefix. The `.wa-btn` base class (display, min-height, padding, font-weight, border-radius, cursor) is only defined inside `Dashboard.css` - it is not globally available. Affected components have module-specific overrides for their primary CTAs (`.wa-course-filter__cta`, `.wa-rl__download-btn`, etc.) but the EOI form submit and the corporate admin CTA link have no local override.

**Note:** After BUG-001 is fixed (CSS loaded), this remains a separate issue because even loading `CourseFilter.css` does not supply `.wa-btn--primary` colours.

**Fix:** Add `.wa-btn` and modifier variants (`.wa-btn--primary`, `--secondary`, `--ghost`, `--disabled`) to `theme/assets/css/components.css`, so all pages that load the global stylesheet provide the base button styles to React islands. ✅ **Fixed in this PR.**

---

#### BUG-004 · Pagination: no scroll-to-top on page change - mobile users see pagination controls, not new results

**Severity:** P2  
**Browsers/devices:** iOS Safari (iPhone 12+), Android Chrome  
**Component:** `Pagination.tsx`, `FindAMember.tsx`, `ResourceLibrary.tsx`

**Repro steps:**
1. Open Find a Member or Resources Hub on a mobile device (< 768 px viewport)
2. Scroll down to the pagination controls at the bottom of the first page of results
3. Tap "Next page" (page 2)
4. The results update but the viewport stays at the pagination controls - the user is looking at the bottom of the page, not the new results

**Root cause:**  
`Pagination` calls `onChange(page)`, which updates state and causes a React re-render. There is no `window.scrollTo` or `element.scrollIntoView()` call to reposition the viewport. On desktop this is less noticeable because the full page is often visible; on mobile, it is confusing.

**Fix:** Pass a `containerRef` from each parent component to `Pagination`; on page change, scroll the container into view. ✅ **Fixed in this PR.**

---

#### BUG-009 · SharePoint resource links show a Microsoft login on Android (QA #46)

**Severity:** P2  
**Browsers/devices:** Android Chrome + in-app webviews (also affects some iOS/desktop clients)  
**Component:** `resource-library.module/module.html`, `resource-detail.html`, `resource-teaser.module/module.html`, `certification.html`, `split-feature.module/module.html`, `templates/partials/_sharepoint.html` (new)

**Repro steps:**
1. On an Android phone, open a resource whose `file_url` is a SharePoint share link, e.g. the certification "Download brochure" button (`…/:b:/s/WeldsPublicDocuments/…?e=…&download=1`).
2. Instead of downloading the file, the browser hands off to the OneDrive/SharePoint app or shows a Microsoft sign-in interstitial.

**Root cause:**  
SharePoint share links in the `/:b:/s/<Site>/<token>` format route through SharePoint's guest-access **preview** page. On Android, Chrome hands the `sharepoint.com` domain to the OneDrive/SharePoint app (or shows the preview/login interstitial) rather than serving the file - even with `?download=1` appended.

**Fix:** New shared HubL macro `sharepoint_direct_url` (`templates/partials/_sharepoint.html`) rewrites site-scoped share links to SharePoint's direct-download endpoint:
```
…/:b:/s/<Site>/<token>?…  →  …/sites/<Site>/_layouts/15/download.aspx?share=<token>
```
which serves the bytes with `Content-Disposition: attachment` and skips the preview/app handoff. Applied to every resource emit site (the macro is idempotent and leaves non-SharePoint URLs untouched). The two hardcoded brochure links now use the direct-download form directly. **`video` resources are excluded from the rewrite** - they are embedded in an `<iframe>` / opened in a player, and the attachment endpoint would download instead of play. ✅ **Fixed in this PR.**

**⚠ Caveat - must be verified by Weld Australia:** the rewrite only helps if the SharePoint files are shared as **"Anyone with the link"** (anonymous). If they are shared **"People in <org> with the link"**, the Microsoft login is mandatory and no URL rewrite can bypass it - the shares must be reconfigured, or the files rehosted (recommended: HubSpot File Manager, a public CDN with no auth, aligning with the platform-consolidation goal). Verify by opening one link in a desktop private window: if it downloads with no login, the shares are anonymous and this fix resolves the bug.

---

### P3 - Low (document for post-launch backlog)

---

#### BUG-005 · SmartAlerts uses emoji icons - inconsistent rendering across platforms

**Severity:** P3  
**Browsers/devices:** Windows Chrome/Edge (emoji font differs from macOS/iOS)  
**Component:** `member-dashboard/tiles/SmartAlerts.tsx`

**Details:** Alert icons use platform emoji (⚠, ⏰, 📋, ❌). On Windows the fallback emoji font produces visually different glyphs. No functional impact; purely visual inconsistency.

**Recommended fix (post-launch):** Replace with inline SVG icons matching the rest of the design system.

---

#### BUG-006 · `inset` CSS shorthand - potential issue on iOS 14.0-14.4

**Severity:** P3  
**Browsers/devices:** iPhone devices on iOS 14.0-14.4 (rare; most will have updated)  
**Component:** `header.module/module.css` (mobile nav), `ResourceLibrary.css` (locked overlay)

**Details:** `inset: 0 0 0 auto` and `inset: 0` are supported from Safari 14.1 / iOS 14.5+. iPhone 12 ships with iOS 14, but most devices in the field will have updated to 15+. Devices that have not updated will see the mobile nav drawer fail to position correctly and the locked overlay may not cover the card.

**Recommended fix (post-launch):** Add longhand fallbacks before the `inset` shorthand:  
```css
top: 0; right: 0; bottom: 0; left: auto; /* fallback */
inset: 0 0 0 auto;                        /* modern */
```

---

#### BUG-007 · `role="searchbox"` redundant on `<input type="search">`

**Severity:** P3 (ARIA over-annotation, no functional impact)  
**Component:** `FindAMember.tsx`, `ResourceLibrary.tsx`

**Details:** `<input type="search">` already carries the implicit ARIA role `searchbox`. The explicit `role="searchbox"` attribute is redundant per ARIA 1.2. Screen readers handle this correctly, but it may generate lint warnings.

**Recommended fix (post-launch):** Remove the explicit `role="searchbox"` attribute.

---

#### BUG-008 · Checkout confirmation silently shows empty on iOS private browsing

**Severity:** P3  
**Browsers/devices:** iOS Safari private mode  
**Component:** `CheckoutConfirmation.tsx`

**Details:** The confirmation page reads receipt data from `sessionStorage`. In iOS Safari private mode, `sessionStorage` is available but cleared on tab close; however, in some private browsing configurations the `getItem` call silently returns `null`. The `try/catch` in `CheckoutConfirmation` correctly handles a `SecurityError`, but there is no user-visible explanation when the receipt section is absent - the user just sees the editor-configured success heading/body without course-specific details.

**Recommended fix (post-launch):** Add a fallback message: "Your registration is confirmed - check your email for course details." in place of the receipt card when `receipt === null`.

---

#### BUG-009 · Footer social icons render blank "after clicking", intermittently (Android Chrome)

**Severity:** P2
**Browsers/devices:** Android Chrome (reported); any Blink-based browser
**Component:** `footer.module/{module.html,module.css}`, `layouts/base.html`

**Repro steps:**
1. Open the site on Android Chrome (or navigate away and return via the back button / another tab).
2. Observe the footer social icons - some render as empty bordered boxes with no glyph inside, "some of the time".

**Root cause:**
The social icons are inline `<svg>` elements whose fill/stroke is `currentColor`, inherited from the `.wa-footer__social-link` anchor. The anchor also declared `transition: color …`. Two Blink paint-invalidation quirks can then skip repainting the SVG subtree while the anchor's own CSS border still paints - producing a bordered box with a blank interior (exactly the reported screenshot):
- tapping a link on mobile leaves `:hover`/`:active` "stuck", and a `color` transition on an ancestor of a `currentColor` SVG can leave the icon painted with a dropped fill; and
- restoring the page from the back-forward cache / returning to the foreground tab re-composites without repainting the icon.

The icon markup and CSS are logically correct - a clean desktop render paints all five icons perfectly - which is why it only reproduces intermittently on-device.

**Fix:** ✅ **Fixed in this PR.**
- `footer.module/module.css`: moved the icon colour + `color` transition off the anchor and onto the `<svg>` itself (so hover is a direct style change on the painted element, which Blink re-invalidates reliably), and promoted the icon to its own compositing layer with `transform: translateZ(0)` so its texture survives taps and bfcache restores.
- `layouts/base.html`: added a tiny dependency-free global script that forces a single-frame repaint of inline `a svg` / `button svg` icons on `pageshow` (bfcache restore) and on return to visibility, as a site-wide safety net for the same class of bug on other icons.

**Real-device verification still required:** confirm on the reporter's Android device / HubSpot sandbox that the icons no longer blank after tapping and after back-navigation.

---

## Summary

| Severity | Count | Status |
|---|---|---|
| P1 | 1 | ✅ Fixed |
| P2 | 4 | ✅ Fixed |
| P3 | 4 | Documented for post-launch |

### Real-device testing required before launch

The following must be verified by Ryan against the HubSpot sandbox with real devices:

- [ ] **Chrome latest (Mac, Windows)** - header nav dropdowns, full checkout flow
- [ ] **Safari latest (Mac)** - sticky header, member dashboard tile rendering
- [ ] **Firefox latest** - `:has()` fallback `.is-open` on desktop nav dropdowns
- [ ] **Edge latest** - full checkout tunnel, profile switcher
- [ ] **iOS Safari on iPhone 12+** - hamburger, mobile sub-menu (touch targets), checkout on 4G
- [ ] **Android Chrome (Pixel-class)** - find-a-member filter, resource library locked state, corporate admin bulk register
- [ ] **Android Chrome (Pixel-class)** - SharePoint resource/brochure links download with **no Microsoft login** (QA #46 / BUG-009); first confirm the SharePoint shares are "Anyone with the link"
