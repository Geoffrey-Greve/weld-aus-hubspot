# Home Page - design implementation (2026-06-01)

Implements the approved **Home Page** design (Claude Design handoff
`OYaCmBTPC4BD-ee3IEPTkQ`). Built per the master prompt's rules: every section is
a drag-and-drop module, brand is global (theme tokens, no hard-coded hexes in
module logic), existing modules reused/adjusted rather than duplicated.

## Brand kit (editor-configurable, global)

The brand is exposed as **theme fields** (Theme settings → Brand colours /
Typography) in `theme/fields.json`: primary, primary-dark, secondary, accent,
magenta, flame-gradient mid, success, plus heading & body **font** fields
(standard Google Fonts, loaded automatically). `_head.html` maps each field onto
the matching `--wa-*` custom property and builds the Google Fonts request from
the selected families, so an editor can re-brand the whole site with no code.
`tokens.css` holds the same values as defaults, so everything renders correctly
before any override is set (and for React islands / email).

The values below are the defaults, confirmed by the design and superseding the
earlier `weldaustralia.com.au` visual-inspection placeholders.

| Token | Before | After |
|---|---|---|
| `--wa-color-primary` | `#002f5f` | `#1c1e4c` (navy/indigo) |
| `--wa-color-primary-dark` | `#001e3e` | `#0f1030` |
| `--wa-color-accent` | `#c9a227` | `#fecf05` (brand gold) |
| `--wa-color-magenta` | - | `#ed128d` (new) |
| `--wa-gradient-flame` | - | magenta → orange → gold (new) |
| `--wa-font-heading` / `-body` | Inter | **Poppins** |

Font loading switched to Poppins in `templates/partials/_head.html`.
`assets/css/critical.css` regenerated (concatenation of tokens → reset → base →
utilities → components). Run `pnpm build` to regenerate after any token edit.

## Section → module map

| # | Design section | Module | Notes |
|---|---|---|---|
| 1 | Hero | `hero` | + new `eyebrow`, `video_embed_url`, `accent_bar` fields |
| 2 | Our Impact | `stat-tiles` | 4 stats |
| 3 | About | `two-col-text-image` | image right; IIW callout omitted (see gaps) |
| 4 | What We Offer | `service-cards` | + new **photo card** style (`card_style="photo"`) |
| 5 | Welding Membership | `value-props-3up` | `primary` bg; 4 tier cards |
| 6 | Why Join | `value-props-3up` | 6 benefits |
| 7 | Trusted by Industry | `logo-strip` + `testimonial-slider` | logos from HubDB Gold members |
| 8 | Resources | `resource-teaser` | HubDB resources, member-wall locked state |
| 9 | Latest News | `blog-listing` | 3 latest posts |
| 10 | CTA Banner | `cta-banner` | gold + white-outline CTAs on navy |

## Module / system changes

- **`hero`** - added `eyebrow` (magenta overline), optional `video_embed_url`
  (16:9 embed on desktop, "Watch our video" link below), and `accent_bar`
  (flame gradient). Primary CTA gained an `accent` (gold) style option.
- **`service-cards`** - added a `photo` card style (full-bleed image, dark
  scrim, category tag pill, clamped copy, outline CTA) alongside the existing
  elevated style. Standardised the card CTA link to `.url.href`.
- **`components.css`** - added a shared **section system**: one set of
  `.wa-section--*` rules (padding + background) covering both class conventions
  modules emit (`--<x>` and `--bg-<x>`) and both spellings (`surface_alt` /
  `surface-alt`). Fixes previously silent failures where `surface_alt` /
  `primary_dark` backgrounds and some modules' section padding never applied.
- **`components.css`** - added `.btn-outline` (translucent white outline for
  dark backgrounds). `cta-banner` now renders gold primary + white-outline
  secondary CTAs on primary backgrounds (the old navy `btn-primary` was
  invisible on navy).

## Second pass - resolved

- **Brand kit** is now fully editor-configurable (theme fields + Google Font
  fields); see "Brand kit" above.
- **Stat tiles** - added an `tile_style="alternating"` variant (filled navy /
  outlined white cards, gold numbers, decorative disc).
- **About** - the IIW callout chip is back: `two-col-text-image` gained an
  optional `callout` group (logo + eyebrow + title), wired with `iiw-logo.webp`.
- **Membership** - tier badge logos (Gold/Silver/Bronze/Individual) are wired in
  as the card icons, kept full-size (HubSpot image optimisation handles
  resizing/serving).
- **Why Join** - six brand-navy SVG icons added (`assets/img/icons/`) matching
  the comp, wired into the cards.
- **Logo strip** - added an `animation` toggle (`static` / `marquee`); the
  marquee auto-scrolls, pauses on hover, and falls back to a static wrapped row
  under `prefers-reduced-motion`. Home uses `marquee`.
- **CTA band** - added an optional third CTA; home now shows Become a member /
  Find a course / Get certified.
- **Membership** - `value-props-3up` gained a `split` layout (header/intro/CTA
  column beside a 2×2 card grid) plus an optional header CTA; the per-card link
  now uses the standard `.url.href` shape. Home's membership section now matches
  the comp: left intro + "Explore membership options" CTA, four tier cards with
  badges and "Learn more" links.

## Remaining gaps (follow-up)

- Tier badge PNGs are ~1-3 MB source files - fine via HubSpot's image pipeline,
  but worth re-exporting smaller. Per-tier coloured card borders
  (gold/silver/bronze) from the comp are not yet applied.
- **Photography** uses the comp's Unsplash stand-ins - swap for brand assets.
- Verify hero eyebrow contrast on navy (design uses ~60% white) against WCAG AA.
