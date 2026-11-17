import { sql } from "drizzle-orm";
import { customType, foreignKey, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { properties, tenants } from "./tenancy";

/** Postgres bytea <-> Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType: () => "bytea",
  toDriver: (v) => v,
  fromDriver: (v) => {
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Uint8Array) return Buffer.from(v);
    // Text form "\x…" (some drivers return hex strings).
    return Buffer.from(String(v).replace(/^\\x/, ""), "hex");
  },
});

/**
 * Hotel photos for the guest portal (logo, cover, gallery, service tiles). Images are resized
 * in the admin's browser and stored here (≤ 1.5 MB, JPEG/PNG/WebP only, never SVG), then served
 * from /media/{id} with immutable caching. Photos are public by design: only hotel pictures,
 * never guest documents.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").notNull(),
    /** logo | cover | gallery | service */
    kind: text("kind").notNull(),
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "media_assets_property_fk",
      columns: [t.propertyId, t.tenantId],
      foreignColumns: [properties.id, properties.tenantId],
    }).onDelete("cascade"),
    index("media_assets_scope_idx").on(t.tenantId, t.propertyId, t.kind, t.sortOrder),
  ],
);
