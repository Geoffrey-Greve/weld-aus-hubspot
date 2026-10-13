# HubL templates and modules

The server-rendered half of the theme: layouts, page templates, partials, and
the 102 custom modules. The React half is
[04-react-island-pattern.md](./04-react-island-pattern.md) and
[14-shared-library.md](./14-shared-library.md).

---

## 1. File annotations

Every HubL file starts with an HTML comment HubSpot parses:

```html
<!--
  templateType: page
  label: Home
  isAvailableForNewContent: true
-->
```

| Value | Use for |
|---|---|
| `templateType: page` | Anything an editor creates a page from (`theme/templates/pages/*`) |
| `templateType: none` | Layouts, partials and macro files. Stops HubSpot treating them as standalone templates |
| System types | `theme/templates/system/*` (error pages, membership screens, search, subscriptions) |

Get this wrong and the file either cannot be selected as a page template, or it
pollutes the template picker.

---

## 2. Layouts

### `base.html`

Root layout for every public page. Provides:

| Block | Purpose |
|---|---|
| `extra_head` | Extra `<head>` content. Page templates set their own `<title>`/description here |
| `body_class` | Extra classes on `<body>` |
| `site_header` | Override the whole header region |
| `portal_nav` | Empty slot; `portal.html` fills it |
| `body` | Page content |
| `pre_footer_accent` | Brand accent line before the footer |
| `site_footer` | Override the whole footer region |

It also owns: the skip link (first focusable element), the GTM `<noscript>`
frame, `<main id="main-content" tabindex="-1">`, and two small inline scripts
worth knowing about:

- **Auth status-label normalisation.** HubSpot Private Content widgets emit
  global status and error placeholders as empty `<label>` elements, which
  accessibility tooling flags. On `is-auth-page` bodies they are converted to
  `role="status"` / `role="alert"` containers.
- **Inline-SVG repaint nudge.** A Blink paint-invalidation bug blanks inline
  `<svg>` icons that use `currentColor` after a back-forward-cache restore.
  Icons in links and buttons get a one-frame transform on `pageshow` and
  `visibilitychange`.

### `portal.html`

Extends `base.html`, adds the `is-portal` body class, injects
`window.__WELD_MEMBER__`, includes `portal-nav.html`, and wraps content in
`.portal-content` with `data-portal-context`, `data-member-tier` and
`data-member-status`. Portal page templates fill `portal_content`, not `body`.
See [16-membership-and-pricing.md](./16-membership-and-pricing.md).

### `checkout-layout.html`

Extends `base.html` and keeps the normal site header and footer, so checkout
reads as part of the site rather than a walled tunnel. Adds the progress band
(`#wa-checkout-steps`, populated by the `checkout-tunnel` island) and loads
`checkout.css`. Note it calls `{{ super() }}` in `extra_head` so the parent
block is preserved.

---

## 3. Page templates

`theme/templates/pages/` holds around 55 templates. Two things to understand:

**A template is not a page.** Uploading a template makes it available in
HubSpot; someone still has to create the page, set its URL, and (for portal
pages) set the Private Content audience. `DEPLOYMENT.md` § 7 lists every
HubSpot-side step an upload cannot do.

**Most templates carry their content inline.** Page bodies are built from
`{% dnd_area %}` / `{% dnd_section %}` / `{% dnd_module %}` with field values
written into the template (see `home.html`). Those values seed a page on first
creation. After that the page's own content wins, so changing the template does
not change a live page's copy. That is the single most common "my change did not
appear" cause: the fix is in the page editor, not in git. See
[page-editor-field-checks.md](./page-editor-field-checks.md).

### Dynamic-page templates

Six HubDB tables drive dynamic pages. The row is `dynamic_page_hubdb_row`.

| Table | URL pattern | Template |
|---|---|---|
| `courses` | `/courses/{course_slug}` | `course-router.html` |
| `events` | `/events/{slug}` | `event-detail.html` |
| `resources` | `/resources/{slug}` | `resource-detail.html` |
| `jobs` | `/job-board/{slug}` | `job-detail.html` |
| `team_and_board` | `/about/team/{hs_path}` | `about-team.html` |
| `certification_pathways` | `/certification/{slug}` | `certification.html` |

`course-router.html` reads `parent_template` off the row (`standard` or `sales`)
and delegates to the standard or high-polish layout, so both live in one URL
space.

---

## 4. Partials

