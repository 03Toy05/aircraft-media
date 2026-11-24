ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sign_in_links" ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'sign_in' NOT NULL;
