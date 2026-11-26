ALTER TABLE "word_templates" ADD COLUMN IF NOT EXISTS "layout" text;--> statement-breakpoint
ALTER TABLE "word_templates" ADD COLUMN IF NOT EXISTS "found" text;--> statement-breakpoint
ALTER TABLE "word_templates" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
