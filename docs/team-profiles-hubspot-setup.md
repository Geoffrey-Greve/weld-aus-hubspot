# Team & Board profile pages - HubSpot setup

**For:** whoever holds HubSpot Content Hub + HubDB access (Ollie / Ryan)
**Context:** The frontend for `/about/team/` and `/about/team/{person-name}` is built and merged. The theme ships the **templates, modules and table schema**, but HubSpot still needs three things done by hand: the HubDB dynamic-page settings, the `/about/team` page record, and a data-source switch on the existing `/about` page. Theme files alone do not create URLs.

Do it in **sandbox first**, verify, then repeat in **production**.

| Environment | Portal name | Portal ID |
|---|---|---|
| Sandbox | `weld-australia-sandbox` | 443253065 |
| Production | `weld-australia` | 441838610 |

**Time:** about 30 minutes per environment, plus content entry.

> ### ⚠️ The one that catches everyone: **Page path**
>
> HubSpot routes `/about/team/<segment>` by matching `<segment>` against a row's
> built-in **Page path**. A row with a blank Page path has **no profile URL at all** —
> the detail page 404s, and its card on the grids renders unlinked. No template change
> can work around this; it is how HubSpot's dynamic pages resolve.
>
> Rows added through the HubDB UI or a CSV import get **no** Page path. So after any
> bulk import, and after adding people by hand:
>
> ```bash
> pnpm backfill:paths --env=production --table=team_and_board --dry-run   # check
> pnpm backfill:paths --env=production --table=team_and_board             # apply
> ```
>
> It only fills rows that are missing a path, only writes the row's path/name, and
> never touches column values. Re-running is a no-op. See §5.

---

## 1. What you're setting up

One HubDB table (`team_and_board`) drives three things:

| Surface | What it shows |
|---|---|
| `/about` → Our board | Rows with **Sits on the Board** ticked |
| `/about` → Our team | Rows whose **Category** is *not* Board |
| `/about/team/{person-name}` | One profile page per active row |

A person has **one row** and therefore **one profile page**, even if they appear in both grids. Geoff Crittenden is the case in point: he sits on the Board as CEO, so his row has **Sits on the Board** ticked *and* Category = Executive. He appears in both grids and both cards link to the same `/about/team/geoff-crittenden`.

---

## 2. Prerequisites

1. **Theme deployed** so the templates exist in the portal:
   ```bash
   pnpm build && pnpm upload:sandbox      # then pnpm upload:prod for production
   ```
   After upload this template is available in the page-template picker:
   - **About - Team & Board (dynamic - team_and_board HubDB)** → `about-team.html`

2. **HubDB schema pushed** - this adds the new columns and turns on dynamic pages:
   ```bash
   pnpm seed:hubdb --env=sandbox          # then --env=production
   ```

3. **Demo/starter rows** (sandbox, or production before real content lands):
   ```bash
   pnpm seed:hubdb:demo --env=sandbox --only=team_and_board --dry-run   # check first
   pnpm seed:hubdb:demo --env=sandbox --only=team_and_board
   ```
   > ⚠️ This **purges existing rows** in that table before inserting. On production, if real content has already been entered by hand, skip this step entirely or use `--no-purge`.

---

## 3. HubDB table settings (manual)

**Marketing → Files and Templates → HubDB → `Team & Board`**

The seed script sets `useForPages` and the SEO meta-tag mapping, but **not** the URL pattern. Set it here.

1. Open the table → **Settings** (top right).
2. Confirm **Enable dynamic pages using row data** (or "Create dynamic pages…") is **on**.
3. Set the **page path / URL pattern** to sit under the `/about/team` page.
4. Confirm the SEO column mapping (set by the seeder, but verify):
   - Meta description → **Bio**
   - Featured image → **Headshot**
5. **Publish** the table. HubDB changes are draft-only until published — this is the single most common reason a change "didn't work".

### Columns you should see

| Column | Type | Notes |
|---|---|---|
| Name | Text | Required. Displayed on the card and as the `<h1>` |
| Role / title | Text | Magenta line under the name |
| Qualifications | Text | e.g. `IWE`, `IWE, PhD` — renders as the outlined pill |
| Organisation / representing | Text | Board cards only, e.g. "Industry Representative" |
| Category | Select | Executive / Board / Engineering / Training / Q&C |
| Sits on the Board | Checkbox | **Drives the board grid.** Independent of Category |
| Headshot | Image | Also becomes the profile page's `og:image` |
| Bio | Rich text | Profile page body. Also becomes the meta description |
| Display order | Number | Sorts both grids — see §6 |
| Active | Checkbox | Untick to remove someone from the site |
| **Page path** | (built-in) | The `{person-name}` URL segment. See §5 |

