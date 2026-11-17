# Operations & support runbook

Implements `hotel-saas-documentation/08-deployment/OPERATIONS_RUNBOOK.md` for this codebase.
**Console:** `/platform` (tenants), `/platform/support` (health and recovery), `/platform/plans`. All operator actions are audited.

## Daily (5 minutes) — `/platform/support`
- **Realtime outbox:**
  - "Dead" or "Retrying" above 0 → see *Staff don't get live alerts*.
  - Oldest pending over 30 min → the cron or a poll isn't running.
- **Guest requests:** "Open past target" and "Escalated" growing → contact the hotel's manager.
- **Billing:**
  - past_due/suspended → follow up commercially;
  - failed webhooks above 0 → see *Payments*.
- **Vercel → Logs:** filter `level":"error"`. Every response carries an `x-vercel-id` header: ask users for it, and use it as the correlation id.
- **Vercel → Cron Jobs:** `/api/cron/daily` ran (it covers billing lifecycle, escalation, outbox and retention).

## Deploying
1. Run CI locally (`pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm build`).
2. Schema change:
   1. take a backup (`pnpm backup`);
   2. review the SQL in `drizzle/`;
   3. run `pnpm db:migrate && pnpm db:seed` against production **before** pushing.

   Migrations must be additive (expand, then contract).
3. Push to `main` → Vercel deploys. Check `/api/health`, then run the smoke E2E:
   `E2E_BASE_URL=https://… npx playwright test tests/e2e/front-desk.spec.ts --project=desktop-chrome`
   (production limits signups to 5 per IP per hour).
4. **Roll back:** use Vercel → Deployments → "Promote" the previous deployment. Additive migrations stay compatible.

## Backup & restore
- **Provider:**
  - Neon keeps point-in-time history; confirm the retention window on your plan.
  - **Drill quarterly:** restore a branch to a timestamp in the Neon console, point a local `.env.local` at it, run `pnpm restore:check` on a fresh `pnpm backup` of it, then delete the branch.
- **Logical:**
  - `pnpm backup` writes `backups/<time>/` (gitignored, contains personal data: store encrypted, delete after 30 days).
  - `pnpm restore:check backups/<time>` restores into a throwaway database and verifies counts and integrity.
  - Last rehearsal: 2026-11-17, PASSED.
- **RPO/RTO targets (proposed; agree with the business owner):** RPO 15 minutes (Neon PITR), RTO 2 hours.
- **Who may restore production:** the platform owner only. Record the reason in the incident log.
- **Keys:** `QR_TOKEN_PEPPER` and `ENCRYPTION_KEY` must match the restored data. Back them up separately (password manager). Without them, QR codes and Wi-Fi passwords cannot be read.

## Incident: guests cannot submit requests
1. `/api/health` → database reachable?
2. Open the room's QR on a phone:
   - "isn't active" → see *QR missing/compromised*;
   - "Please wait" → rate limit (120 scans/min per network; 10 requests/10 min per room).
3. Hotel → Property → Services: is the service shown, inside its hours, and is its department active?
4. Vercel logs: `guest_request_failed` (the guest saw "couldn't send", never a false success).
5. Workaround for reception: guests can call reception (the button is on the portal).

## Incident: staff don't get live alerts
1. The request is in `/inbox`? Then data is safe: the inbox polls every 10 s (60 s with realtime), so ask staff to keep the page open or refresh.
2. `/platform/support` outbox: dead/retrying counts. Without `ABLY_API_KEY`, events are "skipped" by design.
3. Ably dashboard: key valid, status page. Token errors appear in logs as `realtime_token_failed`.
4. Staff member sees nothing at all? Check their role/department under Staff (role → department mapping, or an explicit department).
5. **Never** ask a guest to resubmit if the request exists (duplicate work).

