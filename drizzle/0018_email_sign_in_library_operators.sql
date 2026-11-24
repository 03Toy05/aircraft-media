ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "library_operators" jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_in_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sign_in_links_token_uq" ON "sign_in_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sign_in_links_email_idx" ON "sign_in_links" USING btree ("email","created_at");
