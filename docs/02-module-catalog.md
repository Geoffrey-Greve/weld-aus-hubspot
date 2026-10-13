# Weld Australia - Custom Module Catalog

> Companion to `CLAUDE.md` and `docs/01-sitemap.md`. Lists every HubSpot CMS module we're shipping with its editor-facing `fields.json` so content editors can configure pages without touching code.

---

## Module Conventions

Every module in this catalog ships with the following standard fields **in addition** to its module-specific fields. Build them as a shared partial group included into each `fields.json`.

### Standard fields (all modules)

```json
[
  {
    "name": "section_id",
    "label": "Section anchor ID (optional)",
    "type": "text",
    "help_text": "Used for in-page anchor links. Lower-case, hyphenated. Leave blank if not needed.",
    "default": ""
  },
  {
    "name": "background",
    "label": "Background style",
    "type": "choice",
    "choices": [
      ["surface", "Surface (default light)"],
      ["surface_alt", "Alt surface (subtle grey)"],
      ["primary", "Primary (brand colour)"],
      ["primary_dark", "Primary dark"],
      ["transparent", "Transparent"]
    ],
    "default": "surface"
  },
  {
    "name": "spacing",
    "label": "Vertical spacing",
    "type": "choice",
    "choices": [
      ["compact", "Compact (32px)"],
      ["default", "Default (64px)"],
      ["spacious", "Spacious (96px)"]
    ],
    "default": "default"
  },
  {
    "name": "visibility",
    "label": "Show on devices",
    "type": "choicegroup",
    "multiple": true,
    "choices": [
      ["mobile", "Mobile"],
      ["tablet", "Tablet"],
      ["desktop", "Desktop"]
    ],
    "default": ["mobile", "tablet", "desktop"]
  },
  {
    "name": "members_only",
    "label": "Members only",
    "type": "boolean",
    "default": false,
    "help_text": "When true, this section is only rendered for logged-in active members."
  }
]
```

### Naming conventions

- Module folders: `kebab-case.module/` under `theme/modules/`
- Field names: `snake_case`
- Field labels: Title Case, sentence case help text
- Choice values: `lower_snake_case`

### React-island modules

Modules backed by React mount a `<div data-wa-module="<name>" data-props="<json>"></div>` and the bundle in `theme/assets/js/<name>.js` reads `data-props` on mount. Editor-configured fields are JSON-serialised into `data-props` by HubL.

---

## 1. Theme & Layout Modules

### 1.1 `header` (global)

**Purpose:** Site header with logo, primary nav, utility nav, member login state.

**Fields:**

```json
[
  { "name": "logo", "label": "Logo", "type": "image", "required": true, "default": { "src": "{{ get_asset_url('../images/logo.svg') }}", "alt": "Weld Australia" } },
  { "name": "logo_alt_dark", "label": "Logo (dark variant)", "type": "image", "help_text": "Used on dark backgrounds." },
  { "name": "primary_nav", "label": "Primary navigation menu", "type": "menu", "default": { "name": "Primary nav" } },
  { "name": "utility_nav", "label": "Utility navigation menu", "type": "menu", "default": { "name": "Utility nav" } },
  { "name": "phone_number", "label": "Phone number (utility bar)", "type": "text", "default": "" },
  { "name": "email", "label": "Email (utility bar)", "type": "text", "default": "office@weldaustralia.com.au" },
  { "name": "login_label_logged_out", "label": "Login button label", "type": "text", "default": "Member Login" },
  { "name": "login_label_logged_in", "label": "Logged-in label", "type": "text", "default": "My Dashboard" },
  { "name": "show_search", "label": "Show search icon", "type": "boolean", "default": true }
]
```

### 1.2 `footer` (global)

**Fields:**

```json
[
  { "name": "footer_logo", "label": "Footer logo", "type": "image" },
  { "name": "tagline", "label": "Tagline", "type": "text", "default": "The voice of the welding industry in Australia." },
  { "name": "columns", "label": "Footer columns", "type": "group", "occurrence": { "min": 1, "max": 4, "default": 4 }, "children": [
    { "name": "column_heading", "label": "Column heading", "type": "text" },
    { "name": "column_menu", "label": "Column menu", "type": "menu" }
  ]},
  { "name": "newsletter_form_id", "label": "Newsletter form (HubSpot Form ID)", "type": "text" },
  { "name": "social_links", "label": "Social links", "type": "group", "occurrence": { "min": 0, "max": 8 }, "children": [
    { "name": "platform", "label": "Platform", "type": "choice", "choices": [["linkedin","LinkedIn"],["youtube","YouTube"],["facebook","Facebook"],["x","X"],["instagram","Instagram"]] },
    { "name": "url", "label": "URL", "type": "url" }
  ]},
  { "name": "copyright_text", "label": "Copyright text", "type": "text", "default": "© Weld Australia. ABN 69 003 696 526." },
  { "name": "acknowledgement", "label": "Acknowledgement of Country", "type": "richtext" },
  { "name": "legal_menu", "label": "Legal menu (Privacy, Terms)", "type": "menu" }
]
```

---

## 2. Content Modules (used across pages)

### 2.1 `hero`

The single consolidated hero. It absorbed `hero-compact` and `page-header`, and
then the four landing-page heroes (`courses-landing-hero`, `events-landing-hero`,
`resources-landing-hero`, `job-board-hero`) - all six modules are deleted. Use
this on every page that needs a title band; reach for `hero-video` or
`hero-with-search` only when you need those specific behaviours.

`background_image` is the **right-hand media column**, never a full-bleed
background - that is why there is no overlay-opacity field.

