# Troubleshooting

Symptom first. Most of these have bitten this project at least once, several of
them twice.

---

## 1. "I changed it and nothing happened on the site"

| Symptom | Cause | Fix |
|---|---|---|
| Template copy changed, live page unchanged | Page content is stored on the page, not the template. `dnd_module` values in a template only seed a page at creation | Edit the page in HubSpot. See [page-editor-field-checks.md](./page-editor-field-checks.md) |
| New field's default not showing | HubSpot kept the page's saved (often empty) field value | Open the page editor, reset or re-save that module, or recreate the page |
| Island shows old behaviour | You uploaded without building. `theme/assets/js/` is gitignored | `pnpm build` then upload |
| CSS change not applied | `critical.css` is generated | Edit `tokens.css` / `base.css` / etc, then `pnpm build` |
| A new page template does not appear as a page | Templates are not pages | Create the page in HubSpot. `DEPLOYMENT.md` § 7 |
| A repointed `{% module "id" path="…" %}` still renders the old module | A saved widget carries the binding it was created with | Give the instance a new id. The old instance's editor overrides are dropped, so the template defaults must carry the intended copy |
| A module deleted in git is still in Design Manager | `hs upload` never deletes | `hs cms delete weld-australia-theme/modules/<name>.module --account=<account>` on each portal, after confirming no page binds to it |
| HubDB row edited, page still old | HubDB cache TTL, and drafts need publishing | Wait a minute, hard refresh, and check the table is published |

---

## 2. Build failures

**`pnpm build changed committed files - the tree is not idempotent`**

A generated block was hand-edited. Candidates: an island's `<script>`/`<link>`
tag in `module.html`, `theme/templates/partials/course-taxonomy.html`,
`src/shared/courseTaxonomy.ts`, or the generated menu block in
`header.module/module.html`. Fix the source (`config/*.json` or the component),
rebuild, and commit the generated output with the source change.

**`Could not patch standalone bundle tag for <name>`**

`module.html` has neither the `{# @bundle: <name> #}` placeholder nor a
recognisable existing tag. Add the placeholder where the tag belongs.

**`Missing generated header menu markers`**

Someone removed `{# @generated-header-menu:desktop:start #}` or its `:end`
partner from `header.module/module.html`. Restore both markers.

**`config/course-categories.json: "<key>" is claimed by both "<a>" and "<b>"`**

Two divisions declare the same slug, label, HubDB value or alias. Keys are
slugified, so "Welding Inspection" and `welding-inspection` collide by design.

**`Bundle size budget exceeded`**

An entry chunk is over 80 KB gzipped. Look at what the island imports: a
barrel import that drags in something large, or a shared utility that does not
belong in that island. `pnpm check:bundle` prints the report.

**Validator errors** are listed by rule name in
[12-build-pipeline.md](./12-build-pipeline.md) § 2. The two that surprise people:

- An asset-reference error means a literal `get_asset_url('…')` path does not
  resolve on disk. That is a dangling bundle or stylesheet reference which would
  404 in production.
- A visibility error means a conditional field would be hidden in the editor
  forever, and HubSpot itself raises no upload error for it.

---

## 3. Upload failures

| Symptom | Cause | Fix |
|---|---|---|
| Empty 403 from HubSpot mid-upload | Cloudflare rate-limiting the CLI's default concurrency of 10 | `scripts/upload.ts` already batches with retries. Re-run it; `hs upload` is idempotent |
| `hs upload` refuses to run | `hsproject.json` is present | Use `scripts/upload.ts`, which parks and restores it |
| A HubL validation error on a page or layout | It `{% import %}`s a partial not yet on the portal | Use `scripts/upload.ts`, which uploads partials, then layouts, then everything else |
| Serverless upload rejected | Content Hub Professional cannot host Design Manager serverless | Expected. `corporate.functions/` is skipped unless `--with-serverless` |
| `No access token found` from a HubDB script | The CLI is not authenticated for that portal | `hs auth`. Do not hunt for a private-app token |
| Uploaded to the wrong place | `--env=staging` (443253065) and `--env=production` (441838610) are different portals | Check the portal id in the upload output before you walk away |
| `pnpm upload:prod` went to portal 4538263 | A `hubspot.config.yml` copied from an older template mapped `weld-australia-production` to 4538263. `upload.ts` matches on the account **name** when no portal id matches, so it uploads wherever that name points | Set `portalId: 441838610` in your `hubspot.config.yml`, or re-run `hs auth` |
| `No access token found` for staging on a seed or backfill | Nothing falls back to production any more: an unauthenticated staging portal is a hard error, by design | Authenticate staging (`hs auth`), and check the portal id each script echoes on its first line |

---

## 4. HubDB