## Incident: QR reported missing or compromised
1. Hotel staff: Room → **Replace code** (old sticker dies instantly) → Download/print → scan the new sticker on a phone.
2. Check Audit log for `qr.rotated` (who/when). If abuse is suspected, look at the room's recent requests.
3. Before launch, or after mass reprinting: QR codes page → **Start room-by-room audit**, scan every sticker, and confirm "N of N verified".

## Incident: suspected data exposure
1. Contain:
   - suspend the tenant (platform hold);
   - deactivate the staff account;
   - replace the QR codes;
   - rotate keys if needed.
2. Preserve: export Vercel logs for the window; take `pnpm backup`; do not delete audit rows.
3. Scope: which tenant, which tables, what time window (audit log, `x-vercel-id` in logs).
4. Notify the owner, legal and the affected parties as the law requires. Fix the problem and add a regression test before lifting the hold.

## Account recovery (`/platform/support`)
- **Forgot password:**
  1. Verify the person out of band: call the hotel's known number, or the owner confirms.
  2. Create a reset link (1 hour, single use) and send it privately.
- **Lost authenticator:** verify the person the same way, then "Reset two-step sign-in". They'll set it up again on next login.
- An operator cannot reset their own two-step sign-in; another operator must.

## Payments
- A webhook returning 503 means `RAZORPAY_WEBHOOK_SECRET` isn't set.
- A 400 means a bad signature (wrong secret, or not from Razorpay).
- Webhook replays are safe. If state looks wrong, compare the Razorpay dashboard subscription status with `/platform` and extend the trial as a bridge while reconciling.

## Data retention (automatic, daily)
- Guest name/phone/email are anonymised 180 days after the last checkout. Guest-typed notes are cleared after 180 days.
- Rate-limit counters older than 2 days are deleted.
- Hotels can export their data at any time (Settings → Download export).

## Support checklist (what to ask)
- **Ask for:**
  - hotel name (we look up internal ids ourselves);
  - approximate time and timezone;
  - the `x-vercel-id` from the error;
  - device and browser;
  - steps to reproduce.
- **Never ask for:**
  - passwords;
  - authenticator codes;
  - payment details;
  - QR/status/invite links in public channels;
  - guest identity documents.

## Phase 9 operations

### Reservations
- Bookings never exceed sellable rooms of a type. Rooms that are out of order or inactive are not sold.
  Taking rooms out of service can leave a night **over capacity**: the calendar shows "Full" or a
  negative free count. Move the guests to another type or put the room back in service.
- Late arrivals stay "Confirmed" until checked in, cancelled or marked no-show (from the arrival date).

### Guest bills and orders
- A room-charged order posts to the bill **when staff complete it**; cancelling voids it.
- Checkout with a balance needs "Check out with balance due" (audited with the amount).
- Card and UPI payments are taken on the hotel's own terminal; reception records them on the bill.

### Phone notifications and SMS/WhatsApp
- **Web Push needs `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`** (Vercel env).
  - Never change them casually: changing the keys invalidates every registered device, and staff must
    turn notifications on again.
  - iPhone: staff must add the app to the Home Screen first (iOS 16.4+).
- **SMS/WhatsApp escalations need the `TWILIO_*` variables.**
  - WhatsApp outside a 24-hour conversation window requires an approved template
    (`TWILIO_WHATSAPP_CONTENT_SID`).
  - Failures are logged as `escalation_message_failed`; the request is still escalated in the inbox.
- Push failures (`push_delivery_failed`) remove a device after 10 consecutive errors. Expired devices
  are removed at once.

### Integrations (API and webhooks)
- **Suspected key leak:** Hotel settings → Integrations → **Revoke** (immediate), then create a new key.
  Check the audit log for `api_key` actions.
- **Webhook failing:** the page shows the last status and error.
  - Deliveries retry with backoff.
  - After 50 consecutive failures the endpoint is paused; "Enable" resets it.
  - "Send test event" checks connectivity.
- "Refused: the host resolves to a private address" means the hotel's endpoint DNS points inside a
  private network. This is blocked by design.
- `/platform/support` → outbox "dead" counts include webhook jobs that exhausted their retries.