```json
[
  { "name": "section_id", "label": "Section anchor ID (optional)", "type": "text", "default": "" },
  { "name": "background", "label": "Background style", "type": "choice", "choices": [["primary","Primary navy (default)"],["primary_dark","Primary dark"],["surface","Surface (light)"],["surface_alt","Alt surface (subtle grey)"],["transparent","Transparent"]], "default": "primary" },
  { "name": "spacing", "label": "Vertical spacing", "type": "choice", "choices": [["compact","Compact (32px)"],["default","Default (64px)"],["spacious","Spacious (96px)"]], "default": "default" },
  { "name": "visibility", "label": "Show on devices", "type": "choice", "display": "checkbox", "multiple": true, "choices": [["mobile","Mobile"],["tablet","Tablet"],["desktop","Desktop"]], "default": ["mobile","tablet","desktop"] },
  { "name": "members_only", "label": "Members only", "type": "boolean", "default": false },

  { "name": "show_breadcrumb", "label": "Show breadcrumb", "type": "boolean", "default": false },
  { "name": "breadcrumb_parent_label", "label": "Breadcrumb parent label", "type": "text", "default": "" },
  { "name": "breadcrumb_parent_link", "label": "Breadcrumb parent link", "type": "link" },
  { "name": "breadcrumb_current_label", "label": "Breadcrumb current page label", "type": "text", "default": "" },

  { "name": "eyebrow", "label": "Eyebrow / overline", "type": "text", "default": "" },
  { "name": "headline", "label": "Headline", "type": "text", "required": true, "default": "" },
  { "name": "subheadline", "label": "Sub-headline", "type": "richtext" },

  { "name": "media_type", "label": "Right-side media", "type": "choice", "choices": [["image","Image"],["video","Video embed"],["none","Text only (no media)"]], "default": "none" },
  { "name": "background_image", "label": "Image", "type": "image" },
  { "name": "video_embed_url", "label": "Video embed URL (optional)", "type": "text", "default": "" },
  { "name": "video_poster", "label": "Video poster image (optional)", "type": "image" },

  { "name": "alignment", "label": "Text alignment", "type": "choice", "choices": [["left","Left"],["center","Center"]], "default": "left" },
  { "name": "primary_cta", "label": "Primary CTA", "type": "group", "children": [
    { "name": "label_text", "label": "Label", "type": "text" },
    { "name": "link", "label": "Link", "type": "link" },
    { "name": "style", "label": "Style", "type": "choice", "choices": [["gold","Gold (recommended on dark)"],["white-outline","White outline"],["primary","Navy filled"],["navy-outline","Navy outline"],["accent","Accent (gold alias)"]], "default": "gold" }
  ]},
  { "name": "secondary_cta", "label": "Secondary CTA", "type": "group", "children": [
    { "name": "label_text", "label": "Label", "type": "text" },
    { "name": "link", "label": "Link", "type": "link" },
    { "name": "style", "label": "Style", "type": "choice", "choices": [["white-outline","White outline (recommended on dark)"],["gold","Gold"],["navy-outline","Navy outline"],["outline","Standard outline"]], "default": "white-outline" }
  ]},

  { "name": "show_stats", "label": "Show stat tiles", "type": "boolean", "default": false },
  { "name": "stats_placement", "label": "Stat tile placement", "type": "choice", "choices": [["below","Below the copy (full width row)"],["side","Right-hand column (cards)"]], "default": "below" },
  { "name": "stats", "label": "Stat tiles", "type": "group", "occurrence": { "min": 0, "max": 6, "default": 4 }, "children": [
    { "name": "value", "label": "Value", "type": "text", "default": "" },
    { "name": "stat_label", "label": "Label", "type": "text", "default": "" },
    { "name": "dynamic_value", "label": "Live count (optional)", "type": "choice", "choices": [["none","None - use the value above"],["open_roles_count","Jobs listed"],["states_count","States represented"],["employers_count","Employers hiring"],["categories_count","Job categories"],["remote_count","Remote / FIFO roles"],["featured_count","Featured roles"]], "default": "none" }
  ]},

  { "name": "height", "label": "Hero height", "type": "choice", "choices": [["banner","Banner (160px min)"],["compact","Compact (280px min)"],["medium","Medium (420px min)"],["large","Large (560px min)"],["tall","Tall (640px min)"],["full","Full viewport"]], "default": "medium" },
  { "name": "accent_bar", "label": "Show brand accent bar", "type": "boolean", "default": true }
]
```

**Notes on the stats block.** `stats_placement: "side"` puts the tiles in the
right-hand media column as bordered cards; it silently falls back to `"below"`
when `media_type` is `image` or `video`, because the column can only hold one
thing. `dynamic_value` reads live figures from the jobs HubDB table (Job Board
hero) - the HubDB query only runs when at least one tile asks for a count, so
every other hero on the site pays nothing for it.

### 2.2 `hero-compact` - retired

Deleted. Folded into § 2.1 - use `hero` with `height="compact"`. The same applies
to `page-header`, `courses-landing-hero`, `events-landing-hero`,
`resources-landing-hero` and `job-board-hero`. Numbering below is kept as-is so
the § references in `docs/03-prompts.md` still resolve.

### 2.3 `hero-with-search`

Hero plus a search input wired to a target page (Resources Hub, Find a Member, etc.).

```json
[
  { "name": "headline", "label": "Headline", "type": "text", "required": true },
  { "name": "subheadline", "label": "Sub-headline", "type": "richtext" },
  { "name": "search_placeholder", "label": "Search placeholder", "type": "text", "default": "Search resources..." },
  { "name": "search_target", "label": "Search target", "type": "choice", "choices": [["resource_library","Resource Library"],["find_a_member","Find a Member"],["course_timetable","Course Timetable"]], "required": true },
  { "name": "background_image", "label": "Background image", "type": "image" }
]
```

### 2.4 `hero-video`

Hero with embedded video (YouTube/Vimeo/HubSpot Video).

```json
[
  { "name": "headline", "label": "Headline", "type": "text", "required": true },
  { "name": "subheadline", "label": "Sub-headline", "type": "richtext" },
  { "name": "video_source", "label": "Video source", "type": "choice", "choices": [["hubspot","HubSpot Video"],["youtube","YouTube"],["vimeo","Vimeo"]], "default": "youtube" },
  { "name": "video_id_or_url", "label": "Video ID or URL", "type": "text" },
  { "name": "poster_image", "label": "Poster image", "type": "image" },
  { "name": "trust_badges", "label": "Trust badges", "type": "group", "occurrence": { "min": 0, "max": 6 }, "children": [
    { "name": "badge_image", "label": "Badge image", "type": "image" },
    { "name": "badge_label", "label": "Badge label", "type": "text" }
  ]},
  { "name": "primary_cta", "label": "Primary CTA", "type": "group", "children": [
    { "name": "label", "label": "Label", "type": "text" },
    { "name": "link", "label": "Link", "type": "link" }
  ]}
]
```

### 2.5 `value-props-3up`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "section_intro", "label": "Section intro", "type": "richtext" },
  { "name": "props", "label": "Value props", "type": "group", "occurrence": { "min": 1, "max": 4, "default": 3 }, "children": [
    { "name": "icon", "label": "Icon", "type": "image", "help_text": "SVG recommended." },
    { "name": "heading", "label": "Heading", "type": "text", "required": true },
    { "name": "body", "label": "Body", "type": "richtext" },
    { "name": "cta_label", "label": "CTA label", "type": "text" },
    { "name": "cta_link", "label": "CTA link", "type": "link" }
  ]}
]
```

### 2.6 `category-cards-3up`

Same as `value-props-3up` but each card has a hero image instead of an icon - used for training categories.

`image` is **optional**, not required. The module renders a text-only card when it is blank
(`{% if card.image and card.image.src %}`), and the Training Hub instance ships without images. Marking it
required blocks the page editor from saving with "One of your modules has incorrect information."

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "cards", "label": "Cards", "type": "group", "occurrence": { "min": 2, "max": 4, "default": 3 }, "children": [
    { "name": "image", "label": "Image", "type": "image" },
    { "name": "heading", "label": "Heading", "type": "text", "required": true },
    { "name": "body", "label": "Body", "type": "richtext" },
    { "name": "cta_label", "label": "CTA label", "type": "text", "default": "Learn more" },
    { "name": "cta_link", "label": "CTA link", "type": "link" }
  ]}
]
```