`theme/templates/partials/` holds two kinds of file: includes and macro
libraries. Includes share the parent scope, so an include that needs an input
reads a variable you set first.

| Partial | Kind | Notes |
|---|---|---|
| `_head.html` | include | Title, meta, OG, GTM, favicons, fonts, `critical.css`, brand-kit `:root` overrides from theme settings. Set `page_title` / `page_description` / `og_image` before including |
| `_fonts.html` | include | `@font-face` via `get_asset_url()`. Kept out of `critical.css` because relative font URLs 404 on the HubSpot CDN |
| `header.html`, `footer.html`, `portal-nav.html`, `brand-line.html` | include | Site chrome |
| `_member-tier.html` | macros | `is_real_tier`, `scrub`, `prefer_pricing_tier`. The one implementation of the CRM sentinel rule |
| `_member-pricing.html` | macros | `member_tier_key`, `tier_price`, `member_price`, `non_member_price`. Mirrors `memberPricing.ts` |
| `_resource-member-resolve.html`, `_resource-pricing.html` | include | Resource entitlement and pricing |
| `_qa-persona-resolve.html` | include | Plus-address QA personas from `portal_test_profiles`. Set `qa_persona_email` first |
| `course-taxonomy.html` | macros | **Generated** from `config/course-categories.json` |
| `_job-apply.html`, `job-detail-*.html`, `team-profile-*.html`, `course-*.html` | include | Composed page fragments |

### Two HubL rules these partials exist to enforce

1. **Always `|trim` a macro result.** HubL macros emit the surrounding
   whitespace, so `{% if wa_tier.is_real_tier(x) %}` is always true. Write
   `{% set _ok = wa_tier.is_real_tier(x)|trim %}`.
2. **Macros here never call other macros.** HubL is a restricted Jinja2 and a
   cross-macro call inside an imported namespace fails server-side on upload,
   not locally. The duplication is intentional.

---

## 5. Module anatomy

```
theme/modules/<name>.module/
  fields.json    editor-facing field definitions
  meta.json      label, help text, content types, tags
  module.html    the HubL template
  module.css     optional, scoped styles
  module.js      optional, vanilla JS
```

`meta.json` in practice:

```json
{
  "label": "Hero",
  "help_text": "Full-width hero section with headline, optional right-side image or video, and CTA buttons.",
  "content_types": ["SITE_PAGE", "LANDING_PAGE", "BLOG_POST", "BLOG_LISTING"],
  "is_available_for_new_content": true,
  "global": false,
  "css_assets": [], "js_assets": [], "external_js": [], "other_assets": [],
  "smart_objects": [], "icon": "", "tags": ["hero", "banner", "cta"]
}
```

`categories` is validated against HubSpot's enum, maximum three.
`host_template_types` is deprecated; use `content_types`.

### Shared field conventions

Four fields recur across most modules. Keep the names and choice values
identical so the CSS and the editor experience stay consistent.

| Field | Type | Values |
|---|---|---|
| `section_id` | text | Anchor ID, lower-case hyphenated, blank by default |
| `background` | choice | `primary`, `primary_dark`, `surface`, `surface_alt`, `transparent` |
| `spacing` | choice | `compact`, `default`, `spacious` |
| `members_only` | boolean | When true the module renders only for logged-in active members |

They map onto the section wrapper:

```html
<section class="wa-section wa-section--{{ module.background }} wa-section--{{ module.spacing }}"
         {% if module.section_id %}id="{{ module.section_id }}"{% endif %}>
  <div class="container">…</div>
</section>
```

`components.css` supports both `wa-section--<value>` and the longer
`wa-section--bg-<value>` / `wa-section--spacing-<value>` forms.

### `fields.json` rules the validator enforces

- `name` matches `^[a-z0-9_]+$`
- `type` is one of HubSpot's documented field types (`choicegroup` is not one)
- Multi-select `choice` sets `"display": "checkbox"` and `"multiple": true`
- Conditional visibility uses a valid operator, a `controlling_field` that
  exists, and `controlling_value_regex` only with a regex-capable operator

That last one matters: a mismatched operator hides the field in the editor
forever and HubSpot raises no upload error. `pnpm validate` catches it.

---

## 6. Authoring a HubL-only module

1. Create the folder with the four files.
2. Add the shared `section_id` / `background` / `spacing` (and `members_only`
   where the section is gated) fields and the section wrapper.
