# Security and Privacy Requirements

## Threats to address

- Cross-tenant data exposure through guessed IDs or API filters.
- QR token guessing, copying or misuse.
- Public guest portal used for spam or request flooding.
- Staff account takeover.
- Unauthorized role escalation.
- Realtime channel subscription to another hotel.
- Leaked Wi-Fi credentials or guest personal data in logs.
- Forged payment webhooks.
- XSS, SQL injection, CSRF, SSRF and insecure file uploads.
- Abuse of support impersonation.

## Controls

### Authentication
- Use a maintained authentication library/provider.
- Hash passwords with a modern password hashing algorithm if self-managed.
- Secure, HttpOnly, SameSite cookies; rotate sessions after login/privilege changes.
- Password reset tokens are random, hashed at rest and short-lived.
- Require MFA for SaaS operators and recommend it for hotel owners/managers.
- Rate-limit login, password reset and OTP endpoints.

### Authorization
- Deny by default.
- Check permission and tenant/property/department scope server-side.
- Never rely on hidden UI controls.
- Scope every database query.
- Validate realtime channel authorization.
- Use least privilege for support and integration accounts.

### Public QR
- High-entropy opaque token; store token hash.
- Rate-limit scans and submissions by token/IP/device signals.
- Validate active QR and service.
- Idempotency keys prevent accidental double taps.
- Do not expose guest history or room stay details.
- Provide safe error pages for revoked QR.
- Consider abuse detection and CAPTCHA only if needed; avoid adding friction to normal guests.

### Data protection
- TLS in transit.
- Encrypt secrets at rest; use managed secret/key facilities.
- Never log passwords, QR tokens, guest access tokens or payment secrets.
- Minimize guest PII; define retention and deletion.
- Restrict Wi-Fi credential access and support rotation.
- Separate guest-visible message from internal staff note.
- Use signed, expiring URLs for private files.

### Application security
- Validate all input on server with schema validation.
- Use parameterized ORM queries.
- Escape output and avoid unsafe HTML rendering.
- CSRF protections for cookie-authenticated state changes.
- Secure headers and restrictive Content Security Policy.
- Validate upload MIME type, size and file content; scan if required.
- Verify payment webhook signatures and idempotency.
- Keep dependencies patched and scan in CI.

## Privacy by design

- Room QR is not identity proof.
- Collect only guest details necessary for service fulfilment.
- Do not reveal previous guest name, stay dates, invoices or request history.
- Guest status token is scoped to one request and can be revoked/expire.
- Public portal must not index private guest or operational pages.
- Provide privacy notice and contact details.
- Establish retention, export and deletion procedures.

## Incident response

1. Detect and classify incident.
2. Contain affected account/token/integration.
3. Preserve logs without exposing secrets.
4. Assess tenant and data scope.
5. Rotate affected credentials/tokens.
6. Notify affected parties/regulators when legally required.
7. Document root cause and remediation.
