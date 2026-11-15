# Prompt 08 — Reports, Plans and Billing

Read SaaS billing, analytics, PRD and security docs. Implement:
- Hotel dashboard metrics with documented definitions.
- Occupancy, requests, department performance and housekeeping reports.
- Tenant/property scoped filters and pagination.
- Plans and structured entitlements.
- Server-side enforcement of room/property/staff limits.
- Razorpay sandbox integration only after server-side design review.
- Verified, idempotent payment webhooks.
- Subscription lifecycle and owner billing view.
- Tests for webhook replay, invalid signatures and entitlement enforcement.

Do not trust client-submitted amounts or subscription states. Do not store card data.
