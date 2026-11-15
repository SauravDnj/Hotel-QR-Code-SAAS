# Database Design

## Conventions

- PostgreSQL.
- UUID primary keys for externally referenced records.
- `created_at`, `updated_at` in UTC.
- Tenant-owned records include `tenant_id`.
- Use foreign keys and unique constraints.
- Soft delete only where recovery/audit requirements justify it; otherwise use explicit lifecycle status.
- Store money as integer minor units (e.g. paise) plus ISO currency code.
- Store timestamps as `timestamptz`.
- Never store plaintext passwords. Encrypt Wi-Fi secrets and other credentials at rest.

## Core entities

### SaaS and tenancy
- `tenants`: customer account, status, timezone, locale.
- `subscriptions`: provider, plan, status, period, provider IDs.
- `plans`: entitlements and limits.
- `properties`: hotel/branch profile and timezone.
- `floors`: floor name/number.
- `room_categories`: category, capacity, default amenities.
- `rooms`: room code, floor, category, operational status.

### Identity and access
- `users`: login identity.
- `tenant_memberships`: user-to-tenant membership and status.
- `roles`: tenant-scoped or system roles.
- `permissions`: stable permission keys.
- `role_permissions`: role-to-permission relation.
- `user_role_assignments`: membership, role, property/department scope.
- `departments`: housekeeping, reception, room service, maintenance, security.

### Guest and stay
- `guests`: minimal guest profile.
- `reservations`: optional booking record.
- `stays`: checked-in occupancy interval and room assignment.
- `guest_sessions`: short-lived guest session, token hash and expiry.

### QR and services
- `room_qr_codes`: room, token hash, status, issued/revoked timestamps.
- `service_categories`: guest-facing categories.
- `service_items`: service tile configuration, route department, fields and hours.
- `service_options`: optional selectable values.

### Operations
- `service_requests`: request details, room, service, status, priority, routing snapshot.
- `request_assignments`: staff assignment history.
- `request_status_history`: immutable status transition log.
- `notifications`: in-app notification inbox.
- `outbox_events`: durable events awaiting publication.
- `housekeeping_tasks`: cleaning/inspection tasks.
- `maintenance_tasks`: maintenance work orders.
- `room_status_history`: status history.
- `audit_logs`: actor and action history.

### Finance and reporting
- `invoices`, `invoice_items`, `payments`, `payment_webhook_events`.
- Aggregates/materialized views only when needed; source records remain authoritative.

## Key constraints and indexes

- Unique `(property_id, room_code)`.
- Unique active QR token hash.
- Unique idempotency key within tenant/endpoint scope.
- Index `(tenant_id, property_id, status, created_at)` on service requests.
- Index `(tenant_id, room_id, created_at)` on requests and stays.
- Index `(tenant_id, department_id, status, created_at)` for staff queues.
- Index `(tenant_id, property_id, stay_status, expected_checkout_at)` for arrivals/departures.
- Foreign keys should prevent orphaned rooms, requests and assignments.
- Use partial unique indexes where only one active stay per room is permitted.

## Suggested request fields

`service_requests`: id, tenant_id, property_id, room_id, service_item_id, department_id, guest_session_id nullable, public_reference, guest_access_token_hash, request_text, options_json, quantity, priority, status, assigned_to_user_id nullable, idempotency_key, submitted_at, acknowledged_at, started_at, completed_at, cancelled_at, created_at, updated_at.

## Transaction examples

### Guest request
- Validate QR and service.
- Insert request.
- Insert initial status history.
- Insert outbox event.
- Commit.
- Publish asynchronously.

### Checkout
- Lock active stay/room row.
- Mark stay checked out.
- Insert checkout history.
- Create housekeeping task.
- Set housekeeping status to dirty/needs cleaning.
- Commit.

## Data retention

Define retention by data category and applicable law/contract. Provide tenant export and deletion workflows. Retain financial/audit records only as long as required. Avoid retaining guest identity details longer than necessary.
