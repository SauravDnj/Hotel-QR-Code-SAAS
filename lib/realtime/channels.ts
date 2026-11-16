/**
 * Private staff channel per department (REALTIME_NOTIFICATIONS.md "Channel design").
 * Names are only ever built on the server from authorised ids; the browser never chooses
 * a channel name, it receives a token whose capability lists exactly its channels.
 */
export function departmentChannel(tenantId: string, propertyId: string, departmentId: string): string {
  return `hotel:${tenantId}:${propertyId}:${departmentId}`;
}

/** Thin event envelope: ids only. Clients re-fetch details through authorised pages. */
export interface RequestEvent {
  id: string;
  type: "service_request.created" | "service_request.updated";
  occurredAt: string;
  propertyId: string;
  requestId: string;
  departmentId: string;
  schemaVersion: 1;
}
