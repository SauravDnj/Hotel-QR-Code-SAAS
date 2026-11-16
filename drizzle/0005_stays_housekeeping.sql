CREATE TYPE "public"."housekeeping_task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."housekeeping_task_type" AS ENUM('cleaning', 'inspection');--> statement-breakpoint
CREATE TYPE "public"."stay_status" AS ENUM('checked_in', 'checked_out');--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_id_tenant_unique" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "housekeeping_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"stay_id" uuid,
	"task_type" "housekeeping_task_type" NOT NULL,
	"status" "housekeeping_task_status" DEFAULT 'open' NOT NULL,
	"reason" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"assigned_user_id" uuid,
	"created_by_user_id" uuid,
	"completed_by_user_id" uuid,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"status" "stay_status" DEFAULT 'checked_in' NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"check_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_checkout_at" timestamp with time zone NOT NULL,
	"checked_out_at" timestamp with time zone,
	"notes" text,
	"checked_in_by_user_id" uuid,
	"checked_out_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "require_inspection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_room_scope_fk" FOREIGN KEY ("room_id","property_id","tenant_id") REFERENCES "public"."rooms"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_checked_in_by_user_id_users_id_fk" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_checked_out_by_user_id_users_id_fk" FOREIGN KEY ("checked_out_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_room_scope_fk" FOREIGN KEY ("room_id","property_id","tenant_id") REFERENCES "public"."rooms"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_guest_same_tenant_fk" FOREIGN KEY ("guest_id","tenant_id") REFERENCES "public"."guests"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_tenant_idx" ON "guests" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "housekeeping_tasks_one_open_per_type" ON "housekeeping_tasks" USING btree ("room_id","task_type") WHERE "housekeeping_tasks"."status" in ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "housekeeping_tasks_board_idx" ON "housekeeping_tasks" USING btree ("tenant_id","property_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stays_one_active_per_room" ON "stays" USING btree ("room_id") WHERE "stays"."status" = 'checked_in';--> statement-breakpoint
CREATE INDEX "stays_room_idx" ON "stays" USING btree ("tenant_id","room_id","check_in_at");--> statement-breakpoint
CREATE INDEX "stays_departures_idx" ON "stays" USING btree ("tenant_id","property_id","status","expected_checkout_at");