# Role-Based Access Control (RBAC)

## Permission model

Use stable permission keys, for example:
- `tenant.manage`
- `property.view`, `property.manage`
- `room.view`, `room.manage`
- `qr.view`, `qr.manage`, `qr.rotate`
- `guest.view`, `guest.manage`
- `stay.view`, `stay.check_in`, `stay.check_out`
- `request.view`, `request.accept`, `request.assign`, `request.update`, `request.complete`, `request.cancel`, `request.reopen`
- `housekeeping.view`, `housekeeping.manage`
- `maintenance.view`, `maintenance.manage`
- `staff.view`, `staff.manage`
- `role.manage`
- `service.manage`
- `report.view`
- `billing.view`, `billing.manage`
- `audit.view`

## Suggested default roles

| Role | Typical permissions |
|---|---|
| SaaS Super Admin | Platform-wide tenant, plan and support operations |
| Hotel Owner | All tenant permissions, excluding platform internals |
| Hotel Manager | Property operations, staff oversight, reports and escalations |
| Receptionist | Room/stay operations, reception requests, guest support |
| Housekeeping | Housekeeping queue and assigned tasks |
| Room Service | Room-service requests |
| Maintenance | Maintenance queue and work orders |
| Security | Security/emergency requests |
| Custom Staff | Explicitly selected permissions |

## Scope

A role assignment should include:
- tenant membership;
- optional property scope;
- optional department scope;
- optional individual resource restrictions if required.

A user may have multiple assignments. Effective permissions are the union of permitted grants within the relevant scope, unless explicit deny policies are introduced. Keep the policy simple and testable.

## Example access rules

- Housekeeping can view room number and cleaning instructions for assigned property, but not guest billing.
- Room service can view request details needed to deliver service, not guest account history.
- Reception can check guests in/out and handle reception queue.
- Manager can reassign requests and view property reports.
- Owner can manage tenant settings, staff and subscription.
- SaaS super admin can access platform management; tenant data access for support requires audited support mode.

## Enforcement

Create centralized server-side authorization helpers such as `authorize(user, permission, resourceScope)`. API handlers and server actions must call them. Add tests for allowed and denied role/scope combinations.
