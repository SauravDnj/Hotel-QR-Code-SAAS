CREATE TYPE "public"."service_kind" AS ENUM('request', 'menu', 'booking');--> statement-breakpoint
CREATE TABLE "folio_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"source" text NOT NULL,
	"request_id" uuid,
	"external_ref" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" uuid,
	"void_reason" text,
	CONSTRAINT "folio_charges_amount_check" CHECK ("folio_charges"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "folio_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folio_payments_amount_check" CHECK ("folio_payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"service_item_id" uuid NOT NULL,
	"section" text,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_items_id_tenant_unique" UNIQUE("id","tenant_id"),
	CONSTRAINT "menu_items_price_check" CHECK ("menu_items"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" integer NOT NULL,
	CONSTRAINT "request_items_quantity_check" CHECK ("request_items"."quantity" between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "service_items" ADD COLUMN "kind" "service_kind" DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_items" ADD COLUMN "allow_room_charge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "kind" "service_kind" DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "total_minor" integer;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "stay_id" uuid;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_id_tenant_unique" UNIQUE("id","tenant_id");
--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_stay_same_tenant_fk" FOREIGN KEY ("stay_id","tenant_id") REFERENCES "public"."stays"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_payments" ADD CONSTRAINT "folio_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_payments" ADD CONSTRAINT "folio_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_payments" ADD CONSTRAINT "folio_payments_stay_same_tenant_fk" FOREIGN KEY ("stay_id","tenant_id") REFERENCES "public"."stays"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_service_scope_fk" FOREIGN KEY ("service_item_id","property_id","tenant_id") REFERENCES "public"."service_items"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_menu_item_same_tenant_fk" FOREIGN KEY ("menu_item_id","tenant_id") REFERENCES "public"."menu_items"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folio_charges_request_unique" ON "folio_charges" USING btree ("request_id") WHERE "folio_charges"."request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "folio_charges_external_ref_unique" ON "folio_charges" USING btree ("tenant_id","external_ref") WHERE "folio_charges"."external_ref" is not null;--> statement-breakpoint
CREATE INDEX "folio_charges_stay_idx" ON "folio_charges" USING btree ("tenant_id","stay_id","created_at");--> statement-breakpoint
CREATE INDEX "folio_charges_property_idx" ON "folio_charges" USING btree ("tenant_id","property_id","created_at");--> statement-breakpoint
CREATE INDEX "folio_payments_stay_idx" ON "folio_payments" USING btree ("tenant_id","stay_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_service_name_live_unique" ON "menu_items" USING btree ("service_item_id",lower("name")) WHERE "menu_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "menu_items_service_idx" ON "menu_items" USING btree ("tenant_id","service_item_id","sort_order");--> statement-breakpoint
CREATE INDEX "request_items_request_idx" ON "request_items" USING btree ("tenant_id","request_id");--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_stay_same_tenant_fk" FOREIGN KEY ("stay_id","tenant_id") REFERENCES "public"."stays"("id","tenant_id") ON DELETE restrict ON UPDATE no action;