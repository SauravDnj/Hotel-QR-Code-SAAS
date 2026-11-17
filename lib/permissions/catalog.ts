/**
 * Stable permission keys from hotel-saas-documentation/05-security/RBAC_PERMISSIONS.md.
 * Keys are stored in the `permissions` table by the RBAC seed and must never be renamed
 * without a migration.
 */
export const PERMISSIONS = {
  "tenant.manage": "Manage tenant settings",
  "property.view": "View properties",
  "property.manage": "Create and update properties",
  "room.view": "View rooms",
  "room.manage": "Manage floors, categories and rooms",
  "qr.view": "View room QR codes",
  "qr.manage": "Generate and deactivate QR codes",
  "qr.rotate": "Rotate room QR codes",
  "guest.view": "View guest records",
  "guest.manage": "Manage guest records",
  "stay.view": "View stays",
  "stay.check_in": "Check guests in",
  "stay.check_out": "Check guests out",
  "reservation.view": "View reservations and the availability calendar",
  "reservation.manage": "Create, change and cancel reservations",
  "folio.view": "View guest bills (folios)",
  "folio.manage": "Post charges and record payments on guest bills",
  "request.view": "View service requests",
  "request.accept": "Accept service requests",
  "request.assign": "Assign service requests",
  "request.update": "Update service requests",
  "request.complete": "Complete service requests",
  "request.cancel": "Cancel service requests",
  "request.reopen": "Reopen service requests",
  "housekeeping.view": "View housekeeping tasks",
  "housekeeping.manage": "Manage housekeeping tasks",
  "maintenance.view": "View maintenance tasks",
  "maintenance.manage": "Manage maintenance tasks",
  "staff.view": "View staff",
  "staff.manage": "Manage staff accounts",
  "role.manage": "Manage roles and permissions",
  "service.manage": "Manage guest service catalogue",
  "report.view": "View reports",
  "billing.view": "View billing",
  "billing.manage": "Manage billing and subscription",
  "audit.view": "View audit log",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

const REQUEST_HANDLING: PermissionKey[] = [
  "request.view",
  "request.accept",
  "request.update",
  "request.complete",
];

export type SystemRoleKey =
  | "owner"
  | "manager"
  | "receptionist"
  | "housekeeping"
  | "room_service"
  | "maintenance"
  | "security";

export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { name: string; description: string; permissions: PermissionKey[] }
> = {
  owner: {
    name: "Hotel Owner",
    description: "All tenant permissions, excluding platform internals",
    permissions: ALL_PERMISSION_KEYS,
  },
  manager: {
    name: "Hotel Manager",
    description: "Property operations, staff oversight, reports and escalations",
    permissions: ALL_PERMISSION_KEYS.filter(
      (k) => !["tenant.manage", "billing.manage", "role.manage"].includes(k),
    ),
  },
  receptionist: {
    name: "Receptionist",
    description: "Room/stay operations, reception requests and guest support",
    permissions: [
      "property.view",
      "room.view",
      "qr.view",
      "guest.view",
      "guest.manage",
      "stay.view",
      "stay.check_in",
      "stay.check_out",
      "reservation.view",
      "reservation.manage",
      "folio.view",
      "folio.manage",
      ...REQUEST_HANDLING,
      "request.assign",
      "request.cancel",
      "housekeeping.view",
    ],
  },
  housekeeping: {
    name: "Housekeeping",
    description: "Housekeeping queue and assigned tasks",
    permissions: ["property.view", "room.view", "housekeeping.view", "housekeeping.manage", ...REQUEST_HANDLING],
  },
  room_service: {
    name: "Room Service",
    description: "Room-service requests",
    permissions: ["property.view", "room.view", ...REQUEST_HANDLING],
  },
  maintenance: {
    name: "Maintenance",
    description: "Maintenance queue and work orders",
    permissions: ["property.view", "room.view", "maintenance.view", "maintenance.manage", ...REQUEST_HANDLING],
  },
  security: {
    name: "Security",
    description: "Security and emergency requests",
    permissions: ["property.view", "room.view", ...REQUEST_HANDLING],
  },
};
