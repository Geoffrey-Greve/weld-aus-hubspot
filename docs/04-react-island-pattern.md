# React island pattern

How to author an interactive module. The API surface you build against is
[14-shared-library.md](./14-shared-library.md); the build mechanics are
[12-build-pipeline.md](./12-build-pipeline.md).

> Rewritten 2026-09 against the current build. Earlier revisions of this
> document described content-hashed bundle filenames and a 50 KB budget. Both
> changed: filenames are stable and the budget is 80 KB gzip per entry.

---

## 1. The pattern

HubSpot Professional has no native React module type (JS Building Blocks is
Enterprise-only), so each interactive surface is an *island*:

1. **HubL renders the props.** The module template resolves everything the
   component needs (HubDB rows, editor field values, the visitor's membership
   tier) and serialises it into `data-props` on a plain `<div>` carrying
   `data-wa-module="<name>"`.
2. **A `<script type="module">` loads the island's bundle.** `pnpm build` writes
   that tag; you never hand-write it.
3. **`mountReactIsland` hydrates it.** It finds the host, parses the props,
   mounts with `createRoot`, and keeps the island alive through the HubSpot page
   editor's DOM mutations.

Only `<div>` and `<script>` are involved, which is why it works on Pro.

The corollary is that **the first render is already complete**: rows arrive with
the HTML, so there is no loading spinner on page load and no client round trip
for the initial view. Client fetches are for actions, not for first paint.

---

## 2. Authoring an island

### Step 1 - the entry point

```
src/modules/<name>/
  index.tsx        mounts the component (this file is the Vite entry)
  <Name>.tsx       the component
  <Name>.css       the component's styles
  <Name>.test.tsx  Vitest coverage
```

`index.tsx` stays thin:

```tsx
import mountReactIsland from '@shared/mount'
import MyModule from './MyModule'
import './MyModule.css'

mountReactIsland('my-module', MyModule)
```

The component owns its props type. Name the props exactly as HubL emits them
(snake_case is fine and is what most modules use) so there is no translation
layer to get wrong:

```tsx
export interface MyModuleProps {
  rows?: SessionRow[]
  member_is_member?: boolean
  member_tier?: string
  register_cta_label?: string
}
```

Everything is optional or defaulted. A missing key must not throw: an editor
saving a page mid-edit will hand you a partial blob.

### Step 2 - the HubL module

```
theme/modules/<name>.module/
  fields.json  meta.json  module.html  module.css
```

Conventions and the `fields.json` rules the validator enforces are in
[13-templates-and-modules.md](./13-templates-and-modules.md).

### Step 3 - `module.html`

```html
{% set island_props = {
  'rows':               ns.rows,
  'member_is_member':   _visitor_is_member ? true : false,
  'member_tier':        _visitor_member_tier,
  'register_cta_label': module.register_cta_label,
  'portal_id':          hub_id | string
} %}

<section class="wa-section wa-section--{{ module.background }} wa-section--{{ module.spacing }}"
         {% if module.section_id %}id="{{ module.section_id }}"{% endif %}>
  <div class="container">
    <div
      data-wa-module="my-module"
      data-props="{{ island_props | tojson | escape }}"
    ></div>
  </div>
</section>

{# @bundle: my-module #}
```

Four things to get right:

- **`| tojson | escape`.** `tojson` serialises the dict, `escape` makes it safe
  in an attribute. Miss `escape` and any apostrophe in the content breaks the
  parse; `mount.ts` logs it and renders nothing.
- **`{# @bundle: my-module #}`** is a placeholder the build replaces with the
  real `<link>` and `<script>` tags. On every later build it rewrites the tags
  in place. Never hand-edit that line.
- **`hub_id`** is the HubL global for the portal ID. Islands that call the Forms
  API or the Worker need it.
- **Resolve entitlement and price in HubL**, not in the component. See
  [16-membership-and-pricing.md](./16-membership-and-pricing.md).

For a payload too large or too awkward for an attribute, use a child script tag
instead. `mount.ts` supports both:

```html
<div data-wa-module="my-module">
  <script type="application/json" data-props-json>{{ island_props | tojson }}</script>
</div>
```

### Step 4 - register it with the build

Add the module name to `HUBSPOT_STANDALONE_MODULES` in `scripts/build.ts`.

Without this, no standalone bundle is built, the `@bundle` placeholder is never
replaced, and the island silently never mounts. This is the step people forget.

If a **template** (not a `*.module`) loads the bundle by URL, add it to
`STANDALONE_TEMPLATE_HOSTS` too. That is how `course-router.html` and
`course-timetable-hub.html` both load the `course-filter` bundle.

### Step 5 - build, test, ship

```bash
pnpm build         # writes <name>.standalone.js and patches module.html
pnpm test:unit
pnpm validate
```

Then upload and check it on the portal. HubL only runs there.

---

