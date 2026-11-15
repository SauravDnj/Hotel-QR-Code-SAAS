# Roadmap and Delivery Phases

## Delivery approach

Build a production-minded MVP in vertical slices. Each phase must include UI, server logic, database migration, authorization, tests and documentation. Do not build all screens with mock data and postpone security/backend work.

## Phase 0 — Discovery and foundation
**Deliverables**
- Confirm brand, target hotel segment and MVP service list.
- Confirm tenancy/property model and pricing assumptions.
- Create repository, CI checks, code conventions and environments.
- Set up database, migrations, auth foundation and design tokens.
- Define threat model and tenant-scope test helpers.

**Exit criteria:** application deploys to preview and production; login works; database migration pipeline is documented.

## Phase 1 — SaaS and tenant foundation
**Deliverables**
- Tenant onboarding.
- SaaS operator console.
- Hotel owner account and membership.
- Property settings, timezone and currency.
- Tenant isolation and audit logging.

**Exit criteria:** automated cross-tenant denial tests pass.

## Phase 2 — Hotel structure
**Deliverables**
- Floors, room categories and rooms.
- Room list/grid, search and filters.
- Room operational and housekeeping statuses.
- Departments and service configuration foundation.

**Exit criteria:** hotel can configure its complete room inventory.

## Phase 3 — QR and guest portal
**Deliverables**
- Opaque QR token lifecycle.
- QR preview/download/bulk print.
- Guest portal branding.
- Wi-Fi details and hotel information.
- Public QR rate limits and guest-safe errors.

**Exit criteria:** real QR scan works on iOS and Android browsers and resolves only the correct room.

## Phase 4 — Service requests and realtime
**Deliverables**
- Guest request tiles and forms.
- Durable request creation and idempotency.
- Department routing.
- Staff inbox and authenticated realtime.
- Status lifecycle and guest progress.
- Outbox retry/fallback.

**Exit criteria:** request survives provider outage and appears in staff inbox after reconnect.

## Phase 5 — Staff roles and operations
**Deliverables**
- Staff invitations/accounts.
- RBAC and department/property scope.
- Staff PWA.
- Assignment, escalation and audit.
- Staff notification preferences.

**Exit criteria:** role/scope test matrix passes.

## Phase 6 — Check-in/out and housekeeping
**Deliverables**
- Guest/stay records.
- Check-in/check-out.
- Checkout-triggered cleaning task.
- Cleaning/inspection workflow.
- Room readiness board.

**Exit criteria:** a room cannot become ready simply because checkout was recorded.

## Phase 7 — Reporting and commercial billing
**Deliverables**
- Occupancy and service analytics.
- SLA/response reports.
- Plans, entitlements and usage limits.
- Razorpay integration and verified webhooks.
- Subscription lifecycle and invoices/receipts as scoped.

**Exit criteria:** plan limits enforced on server and payment events idempotent.

## Phase 8 — Pilot and hardening
**Deliverables**
- Pilot with one or more real hotels.
- QR print testing and room-by-room audit.
- Load, security and accessibility testing.
- Backup/restore rehearsal.
- Support and incident runbooks.
- Production launch checklist.

**Exit criteria:** pilot acceptance signed off; no unresolved critical/high security issues.

## Phase 9 — Expansion
- Reservations/availability calendar.
- Restaurant ordering and payment.
- Laundry/spa/concierge modules.
- WhatsApp/SMS and push escalation.
- Multi-property analytics.
- PMS/OTA/POS integrations.
- Native apps only if PWA limitations justify them.

## Definition of Done

A feature is done only when:
- requirements and edge cases documented;
- UI has loading/empty/error/success states;
- server validation and authorization implemented;
- tenant/property/department scope enforced;
- migrations reviewed;
- unit/integration/E2E tests added;
- logs and audit events considered;
- mobile and accessibility checked;
- docs and release notes updated;
- deployed to preview and accepted.