---

## 4. Create the `/about/team` page

**Content → Website Pages → Create → Website page**

| Field | Value |
|---|---|
| Template | **About - Team & Board (dynamic - team_and_board HubDB)** |
| Page name | Our Team & Board |
| URL path | `/about/team` (exact — the profile URLs are built from it) |
| Private content | **None.** This is a public page |

Then, still in the page editor:

1. **Settings → Advanced options → Dynamic pages**.
2. Set **HubDB table** to `Team & Board`.
3. **Publish** the page.

HubSpot now serves `/about/team` as the listing and `/about/team/{page path}` as one child page per active row. Nothing else needs creating — do **not** create individual pages per person.

> If the Dynamic pages option is missing, the table's "Enable dynamic pages" setting in §3 hasn't been published yet.

---

## 5. Give every row a Page path

The **Page path** is the `{person-name}` part of the URL, and it is what makes a
profile exist at all. Rows without one still appear in the grids, but as plain
non-clickable cards.

### Fill them automatically (recommended)

```bash
pnpm backfill:paths --env=production --table=team_and_board --dry-run
pnpm backfill:paths --env=production --table=team_and_board
```

The script derives a path from each person's **Name**: lower-cased, hyphenated, with
a leading honorific dropped and apostrophes removed.

| Name | Page path |
|---|---|
| Geoff Crittenden | `geoff-crittenden` |
| Prof. Madeleine du Toit | `madeleine-du-toit` |
| Ross O'Bryan | `ross-obryan` |
| Dr. Graham Hutt | `graham-hutt` |

What it will and won't do:

- Fills **only** rows whose Page path is blank. A path you set by hand is never
  overwritten, so type a custom one first if you want it.
- Writes **only** the row's Page path (and Page title when blank). It sends no column
  values, so bios, headshots and categories cannot be altered.
- Never deletes or purges rows. Re-running it reports "nothing to do".
- `--dry-run` prints the full list of proposed paths and writes nothing. Always run it
  first and read the output.
- Publishes the table when done (`--no-publish` to skip).

**Duplicate names get separate paths.** Two rows for the same person — e.g. Geoff
Crittenden entered once under Board and once under Corporate — are two rows, so they
get two pages: `geoff-crittenden` and `geoff-crittenden-2`. The script warns about this
in its output. To have one profile instead, delete the duplicate row and tick **Sits on
the Board** on the remaining one; the board grid picks up either.

### Or set them by hand

Type into the **Page path** column in HubDB. Rules:

- Must be **unique** across the table.
- Treat it as permanent once live — changing it changes the public URL and breaks any
  inbound link. If one must change, add a redirect under **Content → URL Redirects**.

---

## 6. Ordering the two grids

There is one **Display order** column feeding both grids, so the numbers interleave. The starter data uses:

| Order | Person | Board grid | Team grid |
|---|---|---|---|
| 1 | Prof. Ian Harris | ✅ 1st | — |
| 2 | Dr. Patricia Morrison | ✅ 2nd | — |
| 3 | Geoff Crittenden | ✅ 3rd | ✅ 1st |
| 4 | Robert Gillies | ✅ 4th | — |
| 5 | Lynette Thomson | ✅ 5th | — |
| 6 | Dr. Mark Harrison | ✅ 6th | — |
| 11+ | Dr. Graham Hutt, Rhian Gunn, … | — | ✅ in order |

Leave gaps (the jump from 6 to 11) so people can be inserted later without renumbering everyone.

---

## 7. Switch the existing `/about` page to HubDB

**This is the step that's easy to miss.** `/about` is a drag-and-drop page, so its module settings are stored on the *page*, not in the theme. Deploying the theme does **not** change them — the two people sections will keep showing their old hard-coded lists until you do this.

**Content → Website Pages → About → Edit**

1. Click the **Board of Directors** module.
   - Set **Data source** → *HubDB - Team & Board table*.
   - Leave **Board members only** ticked.
   - Confirm **Profile page URL base** is `/about/team/`.
   - Clear the module's own **People** list entries (they're ignored, but leaving them is confusing for the next editor).
2. Click the **Our Team** module.
   - Set **Data source** → *HubDB - Team & Board table*.
   - Set **Exclude categories** to `board`.
   - Confirm **Profile page URL base** is `/about/team/`.
   - Clear the **People** list entries.
3. **Publish**.

---

## 8. Adding, editing and removing people (day-to-day)

All of it happens in the HubDB table — no developer involved, no page edits.