### 2.7 `tier-comparison`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Membership tiers" },
  { "name": "tiers", "label": "Tiers", "type": "group", "occurrence": { "min": 2, "max": 6, "default": 5 }, "children": [
    { "name": "tier_name", "label": "Tier name", "type": "text", "required": true },
    { "name": "tier_label_color", "label": "Tier accent colour", "type": "choice", "choices": [["gold","Gold"],["silver","Silver"],["bronze","Bronze"],["primary","Primary"],["neutral","Neutral"]], "default": "neutral" },
    { "name": "price_intro", "label": "Price intro (e.g. From)", "type": "text" },
    { "name": "price", "label": "Price (display)", "type": "text" },
    { "name": "price_period", "label": "Price period (e.g. /year)", "type": "text" },
    { "name": "summary", "label": "Summary line", "type": "text" },
    { "name": "cta_label", "label": "CTA label", "type": "text", "default": "Join now" },
    { "name": "cta_link", "label": "CTA link", "type": "link" },
    { "name": "is_featured", "label": "Featured tier", "type": "boolean", "default": false }
  ]},
  { "name": "feature_rows", "label": "Comparison rows", "type": "group", "occurrence": { "min": 1 }, "children": [
    { "name": "feature_label", "label": "Feature", "type": "text", "required": true },
    { "name": "feature_help", "label": "Help text (tooltip)", "type": "text" },
    { "name": "tier_values", "label": "Per-tier values (JSON, ✓/✗ or text)", "type": "text", "help_text": "JSON array matching tier order, e.g. [\"✓\",\"✓\",\"Limited\",\"✗\"]" }
  ]}
]
```

### 2.8 `pricing-table`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Pricing" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "show_member_discount_callout", "label": "Show member savings callout", "type": "boolean", "default": true },
  { "name": "member_savings_message", "label": "Member savings message", "type": "text", "default": "Members save {amount} on this course." },
  { "name": "tiers", "label": "Pricing tiers", "type": "group", "occurrence": { "min": 1, "max": 4, "default": 2 }, "children": [
    { "name": "tier_name", "label": "Tier name", "type": "text" },
    { "name": "price_member", "label": "Member price (display)", "type": "text" },
    { "name": "price_non_member", "label": "Non-member price (display)", "type": "text" },
    { "name": "includes", "label": "Includes (rich text bullets)", "type": "richtext" },
    { "name": "cta_label", "label": "CTA label", "type": "text" },
    { "name": "cta_link", "label": "CTA link", "type": "link" }
  ]}
]
```

### 2.9 `accordion`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "items", "label": "Items", "type": "group", "occurrence": { "min": 1 }, "children": [
    { "name": "title", "label": "Title", "type": "text", "required": true },
    { "name": "body", "label": "Body", "type": "richtext", "required": true },
    { "name": "is_open_default", "label": "Open by default", "type": "boolean", "default": false }
  ]}
]
```

### 2.10 `faq-accordion`

Specialisation of `accordion` for FAQ schema (emits FAQPage JSON-LD for SEO).

Same fields as `accordion` plus:

```json
[
  { "name": "emit_jsonld", "label": "Emit FAQ schema markup", "type": "boolean", "default": true }
]
```

### 2.11 `testimonial-slider`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "testimonials", "label": "Testimonials", "type": "group", "occurrence": { "min": 1 }, "children": [
    { "name": "quote", "label": "Quote", "type": "richtext", "required": true },
    { "name": "author_name", "label": "Author name", "type": "text" },
    { "name": "author_role", "label": "Author role / company", "type": "text" },
    { "name": "author_avatar", "label": "Author avatar", "type": "image" }
  ]},
  { "name": "autoplay", "label": "Autoplay", "type": "boolean", "default": true },
  { "name": "interval_seconds", "label": "Autoplay interval (s)", "type": "number", "default": 6 }
]
```

### 2.12 `logo-strip`

```json
[
  { "name": "section_heading", "label": "Section heading (optional)", "type": "text" },
  { "name": "source", "label": "Source", "type": "choice", "choices": [["manual","Manually configured"],["hubdb_members_gold","HubDB Find a Member - Gold tier"]], "default": "manual" },
  { "name": "logos", "label": "Logos (manual)", "type": "group", "occurrence": { "min": 0, "max": 30 }, "children": [
    { "name": "logo", "label": "Logo image", "type": "image" },
    { "name": "alt", "label": "Alt text", "type": "text" },
    { "name": "link", "label": "Link", "type": "link" }
  ], "visibility": { "controlling_field_path": "source", "operator": "EQUAL", "controlling_value_regex": "manual" }},
  { "name": "max_logos_from_hubdb", "label": "Max logos to show from HubDB", "type": "number", "default": 12, "visibility": { "controlling_field_path": "source", "operator": "EQUAL", "controlling_value_regex": "hubdb_members_gold" }}
]
```

### 2.13 `cta-banner`

```json
[
  { "name": "headline", "label": "Headline", "type": "text", "required": true },
  { "name": "body", "label": "Body", "type": "richtext" },
  { "name": "cta_label", "label": "CTA label", "type": "text", "required": true },
  { "name": "cta_link", "label": "CTA link", "type": "link", "required": true },
  { "name": "secondary_cta_label", "label": "Secondary CTA label", "type": "text" },
  { "name": "secondary_cta_link", "label": "Secondary CTA link", "type": "link" },
  { "name": "image", "label": "Image (optional)", "type": "image" },
  { "name": "image_position", "label": "Image position", "type": "choice", "choices": [["left","Left"],["right","Right"],["none","No image"]], "default": "right" }
]
```

### 2.14 `cta-banner-conditional`

`cta-banner` + visibility rules for visitor membership state.

Adds:

```json
[
  { "name": "visitor_state", "label": "Show to", "type": "choice", "choices": [["all","All visitors"],["non_members","Non-members only"],["lapsed_members","Lapsed members only"],["active_members","Active members only"]], "default": "non_members" }
]
```

### 2.15 `stat-tiles` / `stat-strip`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "stats", "label": "Stats", "type": "group", "occurrence": { "min": 2, "max": 6, "default": 4 }, "children": [
    { "name": "value", "label": "Value", "type": "text", "required": true },
    { "name": "label", "label": "Label", "type": "text", "required": true },
    { "name": "icon", "label": "Icon", "type": "image" }
  ]}
]
```

### 2.16 `timeline`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "milestones", "label": "Milestones", "type": "group", "occurrence": { "min": 1 }, "children": [
    { "name": "year", "label": "Year", "type": "text", "required": true },
    { "name": "heading", "label": "Heading", "type": "text" },
    { "name": "body", "label": "Body", "type": "richtext" },
    { "name": "image", "label": "Image", "type": "image" }
  ]}
]
```

