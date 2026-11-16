# Hotel SaaS Platform

Multi-tenant hotel guest-services and operations SaaS. Product and engineering docs are in
[`hotel-saas-documentation/`](hotel-saas-documentation/README.md), which is the source of truth.

**Current status:** Phases 0–7 complete (foundation, SaaS & tenancy, hotel structure, QR codes & guest portal, service requests & realtime inbox, staff & RBAC & PWA, check-in/out & housekeeping, reports & billing) of
[`ROADMAP_AND_PHASES.md`](hotel-saas-documentation/07-delivery/ROADMAP_AND_PHASES.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Drizzle ORM · Neon PostgreSQL ·
Auth.js v5 (credentials, Argon2id) · Zod · Vitest + PGlite · Playwright · Ably realtime (REST + SSE, optional).

## Layout

```text
app/                 Routes: (auth) login/signup, (hotel-admin) dashboard/properties/settings/audit,
                     (saas-admin) platform console, r/[token] public guest portal, print/ QR sheets,
                     s/[token] guest request receipts, inbox (staff requests),
                     api/auth, api/health, api/inbox/marker, api/realtime/token, api/cron/outbox,
                     api/properties/…/qr downloads
auth.ts              Auth.js configuration
components/          UI primitives (components/ui) and shared form pieces
lib/                 auth, crypto (QR tokens, AES-GCM secrets), db (schema + client), permissions,
                     qr (image rendering), rate-limit, validation, observability, env
modules/             Domain services: tenants, properties, platform, audit, rbac,
                     rooms (floors, room types, rooms, status history), departments,
                     qr (room QR lifecycle), guest-portal (settings + public resolution),
                     services (catalogue), requests (guest submit, staff inbox, state machine, escalation),
                     realtime (outbox), staff (invitations, assignments, custom roles, profile),
                     stays (check-in/out), housekeeping (tasks, inspection, readiness),
                     billing (plans, subscriptions, limits, Razorpay webhooks), reports (metrics)
drizzle/             Generated SQL migrations (committed, reviewed)
scripts/             seed (RBAC sync), create-platform-admin
tests/               unit, integration (in-process Postgres via PGlite), e2e (Playwright)
```

## Local setup

1. `pnpm install`
2. `cp .env.example .env.local`, then fill in `DATABASE_URL` (Neon **pooled**), `DIRECT_URL` (Neon **direct**),
   `AUTH_SECRET`, `QR_TOKEN_PEPPER`, `ENCRYPTION_KEY` (each `openssl rand -base64 32`) and `APP_URL`.
   Use the **same** `QR_TOKEN_PEPPER` / `ENCRYPTION_KEY` everywhere that shares a database.
3. `pnpm db:migrate` applies the migrations in `drizzle/` through `DIRECT_URL`.
4. `pnpm db:seed` syncs permissions and system roles (idempotent; run after every deploy).
5. Optional SaaS operator: `PLATFORM_ADMIN_PASSWORD=... pnpm platform:admin --email you@example.com --name "You"`
6. `pnpm dev` and open http://localhost:3000.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` |
| `pnpm test` | Unit + integration tests (no network DB needed) |
| `pnpm test:e2e` | Playwright against `pnpm dev`. **Use a non-production Neon branch.** |
| `pnpm db:generate` | Generate a migration after changing `lib/db/schema` |
| `pnpm db:check` | Fails if schema and migrations are out of sync (CI) |
| `pnpm db:migrate` | Apply migrations (run once per release, never at runtime) |
| `pnpm db:seed` | Sync RBAC catalogue |

## Deployment (Vercel + Neon)

- Vercel project `hotel-qr-code-saas` is connected to this GitHub repo: every push to `main` deploys
  to production, and other branches get preview deployments.
- Functions run in `iad1` (`vercel.json`), next to the Neon database in `us-east-1`.
- Environment variables are managed in Vercel → Project → Settings → Environment Variables:
  `DATABASE_URL` (Neon integration, pooled), `DIRECT_URL`, `AUTH_SECRET` (separate per environment),
  `APP_URL` (production only; previews fall back to `VERCEL_URL`), `QR_TOKEN_PEPPER` and `ENCRYPTION_KEY`
  (identical in every environment that shares the database), optional `GUEST_PORTAL_URL`,
  `ABLY_API_KEY` (realtime; polling without it), `CRON_SECRET` (daily cron), and `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (payments; billing page explains when off).
- **Migrations are not run by the build.** Before pushing a schema change, run
  `pnpm db:migrate && pnpm db:seed` against the target database.
- Health check: `GET /api/health` returns `{"status":"ok"}` when the database is reachable.

## Hotel structure (Phase 2)

- Property → floors, room types, rooms, departments (`/properties/[id]/…` tabs).
- Rooms have three independent dimensions: **operational** (`active`, `out_of_order`, `maintenance`,
  `inactive`; needs `room.manage`), **housekeeping** (`clean`, `dirty`, `in_progress`, `inspected`, `blocked`;
  needs `housekeeping.manage`) and occupancy (derived from stays in Phase 6). Every change is logged in
  `room_status_history`.
- Room codes are unique per property (case-insensitive) among live rooms; archived rooms free their code.
- Composite foreign keys force rooms, floors, types and history rows to share one property and tenant.
- Bulk creation of up to 200 rooms per range, all-or-nothing.

## QR codes and guest portal (Phase 3)

- Every room gets a QR on creation (or via "Create missing codes"). The URL is `/r/<token>`, where the token
  is 32 random bytes (base64url). No room, tenant or guest id is in it.
- Storage: `token_hash` = HMAC-SHA256(`QR_TOKEN_PEPPER`, token) for lookup; `token_ciphertext` (AES-256-GCM,
  `ENCRYPTION_KEY`) so the same sticker can be reprinted. The plain token is never stored, logged or audited.
- **Replace** (needs `qr.rotate`) revokes the old code immediately and issues a new one, and rotated codes
  can never come back. **Deactivate/Reactivate** (`qr.manage`) pauses the same sticker.
- Public resolution uses only the token: active code, live room, active property, tenant not suspended or
  cancelled, portal enabled. Anything else is the same 404 "QR code isn't active" page, so the response
  gives no signal about which check failed. Scans are rate-limited per IP (invalid guesses included) and
  per code.
- **A QR scan is not guest authentication.** The portal shows only hotel-level content (branding, Wi-Fi,
  contact, stay times, info sections) and the room label. It never shows guest names, stays, invoices or
  request history. Stay-specific features will need a separate verification step.
- Wi-Fi password: AES-GCM encrypted at rest, write-only in the admin UI, shown only on that property's
  guest page. `/r/*` and `/s/*` responses are `no-store`, `noindex` and `Referrer-Policy: same-origin` (the
  token never leaves the site; same-origin is required so pre-hydration form posts keep a real `Origin`
  for Next's server-action CSRF check).
- Downloads: PNG/SVG per room, plus a printable sheet per floor (browser print, or "Save as PDF").

## Service requests and staff inbox (Phase 4)

- **Catalogue** (`/properties/[id]/services`, `service.manage`): standard set = drinking water (quantity),
  housekeeping (choices), reception, maintenance (choices, high priority) and a custom request (off by
  default, note required). Each service routes to a department and has optional hours (property timezone,
  overnight windows OK), target response time and a guest confirmation message.
- **Guest flow:** tile → `/r/<qr>/request/<service>` → server re-resolves the QR, validates service, hours
  and fields, then writes the request (with service/department/room **snapshots**), its first history row and
  an outbox event in **one transaction**. A hidden per-render `idempotencyKey` makes double taps and retries
  return the same receipt. Rate limits per IP and per room code.
- **Receipt:** `/s/<status token>` (random, HMAC-hashed at rest, expires after 72 h) shows guest-safe status
  wording only (`Request sent → Hotel team notified → Being handled → Completed`) plus the staff's guest
  message. Internal notes, staff names and other requests are never shown. Requests made on a device are
  remembered in that browser only, so the next guest in the room cannot see them.
- **Staff inbox** (`/inbox`): requests visible = `request.view` in the property **and** a role that covers the
  department (housekeeping → Housekeeping, room service → Room Service, maintenance, security; owners,
  managers and reception see all). Accept/Start/Complete/Cancel/Reopen follow
  `REQUEST_STATE_MACHINE.md`, run in a row-locked transaction, and record history; cancel/reopen need a
  reason and are audited. Assignment only to staff whose role covers the department. Overdue badges use the
  service's target time. Sidebar badge = new requests.
- **Realtime:** the outbox is published to Ably channels `hotel:<tenant>:<property>:<department>` after each
  change (and retried with exponential backoff, dead after 8 attempts). Browsers get a 1-hour,
  **subscribe-only** token for exactly their channels from `/api/realtime/token` and listen over SSE. The
  database stays the source of truth: the inbox polls `/api/inbox/marker` (every 10 s without realtime,
  60 s with it, and on focus/reconnect), so requests made during a provider outage or while a device was
  offline appear on reconnect. Without `ABLY_API_KEY` everything works on polling alone.
- Optional `/api/cron/outbox` (Bearer `CRON_SECRET`) sweeps retries; inbox polls also drain the outbox.
- Optional `/api/cron/outbox` also runs escalation (see Phase 5).

## Staff, roles and operations (Phase 5)

- **Staff** (`/staff`, `staff.view` / `staff.manage`): invite by link (no email provider yet, so the link is
  shown once to copy and share). Invites are random 32-byte tokens, HMAC-hashed, single use, 7-day expiry,
  revocable, one open invite per email. New people choose a password (policy enforced); existing accounts
  must enter their current password to join another hotel. Accepting creates membership + the invited role
  in one transaction and signs them straight into `/inbox`.
- **Role assignments** = role + optional property + optional **department**. An explicit department
  narrows any role to that department. Otherwise department roles imply their department, and owners,
  managers, reception and custom roles cover all departments of their properties
  (`lib/permissions/departments.ts`).
- **Guard rails** (`modules/staff/service.ts`, enforced on the server):
  - no privilege escalation: you can only grant roles, or build custom roles from, permissions you hold
    yourself for that scope;
  - nobody can change their own access;
  - you cannot change someone who holds access you don't;
  - the last tenant-wide owner cannot be removed or deactivated;
  - deactivation takes effect on that person's next request;
  - every change is audited.
- **Custom roles** (`/staff/roles`, `role.manage`): explicit permission picker; system roles are read-only;
  roles in use cannot be deleted; tenant-private.
- **Profile** (`/profile`): name, password change (bumps `session_version`, signing out every session) and
  notification preferences (sound on/off; alert for all requests or only those assigned to me).
- **Escalation:** services have "escalate if not accepted within target time" (default on). Overdue `new`
  requests are flagged once, logged in history and re-broadcast. The trigger is durable (inbox polls and
  `/api/cron/outbox`), never an in-memory timer. Escalated requests show a red badge in the inbox and sidebar.
- **Staff PWA:** `app/manifest.ts` ("Hotel Staff", opens `/inbox`), icons in `public/icons`, and
  `public/sw.js`. The service worker caches only `offline.html` and never caches pages or API data.
  Guests are never asked to install anything.
- **Permission matrix:** `tests/integration/permission-matrix.test.ts` runs every system role, tenant-wide
  and scoped to another property, against representative operations through the real services (127 cases).

## Check-in/out and housekeeping (Phase 6)

- **Not a reservation system** (no OTA/channel manager). Reception checks guests in and out at
  `/front-desk`; housekeeping works from `/housekeeping`.
- **Three separate room dimensions:**
  - operational status (stored);
  - housekeeping status (stored);
  - occupancy, which is **derived** from an active stay and never stored on the room.
- **Readiness** (`modules/housekeeping/readiness.ts`):
  - Out of service: not operational, or housekeeping status is blocked.
  - Occupied: the room has an active stay.
  - Otherwise by housekeeping status: dirty → needs cleaning; in progress → cleaning; clean with an
    open inspection task → awaiting inspection; inspected, or clean with no pending inspection → ready.
- **Check-in** (`stay.check_in`) is only allowed into a ready room. It locks the room row; a partial unique
  index allows at most one checked-in stay per room. Expected checkout is entered in the property's local
  time. The guest record is minimal (name, optional phone/email).
- **Check-out** (`stay.check_out`), in one transaction with the stay row locked:
  - the stay is closed with the actual time;
  - housekeeping status becomes `dirty` (with a history row);
  - **exactly one** cleaning task is created (partial unique index: one open task per room and type).

  A double checkout gets "already checked out" and no second task.
- **Housekeeping** (`housekeeping.manage`):
  - Start cleaning: the room becomes in progress.
  - Finish: the room becomes clean. If the property requires inspection (the default; managers toggle it
    on the board), an inspection task is created.
  - Pass: the room becomes inspected, i.e. ready.
  - Fail (reason required): the room becomes dirty again with a new cleaning task.

  Separation of duties: the person who cleaned a room cannot pass its inspection unless they hold
  `room.manage`.
- **No skipping the workflow:** setting a room clean/inspected by hand while it has open tasks is refused
  for housekeepers. Managers (`room.manage`) can override; the open tasks are cancelled and the override is
  audited.
- **Privacy:**
  - The readiness board and the room page show occupancy but never guest identity (only `stay.view` sees
    names).
  - Audit entries contain room codes and ids, never guest names or contact details.
  - The public QR portal never sees stays.

## Reports and billing (Phase 7)

- **Dashboard** ("Right now"): rooms, occupied, ready to sell, being turned, out of service, departures due,
  plus new/in-progress/overdue/escalated requests. Everything follows the user's property and department
  scope.
- **Reports** (`/reports`, `report.view` plus the plan's `reports` module): occupancy by night, check-ins
  and check-outs, request volume, acknowledgement/completion median and p90, missed targets by department,
  most-requested services, cancelled/reopened/escalated counts, housekeeping cleanings, average cleaning
  time, inspection pass rate, and staff workload.
  - Date ranges are property-local and capped at 92 days.
  - Metric definitions are in `modules/reports/service.ts` and on the page.
- **Plans** live in the `plans` table as structured entitlements: max rooms, properties and staff seats,
  plus modules.
  - `pnpm db:seed` inserts a starting catalogue once (never overwrites).
  - SaaS operators edit prices and limits at `/platform/plans`.
  - Code never hardcodes limits.
- **Limits are enforced on the server** (`assertWithinLimit`) inside the same transaction as the insert,
  with the tenant row locked. Concurrent creates cannot both slip under a limit.
  - Rooms: create, bulk create and restore.
  - Properties: create.
  - Staff seats: invite and reactivate. Open invitations reserve a seat.
- **Subscription lifecycle:**
  - Trial on the default plan.
  - Trial ends unpaid → `past_due` with a 7-day grace period (still fully working).
  - Grace ends → `suspended`: read-only, data kept, owners can still pay.
  - Cancelled → read-only.

  A SaaS operator "platform hold" keeps a tenant suspended whatever billing says. Operators can extend
  trials (audited). The daily Vercel cron `/api/cron/daily` (Bearer `CRON_SECRET`) runs the lifecycle
  sweep, escalation and outbox retries.
- **Razorpay:**
  - Checkout: the server creates the subscription from the plan's `razorpay_plan_id` and redirects the
    owner to Razorpay's hosted page. No amount comes from the browser, and no card data touches the app.
  - `/api/webhooks/razorpay` verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body, constant-time)
    and records the `x-razorpay-event-id` first, so replays are no-ops.
  - It applies a state change only if the event is newer than the last one applied.
  - It finds the subscription by **our** stored provider id, never by payload notes.
  - Receipts are deduplicated by payment id. Card and contact fields are never stored.
  - Webhook URL to register in Razorpay: `https://<domain>/api/webhooks/razorpay`. Events: subscription.*
    and payment.failed.

## Security model (Phase 1)

- **Tenant isolation:** the tenant always comes from the signed-in user's active membership
  (`requireTenantContext`), never from request input. Every query in `modules/*` filters by
  `ctx.tenantId`; other tenants' records return "not found". Composite foreign keys stop
  cross-tenant role/property links at the database level.
- **Authorization:** `authorize(ctx, permission, { propertyId })` in `lib/permissions/authorize.ts`.
  Deny by default; grants are the union of role assignments, optionally scoped to a property.
  Hidden UI is cosmetic only, because every service function re-checks.
- **Sessions:** Auth.js JWT in an HttpOnly cookie, re-validated against the DB on every request (user
  status + `session_version`), so a disabled user loses access immediately.
- **Login:** Argon2id hashes, same error for unknown email and wrong password, Postgres-backed rate limits
  per email and per IP.
- **Audit:** `audit_logs` records tenant creation, settings/property changes and platform suspend/reactivate,
  written in the same transaction as the change. Secret-looking metadata keys are dropped.
- **Headers:** CSP, frame-ancestors none, nosniff, HSTS, strict referrer policy (`next.config.ts`).
