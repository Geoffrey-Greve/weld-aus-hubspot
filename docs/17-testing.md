# Testing

Two suites and a third, less obvious category. All three run in CI on every PR.

```bash
pnpm test          # vitest run, then playwright
pnpm test:unit     # Vitest only
pnpm test:watch    # Vitest watch
pnpm test:a11y     # Playwright only
pnpm test:a11y:ui  # Playwright UI mode
```

First time on a machine, or after a Playwright upgrade:

```bash
pnpm exec playwright install --with-deps chromium
```

---

## 1. Unit and component tests (Vitest)

Config: `vitest.config.ts`. jsdom, globals on, `@testing-library/jest-dom` via
`src/test/setup.ts`. Aliases mirror Vite. `tests/a11y/**` is excluded so
Playwright specs are never picked up by Vitest.

Colocated with what they test:

| Area | Files |
|---|---|
| Island behaviour | `CourseFilter`, `CourseTimetableFilter`, `FindAMember`, `ResourceLibrary`, `CheckoutTunnel`, `CorporateAdmin`, `EventsListing`, `GeoLocalisedEvents` |
| Pricing | `memberPricing.test.ts`, `memberPricingParity.test.ts`, `memberCommandCentrePricing.test.ts`, `membershipActions.test.ts` |
| API clients | `eventEngine.test.ts`, `members.test.ts`, `corporateApi.test.ts` |
| Utilities | `cityOptions.test.ts`, `contrast.test.ts`, `courseTaxonomy.test.ts` |
| Script logic | `src/test/course-seo.test.ts`, `course-state.test.ts`, `hubdb-slugify.test.ts` |

Two of these are load-bearing beyond their own module:

- **`memberPricingParity.test.ts`** asserts the HubL macros in
  `_member-pricing.html` and `_member-tier.html` agree with
  `memberPricing.ts`, including the sentinel list. Change one side only and the
  build fails.
- **`courseTaxonomy.test.ts`** fails if a `category` option in
  `hubdb/courses.json` has no division in `config/course-categories.json`, so a
  new course category cannot silently fall out of the four training divisions.

The script tests exist because their output is permanent:
`hubdb-slugify.test.ts` guards strings that become public URLs,
`course-seo.test.ts` guards page titles and social cards, and
`course-state.test.ts` guards a mapping whose errors hide sessions from the
members they are meant for.

---

## 2. Source-level regression guards

A category worth knowing about, because it is unusual: several Vitest suites
read the **theme source** off disk and assert on it, with no browser involved.
They catch a regression the moment someone reintroduces it in HubL or CSS,
rather than at QA.

| Suite | Guards |
|---|---|
| `src/test/wcag-source-regressions.test.ts` | The 2026-07-15 WCAG remediation stays fixed: accessible token names are still referenced where they must be |
| `src/test/wcag-contrast.test.ts` | Parses hex values out of `tokens.css` and component CSS and asserts real ratios: 4.5:1 normal text, 3:1 large text and UI graphics |
| `src/test/compare-table-collapse.test.ts` | The `/membership` compare-tier disclosure. It rendered a chevron that hid nothing because the template built row keys with `loop.parent.index`, which HubL does not support and renders as an empty string (QA 60) |
| `src/test/subscribe-forms.test.ts` | The footer newsletter and Weld Connect blocks. Both shipped a static `GET /subscribe` form, then were "fixed" with a hidden Forms v2 embed alongside it, leaving the broken visible form in place. Twice, independently |
| `tests/unit/contact-form-deeplinks.test.ts`, `membership-join-free-tier.test.ts`, `membership-options-anchors.test.ts` | Template-level link and anchor contracts |

If you fix a HubL defect that has no runtime surface a browser can assert,
consider adding one of these. The pattern is: `readFileSync` the template, then
assert on the construct that was wrong.

---

## 3. Accessibility tests (Playwright + axe)

Config: `playwright.config.ts`. `testDir: tests/a11y`, base URL
`http://localhost:5173`, and `webServer` starts `pnpm dev` itself, so you do not
need a server running.

Two projects, and the split is deliberate:

| Project | Viewport | Runs |
|---|---|---|
| `chromium` | Desktop Chrome | Everything except `overflow.spec.ts` |
| `mobile-chrome` | Desktop Chrome at 375x812 | `overflow.spec.ts` only |

