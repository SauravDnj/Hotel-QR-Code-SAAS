# Integration API (v1)

For PMS, channel-manager and POS connections. Available on plans with **Integrations**
(Professional and Enterprise by default; operators can change this at `/platform/plans`).

- **Base URL:** `https://<your-app-domain>/api/v1`
- **Auth:** `Authorization: Bearer hk_…`. Create keys in **Hotel settings → Integrations**.
  - A key is shown once and stored only as a hash.
  - A key can be limited to one property and to the scopes it needs.
  - Revoking a key takes effect immediately.
- **Rate limit:** 120 requests per minute per key. Over the limit you get `429` with `Retry-After: 60`.
- **Format:** JSON. Money is in integer **minor units** of the property currency (paise for INR). Dates
  are the property's local calendar dates `YYYY-MM-DD`; timestamps are ISO-8601 UTC.
- **Errors:** `{ "error": { "code", "message", "fields"? } }`.

  | Status | Meaning |
  |---|---|
  | 401 | Missing or invalid key |
  | 402 | Plan doesn't include the API |
  | 403 | The key lacks a scope, or the hotel is suspended |
  | 404 | Not found (also for other hotels' ids) |
  | 409 | Conflict (no availability, room occupied, already closed) |
  | 422 | Validation (`fields` lists the problems) |
  | 429 | Rate limited |

- **Same rules as the app:** every call runs the same server code as the staff screens: tenant and
  property scope, permissions, validation, availability rules and audit. Writes are audited as actor
  `api_key`.

## Scopes
| Scope | Grants |
|---|---|
| `rooms:read` | Rooms and their status |
| `reservations:read` | Bookings and availability |
| `reservations:write` | Create and cancel bookings (includes read) |
| `stays:read` | In-house stays (room, guest name, dates; no contact details) |
| `folio:write` | Post charges to the guest in a room (POS) |

## Endpoints
| Method & path | Scope | Notes |
|---|---|---|
| `GET /properties` | any | Properties the key can see |
| `GET /properties/{id}/rooms?page=` | rooms:read | 100 per page |
| `GET /properties/{id}/availability?from=&to=` | reservations:read | Free rooms per room type per night (≤ 62 nights) |
| `GET /properties/{id}/reservations?view=upcoming\|arrivals\|in_house\|closed&q=` | reservations:read | |
| `POST /properties/{id}/reservations` | reservations:write | See below |
| `POST /properties/{id}/reservations/{rid}/cancel` | reservations:write | Body `{ "reason"? }`, idempotent |
| `GET /properties/{id}/stays` | stays:read | Checked-in guests |
| `POST /properties/{id}/folio-charges` | folio:write | See below |

### Create a booking
```http
POST /api/v1/properties/{id}/reservations
{ "roomTypeId": "uuid", "roomId": "uuid (optional)", "guestName": "Asha Rao",
  "phone": "+91 90000 00000", "email": "a@example.com",
  "arrivalDate": "2026-12-01", "departureDate": "2026-12-03", "adults": 2,
  "source": "ota", "externalRef": "BKG-12345", "notes": "Late arrival" }
```
- `201`: `{ "data": { reservationId, code, … }, "duplicate": false }`.
- Repeating the call with the same `source` + `externalRef` returns the original booking with
  `200` and `duplicate: true`, so retries are safe.
- `409` when a night is sold out or the requested room is taken. Room types are never overbooked.

### Post a POS charge
```http
POST /api/v1/properties/{id}/folio-charges
{ "roomCode": "201", "description": "Restaurant bill #884", "amountMinor": 125000, "externalRef": "POS-884" }
```
- `201`: the charge is added to the stay currently checked in to that room.
- `409` when the room has no guest.
- `externalRef` is required. A retry with the same value returns the original charge (`200`, `duplicate: true`).
- A negative amount posts a refund or adjustment.

## Webhooks
Add endpoints in **Hotel settings → Integrations**.

- **Endpoint rules:** https only, port 443, no credentials, and no private or local hosts. The host is
  re-checked at every delivery.
- **Events:**
  - `reservation.created`, `reservation.updated`, `reservation.cancelled`, `reservation.no_show`;
  - `stay.checked_in`, `stay.checked_out`;
  - `request.created`, `request.completed`;
  - `ping` (test).
- **Thin payloads:** events carry identifiers, codes, dates, room codes and amounts, never guest names,
  contact details or notes. Call the API for details.

```json
{ "id": "uuid", "type": "reservation.created", "createdAt": "2026-11-17T08:00:00.000Z",
  "data": { "reservationId": "…", "code": "R7K3QXM", "propertyId": "…", "arrivalDate": "2026-12-01", … } }
```

Headers:
- `X-Webhook-Id`: the event id. Deduplicate on it, because a retry can deliver the same event twice.
- `X-Webhook-Event`
- `X-Webhook-Timestamp`: unix seconds.
- `X-Webhook-Signature: v1=<hex HMAC-SHA256(signing secret, "{timestamp}.{raw body}")>`

Verify the signature over the **raw** body with a constant-time comparison. Reject timestamps older
than 5 minutes.

**Delivery:**
- Answer `2xx` within 8 seconds.
- Anything else is retried with backoff (10 s doubling, up to 1 h, 8 attempts).
- Redirects are not followed.
- After 50 consecutive failures the endpoint is paused. Re-enable it in settings.

```js
// Node.js receiver
const expected = "v1=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-webhook-signature"]));
```
