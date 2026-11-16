# Production launch checklist

Status legend: ✅ done · ⏳ needs the owner · ➖ optional

## Platform & data
- ✅ Production on Vercel (`iad1`) next to Neon (`us-east-1`); `/api/health` monitored.
- ✅ Migrations 0000–0007 applied; plans seeded.
- ✅ Logical backup + restore rehearsal passed (2026-11-17).
- ⏳ **Rotate the Neon database password** (exposed in chat during setup).
- ⏳ **Separate the Preview database** (Neon branching in the Vercel integration).
- ⏳ Run a Neon point-in-time restore drill (see `docs/RUNBOOK.md`).
- ⏳ Store `QR_TOKEN_PEPPER`, `ENCRYPTION_KEY`, `AUTH_SECRET` and `CRON_SECRET` in a password manager.
- ⏳ Delete E2E test hotels (`*@example.test`) before inviting real hotels.
- ➖ Custom domain (e.g. `app.yourbrand.com`) **before printing QR codes**: QR URLs embed the domain. Set `GUEST_PORTAL_URL`.

## Security
- ✅ Security review `docs/SECURITY_REVIEW.md`: no open Critical; High fixed.
- ✅ Two-step sign-in enforced for SaaS operators.
- ⏳ Each operator account: sign in → enroll two-step sign-in.
- ✅ `pnpm audit --prod` clean; no secrets in git history.
- ✅ Security headers live (CSP, HSTS, frame-ancestors none, nosniff).

## Integrations
- ⏳ Razorpay:
  1. Create plans in test mode.
  2. Paste the plan ids into `/platform/plans`.
  3. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`.
  4. Register the webhook.
  5. Make a test purchase.
  6. Switch to live keys only after that works.
- ⏳ Set real plan prices and limits at `/platform/plans`.
- ➖ Ably key (instant alerts; polling works without it).
- ➖ Email provider (invite/reset emails; copy-link works without it).
- ➖ Sentry or a Vercel log drain for alerting on `level:error`.

## Quality gates (all green at Phase 8)
- ✅ Lint, typecheck, migration check, build.
- ✅ Unit and integration tests, including a role/scope permission matrix.
- ✅ E2E suite locally; phase smoke tests on production.
- ✅ Accessibility: axe WCAG 2.1 AA, 0 violations on all main screens.
- ✅ Load smoke: 0 errors at 10 concurrent clients (`pnpm load:smoke`).

## Pilot
- ⏳ Follow `docs/PILOT_PLAN.md` with one hotel. Sign-off by the hotel and the platform owner.
