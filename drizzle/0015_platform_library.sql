ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "library_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_tenant_id" uuid NOT NULL,
	"contributor_user_id" uuid NOT NULL,
	"source_media_id" uuid NOT NULL,
	"source_content_version_id" uuid NOT NULL,
	"source_aircraft_id" uuid NOT NULL,
	"classification" text NOT NULL,
	"match_key" text NOT NULL,
	"operator_name" text,
	"aircraft_type" text NOT NULL,
	"tail" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"library_aircraft_id" uuid,
	"library_media_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_contrib_media_uq" ON "library_contributions" USING btree ("source_media_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_contrib_status_idx" ON "library_contributions" USING btree ("status","match_key");
