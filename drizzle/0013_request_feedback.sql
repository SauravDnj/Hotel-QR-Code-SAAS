CREATE TABLE "request_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_feedback_rating_range" CHECK ("request_feedback"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "request_feedback" ADD CONSTRAINT "request_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_feedback" ADD CONSTRAINT "request_feedback_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_feedback" ADD CONSTRAINT "request_feedback_property_fk" FOREIGN KEY ("property_id","tenant_id") REFERENCES "public"."properties"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_feedback_request_unique" ON "request_feedback" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_feedback_scope_idx" ON "request_feedback" USING btree ("tenant_id","property_id","created_at");