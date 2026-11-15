# Product Requirements Document (PRD)

## 1. Product summary

A multi-tenant hotel SaaS for QR-based guest services and hotel operations. Each room receives a stable QR code. Scanning opens a branded mobile web page with hotel information, Wi-Fi details and service actions. Requests are persisted and routed to the correct hotel department, with staff notifications and guest-visible progress.

## 2. Scope

### MVP — must have
- SaaS platform operator access.
- Hotel tenant onboarding and tenant isolation.
- One or more properties per tenant (plan-controlled).
- Floors, room types and rooms.
- QR generation, preview, download, print layout, activation and revocation.
- Public guest portal resolved from an opaque QR token.
- Configurable hotel profile, branding, Wi-Fi details and service catalogue.
- Guest requests: water, housekeeping, reception, maintenance and custom request.
- Department routing and real-time staff inbox.
- Staff accounts, roles, permissions and department membership.
- Request acceptance, assignment, status update, completion and cancellation.
- Room occupancy state and check-in/check-out records.
- Housekeeping status and checkout-to-cleaning workflow.
- Audit log and basic dashboard/reports.
- Vercel deployment with managed PostgreSQL.

### Later releases
- Reservations and availability calendar.
- Restaurant menu/order and payment workflows.
- Laundry, spa, transport and concierge integrations.
- WhatsApp/SMS/email notifications.
- Native mobile apps.
- Multi-property consolidated analytics.
- PMS/channel-manager/OTA integrations.
- Advanced SLA automation and AI-assisted operations.

## 3. Functional requirements

### FR-01 Tenant onboarding
SaaS operator or self-service signup creates a tenant. Capture legal/business name, display name, primary admin, contact email, timezone, country, currency and plan. Tenant setup must be transactional or recoverable. A tenant cannot see another tenant's data.

**Acceptance:** a newly created tenant can log in, configure a property and cannot access another tenant by changing IDs in URLs or API payloads.

### FR-02 Property and room structure
Tenant admin can create properties, floors, room categories and rooms. Rooms have a unique room number/code within a property, capacity, category, operational status and optional notes.

**Acceptance:** duplicate room identifiers are rejected within the same property; room listings can filter by floor, category and status.

### FR-03 QR lifecycle
Generate a cryptographically random opaque token for each room QR. Store only a secure token hash where feasible; the printed QR contains a public URL with the opaque token. Admin can activate, revoke or rotate a token. Rotation invalidates the old QR. A room can have historical QR records.

**Acceptance:** QR resolves to the correct active room; revoked/unknown token displays a safe unavailable page; QR never contains sequential database IDs or guest PII.

### FR-04 Guest portal
Guest scans QR and sees hotel name/logo, room context, Wi-Fi details, opening hours, hotel information and enabled service tiles. No app installation or account is required for basic room services. Guest portal is responsive, accessible and localized-ready.

**Acceptance:** page loads on common mobile browsers; guest cannot enumerate other rooms or retrieve prior guest information.

### FR-05 Service requests
Guest selects a service, optionally chooses quantity/options and adds a short note. Server validates the service is enabled, room/QR is active and request rate limits. Request stores tenant, property, room, service, category, timestamps, status and routing snapshot.

**Acceptance:** one tap produces one durable request; duplicate submissions are guarded by idempotency; the UI shows confirmation only after persistence succeeds.

### FR-06 Staff notification and request handling
New request is routed to configured department and eligible staff. Staff receive in-app real-time notification and see it in a durable inbox. Authorized staff can accept, assign, start, complete, cancel with reason or reopen according to policy.

**Acceptance:** notification is delivered only to authorized users in the same tenant/property and relevant department; reconnecting staff can fetch missed requests from the database.

### FR-07 Guest progress
Guest sees a limited request receipt/status using a random request access token or short-lived guest session. Avoid exposing internal staff notes or personal data.

**Acceptance:** status lookup is scoped to the request token and reveals only guest-safe fields.

### FR-08 Staff and permissions
Tenant admin creates staff, assigns roles, departments and property scope. Permissions are enforced on the server for every operation, not only hidden in the UI.

**Acceptance:** a housekeeping user cannot access billing or tenant administration APIs without permission.

### FR-09 Check-in/check-out
Reception records guest/stay details, room, arrival and expected departure. Checkout records actual departure and creates a housekeeping task. Room is not marked ready until cleaning/inspection is complete.

**Acceptance:** occupancy and housekeeping states remain separate; checkout cannot silently mark a dirty room ready.

### FR-10 Housekeeping
Staff see tasks by room, priority and status. They can accept, start, complete and submit inspection if enabled. Manager can assign/reassign.

### FR-11 Dashboard and reports
Show current occupancy, vacant/occupied/blocked rooms, arrivals/departures, open requests by department, overdue requests and housekeeping readiness. Date range, property and department filters must respect tenant scope.

### FR-12 Configuration
Hotel admin manages branding, timezone, currency, Wi-Fi network/password, service catalogue, departments, notification preferences, operating hours and guest-facing content. Wi-Fi password must be protected at rest and only shown on the intended guest page.

### FR-13 Subscription
SaaS operator manages plans, limits, trial, active/suspended/cancelled states and billing provider references. Enforce plan limits server-side.

### FR-14 Audit
Record security-sensitive and operational actions with actor, tenant, target, action, timestamp and safe metadata. Do not store secrets or full payment credentials.

## 4. Non-functional requirements

- Security: tenant isolation, RBAC, secure sessions, CSRF protection where applicable, input validation, rate limiting, secure headers and secret management.
- Availability: design for graceful degradation if realtime provider is unavailable.
- Performance: optimize mobile guest portal; use pagination and indexes; avoid N+1 queries.
- Scalability: stateless application tier; tenant-aware data access; asynchronous provider integrations where required.
- Accessibility: keyboard support, labels, contrast and WCAG-informed touch targets.
- Observability: structured logs, error monitoring, request correlation IDs and health checks.
- Data protection: retention policy, export/deletion workflows and least-privilege access.
- Localization: timezone-aware timestamps and configurable currency; prepare strings for translation.

## 5. Critical business rules

- Room QR identifies a room context, not a person's identity.
- A room can have no active stay but still accept configured requests only if hotel policy allows it.
- Guest service requests must be linked to the room and tenant resolved from the QR on the server.
- The client must never choose or override `tenant_id` for public QR requests.
- Staff actions require authenticated user and server-side authorization.
- A completed request is immutable except through an audited reopen/correction flow.
- Room occupancy, room operational status and housekeeping status are distinct dimensions.
- Every date/time is stored in UTC and rendered in property timezone.
- Do not promise exact 2–3 second notification delivery; target near-real-time under normal connectivity and measure latency.

## 6. Out of scope for MVP

Full accounting, OTA/channel management, dynamic pricing, inventory procurement, payroll, smart lock access, identity document verification and native apps.
