# Data Dictionary (Core Fields)

This is a logical dictionary; final SQL types and naming should be confirmed in migrations.

| Entity | Important fields | Notes |
|---|---|---|
| tenants | id, name, slug, status, timezone, created_at | SaaS customer boundary |
| properties | id, tenant_id, name, address, timezone, currency, status | Hotel/branch |
| floors | id, tenant_id, property_id, name, sort_order | Scoped to property |
| room_categories | id, tenant_id, property_id, name, capacity, description | Room type |
| rooms | id, tenant_id, property_id, floor_id, category_id, room_code, operational_status | Unique room code per property |
| room_qr_codes | id, tenant_id, room_id, token_hash, status, issued_at, revoked_at | No raw token stored |
| users | id, email, password_hash/provider_subject, name, status | Identity |
| tenant_memberships | id, tenant_id, user_id, status | Membership boundary |
| roles | id, tenant_id nullable, name, is_system | System or custom role |
| permissions | id, key, description | Stable permission key |
| departments | id, tenant_id, property_id, name, status | Request routing |
| guests | id, tenant_id, name, phone/email nullable | Minimize personal data |
| stays | id, tenant_id, property_id, room_id, guest_id, check_in_at, expected_checkout_at, checked_out_at, status | Occupancy interval |
| service_items | id, tenant_id, property_id nullable, name, category_id, department_id, enabled, config_json | Tenant override/config |
| service_requests | id, tenant_id, property_id, room_id, service_item_id, department_id, status, priority, request_text, submitted_at | Operational work item |
| request_assignments | id, tenant_id, request_id, user_id, assigned_by, assigned_at, ended_at | Assignment history |
| request_status_history | id, tenant_id, request_id, from_status, to_status, actor_user_id, note, changed_at | Audit trail |
| notifications | id, tenant_id, recipient_user_id, type, reference_id, read_at, created_at | Durable inbox |
| outbox_events | id, tenant_id, event_type, payload, status, attempts, next_attempt_at | Reliable publishing |
| housekeeping_tasks | id, tenant_id, property_id, room_id, task_type, status, assigned_to, due_at | Cleaning/inspection |
| audit_logs | id, tenant_id nullable, actor_user_id, action, entity_type, entity_id, metadata, created_at | Security/operations |

## Status enums (suggested)

- Tenant: `trialing`, `active`, `past_due`, `suspended`, `cancelled`.
- Room operational: `active`, `out_of_order`, `maintenance`, `inactive`.
- Occupancy: derived from active stay; do not conflate with room cleanliness.
- Housekeeping: `clean`, `dirty`, `in_progress`, `inspected`, `blocked`.
- Request: see `04-workflows/REQUEST_STATE_MACHINE.md`.
- QR: `active`, `revoked`, `expired`.
- Subscription: provider-aligned states mapped into internal stable states.
