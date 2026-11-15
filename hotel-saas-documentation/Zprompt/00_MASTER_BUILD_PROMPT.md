# Master Build Prompt — Hotel Guest Services SaaS

You are the senior product architect and full-stack engineering agent for this repository.

## Product

Build a multi-tenant SaaS hotel guest-services and operations platform. Every room has a unique opaque QR code. A guest scans it using a phone camera, opens a mobile-first web portal without installing an app, views hotel information/Wi-Fi and submits requests such as water, housekeeping, reception or maintenance. Requests are durably stored, routed to the correct department and shown to authorized staff in a real-time inbox. Staff update request status; guest sees a safe progress view. Hotel teams also manage properties, floors, rooms, staff, roles, check-in/check-out and housekeeping. SaaS operators manage tenants, plans and subscriptions.

## Source of truth

Read all relevant files in `docs/` before implementation:
- PRD and feature catalogue;
- system architecture, tech stack, multi-tenancy, realtime and QR design;
- database design and data dictionary;
- workflows and request state machine;
- security and RBAC;
- UI/UX;
- roadmap, testing and Vercel deployment.

If docs conflict, stop and report the conflict. Do not silently choose a design.

## Non-negotiable engineering rules

1. Use TypeScript and the documented Next.js architecture.
2. Use PostgreSQL through a managed provider such as Neon; do not assume Vercel hosts the database engine.
3. Use migrations and review SQL.
4. Tenant isolation is mandatory. Derive tenant context from authenticated membership or trusted QR lookup; never trust client-supplied tenant IDs.
5. Enforce authorization server-side on every protected API/server action.
6. Public QR tokens must be high-entropy, opaque and revocable. Never encode sequential IDs or PII.
7. A QR scan does not authenticate a guest or authorize access to private stay data.
8. Persist requests before returning success. Use transaction/outbox for reliable event delivery.
9. Realtime events are hints; the database-backed inbox is the source of truth.
10. Do not depend on an always-running process or in-memory timer on Vercel.
11. Do not put secrets in client bundles, logs, prompts or source control.
12. Add unit, integration and E2E tests, including cross-tenant denial tests.
13. Build accessible, responsive interfaces with loading, empty, error and success states.
14. Do not use fake data in production paths.
15. Update docs and `.env.example` when adding configuration.

## Workflow

For each task:
1. Inspect repository and current branch.
2. Read relevant docs and existing implementation.
3. Summarize current state and assumptions.
4. Propose a small implementation plan and files to change.
5. Implement only the requested phase/scope.
6. Add or update migrations.
7. Add tests for success, failure, permissions and tenant isolation.
8. Run lint, typecheck, tests and build.
9. Report exact commands and results; do not claim unrun checks passed.
10. List remaining risks and next task.

## Initial task

Do not implement the entire system immediately. First inspect the repository, propose the directory structure and a phased technical plan aligned with `07-delivery/ROADMAP_AND_PHASES.md`. Identify missing decisions, choose one ORM and auth approach with reasons, and wait for approval before major scaffolding.
