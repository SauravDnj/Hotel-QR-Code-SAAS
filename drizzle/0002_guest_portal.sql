CREATE TYPE "public"."qr_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "guest_portal_settings" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"show_room_label" boolean DEFAULT true NOT NULL,
	"welcome_message" text,
	"accent_color" text,
	"logo_url" text,
	"cover_image_url" text,
	"wifi_ssid" text,
	"wifi_password_ciphertext" text,
	"wifi_note" text,
	"reception_phone" text,
	"contact_email" text,
	"check_in_time" text,
	"check_out_time" text,
	"info_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"privacy_notice" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"status" "qr_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"last_scanned_at" timestamp with time zone,
	"scan_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD CONSTRAINT "guest_portal_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD CONSTRAINT "guest_portal_settings_property_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_qr_codes" ADD CONSTRAINT "room_qr_codes_room_scope_fk" FOREIGN KEY ("room_id","property_id","tenant_id") REFERENCES "public"."rooms"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_qr_codes_token_hash_unique" ON "room_qr_codes" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "room_qr_codes_one_active_per_room" ON "room_qr_codes" USING btree ("room_id") WHERE "room_qr_codes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "room_qr_codes_scope_idx" ON "room_qr_codes" USING btree ("tenant_id","property_id","status");--> statement-breakpoint
CREATE INDEX "room_qr_codes_room_idx" ON "room_qr_codes" USING btree ("tenant_id","room_id","issued_at");