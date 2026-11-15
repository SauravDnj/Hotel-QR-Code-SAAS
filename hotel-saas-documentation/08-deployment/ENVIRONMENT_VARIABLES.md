# Environment Variables

Names are examples; adapt to selected libraries/providers. All secrets must remain server-side unless explicitly documented as public keys.

| Variable | Purpose | Secret? |
|---|---|---|
| `DATABASE_URL` | Pooled PostgreSQL runtime connection | Yes |
| `DIRECT_URL` | Direct database connection for migrations if ORM requires | Yes |
| `AUTH_SECRET` | Session/token signing secret | Yes |
| `AUTH_URL` / `NEXTAUTH_URL` | Canonical application URL if required by auth library | No |
| `APP_URL` | Canonical app URL | No |
| `GUEST_PORTAL_URL` | Guest QR canonical base URL | No |
| `QR_TOKEN_PEPPER` | Additional server-side token hashing secret if design uses pepper | Yes |
| `ENCRYPTION_KEY` | Secret encryption key or key reference | Yes |
| `ABLY_API_KEY` | Realtime server credential | Yes |
| `NEXT_PUBLIC_ABLY_CLIENT_KEY` | Only if provider explicitly supports a restricted public key | Depends |
| `PUSH_PUBLIC_KEY` | Web Push VAPID public key | No |
| `PUSH_PRIVATE_KEY` | Web Push VAPID private key | Yes |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob server credential | Yes |
| `RAZORPAY_KEY_ID` | Payment key identifier | Treat as sensitive |
| `RAZORPAY_KEY_SECRET` | Payment secret | Yes |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification secret | Yes |
| `SENTRY_DSN` | Error monitoring DSN | Usually public-ish; configure appropriately |
| `SENTRY_AUTH_TOKEN` | Source map upload token | Yes |
| `EMAIL_PROVIDER_API_KEY` | Transactional email provider | Yes |
| `SMS_PROVIDER_API_KEY` | SMS provider | Yes |
| `NODE_ENV` | Runtime mode | No |

## Rules

- Never commit `.env`, `.env.local` or production secrets.
- Provide `.env.example` with placeholder values only.
- Never prefix a secret with `NEXT_PUBLIC_`.
- Rotate secrets after suspected exposure.
- Use separate keys for development, preview and production.
- Validate required variables at startup/build with clear non-secret error messages.
- Avoid printing environment values in logs.
