CREATE TYPE "public"."department_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."housekeeping_status" AS ENUM('clean', 'dirty', 'in_progress', 'inspected', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."room_operational_status" AS ENUM('active', 'out_of_order', 'maintenance', 'inactive');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" "department_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_id_scope_unique" UNIQUE("id","property_id","tenant_id"),
	CONSTRAINT "departments_property_key_unique" UNIQUE("property_id","key")
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floors_id_scope_unique" UNIQUE("id","property_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "room_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capacity" integer DEFAULT 2 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_categories_id_scope_unique" UNIQUE("id","property_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "room_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"room_code" text NOT NULL,
	"capacity" integer,
	"operational_status" "room_operational_status" DEFAULT 'active' NOT NULL,
	"housekeeping_status" "housekeeping_status" DEFAULT 'clean' NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_id_scope_unique" UNIQUE("id","property_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_property_same_tenant_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_property_same_tenant_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_categories" ADD CONSTRAINT "room_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_categories" ADD CONSTRAINT "room_categories_property_same_tenant_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_status_history" ADD CONSTRAINT "room_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_status_history" ADD CONSTRAINT "room_status_history_room_scope_fk" FOREIGN KEY ("room_id","property_id","tenant_id") REFERENCES "public"."rooms"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_same_property_fk" FOREIGN KEY ("floor_id","property_id","tenant_id") REFERENCES "public"."floors"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_category_same_property_fk" FOREIGN KEY ("category_id","property_id","tenant_id") REFERENCES "public"."room_categories"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_property_name_unique" ON "departments" USING btree ("property_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "floors_property_name_live_unique" ON "floors" USING btree ("property_id",lower("name")) WHERE "floors"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "floors_scope_idx" ON "floors" USING btree ("tenant_id","property_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "room_categories_property_name_live_unique" ON "room_categories" USING btree ("property_id",lower("name")) WHERE "room_categories"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "room_status_history_room_idx" ON "room_status_history" USING btree ("tenant_id","room_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_property_code_live_unique" ON "rooms" USING btree ("property_id",lower("room_code")) WHERE "rooms"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "rooms_scope_status_idx" ON "rooms" USING btree ("tenant_id","property_id","operational_status");--> statement-breakpoint
CREATE INDEX "rooms_scope_hk_idx" ON "rooms" USING btree ("tenant_id","property_id","housekeeping_status");--> statement-breakpoint
CREATE INDEX "rooms_floor_idx" ON "rooms" USING btree ("floor_id");