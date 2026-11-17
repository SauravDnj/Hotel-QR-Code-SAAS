import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { apiKeys, properties, tenants } from "@/lib/db/schema";
import { generateQrToken, hashQrToken } from "@/lib/crypto/secrets";
import { conflict, notFound } from "@/lib/errors";
import { assertTenantWritable, authorize, type RoleGrant, type TenantContext } from "@/lib/permissions/authorize";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { nameSchema } from "@/lib/validation/common";
import { writeAudit } from "@/modules/audit/service";
import { assertModule } from "@/modules/billing/subscription";

/**
 * Integration API keys (Phase 9). A key belongs to the hotel (not a person), is limited to
 * scopes and optionally one property, and is shown exactly once. Only an HMAC of it is
 * stored. Requests made with a key are audited as actor "api_key".
 */

export const API_SCOPES = {
  "rooms:read": { label: "Read rooms and their status", permissions: ["property.view", "room.view"] },
  "reservations:read": { label: "Read bookings and availability", permissions: ["property.view", "room.view", "reservation.view"] },
  "reservations:write": {
    label: "Create, change and cancel bookings",
    permissions: ["property.view", "room.view", "reservation.view", "reservation.manage"],
  },
  "stays:read": { label: "Read in-house stays", permissions: ["property.view", "stay.view"] },
  "folio:write": { label: "Post charges to guest bills (POS)", permissions: ["property.view", "stay.view", "folio.view", "folio.manage"] },
} as const satisfies Record<string, { label: string; permissions: PermissionKey[] }>;
export type ApiScope = keyof typeof API_SCOPES;
export const API_SCOPE_KEYS = Object.keys(API_SCOPES) as ApiScope[];

const KEY_PREFIX = "hk_";
const MAX_ACTIVE_KEYS = 20;

const hashKey = (raw: string) => hashQrToken(`api-key:${raw}`);

export const apiKeySchema = z.object({
  name: nameSchema("Key name", 60),
  propertyId: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((v) => (v ? v : null)),
  scopes: z.array(z.enum(API_SCOPE_KEYS as [ApiScope, ...ApiScope[]])).min(1, "Choose at least one permission"),
});

export async function createApiKey(db: Db, ctx: TenantContext, raw: z.input<typeof apiKeySchema>) {
  authorize(ctx, "tenant.manage");
  assertTenantWritable(ctx);
  await assertModule(db, ctx.tenantId, "integrations");
  const input = apiKeySchema.parse(raw);
  if (input.propertyId) {
    const [p] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.tenantId, ctx.tenantId)));
    if (!p) throw notFound("Property not found.");
  }
  const active = await db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.tenantId, ctx.tenantId), isNull(apiKeys.revokedAt)));
  if (active.length >= MAX_ACTIVE_KEYS) throw conflict(`Up to ${MAX_ACTIVE_KEYS} active keys. Revoke an unused key first.`);
  const secret = `${KEY_PREFIX}${generateQrToken()}`;
  const row = await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(apiKeys)
      .values({
        tenantId: ctx.tenantId,
        propertyId: input.propertyId,
        name: input.name,
        prefix: secret.slice(0, 10),
        keyHash: hashKey(secret),
        scopes: [...new Set(input.scopes)],
        createdByUserId: ctx.userId,
      })
      .returning();
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "api_key.created",
      entityType: "api_key",
      entityId: k.id,
      metadata: { name: k.name, scopes: k.scopes, propertyId: k.propertyId, prefix: k.prefix },
    });
    return k;
  });
  return { key: row, secret };
}

export async function listApiKeys(db: Db, ctx: TenantContext) {
  authorize(ctx, "tenant.manage");
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      propertyId: apiKeys.propertyId,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(db: Db, ctx: TenantContext, keyId: string) {
  authorize(ctx, "tenant.manage");
  const id = z.uuid().safeParse(keyId);
  if (!id.success) throw notFound("Key not found.");
  await db.transaction(async (tx) => {
    const [k] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id.data), eq(apiKeys.tenantId, ctx.tenantId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!k) throw notFound("Key not found.");
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      actorType: "user",
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: k.id,
      metadata: { name: k.name, prefix: k.prefix },
    });
  });
}

export interface ApiPrincipal {
  keyId: string;
  ctx: TenantContext;
  scopes: ApiScope[];
}

/**
 * Resolves a presented key into a server-built context whose grants come ONLY from the key's
 * scopes and property. Unknown, malformed and revoked keys are indistinguishable (null).
 */
export async function authenticateApiKey(db: Db, presented: string | null | undefined, now: Date = new Date()): Promise<ApiPrincipal | null> {
  if (!presented || !/^hk_[A-Za-z0-9_-]{43}$/.test(presented)) return null;
  const [row] = await db
    .select({ key: apiKeys, tenantName: tenants.name, tenantStatus: tenants.status })
    .from(apiKeys)
    .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .where(and(eq(apiKeys.keyHash, hashKey(presented)), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  const scopes = row.key.scopes.filter((s): s is ApiScope => s in API_SCOPES);
  const grant: RoleGrant = {
    roleKey: "api_key",
    propertyId: row.key.propertyId,
    permissions: new Set(scopes.flatMap((s) => API_SCOPES[s].permissions as readonly PermissionKey[])),
  };
  // Throttle "last used" writes to one per minute per key.
  if (!row.key.lastUsedAt || now.getTime() - row.key.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.key.id));
  }
  return {
    keyId: row.key.id,
    scopes,
    ctx: {
      // Writes made through the API are attributed to the key (actor "api_key"), never to a person.
      userId: row.key.createdByUserId,
      membershipId: "",
      tenantId: row.key.tenantId,
      tenantName: row.tenantName,
      tenantStatus: row.tenantStatus,
      grants: [grant],
    },
  };
}