**Add someone**
1. HubDB → `Team & Board` → **Add row**.
2. Fill Name, Role, Category, Headshot, Bio, Display order.
3. Tick **Sits on the Board** if they're a director.
4. Set the **Page path** (§5) — or leave it and run `pnpm backfill:paths` afterwards.
   Without one, the person has no profile page and their card won't be clickable.
5. Tick **Sits on the Board** if they're a director, or set Category to `Board`.
6. Tick **Active**.
7. **Publish the table.**

**Edit someone** — change the row, publish the table. Live within a couple of minutes (HubDB cache).

**Remove someone** — untick **Active** and publish. They disappear from both grids, and their profile URL stops showing the profile: it serves a short "This profile is no longer listed" page marked `noindex`, with links to the team page and Contact. Prefer this to deleting the row — it's reversible and keeps the page path reserved.

> HubSpot generates a child page for every *published* row, so the URL itself keeps responding; HubL can't return a real 404. If a hard removal is required (a takedown request, say), add a **Content → URL Redirects** entry from `/about/team/{path}` to `/about/team`, or delete the row outright.

**Someone joins the board** — tick **Sits on the Board** on their existing row. Do *not* create a second row; that would create a duplicate profile page.

---

## 9. Verification checklist

After publishing, in the environment you just configured:

- [ ] `/about/team` loads and shows a board section and a grouped staff section.
- [ ] `/about` shows both people sections from HubDB (names match the table, not the old hard-coded list).
- [ ] Hovering a card shows it's clickable; clicking opens that person's profile.
- [ ] Geoff Crittenden appears **in both grids**, and both cards go to `/about/team/geoff-crittenden`.
- [ ] A profile page shows headshot, name, role, qualifications, full bio, "At a glance", related people, and a working **Back to our team** link.
- [ ] Breadcrumb reads Home / About / Our team / {name} and every link works.
- [ ] View source on a profile: `<title>`, meta description, `rel=canonical`, `og:image`, and two JSON-LD blocks (`Person` and `BreadcrumbList`). Paste into [Google's Rich Results Test](https://search.google.com/test/rich-results).
- [ ] Untick **Active** on a test row, publish → gone from both grids, and its URL now shows the "no longer listed" page. View source: `<meta name="robots" content="noindex, nofollow">` is present. Re-tick and publish.
- [ ] A row with no Bio still renders a sensible profile page (fallback text plus a Contact CTA), not a blank column.
- [ ] A row with no Headshot shows the initial-letter placeholder, not a broken image.
- [ ] On a phone: cards stack to one column, tap targets are comfortable, no sideways scrolling.
- [ ] Tab through a grid with the keyboard — each card takes focus with a visible magenta outline.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/about` still shows the old names | Page modules still on "This module's People list" | §7 |
| Cards aren't clickable | Rows have no **Page path** | Run `pnpm backfill:paths` — §5. View source on the card: there's an HTML comment naming the row |
| Board section missing entirely | No row is flagged **Sits on the Board** and none has Category `Board` | Tick the flag or set the category, publish. View source: the board-grid comment says which rule matched nothing |
| Someone vanished from the staff grid | Their **Category** is blank and the grid is grouped | They now appear under the catch-all heading; set a Category to place them properly |
| `/about/team/{name}` 404s | Page not set as the table's dynamic page, or the table isn't published | §3, §4 |
| Dynamic pages option missing on the page | Table's "Enable dynamic pages" not published | §3 step 5 |
| Someone's missing from the board grid | **Sits on the Board** not ticked | §8 |
| A board director also appears under Our team | Their Category isn't `Board` | Set Category = Board, publish |
| Changes don't show | Table saved as draft | Publish the table |
| Change published but page unchanged | HubDB cache | Wait a couple of minutes, then hard-refresh |
| Removed person's URL still responds | Expected — HubSpot serves every published row | It shows the noindex "no longer listed" page. Add a URL redirect if a hard removal is needed |
| Duplicate profile for one person | Two rows for the same person | Merge into one row; tick **Sits on the Board** rather than adding a second row |

---

## 11. Content still needed from the client

The starter rows carry **placeholder bios and no headshots**. Before production go-live, Danielle needs to supply:

- Final board list with correct titles and the organisation each director represents.
- Final staff list with roles, qualifications (`IWE`, `IWT`, `PhD`, …) and category.
- A bio for each person — 1–3 short paragraphs.
- A headshot for each person. Portrait crop, ideally 800×960px or larger; the card crops to 5:6 and the profile hero to a square.

Related: CLAUDE.md §13 Q3 (brand kit) and Q8 (content deadlines).