3. Prefix every class `wa-` and namespace it to the module.
4. Put styles in `module.css` unless they belong to the design system, in which
   case they go in `theme/assets/css/`.
5. Wrap any HubDB read in a sensible order and limit:
   `hubdb_table_rows('courses', 'course_id__eq=' ~ id ~ '&orderBy=start_date')`.
6. `pnpm validate`, then `pnpm watch` and check it on the portal.
7. Document it in [02-module-catalog.md](./02-module-catalog.md).

Reach for HubL, not React, for static content, heroes, testimonials, card
grids and anything that does not need client-side interaction. React costs a
bundle; HubL does not.

---

## 7. Authoring a module that hosts a React island

The full walkthrough is [04-react-island-pattern.md](./04-react-island-pattern.md).
The mechanics that live on the HubL side:

1. Serialise everything the island needs into one props dict and emit it:

   ```html
   <div data-wa-module="course-filter" data-props="{{ full_props | tojson | escape }}"></div>
   ```

   `data-props` is the contract. A child
   `<script type="application/json" data-props-json>` is also supported for
   payloads too large or awkward for an attribute.

2. Leave the bundle tag to the build. On a new module, put the placeholder where
   the tag should go:

   ```html
   {# @bundle: course-filter #}
   ```

   `pnpm build` replaces it with the real `<link>` and `<script type="module">`
   and rewrites it on every later build. Do not hand-edit that line.

3. Add the module name to `HUBSPOT_STANDALONE_MODULES` in `scripts/build.ts`.
   Without that, no standalone bundle is built and the placeholder is never
   replaced.

4. Resolve entitlement and tier **in HubL**, not in React. `course-filter`'s
   preamble is the reference implementation, and it is long for a reason: the
   lightweight private-content contact object does not always expose both
   membership fields, so it falls back through `crm_object` by several candidate
   IDs, then an email lookup, then the associated company, then the members
   directory, scrubbing sentinels at each step. Copy that pattern rather than
   inventing a shorter one.

Note that `data-wa-module` is not a reliable census of React islands:
`course-pathways.module` uses the same attribute with inline vanilla JS. The
authoritative list is `HUBSPOT_STANDALONE_MODULES`.

---

## 8. CSS architecture

Six files are concatenated into `critical.css` by the build, in cascade order:

| File | Contains |
|---|---|
| `tokens.css` | Every `--wa-*` custom property |
| `reset.css` | Modern reset |
| `base.css` | Base typography, links, focus ring, `overflow-x: clip` backstop |
| `utilities.css` | `.container`, `.stack-*`, `.cluster`, `.visually-hidden`, `.truncate` |
| `components.css` | Buttons, fields, badges, alerts, `.wa-section--*` |
| `hero.module/module.css` | Above-the-fold hero |

Everything else in `theme/assets/css/` is a per-page or per-feature stylesheet
loaded by the template or module that needs it (`course-detail.css`,
`checkout.css`, `job-board.css`, `events-landing.css`, `auth.css`, …). Load them
with `get_asset_url()` from the template's `extra_head` block or the module.

### Brand kit

`theme/fields.json` defines the theme settings an editor controls: brand
colours (primary, primary dark, secondary, accent gold, magenta, gradient mid,
success) and typography. `_head.html` writes those into a `:root` override
block, so a change in theme settings cascades through every template and island.
`tokens.css` carries the same values as defaults, so the site renders correctly
before any override is set.

Accessible text tones are separate tokens on purpose:
`--wa-color-magenta-text`, `--wa-color-magenta-on-dark`, `--wa-color-gold-text`
exist because the vibrant brand colours fail WCAG 1.4.3 as text. Use the vibrant
tokens for bars, CTAs and gradients; use the `-text` tokens for text. The ratios
are asserted in `src/test/wcag-contrast.test.ts`.

### Mandatory UX rules

From the UX brief, enforced by tests where possible:

1. No horizontal data tables on mobile. Every HubDB listing collapses to cards
   below 768px.
2. 44x44px minimum touch targets, including filter chips and sort headers.
3. Locked content shows a preview plus an upgrade CTA, never a 403.
4. Member savings are shown in `--wa-color-success`, bold.
5. State-specific content offers a manual National toggle.
6. Time-sensitive prompts use toasts or alert banners.

`tests/a11y/interactions.spec.ts` covers the touch-target sweep and
`overflow.spec.ts` covers mobile overflow. See [17-testing.md](./17-testing.md).
