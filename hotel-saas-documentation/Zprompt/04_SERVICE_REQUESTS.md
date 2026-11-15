# Prompt 04 — Guest Service Requests

Read PRD, feature catalogue, request state machine, database and security docs. Implement configurable service items and guest request submission.

MVP services:
- Water bottle (quantity and optional note).
- Housekeeping / room cleaning.
- Reception assistance.
- Maintenance issue (category and note).
- Custom request where enabled by hotel.

Requirements:
- Server resolves room and tenant from active QR token.
- Server validates service enabled/hours and fields.
- Persist request, initial status history and outbox event in one transaction.
- Idempotency against double taps/retries.
- Return a random guest status token; store its hash.
- Guest status page shows only guest-safe information.
- Rate limiting, input limits and audit where appropriate.
- Tests for duplicate submissions, invalid QR, disabled service and tenant isolation.
