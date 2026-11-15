# Test Strategy

## Test layers

### Unit
- State transition validation.
- Permission calculation.
- QR token generation/hash/lookup.
- Service routing rules.
- Timezone and date formatting.
- Plan entitlement checks.

### Integration
- Tenant-scoped database queries.
- Guest request transaction and outbox creation.
- Check-in/out and housekeeping task creation.
- Realtime authorization.
- Payment webhook signature and idempotency.
- File access control.

### End-to-end
- Owner creates property, floor, room and QR.
- Guest scans QR, views Wi-Fi and submits water request.
- Staff in correct department receives request and completes it.
- Unauthorized staff cannot see or act on request.
- Reception checks in and checks out guest.
- Checkout creates cleaning task; room becomes ready only after inspection.
- Admin revokes QR; old QR no longer works.

## Critical security tests

- User A from Tenant A cannot read/update Tenant B data by changing IDs.
- Public QR cannot reveal guest identity or previous guest history.
- Guest request token cannot access another request.
- Staff cannot subscribe to another tenant's realtime channel.
- Housekeeping cannot call billing APIs.
- Suspended tenant cannot exceed configured access policy.
- Forged/duplicate payment webhook does not duplicate subscription changes.
- Rate limits prevent request flooding.

## Reliability tests

- Realtime provider unavailable: request still persists and staff inbox recovers it.
- Duplicate guest submission: idempotency prevents duplicate request.
- Browser reconnect: missed requests are fetched.
- Database transient failure: safe error shown; no false success.
- Outbox publish failure: retries and eventually dead-letter/alert.
- Concurrent checkout: no duplicate active stay or duplicate cleaning task.

## Browser/device matrix

Test current supported versions of Chrome, Safari and Edge, including mobile Safari and Android Chrome. Test QR scan from native camera apps. Validate small screens, poor network and permission-denied browser notification states.

## Release gates

- Typecheck and lint pass.
- Unit/integration/E2E critical tests pass.
- Dependency and secret scan pass.
- No unresolved critical/high security defects.
- Migration tested against staging snapshot.
- Rollback/forward-fix plan documented.
