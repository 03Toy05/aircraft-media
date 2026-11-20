DO $$ BEGIN CREATE TYPE "public"."yes_no_status" AS ENUM('yes', 'no', 'unknown'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "aircraft_information_versions" ADD COLUMN IF NOT EXISTS "smoking" "yes_no_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "aircraft_information_versions" ADD COLUMN IF NOT EXISTS "pets" "yes_no_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "aircraft_information_versions" ADD COLUMN IF NOT EXISTS "cleaning_fee" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quote_key" text NOT NULL,
	"how" text NOT NULL,
	"options" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_shares_tenant_idx" ON "quote_shares" USING btree ("tenant_id","created_at");