### 2.17 `step-process`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "steps", "label": "Steps", "type": "group", "occurrence": { "min": 2, "max": 6, "default": 4 }, "children": [
    { "name": "number", "label": "Step number", "type": "number" },
    { "name": "heading", "label": "Heading", "type": "text", "required": true },
    { "name": "body", "label": "Body", "type": "richtext" },
    { "name": "icon", "label": "Icon", "type": "image" }
  ]}
]
```

### 2.18 `two-col-text-image`

```json
[
  { "name": "heading", "label": "Heading", "type": "text" },
  { "name": "body", "label": "Body", "type": "richtext", "required": true },
  { "name": "image", "label": "Image", "type": "image" },
  { "name": "image_position", "label": "Image position", "type": "choice", "choices": [["left","Left"],["right","Right"]], "default": "right" },
  { "name": "cta_label", "label": "CTA label", "type": "text" },
  { "name": "cta_link", "label": "CTA link", "type": "link" }
]
```

### 2.19 `feature-section`

Anchored, image+text feature section with CTA. Used on Technology, Engineering pages.

```json
[
  { "name": "anchor_id", "label": "Anchor ID", "type": "text", "required": true },
  { "name": "eyebrow", "label": "Eyebrow", "type": "text" },
  { "name": "heading", "label": "Heading", "type": "text", "required": true },
  { "name": "body", "label": "Body", "type": "richtext" },
  { "name": "image", "label": "Image", "type": "image" },
  { "name": "video_url", "label": "Or video URL", "type": "text" },
  { "name": "image_position", "label": "Media position", "type": "choice", "choices": [["left","Left"],["right","Right"]], "default": "right" },
  { "name": "cta_label", "label": "CTA label", "type": "text" },
  { "name": "cta_link", "label": "CTA link", "type": "link" }
]
```

### 2.20 `service-cards`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "services", "label": "Services", "type": "group", "occurrence": { "min": 2, "max": 6, "default": 4 }, "children": [
    { "name": "icon", "label": "Icon", "type": "image" },
    { "name": "heading", "label": "Heading", "type": "text", "required": true },
    { "name": "body", "label": "Body", "type": "richtext" },
    { "name": "cta_label", "label": "CTA label", "type": "text", "default": "Learn more" },
    { "name": "cta_link", "label": "CTA link", "type": "link" }
  ]}
]
```

### 2.21 `case-study-cards`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "case_studies", "label": "Case studies", "type": "group", "occurrence": { "min": 1, "max": 6, "default": 3 }, "children": [
    { "name": "image", "label": "Image", "type": "image" },
    { "name": "client_name", "label": "Client name", "type": "text" },
    { "name": "title", "label": "Title", "type": "text", "required": true },
    { "name": "summary", "label": "Summary", "type": "richtext" },
    { "name": "result_stat", "label": "Headline result", "type": "text" },
    { "name": "cta_label", "label": "CTA label", "type": "text", "default": "Read case study" },
    { "name": "cta_link", "label": "CTA link", "type": "link" }
  ]}
]
```

### 2.22 `cert-pathway-cards`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "pathways", "label": "Certification pathways", "type": "group", "occurrence": { "min": 1, "max": 6 }, "children": [
    { "name": "title", "label": "Title", "type": "text", "required": true },
    { "name": "summary", "label": "Summary", "type": "richtext" },
    { "name": "audience", "label": "Who it's for", "type": "text" },
    { "name": "duration", "label": "Typical duration", "type": "text" },
    { "name": "icon", "label": "Icon", "type": "image" },
    { "name": "cta_label", "label": "CTA label", "type": "text", "default": "Explore pathway" },
    { "name": "cta_link", "label": "CTA link", "type": "link" }
  ]}
]
```

### 2.23 `sticky-sub-nav`

```json
[
  { "name": "show_on_scroll_after_px", "label": "Stick after scroll (px)", "type": "number", "default": 200 },
  { "name": "links", "label": "Anchor links", "type": "group", "occurrence": { "min": 2, "max": 8 }, "children": [
    { "name": "label", "label": "Label", "type": "text", "required": true },
    { "name": "anchor_id", "label": "Anchor ID (no #)", "type": "text", "required": true }
  ]},
  { "name": "primary_cta_label", "label": "Primary CTA label", "type": "text" },
  { "name": "primary_cta_link", "label": "Primary CTA link", "type": "link" }
]
```

### 2.24 `subscription-form`

Granular subscription preferences - wraps a HubSpot form.

```json
[
  { "name": "form_id", "label": "HubSpot Form GUID", "type": "text", "required": true },
  { "name": "heading", "label": "Heading", "type": "text" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "subscription_options", "label": "Subscription options to surface", "type": "choicegroup", "multiple": true, "choices": [
    ["advocacy","Advocacy"],["training","Training"],["membership","Membership"],["events","Events"],["newsletter","Newsletter"]
  ], "default": ["advocacy","training","membership","events","newsletter"] }
]
```

### 2.25 `hubspot-form-embed`

Generic form embed wrapper.

```json
[
  { "name": "form_id", "label": "HubSpot Form GUID", "type": "text", "required": true },
  { "name": "heading", "label": "Heading", "type": "text" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "success_message", "label": "Success message override", "type": "richtext" },
  { "name": "redirect_url", "label": "Redirect URL on success", "type": "url" }
]
```

### 2.26 `google-map-embed`

```json
[
  { "name": "embed_url", "label": "Google Maps embed URL", "type": "text", "required": true },
  { "name": "height_px", "label": "Map height (px)", "type": "number", "default": 400 },
  { "name": "caption", "label": "Caption", "type": "text" }
]
```

### 2.27 `contact-methods-grid`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "methods", "label": "Contact methods", "type": "group", "occurrence": { "min": 1 }, "children": [
    { "name": "label", "label": "Label", "type": "text", "required": true },
    { "name": "value", "label": "Value (display)", "type": "text", "required": true },
    { "name": "link", "label": "Link (tel:/mailto:/url)", "type": "text" },
    { "name": "icon", "label": "Icon", "type": "image" }
  ]}
]
```

### 2.28 `document-list`

Renders a curated list from HubDB Table 5 (resources) filtered to a category - used on Advocacy etc.

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text" },
  { "name": "filter_category", "label": "Resource category", "type": "choice", "choices": [["advocacy","Advocacy"],["technical","Technical"],["standards","Standards"],["case_study","Case Study"],["report","Report"]], "required": true },
  { "name": "max_items", "label": "Max items", "type": "number", "default": 10 },
  { "name": "members_only_filter", "label": "Apply Member Wall gating", "type": "boolean", "default": true }
]
```

### 2.29 `news-mention-list`