| Symptom | Cause | Fix |
|---|---|---|
| A module that reads a new column renders blank | The column does not exist on that portal | `pnpm seed:hubdb -- --env=<env>` **before** the theme upload |
| An option added to `hubdb/*.json` never appears | The seed never changes options on an existing column | Add the option in HubDB by hand. The seed warns about the drift |
| A city Weld Aus added disappeared after a seed | It did not. The seed passes the portal's own column definition back untouched, precisely so this cannot happen | If a city is genuinely missing, check the row's `state` is set |
| Profile pages 404 | Rows have a blank `hs_path` | `pnpm backfill:paths -- --env=<env> --table=<table>`, dry-run first |
| Course pages have no title or social card | Blank SEO columns | `pnpm backfill:course-seo -- --env=<env>` |
| Dashboard geo tile misses sessions | Blank `courses.state` | `pnpm backfill:course-state -- --env=<env>` |
| A private table is readable via the API | `allowPublicApiAccess` was changed in JSON only | Run `pnpm seed:hubdb`, and run it before any row seeder that writes sensitive columns |
| `row.city` renders as an object | Select columns are objects | Use `row.city.name`, falling back to `.label` then the raw value |

---

## 5. Membership, gating and pricing

| Symptom | Cause | Fix |
|---|---|---|
| A Gold-company employee is quoted the generic member rate | The contact's own tier is a sentinel ("Not Applicable"), and a truthiness test read it as real | `_member-tier.html`: `is_real_tier` / `scrub` / `prefer_pricing_tier` (defect 213) |
| A HubL condition on a macro is always true | Macros emit surrounding whitespace | `|trim` the result into a variable and test that |
| Checkout shows full price for a member | Membership was resolved on the lightweight private-content contact only | Walk the full resolution chain, see [16-membership-and-pricing.md](./16-membership-and-pricing.md) § 3 (defect 126) |
| A QA persona works in the portal but not at checkout or on a course page | That surface does not resolve personas | Include `_qa-persona-resolve.html`, setting `qa_persona_email` first |
| Prices differ between two pages showing the same course | A hand-rolled tier-to-column chain | Use `_member-pricing.html` or `memberPricing.ts`. The parity test exists for this |
| An honorary member sees renewal warnings | Honorary has no expiry | `isHonoraryMember(ctx)` |
| Portal body is blank in the page editor | The preview mock did not apply, or a head redirect fired | Preview flags are `is_in_editor`, `is_in_previewer`, `?portal_preview=1`, `?hs_preview`. Never redirect from `extra_head` |
| A portal page is publicly reachable | The page-level Private Content audience was never set. The in-page sign-in panel is only a fallback | Set the audience in HubSpot |
| "Download PDF Receipt" is a broken link | `xero_invoice_pdf_url` is not populated yet | Show "Receipt processing - check back shortly" |

---

## 6. React islands

| Symptom | Cause | Fix |
|---|---|---|
| Island never renders | No `data-wa-module`, or the name does not match `mountReactIsland(...)` | Match them exactly |
| Island renders empty | `data-props` failed to parse. `mount.ts` logs the error and the raw value | Check the browser console. Usually unescaped HubL output: use `| tojson | escape` |
| Island blanks out while editing in HubSpot | The editor clears DOM subtrees | Already handled: `mount.ts` re-renders a cleared host. If it recurs, check the host still carries `data-wa-module` |
| Island loads a 404 script | Built with a different bundle name, or uploaded without building | `pnpm build`, then check the `<script>` tag matches a file in `theme/assets/js/` |
| A new island's script tag is never written | The name is missing from `HUBSPOT_STANDALONE_MODULES` in `scripts/build.ts` | Add it |
| Something works locally but not on the portal | The fixture props do not match what HubL actually serialises | Log the real `data-props` from the portal and copy it into the fixture |

---

## 7. Local development

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm dev` shows an island but not the real page | Vite serves fixtures, not HubL | HubL only runs on the portal. Use `pnpm watch` |
| Playwright cannot connect | The `webServer` config starts Vite itself; something else is on 5173 | Free the port. `strictPort: true` is deliberate |
| Playwright fails on a missing browser | Chromium not installed | `pnpm exec playwright install --with-deps chromium` |
| Typecheck fails on an array index | `noUncheckedIndexedAccess` is on | Handle the `undefined` case rather than reaching for `!` |
| Prettier keeps rewriting your file | It owns formatting | `pnpm format` |

---

## 8. Page renders unstyled

The classic symptom is a visible blue "Skip to main content" link on a blank
canvas. `critical.css` returned 404. Check DevTools Network for
`critical.css` = 200. The cause is almost always a wrong `get_asset_url()` path
or an upload that did not include the built CSS, which means the build did not
run. `pnpm validate` catches the path case, and `pnpm build` the other.

---

## 9. When none of this helps

1. Check [`../bugs/qa-log.md`](../bugs/qa-log.md). A surprising number of "new"
   defects are recorded there with the cause.
2. Check the file's own header comment. The scripts and the HubL partials
   document the defect they exist to prevent, which is usually the fastest route
   to why the code looks the way it does.
3. Check `git log` on the file. The commit messages in this repo carry the
   reasoning.
