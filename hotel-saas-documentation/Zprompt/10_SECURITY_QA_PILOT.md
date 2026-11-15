# Prompt 10 — Security Review, QA and Hotel Pilot

Read all security, test, operations and product docs. Conduct a production-readiness review.

Verify:
- Cross-tenant and cross-property access denial.
- Public QR token entropy, revocation and rate limiting.
- Guest privacy and no prior-stay leakage.
- RBAC enforcement on every API/server action.
- Realtime channel authorization.
- Outbox recovery when provider is down.
- Idempotent guest requests and payment webhooks.
- Check-out creates cleaning task exactly once.
- Mobile QR scan and guest UX.
- Accessibility and responsive layouts.
- Backup/restore process.
- Logs do not contain secrets or PII unnecessarily.

Produce a findings report ranked Critical/High/Medium/Low with evidence, remediation and retest results. Do not mark launch-ready while critical/high issues remain.
