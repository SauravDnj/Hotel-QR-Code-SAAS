# Hotel SaaS Platform

Multi-tenant hotel guest-services and operations SaaS. Product and engineering docs are in
[`hotel-saas-documentation/`](hotel-saas-documentation/README.md), which is the source of truth.

**Current status:** Phases 0–4 complete (foundation, SaaS & tenancy, hotel structure, QR codes & guest portal, service requests & realtime inbox) of
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
                     services (catalogue), requests (guest submit, staff inbox, state machine), realtime (outbox)
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
  `ABLY_API_KEY` (realtime; polling without it) and `CRON_SECRET`.
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
- Departments currently come from the staff member's role. Phase 5 adds explicit staff↔department
  assignment and staff invitations.

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
