# Production-readiness security review (Phase 8)

Scope: `hotel-saas-documentation/Zprompt/10_SECURITY_QA_PILOT.md`. Reviewed code at the Phase 8 commit, production at
`https://hotel-qr-code-saas.vercel.app`, and the shared Neon database. Date: 2026-11-17.

**Verdict:** no open **Critical** findings. The one **High** finding (operators had no MFA) is fixed and retested.
Two **Medium** findings need owner action before real hotel data goes in: F3 (previews share the production
database) and F8 (database password exposure). See "Open items".

## Findings

| # | Severity | Finding | Status | Evidence / remediation | Retest |
|---|---|---|---|---|---|
| F1 | **High** | SaaS operators (full platform power) signed in with a password only. `SECURITY_PRIVACY.md` requires MFA for operators. | **Fixed** | TOTP two-step sign-in (RFC 6238, `lib/auth/totp.ts`). `requirePlatformAdmin` redirects to enrollment until it is enabled. Codes cannot be replayed (step claimed atomically). Enabling, disabling or resetting signs out all sessions. Optional for hotel staff via `/account/security`. | `tests/unit/totp.test.ts` (RFC 6238 vectors, drift, replay); `tests/integration/hardening.test.ts` (password alone refused, replay refused, operators can't disable) ✅ |
| F2 | Medium | No account recovery. A locked-out owner had no supported path back in, which invites unsafe workarounds. | **Fixed** | Operator-created one-time reset links: HMAC-hashed, 1 hour, single use, supersede older links, audited. Lost-authenticator reset (not for your own account). `/platform/support`. | `hardening.test.ts` ✅ |
| F3 | Medium | Vercel **Preview** deployments use the **production** database (`VERCEL_DEPLOYMENT.md`: "never point preview deployments at production data"). | **Open, owner action** | Previews are behind Vercel deployment protection (team login), which limits exposure. Fix: enable Neon branching for previews in the Vercel–Neon integration, or remove `DATABASE_URL` from the Preview scope. | n/a |
| F4 | Medium | Guest personal data had no retention limit. | **Fixed** | Daily cron anonymises guest name/phone/email 180 days after the last checkout and clears guest-typed request notes. Stays and statistics are kept. `modules/privacy/retention.ts`. | `hardening.test.ts` (old anonymised, recent and in-house kept, idempotent) ✅ |
| F5 | Medium | Owners could not export their data, but the suspension policy promises access to data. | **Fixed** | `/settings` → Download export (`tenant.manage`). JSON of all hotel records with **no credentials or secrets**: no password/token hashes, MFA secrets, Wi-Fi password or ciphertexts. Rate-limited (5/hour) and audited. | `hardening.test.ts` (no secret keys, own tenant only, managers refused, audited) ✅ |
| F6 | Low | Client IP for rate limits came from the first `X-Forwarded-For` entry. Vercel overwrites XFF, so this was not exploitable on Vercel, but it would be fragile behind another proxy. | **Fixed** | Prefer `x-real-ip` (set by Vercel's edge); XFF only as a fallback. | `totp.test.ts` › client IP ✅ |
| F7 | Low | `rate_limits` table grew without bound. | **Fixed** | Daily cron deletes windows older than 2 days. | `hardening.test.ts` ✅ |
| F8 | Medium | The Neon database password was pasted into a chat during setup (2026-11-15). | **Open, owner action** | Rotate it in Neon (the Vercel integration updates its own variables), then update `.env.local`. | n/a |
| F9 | Low | `script-src 'unsafe-inline'` in the CSP (Next.js inline bootstrap). | Accepted | Mitigations: React escaping everywhere; no `dangerouslySetInnerHTML`, `eval` or `sql.raw` in app code (grep, 2026-11-17); strict `default-src`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Nonce-based CSP is the follow-up. | Live headers checked with `curl -I` ✅ |
| F10 | Low | QR, status, invite and reset links carry a bearer token in the URL path, so it appears in Vercel request logs. | Accepted | Tokens are 256-bit, hashed at rest, revocable/expiring; pages are `no-store`, `noindex`, `Referrer-Policy: same-origin`. Restrict log access; rotate QR on suspicion (runbook). | — |
| F11 | Low | Signup reveals whether an email already has an account. | Accepted | Signup is IP rate-limited (5/hour); login and invites don't enumerate. | — |
| F12 | Info | Realtime (Ably) and email provider are not configured. | Known | Inbox works by polling; invites/resets are copy-link. | — |

Also fixed during this review:
- **Accessibility:** inline links relied on colour alone (`link-in-text-block`, serious), now underlined; `aria-pressed` was on a link (critical), now `aria-current`.
- **Earlier, in Phase 4:** a guest form posting before hydration got `Origin: null` because of `no-referrer`, which broke Next's CSRF check. Now `same-origin`.

## Verification matrix (Zprompt 10)

| Requirement | Evidence |
|---|---|
| Cross-tenant and cross-property denial | `tests/integration/tenant-isolation.test.ts`, `permission-matrix.test.ts` (7 roles × 22 operations, plus "other property" scope), the isolation sections of every module test, and E2E 404 checks for other tenants (rooms, QR, requests, staff) on production |
| QR token entropy, revocation, rate limiting | `qr-crypto.test.ts` (256-bit, uniqueness), `qr-portal.test.ts` (rotate kills old code, deactivate/reactivate, per-IP limit including invalid guesses), E2E rotation on production |
| Guest privacy, no prior-stay leakage | Portal returns an explicit allow-list (`qr-portal.test.ts` key list); status page excludes internal notes and staff names (`service-requests.test.ts`); device-local request history; board and room page hide guest names from housekeeping (`stays-housekeeping.test.ts`) |
| RBAC on every server action and API | Services call `authorize`/`requireProperty` themselves (UI hiding is cosmetic); `permission-matrix.test.ts` runs through the real services |
| Realtime channel authorization | Server-built channel list, subscribe-only tokens (`subscribableChannels`, `service-requests.test.ts`) |
| Outbox recovery with provider down | `service-requests.test.ts` (failing publisher → retry/backoff/dead-letter, request still in inbox); E2E staff offline → reconnect |
| Idempotent guest requests and payment webhooks | `service-requests.test.ts` (same key → one request); `billing.test.ts` (event replay, receipt dedupe, stale events) |
| Checkout creates the cleaning task exactly once | `stays-housekeeping.test.ts` (repeat and concurrent checkout; DB partial unique index) |
| Mobile QR scan and guest UX | E2E on a Pixel 7 viewport; real-device camera scan is a **pilot task** (see `docs/PILOT_PLAN.md`) |
| Accessibility and responsive layouts | `tests/e2e/accessibility.spec.ts`: axe WCAG 2.1 A/AA, 0 violations on guest (phone) and staff screens |
| Backup/restore | `pnpm backup` + `pnpm restore:check` rehearsal on production data, 2026-11-17: 31 tables, counts match, integrity clean (3.8 s). Neon PITR drill is a pilot task. |
| Logs free of secrets and PII | All `logger.*` calls log ids and error names/messages only; redaction of secret-looking keys (`lib/observability/logger.ts`); audit metadata never holds guest names (`stays-housekeeping.test.ts`) and drops secret keys (`sanitizeMetadata`) |
| Dependencies and secrets | `pnpm audit --prod`: **no known vulnerabilities** (2026-11-17). Git history secret scan: only `.env.example` placeholders matched. `.env.local` never committed. |

## Open items before real hotel data
1. **F8:** rotate the Neon password.
2. **F3:** separate the Preview database.
3. Every SaaS operator account enrolls two-step sign-in on first console visit (enforced).
