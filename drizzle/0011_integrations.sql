CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret_ciphertext" text NOT NULL,
	"events" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_property_same_tenant_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints" USING btree ("tenant_id","active");--> statement-breakpoint
-- Phase 9 entitlement: API & webhooks for Professional and Enterprise (operators can change it at /platform/plans).
UPDATE "plans" SET "entitlements" = jsonb_set("entitlements", '{modules,integrations}', to_jsonb("key" IN ('professional', 'enterprise')), true) WHERE NOT ("entitlements"->'modules' ? 'integrations');
