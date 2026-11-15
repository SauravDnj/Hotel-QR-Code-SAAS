# Prompt 01 — Foundation, Authentication and Tenancy

Read the PRD, system architecture, multi-tenancy, security, RBAC and database docs. Implement Phase 0 and Phase 1 only.

Requirements:
- Next.js TypeScript project conventions and shared UI foundation.
- PostgreSQL connection and migration setup.
- Authentication with secure sessions.
- Tenant, membership and owner onboarding.
- Tenant-aware authorization helpers and repository patterns.
- SaaS operator and hotel owner route protection.
- Audit log foundation.
- Environment validation and `.env.example`.
- Tests proving Tenant A cannot read or mutate Tenant B resources.

Before coding, report chosen ORM/auth strategy and migration approach. Do not build room or guest request modules in this task. Run lint, typecheck, tests and production build.
