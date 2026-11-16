CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role_id" uuid NOT NULL,
	"property_id" uuid,
	"department_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "notify_sound" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "notify_scope" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "service_items" ADD COLUMN "escalate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "escalate_after_minutes" integer;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_property_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_department_fk" FOREIGN KEY ("department_id","property_id","tenant_id") REFERENCES "public"."departments"("id","property_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_token_unique" ON "staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_open_email_unique" ON "staff_invitations" USING btree ("tenant_id",lower("email")) WHERE "staff_invitations"."accepted_at" is null and "staff_invitations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "staff_invitations_tenant_idx" ON "staff_invitations" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "ura_department_same_property_fk" FOREIGN KEY ("department_id","property_id","tenant_id") REFERENCES "public"."departments"("id","property_id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "ura_department_needs_property" CHECK ("user_role_assignments"."department_id" is null or "user_role_assignments"."property_id" is not null);