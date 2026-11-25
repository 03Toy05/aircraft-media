CREATE TABLE IF NOT EXISTS "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"legs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "requests_reference_uq" ON "requests" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_tenant_idx" ON "requests" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "requests"("id"),
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_versions_uq" ON "quote_versions" USING btree ("request_id","version");
