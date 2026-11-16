# Hotel SaaS Platform

Multi-tenant hotel guest-services and operations SaaS. Product and engineering docs are in
[`hotel-saas-documentation/`](hotel-saas-documentation/README.md), which is the source of truth.

**Current status:** Phases 0–3 complete (foundation, SaaS & tenancy, hotel structure, QR codes & guest portal) of
[`ROADMAP_AND_PHASES.md`](hotel-saas-documentation/07-delivery/ROADMAP_AND_PHASES.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Drizzle ORM · Neon PostgreSQL ·
Auth.js v5 (credentials, Argon2id) · Zod · Vitest + PGlite · Playwright. Ably (realtime) arrives in Phase 4.

## Layout

```text
app/                 Routes: (auth) login/signup, (hotel-admin) dashboard/properties/settings/audit,
                     (saas-admin) platform console, r/[token] public guest portal, print/ QR sheets,
                     api/auth, api/health, api/properties/…/qr downloads
auth.ts              Auth.js configuration
components/          UI primitives (components/ui) and shared form pieces
lib/                 auth, crypto (QR tokens, AES-GCM secrets), db (schema + client), permissions,
                     qr (image rendering), rate-limit, validation, observability, env
modules/             Domain services: tenants, properties, platform, audit, rbac,
                     rooms (floors, room types, rooms, status history), departments,
                     qr (room QR lifecycle), guest-portal (settings + public resolution)
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
  (identical in every environment that shares the database), optional `GUEST_PORTAL_URL`.
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
  guest page. `/r/*` responses are `no-store`, `noindex` and `no-referrer`.
- Downloads: PNG/SVG per room, plus a printable sheet per floor (browser print, or "Save as PDF").

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
