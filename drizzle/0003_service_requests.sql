CREATE TYPE "public"."request_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('new', 'acknowledged', 'in_progress', 'completed', 'cancelled', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."service_note_mode" AS ENUM('none', 'optional', 'required');--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"channels" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" "request_status",
	"to_status" "request_status" NOT NULL,
	"actor_user_id" uuid,
	"source" text NOT NULL,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'bell' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"max_quantity" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note_mode" "service_note_mode" DEFAULT 'optional' NOT NULL,
	"available_from" text,
	"available_to" text,
	"ack_message" text,
	"priority" "request_priority" DEFAULT 'normal' NOT NULL,
	"target_minutes" integer DEFAULT 15 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_items_id_scope_unique" UNIQUE("id","property_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"qr_code_id" uuid NOT NULL,
	"service_item_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"department_name" text NOT NULL,
	"room_code" text NOT NULL,
	"status" "request_status" DEFAULT 'new' NOT NULL,
	"priority" "request_priority" DEFAULT 'normal' NOT NULL,
	"target_minutes" integer DEFAULT 15 NOT NULL,
	"quantity" integer,
	"option" text,
	"guest_note" text,
	"guest_message" text,
	"ack_message" text,
	"assigned_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"guest_token_hash" text NOT NULL,
	"guest_token_ciphertext" text NOT NULL,
	"guest_token_expires_at" timestamp with time zone NOT NULL,
	"cancel_reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_requests_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "request_assignments" ADD CONSTRAINT "request_assignments_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_assignments" ADD CONSTRAINT "request_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_assignments" ADD CONSTRAINT "request_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_property_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_department_scope_fk" FOREIGN KEY ("department_id","property_id","tenant_id") REFERENCES "public"."departments"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_qr_code_id_room_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."room_qr_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_room_scope_fk" FOREIGN KEY ("room_id","property_id","tenant_id") REFERENCES "public"."rooms"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_scope_fk" FOREIGN KEY ("service_item_id","property_id","tenant_id") REFERENCES "public"."service_items"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_department_scope_fk" FOREIGN KEY ("department_id","property_id","tenant_id") REFERENCES "public"."departments"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "request_assignments_request_idx" ON "request_assignments" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE INDEX "request_status_history_request_idx" ON "request_status_history" USING btree ("tenant_id","request_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_items_property_key_live_unique" ON "service_items" USING btree ("property_id","key") WHERE "service_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "service_items_scope_idx" ON "service_items" USING btree ("tenant_id","property_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_guest_token_unique" ON "service_requests" USING btree ("guest_token_hash");--> statement-breakpoint
CREATE INDEX "service_requests_inbox_idx" ON "service_requests" USING btree ("tenant_id","property_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "service_requests_department_idx" ON "service_requests" USING btree ("tenant_id","department_id","status");--> statement-breakpoint
CREATE INDEX "service_requests_updated_idx" ON "service_requests" USING btree ("tenant_id","updated_at");