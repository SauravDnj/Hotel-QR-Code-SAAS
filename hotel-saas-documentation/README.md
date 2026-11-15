# Hotel SaaS Platform — Product & Engineering Documentation

**Status:** Product definition and implementation blueprint  
**Working product name:** Hotel SaaS Platform (final brand name is intentionally undecided)  
**Document version:** 1.0  
**Target deployment:** Vercel + managed PostgreSQL (recommended: Neon)

## Purpose

This repository contains the product requirements, system design, architecture, workflows, data model, security model, UI/UX guidance, delivery phases, testing strategy, deployment instructions, operations guidance, and AI coding prompts for a multi-tenant hotel guest-services and operations SaaS.

The core experience is a unique QR code in every hotel room. A guest scans it with their phone camera, opens a mobile web experience without installing an app, and requests services such as water, housekeeping, maintenance, or reception assistance. Hotel staff receive real-time, room-specific requests and update their progress. The same platform provides hotel administration, room inventory, staff/role management, check-in/check-out, reporting, and SaaS subscription management.

## Documentation map

| File | Purpose |
|---|---|
| `01-product/PRODUCT_VISION.md` | Product vision, users, value proposition |
| `01-product/PRD.md` | Detailed product requirements and acceptance criteria |
| `01-product/FEATURE_CATALOG.md` | Full feature catalogue and configurable services |
| `02-architecture/SYSTEM_ARCHITECTURE.md` | Logical architecture and deployment boundaries |
| `02-architecture/TECH_STACK.md` | Technology choices and rationale |
| `02-architecture/MULTI_TENANCY.md` | Tenant isolation and property model |
| `02-architecture/REALTIME_NOTIFICATIONS.md` | Real-time request and notification design |
| `02-architecture/QR_GUEST_PORTAL.md` | QR lifecycle and guest session design |
| `03-data/DATABASE_DESIGN.md` | Entities, relationships, indexes and data rules |
| `03-data/DATA_DICTIONARY.md` | Core table/field definitions |
| `04-workflows/CORE_WORKFLOWS.md` | End-to-end hotel and guest workflows |
| `04-workflows/REQUEST_STATE_MACHINE.md` | Request statuses and transitions |
| `05-security/SECURITY_PRIVACY.md` | Threat model, access control and privacy |
| `05-security/RBAC_PERMISSIONS.md` | Roles, permissions and scope |
| `06-ui-ux/UI_UX_GUIDELINES.md` | Design system and interface requirements |
| `07-delivery/ROADMAP_AND_PHASES.md` | Phases, dependencies and deliverables |
| `07-delivery/TEST_STRATEGY.md` | QA, automation and acceptance testing |
| `08-deployment/VERCEL_DEPLOYMENT.md` | Vercel, database, environment and release setup |
| `08-deployment/ENVIRONMENT_VARIABLES.md` | Environment variable reference |
| `08-deployment/OPERATIONS_RUNBOOK.md` | Monitoring, backup, incident and support runbook |
| `09-commercial/SAAS_BILLING.md` | Plans, metering and subscription lifecycle |
| `09-commercial/ANALYTICS_REPORTING.md` | Operational and commercial reporting |
| `Zprompt/README.md` | How to use the AI prompt pack |
| `Zprompt/00_MASTER_BUILD_PROMPT.md` | Master project instruction |
| `Zprompt/01_...` through `Zprompt/10_...` | Focused implementation prompts |

## Important product decisions

1. This is a **multi-tenant SaaS**, not a single-hotel application.
2. The QR guest portal is mobile-first and does not require an app installation.
3. A QR identifies a room/public room context, but does **not** prove the identity of the guest or authorize access to private stay information.
4. Guest-facing actions are configurable by each hotel and routed to departments/staff.
5. Requests have an auditable lifecycle: submitted, acknowledged/assigned, in progress, completed, and optionally cancelled/reopened.
6. Staff notifications are delivered through authenticated real-time channels, with a persistent in-app inbox as the source of truth. Browser push is an enhancement, not the only delivery mechanism.
7. Vercel hosts the web application and serverless/edge-compatible application endpoints. PostgreSQL is provided by a managed external database such as Neon; it is not a database engine hosted inside Vercel.
8. The first release focuses on room operations and guest requests. Advanced PMS, channel-manager, OTA, POS and accounting integrations are later scope unless explicitly approved.

## How to use

Read `01-product/PRD.md`, `02-architecture/SYSTEM_ARCHITECTURE.md`, and `07-delivery/ROADMAP_AND_PHASES.md` first. Then implement one phase at a time, keeping the acceptance criteria and security requirements in force. Use the `Zprompt` files as task prompts for an AI coding assistant; do not ask an agent to implement the entire system in one unreviewed operation.

## Non-goals for the first release

- Replacing a full enterprise Property Management System (PMS) with accounting, channel management and OTA integrations.
- Guaranteeing delivery within exactly 2–3 seconds under every network/provider condition.
- Exposing room Wi-Fi credentials or guest personal information to unauthenticated parties beyond the intended room QR context.
- Sending sensitive guest information in push-notification payloads.