Curated list of media mentions with logo, headline, link, date.

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "In the news" },
  { "name": "mentions", "label": "Mentions", "type": "group", "occurrence": { "min": 1 }, "children": [
    { "name": "publication_logo", "label": "Publication logo", "type": "image" },
    { "name": "headline", "label": "Headline", "type": "text", "required": true },
    { "name": "publication_date", "label": "Publication date", "type": "date" },
    { "name": "link", "label": "Link", "type": "url", "required": true }
  ]}
]
```

---

## 3. HubDB-Driven & React-Island Modules

### 3.0 Course categories - the training divisions

Every course-facing module groups courses into the client's four **training
divisions** rather than exposing the raw HubDB `courses.category` values:

| Division | Slug | HubDB `category` values |
|---|---|---|
| Welding Inspection | `welding-inspection` | Welding Inspection |
| Welding Supervision | `welding-supervision` | Supervision |
| Welding Coordination | `welding-coordination` | Engineering, Management |
| Short Courses | `short-courses` | Welding Processes, NDT, Robotic Welding |

The mapping lives in **`config/course-categories.json`** - the single source of
truth. `pnpm build` generates two consumers from it:

- `theme/templates/partials/course-taxonomy.html` - HubL macros (`bucket_slug`,
  `bucket_label`, `bucket_url`, `bucket_values_csv`, `slugs_csv`, `taxonomy_json`)
- `src/shared/courseTaxonomy.ts` - `bucketForCategory`, `resolveBucketFromParam`,
  `bucketLabel` for the React islands

Never edit the generated files. `src/shared/courseTaxonomy.test.ts` fails the
build if `hubdb/courses.json` gains a `category` option with no division.

**Deep-linking.** Course listings accept `?category=<division>` (or `?filter=`)
and pre-apply that filter on load - e.g.
`/courses?category=welding-coordination#all-courses`. Division slugs, display
labels, raw HubDB values and the legacy slugs (`inspector`, `supervision`,
`certification`, `appreciation`, `welding_inspection`, …) all resolve, so links
generated before this taxonomy existed keep working. An unrecognised value falls
back to the module's configured default rather than filtering everything away.

### 3.1 `featured-courses`

Pulls N rows from HubDB Table 1 (`courses`) by editor-configured filter and renders three-up cards.

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Featured courses" },
  { "name": "selection_mode", "label": "Selection mode", "type": "choice", "choices": [["manual","Manually pick"],["next_upcoming","Next upcoming sessions"],["category","Filter by category"]], "default": "next_upcoming" },
  { "name": "manual_course_ids", "label": "Course IDs (comma separated)", "type": "text", "visibility": { "controlling_field_path": "selection_mode", "operator": "EQUAL", "controlling_value_regex": "manual" }},
  { "name": "category_filter", "label": "Category", "type": "choice", "choices": [["welding-inspection","Welding Inspection"],["welding-supervision","Welding Supervision"],["welding-coordination","Welding Coordination"],["short-courses","Short Courses"]], "visibility": { "controlling_field_path": "selection_mode", "operator": "EQUAL", "controlling_value_regex": "category" }},
  { "name": "max_count", "label": "How many to show", "type": "number", "default": 3, "min": 1, "max": 8 },
  { "name": "show_member_pricing", "label": "Show member pricing", "type": "boolean", "default": true },
  { "name": "show_view_all_cta", "label": "Show 'View all courses' CTA", "type": "boolean", "default": true },
  { "name": "view_all_label", "label": "View all label", "type": "text", "default": "View all courses" },
  { "name": "view_all_link", "label": "View all link", "type": "link" }
]
```

### 3.2 `course-timetable-compact`

Like `featured-courses` but as a vertical list of next 5-10 sessions across all courses; lighter visual treatment for use in the Training Hub.

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Upcoming courses" },
  { "name": "max_count", "label": "Max sessions to show", "type": "number", "default": 8 },
  { "name": "category_filter", "label": "Filter by category (optional)", "type": "choice", "choices": [["any","All"],["welding-inspection","Welding Inspection"],["welding-supervision","Welding Supervision"],["welding-coordination","Welding Coordination"],["short-courses","Short Courses"]], "default": "any" },
  { "name": "view_all_label", "label": "View all label", "type": "text", "default": "View full timetable" },
  { "name": "view_all_link", "label": "View all link", "type": "link" }
]
```

### 3.3 `course-timetable-filter` (React island)

Full filterable timetable used at `/courses/`.

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Course timetable" },
  { "name": "default_city", "label": "Default city", "type": "choice", "choices": [["any","Any"],["sydney","Sydney"],["melbourne","Melbourne"],["brisbane","Brisbane"],["perth","Perth"],["adelaide","Adelaide"],["darwin","Darwin"],["hobart","Hobart"],["online","Online"]], "default": "any" },
  { "name": "default_category", "label": "Default category", "type": "choice", "choices": [["any","Any"],["welding-inspection","Welding Inspection"],["welding-supervision","Welding Supervision"],["welding-coordination","Welding Coordination"],["short-courses","Short Courses"]], "default": "any" },
  { "name": "show_seats_remaining", "label": "Show 'seats remaining'", "type": "boolean", "default": true },
  { "name": "eoi_form_id", "label": "EOI form ID (used when no sessions)", "type": "text", "required": true },
  { "name": "eoi_message", "label": "EOI message", "type": "richtext", "default": "We don't have a session scheduled here yet - register your interest and we'll let you know." }
]
```

### 3.4 `course-filter` (React island, used on consolidated course page)

```json
[
  { "name": "show_pricing", "label": "Show pricing inline", "type": "boolean", "default": true },
  { "name": "show_seats_remaining", "label": "Show 'seats remaining'", "type": "boolean", "default": true },
  { "name": "default_city", "label": "Default city (optional override)", "type": "choice", "choices": [["auto","First available"],["sydney","Sydney"],["melbourne","Melbourne"],["brisbane","Brisbane"],["perth","Perth"],["adelaide","Adelaide"],["darwin","Darwin"],["hobart","Hobart"],["online","Online"]], "default": "auto" },
  { "name": "register_cta_label", "label": "Register CTA label", "type": "text", "default": "Register now" },
  { "name": "eoi_form_id", "label": "EOI form ID (used when no city sessions)", "type": "text", "required": true },
  { "name": "eoi_heading", "label": "EOI heading", "type": "text", "default": "Register your interest" },
  { "name": "eoi_message", "label": "EOI message", "type": "richtext" }
]
```

### 3.5 `find-a-member` (React island)

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Find a Member" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "default_sort", "label": "Default sort", "type": "choice", "choices": [["tier","By tier (Gold first)"],["name_asc","Name A→Z"],["state","By state"]], "default": "tier" },
  { "name": "tiers_visible", "label": "Tiers to show", "type": "choicegroup", "multiple": true, "choices": [["gold","Gold"],["silver","Silver"],["bronze","Bronze"],["reciprocal","Reciprocal"],["industry_supplier","Industry Supplier"]], "default": ["gold","silver","bronze","reciprocal","industry_supplier"] },
  { "name": "page_size", "label": "Results per page", "type": "number", "default": 24 },
  { "name": "show_state_filter", "label": "Show state filter", "type": "boolean", "default": true },
  { "name": "show_search", "label": "Show search input", "type": "boolean", "default": true }
]
```

