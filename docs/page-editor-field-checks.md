# Page-editor follow-ups (defects 126, 100, 51, 33)

Theme code covers these four ClickUp items. A few need a one-time check in the HubSpot page editor after upload, because **saved module field overrides** can beat template defaults.

| Environment | Portal name | Portal ID |
|---|---|---|
| Sandbox | `weld-australia-sandbox` | 443253065 |
| Production | `weld-australia` | 441838610 |

Upload first: `pnpm build && pnpm upload:sandbox` (then `:prod`).

---

## 126 — Checkout shows full price (member discount missing)

**Code fix:**
1. CRM sentinels (`Not Applicable`, `Non Member`, …) are scrubbed so corporate employees inherit company Gold/Silver/Bronze.
2. Checkout entitlement matches the portal: any real contact/company membership signal (tier, status, expiry, member id, directory row) while not lapsed.
3. Contact → Company associations are used when `associatedcompanyid` is empty.
4. React prefers the stronger of contact vs company tier (Gold beats Individual).
5. Refuel plus-address QA personas (`portal_test_profiles` HubDB) override CRM on checkout and course pages the same way `/portal` does — so `nick+portal-qa-corporate-silver@…` gets Silver rates without a fake company Deal.

**Verify live** as a corporate employee on staging (`staging-441838610.weldaustralia.com`), logged into the portal:

1. Portal shows a member rate on a course (e.g. IIW Basic Gold $2,170 vs public $2,555).
2. Register → `/checkout?session_id=…` Step 3 shows the **same** member rate (not `$2,555.00`).
3. View source / React `data-props`: `member_is_logged_in: true`, `member_is_member: true`, and `member_tier` / `member_company_tier` include the company level (e.g. Corporate Gold).

**Also verify** with a QA plus-address (e.g. `nick+portal-qa-corporate-silver@refuelcreative.com.au` on AS1796 Cert 10): portal, course page, and checkout Step 3 should all show the Silver member rate (`$5,500`), not the public `$5,850`.

No page-editor step unless props still look wrong after upload (then re-check contact/company CRM properties with Ollie — or confirm the plus-address matches an active `portal_test_profiles.profile_code`).

---

## 100 — `/courses` hero image (top right)

**Code fix:** the `/courses` hero uses `media_type="image"` plus a default stock photo.

**Page-editor check** (only if the live page still has no image):

1. Open `/courses/` → **Hero** (the first module in the **Courses listing** area).
2. **Right-side media** = **Image**.
3. Confirm **Image** is set (or replace with the approved asset).
4. Publish.

---

## 51 — Course cards alphabetical wall

**Code fix:** `/courses` and `/training` directory listings expose **Sort by** (Name / Cost) and **Order** (Ascending / Descending). Default is Name ascending. Cost sorts by the price the visitor would pay (member rate when entitled).

**Verify live:** `/courses/#all-courses` and `/training/#courses` — change Sort by to Cost and Order to Descending; highest-priced cards move first. Name ascending restores A–Z.

No page-editor step.

---

## 33 — Advocacy “Latest updates” → full announcements list

**Code fix:** Advocacy news browser shows **View all announcements** → `/news/`.

**Page-editor check** (only if the link is missing after upload — stale saved `browser` fields):

1. Open `/advocacy/` → **News and insights**.
2. Latest articles browser → enable **Show view-all link**.
3. Label `View all announcements`, URL `/news/`.
4. Publish.

**Verify live:** under “Industry news & updates”, the view-all link goes to `/news/`.
