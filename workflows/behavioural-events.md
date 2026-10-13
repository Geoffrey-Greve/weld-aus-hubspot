# HubSpot Custom Behavioural Events - Weld Australia

> **Owner:** Ryan Jones (frontend) + Olivier Maennel (CRM/workflows).  
> **Last updated:** 2026-05-22

This document lists every HubSpot Custom Behavioural Event the Weld Australia site fires, the properties attached to each, and the workflow triggers Ollie should wire off them.

---

## How events are fired

All events use the `_hsq` tracking queue injected by the HubSpot tracking script (via GTM). The client-side helper lives in `src/shared/api/events.ts`:

```ts
trackCustomEvent({
  name: 'event_internal_name',
  properties: {
    property_one: 'value',
    // …
  },
})
```

HubSpot associates the event to the identified contact via the cookie set by `hs.js`. Events appear on the contact's **Activity** timeline under **Custom Behavioural Events**.

---

## Events

### `resource_downloaded`

**Fired when:** a logged-in (or anonymous) user clicks the Download button on an unlocked resource card in the Resource Library.

**React location:** `src/modules/resource-library/ResourceLibrary.tsx` → `ResourceCard.handleDownload`

#### Properties

| Internal name | Type | Description | Example value |
|---|---|---|---|
| `resource_id` | `string` | HubDB row ID (`hs_id`) for the resource | `"42"` |
| `resource_title` | `string` | Title of the resource as stored in HubDB | `"AS/NZS 1665:2022 Summary Guide"` |
| `member_tier_at_download` | `string` | Value of `contact_membership_tier` at the moment of download, or `"anonymous"` if the visitor is not identified | `"Corporate Gold"` / `"Individual"` / `"anonymous"` |
| `file_type` | `string` | HubDB `file_type` select value | `"pdf"` / `"video"` / `"link"` |

#### HubSpot setup steps (Ollie)

1. In **Settings → Events → Custom Behavioural Events**, create a new event named exactly:  
   `resource_downloaded`

2. Add the four properties above with the types shown. Use **Text** for all four (they are always sent as strings).

3. Set `resource_id` as the **primary property** for deduplication is not required - each download is a distinct event instance.

#### Suggested workflow triggers

| Workflow | Trigger condition | Action |
|---|---|---|
| **Resource download nurture** | `resource_downloaded` fired + `member_tier_at_download = "anonymous"` | Enrol contact in "Join Weld Australia" email sequence |
| **Engagement score boost** | `resource_downloaded` fired | Add +5 to Contact Score property |
| **Member content consumption tracking** | `resource_downloaded` fired + `member_tier_at_download != "anonymous"` | Log download count on Contact via calculated property or Slack notification to content team |

---

### `resource_locked_view`

**Fired when:** a locked resource card enters the viewport (Intersection Observer, 50 % threshold), once per card per page load.

**React location:** `src/modules/resource-library/ResourceLibrary.tsx` → `useLockedViewEvent`

#### Properties

| Internal name | Type | Description | Example value |
|---|---|---|---|
| `resource_id` | `string` | HubDB row ID for the locked resource | `"17"` |
| `category` | `string` | Resource category slug | `"standards"` |

#### HubSpot setup steps (Ollie)

1. Create event: `resource_locked_view`
2. Add `resource_id` (Text) and `category` (Text) properties.

#### Suggested workflow triggers

| Workflow | Trigger condition | Action |
|---|---|---|
| **Membership upgrade prompt** | `resource_locked_view` fired ≥ 3 times in 7 days | Send "Unlock all resources" email |

---

### `member_discount_applied`

**Fired when:** a logged-in member reaches Step 3 of the Checkout Tunnel and a member discount is shown.

**React location:** `src/modules/checkout-tunnel/CheckoutTunnel.tsx`

#### Properties

| Internal name | Type | Description | Example value |
|---|---|---|---|
| `session_id` | `string` | HubDB course session ID | `"course-123-syd-aug"` |
| `course_name` | `string` | Course title | `"AS1796 Cert 10"` |
| `member_tier` | `string` | Contact's membership tier | `"Corporate Silver"` |
| `discount_amount` | `string` | Discount applied in AUD (string to avoid float issues) | `"150.00"` |

#### HubSpot setup steps (Ollie)

1. Create event: `member_discount_applied`
2. Add properties as listed above (all Text).

---

### `corporate_bulk_registration`

**Fired when:** a Corporate Admin successfully submits the Bulk Register form in the Manage My Team panel.

**React location:** `src/modules/corporate-admin/` (pending build)

#### Properties

| Internal name | Type | Description | Example value |
|---|---|---|---|
| `company_id` | `string` | HubSpot Company ID of the admin's company | `"987654321"` |
| `session_id` | `string` | HubDB course session ID | `"course-456-mel-sep"` |
| `registrant_count` | `string` | Number of employees registered | `"5"` |

#### HubSpot setup steps (Ollie)

1. Create event: `corporate_bulk_registration`
2. Add properties as listed above (all Text; `registrant_count` is a numeric string).

---

## GTM / GA4 parallel events

The same user actions also fire GA4 events via GTM for analytics. See `CLAUDE.md §10.3` for the full list. The HubSpot events and the GA4 events are fired independently - no dependency between them.

| HubSpot event | Matching GA4 event |
|---|---|
| `resource_downloaded` | `resource_download` |
| `resource_locked_view` | `resource_locked_view` |
| `member_discount_applied` | `member_discount_applied` |
| `corporate_bulk_registration` | `corporate_bulk_registration` |
