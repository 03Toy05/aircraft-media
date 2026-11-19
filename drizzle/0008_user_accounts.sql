ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");