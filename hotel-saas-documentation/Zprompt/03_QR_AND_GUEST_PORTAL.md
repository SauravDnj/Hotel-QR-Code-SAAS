# Prompt 03 — QR Lifecycle and Guest Portal

Read QR guest portal, security/privacy, PRD and UI/UX docs. Implement:
- High-entropy random room QR token generation.
- Store token hash; never expose sequential IDs or PII.
- Activate, revoke and rotate QR tokens.
- Individual QR download and printable floor sheets.
- Public route resolves QR token server-side to room/property/tenant.
- Branded mobile guest portal.
- Hotel info, Wi-Fi SSID/password and configurable service tiles.
- Rate limits and safe revoked/invalid QR page.
- No previous guest or private stay data in public response.
- QR and portal tests on mobile-sized viewports.

Do not treat QR scan as guest authentication. Add documentation and tests for that boundary.