`mobile-chrome` uses Desktop Chrome at a phone width rather than a mobile device
descriptor **on purpose**: device descriptors enable overlay scrollbars, which
mask exactly the 100vw-versus-content-width bug the suite exists to catch. A
classic scrollbar keeps `documentElement.clientWidth` an honest content width.

### Specs

| Spec | Asserts |
|---|---|
| `components.spec.ts` | Per-island axe run against `wcag2a`, `wcag2aa`, `wcag21aa`. Serious or critical is a failure. Third-party hapily and HubSpot iframes are excluded |
| `pages.spec.ts` | Page-level structure: landmarks, skip link, heading hierarchy, page-level axe |
| `interactions.spec.ts` | Modal focus trap (Tab and Shift+Tab cycle), skip-to-content, keyboard-accessible filter chips and sort buttons, mobile nav focus trap, 44x44 touch-target sweep, tier badge contrast from computed styles |
| `header-nav.spec.ts` | Geometry, not axe: the desktop nav must never collide with the actions group. Measured at 1024, 1120, 1140 and 1180px. The desktop breakpoint is 1140px because the seven-item menu in Poppins needs 670px and only gets 574px at 1024px, so iPad landscape cannot fit it however short the name is truncated (QA 54) |
| `overflow.spec.ts` | Two complementary suites: nothing escapes the viewport, and nothing escapes its own clipping container |

`overflow.spec.ts` is worth understanding before you change it. It is **not** a
`scrollWidth` assertion: `base.css` sets `html, body { overflow-x: clip }` as a
backstop, which clamps `scrollWidth` to the padding box, so
`scrollWidth <= clientWidth` would be vacuously true forever. It walks the tree
and checks each box's right edge instead. The second suite exists because the
first has to exempt elements clipped by an ancestor (an intentional scroller),
and that exemption is exactly where QA 224 hid: a card's grid track grew past
its padding box, `overflow: hidden` silently cut the heading and the CTA, and the
page-level walk saw nothing wrong.

### Fixtures

Static HTML in `a11y/` at the repo root, served by the Vite dev server at
`/a11y/<name>.html`:

```
header.html          header-nav.html        course-filter.html
course-filter-empty.html                    find-a-member.html
resource-library.html                       member-dashboard.html
corporate-admin.html                        checkout.html
membership-directory-cta.html
```

Each fixture hard-codes props so a component can be driven without a portal.
`membership-directory-cta` is the first **HubL-module** fixture here; the rest
are React islands. The other HubL modules (`split-feature`, `hero`) still have no
fixture and are verified against a real portal upload.

### Adding a fixture

1. Copy an existing fixture in `a11y/`.
2. Set the mount div's `data-wa-module` and `data-props` to realistic values,
   including the edge case you care about (empty rows, locked resource, lapsed
   member).
3. Add the name to the relevant spec, and to `FIXTURES` in `overflow.spec.ts` if
   it should be checked at mobile width.
4. `pnpm test:a11y`.

The `course-filter-empty.html` fixture is the model for empty-state coverage: the
EOI-form branch is as much of the contract as the populated one.

---

## 4. What is not covered by tests

Be honest about this when you review a change:

- **HubL execution.** HubL only runs on the portal. Anything using
  `hubdb_table_rows`, `request_contact`, `crm_object` or macros is verified by
  upload plus manual check, or by a source-level guard.
- **Real membership resolution.** Tier resolution walks CRM objects. Test it
  with the QA personas in `portal_test_profiles`, as an active member, grace
  period, lapsed, never member, honorary, and a Gold-company employee with a
  weaker individual tier.
- **Private Content gating.** Page-level audience configuration lives in
  HubSpot. Verify with three test contacts: active, lapsed, non-member.
- **Event Engine and payment.** Exercised against staging, not mocked
  end-to-end. See [EVENT-ENGINE-API.md](./EVENT-ENGINE-API.md) for which
  endpoints are safe to call.
- **Lighthouse budgets.** The target is 85 mobile / 95 desktop on Home,
  Resources, Course and Member Dashboard. Run it by hand against the portal.

---

## 5. The pre-push gate

```bash
pnpm validate && pnpm typecheck && pnpm test && pnpm build
```

That is what CI runs (`validate.yml` and `build.yml`), plus one extra assertion
you cannot skip: **the build must not change any committed file.** If it does,
a generated block was hand-edited. See
[12-build-pipeline.md](./12-build-pipeline.md).
