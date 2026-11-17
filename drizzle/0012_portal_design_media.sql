CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD COLUMN "theme" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD COLUMN "background_color" text;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD COLUMN "font_style" text DEFAULT 'sans' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD COLUMN "show_gallery" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD COLUMN "logo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD COLUMN "cover_media_id" uuid;--> statement-breakpoint
ALTER TABLE "service_items" ADD COLUMN "image_media_id" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_property_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_scope_idx" ON "media_assets" USING btree ("tenant_id","property_id","kind","sort_order");--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD CONSTRAINT "guest_portal_settings_logo_media_id_media_assets_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_portal_settings" ADD CONSTRAINT "guest_portal_settings_cover_media_id_media_assets_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;