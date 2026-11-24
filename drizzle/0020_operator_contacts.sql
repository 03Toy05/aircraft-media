ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "sales_contact" text;
