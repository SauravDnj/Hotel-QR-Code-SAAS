# Prompt 09 — Vercel and Production Deployment

Read Vercel deployment, environment variables and operations runbook. Prepare:
- Vercel project configuration.
- Separate development/preview/production environment setup.
- Neon managed PostgreSQL connection and pooled runtime URL.
- Controlled migration pipeline.
- Auth callback URLs and trusted origins.
- Realtime provider, Blob, Razorpay and Sentry configuration.
- Domain and TLS setup guidance.
- CI checks: lint, typecheck, tests, build, migration validation.
- Preview and production smoke tests.
- No persistent local filesystem, always-on WebSocket server or in-memory job assumptions.
- Document rollback, backup and restore rehearsal.

Do not expose or commit real secrets. Use placeholders in `.env.example`.
