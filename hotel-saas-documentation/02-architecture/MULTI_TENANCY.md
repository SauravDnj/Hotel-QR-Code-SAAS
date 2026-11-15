# Multi-Tenancy and Tenant Isolation

## Model

A tenant represents the hotel business/customer account. A tenant may own one or multiple properties depending on plan. Each property contains floors and rooms.

```text
Tenant
  ├── Subscription
  ├── Users / Roles / Departments
  └── Property
       ├── Floors
       ├── Room Categories
       ├── Rooms
       ├── QR Codes
       ├── Stays / Guests
       └── Service Requests / Tasks
```

## Mandatory isolation rules

1. Every tenant-owned row includes `tenant_id`, directly or through a strictly validated parent relationship.
2. Every authenticated request derives tenant scope from the authenticated membership/session, never from a client-supplied tenant ID alone.
3. Every query filters by tenant and, where applicable, property/department scope.
4. Every object lookup uses a scoped query; do not fetch by ID and authorize later as the only protection.
5. Public QR requests resolve tenant/property/room from the server-side QR record.
6. Realtime channels are authorized server-side and include tenant/property/department scope.
7. Background jobs and webhooks resolve tenant from trusted server-side records.
8. Add automated cross-tenant access tests for every module.

## Database options

For MVP, application-enforced tenant scoping with disciplined repositories and comprehensive tests is acceptable. PostgreSQL Row-Level Security (RLS) can provide defence in depth if connection/session context is set safely per transaction. If using RLS, ensure pooled connections cannot leak tenant session state; use transaction-local settings and test under concurrency.

## Tenant lifecycle

- `trialing`: tenant can use trial entitlements.
- `active`: normal operation.
- `past_due`: payment retry/grace policy.
- `suspended`: access restricted according to policy; preserve data.
- `cancelled`: subscription ended; data retained according to retention policy.
- `deleted`: only after verified deletion/retention workflow.

## Platform support access

SaaS support access must be explicit, limited, time-bound and audited. Avoid silent impersonation. Record support actor, tenant, reason, start/end and actions.
