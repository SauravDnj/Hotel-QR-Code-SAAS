CREATE TYPE "public"."reservation_status" AS ENUM('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"room_id" uuid,
	"guest_id" uuid NOT NULL,
	"code" text NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"status" "reservation_status" DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"external_ref" text,
	"notes" text,
	"stay_id" uuid,
	"created_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_dates_check" CHECK ("reservations"."departure_date" > "reservations"."arrival_date"),
	CONSTRAINT "reservations_adults_check" CHECK ("reservations"."adults" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_category_scope_fk" FOREIGN KEY ("category_id","property_id","tenant_id") REFERENCES "public"."room_categories"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_room_scope_fk" FOREIGN KEY ("room_id","property_id","tenant_id") REFERENCES "public"."rooms"("id","property_id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_same_tenant_fk" FOREIGN KEY ("guest_id","tenant_id") REFERENCES "public"."guests"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_tenant_code_unique" ON "reservations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_external_ref_unique" ON "reservations" USING btree ("tenant_id","source","external_ref") WHERE "reservations"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_stay_unique" ON "reservations" USING btree ("stay_id") WHERE "reservations"."stay_id" is not null;--> statement-breakpoint
CREATE INDEX "reservations_arrivals_idx" ON "reservations" USING btree ("tenant_id","property_id","arrival_date");--> statement-breakpoint
CREATE INDEX "reservations_category_idx" ON "reservations" USING btree ("property_id","category_id","status","departure_date");--> statement-breakpoint
CREATE INDEX "reservations_room_idx" ON "reservations" USING btree ("room_id","status");