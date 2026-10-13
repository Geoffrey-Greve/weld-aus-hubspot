# QA defect reconciliation - 20 September 2026

Reconciles the [Weld Australia QA defect sheet](https://docs.google.com/spreadsheets/d/1FdrtxLP12l8th8thOFLRq1ICuN1S_ghula672_zWoFk/edit?gid=1873003075#gid=1873003075)
against the code actually on `main` in `weld-aus-hubspot` and `events-engine`.

Refresh this file when the sheet is next swept. It covers both repos and lives here
rather than in `events-engine` so there is one copy to keep current.

## Headline

**No code defects outstanding.** Every code-located ref on the sheet has landed on `main`
in one or both repos. What is blocking QA on four of them is **HubDB data and Worker
configuration**, not code, and the sheet does not say so anywhere - which is why they read
as stalled.

## How this was verified

| Check | Result |
|---|---|
| `weld-aus-hubspot` branch vs `origin/main` | level, nothing uncommitted |
| `events-engine` branch vs `origin/main` | level, nothing uncommitted |
| `pnpm test:unit` (theme) | 52 files, 1,226 tests passing |
| `pnpm test` (events-engine) | 66 files, 882 tests passing |
| `pnpm test:a11y` (theme) | not run - Playwright's Chromium is not installed in the review container. Environment, not code |

Production HubDB state quoted below is the run recorded in CLAUDE.md §7.7 / §11.6 dated
2026-09-20, not a run made for this document. Re-run the audits before acting on it.

## Statuses out of date

Code complete, sheet says otherwise.

| Ref | Sheet status | Reality |
|---|---|---|
| 15 | In Progress | Done. `bad840c`, pinned by `tests/unit/contact-cta-anchors.test.ts`. Also caught four certification CTAs plus training, membership, engineering and the job board |
| 63 | *(blank)* | Done. `contact-methods-grid` gained an `email` field per entry and linkifies an address already sitting in a note |
| 73 | In Progress | Code complete **both sides**: worker migration 0044 (`c5975e4`) and theme `01f93a8`. Gold/Silver/Bronze percentages now read off the `events` row. Needs the Worker config below before the theme ships |
| 107 | *(blank)* | Done. The "Starting from today" toggle was removed outright, replaced by a per-row "Registrations closed" badge derived server-side |
| 121 | *(blank)* | Answered, and the audit mislabelling fixed (`0bb67f3`). Not a defect - see below |
| 86 | *(blank)* | Half. Cities fixed (`src/shared/courseCities.ts`), routing audit built. The Mackay / Maryborough symptom itself is a HubDB row edit |
| 109 | QA Blocked - Production | Cause fixed: `_member-company-resolve.html` parity plus the directional price guard. Unblock and re-QA |
| 61 | Ready for QA, "blocked by ref 109" | 109 is fixed. Unblock |
| 40 | Ready for QA - Production | The QA note says the member login still errors. That was refs 98 / 109, now fixed. Re-run QA |
| 119 | QA Passed - Dev | Dev-only HubDB import fault, no code involved. Close outright |
| 97 | Blocked | Ref 57 is closed as QA Passed. Confirm and close 97 as a duplicate |

Refs 21, 26, 36, 44, 72, 74, 98 and 120 are verified as shipped and correctly marked
Ready for QA.

## What is really blocking, and it is not code

### Ref 46 - "all modules say Contact to book"

This is data. Production carries 44 module rows, 0 resolving to a session, and
`courses.module_product_id` **does not exist on the portal at all**. The order is fixed and
not negotiable:

```bash
pnpm seed:hubdb -- --env=production        # creates the module_product_id column
# then create the module session rows (is_module, module_product_id, dates, prices, worker_event_id)
pnpm audit:course-modules -- --env=production
```

Then the 17 orphans whose `parent_course_id` names a course with no `courses` row at all
(`metallurgy-1`, `fabrication-math-1`, `welding-symbols` and the rest). Those read as Weld's
short courses and e-courses, so it is a content question for Weld before anybody edits a
cell, not a wiring gap. Fixing the orphans first points modules at courses that still cannot
sell them.

### Ref 73 - deploy order matters

Configure the Worker **first**, then upload the theme:

```
PATCH /api/v1/manage/onboarding/hubdb-pricing
{
  "eventsTable": "events",
  "eventsEventIdColumn": "worker_event_id",
  "eventPriceColumns": { "member": "member_price", "nonMember": "non_member_price" },
  "eventDiscountColumns": { "gold": "gold_discount_", "silver": "silver_discount_", "bronze": "bronze_discount_" }
}
```

In between, the page reads the row and the Worker reads the ticket type, and wherever those
disagree a booking is refused. Run `pnpm audit:event-engine -- --env=production` before
either and reconcile the rows it names.

### Ref 86 - one slug, one served row

```bash
pnpm audit:course-routing -- --env=production
```

The fix is one row's dynamic page path set by hand, then standardising `course_id` across
that slug's sessions. **Never** `pnpm backfill:paths` on `courses` - it mints a path for
every row it can slug, which publishes a URL per session.

### Ref 121 - TryBooking

Answer Weld's first question before anything else: `registration_url` **is** wired, as the
fallback for a row that is not Event Engine configured. Untick `use_event_engine` on the SA
Open Day row and Register Now follows the TryBooking link. No code change. The audit reports
the both-set state as `ticked_with_external_url` (info), because the row transacts correctly
either way and which one the tenant meant is an editorial call.

## Two things not on the sheet that should be

### Weld's voucher mapping is wrong, so corporate allowances are honoured at zero

Weld's properties are `vouchers_allowance` and `vouchers_used__training`. The Worker defaults
to `vouchers_total` / `vouchers_used`, so it resolves every company to a nil balance, covers
no seats, and the usage write-back dies on a property the portal does not have. The config
endpoint only landed on 20 September (`b6977ec`):

```
PATCH /api/v1/manage/onboarding/voucher-config
{ "mode": "seat", "totalProperty": "vouchers_allowance", "usedProperty": "vouchers_used__training" }
```

Note the present-tense limit: one pool per tenant. Anything drawn from Weld's
`vouchers_used__engineering` pool will disagree with their own arithmetic.

### The portal needs re-authorising, then properties provisioning

Schema scopes (`crm.schemas.contacts.*`, `crm.schemas.companies.*`) went from optional to
required. Weld authorised long before that, so the portal is missing `teams_join_url`,
`event_attended`, `event_last_attended_date` and `event_last_attended_name`. Ref 78's repair
catches these one booking at a time; provisioning them properly is the fix.

**Map before provisioning.** An unconfigured provision would create `vouchers_total` /
`vouchers_used` beside the real allowance, report success, and leave every corporate booking
reading a zero balance off two empty fields.

```
POST /api/v1/manage/onboarding/properties     # after re-authorising, and after the voucher mapping above
```

## Known code gaps, deliberate, not defects

Worth logging as refs if Weld will notice them. None is a regression.

- **The event registration widget is not tier-aware.** A Gold member sees the generic member
  price there, not their percentage. The understatement is in the buyer's favour, the
  checkout tunnel *is* tier-aware, the widget sends no `expectedUnitCents`, and the Worker is
  authoritative either way. Making it tier-aware means extracting the contact-resolution
  preamble that five course-pricing surfaces already carry byte-identical, which is its own
  change.
- **The parent session is not pickable on a course page.** `CourseFilter`'s city selection
  does not drive the complete-course CTA or `data-checkout-base`; both hardcode
  `dynamic_page_hubdb_row.hs_id`. The modules a buyer ticks are their choice; which sitting of
  the course is not.
- **Registration question prefill is not wired on the CMS side.** Capture works. The Worker
  hands an unauthenticated caller definitions only, so prefill has to come from HubL reading
  the logged-in visitor's own contact via the `hsProperty` each definition names.

## Closed rows worth a second look

- **Ref 85** is marked Unachievable against the Theme repo. The misformatted mobile invoice is
  HubSpot's own hosted invoice page, so Unachievable is right, but the fix location is not
  ours.
- **Ref 87** is the only code-located row marked QA Passed in Production. Nothing contradicts
  it.

---

# Client call update - 21 September 2026

Answers to Ali's pre-call questions. The 20 September reconciliation above still
stands; this adds the per-ref detail asked for, and two findings that change what a
re-test is worth.

## Read this first: the caveat is decisive

Jay's results were logged against **D-2026-09-18-B**, Friday's build. Every membership
fix behind refs 98, 109 and 72 landed on **Sunday 19 September**:

| Repo | Commit | What it fixed |
|---|---|---|
| events-engine | `5932435` | stop refusing a verified member over our own tier disagreement |
| events-engine | `6ec01f3` | price a guest from the same HubDB row the page quoted |
| events-engine | `496282e` | keep the course public price off a member ticket, and say why a price refused |
| events-engine | `8975c70` | say which contact properties the membership verdict was read from |
| weld-aus-hubspot | `6e9f3c0` | stop offering a corporate member a lower tier |
| weld-aus-hubspot | `74966bc` | pin the checkout and the course surfaces to one ladder |

Friday's build contains none of them. Those three results describe pre-fix code and
should be re-run rather than read.

## Sunday's build is live, so the re-tests are worth running

Confirmed by Ryan on 21 September: **D-2026-09-20-A is pushed and built on both the Worker
and the theme.** Every fix listed above is in production, so refs 98, 109, 72, 61 and 40 can
be re-tested against code that actually contains them.

Neither production deploy is automatic and neither leaves a record in the repo - the Worker
goes out by hand with `wrangler deploy --env=""` (`events-engine` ships only `ci.yml`), and
the theme's `deploy.yml` is manual, confirmation-gated and main-only by design. That is
worth keeping in mind whenever a build version is in question; it is not in question here.

**Both portals are deployed by hand, by choice** (Ryan, 21 September), and the automatic
staging deploy is not in use - `HUBSPOT_PERSONAL_ACCESS_KEY_STAGING` is unset, so runs 13-16
all exit on `Secret ... is not set`. The consequence to carry rather than fix: staging holds
whatever was last uploaded rather than the latest merge, so a QA result from that portal is
worth pairing with the build it ran against. The workflow itself should be disabled or
removed so `main` stops carrying a permanently red check.

## Per-ref answers

### Ref 98 - "We couldn't verify your membership" at final checkout

Fixed, on 19 September, after the build Jay tested. The CMS and the Worker now resolve
the buyer's employer the same two ways: `associatedcompanyid` first, then the
contact-to-company association sweep. That property is only ever set for a PRIMARY
association and much of Weld's corporate membership has none, so the Worker alone was
resolving those employees as non-members and refusing the price the page had quoted.

Live in production since Sunday. Re-test, reading the pricing diagnostic before booking
(below).

### Ref 87 - IWS showing "Sold Out" when it is not

Leading cause, and it is our change rather than Weld's data going stale: on
**17 September** (`47455fe`) a hand-set `Sold Out` in HubDB became authoritative. The
Worker may now only NARROW availability, never widen it - staff close sessions for
reasons a seat count cannot see. Before that commit a live seat read overrode the status
column and the page kept selling. So a stale `Sold Out` that was previously invisible is
now honoured, which is exactly the shape of "it says sold out and it isn't".

**Fix: clear the `status` column on the IWS `courses` row(s).** A row edit, no code
change, no deploy. The cost of the 17 September rule, accepted deliberately at the time,
is that nothing re-opens a hand-closed session automatically.

Two further candidates, in order:

1. `seats_remaining` is 0 and no successful live read arrives to override it - either the
   row has no `worker_event_id`, or it has one and the availability request failed. Soft
   sold-out off a stale hand-typed number, still wrong.
2. The Worker genuinely has no seats because QA test bookings are holding them. A booking
   on invoice terms holds its seat until the invoice due date - up to 90 days - and held
   seats are subtracted from what is for sale. If this is it, cancel the test orders.

**Read the Worker before acting on candidate 2, because no audit can see it.**
`pnpm audit:event-engine -- --env=production` reads HubDB and nothing else: it names the
row's `status`, its `seats_remaining` and whether it is engine-backed, which settles the
first candidate and this section's leading cause, and it is blind to seats. An
engine-backed row whose HubDB values all look ordinary is exactly the case it cannot
answer.

Two reads that can:

```
GET /api/v1/events/{worker_event_id}/availability          # public: what the page sees
GET /api/v1/manage/events/{id}/registrations               # admin-authed: who holds them
```

The first says whether the Worker is the side reporting full. The second partitions the
seats by booking state, and `awaitingPayment` is the figure that matters: a seat held
against an unpaid invoice, which is what a QA booking on invoice terms is. Paid bookings,
a paused ticket type and a genuinely sold-out session all read differently there, so it
distinguishes cancelling our test orders from three other Worker-side causes that would
not be fixed by cancelling anything.

### Ref 40 - could not reach the invoice check

Correct and expected: 98 / 109 blocked it. Nothing on 40 is outstanding in code. Items
1-6 all landed: both invoice dates in the same UTC-midnight frame (a due date in the past
is what stopped the invoice opening at all), the D1 line-item registry that ended the
booking invoiced four times over, the Idempotency-Key scoped to the submission rather than
the event, the counting "preparing your invoice" message, and the tunnel ending on a
terminal "Your place is held" panel with a **Pay invoice now** link instead of throwing the
buyer off-site.

One expectation to set on the call: **nothing emails the invoice.** The Worker opens it and
stores the hosted link; opening publishes a link, it does not send it, and no HubSpot
workflow sends it either. If Weld expect an invoice email that is a workflow to build -
the same gap as ref 61.

### Ref 46 - every module says "Contact to book" after Roz populated `module_product_id`

**None of Roz's three candidates. It is a fourth: the rows that need the id do not exist
yet.**

The join is `course_modules.hubspot_product_id` matched against
`courses.module_product_id` (`_module-session-resolve.html`, line 130). The `courses` row
that id must land on is a **module SESSION row** - `is_module` ticked, its own dates, its
own prices, its own `worker_event_id`. Production carries 44 module rows and **zero** such
session rows. Putting the product id on the 19 parent course rows creates none: at best it
points a module at the parent course's own session, which is the wrong dates and the wrong
price.

Taking her three in turn:

- **Is the field being read?** Yes.
- **Was the table published?** It matters in general - HubL reads the published table, so
  an unpublished edit changes nothing - but publishing will not help here, because the
  rows are missing rather than unpublished.
- **Caching?** No.

The order is fixed and not negotiable:

```bash
pnpm seed:hubdb -- --env=production        # creates the module_product_id column
# then create one courses row per module session
pnpm audit:course-modules -- --env=production
```

That audit says in one run whether the **column** is missing (a seed) or the **rows** are
(data entry) - which is the distinction that has cost this ref two rounds.

Then the 17 orphans (`metallurgy-1`, `fabrication-math-1`, `welding-symbols`,
`wps-pqr-explained`, `structural-bolting-e-course` and the rest), whose `parent_course_id`
names a course with no `courses` row at all. Those read as Weld's short courses and
e-courses: a content question for Weld, not a wiring gap. Fixing them first points modules
at courses that still cannot sell them.

**One trap worth naming before anyone spends a day on it.** Even with every module
resolved, every tickbox on a course page turns off if the PARENT row serving that URL has
a start date in the past, or a Cancelled / Sold Out status. Same family as ref 87, and the
page reverts to exactly the "Contact to book" state being reported.

### Ref 61 - no automated confirmation email

Two halves, and the second one does not exist.

- **The Worker half is live in production** as of Sunday's build.
- **The email half was never ours to build.** By design the Worker sends nothing: it
  stamps the booking's ORDER id onto the attendee's contact
  (`last_event_engine_registration_id`, tenant-mappable) and a HubSpot workflow watching
  that property sends the email - the same pattern as Ollie's membership certificates.
  There is no such workflow in `workflows/` and nothing records one existing in the
  portal.

So even with a perfect Worker there is no email. **Ollie needs to build the workflow.**

Two Worker-side things to clear first:

- Weld's portal was missing the property until Ref 78's repair created it, and four
  bookings' confirmation rows died in that window. They need re-driving:
  `POST /api/v1/manage/diagnostics/outbox/redrive`.
- A card-at-checkout booking is deliberately not stamped until the money lands, so a test
  with an unpaid card booking correctly produces nothing. Test with a free booking or one
  on invoice terms.

Not testable from the review container: no production credentials, and outbound access to
both the site and the Worker is blocked. It needs someone holding the admin key.

### Refs 109 and 72 - what is needed to test the member tiers on production

Same answer for both. Four things, in order:

1. **Deployment is no longer the blocker.** Sunday's build is live on both the Worker and
   the theme, so a failure from here is attributable to configuration or data rather than
   to a build gap.
2. **Test contacts on the production portal, one per tier**: Corporate Gold, Corporate
   Silver, Industry Supplier, Bronze, an individual member and a guest. Set the company
   association and tier properties the way real member records carry them, and include at
   least one contact with **no primary company association** - that is the population that
   broke.
3. **Confirm the Worker's membership mapping for portal 441838610**:
   `membership_status_property`, `membership_level_property`, `member_category_property`,
   `membership_value_maps`. A tier read off the wrong property is the exact fault behind
   109, and it is configuration, so no amount of code parity settles it.
4. **Read the diagnostic before Jay clicks anything**:

   ```
   GET /api/v1/manage/diagnostics/pricing?email=<test contact>&eventId=<event>
   ```

   It returns what membership the Worker resolves, which contact properties it read that
   from, which HubDB row and column the price came off, and the cents it would charge -
   through the same functions `reserve` uses, so it cannot describe a different Worker
   from the one refusing the booking. Diagnostic first, booking second: that turns a
   failure from "it is broken again" into a named cause.

Two unmapped configurations will distort a member test even once the tiers resolve, and
neither is on the sheet:

- **Vouchers.** Weld's allowance lives in `vouchers_allowance` / `vouchers_used__training`;
  the Worker defaults to `vouchers_total` / `vouchers_used`, so every corporate allowance
  currently resolves to zero and no seat is ever covered. One PATCH to
  `/manage/onboarding/voucher-config`.
- **Schema scopes** went from optional to required. Weld authorised before that, so the
  portal must be re-authorised before property provisioning can create anything. **Map the
  voucher property names first, then provision** - an unconfigured provision creates empty
  duplicates beside the real allowance and reports success.

## The two questions for Weld

Both have the same shape: the system has no opinion, and nobody has written down who
does. That is the answer, and it is the gap.

### Where does the registration capacity number come from?

**Technically:** it is typed into the Event Engine when the session is created, at event
level and optionally per ticket type. The system refuses 0 or blank - genuinely uncapped
has to be ticked as unlimited on purpose - so someone has always made a positive
decision. The `seats_remaining` number in HubDB is the fallback whenever no successful
live read is available - a session the engine is not running, and equally an engine-backed
one whose availability request failed - so a stale zero in that column can still show a
live session as sold out during an outage.

**Instructionally:** there is no source. Nothing derives it from room size, trainer ratio
or accreditation limits; it is whatever the person creating the session types.

**Ask Weld:** who decides the number, and is it a property of the COURSE (an
accreditation capping a class at N) or of the SESSION (the room booked that week)? That
decides whether it should be a standing default per course or entered every time.

Worth mentioning on the call: a sell-out within 30 minutes of a session going live is
flagged for a human, on the reasoning that a placeholder capacity is far likelier than
that much demand. Advisory only - nothing is changed automatically.

### What drives "Register" online versus "Contact to book"?

**Technically:** a tickbox. `use_event_engine` on the HubDB row, effective only when
paired with a `worker_event_id`. Ticked and wired routes to the on-site checkout;
unticked sends the CTA to whatever sits in `registration_url` (TryBooking, hapily,
anything); neither falls back to the training team `mailto:`, which is what renders as
"Contact to book". There is also a reversible per-ticket-type pause.

**Instructionally:** again, no source. Whoever edits the row decides, and no rule is
written down anywhere.

**Ask Weld:** is there a policy - all public scheduled courses sell online, in-house and
custom by enquiry - or is it case by case? With a policy stated, `pnpm audit:event-engine`
can be held against it; today it can only report the state, not whether the state is what
anyone intended.

Ref 121 is this question from the other end: the SA Open Day row carries both a TryBooking
link and the tickbox, and the tickbox wins silently.
