ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "library_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_contributions" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "library_contributions" ADD COLUMN IF NOT EXISTS "replaces_media_id" uuid;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"aircraft_id" uuid NOT NULL,
	"library_aircraft_id" uuid NOT NULL,
	"copied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_copy_aircraft_uq" ON "library_copies" USING btree ("tenant_id","aircraft_id");
