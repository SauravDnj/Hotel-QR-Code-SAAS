import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/types";
import { auditLogs, users } from "@/lib/db/schema";
import { authorize, type TenantContext } from "@/lib/permissions/authorize";

export interface AuditEntry {
  tenantId: string | null;
  actorUserId: string | null;
  actorType: "user" | "platform_admin" | "system";
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|hash|card|cvv|otp/i;

/** Drops metadata keys that look like secrets so they can never reach the audit table. */
export function sanitizeMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([k]) => !SECRET_KEY_PATTERN.test(k)));
}

/** Call with the same transaction as the change being audited. */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    tenantId: entry.tenantId,
    actorUserId: entry.actorUserId,
    actorType: entry.actorType,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: sanitizeMetadata(entry.metadata),
  });
}

export async function listTenantAuditLogs(
  db: Db,
  ctx: TenantContext,
  opts: { limit?: number; before?: Date } = {},
) {
  authorize(ctx, "audit.view");
  const limit = Math.min(opts.limit ?? 50, 200);
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      actorType: auditLogs.actorType,
      actorName: users.name,
      actorEmail: users.email,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.tenantId, ctx.tenantId),
        opts.before ? lt(auditLogs.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
