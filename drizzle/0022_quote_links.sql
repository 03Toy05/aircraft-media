CREATE TABLE IF NOT EXISTS "quote_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL REFERENCES "requests"("id"),
	"token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quote_links_token_uq" ON "quote_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_links_request_idx" ON "quote_links" USING btree ("request_id");
