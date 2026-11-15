# Vercel Deployment Guide

## 1. Target deployment

- Next.js application: Vercel.
- PostgreSQL: Neon managed database, connected securely.
- Realtime: Ably or Pusher.
- File storage: Vercel Blob.
- Payments: Razorpay.
- Monitoring: Sentry.

Vercel hosts the application. Neon is a separate managed database service that can be connected through Vercel Marketplace or environment variables. Do not describe PostgreSQL as running inside Vercel's application runtime.

## 2. Environments

Create separate:
- Local development.
- Vercel Preview (non-production database and provider credentials).
- Vercel Production (production database and provider credentials).

Never point preview deployments at production data by default.

## 3. Initial setup

1. Push repository to GitHub or GitLab.
2. Import repository into Vercel.
3. Select the correct Next.js framework preset.
4. Configure build command and output defaults unless project requires otherwise.
5. Create Neon project and database for each environment.
6. Add pooled runtime connection string and direct migration connection string as server-only environment variables.
7. Configure auth callback URLs and trusted origins.
8. Configure realtime provider keys and server-side authorization.
9. Configure Blob storage token.
10. Configure payment provider test keys first.
11. Configure Sentry DSN and source-map upload as appropriate.
12. Deploy Preview and run smoke tests.
13. Configure production domain and DNS.
14. Add production environment variables.
15. Run reviewed migrations.
16. Deploy production and run post-deploy checks.

## 4. Environment variable setup

Use `ENVIRONMENT_VARIABLES.md`. Add secrets through Vercel Project Settings → Environment Variables, not source control. Scope variables to Development, Preview or Production appropriately. Redeploy after changing environment variables.

## 5. Database migrations

- Commit migration files.
- Review generated SQL, especially destructive changes.
- Run migration once from CI/release workflow using direct connection where required.
- Do not run migrations from every serverless instance at runtime.
- Back up before risky migrations.
- Use expand-and-contract for schema changes requiring zero/low downtime.

## 6. Vercel considerations

- Serverless functions have execution/runtime limits; check current plan limits.
- Do not rely on in-memory sessions, local filesystem persistence or always-running workers.
- Use managed realtime provider rather than hosting a permanent WebSocket server in a serverless function.
- Use queues or scheduled jobs for durable background work.
- Use pooled database connections.
- Keep large reports paginated or pre-aggregated.
- Protect API routes and server actions; server actions are not automatically safe merely because they are server-side.
- Set cache rules carefully. Public hotel content may be cached; guest/session/private data must not be shared across users or tenants.
- Test preview deployment access and prevent indexing where appropriate.

## 7. CI/CD checklist

- Install with lockfile.
- Lint.
- Typecheck.
- Unit/integration tests.
- Build.
- Dependency/secret scan.
- Migration validation.
- Deploy preview.
- E2E smoke test.
- Production approval.
- Migration and production deploy.
- Post-deploy health check.

## 8. Custom domains

Suggested:
- `app.example.com` — staff and admin.
- `guest.example.com` — QR guest portal.
- `www.example.com` — marketing site.

A single Next.js project can route by hostname or path. Choose a simpler path-based route for MVP unless distinct domains are needed. Configure DNS and TLS in Vercel.

## 9. Production smoke tests

- Login and logout.
- Create tenant/property/room.
- Generate and scan QR.
- Load guest portal.
- Submit test request.
- Verify correct department inbox.
- Accept and complete request.
- Confirm guest-safe status.
- Confirm cross-tenant denial.
- Confirm payment webhook test in sandbox.
- Check logs and error monitoring.
