# Operations Runbook

## Daily operations
- Review error rate and failed requests.
- Review outbox backlog and realtime provider failures.
- Review overdue/unassigned service requests.
- Review failed payment webhooks.
- Review database health and connection usage.

## Monitoring metrics
- API latency and error rate.
- Guest QR page load time and QR resolution errors.
- Request creation success/failure.
- Outbox pending age and retry count.
- Realtime publish/receive latency.
- Staff acknowledgement and completion time.
- Database connection saturation and slow queries.
- Payment webhook failures.
- Subscription state mismatches.

## Backup and restore
- Confirm Neon backup/PITR capability and retention for selected plan.
- Define RPO/RTO with business owner.
- Perform periodic restore drills into a separate environment.
- Document who can initiate restore.
- Export tenant data on approved request.
- Never treat a provider's backup checkbox as a completed restore test.

## Incident: guests cannot submit requests
1. Check application health and database connectivity.
2. Check QR token resolution and active service configuration.
3. Inspect server logs using request correlation ID.
4. Confirm database transaction succeeds.
5. If realtime is down, confirm requests still persist and staff inbox can refresh.
6. Communicate temporary workaround to hotel reception.
7. Record incident and follow up.

## Incident: staff do not receive live alerts
1. Confirm request exists in database.
2. Check outbox pending/error state.
3. Check provider status and credentials.
4. Verify staff channel authorization and department membership.
5. Refresh staff inbox; do not ask guest to resubmit if request already exists.
6. Retry event publication safely using event ID.
7. Review latency and provider logs.

## Incident: QR reported missing/compromised
1. Verify room and QR record.
2. Revoke/rotate token.
3. Generate replacement QR and print.
4. Test new QR on device.
5. Review recent scan/request patterns.
6. Record actor and reason in audit log.

## Incident: suspected tenant data exposure
1. Trigger security incident process immediately.
2. Disable affected credentials/tokens or support access.
3. Preserve logs.
4. Identify affected tenant, records and time window.
5. Engage security/legal stakeholders.
6. Notify affected parties when required.
7. Patch and add regression tests before re-enabling.

## Support checklist
- Tenant ID and property ID (internal references only).
- Environment and deployment version.
- Approximate timestamp/timezone.
- Request correlation ID.
- QR status (never ask guest to send secret token publicly).
- Browser/device and steps to reproduce.
- Do not request passwords, payment secrets or guest identity documents over support chat.
