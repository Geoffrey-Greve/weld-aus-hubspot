# Corporate Team Management - Endpoint Contract

**Status (2026-08-03):**

| Issue | Feature | State |
|---|---|---|
| 35 | Bulk book team onto a course | **Implemented on staging path.** The corporate admin panel calls Event Engine `POST /api/v1/corporate/bulk-register`; the Worker verifies the admin/company/team in HubSpot, then reuses the standard Event Engine reservation/payment flow. |
| 8 | Add / remove team members | **Implemented.** The UI prefers same-origin HubSpot serverless when available, and falls back to the Event Engine corporate endpoints on staging where Design Manager serverless is unavailable. |

---

## Bulk booking (issue 35)

The corporate admin panel posts one request for the whole selected team:

```http
POST {worker}/api/v1/corporate/bulk-register
Headers: X-Portal-Id, Idempotency-Key
```

```json
{
  "portalId": "441838610",
  "companyId": "1234567",
  "actorContactId": "999",
  "sessionId": "42",
  "workerEventId": "evt_cert10_online",
  "ticketTypeId": "tt_member",
  "employeeIds": ["111", "222"],
  "session": {
    "courseName": "Welding Supervisor",
    "city": "Online",
    "startDate": "2026-08-20"
  }
}
```

Worker behaviour:

- Verifies the request portal matches `X-Portal-Id`.
- Re-reads HubSpot to confirm the actor contact is an Admin / Primary Admin for the submitted company.
- Confirms every selected employee contact is linked to the same company.
- Blocks missing emails, self/tampered team data, exhausted voucher allocations, and sessions without Event Engine IDs.
- Converts the selected employees into Event Engine `attendees[]`, with `hubspotContactId` attached to each attendee.
- Uses the existing Event Engine reservation/order flow so capacity, waitlist, idempotency, invoices, payment URLs, and free-ticket confirmations stay consistent with public checkout.
- Writes best-effort audit rows to D1.

Frontend outcomes:

- `reserved` means a paid group order was created; the client polls `/api/v1/orders/{id}` and shows the invoice/payment URL when available.
- `confirmed` means a free session was booked immediately.
- `waitlisted` means the session was full and the selected group was waitlisted.

Enablement is per session. A session is self-service bulk-bookable only when the HubDB `courses` row has a usable Event Engine event id and ticket type. Anything else keeps the mailto-the-office fallback.

---

## Add / remove employee (issue 8)

The browser write helper uses the safest available route:

1. Preferred: `POST /_hcms/api/corporate/{add-employee|remove-employee}` with HubSpot membership cookies.
2. Staging fallback: if HubSpot returns the known "no function configured" response, retry `POST {worker}/api/v1/corporate/{add-employee|remove-employee}`.

The Worker fallback is guarded by server-side HubSpot checks:

- actor must be Admin / Primary Admin for the submitted company;
- target employee must be linked to the same company;
- self-removal is blocked;
- removing Admin / Primary Admin contacts is blocked;
- contacts are not deleted, only the company association is removed;
- audit rows are written to D1 where possible.

### Browser paths

| Action | Preferred browser path | Staging fallback |
|---|---|---|
| Add employee | `POST /_hcms/api/corporate/add-employee` | `POST {worker}/api/v1/corporate/add-employee` |
| Remove employee | `POST /_hcms/api/corporate/remove-employee` | `POST {worker}/api/v1/corporate/remove-employee` |
| Bulk register | N/A | `POST {worker}/api/v1/corporate/bulk-register` |

---

## HubDB prerequisites for bulk booking

A `courses` row is bulk-bookable only when these columns are populated:

| Column | Purpose |
|---|---|
| `worker_event_id` | Event Engine event id used by the Worker |
| `member_ticket_type_id` | Preferred ticket type for corporate/team members |
| `non_member_ticket_type_id` | Fallback ticket type if no member type is configured |
| `use_event_engine` | Editorial opt-in; stale ids with the switch off still fall back to email |
| `status` | Must not be `Sold Out` / `Cancelled` |

Rows missing these values render the mailto fallback rather than a broken button.

---

## Notes

- Frontend fires `corporate_team_member_added` and bulk-registration GTM events.
- Voucher balance is read from Company `vouchers_total` / `vouchers_used`; the UI and Worker block selections that exceed a positive allocation.
- `employees_capped` is passed to the UI so large teams are flagged, not silently truncated.
- Do not test bulk live registration against real staff/admin contacts. Use one safe non-admin test contact/session first.