## 3. What HubL gives you, and its sharp edges

| Need | HubL |
|---|---|
| HubDB rows | `hubdb_table_rows('courses', 'course_id__eq=' ~ id ~ '&orderBy=start_date')` |
| A select column's value | `row.city.name` (falling back to `.label`, then the raw value) |
| A date as a string | `row.start_date | datetimeformat('%Y-%m-%d')` |
| A number | `row.price_member | float | default(0)` |
| A boolean | `row.use_event_engine ? true : false` |
| Building an array in a loop | `{% set ns = namespace(rows=[]) %}` then `{% set ns.rows = ns.rows + [row_data] %}` |
| The portal ID | `hub_id | string` |
| The logged-in contact | `request_contact.*`, then `contact.*`, then `crm_object(...)` |

The `namespace()` idiom is not optional: Jinja2 loop scoping means a plain
`{% set %}` inside a `for` does not escape the loop.

`datetimeformat` before serialising, always. A raw HubDB date lands in JSON as a
millisecond timestamp, and half your date handling then differs from the other
half.

---

## 4. Local development

```bash
pnpm dev     # Vite on :5173
```

Two things to open:

- `http://localhost:5173/test-island.html` - the `hello-world` island, the
  smallest possible check that mounting works. The file lives in `public/`,
  which Vite serves at the root.
- `http://localhost:5173/a11y/<name>.html` - the accessibility fixtures in
  `a11y/`, which double as development harnesses. Each hard-codes a realistic
  `data-props` blob.

HMR covers `src/modules/` and `src/shared/`.

**HubDB is not reachable from localhost**, and neither is the CRM. Work from
fixture props rather than mocking a fetch. When behaviour differs between local
and the portal, the cause is nearly always that the fixture props do not match
what HubL actually serialises: copy the real `data-props` off the portal page
into the fixture.

**Member context in a fixture** must match the real injected shape, or you are
testing something that cannot happen:

```html
<script>
window.__WELD_MEMBER__ = {
  contact: {
    id: 'dev-001', firstName: 'Dev', lastName: 'User', email: 'dev@example.com',
    membershipTier: 'corporate_gold', membershipStatus: 'active',
    membershipExpiry: '2027-06-30',
    nextCourse: { name: null, date: null, location: null }
  },
  associations: [{ companyId: 'co-001', companyName: 'Dev Company',
                   roleLabel: 'Primary Admin', tier: 'corporate_gold' }],
  activeContext: 'personal',
  certifications: [],
  entitlements: { canDownloadResources: true, isPrimaryAdmin: true }
}
</script>
```

The authority on that shape is `WeldMemberContext` in
`src/shared/api/memberContext.ts` and the injection block in
`theme/templates/layouts/portal.html`.

---

## 5. Bundle size

**Budget: 80 KB gzipped per entry chunk**, enforced by
`scripts/check-bundle-size.ts` as part of `pnpm build`.

Each island ships as one self-contained bundle carrying its own React copy,
rather than sharing a vendor chunk on the portal, because a missing shared chunk
during a deploy window would break every island at once.

Keeping under budget:

- Import from `@shared` and let tree-shaking do its work. Do not import a
  barrel for one helper if the barrel drags in a component tree.
- Use `@shared/utils` rather than adding a date or lodash-style dependency.
- Check the report: `pnpm check:bundle` after a build, or read
  `theme/assets/js/manifest.json`.

---

## 6. Mount lifecycle

`src/shared/mount.ts`, in full detail in
[14-shared-library.md](./14-shared-library.md) § 1. The behaviours you will care
about:

- Props parse failures are logged with the raw value and that one host is
  skipped, not the page.
- A `MutationObserver` watches `childList`, `subtree` and the `data-props`
  attribute. Removed hosts unmount. Added hosts mount. Changed props re-render.
- A host the HubSpot editor emptied is re-rendered rather than left blank.

That last one is why islands survive the page editor at all. If you write your
own mounting logic, you lose it.

---

## 7. Checklist

- [ ] `src/modules/<name>/index.tsx` calls `mountReactIsland('<name>', …)`
- [ ] Props type has no required fields
- [ ] Empty, loading and error states exist, including the "no rows" branch
- [ ] `theme/modules/<name>.module/` has all four files
- [ ] `module.html` emits `data-wa-module` + `data-props="… | tojson | escape"`
- [ ] `module.html` contains `{# @bundle: <name> #}` on a new module
- [ ] Name added to `HUBSPOT_STANDALONE_MODULES` in `scripts/build.ts`
- [ ] Entitlement and pricing resolved in HubL via the shared partials
- [ ] Classes prefixed `wa-`, 44x44 touch targets, cards below 768px
- [ ] A Vitest spec, and an `a11y/` fixture if it has interactive UI
- [ ] `pnpm validate && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Catalogued in [02-module-catalog.md](./02-module-catalog.md)
