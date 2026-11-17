CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "notify_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "alert_phone" text;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "escalation_channel" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_membership_same_tenant_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."tenant_memberships"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_membership_endpoint_unique" ON "push_subscriptions" USING btree ("membership_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_tenant_idx" ON "push_subscriptions" USING btree ("tenant_id","membership_id");