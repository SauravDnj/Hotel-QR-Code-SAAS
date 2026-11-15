# Real-Time Notifications

## Goals

- Notify relevant staff quickly when a guest request is created.
- Prevent cross-tenant or unauthorized notification delivery.
- Preserve requests if realtime provider or a staff device is offline.
- Allow staff to recover missed work after reconnecting.

## Event flow

1. Guest submits request.
2. Server validates QR, active service, request fields and rate limits.
3. Server writes request, routing snapshot and outbox event in one transaction.
4. Server returns receipt only after commit.
5. Outbox publisher sends an event to the realtime provider.
6. Authorized staff clients receive event and refresh request details from API.
7. Staff actions update database and publish status events.
8. Guest portal polls or subscribes to a guest-safe request status channel.

## Event envelope

```json
{
  "id": "uuid",
  "type": "service_request.created",
  "occurredAt": "2026-01-01T12:00:00Z",
  "tenantId": "internal-tenant-id",
  "propertyId": "internal-property-id",
  "requestId": "internal-request-id",
  "departmentId": "internal-department-id",
  "schemaVersion": 1
}
```

Do not put guest name, phone, Wi-Fi password, access token or sensitive notes into broad broadcast payloads. Clients fetch authorized details from the API.

## Channel design

Possible pattern:
- Private `tenant:{tenantId}:property:{propertyId}:department:{departmentId}` for eligible staff.
- Private `user:{userId}` for personal assignments.
- A random, short-lived guest channel/token scoped to one request, or polling for MVP.

Channel authorization endpoint must validate authenticated session and membership/permissions. Never trust channel names supplied by the browser.

## Delivery and latency

Target near-real-time delivery, commonly a few seconds under normal connectivity. Do not promise an exact 2–3 second SLA without provider, network and device guarantees. Measure:
- request committed to event published;
- event published to staff client received;
- request created to first acknowledgement;
- provider errors and retry counts.

## Fallbacks

- Persistent staff inbox backed by database.
- Refresh on reconnect and browser focus.
- Optional polling fallback.
- Sound alert only after user interaction/browser permission where required.
- Browser push is optional and requires explicit permission and service-worker setup.
- Email/SMS can be configured as escalation channels, not the only primary workflow.

## Escalation

Hotel-configured policy may escalate unaccepted requests after a threshold to supervisor/reception. Use a durable scheduler/queue, not an in-memory timer inside a serverless function.