### 3.6 `resource-library` (React island)

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Resources" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "categories_visible", "label": "Categories to show", "type": "choicegroup", "multiple": true, "choices": [["technical","Technical Papers"],["standards","Standards Guidance"],["case_study","Case Studies"],["report","Reports"],["webinar","Webinars"],["template","Templates"]] },
  { "name": "default_filter_category", "label": "Default filter category", "type": "choice", "choices": [["all","All"],["technical","Technical"],["standards","Standards"],["case_study","Case Study"],["report","Report"]], "default": "all" },
  { "name": "show_file_type_filter", "label": "Show file type filter", "type": "boolean", "default": true },
  { "name": "show_member_only_filter", "label": "Show 'Member only' filter chip", "type": "boolean", "default": true },
  { "name": "page_size", "label": "Results per page", "type": "number", "default": 18 },
  { "name": "locked_overlay_message", "label": "Locked overlay message", "type": "richtext", "default": "Available to Weld Australia members. Become a member to download." },
  { "name": "locked_cta_label", "label": "Locked CTA label", "type": "text", "default": "Become a member" },
  { "name": "locked_cta_link", "label": "Locked CTA link", "type": "link" }
]
```

### 3.7 `team-grid`

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Our team" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "data_source", "label": "Data source", "type": "choice", "choices": [["hubdb","HubDB - Team & Board table"],["module_fields","This module's People list"]], "default": "hubdb" },
  { "name": "category_filter", "label": "Filter by category", "type": "choice", "choices": [["any","All"],["executive","Executive"],["board","Board"],["engineering","Engineering"],["training","Training"],["qc","Q&C"]], "default": "any" },
  { "name": "category_exclude", "label": "Exclude categories", "type": "text", "default": "" },
  { "name": "group_by_category", "label": "Group people by category", "type": "boolean", "default": true },
  { "name": "ungrouped_heading", "label": "Heading for people with no category", "type": "text", "default": "Our team" },
  { "name": "show_category_tabs", "label": "Show category tabs", "type": "boolean", "default": true },
  { "name": "max_count", "label": "Max members (0 = no limit)", "type": "number", "default": 0 },
  { "name": "profile_url_base", "label": "Profile page URL base", "type": "text", "default": "/about/team/" },
  { "name": "show_bio_modal", "label": "Open bio in modal on click", "type": "boolean", "default": true }
]
```

`category_filter` and `category_exclude` both accept a comma-separated list
(`"board,executive"`), so one table can feed several grids without retagging rows.
Exclusions apply even when `group_by_category` is on.

When `data_source = hubdb`, each card links to `profile_url_base` plus that row's
built-in HubDB **page path** - e.g. `/about/team/geoff-crittenden`. Profile pages
themselves are served by `about-team.html`.

A row with a blank page path renders as a plain, non-clickable card **and emits an
HTML comment naming the row**. That is the failure mode to know about: HubSpot only
generates a detail URL for rows that have a page path, and rows added through the
HubSpot UI or a CSV import get none. Fix with `pnpm backfill:paths --table=team_and_board`.

`group_by_category` defaults to **on**, which also makes it survive a save in the page
editor. Rows whose Category is blank are collected under `ungrouped_heading` at the end
rather than being dropped from the page.

### 3.7b `board-grid`

Same people-card pattern as `team-grid` but with an `org` sub-line and an optional
left intro + right checklist header. It reads the same `team_and_board` table.

```json
[
  { "name": "overline", "label": "Overline", "type": "text" },
  { "name": "heading", "label": "Heading", "type": "text", "default": "Our board" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "checklist", "label": "Checklist", "type": "group" },
  { "name": "columns", "label": "Columns", "type": "choice", "choices": [["2","2 columns"],["3","3 columns"],["4","4 columns"]], "default": "3" },
  { "name": "data_source", "label": "Data source", "type": "choice", "choices": [["module_fields","This module's People list"],["hubdb","HubDB - Team & Board table"]], "default": "module_fields" },
  { "name": "board_source", "label": "Who counts as board", "type": "choice", "choices": [["flag_or_category","Flag ticked OR category is Board (recommended)"],["category_only","Category is Board only"],["flag_only","'Sits on the Board' flag only"]], "default": "flag_or_category" },
  { "name": "category_filter", "label": "Filter by category", "type": "text", "default": "any" },
  { "name": "category_exclude", "label": "Exclude categories", "type": "text", "default": "" },
  { "name": "max_count", "label": "Max people (0 = no limit)", "type": "number", "default": 0 },
  { "name": "profile_url_base", "label": "Profile page URL base", "type": "text", "default": "/about/team/" },
  { "name": "people", "label": "People", "type": "group" }
]
```

`data_source` defaults to `module_fields` here so existing hand-entered board
listings keep working untouched; set it to `hubdb` to pick up profile links.

Board membership is decided in HubL, not in the HubDB query — a query-level filter
on `is_board_member` takes the whole section down if that column is missing from the
table. `board_source` defaults to **flag ticked OR category is Board**, so rows
already categorised `Board` work with no re-tagging, while ticking **Sits on the
Board** on someone in a staff category (the CEO) adds them to the board grid too.

A HubDB-driven board grid with no matching rows renders nothing at all rather than
an orphan heading, and leaves an HTML comment saying which rule matched nothing.

### 3.8 `events-listing` (React island)

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Upcoming events" },
  { "name": "default_state_filter", "label": "Default state filter", "type": "choice", "choices": [["any","All"],["nsw","NSW"],["vic","VIC"],["qld","QLD"],["wa","WA"],["sa","SA"],["tas","TAS"],["nt","NT"],["act","ACT"],["national","National"]], "default": "any" },
  { "name": "default_type_filter", "label": "Default event type", "type": "choice", "choices": [["any","All"],["webinar","Webinar"],["in_person","In-Person"],["hybrid","Hybrid"],["awards","Awards"]], "default": "any" },
  { "name": "page_size", "label": "Results per page", "type": "number", "default": 12 },
  { "name": "show_past_events_toggle", "label": "Show 'past events' toggle", "type": "boolean", "default": true }
]
```

### 3.9 `jobs-listing` (React island)

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "Job board" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "default_state_filter", "label": "Default state filter", "type": "choice", "choices": [["any","All"],["nsw","NSW"],["vic","VIC"],["qld","QLD"],["wa","WA"],["sa","SA"],["tas","TAS"],["nt","NT"],["act","ACT"]], "default": "any" },
  { "name": "default_type_filter", "label": "Default type", "type": "choice", "choices": [["any","All"],["full_time","Full-time"],["part_time","Part-time"],["contract","Contract"],["apprenticeship","Apprenticeship"]], "default": "any" },
  { "name": "page_size", "label": "Results per page", "type": "number", "default": 20 },
  { "name": "post_a_job_label", "label": "Post a job CTA label", "type": "text", "default": "Post a job (members only)" },
  { "name": "post_a_job_link", "label": "Post a job link", "type": "link" }
]
```

