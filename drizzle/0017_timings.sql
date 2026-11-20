CREATE TABLE IF NOT EXISTS "timings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"ms" integer NOT NULL,
	"server_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timings_created_idx" ON "timings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aircraft_tenant_active_idx" ON "aircraft" USING btree ("tenant_id","active");