### 3.10 `blog-listing`

Wraps HubSpot blog listing with theming and editor controls.

```json
[
  { "name": "section_heading", "label": "Section heading", "type": "text", "default": "News & insights" },
  { "name": "blog_id", "label": "Blog ID", "type": "blog" },
  { "name": "max_count", "label": "Max posts", "type": "number", "default": 6 },
  { "name": "show_filter_chips", "label": "Show filter chips (tags)", "type": "boolean", "default": true },
  { "name": "tag_filter", "label": "Filter by tag (optional)", "type": "tag" }
]
```

---

## 4. Member Portal Modules (React, members-only)

### 4.1 `member-dashboard` (React island)

The "Command Centre" composed of toggleable tiles. Editor configures which tiles appear and their order via a repeater.

```json
[
  { "name": "welcome_message", "label": "Welcome message override", "type": "text", "default": "Welcome back, {firstname}" },
  { "name": "expiry_warning_days", "label": "Show expiry warning when within N days", "type": "number", "default": 60 },
  { "name": "tiles", "label": "Dashboard tiles (in display order)", "type": "group", "occurrence": { "min": 1, "max": 12 }, "children": [
    { "name": "tile_type", "label": "Tile type", "type": "choice", "choices": [
      ["welcome_banner","Welcome banner"],
      ["smart_alerts","Smart alerts"],
      ["membership_status","Membership status"],
      ["certifications","My certifications"],
      ["upcoming_courses","Upcoming courses"],
      ["registered_events","Registered events"],
      ["invoices","Invoices & receipts"],
      ["geo_events","Geo-localised events"],
      ["corporate_admin","Corporate admin entry"],
      ["resources_for_you","Resources for you"],
      ["custom_cta","Custom CTA"]
    ], "required": true },
    { "name": "tile_heading_override", "label": "Heading override (optional)", "type": "text" },
    { "name": "tile_visible", "label": "Visible", "type": "boolean", "default": true },
    { "name": "custom_cta_label", "label": "Custom CTA label", "type": "text", "visibility": { "controlling_field_path": "tile_type", "operator": "EQUAL", "controlling_value_regex": "custom_cta" }},
    { "name": "custom_cta_link", "label": "Custom CTA link", "type": "link", "visibility": { "controlling_field_path": "tile_type", "operator": "EQUAL", "controlling_value_regex": "custom_cta" }}
  ]},
  { "name": "renewal_link", "label": "Renew membership link", "type": "link" },
  { "name": "support_email", "label": "Support email", "type": "text", "default": "office@weldaustralia.com.au" }
]
```

### 4.2 `profile-form`

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "My profile" },
  { "name": "editable_fields", "label": "Editable fields", "type": "choicegroup", "multiple": true, "choices": [
    ["firstname","First name"],["lastname","Last name"],["email","Email"],["phone","Phone"],["mobile","Mobile"],["address","Postal address"],["employer","Employer"],["job_title","Job title"]
  ], "default": ["firstname","lastname","phone","mobile","address","employer","job_title"] },
  { "name": "show_password_change_link", "label": "Show password change link", "type": "boolean", "default": true },
  { "name": "save_success_message", "label": "Success message", "type": "text", "default": "Profile updated." }
]
```

### 4.3 `subscription-preferences`

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "Communications preferences" },
  { "name": "intro", "label": "Intro", "type": "richtext" },
  { "name": "subscription_options", "label": "Subscriptions to surface", "type": "choicegroup", "multiple": true, "choices": [
    ["advocacy","Advocacy updates"],["training","Training & courses"],["membership","Membership news"],["events","Events"],["newsletter","Monthly newsletter"]
  ], "default": ["advocacy","training","membership","events","newsletter"] },
  { "name": "show_unsubscribe_all", "label": "Show 'unsubscribe from all'", "type": "boolean", "default": true }
]
```

### 4.4 `linked-associations`

Read-only list of company associations on the contact.

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "Linked organisations" },
  { "name": "request_change_label", "label": "Request change label", "type": "text", "default": "Request a change" },
  { "name": "request_change_link", "label": "Request change link", "type": "link", "help_text": "Typically a contact form or mailto:" }
]
```

### 4.5 `certifications-list`

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "My certifications" },
  { "name": "show_lapsed", "label": "Show lapsed/expired certs", "type": "boolean", "default": true },
  { "name": "empty_state_message", "label": "Empty state message", "type": "richtext", "default": "You don't have any certifications yet. Explore our pathways to get started." },
  { "name": "empty_state_cta_label", "label": "Empty state CTA", "type": "text" },
  { "name": "empty_state_cta_link", "label": "Empty state CTA link", "type": "link" }
]
```

### 4.6 `certification-guidance` (React island)

```json
[
  { "name": "heading_template", "label": "Heading template", "type": "text", "default": "Your {certification_type} progress" },
  { "name": "show_evidence_upload", "label": "Show evidence upload form", "type": "boolean", "default": true },
  { "name": "evidence_form_id", "label": "Evidence upload form GUID", "type": "text" },
  { "name": "qc_contact_email", "label": "Q&C contact email", "type": "text", "default": "qnc@weldaustralia.com.au" },
  { "name": "qc_contact_phone", "label": "Q&C contact phone", "type": "text" }
]
```

### 4.7 `corporate-admin` (React island)

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "Manage my team" },
  { "name": "show_voucher_tracker", "label": "Show voucher tracker", "type": "boolean", "default": true },
  { "name": "show_company_hierarchy", "label": "Show company hierarchy tree", "type": "boolean", "default": true },
  { "name": "allow_add_employee", "label": "Allow admin to add employees", "type": "boolean", "default": true },
  { "name": "allow_remove_employee", "label": "Allow admin to remove employees", "type": "boolean", "default": true },
  { "name": "allow_bulk_register", "label": "Allow bulk course registration", "type": "boolean", "default": true },
  { "name": "add_employee_form_id", "label": "Add employee form GUID", "type": "text" },
  { "name": "support_contact_email", "label": "Support contact (for issues)", "type": "text", "default": "membership@weldaustralia.com.au" }
]
```

### 4.8 `checkout-tunnel` (React island)

```json
[
  { "name": "step_labels", "label": "Step labels", "type": "group", "children": [
    { "name": "step_1", "label": "Step 1 label", "type": "text", "default": "Confirm session" },
    { "name": "step_2", "label": "Step 2 label", "type": "text", "default": "Your details" },
    { "name": "step_3", "label": "Step 3 label", "type": "text", "default": "Pricing" },
    { "name": "step_4", "label": "Step 4 label", "type": "text", "default": "Payment" }
  ]},
  { "name": "guest_checkout_allowed", "label": "Allow guest checkout", "type": "boolean", "default": true },
  { "name": "membership_offer_post_purchase", "label": "Offer membership signup post-purchase (guest)", "type": "boolean", "default": true },
  { "name": "membership_offer_message", "label": "Membership offer message", "type": "richtext" },
  { "name": "payment_provider", "label": "Payment provider", "type": "choice", "choices": [["hapily","event.hapily handoff"],["stripe","Stripe"],["redirect","External redirect"]], "default": "hapily" },
  { "name": "stripe_publishable_key", "label": "Stripe publishable key", "type": "text", "visibility": { "controlling_field_path": "payment_provider", "operator": "EQUAL", "controlling_value_regex": "stripe" }},
  { "name": "confirmation_redirect", "label": "Confirmation page", "type": "link", "default": { "url": { "type": "CONTENT", "href": "/checkout/confirmation/" }}},
  { "name": "support_email", "label": "Support email", "type": "text", "default": "training@weldaustralia.com.au" }
]
```

### 4.9 `checkout-confirmation`

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "You're registered" },
  { "name": "body", "label": "Body", "type": "richtext", "default": "We've sent a confirmation email to your inbox." },
  { "name": "show_calendar_buttons", "label": "Show calendar download buttons", "type": "boolean", "default": true },
  { "name": "show_zoom_link", "label": "Show Zoom join link if applicable", "type": "boolean", "default": true },
  { "name": "next_step_cta_label", "label": "Next step CTA label", "type": "text", "default": "Back to dashboard" },
  { "name": "next_step_cta_link", "label": "Next step CTA link", "type": "link", "default": { "url": { "type": "CONTENT", "href": "/portal/" }}}
]
```

### 4.10 `auth-split-layout`

Layout wrapper for Login/Reset pages - branding panel + form panel.

```json
[
  { "name": "brand_panel_heading", "label": "Brand panel heading", "type": "text", "default": "Weld Australia member portal" },
  { "name": "brand_panel_body", "label": "Brand panel body", "type": "richtext", "default": "Sign in to manage your membership, training and certifications." },
  { "name": "brand_panel_image", "label": "Brand panel image", "type": "image" },
  { "name": "secondary_link_label", "label": "Secondary link label", "type": "text", "default": "Become a member" },
  { "name": "secondary_link", "label": "Secondary link", "type": "link" },
  { "name": "footer_microcopy", "label": "Footer microcopy", "type": "richtext", "default": "This is your Weld Australia member portal login. WeldQ, Moodle and ISO 3834 logins remain separate for now." }
]
```

### 4.11 `hubspot-membership-login`

Form wrapper around HubSpot's standard membership login.

```json
[
  { "name": "heading", "label": "Heading", "type": "text", "default": "Member login" },
  { "name": "email_label", "label": "Email field label", "type": "text", "default": "Email" },
  { "name": "password_label", "label": "Password field label", "type": "text", "default": "Password" },
  { "name": "submit_label", "label": "Submit label", "type": "text", "default": "Sign in" },
  { "name": "forgot_password_label", "label": "Forgot password label", "type": "text", "default": "Forgot password?" },
  { "name": "forgot_password_link", "label": "Forgot password link", "type": "link", "default": { "url": { "type": "CONTENT", "href": "/login/reset/" }}},
  { "name": "post_login_redirect", "label": "Post-login redirect", "type": "link", "default": { "url": { "type": "CONTENT", "href": "/portal/" }}}
]
```

### 4.12 `hubspot-membership-reset`

Same shape as `hubspot-membership-login` but for the reset flow (request + success states).

---

## 5. Module-to-Page Matrix (cross-reference)

This matrix lets you sanity-check a page is wired to the right modules. Generated from § 3 of `docs/01-sitemap.md`.

| Page | Modules used |
|---|---|
| Home | hero, logo-strip, value-props-3up, featured-courses, document-list (resources teaser), cta-banner, blog-listing, testimonial-slider |
| About | hero, two-col-text-image, timeline, stat-tiles, team-grid, cta-banner |
| Contact | hero, contact-methods-grid, hubspot-form-embed, google-map-embed |
| Resources Hub | hero, resource-library, cta-banner-conditional |
| Membership | hero, value-props-3up, tier-comparison, step-process, testimonial-slider, faq-accordion, cta-banner |
| Training Hub | hero, category-cards-3up (4 training divisions), icon-grid, split-feature (trainers), featured-courses, split-feature (in-house), course-pathways, cta-banner (renders through `dnd_area "training_hub_v2"` - re-keyed off the old `main_content` name, which may still carry a pre-consolidation snapshot; once the page is saved in the editor its module instances live in HubSpot, so template edits only affect newly created pages) |
| Course Timetable (/courses) | hero, courses-proof-cards, card-grid (view by category), featured-courses, courses-upcoming-sessions, courses-membership-cards (listing branch renders through `dnd_area "courses_listing_v2"` - once the page is saved in the editor its module instances live in HubSpot, so template edits only affect newly created pages) |
| Course (standard) | hero, two-col-text-image, accordion, course-filter, pricing-table, team-grid, testimonial-slider, logo-strip, faq-accordion, featured-courses, cta-banner |
| Course (sales) | sticky-sub-nav, hero-video, stat-strip, two-col-text-image, accordion, persona-cards (= category-cards-3up variant), team-grid, pricing-table, course-filter, testimonial-slider, logo-strip, faq-accordion, cta-banner |
| Certification | hero, value-props-3up, cert-pathway-cards, step-process, cta-banner, faq-accordion |
| Advocacy | hero, accordion, document-list, news-mention-list, subscription-form |
| Engineering | hero, service-cards, logo-strip, case-study-cards, hubspot-form-embed |
| Technology | hero, feature-section (×3), cta-banner, hubspot-form-embed |
| Find a Member | hero-with-search, find-a-member, cta-banner |
| Events | hero, events-listing, subscription-form |
| Jobs | hero, jobs-listing, cta-banner-conditional |
| Job Board (/job-board) | hero (stats_placement="side", live HubDB counts), job-board-open-positions, job-board-cta |
| Login | auth-split-layout, hubspot-membership-login |
| Reset | auth-split-layout, hubspot-membership-reset |
| Dashboard | member-dashboard |
| Profile | profile-form, subscription-preferences, linked-associations |
| Certifications list | certifications-list |
| Certification detail | certification-guidance |
| My courses / events | tab-switcher, course-card-list, event-card-list (small members-only specialisations of `featured-courses`/`events-listing`) |
| My invoices | invoice-list |
| Manage my team | corporate-admin |
| Checkout | checkout-tunnel |
| Confirmation | checkout-confirmation |

---

- end of module catalog -